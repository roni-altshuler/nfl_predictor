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

# Reliability and PIT bins. Ten is the convention and it is a real trade-off:
# fewer bins hide the shape of a miscalibration, more bins put so few games in
# each that the observed rate is noise.
BINS = 10

# The nominal interval levels the coverage check reports.
COVERAGE_LEVELS = (0.50, 0.80, 0.95)


def reliability(
    probabilities: Sequence[float], outcomes: Sequence[float], bins: int = BINS
) -> List[Dict[str, float]]:
    """Bucket forecasts by what they said and report what happened.

    **Empty buckets are dropped, not zeroed.** A bucket holding no games has
    no observed rate; publishing 0.0 for it would draw a point on the floor of
    the reliability diagram that reads as catastrophic miscalibration and is
    actually an absence of evidence.
    """
    out: List[Dict[str, float]] = []
    p = np.asarray(probabilities, dtype=float)
    y = np.asarray(outcomes, dtype=float)
    if p.size == 0:
        return out
    edges = np.linspace(0.0, 1.0, bins + 1)
    for i in range(bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (p >= lo) & (p < hi) if i < bins - 1 else (p >= lo) & (p <= hi)
        count = int(mask.sum())
        if count == 0:
            continue
        out.append({
            "lower": round(float(lo), 3),
            "upper": round(float(hi), 3),
            "count": count,
            "mean_predicted": round(float(p[mask].mean()), 4),
            "observed": round(float(y[mask].mean()), 4),
        })
    return out


def pit_histogram(values: Sequence[float], bins: int = BINS) -> Dict[str, Any]:
    """The PIT in deciles, plus a chi-square statistic and NO p-value.

    **The missing p-value is deliberate.** At n in the thousands any real
    model fails a goodness-of-fit test on some decimal place, so `p < .001`
    printed beside a visibly flat histogram would be true and completely
    misleading. Chi-square per degree of freedom is reported instead: it is
    roughly 1 when the histogram is as flat as sampling noise allows, and it
    grows with the size of a real departure rather than with n alone.
    """
    v = np.asarray(values, dtype=float)
    v = v[np.isfinite(v)]
    n = int(v.size)
    if n == 0:
        return {"n": 0, "buckets": [], "chi_square": None, "chi_square_per_dof": None}

    edges = np.linspace(0.0, 1.0, bins + 1)
    counts, _ = np.histogram(np.clip(v, 0.0, 1.0), bins=edges)
    expected = n / bins
    chi = float(((counts - expected) ** 2 / expected).sum())
    buckets = [
        {
            "lower": round(float(edges[i]), 2),
            "upper": round(float(edges[i + 1]), 2),
            "count": int(counts[i]),
            "share": round(float(counts[i] / n), 4),
            "expected": round(1.0 / bins, 4),
        }
        for i in range(bins)
    ]
    dof = bins - 1
    return {
        "n": n,
        "buckets": buckets,
        "chi_square": round(chi, 2),
        "dof": dof,
        "chi_square_per_dof": round(chi / dof, 3),
        "max_abs_deviation": round(
            float(np.abs(counts / n - 1.0 / bins).max()), 4
        ),
    }


def _errors(predicted: Sequence[float], actual: Sequence[float]) -> Dict[str, Any]:
    p = np.asarray(predicted, dtype=float)
    a = np.asarray(actual, dtype=float)
    if p.size == 0:
        return {"n": 0}
    err = p - a
    return {
        "n": int(p.size),
        "mae": round(float(np.abs(err).mean()), 4),
        "rmse": round(float(np.sqrt((err ** 2).mean())), 4),
        # Signed, because a model that is 10 points off in both directions and
        # one that is 10 points high every time are different failures and the
        # absolute error cannot tell them apart.
        "bias": round(float(err.mean()), 4),
        "median_ae": round(float(np.median(np.abs(err))), 4),
        "mean_actual": round(float(a.mean()), 4),
        "mean_predicted": round(float(p.mean()), 4),
    }


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


def _continuous_block(scored: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Margin and total, measured — not just the moneyline.

    **Every game card publishes an expected margin and an expected total, and
    until this block neither was measured anywhere.** The standing rule does
    not permit that: an accuracy claim is stated as a paired measurement on
    named games or it is not stated.

    The interval-coverage rows are the ones with consequences beyond their own
    table. The win probability is not fitted separately — it is the mass of
    the same lattice above zero, and every cover probability and every playoff
    price is a sum over it too. So a distribution that is too narrow makes
    *every percentage on the site* overconfident by an amount the moneyline
    ECE only partly reveals.
    """
    margin_pred = [s["exp_margin"] for s in scored]
    margin_act = [s["actual_margin"] for s in scored]
    total_pred = [s["exp_total"] for s in scored]
    total_act = [s["actual_total"] for s in scored]

    # The market's own number, where it published one. A spread is quoted from
    # the home side and NEGATIVE when the home team is favoured, so the
    # implied margin is its negation — an error here looks like a market that
    # is catastrophically wrong rather than like a sign flip.
    spread_pred, spread_act, spread_model = [], [], []
    total_line, total_line_act, total_line_model = [], [], []
    for s in scored:
        if s.get("spread_home") is not None:
            spread_pred.append(-float(s["spread_home"]))
            spread_act.append(s["actual_margin"])
            spread_model.append(s["exp_margin"])
        if s.get("total_points") is not None:
            total_line.append(float(s["total_points"]))
            total_line_act.append(s["actual_total"])
            total_line_model.append(s["exp_total"])

    coverage_margin = [
        {
            "nominal": level,
            "n": len(scored),
            "covered": sum(1 for s in scored if s[f"in{int(level * 100)}_margin"]),
            "coverage": round(
                sum(1 for s in scored if s[f"in{int(level * 100)}_margin"])
                / max(len(scored), 1),
                4,
            ),
        }
        for level in COVERAGE_LEVELS
    ]
    for row in coverage_margin:
        row["gap"] = round(row["coverage"] - row["nominal"], 4)

    # The total is served as a normal, so its coverage and PIT are the normal
    # ones. Only the margin carries the lattice.
    z_total = [
        (s["actual_total"] - s["exp_total"]) / s["total_sd"]
        for s in scored
        if s["total_sd"] > 0
    ]
    coverage_total = []
    for level in COVERAGE_LEVELS:
        z_star = float(_norm_ppf((1.0 + level) / 2.0))
        covered = sum(1 for z in z_total if abs(z) <= z_star)
        coverage_total.append({
            "nominal": level,
            "n": len(z_total),
            "covered": covered,
            "coverage": round(covered / max(len(z_total), 1), 4),
            "gap": round(covered / max(len(z_total), 1) - level, 4),
            "half_width_z": round(z_star, 4),
        })

    return {
        "note": (
            "Margin coverage and PIT are read off the LATTICE the model "
            "actually publishes, using the mid-P transform for a discrete "
            "distribution. The total is served as a normal and is measured as "
            "one. Comparing either against a normal at the same sd would "
            "grade a distribution this site never published."
        ),
        "margin": {
            "model": _errors(margin_pred, margin_act),
            "vs_market": (
                {
                    "n": len(spread_pred),
                    "model_mae": _errors(spread_model, spread_act).get("mae"),
                    "market_mae": _errors(spread_pred, spread_act).get("mae"),
                    "mae_gap": round(
                        (_errors(spread_model, spread_act).get("mae") or 0)
                        - (_errors(spread_pred, spread_act).get("mae") or 0),
                        4,
                    ),
                }
                if spread_pred
                else {"n": 0}
            ),
            "coverage": coverage_margin,
            "pit": pit_histogram([s["pit_margin"] for s in scored]),
        },
        "total": {
            "model": _errors(total_pred, total_act),
            "vs_market": (
                {
                    "n": len(total_line),
                    "model_mae": _errors(total_line_model, total_line_act).get("mae"),
                    "market_mae": _errors(total_line, total_line_act).get("mae"),
                    "mae_gap": round(
                        (_errors(total_line_model, total_line_act).get("mae") or 0)
                        - (_errors(total_line, total_line_act).get("mae") or 0),
                        4,
                    ),
                }
                if total_line
                else {"n": 0}
            ),
            "coverage": coverage_total,
            "pit": pit_histogram([_norm_cdf(z) for z in z_total]),
        },
    }


def _norm_cdf(z: float) -> float:
    from math import erf, sqrt

    return 0.5 * (1.0 + erf(float(z) / sqrt(2.0)))


def _norm_ppf(q: float) -> float:
    """Inverse normal CDF by bisection.

    Bisection rather than a rational approximation for the same reason
    `market._shin_z` uses it: forty lines of magic constants that are right to
    seven decimals are also forty lines nobody can check, and this is called
    three times per run.
    """
    lo, hi = -10.0, 10.0
    for _ in range(200):
        mid = (lo + hi) / 2.0
        if _norm_cdf(mid) < q:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def _write(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")))
    tmp.replace(path)
    logger.info("wrote %s (%.0f KB)", path.name, path.stat().st_size / 1024)


def _lattice_pit(forecast: Any, actual_margin: int) -> float:
    """The mid-P probability integral transform for a DISCRETE distribution.

    The published margin distribution is a lattice, not a density, and the
    ordinary PIT `F(y)` is not uniform for a discrete forecast however good it
    is — it can only take as many values as the lattice has cells, so a
    histogram of it is spiky by construction and would read as a broken model.

    The mid-P correction `F(k-1) + 0.5 * P(k)` is the standard fix and it is
    uniform under a correct discrete forecast. Getting this wrong is the
    difference between "the interval widths are miscalibrated" and "the test
    does not apply to this kind of forecast".
    """
    lattice = np.asarray(forecast.lattice)
    pmf = np.asarray(forecast.lattice_pmf, dtype=float)
    below = float(pmf[lattice < actual_margin].sum())
    at = float(pmf[lattice == actual_margin].sum())
    return round(below + 0.5 * at, 6)


def _lattice_coverage(forecast: Any, actual_margin: int) -> Dict[str, bool]:
    """Did the result land inside the model's own central interval?

    **The interval is read off the lattice, not off a normal at the same sd.**
    The whole point of this model is that the two are different shapes, so
    checking a normal interval would grade a distribution the site never
    published.

    A discrete distribution cannot hit an arbitrary nominal level exactly, so
    the interval is the smallest lattice range whose mass reaches the nominal
    — which is conservative, and stated as such rather than interpolated into
    a number that looks exact.
    """
    lattice = np.asarray(forecast.lattice)
    cdf = np.cumsum(np.asarray(forecast.lattice_pmf, dtype=float))
    out: Dict[str, bool] = {}
    for level in COVERAGE_LEVELS:
        tail = (1.0 - level) / 2.0
        low_index = int(np.searchsorted(cdf, tail, side="left"))
        high_index = int(np.searchsorted(cdf, 1.0 - tail, side="left"))
        low = int(lattice[min(low_index, len(lattice) - 1)])
        high = int(lattice[min(high_index, len(lattice) - 1)])
        out[f"in{int(level * 100)}_margin"] = bool(low <= actual_margin <= high)
    return out


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
            margin = int(row["home_score"]) - int(row["away_score"])
            total = int(row["home_score"]) + int(row["away_score"])
            scored.append({
                **row,
                "p_home_model": forecast.p_home,
                "p_tie_model": forecast.p_tie,
                "p_away_model": forecast.p_away,
                "elo_expect": elo_expect.get(row["game_id"], 0.5),
                "exp_margin": float(forecast.exp_margin),
                "exp_total": float(forecast.exp_total),
                "total_sd": float(forecast.total_sd),
                "actual_margin": margin,
                "actual_total": total,
                # The distribution diagnostics are computed HERE, against the
                # lattice this specific forecast published, and only their
                # scalars are kept. Recomputing them later would need every
                # game's 57-cell PMF carried through the script, and
                # reconstructing one from `exp_margin` alone would be a second
                # implementation of the model's own distribution.
                "pit_margin": _lattice_pit(forecast, margin),
                **_lattice_coverage(forecast, margin),
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
    # Reliability is built on DECIDED games only, so the outcome is genuinely
    # binary. A tie has no y in {0, 1} and folding it in as 0.5 would put a
    # half-observation into a bucket whose whole meaning is "what share of
    # these happened".
    rel_model_p, rel_model_y = [], []
    rel_elo_p, rel_elo_y = [], []
    rel_market_p, rel_market_y = [], []
    # Per-season Brier, for the chart that shows whether the record is one
    # steady result or an average over some very different years.
    per_season: Dict[int, Dict[str, List[float]]] = defaultdict(
        lambda: {"model": [], "market": [], "elo": [], "paired_model": [], "paired_market": []}
    )
    retrodictions: List[Dict[str, Any]] = []
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

        decided = s["home_score"] != s["away_score"]
        won = 1.0 if s["home_score"] > s["away_score"] else 0.0
        season = int(s["season"])
        if decided:
            rel_model_p.append(cond); rel_model_y.append(won)
            rel_elo_p.append(elo_cond); rel_elo_y.append(won)
            per_season[season]["model"].append((cond - won) ** 2)
            per_season[season]["elo"].append((elo_cond - won) ** 2)

        implied, source = market_probability(s)

        # The archive reads this: every game the walk-forward scored, with
        # what the model said BEFORE it (in the walk-forward sense) and what
        # the market said. `basis` is stamped once, on the file, because every
        # row in it is a retrodiction and none of them was published in
        # advance.
        retrodictions.append({
            "game_id": s["game_id"],
            "season": season,
            "week": int(s["week"]),
            "p_home": round(cond, 5),
            "p_tie": round(s["p_tie_model"], 5),
            "exp_margin": round(s["exp_margin"], 2),
            "exp_total": round(s["exp_total"], 2),
            "p_market": None if implied is None else round(implied, 5),
            "market_source": source,
        })

        if implied is None:
            continue

        market_p.append(implied)
        market_hs.append(s["home_score"])
        market_as.append(s["away_score"])
        market_src.append(source)

        if decided:
            rel_market_p.append(implied); rel_market_y.append(won)
            per_season[season]["market"].append((implied - won) ** 2)
            per_season[season]["paired_model"].append((cond - won) ** 2)
            per_season[season]["paired_market"].append((implied - won) ** 2)
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

    continuous = _continuous_block(scored)
    logger.info("")
    logger.info(
        "margin  MAE %.2f (market %s)  bias %+.2f  coverage 50/80/95 = %s",
        continuous["margin"]["model"]["mae"],
        continuous["margin"]["vs_market"].get("market_mae", "—"),
        continuous["margin"]["model"]["bias"],
        "/".join(f"{c['coverage']:.3f}" for c in continuous["margin"]["coverage"]),
    )
    logger.info(
        "total   MAE %.2f (market %s)  bias %+.2f",
        continuous["total"]["model"]["mae"],
        continuous["total"]["vs_market"].get("market_mae", "—"),
        continuous["total"]["model"]["bias"],
    )

    seasons_block = {
        str(season): {
            "n": len(values["model"]),
            "model_brier": round(float(np.mean(values["model"])), 5) if values["model"] else None,
            "elo_brier": round(float(np.mean(values["elo"])), 5) if values["elo"] else None,
            "market_brier": round(float(np.mean(values["market"])), 5) if values["market"] else None,
            "priced_n": len(values["paired_market"]),
            # The gap is computed on the PAIRED subset — the priced games
            # only — never by subtracting two Briers measured on different
            # game sets. Those two numbers describe different schedules, and
            # in a season where the unpriced games happened to be lopsided
            # the difference is mostly a fact about coverage.
            "gap_to_market": (
                round(
                    float(np.mean(values["paired_model"]) - np.mean(values["paired_market"])),
                    5,
                )
                if values["paired_market"]
                else None
            ),
        }
        for season, values in sorted(per_season.items())
    }

    _write(OUT / "retrodictions.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "basis": "backtest",
        "n": len(retrodictions),
        "refit_cadence": "weekly, expanding window",
        "note": (
            "What the model would have said about each game, refit on games "
            "strictly earlier than the week it scores. The model never saw "
            "the game it is scoring — but nobody read these numbers before "
            "those kickoffs either, and this project does not blur a "
            "reconstruction into a published call."
        ),
        "games": retrodictions,
    })

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
        "reliability": {
            "margin_model": reliability(rel_model_p, rel_model_y),
            "elo_only": reliability(rel_elo_p, rel_elo_y),
            "market": reliability(rel_market_p, rel_market_y),
        },
        "continuous": continuous,
        "by_season": seasons_block,
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
