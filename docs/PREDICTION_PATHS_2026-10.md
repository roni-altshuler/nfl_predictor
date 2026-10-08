# Close-game paths · October 8, 2026 cloud review

A headline win probability does not distinguish a narrow finish from a wider
win. This bounded change makes those outcome paths visible on published game
pages and Forecast Lab, using the existing margin lattice and headline
probabilities. It also connects the reader to the existing forward-published
record. Model fitting, data acquisition and historical evaluation are unchanged.

## Source and calculation boundary

The reviewed base is `76f8f792147c445c2b09685abe42ae73a61fc6a4`, above the
independently reviewed PR5 merge `14074965be9e00ea2140e0fde10ac1203e6f3659`.
No open PR existed when this branch was created. No laptop-only logo fallback
was recovered or overwritten; the already merged cloud fallback remains.

The committed forecast was published **2026-10-07T17:43:07+00:00**, with
results through **2026-10-06T00:15:00+00:00**, model `nfl-margin-lattice-1`,
and **208** retained fixtures. These dates describe stored artifacts and do not
claim a fresh provider query or live schedule. The recorded ESPN summary used
in regression QA remains the October 4 capture; other documented archive,
absence and multiplicity cases are controlled browser fixtures.

For a selected band of 3, 7 or 8 points, home narrow wins sum positive margin
cells from 1 through the band; away narrow wins sum the corresponding negative
cells. Each wider-win probability equals its published team win probability
minus that narrow mass. Ties use the published tie probability. No arbitrary
allocation of the lattice's unlabeled outside mass, distribution fit, scoring
simulation, feature attribution or player grade is introduced.

The helper validates the existing forecast contract, band support, lattice
coverage, zero-margin/tie agreement and headline/lattice consistency. Rounded
cells allow 0.001 aggregate tolerance and 0.0001 tie tolerance; contradictory
sources or a negative wider-win remainder are withheld. Real zero remains zero.
Archive pages without a retained pre-game forecast show missing coverage instead
of retrospective probabilities. The existing raw-provider multiplicity guards,
ambiguous leader suppression and unverified statistic-period labels remain.

`marginBand` deep links preserve selected controls across fixture changes and
Back. Changes replace history, preserve `compare` and require no source refetch.
Forecast Lab share links include the selected supported band. A malformed band
explicitly falls back to 1–8 points. The evidence link opens the named
`/accuracy#published-record` section; its historical score table is now keyboard
focusable at phone widths.

## Reference reviewed, with no imported model

The public [xG-model-football repository](https://github.com/grandngom/xG-model-football)
was inspected at exact main commit
[`c992f0335ddecc281c211dda062132808868fb3f`](https://github.com/grandngom/xG-model-football/tree/c992f0335ddecc281c211dda062132808868fb3f).
Its [LICENSE](https://github.com/grandngom/xG-model-football/blob/c992f0335ddecc281c211dda062132808868fb3f/LICENSE)
is MIT. Its [README](https://github.com/grandngom/xG-model-football/blob/c992f0335ddecc281c211dda062132808868fb3f/README.md)
reports 50 soccer matches, 1,390 shots and 166 goals. The
[training script](https://github.com/grandngom/xG-model-football/blob/c992f0335ddecc281c211dda062132808868fb3f/main.py)
uses random shot splits; it does not show chronological or match-group holdouts.
The [bootstrap helper](https://github.com/grandngom/xG-model-football/blob/c992f0335ddecc281c211dda062132808868fb3f/bootstrap_utils.py)
resamples the test outcomes and fixed predictions. This educational soccer
prototype does not validate NFL game forecasts.

The transferable idea is inspectable probabilistic evidence. No source code,
dataset, weights or training resources were copied. The gated resource bundle
was unavailable and supplies no usable production asset in this change. Existing
NFL components and stored probabilities carry the feature; soccer shot xG,
career/value/fantasy statistics and inferred scouting grades are absent.

## Temporal evidence

The existing report command independently recomputed stored live Brier and
accuracy: **64** settled first forecasts, Brier **0.23030**, accuracy **0.62500**,
all published **at least seven days before kickoff**. The log publication is
**2026-10-07T17:43:19+00:00**. This small long-horizon sample is separate from
the weekly expanding-window historical record and does not establish last-day
quality or any improvement from this display change. Stored outcomes were not
independently recollected. Historical metrics were not rerun. Earlier dated
README scorecards retain their earlier source dates.

## Verification

Cloud QA runs the production build with **Chromium 151.0.7922.173** and
Playwright 1.60.0. The new browser audit exercises widths **320, 390, 768 and
1440px** with reduced motion, blocked ESPN browser assets and controlled
server summary responses. It checks keyboard section/select focus, repeated
band changes, source-cell probability parity, stable win headlines, copied
share URLs, fixture/team/record Back navigation, restored slate filters,
unsupported deep links, preserved leader category and archive missing coverage.
At 390px it also checks pending refresh, 503 retention, a contradictory margin
source with no probability tiles, recovery and empty-filter reset. Holding
actual client bundles captures the server-rendered loading state.

The existing comparison, Forecast Lab, week browser and player-profile audits
are required regression gates. The comparison audit retains synthetic raw
multi-leader and unnamed-entry tests. No athlete portrait request is permitted.
Every audited main region must have no tested WCAG A/AA violation, viewport
overflow, JavaScript exception or development overlay. Screenshots and machine
results are committed under [prediction-paths-2026-10](prediction-paths-2026-10/).

The final cloud run passed **23 Node contract tests**, the week-browser
contract checks, **116 backend tests**, lint with no warnings, TypeScript and
the **306-page production build**. All five actual Chromium audit scripts
passed against that build at the current clock. The linked evidence score
table also passed a keyboard ArrowRight scrolling check at 320px. Desktop and
phone screenshots were opened and visually inspected.

Reproduction, from the repository root:

```bash
npm test
npm run lint
npm run typecheck
./.venv/bin/python -m pytest backend/tests/ -q
./.venv/bin/python -m backend.scripts.report_evidence
NODE_OPTIONS='--require ./scripts/player_browser_fixture.cjs' \
  PLAYER_AUDIT_COMPARE_STATES=1 npm run build
NODE_OPTIONS='--require ./scripts/player_browser_fixture.cjs' \
  PLAYER_AUDIT_COMPARE_STATES=1 PLAYER_AUDIT_SLOW_EVENT=401127974 \
  node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3012
# Separate terminal; use the installed Chromium path for this cloud environment.
BROWSER_EXECUTABLE_PATH=/usr/bin/chromium PLAYER_AUDIT_EXPECT_FIXTURE=1 \
  npm run test:browser
```

This is local cloud-browser evidence. Exact PR-head hosted checks and preview
status are reported on the draft PR; a hosted preview browser journey is not
claimed. Main, unmerged recovery branches, production jobs, credentials and
security settings remain unchanged. No manual forecast/workflow dispatch or
merge is authorized by this review.
