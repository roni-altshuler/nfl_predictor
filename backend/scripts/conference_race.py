"""The conference race as a line, not a snapshot.

    python3 -m backend.scripts.conference_race --track
    python3 -m backend.scripts.conference_race --replay 2025 --sims 4000

Two modes that write the same shape, and are labelled so a reader can always
tell which one they are looking at:

* ``--track`` appends TODAY's published projection to
  ``predictions/conference_race_current.json``. Idempotent per Eastern day:
  running it twice replaces the day's point rather than doubling it, so a
  re-run after a failed deploy does not put a kink in the line.
  ``basis: "live"``.

* ``--replay SEASON`` reconstructs the whole arc of a completed season by
  re-simulating it from scratch at every week boundary, each using only games
  played strictly BEFORE that boundary. ``basis: "backtest"``.

**Checkpoints are WEEKS, not a fixed number of days.** The sibling NBA project
steps every ten days because basketball has no other index; football has one,
ESPN serves the schedule by it, and the warehouse stores it as a NOT NULL
column. A day-stepped checkpoint would land mid-week — after Thursday night
and before Sunday — and draw a kink that is an artifact of the sampling rather
than a fact about the season.

**The replay is a reconstruction and the artifact says so on every record.**
The ratings at each checkpoint genuinely never saw the future — the corpus is
walked in order and snapshotted — but nobody read these numbers on those dates
either, and a line chart is unusually good at implying that somebody did.

Why the replay prices from ratings alone
----------------------------------------

The served forecaster runs every fixture through ``FeatureBuilder.vector_for``,
which is stateful: it carries each team's last kickoff and rolling form, and
``observe_scheduled`` advances that clock past an unplayed fixture. Rewinding
that state to eighteen different points in a season would mean eighteen
independent builder walks, and a builder that has to be told which results it
is allowed to have seen is exactly the shape of bug this project has been bitten
by twice.

So the replay uses ``predict_from_elo`` with the margin model fitted on games
strictly earlier than the replayed season — a genuine walk-forward, and the
lattice weights and margin sd come from that fit rather than from defaults.
**This is a different path from the served forecast and the artifact says so.**
It costs less than it sounds: on the published walk-forward, Elo-only scores
.2198 Brier against the full feature model's .2199, so the ratings-only path
is not measurably worse at exactly the thing this chart draws.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from backend.services.data.warehouse import (
    SEASON_TYPE_POSTSEASON,
    SEASON_TYPE_REGULAR,
    get_warehouse,
)
from backend.services.espn.client import regular_season_weeks
from backend.services.prediction.feature_builder import FEATURE_NAMES, FeatureBuilder
from backend.services.prediction.margin_model import MarginModel
from backend.services.ratings.elo import POINTS_PER_ELO, EloConfig, EloRatingSystem
from backend.services.simulation.season_simulator import Fixture, SeasonSimulator

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s"
)
logger = logging.getLogger("conference_race")

OUT = Path(__file__).resolve().parent.parent / "data" / "predictions"

TRAIN_TYPES = (SEASON_TYPE_REGULAR, SEASON_TYPE_POSTSEASON)

# How many teams per conference the chart names. Sixteen lines is not a chart,
# it is a plaid; the rest fold into an explicit "field" series so the
# probabilities still sum to one and nothing is silently dropped.
#
# Three is also the number the palette validator allowed — every four-hue set
# the sibling project tried failed CVD separation.
NAMED_PER_CONFERENCE = 3

# The metric is the CONFERENCE title, not the Super Bowl, and that is a
# statement about the chart rather than about the sport. Conference-title
# probabilities sum to one inside a conference, so three named contenders plus
# an aggregated field account for the whole distribution and the caption can
# say "nothing is dropped" truthfully. Super Bowl probabilities sum to one
# across BOTH conferences, so the same chart drawn per conference would fold a
# tail whose size the reader cannot recover.
METRIC = "p_conference_title"


def _eastern_day(iso: str) -> str:
    """The Eastern calendar day of a UTC timestamp.

    Football's day boundary is Eastern — the league schedules in it and a
    Sunday night kickoff carries a Monday UTC date. Bucketing the tracker on
    UTC would file every Sunday-night publish under the wrong day.
    """
    when = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    return (when - timedelta(hours=5)).date().isoformat()


def _write(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2))
    tmp.replace(path)
    logger.info("wrote %s", path.name)


def _read(path: Path) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


# --------------------------------------------------------------- tracking


def track() -> int:
    """Append the currently published projection as one point on the line."""
    projections = _read(OUT / "season_projections.json")
    if not projections:
        logger.error("no published projection to track — run forecast_season first")
        return 1

    day = _eastern_day(projections["generated_at"])
    point = {
        "date": day,
        "generated_at": projections["generated_at"],
        "games_played": int(projections.get("games_played", 0)),
        "week": _week_of(projections),
        "probabilities": {},
    }
    teams: Dict[str, Dict[str, Any]] = {}
    for team in projections.get("teams", []):
        abbr = team["abbreviation"]
        point["probabilities"][abbr] = round(float(team.get(METRIC, 0.0)), 4)
        teams[abbr] = {
            "name": team.get("name"),
            "abbreviation": abbr,
            "conference": team.get("conference"),
            "division": team.get("division"),
        }

    path = OUT / "conference_race_current.json"
    existing = _read(path) or {}
    checkpoints = [
        c for c in existing.get("checkpoints", []) if c.get("date") != day
    ]
    # Same-season only. A new season starts a fresh line rather than
    # continuing last year's, which would draw an offseason discontinuity as
    # if it were a trend.
    if existing.get("season") not in (None, projections["season"]):
        logger.info(
            "season changed %s → %s: starting a new line",
            existing.get("season"), projections["season"],
        )
        checkpoints = []
    checkpoints.append(point)
    checkpoints.sort(key=lambda c: c["date"])

    _write(path, {
        "season": projections["season"],
        "basis": "live",
        "metric": METRIC,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "named_per_conference": NAMED_PER_CONFERENCE,
        "champion": None,
        "teams": {**(existing.get("teams") or {}), **teams},
        "checkpoints": checkpoints,
        "note": (
            "One point per day the forecast ran. These numbers were published "
            "in advance, unlike the season replays."
        ),
    })
    logger.info("tracked %s — %d point(s) on the line", day, len(checkpoints))
    return 0


def _week_of(projections: Dict[str, Any]) -> Optional[int]:
    """Which week the published projection was standing in, or None.

    Read from the games already banked rather than from the calendar: the
    projection is a fact about a corpus, and the corpus knows how much of the
    season it holds.
    """
    played = int(projections.get("games_played", 0))
    remaining = int(projections.get("games_remaining", 0))
    total = played + remaining
    if total <= 0:
        return None
    weeks = regular_season_weeks(int(projections["season"]))
    return int(round(played / (total / weeks)))


# ---------------------------------------------------------------- replay


def _fit_before(warehouse, season: int) -> MarginModel:
    """Fit the margin model on everything strictly earlier than `season`.

    Point-in-time by construction: the query never returns a game from the
    season being replayed, so there is no cutoff to get wrong.
    """
    rows = [r for r in warehouse.iter_games(season_types=TRAIN_TYPES)
            if int(r["season"]) < season]
    if len(rows) < 500:
        raise SystemExit(
            f"only {len(rows)} games before {season} — too few to fit against"
        )
    elo = EloRatingSystem(EloConfig())
    rated = elo.run(rows)

    builder = FeatureBuilder()
    builder.set_divisions(
        {int(t["team_id"]): t["division"] for t in warehouse.franchises()}
    )
    weeks_map = {s: regular_season_weeks(s) for s in range(2002, season + 1)}
    X, margins, totals, _meta = builder.build(
        rated, rows, weeks_in_season_for=weeks_map
    )
    model = MarginModel()
    params = model.fit(X, margins, totals, FEATURE_NAMES)
    logger.info(
        "fitted on %d games before %s: margin_sd %.3f",
        params.n_train, season, params.margin_sd,
    )
    return model


def _week_snapshots(
    warehouse, season: int, season_games: Sequence,
) -> Tuple[List[int], Dict[int, Dict[int, float]]]:
    """Elo at every week boundary of `season`, from ONE walk of the corpus.

    Re-running Elo from 2002 per checkpoint would be eighteen walks of six
    thousand games to produce the same eighteen snapshots.

    Checkpoint `w` is the rating state after every regular-season game of
    weeks 1..w has been absorbed, so checkpoint 0 is the state the season
    started from. **Checkpoint 0 has the offseason regression applied**,
    explicitly, at the season boundary — the rolling update would apply it
    lazily when the first game arrives, which is one game too late for a
    snapshot taken before that game.
    """
    weeks = sorted({int(r["week"]) for r in season_games})
    # The last game of weeks 1..w, in `iter_games` order. Compared by key
    # rather than by date so a week that ends with two games on one day
    # snapshots after both of them.
    last_of: Dict[int, Tuple[str, str]] = {}
    for week in weeks:
        upto = [r for r in season_games if int(r["week"]) <= week]
        last = max(upto, key=lambda r: (str(r["date_utc"]), str(r["game_id"])))
        last_of[week] = (str(last["date_utc"]), str(last["game_id"]))

    elo = EloRatingSystem(EloConfig())
    snapshots: Dict[int, Dict[int, float]] = {}
    pending = list(weeks)
    regressed = False
    previous = ""

    for row in warehouse.iter_games(season_types=TRAIN_TYPES):
        date_utc = str(row["date_utc"])
        if date_utc < previous:
            raise ValueError("warehouse returned games out of order")
        previous = date_utc

        if not regressed and int(row["season"]) >= season:
            elo.regress_to_season(season)
            snapshots[0] = elo.snapshot()
            regressed = True

        elo.update(
            game_id=row["game_id"],
            date_utc=date_utc,
            season=int(row["season"]),
            week=int(row["week"]),
            home_team_id=int(row["home_team_id"]),
            away_team_id=int(row["away_team_id"]),
            home_score=int(row["home_score"]),
            away_score=int(row["away_score"]),
            neutral=bool(row["neutral_site"]),
        )

        key = (date_utc, str(row["game_id"]))
        while pending and last_of[pending[0]] == key:
            snapshots[pending.pop(0)] = elo.snapshot()

    if 0 not in snapshots:
        raise SystemExit(f"no games at or after season {season}")
    for week in pending:
        snapshots[week] = elo.snapshot()
    return [0, *weeks], snapshots


def replay(season: int, *, sims: int) -> int:
    """Re-simulate a completed season at every week boundary."""
    warehouse = get_warehouse()
    franchises = {int(t["team_id"]): t for t in warehouse.franchises()}

    season_games = [
        r for r in warehouse.iter_games(
            seasons=[season], season_types=(SEASON_TYPE_REGULAR,)
        )
        if int(r["home_team_id"]) in franchises
        and int(r["away_team_id"]) in franchises
    ]
    # Every team plays one fewer game than there are weeks, because every team
    # has exactly one bye — 16 * (weeks - 1), not 16 * weeks. The tolerance
    # covers 2022, which is 271 rather than 272: Buffalo at Cincinnati was
    # abandoned after Damar Hamlin's cardiac arrest and never resumed.
    expected = 16 * (regular_season_weeks(season) - 1)
    if len(season_games) < expected - 2:
        logger.error(
            "season %s has %d regular-season games, expected about %d — "
            "refusing to replay a partial season",
            season, len(season_games), expected,
        )
        return 1

    model = _fit_before(warehouse, season)
    checkpoint_weeks, snapshots = _week_snapshots(warehouse, season, season_games)
    logger.info(
        "season %s: %d games, %d checkpoints, %d sims each",
        season, len(season_games), len(checkpoint_weeks), sims,
    )

    config = EloConfig()
    simulator = SeasonSimulator(simulations=sims)
    checkpoints: List[Dict[str, Any]] = []

    for week in checkpoint_weeks:
        ratings = snapshots[week]
        played = [dict(r) for r in season_games if int(r["week"]) <= week]
        remaining: List[Fixture] = []
        for row in season_games:
            if int(row["week"]) <= week:
                continue
            home, away = int(row["home_team_id"]), int(row["away_team_id"])
            forecast = model.predict_from_elo(
                ratings.get(home, config.base_rating),
                ratings.get(away, config.base_rating),
                neutral=bool(row["neutral_site"]),
                home_advantage_elo=config.home_advantage,
                points_per_elo=POINTS_PER_ELO,
            )
            remaining.append(Fixture(
                home_team_id=home,
                away_team_id=away,
                p_home=forecast.p_home,
                p_tie=forecast.p_tie,
                neutral=bool(row["neutral_site"]),
            ))

        teams_payload = [
            {
                "team_id": tid,
                "display_name": t["display_name"],
                "abbreviation": t["abbreviation"],
                "conference": t["conference"],
                "division": t["division"],
                "elo": ratings.get(tid, config.base_rating),
            }
            for tid, t in franchises.items()
        ]
        result = simulator.run(
            season, teams_payload, played, remaining,
            generated_at=f"{season}-W{week:02d}",
        )
        checkpoints.append({
            "date": _label_date(season_games, week),
            "week": week,
            "games_played": len(played),
            "probabilities": {
                t.abbreviation: round(getattr(t, METRIC), 4) for t in result.teams
            },
        })
        logger.info("  week %2d — %3d games banked", week, len(played))

    champion, champion_conference = _champion(warehouse, season, franchises)
    _write(OUT / f"conference_race_{season}.json", {
        "season": season,
        "basis": "backtest",
        "metric": METRIC,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "simulations": sims,
        "named_per_conference": NAMED_PER_CONFERENCE,
        "champion": champion,
        "champion_conference": champion_conference,
        "teams": {
            t["abbreviation"]: {
                "name": t["display_name"],
                "abbreviation": t["abbreviation"],
                "conference": t["conference"],
                "division": t["division"],
            }
            for t in franchises.values()
        },
        "checkpoints": checkpoints,
        "note": (
            "A reconstruction. Ratings at each week boundary were built from "
            "games strictly earlier than it, so the model never saw the "
            "future — but nobody read these numbers on those dates. Remaining "
            "fixtures are priced from ratings alone, not through the feature "
            "vector the live forecast uses."
        ),
    })
    return 0


def _label_date(season_games: Sequence, week: int) -> str:
    """The date a checkpoint stands on: the last kickoff it has absorbed.

    Week 0 stands on the day before the opener rather than on the opener
    itself — it is the state BEFORE that game, and stamping it with the
    opener's date would put two checkpoints on one day.
    """
    if week <= 0:
        first = min(str(r["date_utc"]) for r in season_games)[:10]
        return (
            datetime.fromisoformat(first) - timedelta(days=1)
        ).date().isoformat()
    return max(
        str(r["date_utc"])[:10]
        for r in season_games
        if int(r["week"]) <= week
    )


def _champion(
    warehouse, season: int, franchises: Dict[int, Any],
) -> Tuple[Optional[str], Optional[str]]:
    """Whoever won the last postseason game of the season."""
    rows = list(warehouse.iter_games(
        seasons=[season], season_types=(SEASON_TYPE_POSTSEASON,)
    ))
    if not rows:
        return None, None
    last = rows[-1]
    winner = (
        int(last["home_team_id"])
        if last["home_score"] > last["away_score"]
        else int(last["away_team_id"])
    )
    team = franchises.get(winner)
    if not team:
        return None, None
    return team["abbreviation"], team["conference"]


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--track", action="store_true")
    parser.add_argument("--replay", type=int, default=None)
    parser.add_argument("--sims", type=int, default=4000)
    args = parser.parse_args(argv)

    if args.track:
        return track()
    if args.replay:
        return replay(args.replay, sims=args.sims)
    parser.error("pass --track or --replay SEASON")
    return 2


if __name__ == "__main__":
    sys.exit(main())
