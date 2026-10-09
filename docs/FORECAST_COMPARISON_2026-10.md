# First versus latest retained NFL forecasts · October 9, 2026

This adds a separate descriptive publication comparison to the existing Accuracy
page. The canonical first-publication log, historical benchmark, model, baselines,
original Chalkboard identity and recovery branches remain unchanged. No training,
provider recollection or workflow dispatch was performed.

## Sources and freshness

Read-only inputs, based on main `1b6631ea1c922717109ab27eded3a65094382dfa`:

- [Immutable October 8 warehouse backup](https://github.com/roni-altshuler/nfl_predictor/releases/download/warehouse-latest/warehouse-37819104556-1.sqlite.gz), uploaded October 8 at 17:47:49 UTC.
- Compressed SHA-256: `264df0599eb68ae13aa9bee9ae374ab156eeb189c8d88d3b7aebae4d2b667616`.
- Uncompressed SHA-256: `fa735d77ed0a1488ccbb7035fc8b882e91ea5ab0ffa194a6681dba75b2bce87f`.
- First log SHA-256: `7794c6f2179a72139e5b769d09b13b24b119357de08123c827e74becf5f84b2d`, generated October 8 at 17:47:47 UTC; verified unchanged after this work.
- 14,084 retained snapshots across 272 fixtures, through October 8 at 17:47:35 UTC.
- 64 stored settled results, fetched through October 8 at 17:46:26 UTC; latest result kickoff October 6 at 00:15 UTC. Later game results are not represented.

Scoring on October 9 does not make these sources fresh as of October 9. Kickoff
means the timestamp in the stored ESPN result warehouse, not an independently
observed whistle. Results have not been recollected or independently verified.

## Selection and scoring

`compare_forecasts` opens SQLite with `mode=ro`; it neither migrates the warehouse
nor modifies the first log. First candidates come only from the canonical log's
original rows. Latest candidates come only from retained warehouse snapshots.
Both are scored against the same current stored outcome and actual result kickoff.

Every eligible publication has an explicit timezone and a timestamp instant
strictly earlier than result kickoff. The snapshot's schedule time never vetoes
a forecast for a delayed actual kickoff, and never admits one after an earlier
actual kickoff. Probabilities must be finite, nonnegative, at most one and sum
to one within `1e-5`; decided results require nonzero home/away mass. Team
identity and nonempty model version must match the result context.

Latest selection chooses the greatest UTC instant, then the smallest lexical
model-version string on an equal instant. This is a deterministic tie-break,
not a model ranking. Different probabilities for the same model version at the
same instant are all withheld; an earlier valid publication can still qualify.
Equivalent offset spellings with identical probabilities resolve by the
smallest raw timestamp string. Input order cannot change the selected forecast.

Binary Brier and natural-log loss use `p_home / (p_home + p_away)`. Tied games
are counted and excluded, never scored as half a win. Log loss clamps the
conditional probability to `[1e-15, 1-1e-15]`. New cohort metrics use full
stored probability precision; the original rounded first-record metrics and
rows remain untouched. Horizons use unrounded elapsed hours:

| Horizon | Rule |
|---|---|
| Under 24 hours | `0 < hours < 24` |
| 1–7 days | `24 <= hours < 168` |
| 7 days or more | `hours >= 168` |

First and latest full cohorts expose separate n, Brier, log loss, model-version
and horizon cohorts. Paired cards and the Brier difference use only the
intersection of valid **decided game IDs**, listed in the artifact. Unpaired
cohorts never establish an improvement. Missing first/latest snapshots and
invalid candidates stay counted; an empty score is `null`, rendered as `—`.

## Independently recomputed result

| Cohort | Decided n | Brier | Log loss | Under 24h | 1–7 days | At least 7 days |
|---|---:|---:|---:|---:|---:|---:|
| First publication | 64 | .23030 | .65156 | 0 | 0 | 64 |
| Latest pregame | 64 | .22862 | .64552 | 62 | 2 | 0 |

All 64 are paired and all have later retained publications. Latest horizons
range from 1.28 to 33.52 hours. Two games lack a valid retained forecast under
24 hours. No first/latest snapshot is missing for a settled game, no settled
ties are present, and one candidate at/after actual kickoff was excluded.

Paired latest-minus-first Brier is `-0.0016796777636152`. This small descriptive
difference has no significance interval and establishes **no accuracy gain,
model promotion or advantage over a market benchmark**. The two-game 1–7-day
cohort is especially small. Immutable history retention and release backup
verification were already implemented and have not been redone here.

`verify_forecast_comparison` imports no producer/scoring code. Its independent
stdlib audit recalculates conditional probabilities, row losses, horizons,
cohort/model metrics, paired IDs and gap. With `--db` it verifies the source
hash and independently reselects from all 14,084 retained snapshots against
the stored results. Without SQLite it audits the committed rows and first-log
hash; that limited mode does not prove latest selection from full history.

```bash
python -m backend.scripts.verify_forecast_comparison --db /path/to/restored/warehouse.sqlite
python -m backend.scripts.verify_forecast_comparison
python -m pytest backend/tests/test_forecast_comparison.py -q
```

The existing scheduled daily pipeline now writes and audits this separate
artifact after `score_live`. The existing retention and backup steps remain
intact. The change has not been merged or used to dispatch a job.

## Product and browser verification

The compact card retains the dark green board, native typography, labelled
numeric scores, responsive two-column pairing and neutral difference text.
A native keyboard disclosure opens separate horizon/model tables in a named,
focusable scroll region. Publication, source fetch and result cutoff times
remain explicit. No new frontend probabilities or model calls are introduced.

Evidence is in [forecast-comparison-2026-10](forecast-comparison-2026-10/).
The browser audit uses actual Chromium and the production Next build at 320,
390, 768 and 1440 pixels. It follows matchup → published record → comparison,
keyboard opens/closes the disclosure and scrolls the table, then verifies
Back, Forward and reload with the saved board setting. It checks rendered
scores against the artifact, source links, overflow, WCAG axe checks and
uncaught page errors.

Missing-artifact and empty-latest evidence comes from separate real production
builds with temporarily withheld data. Those are explicitly controlled QA
states; their data is restored before final validation and never committed as
forecast evidence. Existing recorded player/source-outage fixtures remain
isolated to local browser QA. The full browser suite also covers Lab, schedule
week selection, matchup return, close-game paths, player comparison/profiles,
appearance and error journeys.

Local screenshots verify the cloud production build, not hosted Vercel pixels,
physical iOS/Android devices or an installed PWA. Exact-head CI and PR links
are recorded in the draft PR description.

Original comparison gates passed: **139 backend tests** (23 comparison cases), **23
Node tests plus week contracts**, zero lint warnings/errors, typecheck and
the **306-page** production build. All seven actual Chromium suites passed:
new comparison (4 published journeys), theme (112 checks plus 5 hydration
cases), paths (12), leaders (16), Lab (4), week (8) and profiles (10).
Four missing-artifact and four empty-latest journeys also passed from their
separate production builds. No new-panel axe violation, horizontal page
overflow or uncaught page error was found. The older profile audit's optional
loading observation was **false**; it is not claimed as a tested loading
case. Paths and leader audits did observe their controlled loading cases.

Screenshots: [mobile](forecast-comparison-2026-10/mobile.png),
[desktop](forecast-comparison-2026-10/desktop.png),
[cohort table](forecast-comparison-2026-10/cohorts-desktop.png),
[missing artifact](forecast-comparison-2026-10/missing-artifact-mobile.png),
[empty latest](forecast-comparison-2026-10/empty-latest-mobile.png).

## Reviewer follow-up: invalid metadata timestamps

On isolated copies of the restored October 8 database, replacing one snapshot
publication timestamp with a naive or malformed string reproduced a CLI error.
Selection correctly withheld the row, but source metadata maxima still parsed
all raw timestamps and raised before writing the comparison output.

Source maxima now consider valid timezone-aware instants only. Each of the three
range fields has explicit `sources.timestamp_coverage` valid/invalid counts;
an all-invalid range is `null`. The CLI prints those counts. If any invalid
timestamp is present, the Accuracy disclosure labels source freshness incomplete
and separately counts publication, result-fetch and kickoff timestamps. Those
counts refer to timestamps, not distinct games. The existing artifact lacks
the optional field and continues to render unchanged.

The two isolated probes now exit successfully with **14,083 valid publication
timestamps and one invalid**, 64 latest and paired games, and the original
valid maximum October 8 at 17:47:35 UTC. Original warehouse, first log and
comparison artifact hashes remain unchanged. CLI integration tests cover naive
and malformed strings in all three source fields, differing timestamp offsets,
all-invalid ranges and read-only input preservation. The backend suite now has
**146 tests**, including **30 comparison cases**. No committed data was regenerated.
The [before](forecast-comparison-2026-10/metadata-probe-before.json) and
[after](forecast-comparison-2026-10/metadata-probe-after.json) probe summaries
record both exit codes and preserved input hashes. A separate detached cloud
worktree supplies explicitly synthetic timestamp-coverage counts for browser
QA; the primary checkout's artifact is never altered. The warning passed all
four viewport journeys, keyboard/table interactions, axe and overflow checks:
[warning screenshot](forecast-comparison-2026-10/metadata-warning-mobile.png),
[browser checks](forecast-comparison-2026-10/metadata-warning-checks.json).

The separate reviewer audit is a standard-library-only script outside the
repository, importing neither implementation module. It reads SQLite in
`mode=ro&immutable=1` with `query_only=ON`; the existing WAL is empty. It verified
the expected warehouse hash, 14,084 snapshots / 272 fixtures / 64 results, and
exactly matched all 64 selected raw probabilities, versions and timestamps.
It checked all IDs, horizons, cohort scores and coverage with zero mismatches.
Its script, complete log and per-game evidence remain in the saved cloud review
directory `/workspace/nfl-comparison-review-2026-10-09/` as
`standalone_sqlite_audit.py`, `standalone-audit.log` and
`standalone-row-evidence.json`. They were not pushed merely for the audit.
