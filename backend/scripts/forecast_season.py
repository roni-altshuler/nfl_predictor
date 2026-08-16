"""Publish the forecast artifacts the frontend reads.

    python3 -m backend.scripts.forecast_season --sims 20000
    python3 -m backend.scripts.forecast_season --season 2026 --sims 5000

Writes to `backend/data/predictions/`:

* `game_forecasts.json`   — every remaining fixture, priced
* `season_projections.json` — the Monte Carlo output per franchise
* `power_ratings.json`    — current Elo, by team
* `playoff_picture.json`  — modal seeding and round-by-round probabilities

Two things here are easy to get wrong and expensive to get wrong
----------------------------------------------------------------

1. **`regress_to_season` must be called, and only here.** Elo applies its
   offseason carryover lazily, when the first game of a new season arrives.
   That is correct while walking a corpus and wrong the moment you stop
   walking and start projecting: this script fits on every game ever played
   and then asks for ratings for a season whose first game does not exist
   yet. Without the explicit call, the projection runs on END-OF-LAST-SEASON
   ratings and skips the single most valuable Elo setting the sweep found.
   **A forecaster must call it; a backtest must not.**

2. **The serving path is `FeatureBuilder.vector_for`, never
   `predict_from_elo`.** The sibling NBA project shipped a bug where the
   forecaster called the ratings-only shortcut against a 19-feature model, so
   eighteen features fell back to the intercept and it published an expected
   total of 14.1 points. That was caught only because a basketball game
   obviously does not end 6-8. The football version of the same bug publishes
   a total near 44 and a margin near 2 — completely plausible, and wrong.

   So this script does not rely on anyone noticing. It builds the served
   design matrix, compares it against the training matrix with
   `dead_feature_blocks`, and **refuses to write** if any feature that varies
   in training is constant at serving time.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
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
from backend.services.playoffs.bracket import seeds_per_conference
from backend.services.prediction.feature_builder import (
    FEATURE_NAMES,
    FeatureBuilder,
    constant_features,
    dead_feature_blocks,
)
from backend.services.prediction.margin_model import MarginModel
from backend.services.ratings.elo import EloConfig, EloRatingSystem
from backend.services.simulation.season_simulator import Fixture, SeasonSimulator

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s"
)
logger = logging.getLogger("forecast_season")

OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "predictions"
MODEL_VERSION = "nfl-margin-lattice-1"


def _write(path: Path, payload: Any) -> None:
    """Atomic write, so a crash leaves the previous artifact serving."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2))
    tmp.replace(path)
    logger.info("wrote %s", path.name)


def run(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--sims", type=int, default=20000)
    parser.add_argument("--db")
    args = parser.parse_args(argv)

    season = args.season or current_season()
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    warehouse: Warehouse = get_warehouse(args.db) if args.db else get_warehouse()

    # ---- 1. fit on everything that has been played
    rows = list(warehouse.iter_games(
        season_types=(SEASON_TYPE_REGULAR, SEASON_TYPE_POSTSEASON)
    ))
    logger.info("fitting on %d played games", len(rows))

    elo = EloRatingSystem(EloConfig())
    rated = elo.run(rows)

    franchises = warehouse.franchises()
    divisions = {int(t["team_id"]): t["division"] for t in franchises}

    builder = FeatureBuilder()
    builder.set_divisions(divisions)
    weeks_map = {s: regular_season_weeks(s) for s in range(2002, season + 2)}
    X, margins, totals, _meta = builder.build(
        rated, rows, weeks_in_season_for=weeks_map
    )

    dead_in_training = constant_features(X)
    if dead_in_training:
        logger.error("features constant in TRAINING: %s", dead_in_training)
        return 1

    model = MarginModel()
    params = model.fit(X, margins, totals, FEATURE_NAMES)
    logger.info(
        "fitted on %d games: margin_sd %.3f, total_sd %.3f, home advantage %+.2f pts",
        params.n_train, params.margin_sd, params.total_sd, model._margin_coef[0],
    )

    # ---- 2. the offseason regression. Forecaster-only. See the docstring.
    if elo.regress_to_season(season):
        logger.info(
            "applied offseason regression to %s at carryover %.2f",
            season, elo.config.carryover,
        )

    # ---- 3. price every remaining fixture, through the SERVING path
    fixtures = list(warehouse.iter_scheduled(seasons=(season,)))
    logger.info("pricing %d remaining fixtures", len(fixtures))

    served_vectors: List[np.ndarray] = []
    forecasts: List[Dict[str, Any]] = []
    sim_fixtures: List[Fixture] = []

    team_rows = {int(t["team_id"]): t for t in franchises}

    for row in fixtures:
        home_id, away_id = int(row["home_team_id"]), int(row["away_team_id"])
        if home_id not in team_rows or away_id not in team_rows:
            continue
        kickoff = datetime.fromisoformat(str(row["date_utc"]).replace("Z", "+00:00"))
        vector = builder.vector_for(
            home_team_id=home_id,
            away_team_id=away_id,
            home_elo=elo.get(home_id),
            away_elo=elo.get(away_id),
            kickoff=kickoff,
            week=int(row["week"]),
            weeks_in_season=weeks_map.get(season, 18),
            neutral_site=bool(row["neutral_site"]),
        )
        served_vectors.append(vector)
        forecast = model.predict(vector[None, :])[0]

        forecasts.append({
            "game_id": row["game_id"],
            "season": season,
            "week": int(row["week"]),
            "date_utc": row["date_utc"],
            "home_team_id": home_id,
            "away_team_id": away_id,
            "home": team_rows[home_id]["abbreviation"],
            "away": team_rows[away_id]["abbreviation"],
            "neutral_site": bool(row["neutral_site"]),
            "venue": row["venue"],
            **forecast.as_dict(),
            "market": {
                "ml_home": row["ml_home"],
                "ml_away": row["ml_away"],
                "spread_home": row["spread_home"],
                "total_points": row["total_points"],
                "provider": row["odds_provider"],
            },
        })
        sim_fixtures.append(Fixture(
            home_team_id=home_id,
            away_team_id=away_id,
            p_home=forecast.p_home,
            p_tie=forecast.p_tie,
            neutral=bool(row["neutral_site"]),
        ))

        # Advance the schedule clock. `iter_scheduled` yields in date order,
        # so this makes week 5's rest measure from week 4 rather than from
        # the team's last real game months ago. Without it every fixture in
        # the season sees the same offseason gap and `rest_diff` is
        # identically zero — which `dead_feature_blocks` catches, loudly.
        builder.observe_scheduled(home_id, away_id, kickoff)

    # ---- 4. the train/serve guard. Refuse to publish a hollow model.
    if served_vectors:
        served = np.vstack(served_vectors)
        dead = dead_feature_blocks(X, served, FEATURE_NAMES)
        if dead:
            logger.error(
                "TRAIN/SERVE SKEW: %s vary in training and are constant at "
                "serving time. These features are falling back to the "
                "intercept. Refusing to publish.", dead,
            )
            return 1
        logger.info("train/serve check passed on %d features", served.shape[1])

    # ---- 5. simulate the season
    played = [
        dict(r) for r in warehouse.iter_games(
            seasons=(season,), season_types=(SEASON_TYPE_REGULAR,)
        )
    ]
    teams_payload = [
        {
            "team_id": int(t["team_id"]),
            "display_name": t["display_name"],
            "abbreviation": t["abbreviation"],
            "conference": t["conference"],
            "division": t["division"],
            "elo": elo.get(int(t["team_id"])),
        }
        for t in franchises
    ]

    simulator = SeasonSimulator(simulations=args.sims)
    result = simulator.run(
        season, teams_payload, played,
        [f for f in sim_fixtures],
        generated_at=generated_at,
    )
    logger.info(
        "simulated %d seasons: %d played, %d remaining",
        args.sims, result.games_played, result.games_remaining,
    )

    # ---- 6. publish
    _write(OUT_DIR / "game_forecasts.json", {
        "season": season,
        "generated_at": generated_at,
        "model_version": MODEL_VERSION,
        "season_start": min(
            (f["date_utc"] for f in forecasts), default=None
        ),
        "weeks_in_season": weeks_map.get(season, 18),
        "games": forecasts,
    })

    _write(OUT_DIR / "season_projections.json", {
        **result.as_dict(),
        "model_version": MODEL_VERSION,
        "seeds_per_conference": seeds_per_conference(season),
    })

    _write(OUT_DIR / "power_ratings.json", {
        "season": season,
        "generated_at": generated_at,
        "carryover_applied": True,
        "teams": sorted(
            [
                {
                    "team_id": int(t["team_id"]),
                    "name": t["display_name"],
                    "abbreviation": t["abbreviation"],
                    "conference": t["conference"],
                    "division": t["division"],
                    "elo": round(elo.get(int(t["team_id"])), 1),
                }
                for t in franchises
            ],
            key=lambda t: -t["elo"],
        ),
    })

    _write(OUT_DIR / "playoff_picture.json", {
        "season": season,
        "generated_at": generated_at,
        "seeds_per_conference": seeds_per_conference(season),
        "byes_per_conference": 1 if season >= 2020 else 2,
        "conferences": {
            conf: [
                {
                    "team_id": t.team_id,
                    "abbreviation": t.abbreviation,
                    "name": t.name,
                    "division": t.division,
                    "wins": round(t.wins, 1),
                    "losses": round(t.losses, 1),
                    "p_division": round(t.p_division, 4),
                    "p_playoffs": round(t.p_playoffs, 4),
                    "p_bye": round(t.p_bye, 4),
                    "p_conference_title": round(t.p_conference_title, 4),
                    "p_championship": round(t.p_championship, 4),
                    "seed_distribution": {
                        str(k): round(v, 4) for k, v in t.seed_distribution.items()
                    },
                }
                for t in sorted(
                    [x for x in result.teams if x.conference == conf],
                    key=lambda x: -x.p_playoffs,
                )
            ]
            for conf in sorted({t.conference for t in result.teams if t.conference})
        },
    })

    # ---- 7. record what was claimed, in advance. See `record_predictions`.
    warehouse.record_predictions([
        {
            "fixture_uid": f["game_id"],
            "generated_at": generated_at,
            "model_version": MODEL_VERSION,
            "competition_id": "nfl",
            "season": season,
            "week": f["week"],
            "kickoff_utc": f["date_utc"],
            "home_team": f["home"],
            "away_team": f["away"],
            "p_home": f["p_home"],
            "p_away": f["p_away"],
            "p_tie": f["p_tie"],
            "exp_margin": f["exp_margin"],
            "exp_total": f["exp_total"],
        }
        for f in forecasts
    ])
    logger.info("recorded %d pre-kickoff forecasts", len(forecasts))
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    return run(argv)


if __name__ == "__main__":
    sys.exit(main())
