"""Read-only, paired weekly walk-forward test of a fixed three-year decay.

No tuning on test seasons, no artifact promotion. The lattice counts keep their
full historical sample: this tests recency in the regression and residual scale.
Run with OPENBLAS_NUM_THREADS=1 python -m backend.scripts.experiment_recency.
"""
from __future__ import annotations
import argparse
from collections import defaultdict
from datetime import datetime
import hashlib
import json
from pathlib import Path
import platform
import sqlite3
import numpy as np
from backend.services.data.warehouse import Warehouse
from backend.services.espn.client import regular_season_weeks
from backend.services.prediction.feature_builder import FEATURE_NAMES, FeatureBuilder
from backend.services.prediction.margin_model import MarginModel
from backend.services.prediction import market
from backend.services.ratings.elo import EloConfig, EloRatingSystem
from backend.scripts.benchmark_market import week_key


def recency_weights(dates, cutoff, half_life_years=3.0):
    ages = np.array([(cutoff - d).total_seconds() / 86400 for d in dates])
    if not np.isfinite(half_life_years) or half_life_years <= 0 or (ages <= 0).any():
        raise ValueError('training observations must precede cutoff; half life must be positive')
    return np.exp2(-ages / (365.25 * half_life_years))


def blocked_bootstrap(a, b, blocks, draws=4000, seed=20260918):
    a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    if a.shape != b.shape or a.ndim != 1 or len(a) != len(blocks) or not len(a):
        raise ValueError('nonempty aligned pairs and blocks required')
    diff = a - b
    if not np.isfinite(diff).all() or draws < 1:
        raise ValueError('finite scores and positive draws required')
    groups = defaultdict(list)
    for d, block in zip(diff, blocks):
        groups[str(block)].append(d)
    sums = np.array([sum(v) for v in groups.values()])
    counts = np.array([len(v) for v in groups.values()])
    rng, means = np.random.default_rng(seed), np.empty(draws)
    for start in range(0, draws, 128):
        stop = min(start + 128, draws)
        idx = rng.integers(0, len(sums), size=(stop-start, len(sums)))
        means[start:stop] = sums[idx].sum(axis=1) / counts[idx].sum(axis=1)
    return dict(mean=float(diff.mean()), lo=float(np.quantile(means, .025)),
                hi=float(np.quantile(means, .975)), blocks=len(sums), draws=draws)


def run(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db', default='backend/data/warehouse.sqlite')
    p.add_argument('--output', default='reports/recency_experiment.json')
    p.add_argument('--from-season', type=int, default=2019)
    p.add_argument('--through-season', type=int, default=2025)
    args = p.parse_args(argv)
    path = Path(args.db).resolve()
    # A private in-memory copy leaves the source warehouse entirely untouched.
    source = sqlite3.connect(f'{path.as_uri()}?mode=ro', uri=True)
    w = Warehouse(':memory:')
    source.backup(w.conn)
    source.close()
    rows = list(w.iter_games(season_types=(2, 3)))
    rated = EloRatingSystem(EloConfig()).run(rows)
    elo = {r.game_id:r.expected_home for r in rated}
    builder = FeatureBuilder()
    builder.set_divisions({int(t['team_id']):t['division'] for t in w.franchises()})
    X, margins, totals, meta = builder.build(rated, rows,
        weeks_in_season_for={s:regular_season_weeks(s) for s in {int(r['season']) for r in rows}},
        warmup_seasons=0)
    dates = [datetime.fromisoformat(m['date_utc'].replace('Z','+00:00')) for m in meta]
    groups = defaultdict(list)
    for i,m in enumerate(meta):
        if args.from_season <= m['season'] <= args.through_season:
            groups[week_key(m)].append(i)
    scored = []
    for (season,season_type,week), target in sorted(groups.items()):
        cutoff = min(dates[i] for i in target)
        train = [i for i,d in enumerate(dates) if d < cutoff]
        if len(train) < 500:
            continue
        incumbent, challenger = MarginModel(), MarginModel()
        incumbent.fit(X[train], margins[train], totals[train], FEATURE_NAMES)
        challenger.fit(X[train], margins[train], totals[train], FEATURE_NAMES,
                       sample_weight=recency_weights([dates[i] for i in train],cutoff))
        for i, a, b in zip(target, incumbent.predict(X[target]), challenger.predict(X[target])):
            m = meta[i]
            if margins[i] == 0:
                continue
            pa = a.p_home/(a.p_home+a.p_away)
            pb = b.p_home/(b.p_home+b.p_away)
            won = bool(margins[i] > 0)
            row = dict(game_id=m['game_id'],season=season,season_type=season_type,week=week,
                kickoff=m['date_utc'],trained_before=cutoff.isoformat(),home_won=won,
                incumbent=pa,challenger=pb,elo=elo[m['game_id']],
                incumbent_brier=(pa-won)**2,challenger_brier=(pb-won)**2,
                incumbent_log_loss=market.log_loss(pa,won),challenger_log_loss=market.log_loss(pb,won),
                incumbent_margin_error=abs(a.exp_margin-margins[i]),challenger_margin_error=abs(b.exp_margin-margins[i]),
                incumbent_total_error=abs(a.exp_total-totals[i]),challenger_total_error=abs(b.exp_total-totals[i]))
            try:
                row['market'] = market.devig(m['ml_home'],m['ml_away'])[0]
            except (ValueError,TypeError,KeyError):
                row['market'] = None
            scored.append(row)
        if week == 1:
            print(f'{season}: {len(train)} earlier training games',flush=True)
    if not scored:
        raise ValueError('No eligible held-out games')
    def summarize(rs):
        out = {'n':len(rs)}
        for name in ('incumbent','challenger','elo'):
            out[name] = dict(brier=float(np.mean([(r[name]-r['home_won'])**2 for r in rs])),
                log_loss=float(np.mean([market.log_loss(r[name],r['home_won']) for r in rs])),
                accuracy=float(np.mean([(r[name]>=.5)==r['home_won'] for r in rs])))
        for name in ('incumbent','challenger'):
            out[name].update(margin_mae=float(np.mean([r[name+'_margin_error'] for r in rs])),
                             total_mae=float(np.mean([r[name+'_total_error'] for r in rs])))
        out['paired_brier'] = blocked_bootstrap([r['challenger_brier'] for r in rs],
            [r['incumbent_brier'] for r in rs],[f"{r['season']}-{r['season_type']}-{r['week']}" for r in rs])
        return out
    summary = summarize(scored)
    paired = [r for r in scored if r['market'] is not None]
    result = dict(basis='exploratory_historical_walk_forward', half_life_years=3,
        production_eligible=False, promotion='held: requires independent prospective validation',
        note='Fixed challenger; weekly refits. Binary scores condition on no tie. Backfilled moneylines are not verified closing prices.',
        source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        corpus_games=len(rows),corpus_latest=max(dates).isoformat(),
        python=platform.python_version(),numpy=np.__version__,
        source_code_sha256=hashlib.sha256(Path(__file__).read_bytes()+Path('backend/services/prediction/margin_model.py').read_bytes()).hexdigest(),
        summary=summary, by_season={str(s):summarize([r for r in scored if r['season']==s]) for s in sorted({r['season'] for r in scored})},
        market_moneyline={'n':len(paired),'market_brier':float(np.mean([(r['market']-r['home_won'])**2 for r in paired])) if paired else None,
                         'challenger_brier':float(np.mean([r['challenger_brier'] for r in paired])) if paired else None},
        rows=scored)
    out = Path(args.output); out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    print(json.dumps(summary,indent=2))
    return 0

if __name__ == '__main__':
    raise SystemExit(run())
