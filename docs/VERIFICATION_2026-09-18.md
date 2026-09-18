# Verification and experiment results

## Recency experiment: held back

Input: local 6,499-game warehouse, through the 2025 postseason. The latest
release download failed with a TLS timeout. This is exploratory historical
validation, not an evaluation of a freshly restored production corpus.

Paired decided games, 2019–2025: **1,954**, across **152 season/phase/week blocks**.
Both models refit before each test week; postseason weeks are separate.

| Metric | Unweighted margin model | Three-year recency challenger | Elo |
| --- | ---: | ---: | ---: |
| Binary Brier | 0.223657 | 0.224104 | 0.222662 |
| Log loss | 0.637991 | 0.639176 | 0.636652 |
| Accuracy | 63.10% | 63.10% | 63.66% |
| Margin MAE | 10.2413 | 10.2381 | — |
| Total MAE | 10.7588 | 10.7765 | — |

Challenger minus incumbent Brier: **+0.000447**, paired week-block bootstrap
95% interval **[−0.000173, +0.001062]**, 4,000 draws. There is no established
improvement. A tiny margin-error reduction does not justify worse probability
and total scores. No candidate is promoted, and production forecast artifacts
have not been regenerated from this older warehouse.

The complete report, including paired rows and reproducibility metadata, is
[`reports/recency_experiment.json`](../reports/recency_experiment.json).

## Automated checks

This record covers the original Forecast Lab pass and the continued conditional
playoff/weekly briefing work. See [the second experiment and implementation
report](CONTINUED_IMPROVEMENTS_2026-09-18.md) for the model findings.


- Final complete backend suite: **107 passed**, including end-to-end live scoring,
  the forecast-history safeguards, conditional simulations and temporal calibration
  (the original suite had 83 tests).
- Forecast/scenario contract tests: five passing checks, using actual published JSON
  plus explicit invalid-input cases.
- Production build: passed, all **354 pages** generated; lint and TypeScript
  checks passed. First-load JavaScript is 124 kB for `/lab` and 128 kB for `/`.
- Production Chromium audit: **passed** against the final build. All interaction
  and navigation checks passed with no page errors. At **320, 390, 768 and
  1440 pixels**, no horizontal overflow or Next.js error overlay was found,
  and axe reported **zero WCAG A/AA violations in the Lab main content**.
  The mobile homepage also passed overflow and main-content accessibility checks.
  This automated scan does not replace a complete manual accessibility audit.
- Desktop and mobile screenshots were inspected visually. The audit caught
  and fixed narrow-screen header overflow and invalid definition-list markup
  in the shared spread slider before the successful final run. The continued
  review shortened the homepage matchup list and replaced an unsupported
  full-width plus glyph with a portable Follow label.
- `git diff --check`: clean. Existing game probabilities and forecast snapshots are unchanged; a new
  conditional-playoff companion artifact is published.

Evidence: [desktop screenshot](screenshots/forecast-lab-desktop.png),
[mobile screenshot](screenshots/forecast-lab-mobile.png),
[homepage](screenshots/homepage-desktop.png),
[mobile homepage](screenshots/homepage-mobile.png), and
[machine-readable browser results](screenshots/forecast-lab-checks.json).
The audit checks refresh failure, retention of the last loaded forecasts, and
successful recovery. Final screenshots show the recovered state. Conditional
playoff values are checked directly against the published simulation artifact;
game probabilities are checked unchanged after scenario interactions.

The corrected full historical benchmark also wrote both complete reports before
its cancellation request reached the process (the shell ultimately exited 143).
The JSON files were checked for completeness: 5,698 retrodictions, 2005–2025,
including 14 ties; 5,684 decided games. Model Brier is 0.21991, Elo 0.21981,
and the corrected training-only baseline 0.24667. On 3,807 paired priced,
decided games the model-minus-market gap is +0.008857, with a match-bootstrap
95% interval [0.005765, 0.011932]. These are exploratory results from the older
local warehouse, so the production artifacts remain intact and are labeled as
predating the fixes. Reports are in `reports/benchmark_corrected/`.

## Reproduce

```bash
npm ci
npm test
npm run lint
npm run typecheck
NEXT_TELEMETRY_DISABLED=1 npm run build
OPENBLAS_NUM_THREADS=1 .venv/bin/python -m pytest backend/tests/ -q

# Production browser audit, with Playwright Chromium installed:
npx playwright install chromium
npm start -- --hostname 127.0.0.1 --port 3012
# In another terminal:
npm run test:browser

# Read-only experiment; the source database is copied to SQLite memory:
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 .venv/bin/python \
  -m backend.scripts.experiment_recency --db backend/data/warehouse.sqlite

# Corrected historical benchmark to a separate review directory:
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 .venv/bin/python \
  -m backend.scripts.benchmark_market --output-dir reports/benchmark_corrected
```

The browser audit uses real upcoming forecasts and checks probability parity,
record scenarios, search/reset, following across reloads, spread interaction,
sharing, refresh success/failure/recovery, conditional playoff branches,
withheld sparse outcomes, navigation, the mobile homepage, and four Lab viewport
widths. Only
the refresh-failure case injects an error response. Screenshots and machine-readable
checks are written to `/tmp/nfl-forecast-lab-audit` by default.

Additional reproduction commands:

```bash
# Rebuild only the conditional outlook from matching committed artifacts:
OPENBLAS_NUM_THREADS=1 .venv/bin/python -m backend.scripts.build_playoff_scenarios

# Evaluate calibration on earlier out-of-sample forecasts:
OPENBLAS_NUM_THREADS=1 .venv/bin/python -m backend.scripts.experiment_calibration

# CI freezes the browser clock at the source publication time:
AUDIT_USE_PUBLICATION_TIME=1 npm run test:browser
```
