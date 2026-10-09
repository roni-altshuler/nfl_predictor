from copy import deepcopy
from collections import Counter
import math

import pytest

from backend.scripts.compare_forecasts import compare, latest_valid


def result(game_id="one", **changes):
    return {"game_id": game_id, "week": 1, "actual_kickoff_utc": "2026-09-10T18:00:00Z",
            "home": "BUF", "away": "DET", "home_score": 21, "away_score": 14, **changes}


def forecast(game_id="one", **changes):
    return {"fixture_uid": game_id, "game_id": game_id, "generated_at": "2026-09-01T18:00:00Z",
            "model_version": "v1", "kickoff_utc": "2026-09-10T18:00:00Z", "home": "BUF", "away": "DET",
            "p_home": .6, "p_tie": .01, "p_away": .39, **changes}


def record(*rows):
    return {"season": 2026, "games": list(rows)}


def test_pairing_uses_identical_decided_ids_and_preserves_original():
    original = record(forecast(), forecast("first-only"))
    before = deepcopy(original)
    artifact = compare(original, [result(), result("first-only"), result("latest-only"), result("missing")],
                       [forecast(g, generated_at="2026-09-10T17:00:00Z", p_home=.8, p_away=.19) for g in ("one", "latest-only")])
    assert original == before
    assert artifact["first"]["n"] == artifact["latest"]["n"] == 2
    assert artifact["paired"]["game_ids"] == ["one"]
    assert artifact["paired"]["first"]["n"] == artifact["paired"]["latest"]["n"] == 1
    assert artifact["paired"]["latest_minus_first_brier"] == pytest.approx((.8/.99-1)**2 - (.6/.99-1)**2)
    assert artifact["coverage"]["missing_first"] == artifact["coverage"]["missing_latest"] == 2


def test_tied_results_are_counted_never_paired_or_scored_as_half():
    artifact = compare(record(forecast()), [result(home_score=14)], [forecast(p_home=0, p_tie=1, p_away=0)])
    assert artifact["first"]["ties_excluded"] == artifact["latest"]["ties_excluded"] == 1
    assert artifact["paired"]["n"] == 0
    assert artifact["latest"]["brier"] is None
    assert artifact["paired"]["latest_minus_first_brier"] is None
    assert artifact["latest"]["horizons"]["7_days_or_more"]["ties_excluded"] == 1


def test_offsets_use_instants_strict_boundary_and_lexical_version_tie():
    rows = [forecast(generated_at="2026-09-10T17:30:00Z", model_version="v2"),
            forecast(generated_at="2026-09-10T19:30:00+02:00", model_version="v1", p_home=.8, p_away=.19),
            forecast(generated_at="2026-09-10T18:00:00Z", p_home=.9, p_away=.09),
            forecast(generated_at="2026-09-10T16:00:00-03:00", p_home=.7, p_away=.29)]
    for shuffled in (rows, list(reversed(rows)), rows[1:] + rows[:1]):
        excluded = Counter()
        selected = latest_valid(shuffled, result(), excluded)
        assert selected["model_version"] == "v1"
        assert selected["p_home"] == .8
        assert excluded["at_or_after_actual_kickoff"] == 2


def test_conflicting_same_version_instant_withheld_not_chosen_by_order():
    old = forecast(generated_at="2026-09-10T16:00:00Z")
    conflict = [forecast(generated_at="2026-09-10T17:00:00Z"),
                forecast(generated_at="2026-09-10T19:00:00+02:00", p_home=.8, p_away=.19)]
    for rows in ([old, *conflict], [*reversed(conflict), old]):
        excluded = Counter()
        assert latest_valid(rows, result(), excluded) == old
        assert excluded["conflicting_same_instant_version"] == 2
    # Identical probabilities at one instant resolve by raw timestamp spelling.
    same = [forecast(generated_at="2026-09-10T17:00:00Z"), forecast(generated_at="2026-09-10T19:00:00+02:00")]
    assert latest_valid(same, result(), Counter()) == latest_valid(list(reversed(same)), result(), Counter())


@pytest.mark.parametrize("fields", [{"p_home": None}, {"p_home": math.nan}, {"p_home": math.inf},
                                   {"p_home": -0.1}, {"p_home": 1.1}, {"p_home": True}, {"p_away": .5},
                                   {"p_home": 0, "p_tie": 1, "p_away": 0},
                                   {"generated_at": "2026-09-10T17:00:00"}, {"model_version": ""}, {"home": "SEA"}])
def test_invalid_latest_skipped_for_last_valid_forecast(fields):
    older = forecast()
    newest = forecast(generated_at="2026-09-10T17:00:00Z", **fields) if "generated_at" not in fields else forecast(**fields)
    excluded = Counter()
    assert latest_valid([older, newest], result(), excluded) == older
    assert sum(excluded.values()) == 1


def test_actual_kickoff_change_supersedes_snapshot_schedule():
    first = forecast(generated_at="2026-09-10T17:00:00Z")
    delayed = forecast(generated_at="2026-09-10T19:00:00Z")  # after old schedule, before delayed actual
    late = compare(record(first), [result(actual_kickoff_utc="2026-09-10T20:00:00Z")], [first, delayed])
    assert late["games"][0]["latest"]["generated_at"] == delayed["generated_at"]
    assert late["games"][0]["latest"]["horizon_hours"] == 1
    early = compare(record(first), [result(actual_kickoff_utc="2026-09-10T16:00:00Z")], [first, delayed])
    assert early["paired"]["n"] == 0
    assert early["coverage"]["missing_first"] == early["coverage"]["missing_latest"] == 1


def test_horizon_boundaries_use_unrounded_hours_and_missing_stays_null():
    rows = [forecast(str(i), generated_at=stamp) for i, stamp in enumerate(
        ["2026-09-09T18:00:00.001Z", "2026-09-09T18:00:00Z", "2026-09-03T18:00:00Z"])]
    artifact = compare(record(*rows), [result(str(i)) for i in range(4)], rows)
    assert [c["n"] for c in artifact["latest"]["horizons"].values()] == [1, 1, 1]
    missing = artifact["games"][-1]
    assert missing["first"] is None and missing["latest"] is None
    assert missing["latest_unavailable"] == "no_valid_stored_pregame_snapshot"
    empty = compare(record(), [result()], [])
    assert empty["latest"]["n"] == 0 and empty["latest"]["log_loss"] is None


def test_log_loss_extremes_remain_finite_and_duplicates_fail_closed():
    artifact = compare(record(forecast(p_home=0, p_tie=0, p_away=1)), [result()], [])
    assert artifact["first"]["log_loss"] == pytest.approx(-math.log(1e-15))
    with pytest.raises(ValueError, match="Duplicate first"):
        compare(record(forecast(), forecast()), [result()], [])
    with pytest.raises(ValueError, match="Duplicate result"):
        compare(record(), [result(), result()], [])


def test_independent_auditor_recomputes_committed_artifact_and_detects_tampering():
    import json
    from backend.scripts.verify_forecast_comparison import audit, DATA, digest
    path = DATA / "predictions/forecast_comparison.json"
    artifact = json.loads(path.read_text())
    first_path = DATA / "predictions/forecast_log.json"
    first = json.loads(first_path.read_text())
    assert artifact["sources"]["first_sha256"] == digest(first_path)
    assert audit(artifact, first)["paired_n"] == artifact["paired"]["n"]
    for change in ("cohort", "paired_ids", "probability", "horizon", "first", "gap"):
        bad = deepcopy(artifact)
        if change == "cohort":
            bad["latest"]["brier"] = 0
        elif change == "paired_ids":
            bad["paired"]["game_ids"] = []
        elif change == "probability":
            bad["games"][0]["latest"]["p_home"] = 1.1
        elif change == "horizon":
            bad["games"][0]["latest"]["horizon_hours"] = 0
        elif change == "first":
            bad["games"][0]["first"]["model_version"] = "changed"
        else:
            bad["paired"]["latest_minus_first_brier"] = 0
        with pytest.raises(AssertionError):
            audit(bad, first)


def test_independent_auditor_handles_empty_and_extreme_probabilities():
    from backend.scripts.verify_forecast_comparison import audit
    for p in (0, 1):
        original = record(forecast(p_home=p, p_tie=0, p_away=1-p))
        artifact = compare(original, [result(home_score=0, away_score=1)], [])
        assert audit(artifact, original)["paired_n"] == 0


def test_invalid_actual_kickoff_withholds_both_cohorts():
    artifact = compare(record(forecast()), [result(actual_kickoff_utc="2026-09-10")], [forecast()])
    assert artifact["first"]["n"] == artifact["latest"]["n"] == 0
    assert artifact["coverage"]["excluded"]["invalid_result_kickoff"] == 1


@pytest.mark.parametrize("input_name", ["first", "db"])
def test_cli_refuses_to_overwrite_either_input(tmp_path, monkeypatch, input_name):
    from backend.scripts.compare_forecasts import main
    first, db = tmp_path/"first.json", tmp_path/"warehouse.sqlite"
    first.write_text("original first record")
    db.write_bytes(b"original warehouse")
    out = first if input_name == "first" else db
    monkeypatch.setattr("sys.argv", ["compare_forecasts", "--first", str(first), "--db", str(db), "--out", str(out)])
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 2
    assert first.read_text() == "original first record"
    assert db.read_bytes() == b"original warehouse"
