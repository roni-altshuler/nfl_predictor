# Saved prediction season record

`/accuracy` leads with first-published outcome picks: correct / eligible settled
games and a percentage, then the cumulative and most recent 16-outcome timeline.
The season/week/coverage controls use URL state, restore through reload and
Back/Forward, and keep the headline and timeline on the full-season denominator.
The game ledger shows the saved pick beside the recorded final score/outcome.
Individual disclosures retain the original probability vector, model and timing.

The current-season schedule also includes completed weeks from the same recorded
outcomes. Existing upcoming matchup probabilities remain published snapshots.
Recorded results never borrow an archive's retrospective probabilities.

## Scope and ties

The primary rule is the unique maximum of the saved `p_home`, `p_tie`, `p_away`
triple. Home win, tie and away win are three ordinary outcomes. A nonunique
maximum is explicitly unpicked; absent or conflicting evidence is ungraded.
Neither is silently counted as an incorrect pick or as zero-percent accuracy.

Conditional binary probability scores retain their existing first/latest
selection and tie-exclusion rules in a separate native disclosure. Retrospective
walk-forward testing, calibration, market comparisons and research remain below
the saved record and never fill it. This change does not refit a model, alter
forecasts, improve measured accuracy or establish an advantage over a market.

For the retained October 30, 2026 snapshot, the independently reconciled primary
record is 63/108 (58.3%), including one actual tie. The conditional binary record
is 63/107 (58.9%), excluding that tie. The last 16 eligible three-way outcomes
contain nine correct picks. These are August 16 preseason calls, not the accuracy
of the latest weekly fit. The application derives these values from artifacts;
they are not constants in the UI.

## Evidence boundary

The server loader reads the raw first log, comparison, current fixture snapshot
and regular-season result archive. The comparison's exact first-log SHA256 must
match the bytes read. Pure derivation validates unique evidence IDs; regular
season/week/team/result agreement; finite complete H/T/A probabilities; original
model and publication equality; explicit timezone timestamps; publication
strictly before scheduled and actual kickoff; and ESPN result-fetch chronology.
The declared regular/postseason archive counts must exactly match valid rows.

Unknown, malformed, wrong-season or truncated result history withholds overall
totals and the timeline. Honestly empty history has zero rows and zero declared
stage counts and displays “Not yet scored” with no percentage. Missing original
calls stay ungraded. Unauthenticated prediction fields are withheld. Current
snapshot probabilities never stand in for missing first calls.

“Result not recorded” describes retained-source coverage, not a guarantee that a
fixture remains unplayed. Source publication and latest recorded kickoff are
visible; no later result is inferred. Legacy training cutoffs and independent
exact-run publication attestation remain unestablished. No exact-score error is
reported because canonical first-call JSON lacks original home/away estimates.

Timeline dates use actual kickoff in UTC, with game ID for simultaneous games;
these are not observed settlement times. The recent line uses up to 16 eligible
outcomes and the actual denominator. Native controls, visible focus, numeric
labels, distinct line styles, a 0–100% scale and an equivalent focusable data
table support keyboard and mobile use. Scheduled timestamps are labelled as
scheduled, separately from recorded kickoff.

## Verification and runner compatibility

Required local commands are full backend pytest, `npm test`, `npm run lint`,
`npm run typecheck`, `npm run build` and the complete `npm run test:browser`
against a production server. Contract tests exercise evidence mutations, ties,
ambiguous picks, raw-byte SHA mismatches, history counter inconsistencies,
empty/unavailable states and the real artifact reconciliation. The record
browser audit adds 320/390/768/1440px source-derived count/timeline checks,
keyboard/native label checks, query restoration, missing-season coverage and
completed-week navigation to the existing complete audit chain.

The shared browser-running CI/daily/weekly jobs use Ubuntu 24.04 because locked
Playwright 1.60 does not support Ubuntu 26.04. All existing steps, permissions,
schedules, strict assertions and earliest-publication gates are retained.
Repository-supported local installed Chromium uses `BROWSER_EXECUTABLE_PATH`;
hosted CI uses Playwright's bundled browser. Successful exact-head hosted CI is
required before merge. No live forecast job or costly training is needed for
this UI change.

The home audit waits for freshness to agree with the browser clock before
capturing its invariant source text. This handles a static-build timestamp
differing from CI's publication clock, while retaining exact text equality,
44px filter/focus checks, and both 47/49-hour freshness assertions.

## Preserved work

The original October 17 implementation remains in its retained Library packet.
Current supported materialization attempts did not recover its embedded source
bytes. This implementation is a scoped replacement, not a claim to have
restored that patch. Existing held work and draft PR14 remain separate.
