"""Export every completed season as a browsable archive.

    python3 -m backend.scripts.build_history
    python3 -m backend.scripts.build_history --from-season 2025

Writes to `backend/data/history/`:

* `seasons.json`        — the index: one row per season
* `season_<year>.json`  — standings, the postseason bracket, every game

Seeds are RECONSTRUCTED, and the reconstruction is checked
-----------------------------------------------------------

The warehouse stores results, not seeds. So a seed here is `seed_conference`
applied to the final standings — and this project models four of the league's
twelve tiebreakers, breaking the remainder deterministically on team id.

**That reconstruction is verified against the postseason that was actually
played, per conference, per season.** If the set of teams the seeding produces
is not the set of teams that actually appeared in the playoffs, the seeds are
dropped for that conference and `seeds_verified` is false. A bracket drawn
with confidently wrong seed numbers is worse than one drawn with none: the
numbers are the part a reader trusts without checking, and every one of them
would be an assertion this pipeline cannot support.

The bracket itself is never reconstructed. It is the games that were played,
grouped by the round ESPN filed them under.

`--from-season` limits which season FILES are rewritten and nothing else
------------------------------------------------------------------------

`seasons.json` is always rebuilt over every season. The sibling NBA project
filtered its index too, and because its daily job passes
`--from-season <current>`, one scheduled run cut the archive index to a single
season and turned every other archived URL into a 404 while intact season
files sat beside them. Nothing failed; the pages simply stopped existing.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from backend.services.data.warehouse import (
    SEASON_TYPE_POSTSEASON,
    SEASON_TYPE_REGULAR,
    get_warehouse,
)
from backend.services.playoffs.bracket import (
    ROUND_ORDER,
    TeamRecord,
    byes_per_conference,
    seed_conference,
    seeds_per_conference,
)

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s"
)
logger = logging.getLogger("build_history")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "history"
RETRODICTIONS = ROOT / "data" / "diagnostics" / "retrodictions.json"


def _write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")))
    tmp.replace(path)


def load_retrodictions() -> Dict[str, Dict[str, Any]]:
    """What the walk-forward said about each game, if it has been run.

    **Read rather than recomputed.** `benchmark_market` already walks the
    corpus refitting weekly; doing it again here would be a second
    implementation of the same backtest, free to disagree with the one the
    accuracy page reports. Absent is absent: without the file, archived games
    render with no forecast rather than with a fresh one nobody scored.
    """
    try:
        payload = json.loads(RETRODICTIONS.read_text())
    except (OSError, json.JSONDecodeError):
        logger.warning(
            "no retrodictions.json — archived games will carry no forecast. "
            "Run benchmark_market to produce it."
        )
        return {}
    return {row["game_id"]: row for row in payload.get("games", [])}


def build_standings(
    games: Sequence[Any], teams: Dict[int, Any]
) -> Dict[int, Dict[str, Any]]:
    """Final regular-season standings, with the columns seeding needs."""
    table: Dict[int, Dict[str, Any]] = {
        tid: {
            "team_id": tid,
            "name": team["display_name"],
            "abbreviation": team["abbreviation"],
            "conference": team["conference"],
            "division": team["division"],
            "wins": 0, "losses": 0, "ties": 0,
            "points_for": 0, "points_against": 0,
            "home_wins": 0, "home_losses": 0,
            "away_wins": 0, "away_losses": 0,
            "division_wins": 0.0, "division_games": 0.0,
            "conference_wins": 0.0, "conference_games": 0.0,
        }
        for tid, team in teams.items()
    }

    for row in games:
        home, away = int(row["home_team_id"]), int(row["away_team_id"])
        if home not in table or away not in table:
            continue
        hs, as_ = int(row["home_score"]), int(row["away_score"])
        same_div = table[home]["division"] == table[away]["division"]
        same_conf = table[home]["conference"] == table[away]["conference"]

        for side, scored, allowed in ((home, hs, as_), (away, as_, hs)):
            table[side]["points_for"] += scored
            table[side]["points_against"] += allowed
            if same_div:
                table[side]["division_games"] += 1
            if same_conf:
                table[side]["conference_games"] += 1

        if hs == as_:
            for side in (home, away):
                table[side]["ties"] += 1
                if same_div:
                    table[side]["division_wins"] += 0.5
                if same_conf:
                    table[side]["conference_wins"] += 0.5
        else:
            winner, loser = (home, away) if hs > as_ else (away, home)
            table[winner]["wins"] += 1
            table[loser]["losses"] += 1
            if same_div:
                table[winner]["division_wins"] += 1
            if same_conf:
                table[winner]["conference_wins"] += 1
            if hs > as_:
                table[home]["home_wins"] += 1
                table[away]["away_losses"] += 1
            else:
                table[away]["away_wins"] += 1
                table[home]["home_losses"] += 1

    return table


def head_to_head(games: Sequence[Any]) -> Dict[tuple, float]:
    """Season head-to-head, as a win share from the first team's view."""
    tally: Dict[tuple, List[float]] = defaultdict(list)
    for row in games:
        home, away = int(row["home_team_id"]), int(row["away_team_id"])
        hs, as_ = int(row["home_score"]), int(row["away_score"])
        result = 0.5 if hs == as_ else (1.0 if hs > as_ else 0.0)
        tally[(home, away)].append(result)
        tally[(away, home)].append(1.0 - result)
    return {pair: sum(v) / len(v) for pair, v in tally.items()}


def assign_seeds(
    season: int,
    standings: Dict[int, Dict[str, Any]],
    postseason: Sequence[Any],
    h2h: Dict[tuple, float],
) -> Dict[str, Any]:
    """Reconstruct the seeds, then check them against who actually played."""
    played_in_postseason: set = set()
    for row in postseason:
        played_in_postseason.add(int(row["home_team_id"]))
        played_in_postseason.add(int(row["away_team_id"]))

    by_conference: Dict[str, List[TeamRecord]] = defaultdict(list)
    for entry in standings.values():
        if not entry["conference"]:
            continue
        by_conference[entry["conference"]].append(TeamRecord(
            team_id=entry["team_id"],
            wins=entry["wins"],
            losses=entry["losses"],
            ties=entry["ties"],
            division=entry["division"],
            conference=entry["conference"],
            division_wins=entry["division_wins"],
            division_games=entry["division_games"],
            conference_wins=entry["conference_wins"],
            conference_games=entry["conference_games"],
        ))

    seeds: Dict[int, int] = {}
    verified: Dict[str, bool] = {}
    for conference, records in by_conference.items():
        ordered = seed_conference(records, season, head_to_head=h2h)
        field = {r.team_id for r in ordered}
        actual = {
            t for t in played_in_postseason
            if (standings.get(t) or {}).get("conference") == conference
        }
        ok = bool(actual) and field == actual
        verified[conference] = ok
        if ok:
            for index, record in enumerate(ordered):
                seeds[record.team_id] = index + 1
        else:
            logger.warning(
                "%s %s: reconstructed field != actual (%d vs %d teams) — "
                "seeds withheld",
                season, conference, len(field), len(actual),
            )
    return {"seeds": seeds, "verified": verified}


def build_bracket(
    season: int,
    postseason: Sequence[Any],
    seeds: Dict[int, int],
    teams: Dict[int, Any],
) -> Dict[str, Any]:
    """The postseason that was played, grouped by round.

    Not reconstructed and not simulated — these are results. The rounds come
    from `postseason_round`, which the ingester derives from the ESPN week and
    which is era-correct on both sides of the 2009 Pro Bowl move.
    """
    rounds: Dict[str, List[Dict[str, Any]]] = {name: [] for name in ROUND_ORDER}
    for row in postseason:
        name = str(row["postseason_round"] or "")
        if name not in rounds:
            rounds[name] = []
        home, away = int(row["home_team_id"]), int(row["away_team_id"])
        hs, as_ = int(row["home_score"]), int(row["away_score"])
        rounds[name].append({
            "game_id": row["game_id"],
            "date": str(row["date_utc"])[:10],
            "home": teams[home]["abbreviation"] if home in teams else None,
            "away": teams[away]["abbreviation"] if away in teams else None,
            "home_name": teams[home]["display_name"] if home in teams else None,
            "away_name": teams[away]["display_name"] if away in teams else None,
            "home_seed": seeds.get(home),
            "away_seed": seeds.get(away),
            "home_score": hs,
            "away_score": as_,
            "winner": (
                teams[home]["abbreviation"] if hs > as_ else teams[away]["abbreviation"]
            ) if home in teams and away in teams else None,
            "conference": (
                teams[home]["conference"]
                if name != "super-bowl" and home in teams
                else None
            ),
            "neutral": bool(row["neutral_site"]),
        })

    for name in rounds:
        rounds[name].sort(key=lambda g: (g["home_seed"] or 99, g["date"]))

    # Byes are a fact about the bracket a reader cannot infer from a list of
    # games: the top seed simply does not appear until the divisional round,
    # which looks like missing data rather than like a week off.
    byes: Dict[str, List[int]] = {}
    n_byes = byes_per_conference(season)
    if seeds:
        conference_of = {
            tid: team["conference"] for tid, team in teams.items() if team["conference"]
        }
        for conference in set(conference_of.values()):
            members = sorted(
                seed for tid, seed in seeds.items()
                if conference_of.get(tid) == conference
            )
            byes[conference] = members[:n_byes]

    return {
        "seeds_per_conference": seeds_per_conference(season),
        "byes_per_conference": n_byes,
        "byes": byes,
        "rounds": {name: games for name, games in rounds.items() if games},
    }


def build_season(
    season: int,
    warehouse: Any,
    teams: Dict[int, Any],
    retrodictions: Dict[str, Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    regular = list(warehouse.iter_games(
        seasons=[season], season_types=(SEASON_TYPE_REGULAR,)
    ))
    postseason = list(warehouse.iter_games(
        seasons=[season], season_types=(SEASON_TYPE_POSTSEASON,)
    ))
    if not regular:
        return None

    standings = build_standings(regular, teams)
    h2h = head_to_head(regular)
    seeding = assign_seeds(season, standings, postseason, h2h)
    bracket = build_bracket(season, postseason, seeding["seeds"], teams)

    champion = None
    runner_up = None
    final = bracket["rounds"].get("super-bowl") or []
    if final:
        last = final[-1]
        champion = last["winner"]
        runner_up = last["away"] if last["winner"] == last["home"] else last["home"]

    games: List[Dict[str, Any]] = []
    for row in list(regular) + list(postseason):
        home, away = int(row["home_team_id"]), int(row["away_team_id"])
        if home not in teams or away not in teams:
            continue
        forecast = retrodictions.get(str(row["game_id"]))
        games.append({
            "game_id": row["game_id"],
            "date": str(row["date_utc"])[:10],
            "week": int(row["week"]),
            "postseason": int(row["season_type"]) == SEASON_TYPE_POSTSEASON,
            "round": row["postseason_round"],
            "home": teams[home]["abbreviation"],
            "away": teams[away]["abbreviation"],
            "home_score": int(row["home_score"]),
            "away_score": int(row["away_score"]),
            "neutral": bool(row["neutral_site"]),
            # `p_home` is the model's CONDITIONAL (decided-game) probability,
            # the same quantity the accuracy page scores. None where the
            # walk-forward did not reach this game — the first seasons are the
            # warm-up the model was fitted on, and printing a number for them
            # would be printing a forecast that had seen the answer.
            "p_home": forecast["p_home"] if forecast else None,
            "exp_margin": forecast["exp_margin"] if forecast else None,
            "p_market": forecast.get("p_market") if forecast else None,
        })
    games.sort(key=lambda g: (g["date"], g["game_id"]))

    standings_out = sorted(
        (
            {
                **{k: v for k, v in entry.items()
                   if k not in ("division_wins", "division_games",
                                "conference_wins", "conference_games")},
                "seed": seeding["seeds"].get(entry["team_id"]),
                "point_diff": entry["points_for"] - entry["points_against"],
            }
            for entry in standings.values()
            if entry["conference"]
        ),
        key=lambda e: (e["conference"], e["division"], -(e["wins"] + 0.5 * e["ties"])),
    )

    return {
        "season": season,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "regular_season_games": len(regular),
        "postseason_games": len(postseason),
        "champion": champion,
        "runner_up": runner_up,
        "seeds_verified": seeding["verified"],
        "standings": standings_out,
        "bracket": bracket,
        "games": games,
        "forecast_basis": "backtest" if retrodictions else None,
    }


def run(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-season", type=int, default=None)
    parser.add_argument("--db")
    args = parser.parse_args(argv)

    warehouse = get_warehouse(args.db) if args.db else get_warehouse()
    teams = {int(t["team_id"]): t for t in warehouse.franchises()}
    retrodictions = load_retrodictions()
    logger.info("read %d retrodictions", len(retrodictions))

    first, last = warehouse.season_range()
    if first is None or last is None:
        logger.error("empty warehouse")
        return 1

    index: List[Dict[str, Any]] = []
    for season in range(int(first), int(last) + 1):
        # The INDEX is rebuilt over every season regardless of --from-season.
        # See the docstring: filtering it is how the sibling project deleted
        # its own archive.
        existing = OUT / f"season_{season}.json"
        rebuild = args.from_season is None or season >= args.from_season

        if rebuild:
            payload = build_season(season, warehouse, teams, retrodictions)
            if payload is None:
                continue
            _write(existing, payload)
            logger.info(
                "season %s: %d regular, %d postseason, champion %s",
                season, payload["regular_season_games"],
                payload["postseason_games"], payload["champion"] or "—",
            )
        else:
            try:
                payload = json.loads(existing.read_text())
            except (OSError, json.JSONDecodeError):
                continue

        best = max(
            payload["standings"],
            key=lambda e: (e["wins"] + 0.5 * e["ties"], e["point_diff"]),
        ) if payload["standings"] else None
        index.append({
            "season": season,
            "regular_season_games": payload["regular_season_games"],
            "postseason_games": payload["postseason_games"],
            "champion": payload["champion"],
            "runner_up": payload["runner_up"],
            "best_record": (
                {
                    "abbreviation": best["abbreviation"],
                    "name": best["name"],
                    "wins": best["wins"],
                    "losses": best["losses"],
                    "ties": best["ties"],
                }
                if best else None
            ),
            "seeds_verified": all(payload["seeds_verified"].values())
            if payload["seeds_verified"] else False,
        })

    if not index:
        logger.error("no seasons built — refusing to publish an empty index")
        return 1

    _write(OUT / "seasons.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seasons": sorted(index, key=lambda s: -s["season"]),
        "note": (
            "Seeds are reconstructed from final standings and verified "
            "against the postseason field that actually played. A season "
            "where they disagree carries no seed numbers rather than wrong "
            "ones."
        ),
    })
    logger.info("wrote seasons.json (%d seasons)", len(index))
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    return run(argv)


if __name__ == "__main__":
    sys.exit(main())
