"""Publish conditional playoff outlooks from one coherent forecast snapshot.

No new game predictions, no warehouse writes. This can rebuild the outlook from
committed game forecasts, ratings and actual results when a warehouse release is
unavailable. The daily forecaster calls scenario_payload on its own simulation.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from backend.services.simulation.season_simulator import Fixture, SeasonSimulator

SIMULATION_VERSION = 'nfl-season-h2h-2'
SEEDING_NOTE = 'Head-to-head, division and conference records are applied. Common-games and deeper tiebreakers remain approximated.'


def scenario_ids(forecasts):
    upcoming = [g for g in forecasts['games'] if datetime.fromisoformat(g['date_utc'].replace('Z', '+00:00')) > datetime.fromisoformat(forecasts['generated_at'].replace('Z', '+00:00'))]
    if not upcoming:
        return []
    week = min(upcoming, key=lambda g: g['date_utc'])['week']
    return [str(g['game_id']) for g in upcoming if g['week'] == week]


def scenario_payload(result, forecast_bytes):
    forecast = json.loads(forecast_bytes)
    if result.season != forecast['season'] or result.generated_at != forecast['generated_at']:
        raise ValueError('simulation and forecast snapshots must match')
    return dict(season=result.season, generated_at=result.generated_at,
        computed_at=datetime.now(timezone.utc).isoformat(timespec='seconds'),
        model_version=forecast['model_version'], simulation_version=SIMULATION_VERSION,
        forecast_sha256=hashlib.sha256(forecast_bytes).hexdigest(),
        simulations=result.simulations, min_branch_samples=200,
        method='conditional_simulation', seeding_note=SEEDING_NOTE,
        note='Conditional frequencies in the same simulated seasons, with shared team-strength uncertainty. These are not causal effects or live updates. Intervals measure Monte Carlo precision only.',
        baseline=[dict(team_id=t.team_id, abbreviation=t.abbreviation, name=t.name,
                       p_playoffs=round(t.p_playoffs, 6), p_division=round(t.p_division, 6),
                       p_championship=round(t.p_championship, 6)) for t in result.teams],
        games=result.scenarios)


def run(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data-dir', type=Path, default=Path('backend/data'))
    p.add_argument('--sims', type=int, default=20000)
    p.add_argument('--output', type=Path)
    args = p.parse_args(argv)
    root = args.data_dir / 'predictions'
    raw = (root / 'game_forecasts.json').read_bytes()
    forecast = json.loads(raw)
    ratings = json.loads((root / 'power_ratings.json').read_text())
    projection = json.loads((root / 'season_projections.json').read_text())
    archive = json.loads((args.data_dir / 'history' / f"season_{forecast['season']}.json").read_text())
    for data in (ratings, projection):
        if (data['season'], data['generated_at']) != (forecast['season'], forecast['generated_at']):
            raise ValueError('ratings, projection and forecasts must share one publication')
    if archive['season'] != forecast['season']:
        raise ValueError('archive season mismatch')
    teams = ratings['teams']
    by_abbr = {t['abbreviation']: t for t in teams}
    if len(by_abbr) != 32:
        raise ValueError('32 unique franchises required')
    played = []
    records = {t['team_id']: [0, 0, 0] for t in teams}
    for g in archive['games']:
        if g['postseason']:
            continue
        h, a = by_abbr[g['home']]['team_id'], by_abbr[g['away']]['team_id']
        hs, aw = g['home_score'], g['away_score']
        played.append(dict(home_team_id=h, away_team_id=a, home_score=hs, away_score=aw))
        records[h][2 if hs == aw else 0 if hs > aw else 1] += 1
        records[a][2 if hs == aw else 0 if aw > hs else 1] += 1
    if len(played) != projection['games_played']:
        raise ValueError('archive results do not match the published standings')
    for t in projection['teams']:
        if records[t['team_id']] != [t['current_wins'], t['current_losses'], t['current_ties']]:
            raise ValueError('archive team record differs from the forecast snapshot')
    fixtures = [Fixture(g['home_team_id'], g['away_team_id'], g['p_home'], g['p_tie'], g['neutral_site'], g['game_id']) for g in forecast['games']]
    if len(fixtures) != projection['games_remaining']:
        raise ValueError('remaining schedule differs from the published projection')
    result = SeasonSimulator(simulations=args.sims).run(forecast['season'], teams, played, fixtures,
        generated_at=forecast['generated_at'], scenario_game_ids=scenario_ids(forecast))
    out = args.output or root / 'playoff_scenarios.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(scenario_payload(result, raw), indent=2, allow_nan=False) + '\n')
    tmp.replace(out)
    print(f'{len(result.scenarios)} fixture scenarios, {args.sims} simulations, {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(run())
