# Next 15 maintenance · October 10, 2026

Next.js and `eslint-config-next` are pinned from **15.5.24 to 15.5.27**.
The [official September security release](https://nextjs.org/blog/september-2026-security-release)
and [published upstream tag](https://github.com/vercel/next.js/releases/tag/v15.5.27)
identify this patched maintenance release. npm confirms compatible Node,
React 18 and ESLint 8 peer ranges. The lock changes twelve Next-family package
versions; no other locked package version changes.

The branch starts from main `22f86a32d4ae62d12259da6bcf9cadb7e0919dc6`,
including the merged first/latest comparison and October 9 automated artifacts.
This maintenance patch changes dependencies and review documentation only.
Application routes, probabilities, data, model, baselines and workflows are
unchanged. Existing recovery branches and the separate unpublished QA worktree
are retained. No workflow was manually dispatched or PR merged.

## Advisory scope and audit

The reviewed advisory ranges include 15.5.24 and exclude 15.5.27:

| Advisory | Affected Next 15 versions | Documented route/deployment condition |
| --- | --- | --- |
| [GHSA-mcj8-r9mp-w47p](https://github.com/advisories/GHSA-mcj8-r9mp-w47p) | `>=15.0.0 <15.5.27` | Root catch-all page with SSG/ISR sharing the response cache |
| [GHSA-4jqv-mc3x-m676](https://github.com/advisories/GHSA-4jqv-mc3x-m676) | `>=15.0.0 <15.5.27` | Self-hosted Pages Router with SSG/ISR; the advisory excludes Vercel deployments |

This repository uses the App Router and has no root catch-all page. Neither
documented route condition is present in the inspected checkout. Package
maintenance does not establish that the deployed application was exposed.

`npm audit --json` was captured before and after installing the exact pins.
Both named advisory entries disappear. The registry still flags Next via its
nested PostCSS 8.4.31 dependency, along with existing parser/glob/CSS tooling.
No override, blanket audit fix, downgrade or major framework update was applied.

| Snapshot | Critical | High | Moderate | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before | 0 | 11 | 3 | 0 | 14 |
| After | 0 | 11 | 3 | 0 | 14 |

These counts aggregate affected packages, not unique advisories. A package can
stay counted after its direct advisory disappears. Complete
[before](next-maintenance-2026-10-10/audit-before.json) and
[after](next-maintenance-2026-10-10/audit-after.json) snapshots, hashes,
remaining packages and version changes are in the
[dependency audit](next-maintenance-2026-10-10/dependency-audit.json).
This is a registry snapshot, not a compromise assessment or a clean-audit claim.

The [October 8 notice](https://nextjs.org/blog/upcoming-nextjs-security-update-october-2026)
announces another security release for October 14. Its affected versions and
upgrade instructions were unpublished on this review date. This patch makes
no claim to cover that future release; it remains a follow-up when details
are published.

## Validation and responsive product review

Local validation uses Node 24.19.0 and npm 11.9.0; CI uses its existing Node 20.
Clean `npm ci --ignore-scripts --no-audit --no-fund`, lint with zero warnings,
23 Node contract tests plus the week contract assertions, TypeScript and all
146 backend tests pass. The Next 15.5.27 production build generates 305 pages.

The committed comparison independently passes its existing row/cohort audit
without SQLite. This verifies the first-log hash, rows and scores, but does
not reselect latest forecasts from the full warehouse. No warehouse was
downloaded or new results collected for this maintenance patch.

Production Chromium 151 checks `/accuracy#forecast-comparison` at 320, 390,
768 and 1440 pixels. The published-state audit verifies rendered scores,
cohort horizons and source links against the artifact; keyboard disclosure
and table access; matchup → published record → comparison → Back → Forward
→ reload; retained board preference; zero document overflow, axe violations,
page errors or portrait requests. Table overflow stays inside its labelled
scroll region. Compact mobile and expanded desktop screenshots were inspected.

See the [comparison browser checks](next-maintenance-2026-10-10/comparison-checks.json)
and screenshots at [320](next-maintenance-2026-10-10/comparison-mobile-320.png),
[390](next-maintenance-2026-10-10/comparison-mobile-390.png),
[768](next-maintenance-2026-10-10/comparison-tablet-768.png) and
[1440](next-maintenance-2026-10-10/comparison-desktop-1440.png) pixels.

All seven existing browser scripts pass: forecast comparison, theme journey,
close-game paths, leader comparison, Forecast Lab, week browsing and profiles.
Week selection, keyboard matchup return, header-logo outage, empty filters,
source outage and ambiguous/missing leader recovery are covered. Theme checks
include five neutral preference-control states before hydration. The profile
audit reports `loadingObserved: false` for this retained slate; that optional
loading case is not claimed as exercised. See the
[validation summary](next-maintenance-2026-10-10/validation.json) and each
suite's linked check report for actual coverage.

## Sources and reproduction

The browser reads the committed October 9 artifacts, rather than new provider
data. The forecast publication is **2026-10-09T17:23:18Z**, with results used
through **2026-10-09T00:15:00Z**. The comparison is generated at
**2026-10-09T17:23:30Z** from 14,291 retained snapshots, whose newest timestamp
is **2026-10-09T17:23:18Z**. Result fetches extend through
**2026-10-09T17:22:09Z**; there are 65 paired decided games. Rechecking on
October 10 does not make those sources current to October 10. Artifact hashes
are recorded in the dependency audit, and the patch leaves their bytes intact.

Local browser QA blocks ESPN client image requests and uses the existing
recorded summary subset plus explicitly synthetic archive/error fixtures;
other ESPN server responses are controlled 503s. This verifies layout,
fallbacks and navigation, rather than live provider availability or new source
freshness. The original Chalkboard palette, cream team-mark plates and visible
identity fallbacks remain in place. No new model-performance claim is made.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm audit --json
npm run lint
npm test
npm run typecheck
./.venv/bin/python -m pytest backend/tests/ -q
./.venv/bin/python -m backend.scripts.verify_forecast_comparison
NEXT_TELEMETRY_DISABLED=1 \
  NODE_OPTIONS='--require ./scripts/player_browser_fixture.cjs' \
  PLAYER_AUDIT_COMPARE_STATES=1 npm run build
NODE_OPTIONS='--require ./scripts/player_browser_fixture.cjs' \
  PLAYER_AUDIT_COMPARE_STATES=1 PLAYER_AUDIT_SLOW_EVENT=401127974 \
  npm start -- --hostname 127.0.0.1 --port 3026
# In another terminal; use Playwright's installed Chromium if preferred.
BASE_URL=http://127.0.0.1:3026 BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
  PLAYER_AUDIT_EXPECT_FIXTURE=1 npm run test:browser
```

Audit returns nonzero while remaining findings exist. Browser QA uses the
current local clock; CI's existing browser job uses the publication clock.
Raw local logs and all screenshots are retained in
`/workspace/nfl-next-maintenance-2026-10-10/` in the saved cloud environment.
Local browser evidence does not verify hosted preview pixels or live health.
