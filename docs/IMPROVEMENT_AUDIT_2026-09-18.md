# Gridiron: Forecast Lab and prediction reliability

Based on GitHub main `5e3fb56`, fetched and fast-forwarded on 18 September
2026. Work began on `codex/nfl-forecast-lab`. This follows the scope of
“Improve soccer predictor platform”: inspect the current platform, improve
its fan experience, and test model changes with evidence before promotion.

For the subsequent conditional playoff simulation and weekly briefing work, see
[the continued improvement report](CONTINUED_IMPROVEMENTS_2026-09-18.md). The
sections below describe the first pass; its simple record calculator is retained
as a secondary interaction.

## Fan experience

The homepage now opens into an interactive matchup spotlight. `/lab` gives
fans a dedicated place to search teams, browse weeks, sort by matchup closeness,
filter followed teams, and share a selected game. Browser back restores the
selected fixture and clears filters that could otherwise hide it. Team marks lead to franchise
pages; game breakdowns, the conference race and the accuracy record remain
one click away. Following uses the existing device preference and survives
navigation; when persistent storage is blocked it works in memory.

The Lab brings together published home/away/tie probabilities, expected scores,
venue, the discrete margin chart and the spread slider. These are lookups of
Python-generated artifacts, including probability mass outside the drawn
margin range. It does not run a second forecasting model in the browser.

The record scenario adds one selected win, loss or tie to the published
standings. It explicitly does not simulate intervening fixtures or recompute
playoff odds. Matching forecast and standings timestamps are required; otherwise
record controls are disabled. This is a useful interaction without pretending
that a record calculation is a conditional season simulation.

The existing chalkboard theme and ambient controls remain. Controls have
44-pixel targets; probability values are text as well as color. Browser
verification caught and fixed a 320px header overflow: the redundant Board
caption now hides on small screens while all three ambient controls remain.
The shared spread slider also now uses valid term/description markup, fixing
the definition-list violations found by the accessibility audit. The chosen
game comes before the fixture selector on small screens. Native font stacks
remove the build-time Google Fonts request. Build concurrency is capped at
two workers for resource-constrained environments.

## Forecast contracts

The page and refresh API share a validated artifact reader. Invalid timestamps,
probability triples, spread probabilities, lattice mass and duplicate fixture
IDs are withheld. A missing artifact returns a visible unavailable state and
HTTP 503 from the refresh API. A failed refresh keeps the last loaded data.
Forecasts older than 48 hours carry a notice; games that have kicked off are
removed from the upcoming selector as the browser clock advances. A shared
missing/past fixture is explained rather than silently presenting another game
as the shared one. All kickoff times retain the existing Eastern convention.

Publication time, model version and training cutoff are identified separately.
Old artifacts correctly say the cutoff was not recorded. Future publications
include the training cutoff and fitted-row count. The UI explicitly identifies
missing quarterback/injury/live-event inputs.

## Findings fixed

### Forecast history was replaceable and could disappear

`record_predictions` described its table as append-only but used `INSERT OR
REPLACE`. It now rejects a conflicting immutable key and treats identical
retries as idempotent, inside a transaction. Selection of the earliest eligible
forecast compares actual timestamp instants with SQLite `julianday`, rather
than lexical strings with potentially different UTC offsets. Ties between model
versions at the same timestamp select one deterministic row per fixture.

The daily workflow used to interpret every failed warehouse download as an
absent release and rebuild from scratch. ESPN can rebuild results, but cannot
rebuild yesterday’s forecasts. Restore failures now stop publication, including
on a requested full rebuild. An initial installation must explicitly publish
its first warehouse release; download errors are never treated as bootstrap
authorization. Refresh failures also stop the run rather than
putting a fresh generated-at stamp on a stale corpus.

Before updating the latest release asset, a row-level comparison requires
every restored snapshot to remain unchanged. A uniquely versioned warehouse
backup is uploaded before the latest asset and before the artifact commit.
Rebase failures are no longer ignored. Daily forecast and weekly benchmark
jobs share a publication concurrency group.

The live scorer refuses to replace a record with fewer recorded fixtures or
missing/altered previously graded forecasts. It allows result corrections but
not probability revisions. Previous-season logs are retained at rollover.
Invalid probability triples and forecasts generated after the actual recorded
kickoff are excluded and counted. Model-version and forecast-horizon cohorts
are computed from raw graded rows; an empty cohort has null scores, not zero.
The earliest-publication horizon policy remains unchanged and is explicit.

Remaining boundary: generation, release persistence, git publication and website
deployment are separate operations. A durable, hash-bound publication manifest
would provide stronger proof of actual public availability than a generation
timestamp alone. Versioned release backups also need a deliberate retention
policy; this change does not delete recovery material.

### The benchmark pooled unrelated weeks

ESPN restarts week numbers in the postseason. The benchmark grouped on
`(season, week)`, so regular-season week 1 and Wild Card week could share the
same fit. The target game’s features were current, but the fitted coefficients
were unnecessarily frozen at the earlier week. Metadata and refit groups now
include `season_type`. The recency experiment uses the same corrected grouping.

The constant baseline previously used the home-win rate of the entire scored
test sample, resulting in a deceptively perfect aggregate calibration error.
It now estimates that frequency from the training games before each test week.
It remains a baseline; it no longer reads the held-out outcomes.

The existing paired bootstrap now generates bounded batches instead of a
10,000-by-games index matrix, while preserving its seeded random sequence.
The recency experiment additionally resamples whole season/phase/week blocks.
Mid-P diagnostics are described accurately: centering a discrete CDF cell
does not make its distribution exactly uniform.

### A retained price is not a verified close

The ingest correctly distinguishes pregame prices from in-game odds and public
prediction models. But backfilled ESPN prices have no historical observation
timestamp. The evidence panel and accuracy page now say historical market
prices, rather than certifying them as closing prices. Spread-derived and
moneyline rows remain distinguishable. A model winning a comparison warrants
an audit; it is not logically impossible for a model without price inputs to
outperform a market on a sample.

## Measured challenger

`backend/scripts/experiment_recency.py` tests a fixed three-year half-life in
the margin/total ridge coefficients and residual scales. It keeps full-history
key-number counts, then reconciles them against the fitted kernel, isolating
the recency hypothesis rather than changing every component at once. Optional
weights are not enabled in the production publisher. The unweighted model and
Elo remain the baselines.

The experiment refits weekly from earlier games only and scores 2019–2025.
There is one predeclared challenger, no search over decay settings on those
seasons, and no automatic promotion. The report retains every paired prediction,
season results, proper probability scores, margin/total errors, the input and
experiment-source hashes, package versions and a 4,000-draw paired week-block
interval. It reports moneyline coverage separately and does not invent a price
where one is missing.

The latest warehouse release download failed with a GitHub TLS handshake
timeout. Results therefore use the existing local warehouse, not a claimed
fresh release. They are exploratory historical evidence and cannot be promoted
to production by this script. The final measured result and verification log
are in [VERIFICATION_2026-09-18.md](VERIFICATION_2026-09-18.md).

## Highest-value next model work

1. Collect timestamped quarterback/roster availability and odds at explicit
   horizons (for example 24 hours and one hour before kickoff). Separate
   observation time from kickoff and provider revisions. Compare paired
   forecasts on covered fixtures with a measured missing-data path.
2. Add opponent-adjusted efficiency only after recovering actual box scores or
   play-by-play with audited coverage. Empty yards/turnover columns are not
   zero-valued predictors. Compare against the simpler Elo baseline first.
3. Fit calibration and any ensemble weights on earlier temporal folds only.
   Report proper scores, reliability, ties, margin/total error, and season-level
   stability. Preserve an untouched future evaluation period for selection.
4. Evaluate conditional season simulations for a true “if they win” playoff
   experience. Publish both scenario branches from the same simulation seeds;
   do not infer playoff changes by adding one win to a table in JavaScript.
5. Validate remaining common-games and deeper postseason tiebreakers against
   archived outcomes. Report uncertainty/withheld seeds where rules are still
   approximated, rather than implying official standings parity.

## Next product work

The Lab is a more connected route through existing evidence, not a demonstrated
retention lift. Measure successful fixture-to-detail navigation, following,
return visits and loading/error rates with privacy-appropriate instrumentation.
Future fan picks would need timestamped storage and kickoff locking; community
percentages must come from actual users. Cross-device following would require
an explicit account feature. Neither is simulated in this implementation.

## References

- [Rolling-origin evaluation](https://otexts.com/fpp3/tscv.html) supports the
  temporal evaluation design; training always precedes the scored period.
- [Next.js server/client boundaries](https://nextjs.org/docs/app/getting-started/server-and-client-components)
  support keeping artifact reads on the server and interactions in client components.
