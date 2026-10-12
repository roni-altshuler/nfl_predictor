# Homepage slate first — October 12, 2026

The homepage's first matchup was below three briefing cards and a full compact
Forecast Lab. On the reviewed Monday, all three briefing cards pointed to the
same BUF–LAR matchup. This change leads with the existing published slate and
keeps the briefing and Lab in one closed native disclosure below it. The full
Lab remains one tap away through the existing navigation. No games are truncated.

Game cards, probabilities, projected scores, market fields, live-score support,
team marks, filters and one-tap matchup destinations are reused unchanged.
Team pages, schedule routing, matchup return behavior, palette, static background
and the accessible small-red-text token remain unchanged. This is one homepage
hierarchy change, not a live-score feed or model-quality improvement.

Publication context stays outside the disclosure: exact forecast publication,
results cutoff and pre-game coverage. The existing 48-hour stale rule is mirrored
above the slate and updates after hydration, so cached HTML cannot hide an aged
source. The Lab's invalid/duplicate withholding notice also remains above the
games, explicitly scoped to **Forecast Lab**. It does not claim that slate
cards, Following or quick picks have passed the Lab validator; those existing
views still use the original published snapshot.
Missing results timestamps explicitly render unavailable.

## Actual before/after pixels

The baseline is main `a564f1cf545841b5cc9fa2ea25804c70d35ac9fb`; there were no
open NFL PRs at inspection. Both captures use production Chromium, the actual
October 12 browser clock, the same committed data, normal motion and controlled
provider/CDN outages. No synthetic score or current player status is shown.

| Width | First card before | First card after |
| --- | ---: | ---: |
| 320px | 2209.5px | 369.5px |
| 390px | 2078.5px | 369.5px |
| 768px | 1860.5px | 269.5px |
| 1440px | 1236px | 253.5px |

The first card's exact text, probabilities and href match before/after at all
four widths. See [geometry](home-slate-2026-10-12/geometry.json),
[phone before](home-slate-2026-10-12/home-before-390.png) /
[after](home-slate-2026-10-12/home-after-390.png), and
[desktop before](home-slate-2026-10-12/home-before-1440.png) /
[after](home-slate-2026-10-12/home-after-1440.png).
The optional tools remain accessible in their
[closed](home-slate-2026-10-12/tools-closed-390.png) and
[expanded](home-slate-2026-10-12/tools-expanded-390.png) states.

The [focused browser audit](home-slate-2026-10-12/home-checks.json) exercises
closed and expanded states at 320/390/768/1440px under light and dark system
preferences, with normal motion and strict unfiltered zero-Axe gates. Each
case opens a matchup with the keyboard and returns twice, opens/closes the
native disclosure, verifies focus and target size, and reloads with the slate
first. Explicit 47/49-hour probes check the stale boundary with tools closed.
[Stale source](home-slate-2026-10-12/home-stale-390.png) and
[empty following](home-slate-2026-10-12/home-following-empty-390.png) retain
publication context and recovery. A held matchup RSC request is interrupted
by Schedule; a late response does not replace it, and retry succeeds. In the
local held-request probe, the previous slate remained visible rather than a
game skeleton; no loading-indicator claim is made for that case. The existing
full audits separately exercise loading, refresh errors and unavailable data.

## Source and execution limits

The [malformed-artifact regression](home-slate-2026-10-12/notice-scope-checks.json)
uses a local-only in-memory fixture with one valid row, an invalid probability
triple and a duplicate valid ID. The actual homepage retains three raw slate
cards and three quick picks; the Lab explorer shows one row and the visible
notice says “Forecast Lab: 2 invalid or duplicate forecasts withheld.”
Keyboard disclosure and strict zero-Axe checks pass at 320/390/1440px.
See the explicitly synthetic [phone](home-slate-2026-10-12/notice-scope-fixture-390.png)
and [desktop](home-slate-2026-10-12/notice-scope-fixture-1440.png) captures.
The committed contract test renders the real context component after the real
parser excludes those two rows, and verifies the raw fixture is unchanged.
Current committed data validates with zero withheld rows; this is no live
incident claim or change to shared homepage validation. The fixture and its
preloader stay outside the repository, and the ordinary QA build is restored.

The retained forecast is **2026-10-11T16:35:55+00:00**, using results through
**2026-10-09T00:15:00+00:00**. Its data hash is unchanged. UI review does not
refresh those dates, fetch outcomes, train a model or evaluate accuracy.
Local builds use the existing captured ESPN subset and synthetic archive/error
fixtures; other provider calls return controlled 503s and browser HTTPS calls
are blocked. This verifies browsing and coverage labels, not live provider health.

The disclosure changes visible hierarchy, not bundle size or background work;
existing client components still hydrate. NFL keeps its intentional dark-only
palette under both system preferences. No ambient animation is reintroduced.

Verification and preservation receipts are in
[validation](home-slate-2026-10-12/validation.json). Full logs and additional
screenshots remain in `/workspace/nfl-home-slate-review-2026-10-12/` in the saved
cloud environment. Hosted pixels and deployment alias-to-SHA mapping remain
unverified because of the previously observed proxy/scope 403 limits.

```bash
npm run lint
npm test
npm run typecheck
./.venv/bin/python -m pytest backend/tests/ -q
NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS='--require ./scripts/player_browser_fixture.cjs' \
  PLAYER_AUDIT_COMPARE_STATES=1 npm run build
NODE_OPTIONS='--require ./scripts/player_browser_fixture.cjs' PLAYER_AUDIT_COMPARE_STATES=1 \
  PLAYER_AUDIT_SLOW_EVENT=401127974 npm start -- --hostname 127.0.0.1 --port 3036
# In another terminal:
BASE_URL=http://127.0.0.1:3036 BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
  AUDIT_USE_PUBLICATION_TIME=1 PLAYER_AUDIT_EXPECT_FIXTURE=1 npm run test:browser
```

The draft is for independent review. No merge or manual forecast/model/provider
workflow dispatch is included.
