"""Score first publications and latest stored pregame forecasts separately.

Read-only: no fetching, fitting, history mutation or first-record replacement.
The result warehouse's kickoff supersedes each snapshot's old schedule time.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import sqlite3

from backend.services.prediction.market import conditional_from_three, log_loss

DATA = Path(__file__).resolve().parents[1] / "data"
HORIZONS = ("under_24h", "1_to_7_days", "7_days_or_more")


def instant(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timezone required")
    return parsed.astimezone(timezone.utc)


def valid_forecast(row, result):
    try:
        generated = instant(row["generated_at"])
        if generated >= instant(result["actual_kickoff_utc"]):
            return None, "at_or_after_actual_kickoff"
        values = [row[k] for k in ("p_home", "p_tie", "p_away")]
        if any(isinstance(p, bool) or not isinstance(p, (float, int)) or
               not math.isfinite(p) or not 0 <= p <= 1 for p in values):
            return None, "invalid_probability"
        if abs(sum(values) - 1) > 1e-5 or (values[0] + values[2] <= 0 and
                                          result["home_score"] != result["away_score"]):
            return None, "invalid_probability"
        if not isinstance(row["model_version"], str) or not row["model_version"]:
            return None, "missing_model_version"
        if (row["home"], row["away"]) != (result["home"], result["away"]):
            return None, "team_mismatch"
        return generated, None
    except (KeyError, TypeError, ValueError, OverflowError):
        return None, "invalid_timestamp_or_fields"


def latest_valid(rows, result, exclusions):
    """Latest instant, then smallest lexical model version (never model rank).

    Conflicting probabilities for one version at one instant are withheld;
    equivalent offset spellings cannot let input order choose a prediction.
    Identical predictions resolve by the smallest raw timestamp spelling.
    """
    groups = defaultdict(list)
    for row in rows:
        stamp, reason = valid_forecast(row, result)
        if reason:
            exclusions[reason] += 1
        else:
            groups[(stamp, row["model_version"])].append(row)
    candidates = []
    for (stamp, version), group in groups.items():
        signatures = {(r["home"], r["away"], r["p_home"], r["p_tie"], r["p_away"]) for r in group}
        if len(signatures) != 1:
            exclusions["conflicting_same_instant_version"] += len(group)
            continue
        candidates.append((stamp, version, min(group, key=lambda r: r["generated_at"])))
    if not candidates:
        return None
    newest = max(c[0] for c in candidates)
    return min((c for c in candidates if c[0] == newest), key=lambda c: c[1])[2]


def scored(row, result):
    if row is None:
        return None
    hours = (instant(result["actual_kickoff_utc"]) - instant(row["generated_at"])).total_seconds() / 3600
    tie = result["home_score"] == result["away_score"]
    p = None if tie else conditional_from_three(row["p_home"], row["p_tie"], row["p_away"])[0]
    won = result["home_score"] > result["away_score"]
    return {**{k: row[k] for k in ("generated_at", "model_version", "p_home", "p_tie", "p_away")},
            "scheduled_kickoff_utc": row.get("kickoff_utc"), "horizon_hours": hours,
            "horizon": HORIZONS[0 if hours < 24 else 1 if hours < 168 else 2],
            "p_home_conditional": p, "brier": None if tie else (p - int(won)) ** 2,
            "log_loss": None if tie else log_loss(p, won)}


def metrics(rows):
    decided = [r for r in rows if r["brier"] is not None]
    n = len(decided)
    return {"n": n, "ties_excluded": len(rows) - n,
            **{key: sum(r[key] for r in decided) / n if n else None for key in ("brier", "log_loss")}}


def cohort(rows):
    return {**metrics(rows),
            "horizons": {h: metrics([r for r in rows if r["horizon"] == h]) for h in HORIZONS},
            "models": {v: metrics([r for r in rows if r["model_version"] == v])
                       for v in sorted({r["model_version"] for r in rows})}}


def compare(first_log, results, snapshots):
    """Pure selection/scoring; original log rows are never modified."""
    if len({r["game_id"] for r in results}) != len(results):
        raise ValueError("Duplicate result game IDs")
    first = {}
    for row in first_log["games"]:
        key = str(row["game_id"])
        if key in first:
            raise ValueError("Duplicate first-publication game IDs")
        first[key] = row
    by_game = defaultdict(list)
    for row in snapshots:
        by_game[str(row["fixture_uid"])].append(row)
    excluded = Counter()
    games = []
    for result in sorted(results, key=lambda r: str(r["game_id"])):
        key = str(result["game_id"])
        # A malformed result kickoff cannot establish a pregame boundary.
        try:
            instant(result["actual_kickoff_utc"])
        except (TypeError, ValueError, OverflowError):
            excluded["invalid_result_kickoff"] += 1
            continue
        original = first.get(key)
        first_reason = "missing_first_publication" if original is None else valid_forecast(original, result)[1]
        latest = latest_valid(by_game[key], result, excluded)
        games.append({**result, "game_id": key,
                      "first": scored(original, result) if first_reason is None else None,
                      "first_unavailable": first_reason,
                      "latest": scored(latest, result),
                      "latest_unavailable": None if latest else "no_valid_stored_pregame_snapshot"})
    first_rows = [g["first"] for g in games if g["first"]]
    latest_rows = [g["latest"] for g in games if g["latest"]]
    paired = [g for g in games if g["first"] and g["latest"] and g["home_score"] != g["away_score"]]
    a, b = cohort([g["first"] for g in paired]), cohort([g["latest"] for g in paired])
    return {"schema_version": 1, "season": first_log["season"],
            "settled_games": len(results), "settled_decided": sum(r["home_score"] != r["away_score"] for r in results),
            "first": cohort(first_rows), "latest": cohort(latest_rows),
            "paired": {"game_ids": [g["game_id"] for g in paired], "n": len(paired), "first": a, "latest": b,
                       "latest_minus_first_brier": b["brier"] - a["brier"] if paired else None},
            "coverage": {"missing_first": len(results) - len(first_rows), "missing_latest": len(results) - len(latest_rows),
                         "paired_with_later_publication": sum(instant(g["latest"]["generated_at"]) > instant(g["first"]["generated_at"]) for g in paired),
                         "excluded": dict(sorted(excluded.items()))}, "games": games}


def read_inputs(db, season):
    # Read-only connection avoids migrations and never changes retained history.
    with sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        results = [dict(r) for r in conn.execute(
            "SELECT g.game_id,g.week,g.date_utc AS actual_kickoff_utc,g.home_score,g.away_score,"
            "g.source,g.fetched_at,h.abbreviation AS home,a.abbreviation AS away FROM games g "
            "JOIN teams h ON h.team_id=g.home_team_id JOIN teams a ON a.team_id=g.away_team_id "
            "WHERE g.season=? AND g.competition_id='nfl'", (season,))]
        snapshots = [dict(r) for r in conn.execute(
            "SELECT *,home_team AS home,away_team AS away FROM prediction_snapshots WHERE season=?", (season,))]
    return results, snapshots


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DATA / "warehouse.sqlite")
    parser.add_argument("--first", type=Path, default=DATA / "predictions/forecast_log.json")
    parser.add_argument("--out", type=Path, default=DATA / "predictions/forecast_comparison.json")
    parser.add_argument("--source-url", default=None, help="Optional immutable release asset URL")
    args = parser.parse_args()
    if args.out.resolve() in (args.first.resolve(), args.db.resolve()):
        parser.error("Comparison output must not overwrite either read-only input")
    first = json.loads(args.first.read_text())
    results, snapshots = read_inputs(args.db, first["season"])
    artifact = compare(first, results, snapshots)
    artifact["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    artifact["sources"] = {"first_generated_at": first["generated_at"], "first_sha256": sha256(args.first),
                           "warehouse_sha256": sha256(args.db), "warehouse_url": args.source_url,
                           "snapshots": len(snapshots), "snapshot_through": max((r["generated_at"] for r in snapshots), key=instant, default=None),
                           "results_fetched_through": max((r["fetched_at"] for r in results), key=instant, default=None),
                           "latest_result_kickoff": max((r["actual_kickoff_utc"] for r in results), key=instant, default=None)}
    artifact["protocol"] = {"kickoff": "Stored result date_utc supersedes snapshot schedule; not independently observed kickoff.",
                            "selection": "Latest valid timestamp instant strictly before result kickoff; lexical model version ascending on equal instants, never model ranking. Conflicting same-instant/version probabilities withheld; identical offsets resolve by raw timestamp ascending.",
                            "scores": "Binary Brier and natural-log loss on P(home | decided). Ties counted and excluded; log-loss clamp 1e-15. Full probability precision; original first record unchanged.",
                            "limitations": "Retained snapshots only, no missing-history reconstruction. Stored results rescored for both cohorts, not independently recollected. Small sample; no promotion, significance or accuracy-gain claim."}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"first": artifact["first"], "latest": artifact["latest"], "paired_n": artifact["paired"]["n"], "coverage": artifact["coverage"]}, indent=2))


if __name__ == "__main__":
    main()
