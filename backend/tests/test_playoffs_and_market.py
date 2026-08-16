"""Playoff seeding, the bracket, and market mathematics."""

from __future__ import annotations

import pytest

from backend.services.playoffs.bracket import (
    TeamRecord,
    byes_per_conference,
    field_size,
    seed_conference,
    seeds_per_conference,
    simulate_conference,
    simulate_postseason,
)
from backend.services.prediction import market as mkt


def _record(team_id, wins, losses, ties=0, division="X", **kw):
    return TeamRecord(
        team_id=team_id, wins=wins, losses=losses, ties=ties,
        division=division, conference="AFC", **kw
    )


class TestEraShape:
    def test_field_expanded_in_2020(self):
        assert seeds_per_conference(2019) == 6
        assert seeds_per_conference(2020) == 7
        assert byes_per_conference(2019) == 2
        assert byes_per_conference(2020) == 1
        assert field_size(2019) == 12
        assert field_size(2020) == 14


class TestSeeding:
    def test_a_division_winner_outranks_a_better_wild_card(self):
        """The rule that makes this module necessary.

        A 9-8 division champion is seeded ahead of a 13-4 wild card. Sorting
        on record alone — which is what the NBA sibling does, correctly, for
        basketball — gets this backwards.
        """
        records = [
            _record(1, 9, 8, division="AFC East"),
            _record(2, 8, 9, division="AFC East"),
            _record(3, 13, 4, division="AFC North"),
            _record(4, 12, 5, division="AFC North"),
            _record(5, 11, 6, division="AFC South"),
            _record(6, 4, 13, division="AFC South"),
            _record(7, 10, 7, division="AFC West"),
            _record(8, 3, 14, division="AFC West"),
        ]
        seeds = seed_conference(records, 2024)
        ids = [r.team_id for r in seeds]

        # Division winners (3, 5, 7, 1) take seeds 1-4 in record order.
        assert ids[:4] == [3, 5, 7, 1]
        # The 12-5 team is a wild card and is seeded BELOW the 9-8 champion.
        assert ids.index(4) > ids.index(1)

    def test_ties_count_as_half_a_win(self):
        """16-0-1 finishes ahead of 16-1-0."""
        a = _record(1, 16, 0, ties=1, division="A")
        b = _record(2, 16, 1, ties=0, division="B")
        assert a.win_pct > b.win_pct

    def test_head_to_head_breaks_a_two_way_division_tie(self):
        records = [
            _record(1, 10, 7, division="AFC East"),
            _record(2, 10, 7, division="AFC East"),
            _record(3, 9, 8, division="AFC North"),
            _record(4, 9, 8, division="AFC South"),
            _record(5, 9, 8, division="AFC West"),
        ]
        # Team 2 beat team 1.
        seeds = seed_conference(
            records, 2024, head_to_head={(1, 2): 0.0, (2, 1): 1.0}
        )
        winners = [r.team_id for r in seeds[:4]]
        assert 2 in winners and 1 not in winners

    def test_seeding_is_deterministic(self):
        """A coin-flip tiebreak inside a Monte Carlo adds variance that looks
        like uncertainty and is not."""
        records = [_record(i, 9, 8, division=f"D{i % 4}") for i in range(1, 9)]
        first = [r.team_id for r in seed_conference(records, 2024)]
        second = [r.team_id for r in seed_conference(list(reversed(records)), 2024)]
        assert first == second


class TestBracket:
    def test_modern_wild_card_pairings(self):
        log = []
        simulate_conference(
            [1, 2, 3, 4, 5, 6, 7], 2024, lambda h, a, n: min(h, a), log=log
        )
        wc = [(g.home_seed, g.away_seed) for g in log if g.round_slug == "wild-card"]
        assert wc == [(2, 7), (3, 6), (4, 5)]

    def test_legacy_wild_card_pairings(self):
        log = []
        simulate_conference(
            [1, 2, 3, 4, 5, 6], 2019, lambda h, a, n: min(h, a), log=log
        )
        wc = [(g.home_seed, g.away_seed) for g in log if g.round_slug == "wild-card"]
        assert wc == [(3, 6), (4, 5)]

    def test_the_bracket_reseeds(self):
        """If the 6 upsets the 3, the 1 seed must face the 6 — not a fixed
        bracket slot."""
        log = []
        simulate_conference(
            [1, 2, 3, 4, 5, 6, 7], 2024,
            lambda h, a, n: 6 if {h, a} == {3, 6} else min(h, a),
            log=log,
        )
        div = [(g.home_seed, g.away_seed) for g in log if g.round_slug == "divisional"]
        assert (1, 6) in div

    def test_wrong_seed_count_is_refused(self):
        with pytest.raises(ValueError, match="seeds"):
            simulate_conference([1, 2, 3, 4, 5, 6], 2024, lambda h, a, n: h)

    def test_the_super_bowl_is_neutral(self):
        seen = {}

        def play(home, away, neutral):
            seen[(home, away)] = neutral
            return home

        simulate_postseason(
            list(range(1, 8)), list(range(11, 18)), 2024, play
        )
        # The last game played is the Super Bowl, between the two champions.
        assert seen[(1, 11)] is True
        # A conference game is not neutral.
        assert seen[(1, 4)] is False


class TestMarket:
    def test_shin_and_proportional_agree_near_even_money(self):
        shin = mkt.devig_shin(-110, -110)[0]
        prop = mkt.devig_proportional(-110, -110)[0]
        assert abs(shin - prop) < 0.003

    def test_shin_and_proportional_diverge_at_a_heavy_favourite(self):
        shin = mkt.devig_shin(-1000, 650)[0]
        prop = mkt.devig_proportional(-1000, 650)[0]
        assert abs(shin - prop) > 0.01
        # Shin attributes part of the overround to insiders, so it puts MORE
        # on the favourite.
        assert shin > prop

    def test_one_leg_is_not_a_market(self):
        assert not mkt.has_complete_odds(-110, None)
        assert not mkt.has_complete_odds(0, -110)
        assert mkt.has_complete_odds(-110, -110)

    def test_a_nonsense_booksum_is_refused(self):
        with pytest.raises(mkt.InvalidOddsError):
            mkt.devig_proportional(-10000, -10000)

    def test_conditioning_on_a_decided_game(self):
        """A moneyline voids on a tie, so the model must be conditioned
        before it meets one."""
        home, away = mkt.conditional_from_three(0.55, 0.01, 0.44)
        assert home + away == pytest.approx(1.0)
        assert home == pytest.approx(0.55 / 0.99)

    def test_unconditional_comparison_understates_the_model(self):
        """The bias this conditioning exists to remove is one-directional."""
        p_home, p_tie, p_away = 0.55, 0.01, 0.44
        conditioned = mkt.conditional_from_three(p_home, p_tie, p_away)[0]
        assert conditioned > p_home

    def test_ties_are_excluded_and_counted(self):
        card = mkt.score_forecasts([0.6, 0.4, 0.5], [24, 17, 20], [20, 21, 20])
        assert card.n == 2
        assert card.ties_excluded == 1
        assert card.brier_ties_as_half is not None

    def test_spread_to_probability_is_monotone(self):
        favoured = mkt.spread_to_probability(-7.0)
        pickem = mkt.spread_to_probability(0.0)
        dog = mkt.spread_to_probability(+7.0)
        assert favoured > pickem > dog
        assert pickem == pytest.approx(0.5, abs=1e-9)

    def test_kelly_is_capped(self):
        assert mkt.kelly_fraction(0.99, 500) <= 0.05
