# Gridiron design system

Authored from `src/app/globals.css` — if the two disagree, the CSS wins. The
language retains Gridiron's slate-green, cream and off-white palette. Following
its owner's October 12 request, the shared page background is flat and static;
decorative canvas layers and their render loops have been removed. Colour
carries meaning only, every probability renders as text, and missing data stays
missing. The validated chart palette is unchanged.

## 1. Surfaces — static slate

Every route uses the flat `#0b120e` body background. Existing card and navigation
colours, cream logo plates (`#f4efe6`) and off-white text remain consistent.
There is no simulated field, ambient hero, particle layer, background gradient,
or animation preference control. Loading shimmer is a foreground status cue,
not a decorative page background. Cards and tables sit over one static colour.

## 2. Colour carries meaning only

Four accents, and anything that is not one of them is grey or a hairline:

| token | hex | meaning |
|---|---|---|
| `--accent-primary` | `#5fa657` | positive / favoured / model |
| `--accent-warn` | `#e8c34a` | uncertainty / backtest / caution |
| `--accent-loss` | `#c8544c` | negative / eliminated / live |
| `--accent-info` | `#c3d9f3` | links, market, informational |

Chart tokens are **validated, not chosen** — see the long comment block in
`globals.css` for the six checks and the failures that produced the current
`--viz-*` values. Tritan separation for the green/blue pair is below the
colour-alone floor, so **direct labels are mandatory on every chart**, not
styling.

Every probability renders as text; colour is always secondary encoding.
Small loss/status/error text uses the existing `--accent-loss-soft` (`#d4655e`)
for readable contrast on static surfaces, including table hover. The base loss
colour remains for semantic graphic/live signals; no chart palette changes.
Absent data renders as absent (`—`), never as zero.

## 3. Type

- Display (`h1`–`h3`): `--font-display` with the shared sans fallback
  (currently Arial/Helvetica), uppercase, **positive** tracking `0.08em`,
  white. The restraint elsewhere reads as deliberate because this is loud.
- Every number: `--font-mono-numeric` (SFMono/Consolas/Liberation Mono)
  with `tabular-nums` (`.numeric`), so columns
  do not jitter as digits change.
- Nav, buttons, captions, table headers: mono, `0.04em` tracking.
- `.eyebrow`: mono, uppercase, `0.14em`, 11px, tertiary — the universal
  section label.

## 4. Copy discipline

The pages lead with data; prose is demoted or exiled.

- A page header is: eyebrow · h1 · one mono provenance line. A lede, when
  one exists at all, is one sentence with a live number in it.
- Footnotes are `text-[10px]`/`[11px]` tertiary, **one or two sentences**.
  The long-form version of any claim lives on `/about`, which is built for
  it (numbered sections, contents rail).
- Honesty labels are a design element: `backtest` in the warn colour,
  `live · published in advance` in the accent, stamped in the top-right of
  any section showing reconstructed numbers. They are never paragraphs.

## 5. Navigation

- The chrome is a fixed sidebar from `md:` and a five-slot bottom tab bar
  below it. No global search — every destination is one tap away.
- "Seasons" in the rail is both a link and a disclosure (chevron unfolds all
  24 seasons, follows the route, closes on Escape) — the NBA sibling's
  pattern.
- **Back means back.** `BackButton` calls `router.back()` once an in-app
  navigation has been recorded (sessionStorage flag set by `AppShell`), and
  renders a canonical-parent link — named, never a bare "Back" — until then,
  so a shared link or a no-JS reader still gets a working destination. Every
  detail page (game, team, archived season) opens with one.
- Long enumerations fold into native `<details>` (the schedule's eighteen
  weeks): one click away and still in the DOM for in-page search. The jump
  rail unfolds a week before scrolling to it.

## 6. Motion

CSS only — the soccer sibling's motion **vocabulary** (its
`cubic-bezier(0.22, 1, 0.36, 1)` curve, its enter-only page rise, its 0.8s
probability settle) without its framer-motion dependency. Three rules:

1. **Motion happens once, on arrival.** Nothing loops except a skeleton and
   a live dot. A page of probabilities that keeps animating looks like it is
   performing rather than reporting.
2. Everything completes in under half a second except a probability bar,
   whose slower settle is what makes the number feel measured.
3. `prefers-reduced-motion` kills all of it, unconditionally.

The pieces: `.page-enter` (route-keyed content rise, replayed by `AppShell`),
`.rise` + `--rise-i` (staggered list entrance, capped at a dozen items),
`.bar-grow`/`.bar-grow-r` (probability fills growing from their own edge),
`.prob-segment` (post-mount width settle, client components only),
`.skeleton-shimmer` (the one gradient in the product — a static grey block
reads as broken rather than loading).

## 6a. Decorative background removal (2026-10-12)

`ChalkboardField`, its dynamic import, resize/visibility listeners, simulated
plays, particles and recurring animation-frame callback are deleted. The
`AmbientToggle`, pre-paint storage script and ambient CSS are deleted too.
Old device values remain stored but are ignored; they cannot reactivate a
background after reload or navigation. Body gradient layers are removed.

Finite foreground page/list/data transitions, chart controls, focus/hover
feedback, loading shimmer and the factual live-score indicator remain. Their
purpose is navigation, reading data or reporting status; none is a decorative
background layer. Normal-motion browser tests inspect mounted DOM, SVG animation
elements, running CSS animations and pending/recurring animation-frame callbacks.

## 7. Loading, empty, missing

- The game page ships a skeleton (`loading.tsx`) because an archived game
  outside the prerendered set fetches its box score at request time. The
  skeleton mirrors the page's real shape.
- The 404 keeps the app chrome and offers the four main destinations — a
  dead link is a detour, not an exit.
- "No line published", "no forecast", "seeds withheld" are rendered facts,
  visually distinct from zero.

## 8. Interaction inventory

Client components, exhaustively: `AppShell` (route tracking, seasons menu),
`BackButton`, `WeekRail` (scroll-spy + unfold-on-jump), `MatchupPicker`
(URL-synced via `?home=&away=`), `SpreadSlider` (a range input over the
published spread rows), `MarginDistribution` (hover/tap/arrow readout),
`FollowButton` + `SlateWithFilter` + `FollowFilter` (the localStorage
watchlist — a device preference, never an account), `LiveBadge` (one shared
browser poller against ESPN's CORS-open scoreboard, gated to the live
window; the site itself stays static and serverless), and
`KickoffCountdown`. Everything else is a server component reading published
JSON. A component that computes a probability is a second model nobody
benchmarked — the live badge shows the score and never restates the model.

Whole cards and whole rows are links; an anchor never nests inside an
anchor. Team marks sit on a light plate (`--logo-plate`) because NFL marks
are authored for light backgrounds. Every table row hovers to
`--card-hover`; every card hovers to `--border-hover`. Focus is a 2px
`--accent-primary` outline, always visible.


## Forecast Lab (2026-09-18)

`/lab` and the homepage spotlight connect the published matchup probabilities,
spread surface and margin lattice. Search, week and following filters, shareable
fixture URLs and a hypothetical record calculator support exploration. The
record calculator changes only wins/losses/ties, never forecast probabilities.
The selected game precedes the fixture picker on narrow screens. New controls
have 44px minimum targets. The original chalkboard and ambient dial were
removed on October 12; Forecast Lab data and controls remain.

Font variables now use native sans/monospace stacks, preserving tabular figures
without a Google Fonts request at build time. The mobile bar includes Lab;
season archives remain available from Schedule and the desktop rail.

The October 12 homepage leads with the published slate. Its briefing and
compact Lab share a native disclosure below the games; publication, results
cutoff and stale-source notices stay outside that disclosure. The withholding
notice explicitly names Forecast Lab, whose parser supplies that count; it
does not label raw slate, Following or quick-pick rows as validated.
Game cards and the dedicated Lab remain the existing components.

The October 17 fan-facing homepage adds Games, Teams and matchup-scoped Players
entry points. Its slate cards label win chances and projected points in plain
language; full model and market numbers remain on each game page. Team discovery
comes before optional week tools, ratings and the record. Source dates and model
version open in a native disclosure; stale and withholding notices stay visible.

Upcoming games lead with the teams, a compact section rail, win chances and
projected points. A short optional explanation distinguishes average points from
an exact score and keeps uncertainty explicit. Players and game context precede
the existing close-game explorer. Distribution, spread and market detail open
under “Prediction details & model numbers”. Section links reveal that disclosure
before scrolling/focusing, including shared hashes, without adding Back steps.
All new controls retain 44px targets and the existing focus outline. Data,
probabilities, model inputs, provider coverage and branding are unchanged.


## January effect and weekly briefing (2026-09-18)

The homepage briefing surfaces three concrete entry points: next kickoff, closest
model matchup and largest simulated playoff swing. Cards use the same team marks,
slate surfaces and directly labelled numbers as the rest of the site.

The Lab's January effect reads published conditional season simulations. A green
bar shows the selected outcome's playoff chance; a white marker identifies the
simulation baseline. Numeric probabilities and percentage-point changes appear
beside every bar. Result controls are 44px native buttons; insufficient samples
are visibly withheld. Technical interpretation lives in a native disclosure.
The simple record-only calculator is now a secondary disclosure.

## Published week and remote marks (2026-10-06)

The week browser keeps publication and results-cutoff timestamps together above
its controls. On phones, week and team share one row; team options lead with the
abbreviation so a narrow native select can still distinguish the two Los Angeles
or New York clubs. Full team names remain on the matchup cards and options.

Shared team marks now use a warm off-white plate (`--logo-plate: #f4efe6`) with
dark abbreviation ink. The text is present while an image loads or fails; a
failed image is removed. Successful cached images are recognized at hydration,
and a changed team starts with fresh loading state. The wrapper keeps its team
name as an accessible image label. The green board, reduced-motion behavior,
probabilities and navigation hierarchy remain the existing product identity.

The accuracy page's research ledger keeps exploratory experiments separate from
live and production backtest results. Higher winner accuracy alone is not a claim
of improved probabilities. First-load motion still respects reduced motion.

## Match-scoped player profiles (2026-10-06)

Player names remain visible in leader/report links and the matchup's player
cards. Provider-qualified athlete IDs identify profiles; names never become
route identities. The profile pairs a neutral off-white initials/number plate
with the existing green board and readable data cards. Selected game statistics,
team context and dated availability reports are separate sections; absent
statistics or reports stay unknown. A source/coverage card distinguishes the
summary update from individual report dates and avoids full-roster or career
claims. Team pages open player reports through a published matchup.

Portrait contracts record provider, subject, provenance, permission evidence
and verification. A supplied provider URL grants no display permission. Only
a previously permitted, verified local athlete asset with a matching subject
can render. No such assets are shipped; names, initials and shirt numbers carry
identity without portrait requests. Profile Back follows the originating
matchup/history; a fresh tab retains a named matchup parent. Loading skeletons
and explicit unavailable states keep the app's navigation available.

## Game leader comparison (2026-10-07)

Existing matchup pages pair away/home category leaders in two bordered columns,
including on phones. A native 44px category selector updates the shareable
`?compare=` URL without a summary refetch or another Back step. Team marks,
provider-ID profile links, permitted portrait policy and neutral identity plates
reuse the existing components. Reported positions and raw lines carry the
comparison, with the unverified statistic period explicitly labelled; no
scouting grade, inferred starter, career total or second model
is introduced. Day-only archives label kickoff unavailable; source update and
cache coverage stay visible beside the game date.

The game section navigation opens the comparison with keyboard focus. Existing
horizontal score/statistic/spread tables also have named focusable scroll regions.
Empty, source-error and ambiguous/unknown states retain useful navigation and
explicit missing-data copy.

## Close-game paths (2026-10-08)

Published matchup pages and the expanded Forecast Lab reuse the Chalkboard
cards, direct numeric labels and away/home colors for narrow and wider wins.
A native 44px select offers margins of 1–3, 1–7 and 1–8 points. Numeric labels
carry every probability; the two small bars are decorative. Ties remain a
separate outcome. Keyboard section navigation focuses the card, then the select.
The `marginBand` query uses history replacement so adjustments add no Back
steps, preserve other query parameters and require no provider/model request.

Narrow wins sum published score-margin cells with their home/away orientation.
Wider wins subtract those cells from the existing headline win probability.
No tail shape or player contribution is inferred. Inconsistent or unsupported
source coverage shows an explicit unavailable state. Forecast publication,
results cutoff and model version accompany the summary; its evidence link
opens the existing first-published record. The linked historical score table
has a named, focusable scroll region on small screens.

## Cross-page appearance and preferences

The homepage and inner routes share one root palette, flat body background,
typography, shell and card surfaces. NFL remains dark-only under both light and
dark system preferences; this removal does not introduce a theme provider.
Cream logo plates and the leather football mark remain. Manifest colours and
viewport metadata still match `#0b120e`.

The October 8 animation-preference implementation is superseded by the October
12 removal. No root script reads or announces an ambient setting. The browser
journey now verifies static backgrounds before and after hydration, even with
legacy `soft`, `vivid`, `off` or unsupported values, and checks normal-motion
navigation, reload, Back/Forward, empty/source-error states, teams and brackets.
