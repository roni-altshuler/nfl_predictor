# Static sports backgrounds · October 12, 2026

Decorative backgrounds are removed globally, following the owner's explicit
request. The shared shell no longer imports or mounts the simulated football
field. Its 1,497-line canvas component, recurring animation-frame loop, camera,
particles, resize/visibility handlers and simulated plays are deleted. The
97-line ambient control, pre-paint storage script, root hydration suppression,
ambient CSS and two body gradient layers are also removed.

Every page now uses one flat `#0b120e` background. The existing cream logo plates,
off-white text, semantic colours and chart palette remain. NFL already has a
dark-only design: light and dark system preferences are both checked, but this
patch does not add a separate light-theme setting. Old `soft`, `vivid` and `off`
device values remain stored and are ignored, including after navigation/reload.
No renderer is hidden behind CSS or paused by reduced-motion preferences.

Chart, bracket and navigation destinations remain; spread sliders, margin
controls, following filters, scenarios, keyboard focus and hover feedback are
preserved. Finite foreground route/list/data transitions, loading shimmer and
the factual live-score indicator remain. These are foreground feedback, not
decorative background layers. No model, data, provider, security, visibility,
dependency, workflow or forecast-settlement change is included.

Supplemental [interaction checks](static-backgrounds-2026-10-12/interaction-checks.json)
verify bracket keyboard navigation to a team and Back without changing the
displayed values. A held-client-bundle probe confirms the
[loading shimmer](static-backgrounds-2026-10-12/loading-paths-390.png) remains
active over a flat background and completes into working margin controls.

## Verification and before/after pixels

The branch starts from current main
`1be2a407f38fb0a1e634797e33beb29492fe77cc`, including PR10 and the October 11
automated publication. No open NFL PR was present at inspection. Existing
recovery branches, worktrees and four unpublished comparison-fixture files are
preserved; the [preservation report](static-backgrounds-2026-10-12/preservation.json)
checks source and data hashes. The laptop-only header fallback is untouched.

Baseline Chromium, with reduced motion off, observed one canvas and 30–31
animation frames over each 500ms sample on home, schedule, team and matchup
pages. Matching after-build samples record zero canvases and zero continuing
frames, with `background-image: none`. See the
[before](static-backgrounds-2026-10-12/before-checks.json) and
[after](static-backgrounds-2026-10-12/after-checks.json) measurements.

Inspected pairs: [phone before](static-backgrounds-2026-10-12/home-before-390.png)
and [phone after](static-backgrounds-2026-10-12/home-after-390.png);
[schedule before](static-backgrounds-2026-10-12/schedule-before-1440.png) and
[schedule after](static-backgrounds-2026-10-12/schedule-after-1440.png).
Additional [320px](static-backgrounds-2026-10-12/home-after-320.png),
[768px](static-backgrounds-2026-10-12/home-after-768.png),
[team](static-backgrounds-2026-10-12/team-after-390.png) and
[bracket](static-backgrounds-2026-10-12/bracket-after-1440.png) captures document
the shared treatment.

The updated production [theme journey](static-backgrounds-2026-10-12/theme-checks.json)
checks 320, 390, 768 and 1440px under both system colour preferences with
reduced motion off. It inspects mounted canvas/ambient nodes, SVG animation
elements, body background images, pending animation-frame callbacks, frame
activity and running CSS animations after finite foreground transitions settle.
Legacy preferences are also checked with client bundles deliberately held,
before and after hydration. A screenshot alone is not the loop-removal oracle.

Existing week/matchup return, Close-game paths, spread/scenario, comparison,
player/profile, empty/error and interrupted navigation assertions remain in
the eight-script browser command. The team interruption probe now uses the
existing Follow control after an observed hydration/prefetch request, rather
than the deleted ambient control. Lint, TypeScript, the 27 Node contracts plus
week assertions, and the 305-page production build pass. Actual browser gate
results are recorded in [validation](static-backgrounds-2026-10-12/validation.json).

## Contrast completion and strict gates

The flat backdrop exposes small red text that previously used `--accent-loss`
(`#c8544c`). An independent original-main build reported incomplete contrast
evaluation with its canvas/gradients; that is not evidence of an accessible
baseline. The initial static measurement was 4.26:1, below the 4.5:1 text floor.

Small loss/status/error labels now use the existing `--accent-loss-soft`
(`#d4655e`) text token. Eight text-token uses are corrected across team history
and form, game availability and form, archived standings, season preview,
upset margins and the conditional accuracy note. Their values, meaning and
layout are unchanged. Base loss/live/chart colours and the chart palette stay
unchanged. This is the directly exposed text completion of the removal.

All added contrast waivers, helper imports and exemptions are deleted. Every
browser audit again asserts an empty Axe violation array. The
[contrast measurements](static-backgrounds-2026-10-12/contrast-measurements.json)
validate actual composited backgrounds, normal table rows, hovered rows and
synthetic availability badges at 320/390/1440px. The measured minimum is
**4.57:1**. The [original/static comparison](static-backgrounds-2026-10-12/contrast-comparison.json)
remains as the before measurement, not a permission to bypass failures.

Focused screenshots show the [historical table](static-backgrounds-2026-10-12/historical-table-390.png)
and [availability badges](static-backgrounds-2026-10-12/availability-badges-390.png)
after correction. Availability uses explicitly synthetic `Out` lines rendered
by the unchanged game components. The local-only preloader remains outside the
repository; no fake status is committed or deployed. All eight scripts pass in
the [strict populated run](static-backgrounds-2026-10-12/availability-checks.json).
This supplements the ordinary captured/outage fixture and populated provider
responses in automatic CI. The ordinary QA build is restored after fixture QA.

QA reads the retained publication **2026-10-11T16:35:55+00:00**, with results
used through **2026-10-09T00:15:00+00:00**. Neither date becomes fresher because
of this UI review. Local server QA uses the existing captured ESPN subset and
explicitly synthetic archive/error fixtures; other ESPN requests return
controlled 503s and browser images are blocked. Layout and interactions are
verified, not live provider health or new forecast accuracy.

Hosted pixels and deployment alias-to-SHA mapping are not established by local
QA. The existing Vercel scope and cloud proxy previously returned 403; no
credentials, protection settings or production dispatch are changed.

```bash
npm run lint
npm test
npm run typecheck
NEXT_TELEMETRY_DISABLED=1 \
  NODE_OPTIONS='--require ./scripts/player_browser_fixture.cjs' \
  PLAYER_AUDIT_COMPARE_STATES=1 npm run build
NODE_OPTIONS='--require ./scripts/player_browser_fixture.cjs' \
  PLAYER_AUDIT_COMPARE_STATES=1 PLAYER_AUDIT_SLOW_EVENT=401127974 \
  npm start -- --hostname 127.0.0.1 --port 3031
# In another terminal; Playwright's installed Chromium also works.
BASE_URL=http://127.0.0.1:3031 BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
  PLAYER_AUDIT_EXPECT_FIXTURE=1 AUDIT_USE_PUBLICATION_TIME=1 npm run test:browser
```

Full logs, extra screenshots and the independent original-main QA copy remain
in `/workspace/nfl-static-backgrounds-review-2026-10-12/` in the saved cloud
environment. The PR remains for independent review; no merge or manual
forecast/model/provider job is part of this work.
