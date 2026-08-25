'use client'

import { useEffect, useRef } from 'react'

/**
 * The chalkboard: Gridiron's ambient identity layer.
 *
 * A fixed canvas at z-index -1 — behind every in-flow element, above the
 * body's black. It draws a faint yard-line grid, and every few seconds a
 * dim chalk play: O's and X's fade in, one route draws itself in the
 * model's green, holds, and fades. The board lives in the page's margins;
 * cards and chrome are opaque, so no number is ever read through it.
 *
 * **This is the sanctioned exception to the flat-Bugatti rule, and it is
 * engineered not to repeat the soccer sibling's ambient revert.** That
 * failure was atmosphere OVER data. This layer is capped at chalk-dust
 * alphas, animates one small figure at a time, and never sits under a
 * table — the surfaces above it are opaque by design-system rule.
 *
 * Lifecycle discipline ported from the personal site's ParticleField:
 * devicePixelRatio capped at 2; requestAnimationFrame only runs while a
 * play is actually animating (the board is idle most of the time and costs
 * nothing); the loop pauses on a hidden tab; ResizeObserver relayouts; and
 * under prefers-reduced-motion the board draws one static frame — grid
 * plus a finished play — and never moves.
 */

const DPR_CAP = 2
const YARD_GAP = 132 // px between yard lines
const HASH_GAP = 26 // px between hash ticks along a line

const GRID_ALPHA = 0.07
const HASH_ALPHA = 0.05
const PLAY_ALPHA = 0.17
const ROUTE_ALPHA = 0.26

// Phase lengths, ms. One play runs ~6s and then the board rests.
const FADE_IN = 600
const DRAW = 2200
const HOLD = 1900
const FADE_OUT = 1500
const REST_MIN = 3500
const REST_RANGE = 4000

interface Point {
  x: number
  y: number
}

interface Play {
  os: Point[]
  xs: Point[]
  route: Point[]
  routeLength: number
  born: number
}

/** The model's green, read from the live token so the palette cascades. */
function routeColor(): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent-primary')
    .trim()
  return raw || '#5fa657'
}

function segmentLengths(points: Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return total
}

/** A random chalk play: an offensive line, a defense, one route. */
function makePlay(width: number, height: number, now: number): Play {
  const margin = 90
  const spread = 30
  const ax = margin + Math.random() * Math.max(width - margin * 2, 1)
  const ay =
    height * 0.3 + Math.random() * height * 0.5 // keep off the very top chrome

  const jitter = () => (Math.random() - 0.5) * 7

  // Five linemen, a quarterback, two wide men.
  const os: Point[] = []
  for (let i = -2; i <= 2; i++) {
    os.push({ x: ax + i * spread + jitter(), y: ay + jitter() })
  }
  os.push({ x: ax + jitter(), y: ay + 30 + jitter() }) // QB
  const wideSide = Math.random() < 0.5 ? -1 : 1
  const receiver: Point = { x: ax + wideSide * spread * 4.4, y: ay + jitter() }
  os.push(receiver)
  os.push({ x: ax - wideSide * spread * 3.8, y: ay + 6 + jitter() })

  // Defense: five across, two deep, loosely mirrored.
  const xs: Point[] = []
  for (let i = -2; i <= 2; i++) {
    xs.push({ x: ax + i * spread + jitter(), y: ay - 34 + jitter() })
  }
  xs.push({ x: ax - spread * 1.6 + jitter(), y: ay - 82 + jitter() })
  xs.push({ x: ax + spread * 1.9 + jitter(), y: ay - 82 + jitter() })

  // One route off the wide receiver: go, slant, out, or post.
  const shapes: Point[][] = [
    [{ x: 0, y: -130 }], // go
    [
      { x: 0, y: -45 },
      { x: -wideSide * 70, y: -105 },
    ], // slant
    [
      { x: 0, y: -70 },
      { x: wideSide * 62, y: -70 },
    ], // out
    [
      { x: 0, y: -80 },
      { x: -wideSide * 48, y: -138 },
    ], // post
  ]
  const shape = shapes[Math.floor(Math.random() * shapes.length)]
  const route: Point[] = [
    { x: receiver.x, y: receiver.y - 8 },
    ...shape.map((d) => ({ x: receiver.x + d.x, y: receiver.y + d.y })),
  ]

  return { os, xs, route, routeLength: segmentLengths(route), born: now }
}

export function ChalkboardField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const state = {
      dpr: Math.min(window.devicePixelRatio || 1, DPR_CAP),
      width: 0,
      height: 0,
      grid: null as HTMLCanvasElement | null,
      play: null as Play | null,
      restUntil: 0,
      reducedMotion: false,
      rafId: 0,
      running: false,
      route: routeColor(),
    }

    /* The grid is chalk too — every line carries a tiny precomputed sag so
       it reads hand-ruled, and it is rendered once to an offscreen canvas
       and blitted, so a frame is one drawImage plus a dozen strokes. */
    const buildGrid = () => {
      const off = document.createElement('canvas')
      off.width = Math.max(Math.floor(state.width * state.dpr), 1)
      off.height = Math.max(Math.floor(state.height * state.dpr), 1)
      const g = off.getContext('2d')
      if (!g) return
      g.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)
      g.lineWidth = 1

      for (let y = YARD_GAP * 0.7; y < state.height; y += YARD_GAP) {
        const sag = Math.random() * 2 - 1
        g.strokeStyle = `rgba(255,255,255,${GRID_ALPHA})`
        g.beginPath()
        g.moveTo(0, y)
        g.quadraticCurveTo(state.width / 2, y + sag * 3, state.width, y + sag)
        g.stroke()

        // Hash ticks midway to the next line.
        g.strokeStyle = `rgba(255,255,255,${HASH_ALPHA})`
        const hy = y + YARD_GAP / 2
        if (hy < state.height) {
          for (let x = HASH_GAP / 2; x < state.width; x += HASH_GAP) {
            g.beginPath()
            g.moveTo(x, hy - 3)
            g.lineTo(x + (Math.random() - 0.5), hy + 3)
            g.stroke()
          }
        }
      }
      state.grid = off
    }

    const layout = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      state.width = w
      state.height = h
      canvas.width = Math.floor(w * state.dpr)
      canvas.height = Math.floor(h * state.dpr)
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)
      buildGrid()
    }

    const drawMark = (p: Point, kind: 'o' | 'x') => {
      ctx.beginPath()
      if (kind === 'o') {
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2)
      } else {
        ctx.moveTo(p.x - 5, p.y - 5)
        ctx.lineTo(p.x + 5, p.y + 5)
        ctx.moveTo(p.x + 5, p.y - 5)
        ctx.lineTo(p.x - 5, p.y + 5)
      }
      ctx.stroke()
    }

    const drawRoute = (play: Play, progress: number) => {
      ctx.save()
      ctx.lineWidth = 1.75
      ctx.strokeStyle = state.route
      ctx.setLineDash([play.routeLength])
      ctx.lineDashOffset = play.routeLength * (1 - progress)
      ctx.beginPath()
      ctx.moveTo(play.route[0].x, play.route[0].y)
      for (let i = 1; i < play.route.length; i++) {
        ctx.lineTo(play.route[i].x, play.route[i].y)
      }
      ctx.stroke()
      ctx.setLineDash([])

      if (progress >= 0.98) {
        const tip = play.route[play.route.length - 1]
        const prev = play.route[play.route.length - 2]
        const angle = Math.atan2(tip.y - prev.y, tip.x - prev.x)
        ctx.beginPath()
        ctx.moveTo(tip.x, tip.y)
        ctx.lineTo(tip.x - 8 * Math.cos(angle - 0.45), tip.y - 8 * Math.sin(angle - 0.45))
        ctx.moveTo(tip.x, tip.y)
        ctx.lineTo(tip.x - 8 * Math.cos(angle + 0.45), tip.y - 8 * Math.sin(angle + 0.45))
        ctx.stroke()
      }
      ctx.restore()
    }

    /** Frame alpha and route progress for a play `age` ms old, or null when done. */
    const phase = (age: number): { alpha: number; progress: number } | null => {
      if (age < FADE_IN) return { alpha: age / FADE_IN, progress: 0 }
      if (age < FADE_IN + DRAW) return { alpha: 1, progress: (age - FADE_IN) / DRAW }
      if (age < FADE_IN + DRAW + HOLD) return { alpha: 1, progress: 1 }
      const out = age - FADE_IN - DRAW - HOLD
      if (out < FADE_OUT) return { alpha: 1 - out / FADE_OUT, progress: 1 }
      return null
    }

    const drawFrame = (now: number, still = false) => {
      ctx.clearRect(0, 0, state.width, state.height)
      if (state.grid) {
        ctx.drawImage(state.grid, 0, 0, state.width, state.height)
      }
      const play = state.play
      if (!play) return
      const p = still
        ? { alpha: 1, progress: 1 }
        : phase(now - play.born)
      if (!p) {
        state.play = null
        state.restUntil = now + REST_MIN + Math.random() * REST_RANGE
        return
      }
      ctx.lineWidth = 1.5
      ctx.globalAlpha = p.alpha
      ctx.strokeStyle = `rgba(255,255,255,${PLAY_ALPHA})`
      play.os.forEach((o) => drawMark(o, 'o'))
      play.xs.forEach((x) => drawMark(x, 'x'))
      ctx.globalAlpha = p.alpha * ROUTE_ALPHA
      if (p.progress > 0) drawRoute(play, Math.min(p.progress, 1))
      ctx.globalAlpha = 1
    }

    const loop = (now: number) => {
      if (!state.play && now >= state.restUntil) {
        state.play = makePlay(state.width, state.height, now)
      }
      drawFrame(now)
      state.rafId = requestAnimationFrame(loop)
    }

    const start = () => {
      if (state.running || state.reducedMotion) return
      state.running = true
      state.rafId = requestAnimationFrame(loop)
    }
    const stop = () => {
      state.running = false
      cancelAnimationFrame(state.rafId)
    }

    const drawStill = () => {
      state.play = makePlay(state.width, state.height, 0)
      drawFrame(0, true)
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
    state.restUntil = performance.now() + 1200
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
