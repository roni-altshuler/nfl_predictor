# Game leader comparison — cloud review, 2026-10-07

The existing Games/results archive → matchup → player/team journey now includes
an away/home leader comparison. A native category selector pairs only identical
ESPN category keys and shows each reported statistic verbatim. Provider IDs,
actual supplied positions and shirt numbers retain their source meaning.
The statistic period is unverified and is stated on the board; a summary line
is not asserted to be game-only or career performance. Missing sides, statistics
and IDs stay unknown; conflicting identities or
multiple leader lines are withheld. Profiles and team links return to the
selected category URL, and one further Back returns to the originating archive.

This is a bounded extension of the existing game pages and summary normalizer.
The existing hypothetical matchup predictor already covers team probability
comparison. No new probability calculation, roster collector, player ranking,
scouting grade, career record, headshot asset or training run was added.
The styling extends Gridiron's original green board, neutral identity plates,
team marks and typography. The old archived flat leader list is replaced rather
than duplicated; the existing all-player section remains available.

## Repository and source state

Verified repository: `roni-altshuler/nfl_predictor`. No open PR existed when this
branch was created. Base main was `35af79cf016129553af89f9d9a0749cc7984be22`,
which already includes independently merged player profiles (PR #4), the
security work and the automated October 6 forecast / October 7 benchmark
refreshes. Previous recovery branches and main are preserved. No laptop-only
work was recovered or overwritten.

The reviewed forecast file contains **208** fixtures, generated
**2026-10-06T17:05:01Z**, with results cutoff
**2026-10-06T00:15:00Z**. Retained pre-game snapshots are not a live schedule.
The browser's populated comparison uses the already-recorded response subset
for event `401872966`, source update **2026-10-04T20:11:04Z**. That event now
belongs to the published 2026 archive; its calendar date is **2026-10-04** and
kickoff time is explicitly unavailable. The source update is not substituted
for kickoff time. No provider refresh or bulk collection was performed here.

Current matchup pages reuse the existing ESPN summary endpoint and 24-hour cache.
The UI distinguishes an unavailable/mismatched source from an available empty
response. Category changes use native history replacement, preserving other
query parameters without adding Back entries or triggering another game request.
The captured athlete URL references still have no verified display permission;
the existing initials/number fallback is reused, with no portrait requests.

## Verification

Required local checks: frontend contract tests, lint, TypeScript, production
build (306 static pages), and **116 backend tests** passed. Fourteen player/date/
comparison tests cover source-key pairing, raw lines, missing fields, real zero,
ambiguous and conflicting identity, source mismatch, provider-qualified profile
identity, date precision and existing portrait permissions. Five Forecast Lab
tests and week-browser regression checks also pass.

The existing profile test and browser harness now select a currently published
forecast for future-game assertions and resolve the captured response through
the archive when needed. The October 6 refresh had moved that event out of the
forecast slate; keeping the earlier future-game assumption would test the wrong
date precision. Populated archived comparisons remain required in controlled QA.

Real Chromium **151.0.7922.173** production-server journeys passed at **320,
390, 768 and 1440px**, with reduced motion enabled. Screenshots were visually
inspected at mobile and desktop widths, including loading, unavailable, empty
and unknown-field states. The comparison audit found zero WCAG A/AA axe
violations across the game's main content, no horizontal viewport overflow,
no page exceptions and no portrait requests. A mobile score-table scroll area
found during QA now has a named keyboard-focusable region; other horizontal
game tables use the same affordance.

Verified interactions:

- Published archive → keyboard matchup → comparison anchor → visible 2px focus
  on the 44px native category selector.
- Keyboard ArrowDown/Enter and repeated category changes preserve the query,
  actual provider-ID links, positions and raw values. No category-driven game
  navigation request occurs; existing background link prefetches are recorded
  separately.
- Player profile and team navigation return to the selected category. One more
  Back returns to the archive without extra category-history steps.
- Fresh category deep link, unknown-category recovery, synthetic missing side /
  ID / position / statistic, available empty summary, source 503 and unknown game
  retain explicit unknowns and useful recovery navigation.
- Raw categories with two named leaders and with an unnamed second entry
  withhold the comparison at all four widths. Switching to a single-leader
  category and returning from its profile works; both named source leaders remain
  accessible in the existing Players section and preserve their profile returns.
- Actual server-rendered comparison skeleton observed while local JavaScript
  bundles were held; controls hydrated after the bundles were released. Direct
  visits to this static archive do not independently show the game-route skeleton.
- Existing Lab, week selection, keyboard matchup return, app-navigation reset,
  Back/Forward, header-image outage, empty-filter and profile recovery regressions
  pass. The latest forecast uses controlled unavailable profiles, while the
  captured archive requires populated comparisons and profile/team returns.
  Archived OAK/LV franchise context, date-only kickoff and a delayed older profile
  response preserving the newer player's identity also pass.

Evidence: [comparison results](leader-comparison-2026-10/browser-results.json),
[week results](leader-comparison-2026-10/week-results.json),
[profile results](leader-comparison-2026-10/profile-results.json), and
[Lab results](leader-comparison-2026-10/lab-results.json).

| Visually inspected state | Screenshot |
|---|---|
| Mobile paired leaders, 320px | [Mobile comparison](leader-comparison-2026-10/comparison-receiving-320.png) |
| Desktop paired leaders, 1440px | [Desktop comparison](leader-comparison-2026-10/comparison-receiving-1440.png) |
| Actual pending hydration | [Loading](leader-comparison-2026-10/comparison-loading-390.png) |
| Controlled source 503 | [Source unavailable](leader-comparison-2026-10/comparison-source-outage-390.png) |
| Synthetic unknown fields | [Unknown identity/statistic](leader-comparison-2026-10/comparison-unknown-fields-390.png) |
| Available empty summary | [Empty](leader-comparison-2026-10/comparison-empty-390.png) |
| Two raw named leaders, mobile / desktop | [Mobile withheld](leader-comparison-2026-10/comparison-ambiguous-320.png) / [Desktop withheld](leader-comparison-2026-10/comparison-ambiguous-1440.png) |
| Unnamed second raw entry, mobile / desktop | [Mobile incomplete](leader-comparison-2026-10/comparison-ambiguous-unnamed-320.png) / [Desktop incomplete](leader-comparison-2026-10/comparison-ambiguous-unnamed-1440.png) |

After a lifecycle disconnection notice, the same saved executor was verified
usable: the working branch and files remained intact, and the local production
server returned HTTP 200. Work continued there without switching environments.

## Independent review correction: raw leader multiplicity

Independent review found that the summary normalizer truncated each raw category
to its first leader before the comparison checked multiplicity. The earlier test
added a second line after normalization and missed this boundary. A regression
adding a second athlete to the raw recorded fixture failed with `reported`
instead of `ambiguous` before the correction.

Normalization now preserves every named source line and the raw entry count
before filtering incomplete display fields. The comparison withholds a side
when either count exceeds one. A separate raw regression verifies that an
unnamed second entry cannot make the remaining named line appear unambiguous.
Named source leaders retain their provider-ID profiles and verbatim statistics.
The added browser fixture for published archive event `400554211` is entirely
synthetic: two named passing leaders, a receiving category with one unnamed
entry, and a single rushing leader for recovery navigation. It makes no claim
about the historical game. No provider request or other feature change was
needed for this local correction and its controlled QA.

## Narrow dependency advisory response

The October 7 npm advisory review identified the image library's October 6
update. `sharp` is pinned to **0.35.5** with its matching platform packages;
the installed Linux binary reports **librsvg 2.63.2** and libvips 8.18.7.
This addresses [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
No framework, React, ESLint or broad dependency upgrade was performed.

The post-change npm audit still reports **14 affected dependency nodes**
(11 high, 3 moderate), including pre-existing development-tool chains. The
production-only audit reports **3 nodes** (2 high, 1 moderate): Next's PostCSS
chain and source-map-js. These node counts are not unique vulnerabilities.
Remaining findings include
[PostCSS GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp)
and [source-map-js GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
The repository is not claimed to have a clean dependency audit; the broader
toolchain remediation remains for independent review.

## Reproduce controlled browser QA

The fetch preloader is opt-in test code. It reuses the recorded summary, the
previously documented synthetic OAK/LV archive response, and explicitly
synthetic ambiguity/empty/missing-field responses for existing archive events. All other
ESPN server responses return controlled 503; the browser blocks ESPN CDN assets.
These fixtures make no claim about actual historical players or source uptime.

```bash
npm test
npm run lint
npm run typecheck
./.venv/bin/python -m pytest backend/tests/ -q
NODE_OPTIONS='--require ./scripts/player_browser_fixture.cjs' \
  PLAYER_AUDIT_COMPARE_STATES=1 npm run build

# Run this server in a separate shell.
NODE_OPTIONS='--require ./scripts/player_browser_fixture.cjs' \
  PLAYER_AUDIT_COMPARE_STATES=1 PLAYER_AUDIT_SLOW_EVENT=401127974 \
  npm start -- --hostname 127.0.0.1 --port 3034

BASE_URL=http://127.0.0.1:3034 BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
  PLAYER_AUDIT_EXPECT_FIXTURE=1 PLAYER_AUDIT_COMPARE_STATES=1 \
  PLAYER_AUDIT_SLOW_EVENT=401127974 AUDIT_USE_PUBLICATION_TIME=1 \
  npm run test:browser
```

The comparison/profile journeys use the current browser clock. Only the existing
Forecast Lab audit explicitly uses the artifact publication clock. Default CI
uses actual application summary responses; its populated-source coverage is
conditional, while controlled local QA requires populated comparison journeys.
Manual screen-reader testing and live public deployment/provider freshness are
outside this evidence. No merge, workflow dispatch, credentials, paid service,
security-setting change or external announcement was performed.
