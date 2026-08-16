"""Turn ESPN scoreboard events into canonical warehouse rows.

This is the only module that knows ESPN's payload shape. Everything
downstream reads the warehouse.

The rules below are inherited from the sibling NBA and soccer projects, where
each one was learned the hard way, plus three that are specific to football.

Inherited
---------
* **A game is filed by ESPN's event id.** One source, 32 stable franchises,
  integer team ids: there is no fuzzy name resolution anywhere in this
  project and there does not need to be.
* **Refuse bracket SLOT names at the ingester, not just at the simulator.**
  ESPN publishes undrawn playoff fixtures with both sides named "TBD". A junk
  `teams` row is permanent and competes with every later lookup.
* **A game whose two sides resolve to the same franchise is refused**,
  whatever it is called.
* **A postponed game is neither a result nor a fixture.** ESPN keeps the
  original event forever with `STATUS_POSTPONED` and publishes the makeup
  under a new event id. Filing the original as scheduled leaves a game in the
  remaining set that will never be played.
* **Exhibitions are filtered by PARTICIPATION, never by name.** A franchise
  is a team with a conference, read from ESPN's standings.

Football-specific
-----------------
* **The Pro Bowl moves, and no calendar rule can pin it.** From 2009 it is
  postseason week 4, sitting between the conference championships and the
  Super Bowl — so anything reading "round = week number" gets a five-round
  bracket whose fourth round is an exhibition between teams called "AFC" and
  "NFC". **Before 2009 it was played the week AFTER the Super Bowl**, in
  Hawaii, and ESPN files those seasons with the Super Bowl as week 4 and no
  week 5 at all.

  An earlier version of this file hard-coded "week 4 is the Pro Bowl" and
  therefore **refused seven Super Bowls (2002-2008)** while ingesting seven
  Pro Bowls in their place, labelled `super-bowl`. Every season still had a
  plausible-looking bracket. It was caught only by the integrity checker's
  postseason count, which knows a single-elimination field of N teams plays
  exactly N-1 games and found 10 where it wanted 11.

  The filter is **participation**, which is era-independent: a franchise is a
  team ESPN's standings place in a conference, and the Pro Bowl's sides never
  are. `client.postseason_round` then labels weeks 1-3 and calls anything
  later the Super Bowl, which is correct in both eras precisely because the
  exhibition is already gone.

* **A tie is a result.** `home_score == away_score` is a legal, final NFL
  regular-season outcome. It is never a data error and must never be coerced
  into a win for either side.

* **`interceptions` appears TWICE in the team box score**, once under passing
  and once under turnovers, with different values. A naive
  `{s['name']: s['value']}` dict silently keeps whichever came last. The
  parser below reads an explicit whitelist by position rather than building a
  dict, for the same reason the NBA project forbids matching on
  `abbreviation`: two different stats sharing a key is not a hypothetical.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from backend.services.espn.client import (
    NFL_COMPETITION_ID,
    NFL_PLAYOFFS_COMPETITION_ID,
    postseason_round,
    SEASON_TYPE_POSTSEASON,
    SEASON_TYPE_PRESEASON,
    SEASON_TYPE_REGULAR,
)
from backend.services.data.warehouse import (
    GameRow,
    PHASE_PRESEASON,
    PHASE_PRO_BOWL,
    PHASE_REGULAR,
    ScheduledGameRow,
    Warehouse,
)

logger = logging.getLogger(__name__)

SOURCE = "espn"

# Statuses that mean "this game produced a final score".
FINAL_STATUSES = {"STATUS_FINAL", "STATUS_FINAL_OVERTIME", "STATUS_FINAL_PEN"}

# Statuses that mean "this event will never be played as filed". A postponed
# NFL game reappears under a NEW event id; the original must not survive as a
# fixture or it is a phantom game in every remaining-schedule count.
DEAD_STATUSES = {"STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_SUSPENDED"}

# Placeholder names ESPN uses for undrawn playoff slots. Matched
# case-insensitively against the whole trimmed name, never as a substring:
# "TBD" as a substring would match nothing real today but is exactly the kind
# of rule that eats a legitimate name later.
_PLACEHOLDER_NAMES = {
    "tbd", "to be determined", "tba", "afc", "nfc",
    "afc wild card", "nfc wild card", "winner", "bye",
    # ESPN's real, id-bearing Pro Bowl squads. Listed as belt-and-braces
    # only — the PARTICIPATION test in `parse_event` is what actually refuses
    # them, and it runs before any team is resolved. A name list cannot be
    # the guard here: these two changed format (and name) in 2023 and would
    # need editing every time the league rebrands the exhibition.
    "afc all-stars", "nfc all-stars",
}


def is_placeholder(name: Optional[str]) -> bool:
    """True for an undrawn bracket slot rather than a real franchise."""
    if not name:
        return True
    return str(name).strip().lower() in _PLACEHOLDER_NAMES


class ESPNLoader:
    """Parses ESPN events and writes them to the warehouse."""

    def __init__(self, warehouse: Warehouse):
        self.warehouse = warehouse
        self.warehouse.upsert_competition(
            NFL_COMPETITION_ID, "National Football League", "league"
        )
        self.warehouse.upsert_competition(
            NFL_PLAYOFFS_COMPETITION_ID, "NFL Playoffs", "playoffs"
        )
        self._skipped: Dict[str, int] = {}
        # The 32 real franchises, by ESPN id. Populated by `apply_standings`,
        # which is the only source that knows which teams are in a
        # conference. Empty until then — and while it is empty the
        # participation filter is inert, so `build_warehouse` pulls standings
        # BEFORE any season.
        self.franchise_ids: set[str] = set()

    # ------------------------------------------------------------- teams

    def register_teams(self, teams: Iterable[Dict[str, Any]]) -> int:
        """Register franchises from the `teams` endpoint.

        Conference and division are NOT available here — they come from
        `apply_standings`, which is the only source that carries them.
        """
        count = 0
        for team in teams:
            espn_id = team.get("id")
            name = team.get("displayName") or team.get("name")
            if not espn_id or not name or is_placeholder(name):
                continue
            self.warehouse.upsert_team(
                str(espn_id),
                str(name),
                short_name=team.get("shortDisplayName"),
                abbreviation=team.get("abbreviation"),
                logo=team.get("logos", [{}])[0].get("href") if team.get("logos") else team.get("logo"),
                color=team.get("color"),
                venue_name=(team.get("venue") or {}).get("fullName"),
            )
            count += 1
        return count

    def apply_standings(self, payload: Dict[str, Any]) -> int:
        """Set conference AND division from a `level=3` standings payload.

        Division is what the playoff seed is built from — four division
        winners take seeds 1-4 in each conference regardless of record, so a
        missing division does not degrade the projection, it invalidates it.

        The payload nests conference → division → entries. A `level=2`
        payload has no division layer at all and this method will report zero
        divisions set, which `build_warehouse` treats as a hard failure.
        """
        count = 0
        for conference in payload.get("children") or []:
            conf_name = conference.get("name") or conference.get("shortName")
            divisions = conference.get("children") or []
            if not divisions:
                # Flat payload: conference only, no divisions. Record what we
                # can and let the caller notice the division count is zero.
                for entry in (conference.get("standings") or {}).get("entries") or []:
                    team = entry.get("team") or {}
                    if team.get("id"):
                        self.franchise_ids.add(str(team["id"]))
                        self.warehouse.upsert_team(
                            str(team["id"]),
                            str(team.get("displayName") or team.get("name")),
                            conference=conf_name,
                        )
                continue
            for division in divisions:
                div_name = division.get("name") or division.get("shortName")
                for entry in (division.get("standings") or {}).get("entries") or []:
                    team = entry.get("team") or {}
                    if not team.get("id"):
                        continue
                    self.franchise_ids.add(str(team["id"]))
                    self.warehouse.upsert_team(
                        str(team["id"]),
                        str(team.get("displayName") or team.get("name")),
                        abbreviation=team.get("abbreviation"),
                        conference=conf_name,
                        division=div_name,
                    )
                    count += 1
        return count

    def _team_key(
        self, competitor: Dict[str, Any], seen: Optional[str]
    ) -> Optional[int]:
        team = competitor.get("team") or {}
        espn_id = team.get("id")
        name = team.get("displayName") or team.get("name")
        if not espn_id or is_placeholder(name):
            return None
        return self.warehouse.upsert_team(
            str(espn_id),
            str(name),
            short_name=team.get("shortDisplayName"),
            abbreviation=team.get("abbreviation"),
            logo=team.get("logo"),
            color=team.get("color"),
            seen=seen,
        )

    # ------------------------------------------------------------ events

    def parse_event(
        self, event: Dict[str, Any]
    ) -> Tuple[Optional[GameRow], Optional[ScheduledGameRow], Optional[str]]:
        """One ESPN event → (played, scheduled, skip_reason). Exactly one is set."""
        event_id = str(event.get("id") or "")
        if not event_id:
            return None, None, "no event id"

        competitions = event.get("competitions") or []
        if not competitions:
            return None, None, "no competition"
        comp = competitions[0]

        # Season, season_type and week come from the QUERY that returned this
        # event, stamped by `get_season_events`. ESPN echoes them inconsistently
        # per-event, and a postseason ROUND is only knowable from the week.
        query = event.get("_query") or {}
        season = _as_int(query.get("season")) or _as_int(
            (event.get("season") or {}).get("year")
        )
        season_type = _as_int(query.get("season_type")) or _as_int(
            (event.get("season") or {}).get("type")
        )
        week = _as_int(query.get("week")) or _as_int(
            (event.get("week") or {}).get("number")
        )
        if season is None or season_type is None or week is None:
            return None, None, "no season/week context"

        date_utc = _normalise_date(comp.get("date") or event.get("date"))
        if not date_utc:
            return None, None, "no date"

        status = ((comp.get("status") or {}).get("type") or {})
        status_name = str(status.get("name") or "")
        if status_name in DEAD_STATUSES:
            # Neither a result nor a fixture. The makeup game arrives under a
            # different event id and is ingested on its own merits.
            return None, None, f"status {status_name}"

        competitors = comp.get("competitors") or []
        if len(competitors) != 2:
            return None, None, f"{len(competitors)} competitors"

        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if home is None or away is None:
            return None, None, "no home/away split"

        # ---- exhibitions, identified by PARTICIPATION, not by calendar.
        #
        # **This test runs BEFORE any team is resolved, and the ordering is
        # the whole point.** `_team_key` upserts, so resolving first and
        # judging second writes the exhibition's sides into `teams` on the way
        # past. ESPN gives the Pro Bowl squads real, stable team ids (31 "AFC
        # All-Stars", 32 "NFC All-Stars") in some seasons and nothing at all
        # in others, so a name-based guard misses them and two junk
        # franchises land in the table permanently.
        #
        # **And no calendar rule works either.** The Pro Bowl is postseason
        # week 4 from 2009 — but before 2009 it was played the week AFTER the
        # Super Bowl, so ESPN files 2002-2008 with the SUPER BOWL as week 4.
        # An earlier version refused week 4 outright and deleted seven Super
        # Bowls while ingesting seven Pro Bowls in their place.
        #
        # A franchise is a team ESPN's standings place in a conference. That
        # is true in every era and needs no maintenance.
        if self.franchise_ids:
            for side in (home, away):
                espn_id = str(((side.get("team") or {}).get("id")) or "")
                if espn_id and espn_id not in self.franchise_ids:
                    return None, None, "non-franchise side (exhibition)"

        home_id = self._team_key(home, date_utc)
        away_id = self._team_key(away, date_utc)

        if home_id is None or away_id is None:
            return None, None, "placeholder or unknown team"

        if home_id == away_id:
            # Cannot be real. Almost always two bracket slots that resolved to
            # the same string before the draw.
            return None, None, "both sides resolve to one franchise"

        phase = (
            PHASE_PRESEASON if season_type == SEASON_TYPE_PRESEASON
            else PHASE_REGULAR
        )
        round_slug = (
            postseason_round(week)
            if season_type == SEASON_TYPE_POSTSEASON
            else None
        )
        competition_id = (
            NFL_PLAYOFFS_COMPETITION_ID
            if season_type == SEASON_TYPE_POSTSEASON
            else NFL_COMPETITION_ID
        )

        common: Dict[str, Any] = {
            "neutral_site": 1 if comp.get("neutralSite") else 0,
            "venue": (comp.get("venue") or {}).get("fullName"),
            "phase": phase,
            "postseason_round": round_slug,
        }

        completed = bool(status.get("completed")) or status_name in FINAL_STATUSES
        home_score = _as_int(home.get("score"))
        away_score = _as_int(away.get("score"))

        if completed and home_score is not None and away_score is not None:
            extra = dict(common)
            extra["attendance"] = _as_int(comp.get("attendance"))
            extra.update(_linescores(home, "home"))
            extra.update(_linescores(away, "away"))
            # `period > 4` is the only reliable overtime signal: the status
            # name STATUS_FINAL_OVERTIME is not always set on older rows.
            period = _as_int((comp.get("status") or {}).get("period")) or 4
            extra["went_overtime"] = 1 if period > 4 else 0
            return (
                GameRow(
                    game_id=event_id,
                    source=SOURCE,
                    competition_id=competition_id,
                    season=season,
                    season_type=season_type,
                    week=week,
                    date_utc=date_utc,
                    home_team_id=home_id,
                    away_team_id=away_id,
                    home_score=home_score,
                    away_score=away_score,
                    extra=extra,
                ),
                None,
                None,
            )

        return (
            None,
            ScheduledGameRow(
                game_id=event_id,
                source=SOURCE,
                competition_id=competition_id,
                season=season,
                season_type=season_type,
                week=week,
                date_utc=date_utc,
                home_team_id=home_id,
                away_team_id=away_id,
                extra=common,
            ),
            None,
        )

    def load_events(self, events: Sequence[Dict[str, Any]]) -> Dict[str, int]:
        """Parse and write a batch of events.

        Writes results and fixtures, then prunes: a game that has just
        acquired a score must leave `scheduled_games` in the same pass, or it
        is counted twice by everything that adds played to remaining.
        """
        played: List[GameRow] = []
        scheduled: List[ScheduledGameRow] = []
        skipped = 0

        for event in events:
            game, fixture, reason = self.parse_event(event)
            if game is not None:
                played.append(game)
            elif fixture is not None:
                scheduled.append(fixture)
            else:
                skipped += 1
                key = reason or "unknown"
                self._skipped[key] = self._skipped.get(key, 0) + 1

        self.warehouse.upsert_games(played)
        self.warehouse.upsert_scheduled(scheduled)
        pruned = self.warehouse.prune_played_from_scheduled()

        return {
            "games": len(played),
            "scheduled": len(scheduled),
            "skipped": skipped,
            "pruned": pruned,
        }

    def skip_report(self) -> Dict[str, int]:
        """Why events were skipped, by reason. Logged rather than swallowed."""
        return dict(sorted(self._skipped.items(), key=lambda kv: -kv[1]))

    # -------------------------------------------------------- box scores

    def apply_summary(self, game_id: str, summary: Dict[str, Any]) -> bool:
        """Fold a summary endpoint's TEAM box score into an existing row.

        Returns False when the summary carries no usable team statistics,
        which is normal for older seasons and is recorded as missing rather
        than filled with zeros.
        """
        teams = ((summary or {}).get("boxscore") or {}).get("teams") or []
        if len(teams) != 2:
            return False

        row = self.warehouse.conn.execute(
            "SELECT home_team_id, away_team_id FROM games WHERE game_id = ?",
            (str(game_id),),
        ).fetchone()
        if row is None:
            return False

        extra: Dict[str, Any] = {}
        wrote = False
        for entry in teams:
            espn_id = str((entry.get("team") or {}).get("id") or "")
            team_id = self.warehouse.team_id_for_espn(espn_id)
            if team_id is None:
                continue
            if team_id == int(row["home_team_id"]):
                side = "home"
            elif team_id == int(row["away_team_id"]):
                side = "away"
            else:
                continue
            stats = _team_box(entry, side)
            if stats:
                extra.update(stats)
                wrote = True

        if not wrote:
            return False

        sets = ", ".join(f"{k} = ?" for k in extra)
        self.warehouse.conn.execute(
            f"UPDATE games SET {sets} WHERE game_id = ?",
            [*extra.values(), str(game_id)],
        )
        self.warehouse.conn.commit()
        return True


# --------------------------------------------------------------- helpers


def _as_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalise_date(raw: Optional[str]) -> Optional[str]:
    """ESPN's `2025-09-07T17:00Z` → a comparable ISO-8601 UTC string.

    Stored as text and compared lexicographically everywhere, so the format
    must be identical on every row — `iter_games` orders on it and Elo raises
    on an out-of-order stream.
    """
    if not raw:
        return None
    text = str(raw).strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def _linescores(competitor: Dict[str, Any], side: str) -> Dict[str, Any]:
    """Per-quarter scoring, plus a combined overtime bucket.

    Periods 1-4 map to q1-q4. **Everything from period 5 on is summed into
    one `ot` column** rather than given a column each: multiple overtimes are
    possible in the postseason, and a schema with `ot1`/`ot2` would have to
    grow the first time a playoff game reached a third.
    """
    out: Dict[str, Any] = {}
    overtime = 0.0
    saw_ot = False
    for entry in competitor.get("linescores") or []:
        period = _as_int(entry.get("period"))
        value = _as_float(entry.get("value"))
        if period is None or value is None:
            continue
        if 1 <= period <= 4:
            out[f"{side}_q{period}"] = int(value)
        elif period >= 5:
            overtime += value
            saw_ot = True
    if saw_ot:
        out[f"{side}_ot"] = int(overtime)
    return out


# Team box-score stats this project stores, as (ESPN name, column suffix).
#
# Read as an explicit whitelist rather than by building a dict over the
# statistics array, because **`interceptions` appears twice in that array**
# with different meanings and values — once as passing interceptions thrown
# and once inside the turnover block. `dict(...)` keeps whichever came last
# and nothing reports the collision.
_BOX_SCALARS: Tuple[Tuple[str, str], ...] = (
    ("firstDowns", "first_downs"),
    ("totalYards", "total_yards"),
    ("netPassingYards", "pass_yards"),
    ("rushingYards", "rush_yards"),
    ("turnovers", "turnovers"),
    ("totalOffensivePlays", "plays"),
)


def _team_box(entry: Dict[str, Any], side: str) -> Dict[str, Any]:
    """Parse one team's box-score block into warehouse columns."""
    out: Dict[str, Any] = {}
    stats = entry.get("statistics") or []

    # First occurrence wins for every whitelisted scalar.
    seen: Dict[str, Any] = {}
    for stat in stats:
        name = stat.get("name")
        if name and name not in seen:
            seen[name] = stat.get("displayValue")

    for espn_name, column in _BOX_SCALARS:
        value = _as_float(seen.get(espn_name))
        if value is not None:
            out[f"{side}_{column}"] = value

    # `10-15` → attempted 15, converted 10.
    third = str(seen.get("thirdDownEff") or "")
    if "-" in third:
        conv, _, att = third.partition("-")
        conv_v, att_v = _as_float(conv), _as_float(att)
        if conv_v is not None and att_v is not None:
            out[f"{side}_third_down_conv"] = conv_v
            out[f"{side}_third_down_att"] = att_v

    # `6-57` → 6 penalties for 57 yards.
    pen = str(seen.get("totalPenaltiesYards") or "")
    if "-" in pen:
        n, _, yards = pen.partition("-")
        n_v, y_v = _as_float(n), _as_float(yards)
        if n_v is not None and y_v is not None:
            out[f"{side}_penalties"] = n_v
            out[f"{side}_penalty_yards"] = y_v

    # `0-0` → sacks taken and yards lost; only the count is stored.
    sacks = str(seen.get("sacksYardsLost") or "")
    if "-" in sacks:
        n, _, _y = sacks.partition("-")
        n_v = _as_float(n)
        if n_v is not None:
            out[f"{side}_sacks"] = n_v

    # `28:13` → seconds. Stored as seconds so it can be averaged; a
    # mm:ss string cannot be, and the two halves of a game do not sum to 60
    # minutes when there is overtime.
    possession = str(seen.get("possessionTime") or "")
    if ":" in possession:
        mins, _, secs = possession.partition(":")
        m_v, s_v = _as_float(mins), _as_float(secs)
        if m_v is not None and s_v is not None:
            out[f"{side}_possession_sec"] = m_v * 60.0 + s_v

    return out
