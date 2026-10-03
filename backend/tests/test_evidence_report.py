from copy import deepcopy

import pytest

from backend.scripts.report_evidence import verify_live


@pytest.fixture
def record():
    return {
        "n": 1, "brier": 0.04, "accuracy": 1.0,
        "cohorts": {"horizon": {k: {"n": int(k == "7_days_or_more")} for k in
                                  ("under_24h", "1_to_7_days", "7_days_or_more")}},
        "games": [{"game_id": "one", "generated_at": "2026-08-01T00:00:00Z",
                   "kickoff_utc": "2026-09-01T00:00:00Z", "p_home_conditional": 0.8,
                   "home_score": 20, "away_score": 10}],
    }


def test_recomputes_metrics_and_horizons(record):
    result = verify_live(record)
    assert result["brier"] == pytest.approx(0.04)
    assert result["horizons"]["7_days_or_more"] == 1


@pytest.mark.parametrize("field,value", [("generated_at", "2026-09-01T00:00:00Z"),
                                          ("p_home_conditional", float("nan")),
                                          ("p_home_conditional", 1.1)])
def test_rejects_leakage_or_invalid_probabilities(record, field, value):
    record["games"][0][field] = value
    with pytest.raises(ValueError):
        verify_live(record)


def test_rejects_duplicate_games(record):
    record["games"].append(deepcopy(record["games"][0]))
    with pytest.raises(ValueError, match="Duplicate"):
        verify_live(record)


@pytest.mark.parametrize("field,value", [("n", 2), ("brier", 0.2), ("accuracy", 0.0)])
def test_rejects_inconsistent_headlines(record, field, value):
    record[field] = value
    with pytest.raises(ValueError):
        verify_live(record)


def test_horizons_are_verified_against_dates(record):
    record["cohorts"]["horizon"]["7_days_or_more"]["n"] = 0
    with pytest.raises(ValueError, match="Horizon"):
        verify_live(record)
