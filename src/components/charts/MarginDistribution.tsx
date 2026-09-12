'use client'

import { useId, useState } from 'react'

import { pct } from '@/lib/format'

/**
 * The published margin lattice, drawn.
 *
 * **This is the one chart in the product that shows the thing the model
 * knows and a normal distribution does not**: football margins are not
 * smooth. Roughly one game in seven ends by exactly three points and one in
 * eleven by exactly seven, while nine-point margins are rarer than either by
 * a factor of six. A line or an area chart would interpolate straight
 * through that structure and draw a tidy bell — which is precisely the wrong
 * picture. Bars, on the integer lattice, are the form.
 *
 * Design decisions, in the order the dataviz procedure takes them:
 *
 * - **Form**: magnitude over a discrete ordered axis → column chart. Not a
 *   line: the discreteness IS the finding.
 * - **Colour by job**: two categorical slots carrying ENTITY identity (which
 *   team wins), not rank — `--viz-cat-1` / `--viz-cat-2`, the design
 *   system's validated team pair. The tie column is `--viz-reference`,
 *   a neutral, because a tie belongs to neither team and giving it a third
 *   hue would imply a third entity.
 * - **Validated, not eyeballed**: the pair passes all six checks against the
 *   `#0d0d0d` chart surface (lightness band, chroma floor, protan ΔE 24.2,
 *   normal-vision ΔE 24.9, contrast ≥ 3:1). Tritan separation is 5.7, which
 *   is legal ONLY with secondary encoding — so **both sides are direct-
 *   labelled with their team abbreviation**, and that labelling is not
 *   optional styling.
 * - **Text wears text tokens.** The value labels on the key numbers are ink,
 *   never the series colour.
 * - **Hover, tap, or arrow keys read one column** (2026-09-12): the readout
 *   under the chart names the margin, its probability and the published
 *   mass at or beyond it, summed over the drawn lattice. A summation over
 *   published cells is a lookup, not a model — nothing here is inferred.
 *   The hit targets are full-height columns, far wider than the 8px bars.
 *
 * Every number here is read from `margin_distribution`, published by the
 * pipeline. The component computes no probability — it only scales bars
 * and adds published cells together.
 */

export interface MarginDistributionData {
  low: number
  high: number
  p: number[]
  outside: number
}

// The lines football actually trades on, and the ones the lattice has
// something to say about. Labelled directly so a reader gets the finding
// without reading the axis.
const KEY_NUMBERS = new Set([3, 7])

const WIDTH = 580
const HEIGHT = 150
const PAD_TOP = 18
const PAD_BOTTOM = 20

export function MarginDistribution({
  data,
  home,
  away,
}: {
  data: MarginDistributionData
  home: string
  away: string
}) {
  const id = useId()
  const values = data.p
  // The modal margin is the resting readout, so the line under the chart
  // always says something before anyone touches it.
  const modal = values.reduce(
    (best, p, index) => (p > values[best] ? index : best),
    0,
  )
  const [active, setActive] = useState(modal)

  if (!values?.length) return null

  const max = Math.max(...values)
  if (max <= 0) return null

  const slot = WIDTH / values.length
  const barWidth = Math.max(slot - 2, 1) // 2px surface gap between bars
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM

  const x = (index: number) => index * slot
  const zeroIndex = -data.low

  const ticks = [-21, -14, -7, 0, 7, 14, 21].filter(
    (t) => t >= data.low && t <= data.high,
  )

  const activeMargin = data.low + active
  const activeP = values[active] ?? 0
  // Mass at or beyond the active margin on its own side, over the drawn
  // lattice only — `outside` is reported separately below the chart.
  const beyond =
    activeMargin > 0
      ? values.slice(active).reduce((sum, p) => sum + p, 0)
      : activeMargin < 0
        ? values.slice(0, active + 1).reduce((sum, p) => sum + p, 0)
        : activeP
  const side = activeMargin > 0 ? home : away

  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : 0
    if (step) {
      event.preventDefault()
      setActive((i) => Math.min(Math.max(i + step, 0), values.length - 1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(values.length - 1)
    }
  }

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        tabIndex={0}
        aria-label={`Probability of each final margin. ${home} wins to the right of zero, ${away} to the left. Three and seven point margins are the most likely. Use the arrow keys to read one margin at a time.`}
        aria-describedby={`${id}-readout`}
        onKeyDown={onKeyDown}
        onPointerLeave={() => setActive(modal)}
        className="block touch-pan-y"
      >
        {/* Baseline, recessive. */}
        <line
          x1={0}
          y1={HEIGHT - PAD_BOTTOM}
          x2={WIDTH}
          y2={HEIGHT - PAD_BOTTOM}
          stroke="var(--viz-axis)"
          strokeWidth={1}
        />

        {values.map((p, index) => {
          const margin = data.low + index
          const height = Math.max((p / max) * plotHeight, p > 0 ? 1 : 0)
          const fill =
            margin === 0
              ? 'var(--viz-reference)'
              : margin > 0
                ? 'var(--viz-cat-1)'
                : 'var(--viz-cat-2)'
          const key = KEY_NUMBERS.has(Math.abs(margin))
          const isActive = index === active
          return (
            <g key={margin}>
              <rect
                x={x(index)}
                y={HEIGHT - PAD_BOTTOM - height}
                width={barWidth}
                height={height}
                rx={1}
                fill={fill}
                opacity={isActive || key ? 1 : 0.72}
              />
              {/* The hit target: the whole column, so a finger or a
                  pointer lands on a bar without aiming. Also carries the
                  native title for assistive tech and no-script readers. */}
              <rect
                x={x(index)}
                y={0}
                width={slot}
                height={HEIGHT}
                fill="transparent"
                onPointerEnter={() => setActive(index)}
                onPointerDown={() => setActive(index)}
              >
                <title>
                  {margin === 0
                    ? `Tie — ${pct(p, 2)}`
                    : `${margin > 0 ? home : away} by ${Math.abs(margin)} — ${pct(p, 2)}`}
                </title>
              </rect>
              {key ? (
                <text
                  x={x(index) + barWidth / 2}
                  y={HEIGHT - PAD_BOTTOM - height - 5}
                  textAnchor="middle"
                  fill="var(--text-secondary)"
                  fontSize={9}
                  className="numeric pointer-events-none"
                >
                  {Math.abs(margin)}
                </text>
              ) : null}
            </g>
          )
        })}

        {/* Zero, drawn above the bars so the split is unambiguous. */}
        <line
          x1={x(zeroIndex) + barWidth / 2}
          y1={PAD_TOP - 12}
          x2={x(zeroIndex) + barWidth / 2}
          y2={HEIGHT - PAD_BOTTOM}
          stroke="var(--border-hover)"
          strokeWidth={1}
          strokeDasharray="2 2"
          className="pointer-events-none"
        />

        {/* The active column's marker under the axis. */}
        <rect
          x={x(active)}
          y={HEIGHT - PAD_BOTTOM + 1}
          width={barWidth}
          height={3}
          fill="var(--text-primary)"
          className="pointer-events-none"
        />

        {ticks.map((tick) => (
          <text
            key={tick}
            x={x(tick - data.low) + barWidth / 2}
            y={HEIGHT - 6}
            textAnchor="middle"
            fill="var(--text-tertiary)"
            fontSize={9}
            className="numeric pointer-events-none"
          >
            {tick === 0 ? '0' : Math.abs(tick)}
          </text>
        ))}
      </svg>

      {/* Direct labels. REQUIRED, not decorative: the green/blue pair
          separates at tritan ΔE 5.7, which is only legal with a second
          encoding channel. The swatch beside each name is the legend. */}
      <figcaption className="mt-1 flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-[1px]"
            style={{ background: 'var(--viz-cat-2)' }}
          />
          <span className="numeric text-[10px] text-[var(--text-tertiary)]">
            {away} by
          </span>
        </span>
        <span className="numeric text-[10px] text-[var(--text-tertiary)]">
          margin
        </span>
        <span className="flex items-center gap-1.5">
          <span className="numeric text-[10px] text-[var(--text-tertiary)]">
            {home} by
          </span>
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-[1px]"
            style={{ background: 'var(--viz-cat-1)' }}
          />
        </span>
      </figcaption>

      {/* The readout: one column at a time, as text. */}
      <p
        id={`${id}-readout`}
        aria-live="polite"
        className="numeric mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-[var(--border-color)] pt-2 text-[11px] text-[var(--text-secondary)]"
      >
        {activeMargin === 0 ? (
          <span>
            tie{' '}
            <span className="text-[var(--text-primary)]">{pct(activeP, 2)}</span>
          </span>
        ) : (
          <>
            <span>
              {side} by {Math.abs(activeMargin)}{' '}
              <span className="text-[var(--text-primary)]">{pct(activeP, 2)}</span>
            </span>
            <span className="text-[var(--text-tertiary)]">
              by {Math.abs(activeMargin)} or more{' '}
              <span className="text-[var(--text-secondary)]">{pct(beyond, 1)}</span>
            </span>
          </>
        )}
      </p>

      {data.outside > 0.0005 ? (
        <p className="mt-1.5 text-[10px] leading-snug text-[var(--text-tertiary)]">
          {pct(data.outside, 2)} of the distribution lies outside{' '}
          {Math.abs(data.low)} points and is not drawn.
        </p>
      ) : null}
    </figure>
  )
}
