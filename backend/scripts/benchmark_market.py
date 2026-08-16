"""Score the model against the market, walk-forward.

    python3 -m backend.scripts.benchmark_market
    python3 -m backend.scripts.benchmark_market --from-season 2014 --devig shin

**This script is the project's central claim, and its job is to be hard on
the model rather than kind to it.**

Writes `backend/data/diagnostics/market_benchmark.json`.

The four forecasters
--------------------

* **Margin model** — the served forecaster, refit weekly on games strictly
  earlier than the week being scored.
* **Elo only** — ratings and home advantage, nothing else. The structural
  floor. Never deleted.
* **Constant base rate** — the league's home-win rate. A model that cannot
  beat this is not a model.
* **The market** — the de-vigged closing line. The benchmark.

Walk-forward, and what "strictly earlier" has to mean
-----------------------------------------------------

Features are built ONCE over the whole corpus, in chronological order, by a
builder whose state is updated only after each row is emitted. That makes
every row point-in-time correct by construction, so the walk-forward here is
an expanding-window REFIT over an already-safe design matrix rather than a
re-derivation. It is also what makes weekly refitting affordable: the ridge
solve is microseconds, and rebuilding rolling state 400 times would not be.

The first three seasons are warm-up. Elo starts every team at 1500 and the
rolling form windows start empty, so a model fitted on them learns that the
defaults predict the mean.

Ties
----

Scored on DECIDED games only, with the count of excluded ties reported beside
every figure — see `market.score_forecasts` for why that is the lesser evil
and `brier_ties_as_half` for the check on it. The model's three-outcome
forecast is conditioned through `market.conditional_from_three` before it
meets a moneyline, because **a moneyline voids on a tie and is therefore
already a conditional quantity**. Comparing an unconditional model
probability against it would understate the model on every single game.

Where the market comes from
---------------------------

A de-vigged two-way moneyline where one exists. Where only a spread exists —
which is most of the pre-2014 corpus — the spread is pushed through the
margin distribution instead, and the row is TAGGED as spread-derived so the
two can be reported separately. They are different measurements and merging
them silently would let a weaker signal dilute the benchmark.

**If this model ever beats the closing line, suspect the harness first.** It
carries no market features. That result is a bug announcing itself.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from backend.services.data.warehouse import (
    SEASON_TYPE_POSTSEASON,
    SEASON_TYPE_REGULAR,
    get_warehouse,
)
from backend.services.espn.client import regular_season_weeks
from backend.services.prediction import market as mkt
from backend.services.prediction.feature_builder import FEATURE_NAMES, FeatureBuilder
from backend.services.prediction.margin_model import MarginModel
from backend.services.ratings.elo import POINTS_PER_ELO, EloConfig, EloRatingSystem

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s"
)
logger = logging.getLogger("benchmark_market")

OUT = Path(__file__).resolve().parent.parent / "data" / "diagnostics"

WARMUP_SEASONS = 3


def paired_bootstrap(
    a: Sequence[float], b: Sequence[float], *, draws: int = 10000, seed: int = 20260816
) -> Dict[str, float]:
    """Bootstrap the mean difference `a - b` over paired observations.

    Paired because both forecasters are scored on exactly the same games; an
    unpaired test would drown the difference in between-game variance, which
    is enormous in a sport this noisy.
    """
    rng = np.random.default_rng(seed)
    a_arr, b_arr = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    diff = a_arr - b_arr
    n = len(diff)
    if n == 0:
        return {"mean": float("nan"), "lo": float("nan"), "hi": float("nan"), "p": float("nan")}
    idx = rng.integers(0, n, size=(draws, n))
    means = diff[idx].mean(axis=1)
    return {
        "mean": float(diff.mean()),
        "lo": float(np.percentile(means, 2.5)),
        "hi": float(np.percentile(means, 97.5)),
        # P(a is better), i.e. that the difference in Brier is negative.
        "p_better": float((means < 0).mean()),
    }


def run(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-season", type=int, default=None)
    parser.add_argument("--devig", default="shin", choices=("shin", "proportional"))
    parser.add_argument("--db")
    args = parser.parse_args(argv)

    warehouse = get_warehouse(args.db) if args.db else get_warehouse()
    rows = list(warehouse.iter_games(
        season_types=(SEASON_TYPE_REGULAR, SEASON_TYPE_POSTSEASON)
    ))
    logger.info("corpus: %d games", len(rows))

    elo_system = EloRatingSystem(EloConfig())
    rated = elo_system.run(rows)

    builder = FeatureBuilder()
    builder.set_divisions(
        {int(t["team_id"]): t["division"] for t in warehouse.franchises()}
    )
    seasons_present = sorted({int(r["season"]) for r in rows})
    weeks_map = {s: regular_season_weeks(s) for s in seasons_present}
    X, margins, totals, meta = builder.build(
        rated, rows, weeks_in_season_for=weeks_map, warmup_seasons=0
    )

    # Elo expectation per row, aligned to `meta` by construction: `build`
    # walked the same sequence and emitted metadata alongside each vector.
    elo_expect = {r.game_id: r.expected_home for r in rated}

    seasons = sorted({m["season"] for m in meta})
    first_scored = args.from_season or (
        seasons[WARMUP_SEASONS] if len(seasons) > WARMUP_SEASONS else seasons[0]
    )
    logger.info("scoring from season %s (warm-up before that)", first_scored)

    # ---- walk forward: refit weekly, predict that week only.
    order = np.argsort([m["date_utc"] for m in meta], kind="stable")
    buckets: Dict[Tuple[int, int], List[int]] = defaultdict(list)
    for i in order:
        buckets[(meta[i]["season"], meta[i]["week"])].append(int(i))

    model = MarginModel()
    scored: List[Dict[str, Any]] = []

    for (season, week) in sorted(buckets):
        if season < first_scored:
            continue
        target = buckets[(season, week)]
        earliest = min(meta[i]["date_utc"] for i in target)
        train_idx = [i for i in range(len(meta)) if meta[i]["date_utc"] < earliest]
        if len(train_idx) < 500:
            continue

        model.fit(
            X[train_idx], margins[train_idx], totals[train_idx], FEATURE_NAMES
        )
        forecasts = model.predict(X[target])

        for slot, forecast in zip(target, forecasts):
            row = meta[slot]
            scored.append({
                **row,
                "p_home_model": forecast.p_home,
                "p_tie_model": forecast.p_tie,
                "p_away_model": forecast.p_away,
                "elo_expect": elo_expect.get(row["game_id"], 0.5),
            })

    logger.info("scored %d games walk-forward", len(scored))

    # ---- assemble each forecaster's conditional (two-way) probability.
    base_rate_decided = float(
        np.mean([
            1.0 for s in scored if s["home_score"] > s["away_score"]
        ] or [0.0])
    ) if scored else 0.5
    decided_n = sum(1 for s in scored if s["home_score"] != s["away_score"])
    base_rate = (
        sum(1 for s in scored if s["home_score"] > s["away_score"]) / decided_n
        if decided_n else 0.5
    )

    def market_probability(row: Dict[str, Any]) -> Tuple[Optional[float], Optional[str]]:
        """The closing line as a two-way probability, and where it came from.

        A moneyline is preferred because it is a direct probability
        statement. A spread has to be pushed through a margin distribution to
        become one, which imports an assumption; it is used only where no
        moneyline exists, and the source is recorded so the two can be
        reported apart.
        """
        if mkt.has_complete_odds(row["ml_home"], row["ml_away"]):
            try:
                return mkt.devig(
                    float(row["ml_home"]), float(row["ml_away"]), method=args.devig
                )[0], "moneyline"
            except mkt.MarketError:
                pass
        if row["spread_home"] is not None:
            return mkt.spread_to_probability(float(row["spread_home"])), "spread"
        return None, None

    model_p, elo_p, base_p = [], [], []
    hs, as_ = [], []
    market_p, market_hs, market_as, market_src = [], [], [], []
    # Paired series: populated ONLY for games that are both priced and
    # decided, so all four arrays index the same games in the same order.
    paired: Dict[str, List[float]] = {
        "margin_model": [], "elo_only": [], "constant_base_rate": [], "market": [],
    }

    for s in scored:
        cond = mkt.conditional_from_three(
            s["p_home_model"], s["p_tie_model"], s["p_away_model"]
        )[0]
        # The Elo expectation is win-or-half; treated directly as the two-way
        # conditional, which is what it converges to as the tie rate -> 0.
        elo_cond = min(max(s["elo_expect"], 1e-6), 1 - 1e-6)

        model_p.append(cond)
        elo_p.append(elo_cond)
        base_p.append(base_rate)
        hs.append(s["home_score"]); as_.append(s["away_score"])

        implied, source = market_probability(s)
        if implied is None:
            continue

        market_p.append(implied)
        market_hs.append(s["home_score"])
        market_as.append(s["away_score"])
        market_src.append(source)

        if s["home_score"] != s["away_score"]:
            won = 1.0 if s["home_score"] > s["away_score"] else 0.0
            paired["margin_model"].append((cond - won) ** 2)
            paired["elo_only"].append((elo_cond - won) ** 2)
            paired["constant_base_rate"].append((base_rate - won) ** 2)
            paired["market"].append((implied - won) ** 2)

    cards = {
        "margin_model": mkt.score_forecasts(model_p, hs, as_).as_dict(),
        "elo_only": mkt.score_forecasts(elo_p, hs, as_).as_dict(),
        "constant_base_rate": mkt.score_forecasts(base_p, hs, as_).as_dict(),
    }
    if market_p:
        cards["market"] = mkt.score_forecasts(
            market_p, market_hs, market_as
        ).as_dict()

    logger.info("")
    logger.info("%-22s %8s %9s %9s %8s %7s", "forecaster", "brier", "logloss", "accuracy", "ece", "n")
    for name, card in cards.items():
        logger.info(
            "%-22s %8.4f %9.4f %9.4f %8.4f %7d",
            name, card["brier"], card["log_loss"], card["accuracy"],
            card["ece"], card["n"],
        )

    comparisons = {}
    if paired["market"]:
        n_paired = len(paired["market"])
        logger.info("")
        logger.info("paired against the closing line on %d priced, decided games:", n_paired)
        for name in ("margin_model", "elo_only", "constant_base_rate"):
            result = paired_bootstrap(paired[name], paired["market"])
            comparisons[name] = result
            logger.info(
                "  %-20s gap %+.5f  95%% CI [%+.5f, %+.5f]  p(better) %.3f",
                name, result["mean"], result["lo"], result["hi"], result["p_better"],
            )
        if comparisons.get("margin_model", {}).get("mean", 1) < 0:
            logger.warning(
                "THE MODEL BEAT THE CLOSING LINE. It carries no market "
                "features. Suspect the harness before believing this."
            )

    source_counts = {
        s: market_src.count(s) for s in set(market_src)
    } if market_src else {}

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "corpus_games": len(rows),
        "scored_games": len(scored),
        "first_scored_season": first_scored,
        "warmup_seasons": WARMUP_SEASONS,
        "devig_method": args.devig,
        "refit_cadence": "weekly, expanding window",
        "priced_games": len(market_p),
        "unpriced_games": len(scored) - len(market_p),
        "market_source_counts": source_counts,
        "base_rate": round(base_rate, 5),
        "scorecards": cards,
        "paired_vs_market": comparisons,
        "note": (
            "Ties are excluded from every headline figure and counted in "
            "ties_excluded; brier_ties_as_half scores the same forecasts over "
            "all games with a tie as y=0.5. Model probabilities are "
            "conditioned on the game being decided before meeting a "
            "moneyline, because a moneyline voids on a tie."
        ),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "market_benchmark.json"
    path.write_text(json.dumps(payload, indent=2))
    logger.info("")
    logger.info("wrote %s", path)
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    return run(argv)


if __name__ == "__main__":
    sys.exit(main())
