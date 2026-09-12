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
theme's depth). The field — a complete, bounded design with both end
zones — is drawn by `ChalkboardField` at z-index −1, **centred in the
content area and always seen whole** (§6a): every surface above it is
TRANSLUCENT by token (`--card-bg: rgba(13,22,17,0.80)`, 0.72 until
2026-09-12) so the field reads through the cards rather than being walled
off by them. Hairlines are chalk
(`rgba(255,255,255,0.14)`, `0.28` on hover); chrome (`--nav-bg`) is
translucent + backdrop-blur.

**The legibility contract replaces the old flat rule**: a field line at
0.12 alpha arrives under a table at ~0.02 through the 0.80 card (and at
~0.013 under the default `soft` dial) — present, never competing with ink. Raise the card transparency or the field alphas
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

## 6a. The field, and the game played on it

`ChalkboardField` draws a TRUE field as a **centred, complete design**: a
full boundary with both end zones always on screen, goal lines, hatched
end zones with the brand in faint chalk, goalposts, hand-ruled lines every
five yards (the fives lighter), numerals cycling to the 50 at the tens,
and interior hash columns ticked at every yard. The field is centred in
the CONTENT area — the sidebar is measured at layout and excluded, so its
rect goes to zero on the mobile layout — and its width is proportioned
against its length (≤0.62, clamped), so on every device it reads as a
football field seen whole, never an abstract board cropped by the
viewport. Yardage is real — yard 0 is the bottom goal line, 100 the top —
so everything the game does is legible.

On it, an endless **simulated game** (v3): the O team in white chalk
against the X team in blue chalk (`--accent-info`), whoever holds the ball
lining up on offense. Snaps resolve from a plausible football
distribution — runs through a gap, passes with the route drawn in
`--accent-primary`, sacks, incompletions, interceptions returned the other
way — the white scrimmage line and the TV-convention **yellow line to
gain** (`--accent-warn`, hidden on goal-to-go) glide with every result, the
down is chalked in the margin (`3RD & 4`), fourth downs punt or kick at
the posts, and a drive that reaches the paint gets TOUCHDOWN scrawled
across the end zone before possession flips. The ball is a small yellow
ellipse; flights (throws, punts, kicks) trail dashes.

**The camera is contained, by rule (v3.2).** This layer sits behind data
the reader came for, so the v3.1 broadcast push-in was capped: the camera
may lean toward the play only as far as keeps the ENTIRE field — both end
zones — inside the frame (`maxZoom`, capped at 1.03 since 2026-09-12; ~1.08
before), and it never pans sideways
(`pinnedX` keeps the field at the same screen position at any zoom, so
the centred design stays put and only a gentle vertical lean moves). The
result is a slow breath toward the action, never a cut; the resting state
between plays is always the full centred field; and the huddles are
deliberately long — the board rests more than it moves, or it competes
with the data. Camera shake was removed for the same reason; the chalk
impact burst at a tackle stays, because it is local to the play. The
field renders as vectors *through* the camera transform each frame so
chalk stays crisp — which is why all hand-ruled wobble comes from a
deterministic noise hash, never `Math.random` at draw time (random wobble
re-rolled per frame makes the whole board shimmer). Close-up polish:
ghost marks trail a carried ball, the ball has a lace, and the O's are
drawn as not-quite-closed hand circles.

Rules:

- **No score is ever kept and no team is ever named.** A fake score in the
  background of a forecasting site would read as a real one. The game is
  atmosphere with football's grammar — never data.
- Field alphas live in one budget with card transparency (§1). Current
  (`vivid`) values: sidelines 0.15, lines 0.12, goal lines 0.18, hashes
  0.08, numerals 0.10, end-zone hatch 0.04 / text 0.06, posts 0.12, player
  marks 0.24, route 0.32, scrimmage 0.18, first-down line 0.22, ball 0.45,
  down text 0.16, celebration 0.26; tackle burst 0.30 over 240ms. The
  default `soft` dial multiplies the whole canvas by 0.55 and blurs it
  0.6px on top. Pacing: huddle 2.4–5.4s, whistle 0.7s, celebration 1.5s.
  Change the alphas only together with `--card-bg`.
  (v2, 2026-08-25 → 2026-09-12: sidelines 0.20, lines 0.16, goal 0.24,
  hashes 0.10, numerals 0.14, hatch 0.05 / text 0.08, posts 0.16, marks
  0.36, route 0.50, scrimmage 0.26, first-down 0.32, ball 0.70, down text
  0.24, celebration 0.42; huddle 1.6–3.6s, celebration 2.1s.)
- The game is the sanctioned exception to §6's "nothing loops" rule, and
  it earns it by pacing: one snap at a time (~2–3s), then a huddle. The
  rAF loop skips drawing entirely while the board is static between
  plays; a hidden tab stops it; a resize resets the play in progress
  rather than animating against a stale field; reduced motion gets one
  static frame — field, formation, a finished route — and never moves.
- The shell wrapper deliberately paints **no** background — the body's
  slate (and its two light gradients) is what the field draws on.
  Reintroducing an opaque wrapper silently deletes the field, and an opaque
  card token walls it out of the content column.
- Canvas font strings cannot resolve CSS variables — the numerals use a
  plain monospace stack, and an invalid font declaration is silently
  ignored wholesale. Team colours are read from the live tokens once at
  init, so the palette still cascades.

**2026-09-12 — the quiet board.** The owner's read was that the field had
become "a little too sharp" and was pulling focus from the numbers. Three
things changed, all recorded above. (1) The reader now holds the dial:
`AmbientToggle` ("Board · soft / vivid / off") in the sidebar footer and
the mobile header writes `gridiron-ambient` to localStorage, stamps
`data-ambient` on `<html>` and fires `ambientchange`; the root layout runs
a ~180-byte inline script before first paint so the choice never flashes;
globals.css dims the canvas to 0.55 opacity + 0.6px blur under `soft`
(the default) and removes it under `off`, where the canvas also stops its
rAF loop. (2) Even `vivid` is calmer: field lines ×0.75, moving marks
×0.6–0.7, zoom cap 1.09 → 1.03, camera lean halved, huddles 1.5× longer,
whistle and celebration shorter, burst quieter. (3) The surfaces shield
more: cards 0.72 → 0.80, the body's two gradients −30% (0.07 → 0.05,
0.55 → 0.38), the display text-shadow halved. Reduced motion is unchanged.
The same day the pages lost prose and gained play: title odds and ratings
as bar lists, a 32-mark team explorer, quick-pick chips and `/predict`
deep links (`?home=&away=`), a spread slider over the published surface
with the table folded into `<details>`, and a hover/tap/arrow-key readout
on the margin lattice. Nothing computes a probability; the slider and the
readout are lookups and sums over published cells.

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
`AmbientToggle` (the board dial — a device preference, like the watchlist),
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
