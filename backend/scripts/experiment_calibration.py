"""Temporal blend/calibration challenger on earlier out-of-sample predictions.

Fixed protocol: convex Brier blend of margin and Elo; sigmoid calibration with
identity shrinkage 10. Fit only on earlier OOS weeks, with a one-day result lag.
Evaluation starts in 2022 after at least 500 prior OOS predictions. This is an
exploratory comparison, never automatic production promotion.
"""
from __future__ import annotations
import argparse
from collections import defaultdict
from datetime import datetime, timedelta
import hashlib
import json
from pathlib import Path
import numpy as np
from backend.scripts.experiment_recency import blocked_bootstrap


def expit(z):
    return 1 / (1 + np.exp(np.clip(-np.asarray(z), -700, 700)))


def logit(p):
    return np.log(p / (1-p))


def fit_transform(train, targets):
    a = np.array([r['incumbent'] for r in train])
    b = np.array([r['elo'] for r in train])
    y = np.array([r['home_won'] for r in train], dtype=float)
    if len(a) < 500 or not np.isfinite(np.r_[a,b,y]).all() or ((a<0)|(a>1)|(b<0)|(b>1)).any():
        raise ValueError('500 valid prior out-of-sample forecasts required')
    diff = a-b
    weight = float(np.clip(np.dot(y-b,diff) / max(np.dot(diff,diff),1e-12),0,1))
    x = logit(np.clip(weight*a+(1-weight)*b,1e-6,1-1e-6))
    def objective(theta):
        z=theta[0]+theta[1]*x
        residual=expit(z)-y
        penalty=10*np.array([theta[0],theta[1]-1])
        return float(np.sum(np.logaddexp(0,z)-y*z)+5*(theta[0]**2+(theta[1]-1)**2)), np.array([residual.sum(),np.dot(residual,x)])+penalty
    theta=np.array([0.0,1.0])
    for _ in range(100):
        loss,gradient=objective(theta)
        probabilities=expit(theta[0]+theta[1]*x)
        curvature=probabilities*(1-probabilities)
        hessian=np.array([[curvature.sum()+10,np.dot(curvature,x)],
                          [np.dot(curvature,x),np.dot(curvature,x*x)+10]])
        step=np.linalg.solve(hessian,gradient)
        if np.linalg.norm(step)<1e-8:
            break
        scale=1.0
        while objective(theta-scale*step)[0]>loss and scale>1e-8:
            scale*=.5
        theta-=scale*step
    else:
        raise ValueError('calibration did not converge')
    blend=np.array([weight*r['incumbent']+(1-weight)*r['elo'] for r in targets])
    calibrated=expit(theta[0]+theta[1]*logit(np.clip(blend,1e-6,1-1e-6)))
    return calibrated,dict(margin_weight=weight,intercept=float(theta[0]),slope=float(theta[1]))


def evaluate(rows, from_season=2022):
    groups=defaultdict(list)
    for r in rows:
        if int(r['season']) >= from_season:
            groups[(r['season'],r['season_type'],r['week'])].append(r)
    scored=[]
    for key, targets in sorted(groups.items()):
        cutoff=min(datetime.fromisoformat(r['kickoff'].replace('Z','+00:00')) for r in targets)-timedelta(days=1)
        train=[r for r in rows if datetime.fromisoformat(r['kickoff'].replace('Z','+00:00')) < cutoff]
        if len(train)<500:
            continue
        ps,params=fit_transform(train,targets)
        last=max(r['kickoff'] for r in train)
        for r,prob in zip(targets,ps):
            scored.append({**{k:r[k] for k in ('game_id','season','season_type','week','kickoff','home_won','incumbent','elo','market')},
                'candidate':float(prob),'fixed_blend':(r['incumbent']+r['elo'])/2,
                'calibration_rows':len(train),'latest_calibration_kickoff':last,'cutoff':cutoff.isoformat(),**params})
    return scored


def summarize(rows):
    if not rows:
        raise ValueError('no eligible evaluation rows')
    y=np.array([r['home_won'] for r in rows],dtype=float)
    result={'n':len(rows)}
    for model in ('incumbent','elo','fixed_blend','candidate'):
        p=np.clip([r[model] for r in rows],1e-9,1-1e-9)
        result[model]=dict(brier=float(np.mean((p-y)**2)),log_loss=float(np.mean(-y*np.log(p)-(1-y)*np.log1p(-p))),accuracy=float(np.mean((p>=.5)==y)))
    blocks=[f"{r['season']}-{r['season_type']}-{r['week']}" for r in rows]
    for baseline in ('incumbent','elo'):
        result['candidate_minus_'+baseline]=blocked_bootstrap([(r['candidate']-r['home_won'])**2 for r in rows],[(r[baseline]-r['home_won'])**2 for r in rows],blocks)
    return result


def run(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,default=Path('reports/recency_experiment.json'))
    p.add_argument('--output',type=Path,default=Path('reports/calibration_experiment.json'))
    args=p.parse_args(argv)
    source=json.loads(args.source.read_text())
    rows=evaluate(source['rows'])
    result=dict(protocol='earlier_oos_convex_blend_sigmoid_identity_penalty_10',production_eligible=False,
        promotion='held for untouched prospective validation; binary probabilities are not reconciled to the served margin lattice',
        basis='exploratory_historical_walk_forward', source_sha256=hashlib.sha256(args.source.read_bytes()).hexdigest(),
        code_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        corpus_latest=source['corpus_latest'],summary=summarize(rows),
        by_season={str(s):summarize([r for r in rows if r['season']==s]) for s in sorted({r['season'] for r in rows})},rows=rows)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    print(json.dumps(result['summary'],indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(run())
