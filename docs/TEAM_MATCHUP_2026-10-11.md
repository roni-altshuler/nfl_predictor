# Published team matchup · October 11, 2026

Team pages previously put season tiles and a generic player link ahead of the
active game, while the schedule hid kickoff dates on phones. A published
matchup card now follows the team header, before season projections. It shows
the two published win chances and projected scores, the separate tie chance,
the scheduled Eastern kickoff, and publication/results-cutoff timestamps.
Distinct links open the matchup, its selected player reports, the opponent's
team, or the team's published schedule. Schedule rows show dates at every
width and identify whose win chance is displayed.

The first retained fixture is selected by the existing date-sorted publication,
not by the visitor's clock. Once its scheduled kickoff passes, the card remains
a dated forecast until another artifact is published. It neither infers a live
status nor settles a result. Missing coverage renders an explicit unavailable
message and a games link, rather than a fabricated matchup or zero values.
Player reports remain selected leaders and availability, not a full roster.

Reference: [NFL.com's team page](https://www.nfl.com/teams/new-york-giants/),
for clear team destinations and dated matchup entry points. Gridiron retains
its original Chalkboard identity, cream team-mark plates and primary action,
semantic probability colour, 44px link targets, and reduced-motion behaviour.
No NFL photography, copied page content, or new athlete assets are used.

## Scope and preservation

The branch starts from main **c857f8ddd402ee5feb8c39ba47ea9723ca946290**, after
the merged October 10 framework maintenance and automated forecast publication.
The security main commit `903353b` is an ancestor. No open PR was present at
inspection. Existing local recovery branches and the separate unpublished
comparison QA worktree are retained; their hashes are recorded in the
[preservation check](team-matchup-2026-10-11/preservation.json).

All 44 checked artifact/workflow/lock files remain byte-identical, including
forecast history and actual settlement. Dependency versions are unchanged;
`package.json` only registers the new contract and browser audit. No provider
collection, model training, baseline change, manual workflow dispatch, merge,
visibility/security-setting change or paid service is involved. The older
laptop-only header fallback was not recovered or overwritten; the existing
independent cloud fallback is reused.

The October 11 registry audit still reports **14 affected packages: 11 high,
3 moderate, 0 critical**, with no new advisory URLs relative to the October 10
snapshot. See the [audit snapshot](team-matchup-2026-10-11/audit.json). This is
not a clean-audit or deployment-exploitability claim. Existing dependency
findings and the announced October 14 Next security release remain follow-ups.

## Verification and visual evidence

Local lint has zero warnings/errors; TypeScript, 27 Node contract tests plus
the week assertions, all 146 backend tests, and the 305-page production build
pass. The four new server-rendered contracts check side/value mapping, native
destinations, dated and neutral-site semantics, and unavailable coverage.

Production Chromium checks 320, 390, 768 and 1440 pixels against the committed
publication. The [team browser report](team-matchup-2026-10-11/team-checks.json)
records exact probability/score/timestamp parity, aligned win-chance rows,
keyboard matchup opening,
opponent and player-report returns, schedule focus, two repeated later-game
returns per width, anchor reload, a neutral fixture, and the explicit artificial
2030 clock probe. It also records an interrupted matchup RSC request, navigation
to Games, release of the older response, and successful retry/return.
Checked states have zero document overflow, axe violations, page errors,
developer overlays or portrait requests. This audit runs in the existing CI
browser command, alongside the seven earlier audits.

Browser testing found two issues while developing the card. The inherited
season record's scroll container was not keyboard-focusable; it now has a
named, focusable region. A plain schedule hash anchor created a history entry
without Next's route state, leaving a matchup on screen after Back restored
the team URL. Using the documented [Next hash link](https://nextjs.org/docs/app/api-reference/components/link#scrolling-to-an-id)
preserves the route entry. The regression audit checks both URL and restored
team content after repeated returns; no global history handler is changed.

Inspected screenshots: [320px](team-matchup-2026-10-11/team-320.png),
[390px](team-matchup-2026-10-11/team-390.png),
[768px](team-matchup-2026-10-11/team-768.png),
[1440px](team-matchup-2026-10-11/team-1440.png), and the
[phone schedule](team-matchup-2026-10-11/schedule-390.png).
The [before screenshot](team-matchup-2026-10-11/before-390.png) and
[baseline observations](team-matchup-2026-10-11/baseline-checks.json) record the
previous hierarchy and hidden phone dates. The updated
[profile audit](team-matchup-2026-10-11/profile-checks.json) checks unavailable
reports at all four widths, captured/synthetic archive cases, filtered return,
and a held older profile response released after a newer identity. Its optional
loading observation is false; that case is not claimed as exercised.

## Source dates, reproduction and limits

The retained 207 forecasts were published **2026-10-10T16:08:53+00:00**, with
results used through **2026-10-09T00:15:00+00:00**. Rechecking on October 11 does
not refresh those sources. Win probabilities and projected scores are rendered
directly from those bytes; there is no new accuracy or adaptive-model claim.

Local browser QA uses the existing captured ESPN subset and explicitly
synthetic archive/error fixtures; other ESPN server requests return controlled
503s. Browser image requests are blocked so team identity fallbacks remain
visible. These checks establish layout and recovery, not live provider health.

The new team card, schedule anchor and opponent-team link work with JavaScript
disabled. The inherited game loading boundary needs JavaScript to reveal its
streamed detail; the no-JavaScript detail probe stayed on a skeleton. The
fresh-tab game-parent check therefore uses a separate hydrated context. No
JavaScript-disabled game-detail support is claimed by this patch.

```bash
npm run lint
npm test
npm run typecheck
./.venv/bin/python -m pytest backend/tests/ -q
NEXT_TELEMETRY_DISABLED=1 \
  NODE_OPTIONS='--require ./scripts/player_browser_fixture.cjs' \
  PLAYER_AUDIT_COMPARE_STATES=1 npm run build
NODE_OPTIONS='--require ./scripts/player_browser_fixture.cjs' \
  PLAYER_AUDIT_COMPARE_STATES=1 PLAYER_AUDIT_SLOW_EVENT=401127974 \
  npm start -- --hostname 127.0.0.1 --port 3029
# In another terminal; Playwright's installed Chromium also works.
BASE_URL=http://127.0.0.1:3029 BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/team_matchup_audit.mjs
BASE_URL=http://127.0.0.1:3029 BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
  PLAYER_AUDIT_EXPECT_FIXTURE=1 node scripts/player_profiles_audit.mjs
```

Versions, hashes and local gates are recorded in the
[validation summary](team-matchup-2026-10-11/validation.json). Full logs,
failed probes and additional screenshots remain under
`/workspace/nfl-team-matchup-review-2026-10-11/` in the saved cloud environment.
Hosted preview pixels are not verified by these local production checks;
the October 10 direct Vercel deployment read returned 403 for the existing scope.
