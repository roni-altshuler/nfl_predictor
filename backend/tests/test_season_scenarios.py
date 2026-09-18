import json
import numpy as np
import pytest
from backend.services.simulation.season_simulator import SeasonSimulator, Fixture
from backend.scripts.build_playoff_scenarios import scenario_payload


def teams():
    return [dict(team_id=i, abbreviation=f'T{i}', display_name=f'Team {i}', conference='AFC', division='AFC East' if i < 3 else 'AFC West', elo=1500) for i in (1, 2, 3)]


def game(h, a, hs, aw):
    return dict(home_team_id=h, away_team_id=a, home_score=hs, away_score=aw)


def test_actual_head_to_head_changes_the_division_winner():
    result = SeasonSimulator(simulations=2).run(2026, teams(), [game(2, 1, 21, 10), game(1, 3, 21, 10), game(3, 2, 21, 10)], [])
    by_id = {t.team_id: t for t in result.teams}
    assert by_id[2].p_division == 1
    assert by_id[1].p_division == 0


def test_simulated_head_to_head_changes_the_division_winner():
    result = SeasonSimulator(simulations=400, shock_sd=0).run(2026, teams(), [game(1, 3, 21, 10), game(3, 2, 21, 10)], [Fixture(2, 1, 1.0, 0, game_id='a')], scenario_game_ids=['a'])
    by_id = {t.team_id: t for t in result.teams}
    assert by_id[2].p_division == 1
    assert by_id[1].p_division == 0
    branch = result.scenarios[0]['branches']['home']
    assert branch['samples'] == 400
    assert next(t for t in branch['teams'] if t['team_id'] == 2)['p_division'] == 1


def test_head_to_head_averages_rematches_and_ties(monkeypatch):
    import backend.services.simulation.season_simulator as module
    original = module.seed_conference
    seen = []
    def capture(*args, **kwargs):
        seen.append(kwargs['head_to_head'])
        return original(*args, **kwargs)
    monkeypatch.setattr(module, 'seed_conference', capture)
    SeasonSimulator(simulations=1).run(2026, teams(), [game(1, 2, 20, 10), game(2, 1, 14, 14)], [Fixture(2, 1, 1, 0)])
    assert seen[0][(1, 2)] == .5
    assert seen[0][(2, 1)] == .5


def test_scenarios_are_a_partition_and_do_not_change_baseline():
    sim = SeasonSimulator(simulations=2000)
    fixture = Fixture(1, 2, .55, 0, game_id='123')
    a = sim.run(2026, teams(), [], [fixture], scenario_game_ids=['123'])
    b = sim.run(2026, list(reversed(teams())), [], [fixture])
    assert a.as_dict() == b.as_dict()
    branches = a.scenarios[0]['branches']
    assert sum(x['samples'] for x in branches.values()) == 2000
    assert branches['tie'] == dict(samples=0, available=False, teams=[])
    for t in a.teams:
        weighted = sum(x['samples'] * next(r for r in x['teams'] if r['team_id'] == t.team_id)['p_division'] for x in branches.values() if x['available']) / 2000
        assert weighted == pytest.approx(t.p_division, abs=1e-6)
    for branch in branches.values():
        for t in branch['teams']:
            lo, hi = t['playoff_mc_interval']
            assert 0 <= lo <= t['p_playoffs'] <= hi <= 1


def test_fixture_order_does_not_move_seeded_probabilities():
    fixtures = [Fixture(1, 2, .55, .01, game_id='1'), Fixture(3, 2, .6, .01, game_id='2')]
    sim = SeasonSimulator(simulations=50)
    assert sim.run(2026, teams(), [], fixtures).as_dict() == sim.run(2026, teams()[::-1], [], fixtures[::-1]).as_dict()


@pytest.mark.parametrize('fixture', [Fixture(1, 2, np.nan, 0), Fixture(1, 2, .8, .3), Fixture(1, 1, .5, 0), Fixture(1, 99, .5, 0)])
def test_invalid_fixtures_fail_instead_of_disappearing(fixture):
    with pytest.raises(ValueError):
        SeasonSimulator(simulations=1).run(2026, teams(), [], [fixture])


def test_payload_binds_to_source_forecasts():
    raw = json.dumps(dict(season=2026, generated_at='2026-09-18T00:00:00Z', model_version='test')).encode()
    r = SeasonSimulator(simulations=1).run(2026, teams(), [], [], generated_at='2026-09-18T00:00:00Z')
    payload = scenario_payload(r, raw)
    assert len(payload['forecast_sha256']) == 64
    assert payload['simulation_version'] == 'nfl-season-h2h-2'
    r.season = 2025
    with pytest.raises(ValueError):
        scenario_payload(r, raw)
