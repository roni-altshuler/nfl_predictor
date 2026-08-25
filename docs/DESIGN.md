# Gridiron design system

Authored from `src/app/globals.css` — if the two disagree, the CSS wins. The
language is **Bugatti**, shared with the sibling projects (Hardwood/NBA,
Pitchverse/soccer): pure black canvas, hairline borders, colour as meaning.
This file records what the system is and, where it matters, why the
alternative was rejected.

## 1. Surfaces

Pure black `#000000` canvas; cards `#0d0d0d`; hover step `#141414`; hairlines
`#262626`, `#3a3a3a` on hover. `--shadow-*` are all `none` — **no gradients,
no shadows, no glass**, with exactly one recorded exception (§6, the skeleton
shimmer). The soccer sibling shipped an "ambient depth" layer of radial
washes and card gradients in 2026-07 and reverted all of it within a
fortnight; that revert is the precedent here.

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
`BackButton`, `WeekRail` (scroll-spy + unfold-on-jump), `MatchupPicker`.
Everything else is a server component reading published JSON. A component
that computes a probability is a second model nobody benchmarked.

Whole cards and whole rows are links; an anchor never nests inside an
anchor. Team marks sit on a light plate (`--logo-plate`) because NFL marks
are authored for light backgrounds. Every table row hovers to
`--card-hover`; every card hovers to `--border-hover`. Focus is a 2px
`--accent-primary` outline, always visible.
