"""Independent comparison audit: stdlib only, no producer/scoring imports.

With --db, also reselect from every retained snapshot and verify source hashes.
Without it, recompute all artifact probabilities, horizons, scores and cohorts.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import sqlite3

DATA = Path(__file__).resolve().parents[1] / "data"
BUCKETS = ("under_24h", "1_to_7_days", "7_days_or_more")


def utc(text):
    dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    assert dt.tzinfo is not None, "Naive timestamp"
    return dt.astimezone(timezone.utc)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(artifact, first, db=None):
    games = artifact["games"]
    assert len({g["game_id"] for g in games}) == len(games), "Duplicate artifact games"
    originals = {str(g["game_id"]): g for g in first["games"]}
    assert len(originals) == len(first["games"]), "Duplicate first games"
    assert artifact["season"] == first["season"]
    rows = {"first": [], "latest": []}
    for game in games:
        original = originals.get(game["game_id"])
        eligible_first = False
        if original is not None:
            try:
                triple = [original[k] for k in ("p_home", "p_tie", "p_away")]
                eligible_first = (utc(original["generated_at"]) < utc(game["actual_kickoff_utc"]) and
                    all(type(p) in (int,float) and math.isfinite(p) and 0 <= p <= 1 for p in triple) and
                    abs(sum(triple)-1) <= 1e-5 and (triple[0]+triple[2] > 0 or game["home_score"] == game["away_score"]) and
                    isinstance(original["model_version"],str) and bool(original["model_version"]) and
                    (original["home"],original["away"]) == (game["home"],game["away"]))
            except (KeyError,TypeError,ValueError,AssertionError):
                pass
        assert eligible_first == (game["first"] is not None), "Wrong first coverage"
        for label in rows:
            row = game[label]
            if row is None:
                assert game[f"{label}_unavailable"], "Missing forecast without reason"
                continue
            assert game[f"{label}_unavailable"] is None
            p = [row[k] for k in ("p_home", "p_tie", "p_away")]
            assert all(type(v) in (float, int) and math.isfinite(v) and 0 <= v <= 1 for v in p), "Invalid probability"
            assert abs(sum(p) - 1) <= 1e-5, "Probability sum"
            hours = (utc(game["actual_kickoff_utc"]) - utc(row["generated_at"])).total_seconds() / 3600
            assert hours > 0, "Forecast at or after actual kickoff"
            assert row["horizon_hours"] == hours, "Wrong horizon"
            assert row["horizon"] == BUCKETS[0 if hours < 24 else 1 if hours < 168 else 2]
            if label == "first":
                raw = originals[game["game_id"]]
                for key in ("generated_at", "model_version", "p_home", "p_tie", "p_away"):
                    assert row[key] == raw[key], "Changed first publication"
            tie = game["home_score"] == game["away_score"]
            if tie:
                assert row["brier"] is None and row["log_loss"] is None and row["p_home_conditional"] is None
            else:
                assert p[0] + p[2] > 0
                q = p[0] / (p[0] + p[2])
                outcome = int(game["home_score"] > game["away_score"])
                clipped = min(1-1e-15, max(1e-15, q))
                loss = -math.log(clipped if outcome else 1-clipped)
                assert math.isclose(row["p_home_conditional"], q, abs_tol=1e-14)
                assert math.isclose(row["brier"], (q-outcome)**2, abs_tol=1e-14), "Wrong Brier"
                assert math.isclose(row["log_loss"], loss, abs_tol=1e-12), "Wrong log loss"
            rows[label].append(row)

    def scores(selected):
        decided = [r for r in selected if r["brier"] is not None]
        return {"n": len(decided), "ties_excluded": len(selected)-len(decided),
                **{k: sum(r[k] for r in decided)/len(decided) if decided else None for k in ("brier", "log_loss")}}

    def check_cohort(claim, selected):
        assert {k: claim[k] for k in ("n", "ties_excluded", "brier", "log_loss")} == scores(selected), "Wrong cohort scores"
        assert claim["horizons"] == {h: scores([r for r in selected if r["horizon"] == h]) for h in BUCKETS}, "Wrong horizon cohorts"
        assert claim["models"] == {v: scores([r for r in selected if r["model_version"] == v]) for v in sorted({r["model_version"] for r in selected})}

    for label in rows:
        check_cohort(artifact[label], rows[label])
        assert artifact["coverage"][f"missing_{label}"] == artifact["settled_games"] - len(rows[label])
    pairs = [g for g in games if g["first"] and g["latest"] and g["home_score"] != g["away_score"]]
    assert artifact["paired"]["game_ids"] == [g["game_id"] for g in pairs], "Wrong paired IDs"
    assert artifact["paired"]["n"] == len(pairs)
    for label in rows:
        check_cohort(artifact["paired"][label], [g[label] for g in pairs])
    gap = artifact["paired"]["latest"]["brier"] - artifact["paired"]["first"]["brier"] if pairs else None
    assert artifact["paired"]["latest_minus_first_brier"] == gap, "Wrong paired gap"
    assert artifact["coverage"]["paired_with_later_publication"] == sum(utc(g["latest"]["generated_at"]) > utc(g["first"]["generated_at"]) for g in pairs)

    if db is not None:
        assert digest(db) == artifact["sources"]["warehouse_sha256"], "Warehouse hash mismatch"
        with sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True) as conn:
            conn.row_factory = sqlite3.Row
            stored = list(conn.execute("SELECT * FROM prediction_snapshots WHERE season=?", (artifact["season"],)))
            results = {r["game_id"]: r for r in conn.execute("SELECT g.*,h.abbreviation AS home,a.abbreviation AS away FROM games g JOIN teams h ON h.team_id=g.home_team_id JOIN teams a ON a.team_id=g.away_team_id WHERE g.season=? AND g.competition_id='nfl'", (artifact["season"],))}
        assert len(stored) == artifact["sources"]["snapshots"]
        assert len(results) == artifact["settled_games"]
        assert sum(r["home_score"] != r["away_score"] for r in results.values()) == artifact["settled_decided"]
        valid_ids = set()
        for key, row in results.items():
            try:
                utc(row["date_utc"])
                valid_ids.add(key)
            except (TypeError,ValueError,AssertionError):
                pass
        assert {g["game_id"] for g in games} == valid_ids, "Wrong result coverage"
        grouped = defaultdict(list)
        for raw in stored:
            grouped[raw["fixture_uid"]].append(dict(raw))
        for game in games:
            raw_result = results[game["game_id"]]
            assert game["actual_kickoff_utc"] == raw_result["date_utc"]
            assert (game["home"],game["away"]) == (raw_result["home"],raw_result["away"])
            assert (game["home_score"], game["away_score"]) == (raw_result["home_score"], raw_result["away_score"])
            valid = defaultdict(list)
            for raw in grouped[game["game_id"]]:
                try:
                    stamp = utc(raw["generated_at"])
                    triple = [raw[k] for k in ("p_home", "p_tie", "p_away")]
                    if (stamp >= utc(raw_result["date_utc"]) or not raw["model_version"] or
                        not all(type(p) in (float,int) and math.isfinite(p) and 0 <= p <= 1 for p in triple) or
                        abs(sum(triple)-1) > 1e-5 or (triple[0]+triple[2] <= 0 and game["home_score"] != game["away_score"]) or
                        (raw["home_team"],raw["away_team"]) != (game["home"],game["away"])):
                        continue
                    valid[(stamp,raw["model_version"])].append(raw)
                except (TypeError,ValueError,AssertionError):
                    continue
            ordered = []
            for (stamp,version), candidates in valid.items():
                if len({(c["p_home"],c["p_tie"],c["p_away"]) for c in candidates}) == 1:
                    ordered.append((stamp,version,min(candidates,key=lambda c:c["generated_at"])))
            ordered.sort(key=lambda c: (-c[0].timestamp(),c[1]))
            expected = ordered[0][2] if ordered else None
            selected = game["latest"]
            assert (expected is None) == (selected is None), "Wrong latest coverage"
            if expected:
                for key in ("generated_at","model_version","p_home","p_tie","p_away"):
                    assert selected[key] == expected[key], "Wrong latest stored forecast"
    return {"first_n": artifact["first"]["n"], "latest_n": artifact["latest"]["n"],
            "paired_n": len(pairs), "latest_horizons": {h:c["n"] for h,c in artifact["latest"]["horizons"].items()},
            "full_history_reselected": db is not None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", type=Path, default=DATA / "predictions/forecast_comparison.json")
    parser.add_argument("--first", type=Path, default=DATA / "predictions/forecast_log.json")
    parser.add_argument("--db", type=Path)
    args = parser.parse_args()
    artifact = json.loads(args.artifact.read_text())
    assert digest(args.first) == artifact["sources"]["first_sha256"], "First record hash mismatch"
    print(json.dumps(audit(artifact, json.loads(args.first.read_text()), args.db), indent=2))


if __name__ == "__main__":
    main()
