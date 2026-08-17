# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

**Gridiron** is an NFL prediction dashboard: Next.js 15 frontend, Python backend, statistical forecasting engine.

It is a deliberate port of the sibling NBA project (`../nba_predictor`, "Hardwood"), which is itself a port of the soccer project (`../soccer_predictor`, "Pitchverse"). **The architecture, the evidence discipline and the design language are the same on purpose. Several of the measured conclusions are different, also on purpose** — see *Where football diverges* below, and do not port a number across sports.

It does **four things**, and nothing else:

1. **Game outcome prediction** — win probability, expected margin, expected total, calibrated and scored against the closing line.
2. **Season projections** — record, division, seed distribution, playoff and Super Bowl odds.
3. **A value surface** — model probability vs no-vig implied probability.
4. **The playoff picture** — who makes the field and who hosts.

If a proposed feature is none of those four, it does not belong here.

## Standing rules — read before changing anything

- **The market is the benchmark.** Any accuracy claim is stated as a paired Brier against the closing line on named games, or it is not stated.
- **Baselines are never deleted.** Constant base rate and Elo-only stay live as yardsticks.
- **No fabricated data.** Sparse coverage stays genuinely missing; never impute a plausible value.
- **Whenever a challenger beats the closing line, suspect the harness first.** A model with no market features cannot out-predict the market. That result is a bug announcing itself.
- **Vercel escalates ESLint warnings to errors.** Run `npx next lint` before pushing; `npm run build` is not enough.

## Current measured state (2026-08-16)

Corpus: **6,499 games, seasons 2002–2025**, from ESPN, plus the full 2026 schedule (272 regular-season games; the season kicks off **2026-09-10**).

Every season hits its expected game count exactly. **2002 is the earliest season** and that is structural: it is when the league realigned to 32 teams in eight four-team divisions. Before that there were 31 teams in six uneven divisions with different seeding rules, and ESPN will happily serve those seasons into the corpus as if nothing had changed.

### The distributions that drive the model

Measured on 6,223 regular-season games:

| quantity | value |
|---|---|
| margin | mean +2.193, sd 14.641, skew +0.070, excess kurtosis +0.203 |
| total | mean 44.53, sd 14.03 |
| corr(margin, total) | +0.019 — negligible, so independence is measured, not assumed |
| ties | 15 / 6,223 = **0.241%** |
| overtime | 6.03% |
| home win rate | .5597 |

### Home advantage has roughly halved

| era | home win | mean margin | Elo points |
|---|---|---|---|
| 2002-2006 | .5758 | +2.56 | 53.3 |
| 2007-2011 | .5680 | +2.56 | 47.8 |
| 2012-2016 | .5705 | +2.43 | 50.5 |
| 2017-2020 | .5460 | +1.21 | 33.4 |
| 2021-2025 | .5382 | +2.08 | 27.7 |

The 2017-2020 bucket contains the empty-stadium 2020 season and its +1.21 should not be read as a trend point. The served margin model refits weekly and tracks the drift through its intercept, which currently reads **+2.35 points**.

### Model fit

Ridge on 9 features, 5,960 games after a 2-season warm-up: `margin_sd 13.485`, `total_sd 13.712`. 100 rating points is worth **3.383 points of margin**, so `POINTS_PER_ELO = 29.6`.

Within-season Elo drift over 768 team-seasons: **sd 34.53 rating points** (the NBA sibling measures 36.1).

### Game prediction, walk-forward

Refit weekly on an expanding window, scored on games strictly later than everything fitted on. 5,684 decided games scored from 2005 after a three-season warm-up.

| forecaster | Brier | log loss | accuracy | ECE | n |
|---|---|---|---|---|---|
| Market (closing line) | **.2117** | .6109 | .6640 | .0127 | 3,807 |
| Elo only | .2198 | .6291 | .6443 | **.0123** | 5,684 |
| Margin model | .2199 | .6292 | .6414 | .0202 | 5,684 |
| Constant base rate | .2465 | .6861 | .5595 | .0000 | 5,684 |

Paired bootstrap against the closing line on 3,807 priced, decided games:

| forecaster | gap to close | 95% CI | p(better) |
|---|---|---|---|
| Margin model | **+.00884** | [+.00578, +.01196] | .000 |
| Elo only | +.00873 | [+.00561, +.01194] | .000 |
| Constant base rate | +.03517 | [+.03010, +.04016] | .000 |

**The market is better, significantly. That is the expected and wanted result** — the model carries no market features. It closes **76%** of the distance from the constant base rate to the market.

**The margin model does not beat Elo-only, and this must not be dressed up.** It is .0001 worse on Brier, .0029 worse on accuracy, and materially worse calibrated (ECE .0202 against .0123) — and Elo-only is the marginally closer of the two to the closing line. Nine features have bought nothing over a rating gap and a home-field constant. That is a real result about football rather than a bug: Elo already encodes team strength, and rest, division and form are either small or already priced into the rating. The honest reading is that the feature layer **has not yet earned its place**, and `/accuracy` says so in those words.

## Where football diverges from basketball — do not port conclusions

### 1. The margin distribution is lumpy, and every summary statistic hides it

This is the most important section in the file. Margin skewness is +0.07 and excess kurtosis is +0.20 — textbook "normal is an excellent fit". The distribution is nothing of the sort:

| \|margin\| | share | a normal expects |
|---|---|---|
| 3 | **14.82%** | 5.4% |
| 7 | 9.08% | 5.2% |
| 5 | 3.57% | 5.4% |
| 9 | 1.54% | 4.9% |

A three-point game is **nine times** more common than a nine-point game. No moment up to fourth order can see this, because the lumpiness is *periodic* rather than skewed or heavy-tailed.

So the model is `P(margin = k) ∝ w(k) · N(k; mu, sigma)`. The normal carries location and spread; `w(k)` carries the arithmetic of scoring. `w` is measured, not designed:

    w(0) = 0.13   w(3) = 2.88   w(7) = 1.83   w(10) = 1.37
    w(5) = 0.73   w(9) = 0.46   w(11) = 0.60

**`w(0)` is the one to read twice.** A fitted normal expects 168 ties in this corpus; there were 15.

Two consequences:

- **Pushes are real.** At a line of exactly −3, win/push/lose are three different outcomes and the push is worth ~8% of the market. A continuous model assigns it zero by construction and splits the mass between the two sides — on the most heavily traded number in the sport. `cover_probabilities` returns all three.
- **The moneyline barely moves.** P(margin > 0) integrates over half the lattice, so the lumpiness nearly cancels. This machinery is not here to move the headline number, and a test pins that it does not.

`w` is fitted against the **mixture** of the training set's predicted means, not against a single normal at the unconditional sd. Getting that wrong is not cosmetic: the first version divided by an unconditional normal (sd 14.6) and served a narrower kernel (sd 13.5), leaving a surplus of mass at the centre that inflated the served tie probability to 0.62% against a measured 0.241%.

### 2. Ties exist, and the moneyline does not price them

The NBA sibling is built on a measured zero ties in 27,690 games and is right to be. Here ties are 0.241% — rare, but structural.

**A moneyline VOIDS on a tie.** So a de-vigged two-way line is not P(home wins), it is P(home wins | the game is decided). Comparing an unconditional model probability against it understates the model by exactly the tie mass on *every* game — a small, one-directional bias that would look like systematic shading toward the underdog. `market.conditional_from_three` is the only sanctioned bridge and `benchmark_market` calls it.

Scoring excludes ties and **counts them**; `brier_ties_as_half` reports the all-games alternative so the choice can be checked rather than trusted.

### 3. Seeding is not by record

**Four division winners take seeds 1–4 regardless of record.** A 9-8 division champion hosts a 13-4 wild card. The NBA seeds strictly by record within a conference, so a projection ported from it misprices exactly the teams whose seeding is most interesting. `seed_conference` refuses to sort on record alone.

The playoff field **changed size in 2020**: 12 teams (6 per conference, 2 byes) before, 14 (7 per conference, 1 bye) after. Hard-coding either shape silently rewrites twenty seasons or every future one.

**The bracket reseeds every round** — highest surviving seed plays lowest. A fixed bracket gives materially different advancement probabilities.

**The Super Bowl is at a neutral site.** Every other postseason game is hosted by the better seed.

### 4. Ingest by WEEK, never by date range

Football plays in discrete weeks and ESPN indexes on them: `?dates=YYYY&seasontype=N&week=W` returns exactly that slate. This is what lets `build_warehouse` assert 272 games rather than hope a range came back whole. **Do not port the NBA's `get_scoreboard_range` into this project.**

`regular_season_weeks` resolves 18 (from 2021) or 17 (before). Hard-coding 18 invents an empty week for twenty seasons; hard-coding 17 drops sixteen real games a year and nothing reports it.

### 5. Rest is a real feature here and is meaningless in basketball

Thursday games are 4 days' rest, a normal week is 7, a bye is 13. Bye-week rest is the largest scheduling edge in the sport. The NBA sibling has no rest feature worth the name.

### 6. Seasons are labelled by START year

The 2026 NFL season kicks off September 2026 and ends with a Super Bowl in February 2027. **The NBA sibling labels a season by the year it ENDS.** The same integer means different things in the two warehouses. Rollover is March, after the Super Bowl and the start of the league year.

## Known landmines

- **The Pro Bowl moves between eras and NO calendar rule can pin it.** From 2009 it is postseason week 4, between the conference championships and the Super Bowl. **Before 2009 it was played the week AFTER the Super Bowl**, in Hawaii, so ESPN files 2002-2008 with the Super Bowl as week 4 and no week 5 at all.

  The first version hard-coded "week 4 is the Pro Bowl" and therefore **deleted seven Super Bowls (2002-2008)** while ingesting seven Pro Bowls in their place under the label `super-bowl`. Every season still had a plausible-looking bracket and every regular-season count still passed. It was caught only by `validate_warehouse_integrity`, which knows a single-elimination field of N teams plays exactly N-1 games and found 10 where it wanted 11.

- **Exhibitions are filtered by PARTICIPATION, which is era-independent.** A franchise is a team ESPN's standings place in a conference; the Pro Bowl's sides never are. `ESPNLoader.franchise_ids` is built from the standings pull *before* any season is ingested, and the check runs **before any team is resolved** — because `_team_key` upserts, and ESPN gives the all-star squads real, stable team ids (31 "AFC All-Stars", 32 "NFC All-Stars") in some seasons and nothing at all in others. An earlier version judged after resolving and wrote two junk franchises into `teams` permanently, where they were excluded from every surface only because they happened to have no conference — a coincidence that held, not a rule.

  `client.postseason_round` then labels weeks 1-3 and calls anything later the Super Bowl, correct in both eras precisely because the exhibition is already gone.

- **2022 has 271 regular-season games and that is correct.** Buffalo at Cincinnati, 2 January 2023, was abandoned after Damar Hamlin's cardiac arrest and never resumed — the league cancelled it and declared a no-contest. `KNOWN_CANCELLATIONS` records it so the completeness check still fails 271 in any *other* season.

- **`pickcenter` is EMPTY for the NFL.** The NBA project reads its entire market benchmark from it. Here that array exists and is always length zero and the summary's `odds` key is null. Prices live on `sports.core.api.espn.com/.../competitions/{id}/odds` instead.

- **The odds array mixes prices, public model forecasts and LIVE in-game lines.** `accuscore`, `teamrankings` and `numberfire` are models, not prices. `ESPN Bet - Live Odds` and `Caesars … - Live Odds` are in-game. All three are classified at ingest and stored with `kind`; only `kind='price'` is eligible to become `games.ml_*`.

  The concrete case, from Super Bowl LIX (event `401671889`, Philadelphia 40 Kansas City 22): the pregame ESPN BET line is **spread +1.5, total 48.5**. The live line on the same event is **spread −28.5, total 52.5** — captured while Philadelphia was running away with it. Read as a closing line that single row would imply the market knew the result to within a touchdown before kickoff. A benchmark contaminated this way does not look broken; it looks like a market no model could ever beat, which is exactly the conclusion this project is built to distrust.

- **A backfilled line is not a closing line.** ESPN returns whatever it kept with no timestamp. Every backfilled row carries `before_kickoff = 0`.

- **Odds coverage starts around 2012.** Nothing at all before ~2011. Where only a spread exists it is pushed through the margin distribution and the row is tagged spread-derived, because that is a weaker signal that must not silently dilute the benchmark.

- **`level=3` is required on the standings endpoint** or there are no divisions at all — just two conferences of sixteen flat entries. The entire playoff seed depends on division winners, so a missing division does not degrade the projection, it invalidates it.

- **The offseason gap is not rest.** ~200 days between a team's last game and its next opener clips to REST_MAX and reads as "maximally rested", so **every week-1 game had both teams flagged `off_bye`**, in training as well as at serving time. The flag meant "week 1 or a real bye" and the coefficient was fitted on that mixture. Caught only because it made the feature constant at serving time and tripped `dead_feature_blocks`.

- **The serving path must advance the schedule clock.** `observe_scheduled` moves `last_played` past an unplayed fixture without inventing a result. Without it every fixture in a future season measures rest from the team's last *real* game and `rest_diff` is identically zero.

- **`elo_diff` must not carry home advantage, and the venue indicator must be `neutral_site` not `home_field`.** Two separate collinearity traps, both of which produce plausible-looking nonsense. Folding the offset into the gap split home advantage across two coefficients of opposite sign; using a `home_field` indicator instead made it collinear with the intercept (only ~50 of 6,000 games are neutral) and implied a neutral-site game still carried +1.97 of home advantage. Coded as `neutral_site`, **the intercept IS the home advantage in points**.

- **A constant feature is an absent feature.** `turnover_diff` and `yards_diff` fitted to exactly 0.000 because the box-score columns behind them are NULL for the whole corpus. They were removed, not fed zeros. `constant_features` catches what `dead_feature_blocks` structurally cannot — a feature dead in *both* training and serving is invisible to a train/serve comparison.

- **`regress_to_season` must be called by the forecaster and never by a backtest.** Elo applies carryover lazily at a season boundary, which is correct while walking a corpus and wrong the moment you start projecting.

- **`games` is results-only.** Unplayed games live in `scheduled_games` and a game must never be in both — `prune_played_from_scheduled` runs in the same pass that files a result.

- **Elo over an unordered stream reads the future and the output looks entirely normal.** `iter_games` orders on `(date_utc, game_id)`; both `EloRatingSystem.run` and `FeatureBuilder.build` raise on an out-of-order row.

## Architecture

### Backend (`backend/`)

- **`services/espn/client.py`** — host is `site.web.api.espn.com`, **never** `site.api` (Akamai answers datacentre IPs with 403 and no CORS headers). Week-indexed ingest. Core API for odds.
- **`services/data/`** — `warehouse.py` (SQLite, gitignored), `espn_loader.py`. Team identity is ESPN's integer id; there is **no fuzzy resolver**.
- **`services/ratings/elo.py`** — Elo with a **logarithmic** MOV multiplier (the NBA sibling uses a power law; football margins are bounded and cluster tightly, so a log flattens where football needs it to) and an autocorrelation correction.
- **`services/prediction/`** — `margin_model.py` (the lattice model), `market.py` (de-vig, scoring, EV, Kelly), `feature_builder.py` (9 features, structurally point-in-time).
- **`services/simulation/season_simulator.py`** — Monte Carlo, one correlated strength offset per team per season.
- **`services/playoffs/bracket.py`** — seeding, reseeding, single elimination.

### Frontend (`src/`)

Next.js 15 App Router, 7 pages. **The frontend never computes a probability** — it reads published JSON. A component that recomputes something is a second model nobody benchmarked.

Design language is **Bugatti**, ported from the sibling projects: pure black `#000`, surfaces `#0d0d0d`/`#141414`, hairlines `#262626`, white uppercase letterspaced display, monospace for nav and tables. **No gradients, no shadows, no glassmorphism.** Colour carries meaning only. **Dark-only** — `<html class="dark">` is hardcoded.

### Conventions

- **CSS variables, never Tailwind colours** — `text-[var(--text-primary)]`, not `text-gray-400`.
- **Every probability renders as text**, never colour-only.
- **Absent data renders as absent**, never as zero. "No line published" and "no edge" are different facts.
- **Kickoffs render in US Eastern**, because the league schedules in it and every broadcast window is named in it.
- Backend tests use absolute imports (`from backend.services...`); root `conftest.py` makes that work.

## Common commands

| Task | Command |
|---|---|
| Build the warehouse | `python3 -m backend.scripts.build_warehouse --all` |
| Refresh the current season | `python3 -m backend.scripts.build_warehouse --current-season` |
| Backfill odds | `python3 -m backend.scripts.backfill_odds --missing-only` |
| **Integrity check (run after any ingest change)** | `python3 -m backend.scripts.validate_warehouse_integrity` |
| Market benchmark | `python3 -m backend.scripts.benchmark_market` |
| Score the live record | `python3 -m backend.scripts.score_live` |
| Publish the forecast | `python3 -m backend.scripts.forecast_season --sims 20000` |
| Publish game context + matchups | `python3 -m backend.scripts.build_game_context` |
| Backend tests | `python3 -m pytest backend/tests/` |
| Lint (Vercel hard gate) | `npx next lint` |
| Dev server | `npm run dev` |

## What is genuinely missing

Recorded rather than papered over:

- **No injury or roster data.** In a sport where one position is worth several points a game, this is the largest single gap, and it is why preseason Super Bowl odds stay more concentrated than a real futures market.
- **No team box-score features.** See the landmine above; they return when a `backfill_boxscores` pass exists, and not before.
- **Tiebreakers are approximated.** Win percentage, head-to-head (two-team), division and conference record. The league's procedure has twelve steps; the remainder breaks deterministically on team id rather than by simulated coin toss, because a random tiebreak inside a Monte Carlo adds variance that looks like uncertainty and is not.
- **The margin model does not currently beat Elo-only.** On the walk-forward it scores .2199 against Elo's .2198, with worse calibration (ECE .0209 vs .0120). The extra features have not yet earned their place and the accuracy page must not imply otherwise.
- **The live published record is empty** because the season has not started. It will grow from zero and be reported at whatever n it reaches, never merged with the historical walk-forward.
