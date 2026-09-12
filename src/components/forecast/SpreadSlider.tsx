'use client'

import { useId, useState } from 'react'

import type { SpreadRow } from '@/lib/artifacts'
import { pct, spread } from '@/lib/format'

/**
 * The spread surface as a slider.
 *
 * **A lookup over published rows, never a computation.** The pipeline
 * publishes cover / push / against at every line it prices; this control
 * only chooses which row to show. The range input runs over row INDICES
 * because the published lines are irregular (−14, −10, −7, −6 …) — the
 * key numbers are dense and the tails are sparse, and a slider over points
 * would spend most of its travel on lines nobody trades.
 *
 * The market line is marked with a tick and the slider starts there, so
 * the first thing shown is the number actually being traded. With no line
 * published it starts at the pick'em row, and no market tick is drawn —
 * absent renders as absent.
 *
 * Colour: `--viz-cat-1` home, `--viz-reference` push, `--viz-cat-2` away —
 * the same validated pair the probability bar and the margin lattice use,
 * with a 2px surface gap between segments. Every value is text beside its
 * swatch; the bar is the glance.
 */
export function SpreadSlider({
  rows,
  home,
  away,
  marketLine,
}: {
  rows: SpreadRow[]
  home: string
  away: string
  marketLine: number | null
}) {
  const id = useId()
  const n = rows.length
  const marketIndex =
    marketLine === null ? -1 : rows.findIndex((r) => r.line === marketLine)
  const pickem = rows.reduce(
    (best, row, index) =>
      Math.abs(row.line) < Math.abs(rows[best].line) ? index : best,
    0,
  )
  const [index, setIndex] = useState(marketIndex >= 0 ? marketIndex : pickem)
  const row = rows[index]
  if (!row) return null

  const isMarket = index === marketIndex
  const frac = (i: number) => (n > 1 ? i / (n - 1) : 0)
  const noPush = row.push < 0.0005
  const summary = `${home} ${spread(row.line)}${isMarket ? ' (the market line)' : ''}: ${home} covers ${pct(row.home_cover)}, push ${noPush ? 'none' : pct(row.push)}, ${away} covers ${pct(row.away_cover)}`

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <label htmlFor={`${id}-range`} className="eyebrow">
          {home} line
        </label>
        <p className="flex items-baseline gap-2">
          <output
            htmlFor={`${id}-range`}
            className="numeric text-2xl text-[var(--text-primary)]"
          >
            {spread(row.line)}
          </output>
          {isMarket ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--accent-market)]">
              market
            </span>
          ) : null}
        </p>
      </div>

      <div className="relative mt-1">
        <input
          id={`${id}-range`}
          type="range"
          className="spread-range"
          min={0}
          max={n - 1}
          step={1}
          value={index}
          list={`${id}-ticks`}
          onChange={(event) => setIndex(Number(event.target.value))}
          aria-valuetext={summary}
          aria-describedby={`${id}-readout`}
        />
        <datalist id={`${id}-ticks`}>
          {rows.map((r, i) => (
            <option key={r.line} value={i} label={spread(r.line)} />
          ))}
        </datalist>
        {marketIndex >= 0 ? (
          // The thumb is 16px wide, so its centre travels from 8px to
          // (width − 8px): the tick uses the same arithmetic.
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-[12px] flex -translate-x-1/2 flex-col items-center"
            style={{ left: `calc(8px + (100% - 16px) * ${frac(marketIndex)})` }}
          >
            <span className="block h-5 w-px bg-[var(--accent-market)]" />
            <span className="mt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--accent-market)]">
              market {spread(marketLine)}
            </span>
          </span>
        ) : null}
        <div className="flex justify-between font-mono text-[10px] text-[var(--text-tertiary)]">
          <span>{spread(rows[0].line)}</span>
          <span>{spread(rows[n - 1].line)}</span>
        </div>
      </div>

      <div
        className="mt-5 flex h-2 gap-[2px]"
        role="img"
        aria-label={summary}
      >
        <span
          className="prob-segment block"
          style={{
            width: `${row.home_cover * 100}%`,
            background: 'var(--viz-cat-1)',
          }}
        />
        {noPush ? null : (
          <span
            className="prob-segment block"
            style={{
              width: `${row.push * 100}%`,
              background: 'var(--viz-reference)',
            }}
          />
        )}
        <span
          className="prob-segment block"
          style={{
            width: `${row.away_cover * 100}%`,
            background: 'var(--viz-cat-2)',
          }}
        />
      </div>

      <dl
        id={`${id}-readout`}
        className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px]"
      >
        <div className="flex items-baseline gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 shrink-0 rounded-[1px]"
            style={{ background: 'var(--viz-cat-1)' }}
          />
          <span>
            <dt className="text-[var(--text-tertiary)]">{home} covers</dt>
            <dd className="numeric text-sm text-[var(--text-primary)]">
              {pct(row.home_cover)}
            </dd>
          </span>
        </div>
        <div className="flex items-baseline justify-center gap-1.5 text-center">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 shrink-0 rounded-[1px]"
            style={{ background: 'var(--viz-reference)' }}
          />
          <span>
            <dt className="text-[var(--text-tertiary)]">push</dt>
            <dd
              className={
                row.push >= 0.04
                  ? 'numeric text-sm text-[var(--accent-warn)]'
                  : 'numeric text-sm text-[var(--text-secondary)]'
              }
            >
              {noPush ? '—' : pct(row.push)}
            </dd>
          </span>
        </div>
        <div className="flex items-baseline justify-end gap-1.5 text-right">
          <span>
            <dt className="text-[var(--text-tertiary)]">{away} covers</dt>
            <dd className="numeric text-sm text-[var(--text-primary)]">
              {pct(row.away_cover)}
            </dd>
          </span>
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 shrink-0 rounded-[1px]"
            style={{ background: 'var(--viz-cat-2)' }}
          />
        </div>
      </dl>
    </div>
  )
}
