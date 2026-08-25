'use client'

import { useEffect, useRef } from 'react'

/**
 * The chalkboard: Gridiron's ambient identity layer — a whole simulated
 * game played in chalk on a properly bounded field.
 *
 * The fixed canvas at z-index -1 draws a TRUE field as a centred design:
 * a full boundary with BOTH end zones always on screen, goal lines,
 * goalposts, lines every five yards, numerals cycling to the 50, interior
 * hash columns. It is centred in the CONTENT area — the sidebar is
 * measured and excluded — and its width is proportioned against its
 * length, so on every device it reads as a football field seen whole,
 * never as an abstract board cropped by the viewport.
 *
 * On it, two chalk teams play an endless scrimmage: the O team (white
 * chalk) against the X team (blue chalk). Plays snap — runs through a
 * gap, passes with the route drawn in the model's green, sacks,
 * incompletions, interceptions — the yellow first-down line and the
 * scrimmage line slide with every result, downs count up in a chalk note
 * in the margin, fourth downs punt or kick, and a drive that reaches the
 * paint gets TOUCHDOWN scrawled across the end zone.
 *
 * **The camera is contained, by rule.** This layer sits behind data the
 * reader came for, so the broadcast push-in of v3.1 is capped: the camera
 * may lean toward the play only as far as keeps the ENTIRE field — both
 * end zones — inside the frame (`maxZoom`, ~1.08). The result is a slow
 * breath toward the action rather than a cut, and the resting state
 * between plays is always the full centred field. Camera shake was
 * removed for the same reason; the chalk impact burst at a tackle stays,
 * because it is local to the play. The field renders as vectors through
 * the camera transform so chalk stays crisp; all hand-ruled wobble comes
 * from a deterministic noise hash, never Math.random at draw time, or the
 * board would shimmer.
 *
 * **Nothing here is data.** No score is kept and no team is named — the
 * teams are chalk marks, deliberately, because a fake score in the
 * background of a forecasting site would read as a real one.
 *
 * Lifecycle discipline ported from the personal site's ParticleField:
 * devicePixelRatio capped at 2; the rAF loop skips drawing entirely while
 * the game is between plays and neither the camera nor the markers are
 * moving; the loop pauses on a hidden tab; ResizeObserver relayouts (and
 * resets the play in progress rather than animating against a stale
 * field); and under prefers-reduced-motion the board draws one static
 * frame — the field, a formation, a finished route — and never moves.
 */

const DPR_CAP = 2

/* Chalkboard v2 budget (DESIGN.md §6a): surfaces above this canvas are
   translucent by token, so these alphas are what a reader sees in the open
   and roughly a quarter of it through a card. Change them only together
   with --card-bg. */
const SIDELINE_ALPHA = 0.2
const GRID_ALPHA = 0.16
const HASH_ALPHA = 0.1
const NUMERAL_ALPHA = 0.14
const GOAL_ALPHA = 0.24
const ENDZONE_HATCH_ALPHA = 0.05
const ENDZONE_TEXT_ALPHA = 0.08
const POST_ALPHA = 0.16
const MARK_ALPHA = 0.36
const ROUTE_ALPHA = 0.5
const SCRIMMAGE_ALPHA = 0.26
const FIRST_DOWN_ALPHA = 0.32
const BALL_ALPHA = 0.7
const DOWN_TEXT_ALPHA = 0.24
const CELEBRATE_ALPHA = 0.42

// Pacing, ms. One snap runs ~2-3s; the huddles are deliberately long —
// the board should rest more than it moves, or it competes with the data.
const LINEUP = 900
const SET = 420
const WHISTLE = 850
const FADE = 600
const HUDDLE_MIN = 1600
const HUDDLE_RANGE = 2000
const CELEBRATE = 2100

type Phase = 'lineup' | 'set' | 'live' | 'whistle' | 'celebrate' | 'fade' | 'huddle'
type Team = 'o' | 'x'

interface Point {
  x: number
  y: number
}

/** One chalk mark's movement: spawn → formation spot, then a play path. */
interface Walk {
  kind: Team
  spawn: Point
  path: Point[]
  t0: number
  t1: number
  /** Ball carriers and route runners move at constant speed; idle drift eases. */
  linear?: boolean
}

/** One leg of the ball's journey. `via` bends a flight; `flight` gets a dashed trail. */
interface BallLeg {
  path: Point[]
  via?: Point
  t0: number
  t1: number
  flight?: boolean
  /** A carried leg — someone is running with it, and it leaves ghost marks. */
  carry?: boolean
}

type Result =
  | { type: 'gain'; mode: 'run' | 'pass' | 'sack'; yards: number }
  | { type: 'incomplete' }
  | { type: 'interception'; spotYard: number }
  | { type: 'punt'; spotYard: number }
  | { type: 'fg'; good: boolean }

/** Yard 0 is the bottom goal line. The O team attacks upward, toward 100. */
interface Game {
  possession: Team
  ballYard: number
  down: number
  firstDownYard: number
  formationX: number
}

interface Snap {
  actors: Walk[]
  ball: BallLeg[]
  route?: Point[]
  routeLength?: number
  routeT0?: number
  routeT1?: number
  dur: number
  result: Result
  /** Where the play lines up, for the camera. */
  focus: Point
  /** The play's own attack direction in px, frozen at the snap. */
  fw: number
  /** Covered from the fixed wide angle instead of the gentle lean. */
  wide: boolean
}

interface Geometry {
  w: number
  h: number
  /** The field boundary: outer end lines and sidelines, all on screen. */
  oTop: number
  oBottom: number
  fx0: number
  fx1: number
  /** Goal lines. */
  top: number
  bottom: number
  ez: number
  ppy: number // px per yard
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Deterministic hand-wobble: stable per coordinate, so the board never shimmers. */
function noise(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function yardToY(geom: Geometry, yard: number): number {
  return geom.bottom - (yard / 100) * (geom.bottom - geom.top)
}

function polylineLength(path: Point[]): number {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
  }
  return total
}

/** The point a fraction `f` of the way along a polyline, by arc length. */
function pointAlong(path: Point[], f: number): Point {
  if (path.length < 2) return path[0]
  const total = polylineLength(path)
  if (total === 0) return path[0]
  let target = clamp(f, 0, 1) * total
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
    if (target <= seg || i === path.length - 1) {
      const u = seg === 0 ? 0 : clamp(target / seg, 0, 1)
      return {
        x: path[i - 1].x + (path[i].x - path[i - 1].x) * u,
        y: path[i - 1].y + (path[i].y - path[i - 1].y) * u,
      }
    }
    target -= seg
  }
  return path[path.length - 1]
}

function walkPos(walk: Walk, p: number): Point {
  const u = clamp((p - walk.t0) / (walk.t1 - walk.t0), 0, 1)
  return pointAlong(walk.path, walk.linear ? u : easeInOut(u))
}

function legPos(leg: BallLeg, u: number): Point {
  const e = leg.flight ? 1 - (1 - u) * (1 - u) : u
  if (leg.via && leg.path.length === 2) {
    const [a, b] = leg.path
    const t = e
    const mt = 1 - t
    return {
      x: mt * mt * a.x + 2 * mt * t * leg.via.x + t * t * b.x,
      y: mt * mt * a.y + 2 * mt * t * leg.via.y + t * t * b.y,
    }
  }
  return pointAlong(leg.path, e)
}

/** Where the ball is at play-progress `p`, and the leg it is on (for the trail). */
function ballAt(legs: BallLeg[], p: number): { pos: Point; leg: BallLeg | null } {
  if (!legs.length) return { pos: { x: 0, y: 0 }, leg: null }
  if (p <= legs[0].t0) return { pos: legs[0].path[0], leg: null }
  for (const leg of legs) {
    if (p <= leg.t1) {
      if (p < leg.t0) return { pos: leg.path[0], leg: null } // between legs
      return { pos: legPos(leg, (p - leg.t0) / (leg.t1 - leg.t0)), leg }
    }
  }
  const last = legs[legs.length - 1]
  return { pos: last.path[last.path.length - 1], leg: null }
}

// ---------------------------------------------------------------------------
// The game itself: downs, drives, and what each snap resolves to.
// ---------------------------------------------------------------------------

const own25 = (team: Team) => (team === 'o' ? 25 : 75)
const other = (team: Team) => (team === 'o' ? 'x' : 'o')
const attackOf = (team: Team, yard: number) => (team === 'o' ? yard : 100 - yard)

function newDrive(team: Team, ballYard: number, geom: Geometry): Game {
  const yard = clamp(Math.round(ballYard), 2, 98)
  const first = team === 'o' ? Math.min(yard + 10, 100) : Math.max(yard - 10, 0)
  const width = geom.fx1 - geom.fx0
  const lo = geom.fx0 + 95
  const hi = geom.fx1 - 95
  return {
    possession: team,
    ballYard: yard,
    down: 1,
    firstDownYard: first,
    formationX:
      lo <= hi
        ? clamp(rand(geom.fx0 + width * 0.3, geom.fx0 + width * 0.7), lo, hi)
        : (geom.fx0 + geom.fx1) / 2,
  }
}

/** The play call and its outcome, sampled from a plausible football shape. */
function callPlay(game: Game): Result {
  const dir = game.possession === 'o' ? 1 : -1
  const attack = attackOf(game.possession, game.ballYard)
  const yardsToGoal = 100 - attack
  const distance = Math.abs(game.firstDownYard - game.ballYard)

  if (game.down === 4 && distance > 2 && yardsToGoal > 6) {
    if (yardsToGoal <= 33) {
      const p = yardsToGoal <= 20 ? 0.9 : yardsToGoal <= 28 ? 0.76 : 0.6
      return { type: 'fg', good: Math.random() < p }
    }
    const raw = game.ballYard + dir * Math.round(rand(36, 50))
    const deep = attackOf(game.possession, raw) >= 92
    const spot = deep ? (game.possession === 'o' ? 80 : 20) : clamp(raw, 5, 95)
    return { type: 'punt', spotYard: spot }
  }

  const r = Math.random()
  if (r < 0.05) {
    const spot = clamp(game.ballYard + dir * Math.round(rand(-4, 18)), 3, 97)
    return { type: 'interception', spotYard: spot }
  }
  if (r < 0.17) return { type: 'incomplete' }
  if (r < 0.26) return { type: 'gain', mode: 'sack', yards: -Math.round(rand(2, 7)) }

  let mode: 'run' | 'pass'
  let yards: number
  if (r < 0.6) {
    mode = 'run'
    yards = Math.round(rand(1, 8))
  } else if (r < 0.85) {
    mode = 'pass'
    yards = Math.round(rand(5, 16))
  } else {
    mode = Math.random() < 0.65 ? 'pass' : 'run'
    yards = Math.round(rand(16, 42))
  }
  return { type: 'gain', mode, yards: Math.min(yards, yardsToGoal) }
}

function applyResult(
  game: Game,
  res: Result,
  geom: Geometry,
): { next: Game; celebrate?: string } {
  const dir = game.possession === 'o' ? 1 : -1
  const opp = other(game.possession)

  switch (res.type) {
    case 'gain': {
      const landed = game.ballYard + dir * res.yards
      if (res.yards > 0 && attackOf(game.possession, landed) >= 100) {
        return { next: newDrive(opp, own25(opp), geom), celebrate: 'TOUCHDOWN' }
      }
      const ball = clamp(landed, 1, 99)
      const gotFirst =
        res.yards > 0 &&
        (dir > 0 ? ball >= game.firstDownYard : ball <= game.firstDownYard)
      if (gotFirst) {
        const first = dir > 0 ? Math.min(ball + 10, 100) : Math.max(ball - 10, 0)
        return { next: { ...game, ballYard: ball, down: 1, firstDownYard: first } }
      }
      const down = game.down + 1
      if (down > 4) return { next: newDrive(opp, ball, geom) }
      return { next: { ...game, ballYard: ball, down } }
    }
    case 'incomplete': {
      const down = game.down + 1
      if (down > 4) return { next: newDrive(opp, game.ballYard, geom) }
      return { next: { ...game, down } }
    }
    case 'interception':
      return { next: newDrive(opp, res.spotYard, geom) }
    case 'punt':
      return { next: newDrive(opp, res.spotYard, geom) }
    case 'fg':
      if (res.good) {
        return { next: newDrive(opp, own25(opp), geom), celebrate: 'FIELD GOAL' }
      }
      return { next: newDrive(opp, clamp(game.ballYard, 20, 80), geom) }
  }
}

function downLabel(game: Game): string {
  const goal = attackOf(game.possession, game.firstDownYard) >= 100
  const distance = Math.max(1, Math.round(Math.abs(game.firstDownYard - game.ballYard)))
  const names = ['1ST', '2ND', '3RD', '4TH']
  return `${names[game.down - 1]} & ${goal ? 'GOAL' : distance}`
}

// ---------------------------------------------------------------------------
// Choreography: turn a call into player paths and ball legs.
// ---------------------------------------------------------------------------

function makeSnap(game: Game, res: Result, geom: Geometry): Snap {
  const { ppy, fx0, fx1, oTop, oBottom } = geom
  const fieldCx = (fx0 + fx1) / 2
  const fw = game.possession === 'o' ? -1 : 1 // px direction of attack
  const scrimY = yardToY(geom, game.ballYard)
  const sp = 28
  const cxLo = fx0 + 92
  const cxHi = fx1 - 92
  const cx =
    cxLo <= cxHi ? clamp(game.formationX + rand(-24, 24), cxLo, cxHi) : fieldCx
  const cX = (x: number) => clamp(x, fx0 + 10, fx1 - 10)
  const cY = (y: number) => clamp(y, oTop + 8, oBottom - 8)
  const behind = (d: number) => cY(scrimY - fw * d)
  const beyond = (d: number) => cY(scrimY + fw * d)
  const side = Math.random() < 0.5 ? -1 : 1
  const j = () => rand(-4, 4)
  const offense = game.possession
  const defense = other(game.possession)

  const actors: Walk[] = []
  const still = (kind: Team, p: Point, offSide: boolean): Walk => {
    const drift = offSide ? fw * rand(2, 8) : -fw * rand(1, 6)
    const a: Walk = {
      kind,
      spawn: { x: p.x + rand(-26, 26), y: cY(p.y - (offSide ? fw : -fw) * rand(18, 44)) },
      path: [p, { x: p.x + j(), y: cY(p.y + drift) }],
      t0: 0.18,
      t1: 0.9,
    }
    actors.push(a)
    return a
  }

  // The offense, in attack space (behind = its own side of the ball).
  const linemen: Point[] = []
  for (let i = -2; i <= 2; i++) {
    linemen.push({ x: cx + i * sp + j() * 0.5, y: behind(7) })
  }
  const center = linemen[2]
  const qbPos: Point =
    res.type === 'punt'
      ? { x: cx, y: behind(92) }
      : res.type === 'fg'
        ? { x: cx + 8, y: behind(52) }
        : { x: cx, y: behind(34) }
  const rbPos: Point =
    res.type === 'fg' ? { x: cx - 12, y: behind(62) } : { x: cx + 18, y: behind(50) }
  const tePos = { x: cX(cx - side * sp * 3), y: behind(8) }
  const wr1Pos = { x: cX(cx + side * sp * 4.8), y: behind(6) }
  const wr2Pos = { x: cX(cx - side * sp * 4.2), y: behind(10) }

  for (const p of linemen) still(offense, p, true)
  still(offense, tePos, true)
  const qbA = still(offense, qbPos, true)
  const rbA = still(offense, rbPos, true)
  const wr1A = still(offense, wr1Pos, true)
  const wr2A = still(offense, wr2Pos, true)

  // The defense, loosely mirrored.
  const dline: Point[] = [-1.5, -0.5, 0.5, 1.5].map((i) => ({
    x: cx + i * sp + j() * 0.5,
    y: beyond(9),
  }))
  const lbs: Point[] = [-1, 0, 1].map((i) => ({ x: cx + i * sp * 1.5 + j(), y: beyond(40) }))
  const safeties: Point[] = [
    { x: cX(cx - sp * 1.7), y: beyond(88) },
    { x: cX(cx + sp * 1.7), y: beyond(88) },
  ]
  const cb1Pos = { x: cX(wr1Pos.x + side * 6), y: beyond(14) }
  const cb2Pos = { x: cX(wr2Pos.x - side * 6), y: beyond(12) }

  const dlineA = dline.map((p) => still(defense, p, false))
  const lbsA = lbs.map((p) => still(defense, p, false))
  const safA = safeties.map((p) => still(defense, p, false))
  const cb1A = still(defense, cb1Pos, false)
  still(defense, cb2Pos, false)

  // Punts and kicks travel too far for even the gentle lean; and roughly
  // one play in five is covered from the fixed wide angle for variety.
  const wide = res.type === 'punt' || res.type === 'fg' || Math.random() < 0.22
  const snap: Snap = {
    actors,
    ball: [],
    dur: 2100,
    result: res,
    focus: { x: cx, y: scrimY },
    fw,
    wide,
  }
  const gainPx = res.type === 'gain' ? Math.abs(res.yards) * ppy : 0

  if (res.type === 'gain' && res.mode === 'run') {
    const isTD = attackOf(game.possession, game.ballYard + (game.possession === 'o' ? 1 : -1) * res.yards) >= 100
    const gapX = side * sp * rand(0.7, 1.5)
    const end = {
      x: cX(cx + gapX * 1.4 + side * rand(-20, 40)),
      y: cY(scrimY + fw * (gainPx + (isTD ? geom.ez * 0.5 : 0))),
    }
    rbA.path = [rbPos, { x: cx + gapX, y: beyond(6) }, end]
    rbA.t0 = 0.2
    rbA.t1 = 0.9
    rbA.linear = true
    lbsA[1].path = [lbs[1], { x: end.x + 8, y: cY(end.y - fw * 8) }]
    lbsA[1].t0 = 0.35
    lbsA[1].t1 = 0.93
    const chaser = safA[side === 1 ? 1 : 0]
    chaser.path = [chaser.path[0], { x: cX(end.x - 10), y: cY(end.y - fw * 4) }]
    chaser.t0 = 0.45
    chaser.t1 = 0.96
    const mesh = pointAlong(rbA.path, 0.06)
    snap.ball = [
      { path: [center, qbPos], t0: 0.06, t1: 0.14 },
      { path: [qbPos, mesh], t0: 0.15, t1: 0.24 },
      { path: [mesh, rbA.path[1], end], t0: 0.24, t1: 0.9, carry: true },
    ]
    snap.dur = 1900 + clamp(gainPx * 1.6, 0, 1100)
  }

  if (
    (res.type === 'gain' && res.mode === 'pass') ||
    res.type === 'incomplete' ||
    res.type === 'interception'
  ) {
    const complete = res.type === 'gain'
    const isTD =
      complete &&
      attackOf(game.possession, game.ballYard + (game.possession === 'o' ? 1 : -1) * res.yards) >= 100
    const depth = complete ? clamp(gainPx * 0.8 + 34, 64, 210) : rand(70, 150)
    const start = { x: wr1Pos.x, y: wr1Pos.y }
    const shapes: Array<Array<[number, number]>> = [
      [[0, depth]], // go
      [
        [0, depth * 0.35],
        [-side * 70, depth * 0.9],
      ], // slant
      [
        [0, depth * 0.6],
        [side * 62, depth * 0.6],
      ], // out
      [
        [0, depth * 0.55],
        [-side * 46, depth],
      ], // post
    ]
    const shape = shapes[Math.floor(Math.random() * shapes.length)]
    const route: Point[] = [
      start,
      ...shape.map(([dx, df]) => ({ x: cX(start.x + dx), y: cY(start.y + fw * df) })),
    ]
    const catchPt = route[route.length - 1]
    snap.route = route
    snap.routeLength = polylineLength(route)

    const drop = { x: cx + rand(-6, 6), y: behind(50) }
    qbA.path = [qbPos, drop]
    qbA.t0 = 0.12
    qbA.t1 = 0.32

    if (res.type === 'interception') {
      const picker =
        Math.abs(safeties[0].x - catchPt.x) <= Math.abs(safeties[1].x - catchPt.x)
          ? safA[0]
          : safA[1]
      const ret = {
        x: cX(catchPt.x + rand(-30, 30)),
        y: cY(catchPt.y - fw * rand(18, 46)),
      }
      const inPath = [picker.path[0], catchPt, ret]
      const toCatch = polylineLength([picker.path[0], catchPt])
      const tInt = 0.4 + 0.55 * (toCatch / polylineLength(inPath))
      picker.path = inPath
      picker.t0 = 0.4
      picker.t1 = 0.95
      picker.linear = true
      wr1A.path = route
      wr1A.t0 = 0.16
      wr1A.t1 = tInt + 0.08
      wr1A.linear = true
      snap.routeT0 = 0.16
      snap.routeT1 = tInt
      snap.ball = [
        { path: [center, qbPos], t0: 0.06, t1: 0.14 },
        { path: [qbPos, drop], t0: 0.14, t1: 0.32 },
        {
          path: [drop, catchPt],
          via: midVia(drop, catchPt),
          t0: tInt - 0.16,
          t1: tInt,
          flight: true,
        },
        { path: [catchPt, ret], t0: tInt, t1: 0.95, carry: true },
      ]
      snap.dur = 2600
    } else {
      const after = complete
        ? {
            x: cX(catchPt.x + side * rand(10, 50)),
            y: aheadOf(
              cY(scrimY + fw * (gainPx + (isTD ? geom.ez * 0.5 : 0))),
              catchPt.y,
              fw,
            ),
          }
        : null
      const runnerPath = after ? [...route, after] : route
      const t1 = after ? 0.92 : 0.68
      wr1A.path = runnerPath
      wr1A.t0 = 0.16
      wr1A.t1 = t1
      wr1A.linear = true
      const routeShare = after
        ? polylineLength(route) / polylineLength(runnerPath)
        : 1
      const tCatch = 0.16 + (t1 - 0.16) * routeShare
      snap.routeT0 = 0.16
      snap.routeT1 = tCatch

      cb1A.path = runnerPath.map((p) => ({ x: cX(p.x + side * 8), y: cY(p.y + fw * 14) }))
      cb1A.t0 = 0.2
      cb1A.t1 = Math.min(t1 + 0.04, 0.96)
      cb1A.linear = true

      const target = complete
        ? catchPt
        : { x: cX(catchPt.x + side * rand(14, 30)), y: cY(catchPt.y + fw * rand(6, 22)) }
      snap.ball = [
        { path: [center, qbPos], t0: 0.06, t1: 0.14 },
        { path: [qbPos, drop], t0: 0.14, t1: 0.32 },
        {
          path: [drop, target],
          via: midVia(drop, target),
          t0: tCatch - 0.16,
          t1: tCatch,
          flight: true,
        },
        ...(after
          ? [{ path: [catchPt, after], t0: tCatch, t1: 0.92, carry: true }]
          : [{ path: [target, { x: target.x + rand(-10, 10), y: target.y + 8 }], t0: tCatch, t1: tCatch + 0.08 }]),
      ]
      if (after) {
        const cover = safA[side === 1 ? 1 : 0]
        cover.path = [cover.path[0], { x: cX(after.x - side * 10), y: cY(after.y - fw * 6) }]
        cover.t0 = 0.5
        cover.t1 = 0.96
      }
      snap.dur = complete ? 2000 + clamp(gainPx * 1.4, 0, 1000) : 2000
    }
  }

  if (res.type === 'gain' && res.mode === 'sack') {
    const drop = { x: cx + rand(-8, 8), y: behind(52) }
    const sackPt = { x: cX(drop.x + rand(-12, 12)), y: cY(scrimY - fw * Math.abs(res.yards) * ppy) }
    qbA.path = [qbPos, drop, sackPt]
    qbA.t0 = 0.12
    qbA.t1 = 0.7
    qbA.linear = true
    const rusher = dlineA[side === 1 ? 3 : 0]
    rusher.path = [rusher.path[0], { x: cX(cx + side * sp * 3.2), y: cY(scrimY - fw * 24) }, sackPt]
    rusher.t0 = 0.15
    rusher.t1 = 0.72
    rusher.linear = true
    snap.ball = [
      { path: [center, qbPos], t0: 0.06, t1: 0.14 },
      { path: [qbPos, drop, sackPt], t0: 0.14, t1: 0.7 },
    ]
    snap.dur = 2000
  }

  if (res.type === 'punt') {
    const land = { x: cX(cx + rand(-50, 50)), y: yardToY(geom, res.spotYard) }
    snap.ball = [
      { path: [center, qbPos], t0: 0.08, t1: 0.2 },
      { path: [qbPos, land], via: midVia(qbPos, land), t0: 0.3, t1: 0.8, flight: true },
      { path: [land, { x: cX(land.x + rand(-14, 14)), y: cY(land.y + fw * 10) }], t0: 0.8, t1: 0.9 },
    ]
    for (const gunner of [wr1A, wr2A]) {
      gunner.path = [gunner.path[0], { x: cX(land.x + rand(-24, 24)), y: cY(land.y - fw * 12) }]
      gunner.t0 = 0.24
      gunner.t1 = 0.95
      gunner.linear = true
    }
    snap.dur = 2500
  }

  if (res.type === 'fg') {
    const postY = fw === -1 ? geom.top - geom.ez * 0.55 : geom.bottom + geom.ez * 0.55
    const target = {
      x: fieldCx + (res.good ? rand(-10, 10) : side * rand(48, 75)),
      y: cY(postY),
    }
    snap.ball = [
      { path: [center, qbPos], t0: 0.08, t1: 0.18 },
      { path: [qbPos, target], via: midVia(qbPos, target), t0: 0.34, t1: 0.8, flight: true },
    ]
    snap.dur = 2300
  }

  return snap
}

/** A gentle bend for a flight leg, so throws and kicks do not look ruled. */
function midVia(a: Point, b: Point): Point {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const k = rand(-0.12, 0.12)
  return { x: mx - (dy / len) * len * k, y: my + (dx / len) * len * k }
}

/** Clamp a run-after-catch endpoint so it never travels backwards. */
function aheadOf(y: number, catchY: number, fw: number): number {
  return fw === -1 ? Math.min(y, catchY) : Math.max(y, catchY)
}

/** A live token, read once at init so the palette cascades. */
function readToken(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return raw || fallback
}

// ---------------------------------------------------------------------------
// The component.
// ---------------------------------------------------------------------------

interface Camera {
  x: number
  y: number
  zoom: number
}

export function ChalkboardField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const colors = {
      route: readToken('--accent-primary', '#5fa657'),
      teamX: readToken('--accent-info', '#c3d9f3'),
      yellow: readToken('--accent-warn', '#e8c34a'),
    }

    const state = {
      dpr: Math.min(window.devicePixelRatio || 1, DPR_CAP),
      geom: {
        w: 0,
        h: 0,
        oTop: 0,
        oBottom: 0,
        fx0: 0,
        fx1: 0,
        top: 0,
        bottom: 0,
        ez: 0,
        ppy: 1,
      } as Geometry,
      game: null as Game | null,
      snap: null as Snap | null,
      phase: 'huddle' as Phase,
      phaseStart: 0,
      huddleDur: 400,
      celebrate: null as string | null,
      celebrateZone: 'top' as 'top' | 'bottom',
      disp: { ball: 0, first: 0 },
      cam: { x: 0, y: 0, zoom: 1 } as Camera,
      burst: null as { x: number; y: number } | null,
      lastNow: 0,
      staticDrawn: false,
      reducedMotion: false,
      rafId: 0,
      running: false,
    }

    /* The field is a centred design, sized against the CONTENT area: the
       sidebar is measured (its rect is zero when the mobile layout hides
       it) and excluded, the width is proportioned against the length, and
       the whole boundary — both end zones — always fits on screen. */
    const layout = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      const aside = document.querySelector('aside')
      const rect = aside?.getBoundingClientRect()
      const contentLeft = rect && rect.width > 0 ? rect.right : 0
      const contentW = Math.max(w - contentLeft, 220)
      const marginY = clamp(h * 0.055, 28, 64)
      const fieldLen = h - marginY * 2
      const ez = clamp(fieldLen * 0.1, 44, 90)
      const fieldW = clamp(Math.min(contentW - 48, fieldLen * 0.62), 220, 680)
      const fx0 = contentLeft + (contentW - fieldW) / 2
      state.geom = {
        w,
        h,
        oTop: marginY,
        oBottom: h - marginY,
        fx0,
        fx1: fx0 + fieldW,
        top: marginY + ez,
        bottom: h - marginY - ez,
        ez,
        ppy: (h - (marginY + ez) * 2) / 100,
      }
      canvas.width = Math.floor(w * state.dpr)
      canvas.height = Math.floor(h * state.dpr)
      // A play in flight was choreographed against the old field: reset to
      // the huddle, snap the camera wide, and line up on the new geometry.
      if (state.snap && state.phase !== 'huddle') {
        state.phase = 'huddle'
        state.phaseStart = performance.now()
        state.huddleDur = 500
      }
      if (state.game) {
        // Re-centre the drive laterally on the new field.
        state.game = { ...state.game, formationX: (state.geom.fx0 + state.geom.fx1) / 2 }
      }
      state.cam = { x: w / 2, y: h / 2, zoom: 1 }
      state.staticDrawn = false
    }

    // -----------------------------------------------------------------
    // The camera: a contained lean, never a cut. maxZoom is exactly the
    // magnification at which the entire field boundary still fits the
    // frame, so however the camera leans toward the play, both end zones
    // stay on screen. That containment IS the anti-distraction rule.
    // -----------------------------------------------------------------

    const maxZoom = () => {
      const { w, h, fx0, fx1, oTop, oBottom } = state.geom
      return Math.max(
        1,
        Math.min(1.09, w / (fx1 - fx0 + 40), h / (oBottom - oTop + 28)),
      )
    }

    /** Clamp a camera so its view contains the whole field boundary. */
    const containCam = (x: number, y: number, zoom: number): Camera => {
      const { w, h, fx0, fx1, oTop, oBottom } = state.geom
      const hw = w / (2 * zoom)
      const hh = h / (2 * zoom)
      const pad = 8
      const xLo = fx1 + pad - hw
      const xHi = fx0 - pad + hw
      const yLo = oBottom + pad - hh
      const yHi = oTop - pad + hh
      return {
        x: xLo > xHi ? (fx0 + fx1) / 2 : clamp(x, xLo, xHi),
        y: yLo > yHi ? h / 2 : clamp(y, yLo, yHi),
        zoom,
      }
    }

    /* The camera never pans sideways: its x is always the value that pins
       the field to the SAME screen position at any zoom, so the centred
       design stays put and only a gentle vertical lean moves. */
    const pinnedX = (zoom: number) => {
      const { w, fx0, fx1 } = state.geom
      const fieldCx = (fx0 + fx1) / 2
      return fieldCx - (fieldCx - w / 2) / zoom
    }

    const camTarget = (now: number): Camera => {
      const { w, h } = state.geom
      const wideCam: Camera = { x: w / 2, y: h / 2, zoom: 1 }
      const snap = state.snap
      if (!snap || state.phase === 'huddle' || state.phase === 'fade') return wideCam
      if (snap.wide && state.phase !== 'celebrate') return wideCam
      const z = maxZoom()
      switch (state.phase) {
        case 'lineup':
        case 'set':
          return containCam(pinnedX(z), snap.focus.y + snap.fw * 14, z)
        case 'live': {
          const p = clamp((now - state.phaseStart) / snap.dur, 0, 1)
          const b = ballAt(snap.ball, p).pos
          return containCam(pinnedX(z), b.y + snap.fw * 30, z)
        }
        case 'whistle': {
          const b = ballAt(snap.ball, 1).pos
          return containCam(pinnedX(z), b.y, z)
        }
        case 'celebrate': {
          const zoneY =
            state.celebrateZone === 'top'
              ? (state.geom.oTop + state.geom.top) / 2
              : (state.geom.bottom + state.geom.oBottom) / 2
          return containCam(pinnedX(z), zoneY, z)
        }
        default:
          return wideCam
      }
    }

    const applyCamera = () => {
      const { w, h } = state.geom
      const z = state.cam.zoom
      ctx.setTransform(
        state.dpr * z,
        0,
        0,
        state.dpr * z,
        state.dpr * (w / 2 - state.cam.x * z),
        state.dpr * (h / 2 - state.cam.y * z),
      )
    }

    /** The world rect the camera can currently see, padded for culling. */
    const viewRect = () => {
      const { w, h } = state.geom
      const hw = w / (2 * state.cam.zoom)
      const hh = h / (2 * state.cam.zoom)
      return {
        x0: state.cam.x - hw - 60,
        y0: state.cam.y - hh - 60,
        x1: state.cam.x + hw + 60,
        y1: state.cam.y + hh + 60,
      }
    }

    // -----------------------------------------------------------------
    // The field, drawn as vectors through the camera every frame so chalk
    // stays crisp. All wobble comes from noise(), never Math.random —
    // random at draw time would make the board shimmer.
    // -----------------------------------------------------------------

    const drawField = () => {
      const { oTop, oBottom, fx0, fx1, top, bottom, ez } = state.geom
      const fieldCx = (fx0 + fx1) / 2
      const fieldW = fx1 - fx0
      const view = viewRect()

      // The boundary: sidelines the full length, end lines behind the
      // end zones. Seeing the whole rectangle is the point.
      ctx.strokeStyle = `rgba(255,255,255,${SIDELINE_ALPHA})`
      ctx.lineWidth = 2
      ctx.beginPath()
      for (const x of [fx0, fx1]) {
        ctx.moveTo(x, oTop)
        ctx.lineTo(x + (noise(x, 7) - 0.5) * 2, oBottom)
      }
      for (const y of [oTop, oBottom]) {
        ctx.moveTo(fx0, y)
        ctx.lineTo(fx1, y + (noise(y, 5) - 0.5) * 2)
      }
      ctx.stroke()

      // End zones: diagonal hatch, the brand in faint letterspaced chalk.
      ctx.strokeStyle = `rgba(255,255,255,${ENDZONE_HATCH_ALPHA})`
      ctx.lineWidth = 1
      for (const [zTop, zBottom] of [
        [oTop + 2, top - 2],
        [bottom + 2, oBottom - 2],
      ]) {
        if (zBottom < view.y0 || zTop > view.y1) continue
        ctx.save()
        ctx.beginPath()
        ctx.rect(fx0 + 2, zTop, fieldW - 4, zBottom - zTop)
        ctx.clip()
        const depth = zBottom - zTop
        ctx.beginPath()
        for (let x = fx0 - depth; x < fx1; x += 24) {
          ctx.moveTo(x, zTop)
          ctx.lineTo(x + depth, zBottom)
        }
        ctx.stroke()
        ctx.restore()
        const size = Math.round(
          Math.min(clamp(ez * 0.4, 16, 30), (fieldW - 24) / 9.5),
        )
        ctx.fillStyle = `rgba(255,255,255,${ENDZONE_TEXT_ALPHA})`
        ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('G R I D I R O N', fieldCx, (zTop + zBottom) / 2)
      }

      // Goalposts, one small chalk glyph per end zone.
      ctx.strokeStyle = `rgba(255,255,255,${POST_ALPHA})`
      ctx.lineWidth = 1.5
      for (const [py, up] of [
        [top - ez * 0.5, -1],
        [bottom + ez * 0.5, 1],
      ]) {
        if (py < view.y0 - 30 || py > view.y1 + 30) continue
        ctx.beginPath()
        ctx.moveTo(fieldCx, py - up * 10)
        ctx.lineTo(fieldCx, py) // stem
        ctx.moveTo(fieldCx - 23, py)
        ctx.lineTo(fieldCx + 23, py) // crossbar
        ctx.moveTo(fieldCx - 23, py)
        ctx.lineTo(fieldCx - 23, py + up * 16)
        ctx.moveTo(fieldCx + 23, py)
        ctx.lineTo(fieldCx + 23, py + up * 16)
        ctx.stroke()
      }

      // Goal lines, a shade stronger than the grid.
      ctx.lineWidth = 2
      ctx.strokeStyle = `rgba(255,255,255,${GOAL_ALPHA})`
      for (const y of [top, bottom]) {
        if (y < view.y0 || y > view.y1) continue
        ctx.beginPath()
        ctx.moveTo(fx0, y)
        ctx.lineTo(fx1, y + (noise(y, 11) - 0.5) * 2)
        ctx.stroke()
      }

      // A line every five yards — the fives lighter — numerals at the tens.
      const gap10 = state.geom.ppy * 10
      const numeralSize = Math.round(
        Math.min(clamp(gap10 * 0.5, 20, 40), fieldW / 8),
      )
      ctx.lineWidth = 1
      for (let yard = 5; yard <= 95; yard += 5) {
        const y = yardToY(state.geom, yard)
        if (y < view.y0 - numeralSize || y > view.y1 + numeralSize) continue
        const ten = yard % 10 === 0
        const sag = noise(yard, 3) * 2 - 1
        ctx.strokeStyle = `rgba(255,255,255,${ten ? GRID_ALPHA : GRID_ALPHA * 0.6})`
        ctx.beginPath()
        ctx.moveTo(fx0, y)
        ctx.quadraticCurveTo(fieldCx, y + sag * 3, fx1, y + sag)
        ctx.stroke()
        if (!ten) continue

        // Real yard numerals: they cycle up to the 50 and back down.
        const numeral = String(Math.min(yard, 100 - yard))
        ctx.fillStyle = `rgba(255,255,255,${NUMERAL_ALPHA})`
        // A plain stack: canvas font strings cannot resolve CSS variables —
        // an invalid declaration is silently ignored wholesale.
        ctx.font = `600 ${numeralSize}px ui-monospace, SFMono-Regular, Menlo, monospace`
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        ctx.fillText(numeral, fx0 + 18, y - numeralSize * 0.72)
        ctx.textAlign = 'right'
        ctx.fillText(numeral, fx1 - 18, y - numeralSize * 0.72)
      }

      // Interior hash columns, a tick at every yard between the fives.
      ctx.strokeStyle = `rgba(255,255,255,${HASH_ALPHA})`
      ctx.beginPath()
      for (const hx of [fx0 + fieldW * 0.37, fx0 + fieldW * 0.63]) {
        for (let yard = 1; yard <= 99; yard++) {
          if (yard % 5 === 0) continue
          const hy = yardToY(state.geom, yard)
          if (hy < view.y0 || hy > view.y1) continue
          ctx.moveTo(hx - 3, hy)
          ctx.lineTo(hx + 3, hy + (noise(hx, yard) - 0.5))
        }
      }
      ctx.stroke()
    }

    const drawMark = (p: Point, kind: Team) => {
      ctx.strokeStyle = kind === 'o' ? '#ffffff' : colors.teamX
      ctx.beginPath()
      if (kind === 'o') {
        // A hand-drawn circle: it starts where the wrist happened to be and
        // does not quite close.
        const a0 = noise(p.x, p.y) * Math.PI * 2
        ctx.arc(p.x, p.y, 6, a0, a0 + Math.PI * 1.94)
      } else {
        ctx.moveTo(p.x - 5, p.y - 5)
        ctx.lineTo(p.x + 5, p.y + 5)
        ctx.moveTo(p.x + 5, p.y - 5)
        ctx.lineTo(p.x - 5, p.y + 5)
      }
      ctx.stroke()
    }

    const drawRoute = (route: Point[], routeLength: number, progress: number, alpha: number) => {
      ctx.save()
      ctx.globalAlpha = alpha * ROUTE_ALPHA
      ctx.lineWidth = 1.75
      ctx.strokeStyle = colors.route
      ctx.setLineDash([routeLength])
      ctx.lineDashOffset = routeLength * (1 - progress)
      ctx.beginPath()
      ctx.moveTo(route[0].x, route[0].y)
      for (let i = 1; i < route.length; i++) ctx.lineTo(route[i].x, route[i].y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }

    const drawBall = (pos: Point, angle: number, alpha: number) => {
      ctx.save()
      ctx.translate(pos.x, pos.y)
      ctx.rotate(angle)
      ctx.globalAlpha = alpha * BALL_ALPHA
      ctx.fillStyle = colors.yellow
      ctx.beginPath()
      ctx.ellipse(0, 0, 6, 3.6, 0, 0, Math.PI * 2)
      ctx.fill()
      // The lace.
      ctx.globalAlpha = alpha * 0.45
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.moveTo(-2.2, 0)
      ctx.lineTo(2.2, 0)
      ctx.stroke()
      ctx.restore()
    }

    const drawMarkers = () => {
      const game = state.game
      if (!game) return
      const { fx0, fx1 } = state.geom
      const scrimY = yardToY(state.geom, state.disp.ball)
      ctx.save()
      ctx.globalAlpha = SCRIMMAGE_ALPHA
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(fx0 + 3, scrimY)
      ctx.lineTo(fx1 - 3, scrimY)
      ctx.stroke()
      // The broadcast convention: the line to gain is yellow. Hidden on
      // goal-to-go, where it would only retrace the goal line.
      if (attackOf(game.possession, game.firstDownYard) < 99.5) {
        const firstY = yardToY(state.geom, state.disp.first)
        ctx.globalAlpha = FIRST_DOWN_ALPHA
        ctx.strokeStyle = colors.yellow
        ctx.setLineDash([12, 8])
        ctx.beginPath()
        ctx.moveTo(fx0 + 3, firstY)
        ctx.lineTo(fx1 - 3, firstY)
        ctx.stroke()
        ctx.setLineDash([])
      }
      // The down, chalked in the margin beside the field when there is
      // one, tucked inside the sideline when there is not (small screens).
      const fw = game.possession === 'o' ? -1 : 1
      ctx.globalAlpha = DOWN_TEXT_ALPHA
      ctx.fillStyle = '#ffffff'
      ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textBaseline = 'middle'
      if (fx0 >= 104) {
        ctx.textAlign = 'right'
        ctx.fillText(downLabel(game), fx0 - 14, scrimY - fw * 14)
      } else {
        ctx.textAlign = 'left'
        ctx.fillText(downLabel(game), fx0 + 8, scrimY - fw * 16)
      }
      ctx.restore()
    }

    const drawFormation = (now: number) => {
      const snap = state.snap
      if (!snap) return
      const elapsed = now - state.phaseStart
      let alpha = 1
      let posOf: (a: Walk) => Point = (a) => a.path[0]
      let ballP: number | null = null

      switch (state.phase) {
        case 'lineup': {
          const q = easeInOut(clamp(elapsed / LINEUP, 0, 1))
          alpha = q
          posOf = (a) => ({
            x: a.spawn.x + (a.path[0].x - a.spawn.x) * q,
            y: a.spawn.y + (a.path[0].y - a.spawn.y) * q,
          })
          ballP = 0
          break
        }
        case 'set':
          ballP = 0
          break
        case 'live': {
          const p = clamp(elapsed / snap.dur, 0, 1)
          posOf = (a) => walkPos(a, p)
          ballP = p
          break
        }
        case 'whistle':
          posOf = (a) => walkPos(a, 1)
          ballP = 1
          break
        case 'celebrate': {
          const p = clamp(elapsed / CELEBRATE, 0, 1)
          alpha = 1 - easeInOut(clamp(p * 1.5, 0, 1))
          posOf = (a) => walkPos(a, 1)
          ballP = 1
          break
        }
        case 'fade':
          alpha = 1 - clamp(elapsed / FADE, 0, 1)
          posOf = (a) => walkPos(a, 1)
          ballP = 1
          break
        case 'huddle':
          return
      }

      ctx.lineWidth = 1.5
      ctx.globalAlpha = alpha * MARK_ALPHA
      for (const actor of snap.actors) drawMark(posOf(actor), actor.kind)
      ctx.globalAlpha = 1

      // The route, drawn as the receiver runs it.
      if (snap.route && snap.routeLength && snap.routeT0 !== undefined && snap.routeT1 !== undefined) {
        const p = ballP ?? 0
        const progress =
          state.phase === 'live'
            ? clamp((p - snap.routeT0) / (snap.routeT1 - snap.routeT0), 0, 1)
            : state.phase === 'lineup' || state.phase === 'set'
              ? 0
              : 1
        if (progress > 0) drawRoute(snap.route, snap.routeLength, progress, alpha)
      }

      if (ballP !== null && snap.ball.length) {
        const { pos, leg } = ballAt(snap.ball, ballP)
        if (leg?.flight) {
          ctx.save()
          ctx.globalAlpha = alpha * 0.22
          ctx.strokeStyle = colors.yellow
          ctx.lineWidth = 1
          ctx.setLineDash([6, 6])
          ctx.beginPath()
          ctx.moveTo(leg.path[0].x, leg.path[0].y)
          ctx.lineTo(pos.x, pos.y)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.restore()
        }
        // Ghost marks behind a carried ball: the speed reads at a glance.
        if (leg?.carry && state.phase === 'live') {
          for (const [back, ghostAlpha] of [
            [0.035, 0.16],
            [0.07, 0.08],
          ]) {
            const gp = ballP - back
            if (gp > leg.t0) {
              const gpos = legPos(leg, (gp - leg.t0) / (leg.t1 - leg.t0))
              ctx.save()
              ctx.globalAlpha = alpha * ghostAlpha
              ctx.fillStyle = colors.yellow
              ctx.beginPath()
              ctx.ellipse(gpos.x, gpos.y, 5, 3, 0, 0, Math.PI * 2)
              ctx.fill()
              ctx.restore()
            }
          }
        }
        const ahead = ballAt(snap.ball, Math.min(ballP + 0.01, 1)).pos
        const angle =
          ahead.x === pos.x && ahead.y === pos.y
            ? Math.PI / 2
            : Math.atan2(ahead.y - pos.y, ahead.x - pos.x)
        drawBall(pos, angle, alpha)
        // An incompletion gets its chalk verdict at the spot.
        if (state.phase === 'whistle' && snap.result.type === 'incomplete') {
          ctx.save()
          ctx.globalAlpha = 0.3
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(pos.x - 5, pos.y - 5)
          ctx.lineTo(pos.x + 5, pos.y + 5)
          ctx.moveTo(pos.x + 5, pos.y - 5)
          ctx.lineTo(pos.x - 5, pos.y + 5)
          ctx.stroke()
          ctx.restore()
        }
      }
    }

    /** The chalk impact burst at the tackle, drawn early in the whistle. */
    const drawBurst = (now: number) => {
      if (!state.burst || state.phase !== 'whistle') return
      const t = clamp((now - state.phaseStart) / 340, 0, 1)
      if (t >= 1) return
      const { x, y } = state.burst
      ctx.save()
      ctx.globalAlpha = (1 - t) * 0.45
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.25
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const angle = noise(i, x) * Math.PI * 2
        const r0 = 5 + 13 * t
        const r1 = r0 + 6
        ctx.moveTo(x + Math.cos(angle) * r0, y + Math.sin(angle) * r0)
        ctx.lineTo(x + Math.cos(angle) * r1, y + Math.sin(angle) * r1)
      }
      ctx.stroke()
      ctx.restore()
    }

    const drawCelebration = (now: number) => {
      if (state.phase !== 'celebrate' || !state.celebrate) return
      const { oTop, oBottom, top, bottom, fx0, fx1 } = state.geom
      const p = clamp((now - state.phaseStart) / CELEBRATE, 0, 1)
      const env = Math.sin(Math.PI * p)
      const zoneTop = state.celebrateZone === 'top' ? oTop + 2 : bottom + 2
      const zoneBottom = state.celebrateZone === 'top' ? top - 2 : oBottom - 2
      ctx.save()
      ctx.globalAlpha = env * 0.05
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(fx0 + 2, zoneTop, fx1 - fx0 - 4, zoneBottom - zoneTop)
      ctx.globalAlpha = env * CELEBRATE_ALPHA
      ctx.fillStyle = '#ffffff'
      const size = Math.round(
        Math.min(clamp((state.geom.w / state.cam.zoom) * 0.032, 13, 28), (fx1 - fx0) / 12),
      )
      ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(state.celebrate.split('').join(' '), (fx0 + fx1) / 2, (zoneTop + zoneBottom) / 2)
      ctx.restore()
    }

    const drawFrame = (now: number) => {
      const { w, h } = state.geom
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      applyCamera()
      drawField()
      drawMarkers()
      drawFormation(now)
      drawBurst(now)
      drawCelebration(now)
    }

    const phaseDur = (): number => {
      switch (state.phase) {
        case 'lineup':
          return LINEUP
        case 'set':
          return SET
        case 'live':
          return state.snap?.dur ?? 2100
        case 'whistle':
          return WHISTLE
        case 'celebrate':
          return CELEBRATE
        case 'fade':
          return FADE
        case 'huddle':
          return state.huddleDur
      }
    }

    const advance = (now: number) => {
      const game = state.game
      if (!game) return
      switch (state.phase) {
        case 'lineup':
          state.phase = 'set'
          break
        case 'set':
          state.phase = 'live'
          break
        case 'live': {
          const snap = state.snap
          if (!snap) return
          const { next, celebrate } = applyResult(game, snap.result, state.geom)
          state.celebrate = celebrate ?? null
          state.celebrateZone = game.possession === 'o' ? 'top' : 'bottom'
          state.game = next
          state.phase = celebrate ? 'celebrate' : 'whistle'
          // A tackle ends with a chalk burst at the spot — local to the
          // play, unlike the camera shake this replaced.
          const tackled = snap.result.type === 'gain' || snap.result.type === 'interception'
          state.burst = !celebrate && tackled ? ballAt(snap.ball, 1).pos : null
          break
        }
        case 'whistle':
        case 'celebrate':
          state.phase = 'fade'
          break
        case 'fade':
          state.phase = 'huddle'
          state.huddleDur = HUDDLE_MIN + Math.random() * HUDDLE_RANGE
          break
        case 'huddle':
          state.snap = makeSnap(game, callPlay(game), state.geom)
          state.phase = 'lineup'
          break
      }
      state.phaseStart = now
      state.staticDrawn = false
    }

    const loop = (now: number) => {
      const game = state.game
      if (!game) return
      const dt = state.lastNow ? Math.min(now - state.lastNow, 100) : 16
      state.lastNow = now

      // The markers glide to their new spots rather than jumping.
      const k = 1 - Math.exp(-dt / 260)
      state.disp.ball += (game.ballYard - state.disp.ball) * k
      state.disp.first += (game.firstDownYard - state.disp.first) * k
      const markersMoving =
        Math.abs(game.ballYard - state.disp.ball) > 0.05 ||
        Math.abs(game.firstDownYard - state.disp.first) > 0.05

      if (now - state.phaseStart >= phaseDur()) advance(now)

      // The camera glides, slowly — a lean, not a cut.
      const target = camTarget(now)
      const kp = 1 - Math.exp(-dt / 450)
      const kz = 1 - Math.exp(-dt / 700)
      state.cam.x += (target.x - state.cam.x) * kp
      state.cam.y += (target.y - state.cam.y) * kp
      state.cam.zoom += (target.zoom - state.cam.zoom) * kz
      const camMoving =
        Math.abs(target.x - state.cam.x) > 0.4 ||
        Math.abs(target.y - state.cam.y) > 0.4 ||
        Math.abs(target.zoom - state.cam.zoom) > 0.002

      // Between plays nothing moves: draw the board once and idle.
      const isStatic =
        (state.phase === 'set' || state.phase === 'huddle') && !markersMoving && !camMoving
      if (!isStatic || !state.staticDrawn) {
        drawFrame(now)
        state.staticDrawn = isStatic
      }
      state.rafId = requestAnimationFrame(loop)
    }

    const start = () => {
      if (state.running || state.reducedMotion) return
      state.running = true
      state.lastNow = 0
      state.phaseStart = performance.now()
      state.rafId = requestAnimationFrame(loop)
    }
    const stop = () => {
      state.running = false
      cancelAnimationFrame(state.rafId)
    }

    /* Reduced motion: one static frame — the whole field, a formation
       frozen mid-play with its route drawn, the camera at rest. */
    const drawStill = () => {
      const game = state.game
      if (!game) return
      state.disp.ball = game.ballYard
      state.disp.first = game.firstDownYard
      state.snap = makeSnap(game, { type: 'gain', mode: 'pass', yards: 12 }, state.geom)
      state.cam = { x: state.geom.w / 2, y: state.geom.h / 2, zoom: 1 }
      state.phase = 'live'
      state.phaseStart = 0
      drawFrame(state.snap.dur * 0.72)
      state.phase = 'huddle'
    }

    const handleVisibility = () => {
      if (document.hidden) stop()
      else start()
    }

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleMotion = () => {
      state.reducedMotion = motionQuery.matches
      if (state.reducedMotion) {
        stop()
        drawStill()
      } else {
        start()
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      layout()
      if (state.reducedMotion) drawStill()
    })

    layout()
    const openingTeam: Team = Math.random() < 0.5 ? 'o' : 'x'
    state.game = newDrive(openingTeam, own25(openingTeam), state.geom)
    state.disp = { ball: state.game.ballYard, first: state.game.firstDownYard }
    // The opening drive lines up almost immediately — a fresh page load
    // should show the board playing, not an empty field.
    state.huddleDur = 350
    state.phaseStart = performance.now()
    handleMotion()
    resizeObserver.observe(document.documentElement)
    motionQuery.addEventListener('change', handleMotion)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibility)
      motionQuery.removeEventListener('change', handleMotion)
      resizeObserver.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: -1,
      }}
    />
  )
}

export default ChalkboardField
