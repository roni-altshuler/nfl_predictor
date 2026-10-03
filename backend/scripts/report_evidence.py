"""Report committed evidence without training or fetching data.

python -m backend.scripts.report_evidence

Historical scorecards are read as artifact claims. Live Brier/accuracy and
horizon counts are independently recomputed from the stored settled rows.
"""
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"


def _timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Evidence timestamps must include a timezone")
    return parsed


def verify_live(live: dict) -> dict:
    seen = set()
    losses, correct = [], 0
    horizons = {"under_24h": 0, "1_to_7_days": 0, "7_days_or_more": 0}
    for game in live["games"]:
        game_id = str(game["game_id"])
        if game_id in seen:
            raise ValueError(f"Duplicate game: {game_id}")
        seen.add(game_id)
        hours = (_timestamp(game["kickoff_utc"]) - _timestamp(game["generated_at"])).total_seconds() / 3600
        if hours <= 0:
            raise ValueError(f"Forecast was not made before kickoff: {game_id}")
        if game["home_score"] == game["away_score"]:
            continue
        p = float(game["p_home_conditional"])
        if not math.isfinite(p) or not 0 <= p <= 1:
            raise ValueError(f"Invalid conditional probability: {game_id}")
        home_won = game["home_score"] > game["away_score"]
        losses.append((p - int(home_won)) ** 2)
        correct += int((p >= 0.5) == home_won)
        horizons["under_24h" if hours < 24 else "1_to_7_days" if hours < 168 else "7_days_or_more"] += 1
    n = len(losses)
    if n != live["n"]:
        raise ValueError("Live sample size does not match settled rows")
    brier = sum(losses) / n if n else None
    accuracy = correct / n if n else None
    for key, calculated in (("brier", brier), ("accuracy", accuracy)):
        reported = live.get(key)
        if calculated is None:
            if reported is not None:
                raise ValueError(f"Empty live record must have no {key}")
        elif reported is None or not math.isclose(float(reported), calculated, abs_tol=1e-5):
            raise ValueError(f"Live {key} does not match stored rows")
    for key, count in horizons.items():
        if live["cohorts"]["horizon"][key]["n"] != count:
            raise ValueError(f"Horizon cohort does not match timestamps: {key}")
    return {"n": n, "brier": brier, "accuracy": accuracy, "horizons": horizons}


def report(market: dict, live: dict) -> str:
    verified = verify_live(live)
    lines = [
        f"Historical artifact generated: {market['generated_at']}",
        f"Price timing: {market['market_timing']}",
        f"Protocol: {market['refit_cadence']}; {market['week_grouping']}",
        "", "| Forecaster | n | Brier | Log loss | Accuracy | ECE |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for key in ("market", "elo_only", "margin_model", "constant_base_rate"):
        row = market["scorecards"][key]
        lines.append(f"| {key} | {row['n']} | {row['brier']:.5f} | {row['log_loss']:.5f} | {row['accuracy']:.5f} | {row['ece']:.5f} |")
    lines += ["", f"Live artifact generated: {live['generated_at']}",
              f"Verified settled rows: {verified['n']}"]
    if verified["n"]:
        lines += [f"Recomputed live Brier: {verified['brier']:.5f}",
                  f"Recomputed live accuracy: {verified['accuracy']:.5f}"]
    lines += [f"Horizon counts from kickoff/publication timestamps: {json.dumps(verified['horizons'], sort_keys=True)}",
              "Historical metrics were not rerun. Live metrics verify the stored probabilities and results, not an independent outcome source."]
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--market", type=Path, default=DATA / "diagnostics/market_benchmark.json")
    parser.add_argument("--live", type=Path, default=DATA / "predictions/forecast_log.json")
    args = parser.parse_args()
    print(report(json.loads(args.market.read_text(encoding="utf-8-sig")),
                 json.loads(args.live.read_text(encoding="utf-8-sig"))), end="")


if __name__ == "__main__":
    main()
