# Cross-page appearance · October 8, 2026 cloud review

The homepage, schedule, game detail, Close-game paths, Forecast Lab and player
profiles were audited from current remote main
`5fca9984aca3a5c2eb210eb08c6e299a145ffda7`. No open PR existed, and the earlier
review/recovery branches were preserved. The audit uses the saved cloud
environment and actual Chromium, with no edits to other projects.

## Baseline and bounded fixes

The first **52** browser checks found a coherent green Chalkboard across the
requested journey, under both light and dark system preferences at 390 and
1440px. Palette tokens, backgrounds, type, cards, cream logo plates and shared
navigation matched. No tested WCAG A/AA violation, viewport overflow, JavaScript
exception or hydration error was found. NFL is intentionally dark-only; its
board-animation dial is a separate device preference, not a theme selector.

Three concrete gaps were verified:

| Observed state | Change |
|---|---|
| With client bundles held, saved `off` was already applied to the board, but both server-rendered dials announced `soft` as pressed. | Render neutral, disabled controls in a busy group until hydration reads the pre-paint attribute; then select and enable the real choice. |
| The served manifest declared brown `#a05c22` chrome and black `#000000` background while the page metadata and canvas use `#0b120e`. | Set both static manifest colors to the existing green canvas. |
| The homepage's “Explore every matchup” arrow rendered as a missing-glyph box with the default sans stack in cloud Chromium. | Use the existing monospace navigation font for that link; preserve its label, route and color. |

The root pre-paint preference script remains the source of board state. The
palette, cream `#f4efe6` logo plates, leather football mark, light/dark design
choice, content, forecasts and provider contracts are unchanged. Hardcoded
colors in the decorative chalk canvas and static brand assets are intentional;
the requested page components consume the shared CSS tokens. Documentation now
records the actual sans/numeric font stacks and warning/loss token values.

## Final browser journey

The reusable theme audit checks **320, 390, 768 and 1440px**, each under light
and dark system color preferences, with reduced motion. It compares the actual
palette, body gradient, typography and card surfaces on each destination.
Runtime system-color changes retain the intentional dark identity. `vivid` and
`off` survive reload; Back/Forward retain the board choice, schedule filters and
selected margin band. Keyboard matchup entry and section/select focus are
exercised. The manifest is fetched through the browser and compared to the live
CSS canvas and viewport metadata.

Empty schedule/watchlist and Lab search states, failed forecast refresh,
populated controlled profiles, missing profile context, profile return and
404 navigation are included. Five held-bundle checks cover `soft`, `vivid`,
`off`, unsupported-storage fallback and desktop `off`. They confirm the canvas
preference is applied before hydration, no false selected choice is announced,
and controls enable with the right selection after bundles are released.

The five existing browser suites remain regression gates for forecast paths,
leader ambiguity/category provenance, Forecast Lab, week navigation and player
profiles. Their source fixtures are documented in the previous reports. The
current retained forecast no longer contains the older player suite's loading
fixture, so its conditional `loadingObserved` remains false. A separate actual
Chromium navigation to `/players/espn/2560899?game=401127974`, with the existing
server fixture delayed 1.5 seconds, captured the player skeleton and its
recovery to the explicit unavailable state. The loading frame retained the
green canvas and saved `off` preference without viewport overflow.

Final validation passed **112** theme/route checks and **five** pending-control
cases, plus all five existing browser suites. The final production build
generated **306** pages; **23** Node contract tests, week-contract checks,
**116** backend tests, lint without warnings and TypeScript passed. Every
tested main region had no tested WCAG A/AA violations or horizontal overflow.
No page exceptions, non-network console errors or portrait requests were
observed. Desktop, phone, pending and loading screenshots were visually
inspected; the homepage arrow renders correctly in the final build.

Screenshots and machine evidence live in [theme-journey-2026-10](theme-journey-2026-10/).
The browser record distinguishes controlled source/outage cases from real
committed forecast artifacts. The forecast publication remains
**2026-10-07T17:43:07+00:00**, with results through
**2026-10-06T00:15:00+00:00**. This audit performs no provider refresh, model
training or accuracy evaluation, and makes no new source-freshness claim.
The old manual Dailyforecast request is obsolete after the October 6 scheduled
recovery; no rerun is pending or dispatched.

## Reproduction

```bash
npm test
npm run lint
npm run typecheck
./.venv/bin/python -m pytest backend/tests/ -q
NODE_OPTIONS='--require ./scripts/player_browser_fixture.cjs' \
  PLAYER_AUDIT_COMPARE_STATES=1 npm run build
NODE_OPTIONS='--require ./scripts/player_browser_fixture.cjs' \
  PLAYER_AUDIT_COMPARE_STATES=1 PLAYER_AUDIT_SLOW_EVENT=401127974 \
  node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3016
# Separate terminal, using installed cloud Chromium:
BASE_URL=http://127.0.0.1:3016 BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
  PLAYER_AUDIT_EXPECT_FIXTURE=1 npm run test:browser
```

The review uses Chromium **151.0.7922.173** and Playwright **1.60.0**. Physical
installed-app startup, iOS browser chrome and hosted-preview pixels are outside
the verified browser scope; the manifest's served values are verified. Exact
head and hosted check links are recorded on the draft PR for independent
review. No merge, production job dispatch, credentials or security changes
are part of this work.
