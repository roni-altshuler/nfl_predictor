"""Tests for the warehouse integrity gate's season-count rules.

The count checks were written against a corpus of FINISHED seasons and
failed on the first Thursday of 2026, when one played game and 271 fixtures
made the live season's row read `1 != 272` and the daily forecast stopped
publishing. These cases pin the rule that replaced it: a finished season
holds every game it played; the season in progress holds every game it
played PLUS every fixture still to come, and a dropped fixture still fails.
"""

from __future__ import annotations

import random
from typing import Iterable, List, Tuple

import pytest

from backend.scripts import validate_warehouse_integrity as integrity
from backend.services.data.warehouse import (
    SEASON_TYPE_POSTSEASON,
    SEASON_TYPE_REGULAR,
    GameRow,
    ScheduledGameRow,
    Warehouse,
)

LIVE = 2026
FINISHED = 2025

CONFERENCES = ("American Football Conference", "National Football Conference")
DIVISIONS = ("East", "North", "South", "West")


@pytest.fixture
def warehouse(tmp_path, monkeypatch) -> Tuple[Warehouse, List[int]]:
    """An empty warehouse with 32 franchises in 8 divisions, and a fixed
    calendar: it is always the 2026 season for these tests."""
    monkeypatch.setattr(integrity, "current_season", lambda: LIVE)
    w = Warehouse(tmp_path / "warehouse.sqlite")
    w.migrate()
    w.upsert_competition("nfl", "National Football League", "league")
    ids: List[int] = []
    for i in range(32):
        conference = CONFERENCES[i // 16]
        division = f"{conference[:3]} {DIVISIONS[(i % 16) // 4]}"
        ids.append(
            w.upsert_team(
                str(1000 + i),
                f"Team {i}",
                abbreviation=f"T{i:02d}",
                conference=conference,
                division=division,
            )
        )
    return w, ids


def _fixtures(ids: List[int], seed: int = 7) -> List[Tuple[int, int, int]]:
    """A 17-week schedule: every week pairs all 32 teams once, so each team
    plays exactly 17 games and the season holds exactly 272."""
    rng = random.Random(seed)
    out: List[Tuple[int, int, int]] = []
    for week in range(1, 18):
        order = ids[:]
        rng.shuffle(order)
        for k in range(0, 32, 2):
            out.append((week, order[k], order[k + 1]))
    return out


def _stamp(season: int, week: int) -> str:
    return f"{season}-09-{min(week, 28):02d}T17:00:00+00:00"


def _played(season: int, fixtures: Iterable[Tuple[int, int, int]], *, season_type: int = SEASON_TYPE_REGULAR, offset: int = 0):
    for n, (week, home, away) in enumerate(fixtures, start=offset):
        yield GameRow(
            game_id=f"{season}-{season_type}-{n}",
            source="test",
            competition_id="nfl",
            season=season,
            season_type=season_type,
            week=week,
            date_utc=_stamp(season, week),
            home_team_id=home,
            away_team_id=away,
            home_score=24,
            away_score=17,
        )


def _scheduled(season: int, fixtures: Iterable[Tuple[int, int, int]], *, season_type: int = SEASON_TYPE_REGULAR, offset: int = 0):
    for n, (week, home, away) in enumerate(fixtures, start=offset):
        yield ScheduledGameRow(
            game_id=f"{season}-{season_type}-{n}",
            source="test",
            competition_id="nfl",
            season=season,
            season_type=season_type,
            week=week,
            date_utc=_stamp(season, week),
            home_team_id=home,
            away_team_id=away,
        )


def _load(w: Warehouse, ids: List[int], season: int, played: int, scheduled: int) -> None:
    """The first `played` fixtures into `games`, the next `scheduled` into
    `scheduled_games`; anything beyond that is simply absent."""
    fx = _fixtures(ids)
    w.upsert_games(_played(season, fx[:played]))
    w.upsert_scheduled(_scheduled(season, fx[played : played + scheduled], offset=played))


def _postseason(w: Warehouse, ids: List[int], season: int, played: int) -> None:
    """`played` distinct playoff games, one per week so nothing is a duplicate."""
    pairs = [(week, ids[2 * week], ids[2 * week + 1]) for week in range(1, played + 1)]
    w.upsert_games(_played(season, pairs, season_type=SEASON_TYPE_POSTSEASON))


def _failures(w: Warehouse) -> List[str]:
    report = integrity.Report()
    integrity.check_season_counts(w, report)
    integrity.check_games_per_team(w, report)
    return report.failures


# ------------------------------------------------------------------ rules


def test_in_progress_is_scheduled_fixtures_or_the_calendar():
    assert not integrity.in_progress(FINISHED, 0, live=LIVE)
    assert integrity.in_progress(LIVE, 0, live=LIVE)
    # Fixtures left to play make a season live whatever the calendar says.
    assert integrity.in_progress(FINISHED, 3, live=LIVE)
    # A schedule published ahead of the rollover is a future season, not a
    # short one.
    assert integrity.in_progress(LIVE + 1, 272, live=LIVE)


def test_finished_season_must_hold_every_game(warehouse):
    w, ids = warehouse
    _load(w, ids, FINISHED, played=272, scheduled=0)
    assert _failures(w) == []


def test_finished_season_short_by_one_fails(warehouse):
    w, ids = warehouse
    _load(w, ids, FINISHED, played=271, scheduled=0)
    failures = _failures(w)
    assert any(f"{FINISHED}: 271 != 272" in f for f in failures)
    assert any("per-team game counts wrong" in f for f in failures)


@pytest.mark.parametrize("played", [0, 1, 2, 100, 272])
def test_live_season_counts_played_plus_scheduled(warehouse, played):
    """Opening night, mid-season and the morning after the last game all
    hold the same invariant: results plus fixtures is the whole schedule."""
    w, ids = warehouse
    _load(w, ids, LIVE, played=played, scheduled=272 - played)
    assert _failures(w) == []


def test_live_season_dropped_fixture_still_fails(warehouse):
    w, ids = warehouse
    _load(w, ids, LIVE, played=2, scheduled=269)
    failures = _failures(w)
    assert any("in progress" in f and "2 played + 269 scheduled != 272" in f for f in failures)
    assert any("per-team game counts wrong" in f for f in failures)


def test_finished_and_live_seasons_are_judged_separately(warehouse):
    w, ids = warehouse
    _load(w, ids, FINISHED, played=272, scheduled=0)
    _load(w, ids, LIVE, played=2, scheduled=270)
    assert _failures(w) == []


def test_live_postseason_is_bounded_not_exact(warehouse):
    w, ids = warehouse
    _load(w, ids, LIVE, played=272, scheduled=0)
    _postseason(w, ids, LIVE, played=4)
    assert _failures(w) == []

    _postseason(w, ids, LIVE, played=14)
    assert any("14 > 13" in f for f in _failures(w))


def test_finished_postseason_must_be_exact(warehouse):
    w, ids = warehouse
    _load(w, ids, FINISHED, played=272, scheduled=0)
    _postseason(w, ids, FINISHED, played=12)
    assert any(f"{FINISHED}: 12 != 13" in f for f in _failures(w))


def test_whole_gate_passes_on_opening_week(warehouse, tmp_path):
    """The exact shape that stopped the 2026-09-10 and -11 runs."""
    w, ids = warehouse
    _load(w, ids, FINISHED, played=272, scheduled=0)
    _load(w, ids, LIVE, played=1, scheduled=271)
    w.close()
    assert integrity.run(["--db", str(tmp_path / "warehouse.sqlite")]) == 0
