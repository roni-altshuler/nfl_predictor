"""Tests for the conference-race artifact.

Two things here are easy to get wrong and produce a chart that looks entirely
plausible, so both are pinned:

1. **The expected season length.** A season is `16 * (weeks - 1)` games,
   because every team has exactly one bye. The first version asserted
   `16 * weeks` and refused to replay any season that has ever been played.

2. **The offseason regression at checkpoint 0.** Elo applies its carryover
   lazily, when the first game of a new season arrives — one game too late for
   a snapshot taken before that game. Calling `regress_to_season` explicitly at
   the boundary must regress exactly once, not twice.
"""

from __future__ import annotations

import pytest

from backend.services.espn.client import regular_season_weeks
from backend.services.ratings.elo import EloConfig, EloRatingSystem


def expected_games(season: int) -> int:
    """What the replay guard computes, kept beside the reason it exists."""
    return 16 * (regular_season_weeks(season) - 1)


@pytest.mark.parametrize(
    "season,games",
    [
        (2025, 272),  # 18 weeks, 17 games each
        (2021, 272),  # the first 18-week season
        (2020, 256),  # 17 weeks, 16 games each
        (2002, 256),
    ],
)
def test_season_length_counts_the_bye(season: int, games: int) -> None:
    """Every team plays one fewer game than there are weeks."""
    assert expected_games(season) == games


def test_2022_is_inside_the_replay_tolerance() -> None:
    """271, not 272 — Buffalo at Cincinnati was abandoned and never resumed.

    The guard refuses a season more than two games short, so the real 2022
    corpus has to sit inside that window or the replay is unrunnable for a
    season nothing is wrong with.
    """
    assert 271 >= expected_games(2022) - 2


def _seed(system: EloRatingSystem) -> None:
    system.ratings = {1: 1700.0, 2: 1300.0}
    system._last_season = 2024


def test_explicit_boundary_regression_happens_exactly_once() -> None:
    """`regress_to_season` then a 2025 game must not regress twice."""
    config = EloConfig()
    system = EloRatingSystem(config)
    _seed(system)

    assert system.regress_to_season(2025) is True
    after_explicit = system.snapshot()

    expected = config.carryover * 1700.0 + (1 - config.carryover) * config.base_rating
    assert after_explicit[1] == pytest.approx(expected)

    # The lazy path must now be a no-op: a second regression would pull 1700
    # most of the way to 1500 twice over, and nothing would report it.
    system._regress_for_new_season(2025)
    assert system.snapshot() == after_explicit

    # And a caller asking again gets False rather than a silent second pull.
    assert system.regress_to_season(2025) is False
    assert system.snapshot() == after_explicit


def test_regression_actually_moves_ratings_toward_the_mean() -> None:
    """A guard that passes on a no-op regression would be worthless."""
    system = EloRatingSystem(EloConfig())
    _seed(system)
    system.regress_to_season(2025)
    after = system.snapshot()

    assert 1500.0 < after[1] < 1700.0
    assert 1300.0 < after[2] < 1500.0
    # Zero-sum: the two sides move toward 1500 by the same amount.
    assert (1700.0 - after[1]) == pytest.approx(after[2] - 1300.0)
