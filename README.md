# Gridiron

NFL game and season probabilities, scored against the closing line.

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
answer.

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

5,684 decided games, walk-forward, refit weekly on an expanding window from
2005 after a three-season warm-up.

| forecaster | Brier | log loss | accuracy | ECE | n |
|---|---|---|---|---|---|
| Market (closing line) | **.2117** | .6109 | .6640 | .0127 | 3,807 |
| Elo only | .2198 | .6291 | .6443 | **.0123** | 5,684 |
| Margin model | .2199 | .6292 | .6414 | .0202 | 5,684 |
| Constant base rate | .2465 | .6861 | .5595 | .0000 | 5,684 |

Paired bootstrap against the closing line: **+.00884, 95% CI [+.00578,
+.01196], p(model better) = .000.** The market is better, significantly.
**That is the expected and wanted result** — the model carries no market
features, and one that beat the price without seeing it would be a bug
announcing itself. It closes 76% of the distance from the base rate to the
market.

**The margin model does not beat Elo alone.** Level on Brier, worse
calibrated. Nine features have bought nothing over a rating gap and a
home-field constant. That is reported rather than dressed up, and Elo-only
stays live as the yardstick.

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
