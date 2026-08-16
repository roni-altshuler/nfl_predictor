"""The margin model's invariants.

The tests that matter here are the ones pinning claims made in the module
docstring, because those claims are what the product is sold on.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from backend.services.prediction.margin_model import MarginModel, MarginModelParams


def _football_margins(n: int = 4000, seed: int = 7) -> np.ndarray:
    """A synthetic corpus with football's lattice structure.

    Built rather than loaded so the tests do not need the warehouse. The
    shape is what matters: a broadly normal spread with heavy atoms at +/-3
    and +/-7 and almost nothing at 0.
    """
    rng = np.random.default_rng(seed)
    base = rng.normal(2.0, 13.5, size=n).round()
    # Pull mass onto the key numbers, the way field goals and touchdowns do.
    for value, share in ((3, 0.10), (7, 0.06), (6, 0.03), (10, 0.03)):
        k = int(n * share)
        idx = rng.choice(n, size=k, replace=False)
        base[idx] = value * rng.choice([-1, 1], size=k)
    # Ties are rare.
    base[base == 0] = 1
    ties = rng.choice(n, size=max(int(n * 0.0024), 1), replace=False)
    base[ties] = 0
    return base


class TestLattice:
    def test_moneyline_is_the_lattice_sum(self):
        """p_home IS the mass above zero, not a second number beside it."""
        model = MarginModel()
        model.fit_key_numbers(_football_margins())
        forecast = model.forecast_from(3.5, 45.0)

        above = float(forecast.lattice_pmf[forecast.lattice > 0].sum())
        assert forecast.p_home == pytest.approx(above, abs=1e-12)

    def test_three_outcomes_sum_to_one(self):
        model = MarginModel()
        model.fit_key_numbers(_football_margins())
        for exp_margin in (-14.0, -3.0, 0.0, 2.5, 10.0):
            f = model.forecast_from(exp_margin, 45.0)
            assert f.p_home + f.p_tie + f.p_away == pytest.approx(1.0, abs=1e-9)

    def test_key_numbers_are_over_weighted(self):
        """3 and 7 must come out heavier than a normal expects; 0 lighter."""
        model = MarginModel()
        weights = model.fit_key_numbers(_football_margins())
        at = {int(k): float(w) for k, w in zip(model.lattice, weights)}

        assert at[3] > 1.5, "a 3-point margin is not being over-weighted"
        assert at[7] > 1.2, "a 7-point margin is not being over-weighted"
        assert at[0] < 0.6, "ties are not being suppressed"
        assert at[3] > at[5], "3 must outrank 5 — that is the whole point"

    def test_tie_probability_is_small_and_nonzero(self):
        """The NBA sibling has no tie branch. This one must, and it must be
        the right order of magnitude rather than merely present."""
        model = MarginModel()
        model.fit_key_numbers(_football_margins())
        f = model.forecast_from(2.2, 44.5)
        assert 0.0005 < f.p_tie < 0.02, f"p_tie={f.p_tie} is not football"

    def test_a_flat_lattice_reproduces_a_discretised_normal(self):
        """An unfitted model degrades to the sibling's behaviour, not to
        nonsense."""
        model = MarginModel()
        assert np.allclose(model.key_weights, 1.0)
        f = model.forecast_from(0.0, 44.0)
        assert f.p_home == pytest.approx(f.p_away, abs=1e-9)


class TestSpread:
    def test_push_is_real_at_a_key_number(self):
        """A -3 line pushes on a large share of games. A continuous model
        assigns that zero mass; this one must not."""
        model = MarginModel()
        model.fit_key_numbers(_football_margins())
        f = model.forecast_from(3.0, 45.0)
        home, push, away = f.cover_probabilities(-3.0)

        assert push > 0.05, f"push at -3 is only {push}"
        assert home + push + away == pytest.approx(1.0, abs=1e-9)

    def test_a_half_point_line_cannot_push(self):
        model = MarginModel()
        model.fit_key_numbers(_football_margins())
        f = model.forecast_from(3.0, 45.0)
        _home, push, _away = f.cover_probabilities(-3.5)
        assert push == pytest.approx(0.0, abs=1e-12)

    def test_push_at_three_exceeds_push_at_four(self):
        """The lattice, not the kernel, has to be driving this."""
        model = MarginModel()
        model.fit_key_numbers(_football_margins())
        f = model.forecast_from(3.5, 45.0)
        _h3, push3, _a3 = f.cover_probabilities(-3.0)
        _h4, push4, _a4 = f.cover_probabilities(-4.0)
        assert push3 > push4

    def test_cover_probability_conditions_on_no_push(self):
        model = MarginModel()
        model.fit_key_numbers(_football_margins())
        f = model.forecast_from(3.0, 45.0)
        home, push, away = f.cover_probabilities(-3.0)
        assert f.cover_probability(-3.0) == pytest.approx(
            home / (home + away), abs=1e-12
        )


class TestFit:
    def test_refuses_a_corpus_that_is_not_one(self):
        model = MarginModel()
        with pytest.raises(ValueError, match="not a corpus"):
            model.fit(
                np.ones((10, 2)), np.ones(10), np.ones(10), ("a", "b")
            )

    def test_refuses_to_fit_key_numbers_on_noise(self):
        model = MarginModel()
        with pytest.raises(ValueError, match="sparse cells"):
            model.fit_key_numbers([1, 2, 3])

    def test_intercept_is_not_penalised(self):
        """Penalising it would shrink the league's mean margin toward zero
        and quietly remove home advantage."""
        rng = np.random.default_rng(3)
        X = rng.normal(0, 1, size=(2000, 2))
        margins = 7.5 + X @ np.array([2.0, -1.0]) + rng.normal(0, 5, 2000)
        totals = 44.0 + rng.normal(0, 5, 2000)

        model = MarginModel()
        model.fit(X, margins, totals, ("a", "b"), ridge=500.0)
        # Even at an absurd penalty the intercept survives.
        assert model._margin_coef[0] == pytest.approx(7.5, abs=0.5)

    def test_serving_is_reconciled_with_the_grid_after_a_real_fit(self):
        rng = np.random.default_rng(11)
        X = rng.normal(0, 1, size=(3000, 2))
        margins = _football_margins(3000)
        totals = 44.0 + rng.normal(0, 12, 3000)

        model = MarginModel()
        model.fit(X, margins, totals, ("a", "b"))
        forecast = model.predict(X[:1])[0]
        above = float(forecast.lattice_pmf[forecast.lattice > 0].sum())
        assert forecast.p_home == pytest.approx(above, abs=1e-12)


class TestRoundTrip:
    def test_save_and_load_preserves_the_lattice(self, tmp_path):
        model = MarginModel()
        model.fit_key_numbers(_football_margins())
        before = model.forecast_from(3.0, 45.0)

        path = model.save(tmp_path / "model.json")
        restored = MarginModel.load(path)
        after = restored.forecast_from(3.0, 45.0)

        assert np.allclose(restored.key_weights, model.key_weights)
        assert after.p_home == pytest.approx(before.p_home, abs=1e-12)
        assert after.p_tie == pytest.approx(before.p_tie, abs=1e-12)
