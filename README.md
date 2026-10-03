# Gridiron

NFL game and season probabilities, compared with historical market prices.

[Forecast Lab and reliability improvements](docs/IMPROVEMENT_AUDIT_2026-09-18.md)
adds interactive matchup exploration, record scenarios, safer forecast history,
and a measured recency experiment. See the [verification report](docs/VERIFICATION_2026-09-18.md)
for results and reproduction commands. Historical price timestamps are not
verified closes. The dated evidence below is reproducible from committed artifacts.

A sibling of [`../nba_predictor`](../nba_predictor) (Hardwood) and
[`../soccer_predictor`](../soccer_predictor) (Pitchverse) — same architecture,
same evidence discipline, same design language. Several of the measured
conclusions differ, deliberately. See [CLAUDE.md](CLAUDE.md).

## What it does

1. **Game prediction** — win probability, expected margin and total for every fixture.
2. **Season projection** — record, division, seed distribution, playoff and Super Bowl odds.
3. **A value surface** — model probability against the no-vig implied probability.
4. **The playoff picture** — who makes the field and who hosts.

The schedule is a calendar, week by week. Every fixture and every team mark is
explorable: a game page carries the margin lattice, the cover/push/lose surface
at each key number, the injury report and the head-to-head; a team page carries
twenty-four seasons of rating against the league. `/season` draws the
conference race as a line — the one question on the site that a table cannot
answer. `/bracket` prices the road to the Super Bowl, and `/seasons` is the
24-season archive: standings, the bracket that was actually played, every game
and where the model was most wrong.

## The interesting part: football margins are lumpy

Margin skewness is +0.07 and excess kurtosis is +0.20 — every summary
statistic says a normal distribution is an excellent fit. It is not, because
football scores are built out of 3s and 7s:

| \|margin\| | actual | a normal expects |
|---|---|---|
| 3 | **14.82%** | 5.4% |
| 7 | 9.08% | 5.2% |
| 5 | 3.57% | 5.4% |
| 9 | 1.54% | 4.9% |

A three-point game is nine times more likely than a nine-point game, and no
moment up to fourth order can see it — the lumpiness is periodic rather than
skewed or heavy-tailed.

So the model is a normal kernel modulated by a measured lattice weight:

```
P(margin = k)  ∝  w(k) · N(k; mu, sigma)
```

`w(0) = 0.13` is the one to read twice: a fitted normal expects 168 ties in
this corpus, and there were 15.

This buys two things a continuous model cannot have — a real tie probability,
and **honest pushes on the spread**. At a line of exactly −3, win, push and
lose are three different outcomes and the push is worth about one game in
twelve. A continuous model assigns it zero mass by construction and splits it
between the two sides, on the most heavily traded number in the sport.

## The record

The [October quality roadmap](docs/QUALITY_ROADMAP_2026-10.md) prioritizes
temporal evaluation and a clearer weekly game-browsing flow.

The historical artifact generated **2026-09-29** scores 5,732 decided games,
walk-forward, refit weekly on an expanding window from 2005 after a three-season
warm-up. Week grouping includes season and season type. The market row uses
3,855 priced decided games; rows with different sample sizes are not paired
comparisons.

| forecaster | Brier | log loss | accuracy | ECE | n |
|---|---|---|---|---|---|
| Market (retained historical prices) | **.21196** | .61152 | .66355 | .01230 | 3,855 |
| Elo only | .21990 | .62933 | .64445 | .01291 | 5,732 |
| Margin model | .22002 | .62945 | .64079 | .02015 | 5,732 |
| Constant base rate (training-only) | .24665 | .68643 | .55967 | .01355 | 5,732 |

The artifact's paired margin-minus-market Brier gap is **+.00876, 95% CI
[+.00569, +.01177]**. Lower is better, so retained prices lead on this sample.
Their closing timestamps are unverified; this is not evidence about beating a
verified closing line. These are existing artifact results, not a new model run.

**The margin model has not established an improvement over Elo alone.** Its
current point estimates are slightly worse on Brier and calibration. Elo-only
stays available as the yardstick for future measured changes.

The separately published live artifact generated **2026-10-02** has **49**
settled first forecasts: Brier **.23629**, accuracy **63.265%**. All 49 were
published at least seven days before kickoff. This early, long-horizon sample
does not measure last-day prediction quality and is not merged with the
historical record.

Reproduce the table and independently recompute live Brier, accuracy, and
horizon counts from the stored rows without network access or training:

```bash
python -m backend.scripts.report_evidence
python -m pytest backend/tests/test_evidence_report.py -q
```

Sources: [historical artifact](backend/data/diagnostics/market_benchmark.json)
and [published forecast log](backend/data/predictions/forecast_log.json).
The report rejects duplicate games, post-kickoff forecasts, invalid
probabilities, and inconsistent live headline/cohort counts. Stored results
remain the outcome source; the report does not independently fetch outcomes.

## Setup

```bash
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
npm install
```

## Running it

```bash
# Build the warehouse from ESPN (2002-present, ~10 minutes)
PYTHONPATH=. ./.venv/bin/python -m backend.scripts.build_warehouse --all

# Backfill sportsbook lines (~45 minutes; nothing exists before ~2011)
PYTHONPATH=. ./.venv/bin/python -m backend.scripts.backfill_odds --seasons 2011-2026

# Score against the market
PYTHONPATH=. ./.venv/bin/python -m backend.scripts.benchmark_market

# Publish the forecast artifacts the site reads
PYTHONPATH=. ./.venv/bin/python -m backend.scripts.forecast_season --sims 20000

# Game context, the 992-pair matchup grid and the team archive
PYTHONPATH=. ./.venv/bin/python -m backend.scripts.build_game_context

# One point on the conference-race line (daily), or a whole season replayed
PYTHONPATH=. ./.venv/bin/python -m backend.scripts.conference_race --track
PYTHONPATH=. ./.venv/bin/python -m backend.scripts.conference_race --replay 2025

# Tests, lint, dev server
PYTHONPATH=. ./.venv/bin/python -m pytest backend/tests/
npx next lint
npm run dev
```

## Standing rules

- The market is the benchmark. Accuracy claims are paired comparisons on named games.
- Baselines are never deleted.
- No fabricated data — sparse coverage stays genuinely missing.
- If a model beats the closing line, suspect the harness first.

Not betting advice. These are model probabilities published for their own
sake, and the accuracy page says with a confidence interval that the market
is better.

The continued improvement pass adds conditional playoff scenarios, a weekly fan briefing, and an evidence ledger: [implementation and model results](docs/CONTINUED_IMPROVEMENTS_2026-09-18.md).
