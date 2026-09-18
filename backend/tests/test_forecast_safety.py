"""Regression checks for immutable history and temporal evaluation boundaries."""
from datetime import datetime, timezone, timedelta
import numpy as np
import pytest
from backend.services.data.warehouse import Warehouse
from backend.scripts.score_live import assert_history_preserved
from backend.scripts.verify_snapshot_history import verify
from backend.scripts.benchmark_market import paired_bootstrap, week_key, training_base_rate
from backend.scripts.experiment_recency import blocked_bootstrap, recency_weights
from backend.services.prediction.margin_model import MarginModel


def snapshot(**changes):
    return dict(dict(fixture_uid='1',generated_at='2026-09-01T10:00:00Z',model_version='v1',
        season=2026,week=1,kickoff_utc='2026-09-10T18:00:00Z',home_team='BUF',away_team='DET',
        p_home=.6,p_away=.39,p_tie=.01),**changes)


def warehouse(path):
    w=Warehouse(path);w.migrate();return w


def test_snapshots_are_immutable_and_identical_retries_work(tmp_path):
    w=warehouse(tmp_path/'db');w.record_predictions([snapshot()]);w.record_predictions([snapshot()])
    assert w.count('prediction_snapshots')==1
    with pytest.raises(ValueError,match='immutable'):
        w.record_predictions([snapshot(p_home=.7,p_away=.29)])
    assert w.earliest_predictions(2026)[0]['p_home']==.6


def test_snapshot_conflict_rolls_back_batch(tmp_path):
    w=warehouse(tmp_path/'db');w.record_predictions([snapshot()])
    with pytest.raises(ValueError):
        w.record_predictions([snapshot(fixture_uid='2'),snapshot(p_home=.8)])
    assert w.count('prediction_snapshots')==1


def test_earliest_uses_instants_and_counts_each_fixture_once(tmp_path):
    w=warehouse(tmp_path/'db')
    w.record_predictions([snapshot(generated_at='2026-09-01T11:00:00+03:00'),snapshot(),
        snapshot(model_version='v2',generated_at='2026-09-01T11:00:00+03:00'),
        snapshot(fixture_uid='2',generated_at='2026-09-10T19:00:00Z')])
    rows=w.earliest_predictions(2026)
    assert len(rows)==1
    assert rows[0]['generated_at']=='2026-09-01T11:00:00+03:00'
    assert rows[0]['model_version']=='v1'


def test_history_comparison_detects_replacement_even_with_same_count(tmp_path):
    a,b=tmp_path/'a',tmp_path/'b'
    wa,wb=warehouse(a),warehouse(b)
    wa.record_predictions([snapshot()]);wb.record_predictions([snapshot()])
    assert verify(a,b)==1
    wb.conn.execute('UPDATE prediction_snapshots SET p_home=.9');wb.conn.commit()
    with pytest.raises(ValueError,match='missing or modified'):verify(a,b)


def test_live_record_cannot_shrink_or_change_forecast():
    game=dict(game_id='1',generated_at='before',model_version='v1',home='BUF',away='DET',p_home=.6,p_away=.39,p_tie=.01,exp_margin=3)
    old=dict(forecasts_made=272,games=[game])
    with pytest.raises(ValueError):assert_history_preserved(old,dict(forecasts_made=271,games=[game]))
    with pytest.raises(ValueError):assert_history_preserved(old,dict(forecasts_made=272,games=[]))
    with pytest.raises(ValueError):assert_history_preserved(old,dict(forecasts_made=272,games=[dict(game,p_home=.7)]))
    assert_history_preserved(old,dict(forecasts_made=272,games=[dict(game,home_score=20)]))


def test_regular_and_postseason_weeks_are_different():
    assert week_key(dict(season=2025,season_type=2,week=1)) != week_key(dict(season=2025,season_type=3,week=1))
    assert training_base_rate([-1,2,0,4]) == pytest.approx(2/3)


def test_chunked_bootstrap_matches_original_rng():
    a=np.arange(13)/13;b=np.full(13,.25)
    expected=(a-b)[np.random.default_rng(42).integers(0,13,size=(333,13))].mean(axis=1)
    actual=paired_bootstrap(a,b,draws=333,seed=42)
    assert actual['lo']==pytest.approx(np.percentile(expected,2.5))
    assert actual['hi']==pytest.approx(np.percentile(expected,97.5))


def test_block_bootstrap_resamples_whole_weeks_and_weights_games():
    result=blocked_bootstrap([1,1,0],[0,0,0],['a','a','b'],draws=1000)
    assert result['mean']==pytest.approx(2/3)
    assert result['blocks']==2
    assert result['lo']==0 and result['hi']==1
    with pytest.raises(ValueError):blocked_bootstrap([np.nan],[0],['a'])


def test_recency_rejects_future_and_decays_at_declared_half_life():
    cutoff=datetime(2026,1,1,tzinfo=timezone.utc)
    assert recency_weights([cutoff-timedelta(days=3*365.25)],cutoff)[0]==pytest.approx(.5)
    with pytest.raises(ValueError):recency_weights([cutoff],cutoff)


def test_optional_weighting_preserves_unweighted_model():
    rng=np.random.default_rng(7);X=rng.normal(size=(600,2));m=rng.integers(-30,31,size=600);t=rng.integers(10,80,size=600)
    a,b=MarginModel(),MarginModel()
    a.fit(X,m,t,['a','b']);b.fit(X,m,t,['a','b'],sample_weight=np.ones(600))
    np.testing.assert_allclose(a._margin_coef,b._margin_coef)
    np.testing.assert_allclose(a.key_weights,b.key_weights)
    assert a.params.margin_sd==b.params.margin_sd
    with pytest.raises(ValueError):b.fit(X,m,t,['a','b'],sample_weight=np.zeros(600))


def test_conflicting_keys_in_one_batch_are_rejected(tmp_path):
    w=warehouse(tmp_path/'db')
    with pytest.raises(ValueError):
        w.record_predictions([snapshot(),snapshot(p_home=.8)])
    assert w.count('prediction_snapshots')==0


def test_live_scorer_excludes_invalid_and_post_actual_kickoff(tmp_path, monkeypatch):
    from backend.scripts import score_live
    from backend.services.data.warehouse import GameRow
    import json
    w=warehouse(tmp_path/'db')
    w.upsert_competition('nfl','NFL','league')
    h=w.upsert_team('1','Buffalo Bills',abbreviation='BUF')
    a=w.upsert_team('2','Detroit Lions',abbreviation='DET')
    rows=[]
    for game_id in ('1','2','3'):
        rows.append(GameRow(game_id=game_id,source='test',competition_id='nfl',season=2026,
            season_type=2,week=1,date_utc='2026-09-10T18:00:00Z',home_team_id=h,away_team_id=a,
            home_score=21,away_score=14))
    w.upsert_games(rows)
    w.record_predictions([snapshot(),snapshot(fixture_uid='2',p_home=None),
        snapshot(fixture_uid='3',generated_at='2026-09-10T19:00:00Z',kickoff_utc='2026-09-11T18:00:00Z')])
    monkeypatch.setattr(score_live,'get_warehouse',lambda *args:w)
    monkeypatch.setattr(score_live,'OUT',tmp_path/'out')
    assert score_live.run(['--season','2026'])==0
    result=json.loads((tmp_path/'out'/'forecast_log.json').read_text())
    assert result['n']==1
    assert result['invalid_excluded']==2
    assert result['cohorts']['horizon']['7_days_or_more']['n']==1
    assert result['cohorts']['horizon']['under_24h']['brier'] is None
