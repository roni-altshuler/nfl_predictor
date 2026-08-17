"""Publish the context a game page and the head-to-head predictor need.

    python3 -m backend.scripts.build_game_context

Writes to `backend/data/predictions/`:

* `game_context.json` — the last meetings between every pair of franchises,
  each team's recent form, and current-season records
* `matchups.json`    — **every ordered pair of franchises, pre-priced**

Why every pair is precomputed
-----------------------------

992 ordered pairs (32 x 31) is a small file, and shipping it whole means the
head-to-head page needs no server round-trip, works offline, and — the part
that matters — **cannot disagree with the game forecasts.** A page that
computed a matchup on demand would be a second inference path: same model,
different code, free to drift. The sibling NBA project makes the same call
for the same reason.

The pairs are priced through `FeatureBuilder.vector_for`, the identical
serving path `forecast_season` uses. A hypothetical matchup has no kickoff,
so rest is neutral for both sides and the week is the season opener's — those
are stated on the page rather than hidden, because "what would happen if
these two met" has no answer without assuming a date.

Why the game page's context is published rather than queried
------------------------------------------------------------

The frontend reads static JSON and never touches the warehouse — the
warehouse is gitignored, rebuilt from ESPN, and absent on the machine that
builds the site. Anything a page needs has to be an artifact.
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

import numpy as np

from backend.services.data.warehouse import (
    SEASON_TYPE_POSTSEASON,
    SEASON_TYPE_REGULAR,
    Warehouse,
    get_warehouse,
)
from backend.services.espn.client import current_season, regular_season_weeks
from backend.services.prediction.feature_builder import FEATURE_NAMES, FeatureBuilder
from backend.services.prediction.margin_model import MarginModel
from backend.services.ratings.elo import EloConfig, EloRatingSystem

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s"
)
logger = logging.getLogger("build_game_context")

OUT = Path(__file__).resolve().parent.parent / "data" / "predictions"

# How many previous meetings and recent results to publish per pair/team.
MEETINGS = 8
FORM = 10


def _write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")))
    tmp.replace(path)
    logger.info("wrote %s (%.0f KB)", path.name, path.stat().st_size / 1024)


def run(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--db")
    args = parser.parse_args(argv)

    season = args.season or current_season()
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    warehouse: Warehouse = get_warehouse(args.db) if args.db else get_warehouse()

    franchises = warehouse.franchises()
    by_id = {int(t["team_id"]): t for t in franchises}
    abbr = {int(t["team_id"]): t["abbreviation"] for t in franchises}

    rows = list(warehouse.iter_games(
        season_types=(SEASON_TYPE_REGULAR, SEASON_TYPE_POSTSEASON)
    ))
    logger.info("reading %d played games", len(rows))

    # ---- head-to-head, keyed on the unordered pair
    meetings: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    form: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    for row in rows:
        home, away = int(row["home_team_id"]), int(row["away_team_id"])
        if home not in abbr or away not in abbr:
            continue
        hs, as_ = int(row["home_score"]), int(row["away_score"])
        entry = {
            "game_id": row["game_id"],
            "date": row["date_utc"][:10],
            "season": int(row["season"]),
            "week": int(row["week"]),
            "home": abbr[home],
            "away": abbr[away],
            "home_score": hs,
            "away_score": as_,
            "postseason": int(row["season_type"]) == SEASON_TYPE_POSTSEASON,
            "round": row["postseason_round"],
            "neutral": bool(row["neutral_site"]),
        }
        key = "|".join(sorted((abbr[home], abbr[away])))
        meetings[key].append(entry)

        for team, opponent, scored, allowed, at_home in (
            (home, away, hs, as_, True),
            (away, home, as_, hs, False),
        ):
            form[abbr[team]].append({
                "game_id": row["game_id"],
                "date": row["date_utc"][:10],
                "season": int(row["season"]),
                "week": int(row["week"]),
                "opponent": abbr[opponent],
                "home": at_home,
                "scored": scored,
                "allowed": allowed,
                "result": "T" if scored == allowed else ("W" if scored > allowed else "L"),
            })

    # `iter_games` is chronological, so the tail is the most recent.
    meetings_out = {
        key: value[-MEETINGS:][::-1] for key, value in meetings.items()
    }
    form_out = {key: value[-FORM:][::-1] for key, value in form.items()}

    # ---- current-season records, for the page header
    records: Dict[str, Dict[str, Any]] = {}
    for team_id, team in by_id.items():
        played = [
            g for g in form_out.get(abbr[team_id], [])
            if g["season"] == season
        ]
        wins = sum(1 for g in played if g["result"] == "W")
        losses = sum(1 for g in played if g["result"] == "L")
        ties = sum(1 for g in played if g["result"] == "T")
        records[abbr[team_id]] = {
            "name": team["display_name"],
            "conference": team["conference"],
            "division": team["division"],
            "wins": wins,
            "losses": losses,
            "ties": ties,
        }

    _write(OUT / "game_context.json", {
        "season": season,
        "generated_at": generated_at,
        "meetings_per_pair": MEETINGS,
        "form_per_team": FORM,
        "records": records,
        "meetings": meetings_out,
        "form": form_out,
    })

    # ---- every ordered pair, priced through the SERVING path
    elo = EloRatingSystem(EloConfig())
    rated = elo.run(rows)

    builder = FeatureBuilder()
    builder.set_divisions({int(t["team_id"]): t["division"] for t in franchises})
    weeks_map = {s: regular_season_weeks(s) for s in range(2002, season + 2)}
    X, margins, totals, _meta = builder.build(
        rated, rows, weeks_in_season_for=weeks_map
    )

    model = MarginModel()
    model.fit(X, margins, totals, FEATURE_NAMES)

    # The offseason regression, for the same reason `forecast_season` applies
    # it: these ratings describe a season that has not started.
    elo.regress_to_season(season)

    # A hypothetical matchup has no date. Rest is neutral for both sides
    # (which `vector_for` gives when a team has no recorded last game in
    # range) and the week is week 1. Stated on the page, not hidden.
    kickoff = datetime(season, 9, 10, tzinfo=timezone.utc)
    neutral_builder = FeatureBuilder()
    neutral_builder.set_divisions(
        {int(t["team_id"]): t["division"] for t in franchises}
    )

    pairs: List[Dict[str, Any]] = []
    ids = list(by_id)
    for home in ids:
        for away in ids:
            if home == away:
                continue
            vector = neutral_builder.vector_for(
                home_team_id=home,
                away_team_id=away,
                home_elo=elo.get(home),
                away_elo=elo.get(away),
                kickoff=kickoff,
                week=1,
                weeks_in_season=weeks_map.get(season, 18),
                neutral_site=False,
            )
            forecast = model.predict(vector[None, :])[0]
            pairs.append({
                "home": abbr[home],
                "away": abbr[away],
                "p_home": round(forecast.p_home, 5),
                "p_tie": round(forecast.p_tie, 5),
                "p_away": round(forecast.p_away, 5),
                "exp_margin": round(forecast.exp_margin, 2),
                "exp_total": round(forecast.exp_total, 2),
                "exp_home_score": round(forecast.exp_home_score, 2),
                "exp_away_score": round(forecast.exp_away_score, 2),
                # The two key numbers only, not the whole surface.
                #
                # `MatchupPicker` is a client component, so everything in this
                # file is serialised into the page payload and shipped to the
                # browser. A full 13-line spread surface per pair took the
                # file to 1.1MB — for a picker that displays ONE pair at a
                # time. Three and seven are the two lines football actually
                # trades on and the two the lattice has something to say
                # about; the rest is available on a real fixture's page,
                # where it costs one game's worth of bytes rather than 992.
                "key_spreads": forecast.spread_surface([-3.0, -7.0]),
            })

    # Which pairs actually meet this season, so the page can link a
    # hypothetical straight to the real fixture.
    scheduled: Dict[str, Dict[str, Any]] = {}
    for row in warehouse.iter_scheduled(seasons=(season,)):
        home, away = int(row["home_team_id"]), int(row["away_team_id"])
        if home in abbr and away in abbr:
            scheduled[f"{abbr[home]}|{abbr[away]}"] = {
                "game_id": row["game_id"],
                "date": row["date_utc"],
                "week": int(row["week"]),
            }

    _write(OUT / "matchups.json", {
        "season": season,
        "generated_at": generated_at,
        "basis": "neutral week-1 conditions, home venue",
        "note": (
            "Every ordered pair is priced through the same serving path the "
            "game forecasts use. A hypothetical meeting has no date, so rest "
            "is neutral for both sides and the week is the opener."
        ),
        "teams": [
            {
                "abbreviation": abbr[t],
                "name": by_id[t]["display_name"],
                "conference": by_id[t]["conference"],
                "division": by_id[t]["division"],
            }
            for t in sorted(ids, key=lambda t: by_id[t]["display_name"])
        ],
        "elo": {abbr[t]: round(elo.get(t), 1) for t in ids},
        "scheduled": scheduled,
        "matchups": pairs,
    })

    logger.info("priced %d ordered pairs", len(pairs))
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    return run(argv)


if __name__ == "__main__":
    sys.exit(main())
