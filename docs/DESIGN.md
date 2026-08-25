# Gridiron design system

Authored from `src/app/globals.css` — if the two disagree, the CSS wins. The
language is **Chalkboard** (v2, 2026-08-25): the whole site is a coach's
board, at the owner's explicit request, and a deliberate divergence from the
flat-black "Bugatti" language the sibling projects (Hardwood/NBA,
Pitchverse/soccer) keep. What survives from Bugatti on purpose: colour
carries MEANING only, every probability renders as text, absent data renders
as absent, and the chart palette is unchanged because it was validated, not
chosen. This file records what the system is and, where it matters, why.

## 1. Surfaces — the board

Blackboard slate `#0b120e` canvas, lit from above by two body gradients (the
theme's depth). The full-viewport field — sidelines, yard lines, hash marks,
numerals — is drawn by `ChalkboardField` at z-index −1 and **spans the
entire page**: every surface above it is TRANSLUCENT by token
(`--card-bg: rgba(13,22,17,0.72)`) so the field reads through the cards
rather than being walled off by them. Hairlines are chalk
(`rgba(255,255,255,0.14)`, `0.28` on hover); chrome (`--nav-bg`) is
translucent + backdrop-blur.

**The legibility contract replaces the old flat rule**: a field line at
0.16 alpha arrives under a table at ~0.04 through the 0.72 card — present,
never competing with ink. Raise the card transparency or the field alphas
together and this breaks; they are one budget. The soccer sibling's 2026-07
ambient revert happened because atmosphere sat OVER data at full strength —
this system inverts that: the atmosphere is total, and the data surfaces
are the shield.

## 2. Colour carries meaning only

Four accents, and anything that is not one of them is grey or a hairline:

| token | hex | meaning |
|---|---|---|
| `--accent-primary` | `#5fa657` | positive / favoured / model |
| `--accent-warn` | `#d4a017` | uncertainty / backtest / caution |
| `--accent-loss` | `#c1443c` | negative / eliminated / live |
| `--accent-info` | `#c3d9f3` | links, market, informational |

Chart tokens are **validated, not chosen** — see the long comment block in
`globals.css` for the six checks and the failures that produced the current
`--viz-*` values. Tritan separation for the green/blue pair is below the
colour-alone floor, so **direct labels are mandatory on every chart**, not
styling.

Every probability renders as text; colour is always secondary encoding.
Absent data renders as absent (`—`), never as zero.

## 3. Type

- Display (`h1`–`h3`): Inter, uppercase, **positive** tracking `0.08em`,
  white. The restraint elsewhere reads as deliberate because this is loud.
- Every number: JetBrains Mono with `tabular-nums` (`.numeric`), so columns
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

## 6a. The field

`ChalkboardField` draws the whole field: sidelines at the viewport edges,
hand-ruled yard lines, hash rows, big chalk numerals (10…50…10) hugging
both sidelines, and — every several seconds — one chalk play: O's and X's
fade in, a single route draws itself in `--accent-primary`, holds, fades.
Rules:

- Field alphas live in one budget with card transparency (§1). Current
  values: sidelines 0.20, lines 0.16, hashes 0.10, numerals 0.14, play
  marks 0.36, route 0.50. Change them only together with `--card-bg`.
- One play at a time, then rest. `requestAnimationFrame` runs only while a
  play is animating; a hidden tab stops it; reduced motion gets a single
  static frame with a finished play.
- The shell wrapper deliberately paints **no** background — the body's
  slate (and its two light gradients) is what the field draws on.
  Reintroducing an opaque wrapper silently deletes the field, and an opaque
  card token walls it out of the content column.
- Canvas font strings cannot resolve CSS variables — the numerals use a
  plain monospace stack, and an invalid font declaration is silently
  ignored wholesale.

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
`BackButton`, `WeekRail` (scroll-spy + unfold-on-jump), `MatchupPicker`,
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
