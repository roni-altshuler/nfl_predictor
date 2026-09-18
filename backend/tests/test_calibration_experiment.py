from datetime import datetime, timedelta, timezone
import numpy as np
from backend.scripts.experiment_calibration import evaluate, fit_transform


def rows():
    rng=np.random.default_rng(23)
    return [dict(game_id=str(i),season=2021 if i<600 else 2022,season_type=2,week=1 if i<600 else 2,
        kickoff=(datetime(2019,1,1,tzinfo=timezone.utc)+timedelta(days=i)).isoformat(),
        home_won=bool(rng.random()<.56),incumbent=float(rng.uniform(.3,.8)),elo=float(rng.uniform(.3,.8)),market=None) for i in range(616)]


def test_calibration_never_learns_from_target_week():
    source=rows()
    original=evaluate(source)
    changed=[{**r,'home_won':not r['home_won']} if r['season']==2022 else r for r in source]
    second=evaluate(changed)
    assert len(original)==16
    assert [r['candidate'] for r in original] == [r['candidate'] for r in second]
    for r in original:
        assert datetime.fromisoformat(r['latest_calibration_kickoff']) < datetime.fromisoformat(r['cutoff']) < datetime.fromisoformat(r['kickoff'])
        assert 0 < r['candidate'] < 1
        assert 0 <= r['margin_weight'] <= 1


def test_identity_calibration_stays_finite_with_constant_forecasts():
    source=[dict(incumbent=.5,elo=.5,home_won=i%2==0) for i in range(500)]
    prediction,params=fit_transform(source,[dict(incumbent=.5,elo=.5)])
    assert prediction[0] == .5
    assert np.isfinite(list(params.values())).all()
