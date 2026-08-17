"""Tests for playoff seeding and the accuracy diagnostics.

The seeding cases are not invented. Each one is a real conference-season where
the reconstruction disagreed with the postseason that actually played, and each
is a different step of the league's procedure.
"""

from __future__ import annotations

import pytest

from backend.scripts.benchmark_market import (
    _lattice_pit,
    _norm_ppf,
    pit_histogram,
    reliability,
)
from backend.services.playoffs.bracket import TeamRecord, seed_conference

CONF = "American Football Conference"


def team(
    team_id: int,
    wins: float,
    losses: float,
    division: str,
    *,
    ties: float = 0.0,
    division_pct: float = 0.5,
    conference_pct: float = 0.5,
    conference: str = CONF,
) -> TeamRecord:
    """A record with the derived percentages set directly.

    Division and conference records are expressed as percentages here rather
    than as counts, because every case below turns on the percentage and
    spelling out plausible game counts would only obscure which number the
    test is about.
    """
    return TeamRecord(
        team_id=team_id,
        wins=wins,
        losses=losses,
        ties=ties,
        division=division,
        conference=conference,
        division_wins=division_pct * 6,
        division_games=6,
        conference_wins=conference_pct * 12,
        conference_games=12,
    )


def _field(season: int, records, head_to_head=None):
    return [r.team_id for r in seed_conference(records, season, head_to_head=head_to_head)]


def _four_divisions(extra):
    """Four division winners plus whatever the case under test adds.

    A conference needs all four divisions represented or `seed_conference`
    returns a short field and the assertion is about the wrong thing.
    """
    base = [
        team(101, 14, 3, "North", division_pct=0.9, conference_pct=0.9),
        team(102, 13, 4, "South", division_pct=0.9, conference_pct=0.8),
        team(103, 12, 5, "East", division_pct=0.9, conference_pct=0.7),
        team(104, 11, 6, "West", division_pct=0.9, conference_pct=0.7),
    ]
    return base + extra


# ------------------------------------------------------ cross-division rule


def test_wildcards_are_ordered_on_conference_record_not_division_record():
    """The bug that shipped: division record is not a cross-division tiebreaker.

    Two 9-8 wild-card contenders in different divisions. `a` has the better
    DIVISION record, `b` the better CONFERENCE record. The league compares
    conference record; comparing division record ranks a team by the weakness
    of the three clubs it happened to share a division with.
    """
    a = team(201, 9, 8, "North", division_pct=1.0, conference_pct=0.4)
    b = team(202, 9, 8, "South", division_pct=0.2, conference_pct=0.8)
    field = _field(2020, _four_divisions([a, b]))
    assert field.index(202) < field.index(201)


# --------------------------------------------------- same-division wildcards


def test_same_division_wildcards_use_head_to_head_first():
    """2025 NFC: Carolina and Atlanta both 8-9 in the NFC South.

    Carolina won the head-to-head. Atlanta had the better conference record. A
    flat cross-division sort takes Atlanta, which is a tiebreaker the league
    never reaches for two clubs in one division that did not split.
    """
    car = team(301, 8, 9, "South", division_pct=0.5, conference_pct=0.5)
    atl = team(302, 8, 9, "South", division_pct=0.5, conference_pct=0.583)
    field = _field(
        2020, _four_divisions([car, atl]), head_to_head={(301, 302): 1.0, (302, 301): 0.0}
    )
    assert field.index(301) < field.index(302)


def test_same_division_wildcards_fall_to_division_record_when_split():
    """2006 AFC: Kansas City and Denver both 9-7 in the AFC West, split.

    Head-to-head says nothing, so the division tiebreaker's next step decides:
    division record, .667 to .500. Conference record — where Denver was ahead —
    is below it and never reached.
    """
    kc = team(401, 9, 7, "West", division_pct=0.667, conference_pct=0.417)
    den = team(402, 9, 7, "West", division_pct=0.5, conference_pct=0.667)
    field = _field(
        2020, _four_divisions([kc, den]), head_to_head={(401, 402): 0.5, (402, 401): 0.5}
    )
    assert field.index(401) < field.index(402)


def test_division_winners_still_outrank_every_wildcard():
    """A 9-8 division champion hosts a 13-4 wild card. Not an edge case."""
    champion = team(501, 9, 8, "North", division_pct=0.6, conference_pct=0.5)
    wildcard = team(502, 13, 4, "South", division_pct=0.5, conference_pct=0.9)
    records = [
        champion,
        team(503, 5, 12, "North", division_pct=0.2, conference_pct=0.2),
        team(504, 14, 3, "South", division_pct=0.9, conference_pct=0.9),
        wildcard,
        team(505, 10, 7, "East", division_pct=0.7, conference_pct=0.6),
        team(506, 10, 7, "West", division_pct=0.7, conference_pct=0.6),
    ]
    field = _field(2020, records)
    assert field.index(501) < field.index(502)
    assert field.index(501) < 4  # a division winner takes a top-four seed


# --------------------------------------------------------------- sweep rule


def test_three_way_group_resolved_by_a_sweep():
    """One club that beat both others goes to the top of the group."""
    a = team(601, 9, 8, "North", conference_pct=0.4)
    b = team(602, 9, 8, "South", conference_pct=0.8)
    c = team(603, 9, 8, "East", conference_pct=0.6)
    h2h = {
        (601, 602): 1.0, (602, 601): 0.0,
        (601, 603): 1.0, (603, 601): 0.0,
        (602, 603): 0.5, (603, 602): 0.5,
    }
    field = _field(2020, _four_divisions([a, b, c]), head_to_head=h2h)
    assert field.index(601) < field.index(602)
    assert field.index(601) < field.index(603)


def test_a_head_to_head_cycle_falls_through_rather_than_inventing_an_order():
    """A beat B, B beat C, C beat A — no sweep, so records decide.

    The point of this test is that the result is the RECORD order and is
    stable, rather than an order that depends on which team happened to be
    first in the input list.
    """
    a = team(701, 9, 8, "North", conference_pct=0.4)
    b = team(702, 9, 8, "South", conference_pct=0.8)
    c = team(703, 9, 8, "East", conference_pct=0.6)
    h2h = {
        (701, 702): 1.0, (702, 701): 0.0,
        (702, 703): 1.0, (703, 702): 0.0,
        (703, 701): 1.0, (701, 703): 0.0,
    }
    forward = _field(2020, _four_divisions([a, b, c]), head_to_head=h2h)
    backward = _field(2020, _four_divisions([c, b, a]), head_to_head=h2h)
    assert forward == backward
    assert forward.index(702) < forward.index(703) < forward.index(701)


def test_seeding_returns_exactly_the_field_size_for_the_era():
    records = _four_divisions([
        team(800 + i, 8, 9, ["North", "South", "East", "West"][i % 4],
             conference_pct=0.5 - i * 0.01)
        for i in range(8)
    ])
    assert len(seed_conference(records, 2020)) == 7
    assert len(seed_conference(records, 2019)) == 6


# ------------------------------------------------------------- diagnostics


def test_reliability_drops_empty_buckets_rather_than_zeroing_them():
    """An empty bucket has no observed rate; 0.0 would read as a disaster.

    Ten bins, two of them populated — the result has two rows, not ten with
    eight zeros. This model never says 5%, so the real chart is missing its
    leftmost bucket for exactly this reason.
    """
    buckets = reliability([0.55, 0.58, 0.62], [1.0, 0.0, 1.0])
    assert [b["lower"] for b in buckets] == [0.5, 0.6]
    assert buckets[0]["count"] == 2
    assert buckets[0]["observed"] == pytest.approx(0.5)
    assert buckets[0]["mean_predicted"] == pytest.approx(0.565)
    assert buckets[1]["count"] == 1
    assert buckets[1]["observed"] == pytest.approx(1.0)


def test_reliability_puts_a_probability_of_one_in_the_last_bucket():
    """The top edge is inclusive, or a certainty falls out of the chart."""
    buckets = reliability([1.0], [1.0])
    assert len(buckets) == 1
    assert buckets[0]["upper"] == 1.0


class _Forecast:
    """The two attributes `_lattice_pit` reads."""

    def __init__(self, lattice, pmf):
        self.lattice = lattice
        self.lattice_pmf = pmf


def test_mid_p_transform_is_centred_on_the_cell_it_lands_in():
    """`F(k-1) + 0.5 * P(k)`, which is what makes the PIT usable on a lattice.

    An ordinary `F(y)` on a three-cell distribution can only ever return three
    values, so its histogram is spiky however good the forecast is.
    """
    forecast = _Forecast([-1, 0, 1], [0.25, 0.5, 0.25])
    assert _lattice_pit(forecast, -1) == pytest.approx(0.125)
    assert _lattice_pit(forecast, 0) == pytest.approx(0.5)
    assert _lattice_pit(forecast, 1) == pytest.approx(0.875)


def test_pit_histogram_of_a_uniform_sample_is_flat():
    values = [(i + 0.5) / 1000 for i in range(1000)]
    block = pit_histogram(values)
    assert block["n"] == 1000
    assert all(b["count"] == 100 for b in block["buckets"])
    assert block["chi_square"] == pytest.approx(0.0, abs=1e-9)
    # No p-value is published, deliberately — see the docstring on the helper.
    assert "p_value" not in block


def test_inverse_normal_matches_the_textbook_quantiles():
    assert _norm_ppf(0.975) == pytest.approx(1.95996, abs=1e-4)
    assert _norm_ppf(0.9) == pytest.approx(1.28155, abs=1e-4)
    assert _norm_ppf(0.5) == pytest.approx(0.0, abs=1e-6)
