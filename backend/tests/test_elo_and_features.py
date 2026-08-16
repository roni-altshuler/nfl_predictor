"""Elo, and the point-in-time guarantees of the feature builder."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from backend.services.prediction.feature_builder import (
    FEATURE_NAMES,
    FeatureBuilder,
    constant_features,
    dead_feature_blocks,
)
from backend.services.ratings.elo import (
    EloConfig,
    EloRatingSystem,
    fit_home_advantage,
)


def _row(game_id, date, home, away, hs, as_, season=2024, week=1, neutral=0):
    """A warehouse-shaped row, as sqlite3.Row would deliver it."""
    return {
        "game_id": game_id, "date_utc": date, "season": season, "week": week,
        "home_team_id": home, "away_team_id": away,
        "home_score": hs, "away_score": as_, "neutral_site": neutral,
        "home_turnovers": None, "away_turnovers": None,
        "home_total_yards": None, "away_total_yards": None,
        "ml_home": None, "ml_away": None,
        "spread_home": None, "total_points": None,
    }


class TestElo:
    def test_a_tie_is_half_a_win(self):
        """The NBA sibling has no branch for this. Without it a tie scores as
        a home loss AND an away win — a wrong sign on both teams."""
        system = EloRatingSystem(EloConfig(home_advantage=0.0))
        rated = system.update(
            game_id="g", date_utc="2024-09-08T17:00:00+00:00", season=2024,
            week=1, home_team_id=1, away_team_id=2,
            home_score=20, away_score=20,
        )
        assert rated.is_tie
        # Evenly matched and drawn: neither rating moves.
        assert system.get(1) == pytest.approx(1500.0, abs=1e-9)
        assert system.get(2) == pytest.approx(1500.0, abs=1e-9)

    def test_a_tie_against_a_favourite_helps_the_underdog(self):
        system = EloRatingSystem(EloConfig(home_advantage=0.0))
        system.set(1, 1700.0)
        system.set(2, 1300.0)
        system.update(
            game_id="g", date_utc="2024-09-08T17:00:00+00:00", season=2024,
            week=1, home_team_id=1, away_team_id=2,
            home_score=17, away_score=17,
        )
        assert system.get(1) < 1700.0
        assert system.get(2) > 1300.0

    def test_a_tie_still_moves_ratings_rather_than_being_ignored(self):
        """|margin| = 0 would zero a log multiplier; it floors at a 1-point
        game instead, because "two teams were level" is real information."""
        system = EloRatingSystem(EloConfig(home_advantage=0.0))
        system.set(1, 1700.0)
        system.set(2, 1300.0)
        system.update(
            game_id="g", date_utc="2024-09-08T17:00:00+00:00", season=2024,
            week=1, home_team_id=1, away_team_id=2, home_score=0, away_score=0,
        )
        assert system.get(1) != pytest.approx(1700.0, abs=1e-9)

    def test_out_of_order_games_are_refused(self):
        """Elo over an unordered stream reads the future and the output looks
        entirely normal."""
        system = EloRatingSystem()
        rows = [
            _row("a", "2024-09-15T17:00:00+00:00", 1, 2, 24, 17),
            _row("b", "2024-09-08T17:00:00+00:00", 1, 2, 24, 17),
        ]
        with pytest.raises(ValueError, match="out of order"):
            system.run(rows)

    def test_regression_pulls_every_team_toward_the_mean(self):
        system = EloRatingSystem(EloConfig(carryover=0.5))
        system.set(1, 1700.0)
        system.set(2, 1300.0)
        system._last_season = 2024
        assert system.regress_to_season(2025) is True
        assert system.get(1) == pytest.approx(1600.0)
        assert system.get(2) == pytest.approx(1400.0)

    def test_regression_is_refused_for_a_season_already_walked(self):
        """A forecaster must call it; a backtest must not, and calling it
        twice regresses twice."""
        system = EloRatingSystem(EloConfig(carryover=0.5))
        system.set(1, 1700.0)
        system._last_season = 2025
        assert system.regress_to_season(2025) is False
        assert system.get(1) == pytest.approx(1700.0)

    def test_home_advantage_counts_a_tie_as_half(self):
        games = [
            {"home_score": 1, "away_score": 0, "neutral_site": 0}
            for _ in range(120)
        ] + [
            {"home_score": 0, "away_score": 1, "neutral_site": 0}
            for _ in range(80)
        ]
        value = fit_home_advantage(games, minimum=100)
        assert value is not None and value > 0

    def test_home_advantage_refuses_a_sample_that_cannot_support_one(self):
        games = [{"home_score": 1, "away_score": 0, "neutral_site": 0}] * 10
        assert fit_home_advantage(games, minimum=200) is None


class TestFeatureBuilder:
    def _builder(self):
        builder = FeatureBuilder()
        builder.set_divisions({1: "AFC East", 2: "AFC East", 3: "AFC West"})
        return builder

    def test_a_season_opener_is_not_a_bye(self):
        """The offseason gap is 200-odd days. Clipped to REST_MAX it reads as
        maximally rested, which flagged every week-1 game as off-bye — in
        training as well as at serving time."""
        builder = self._builder()
        builder.observe(
            _row("g", "2025-01-05T17:00:00+00:00", 1, 2, 24, 17, season=2024)
        )
        vector = builder.vector_for(
            home_team_id=1, away_team_id=2,
            home_elo=1500.0, away_elo=1500.0,
            kickoff=datetime(2025, 9, 7, 17, tzinfo=timezone.utc),
            week=1, weeks_in_season=18,
        )
        names = list(FEATURE_NAMES)
        assert vector[names.index("off_bye_home")] == 0.0
        assert vector[names.index("off_bye_away")] == 0.0
        assert vector[names.index("rest_diff")] == 0.0

    def test_a_real_bye_is_flagged(self):
        builder = self._builder()
        builder.observe(
            _row("g", "2024-09-08T17:00:00+00:00", 1, 3, 24, 17, season=2024)
        )
        # Team 1 next plays 14 days later; team 2 has not played at all.
        vector = builder.vector_for(
            home_team_id=1, away_team_id=2,
            home_elo=1500.0, away_elo=1500.0,
            kickoff=datetime(2024, 9, 22, 17, tzinfo=timezone.utc),
            week=3, weeks_in_season=18,
        )
        assert vector[list(FEATURE_NAMES).index("off_bye_home")] == 1.0

    def test_division_games_are_flagged(self):
        builder = self._builder()
        kickoff = datetime(2024, 9, 8, 17, tzinfo=timezone.utc)
        same = builder.vector_for(
            home_team_id=1, away_team_id=2, home_elo=1500.0, away_elo=1500.0,
            kickoff=kickoff, week=1, weeks_in_season=18,
        )
        other = builder.vector_for(
            home_team_id=1, away_team_id=3, home_elo=1500.0, away_elo=1500.0,
            kickoff=kickoff, week=1, weeks_in_season=18,
        )
        idx = list(FEATURE_NAMES).index("division_game")
        assert same[idx] == 1.0 and other[idx] == 0.0

    def test_elo_diff_carries_no_home_advantage(self):
        """It is `neutral_site` and the intercept that carry it. Folding it in
        here makes the two collinear."""
        builder = self._builder()
        kickoff = datetime(2024, 9, 8, 17, tzinfo=timezone.utc)
        vector = builder.vector_for(
            home_team_id=1, away_team_id=3, home_elo=1500.0, away_elo=1500.0,
            kickoff=kickoff, week=1, weeks_in_season=18,
        )
        assert vector[list(FEATURE_NAMES).index("elo_diff")] == 0.0

    def test_observe_scheduled_advances_the_clock_without_inventing_a_result(self):
        builder = self._builder()
        builder.observe(
            _row("g", "2024-09-08T17:00:00+00:00", 1, 2, 24, 17, season=2024)
        )
        before = builder.states[1].mean_margin()
        builder.observe_scheduled(
            1, 2, datetime(2024, 9, 15, 17, tzinfo=timezone.utc)
        )
        # The clock moved; the record did not.
        assert builder.states[1].last_played == datetime(
            2024, 9, 15, 17, tzinfo=timezone.utc
        )
        assert builder.states[1].mean_margin() == before

    def test_mismatched_sequences_are_refused(self):
        builder = self._builder()
        with pytest.raises(ValueError, match="same games"):
            builder.build([1, 2], [_row("a", "2024-09-08T17:00:00+00:00", 1, 2, 1, 0)])


class TestSkewGuards:
    def test_dead_feature_blocks_compares_variance_not_names(self):
        """The sibling's train/serve bug had matching names and differing
        values, so a name check would have passed it."""
        train = np.array([[1.0, 5.0], [2.0, 6.0], [3.0, 7.0]])
        served = np.array([[1.0, 0.0], [2.0, 0.0], [3.0, 0.0]])
        assert dead_feature_blocks(train, served, ("alive", "dead")) == ["dead"]

    def test_no_false_positive_when_serving_matches(self):
        train = np.array([[1.0, 5.0], [2.0, 6.0], [3.0, 7.0]])
        assert dead_feature_blocks(train, train, ("a", "b")) == []

    def test_a_different_width_is_not_the_same_model(self):
        with pytest.raises(ValueError, match="not the same model"):
            dead_feature_blocks(np.ones((3, 2)), np.ones((3, 3)), ("a", "b"))

    def test_constant_features_catches_what_dead_blocks_cannot(self):
        """A feature dead in BOTH training and serving is invisible to a
        train/serve comparison. `turnover_diff` was exactly that."""
        train = np.array([[1.0, 0.0], [2.0, 0.0], [3.0, 0.0]])
        assert constant_features(train, ("alive", "dead")) == ["dead"]
