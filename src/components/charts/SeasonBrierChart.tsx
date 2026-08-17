import type { SeasonScore } from '@/lib/artifacts'

/**
 * Brier by season, model against market.
 *
 * **A headline Brier is an average over twenty-one seasons and hides whether
 * the record is one steady result or a few very different years.** This is
 * the chart that answers it, and the answer here is visible at a glance: the
 * two lines move together, season to season, by far more than they differ
 * from each other. Football is noisier in some years than others and both
 * forecasters feel it identically — which is the strongest available evidence
 * that the gap between them is a property of the model rather than of the
 * schedule.
 *
 * Design decisions:
 *
 * - **Form**: a quantity over ordered time, two series → lines. Lower is
 *   better on this axis, which is unusual enough that the axis says so.
 * - **Colour by job**: two categorical entities — `--viz-model` /
 *   `--viz-market`, the validated pair (worst all-pairs ΔE 24.2 protan, 24.9
 *   normal). Tritan is 5.7, below the floor, so both lines are direct-
 *   labelled at their right edge as well as legended.
 * - **The market line stops where the market does.** Nothing was priced
 *   before ~2011 in this corpus, and drawing a market line through those
 *   seasons — at zero, or interpolated across the gap — would invent a
 *   benchmark that did not exist. The gap is drawn as a gap.
 */

const W = 640
const H = 240
const PAD = { top: 16, right: 60, bottom: 34, left: 46 }

interface Point {
  season: number
  model: number | null
  market: number | null
}

export function SeasonBrierChart({
  bySeason,
}: {
  bySeason: Record<string, SeasonScore>
}) {
  const points: Point[] = Object.entries(bySeason ?? {})
    .map(([season, score]) => ({
      season: Number(season),
      model: score.model_brier,
      market: score.market_brier,
    }))
    .sort((a, b) => a.season - b.season)

  if (points.length < 2) {
    return (
      <p className="text-xs text-[var(--text-tertiary)]">
        Not enough seasons scored to draw a trend.
      </p>
    )
  }

  const values = points.flatMap((p) =>
    [p.model, p.market].filter((v): v is number => v != null),
  )
  const lo = Math.min(...values) - 0.008
  const hi = Math.max(...values) + 0.008

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH

  const series = [
    { key: 'model', label: 'Margin model', color: 'var(--viz-model)' },
    { key: 'market', label: 'Closing line', color: 'var(--viz-market)' },
  ] as const

  // Segments rather than one path, so an unpriced season leaves a genuine
  // hole instead of a straight line drawn across it.
  const segmentsFor = (key: 'model' | 'market') => {
    const out: string[][] = []
    let run: string[] = []
    points.forEach((p, i) => {
      const value = p[key]
      if (value == null) {
        if (run.length > 1) out.push(run)
        run = []
        return
      }
      run.push(`${x(i)},${y(value)}`)
    })
    if (run.length > 1) out.push(run)
    return out
  }

  const lastOf = (key: 'model' | 'market') => {
    for (let i = points.length - 1; i >= 0; i -= 1) {
      if (points[i][key] != null) return { index: i, value: points[i][key] as number }
    }
    return null
  }

  const ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v * 1000) / 1000)

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
        {series.map((s) => (
          <span
            key={s.key}
            className="inline-flex items-center gap-2 text-[var(--text-secondary)]"
          >
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4"
              style={{ background: s.color }}
            />
            {s.label}
          </span>
        ))}
        <span className="text-[var(--text-tertiary)]">lower is better</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-[720px]"
        role="img"
        aria-label={`Brier score by season, lower is better. ${points
          .map(
            (p) =>
              `${p.season}: model ${p.model?.toFixed(4) ?? 'not scored'}${
                p.market != null ? `, market ${p.market.toFixed(4)}` : ', no market'
              }.`,
          )
          .join(' ')}`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left} y1={y(t)} x2={PAD.left + plotW} y2={y(t)}
              stroke="var(--viz-grid)" strokeWidth="1"
            />
            <text
              x={PAD.left - 6} y={y(t) + 3}
              fill="var(--text-tertiary)" fontSize="9" textAnchor="end"
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {t.toFixed(3)}
            </text>
          </g>
        ))}

        {series.map((s) => (
          <g key={s.key}>
            {segmentsFor(s.key).map((segment, i) => (
              <path
                key={i}
                d={`M${segment.join('L')}`}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
              />
            ))}
            {points.map((p, i) => {
              const value = p[s.key]
              if (value == null) return null
              return (
                <circle key={i} cx={x(i)} cy={y(value)} r="6" fill="transparent">
                  <title>
                    {`${s.label} · ${p.season} · Brier ${value.toFixed(4)}`}
                  </title>
                </circle>
              )
            })}
            {(() => {
              const last = lastOf(s.key)
              if (!last) return null
              return (
                <text
                  x={x(last.index) + 7}
                  y={y(last.value) + 3}
                  fill="var(--text-primary)"
                  fontSize="10"
                  fontFamily="var(--font-mono-numeric), monospace"
                >
                  {last.value.toFixed(3)}
                </text>
              )
            })()}
          </g>
        ))}

        <line
          x1={PAD.left} y1={PAD.top + plotH} x2={PAD.left + plotW} y2={PAD.top + plotH}
          stroke="var(--viz-axis)" strokeWidth="1"
        />
        {points.map((p, i) =>
          i % Math.ceil(points.length / 8) === 0 ? (
            <text
              key={p.season}
              x={x(i)} y={PAD.top + plotH + 16}
              fill="var(--text-tertiary)" fontSize="10" textAnchor="middle"
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {String(p.season).slice(2)}
            </text>
          ) : null,
        )}
      </svg>

      <figcaption className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        Each point is one season scored on its own. The market line begins
        where the corpus first carries prices — nothing was published before
        about 2011, and a line drawn across that gap would invent a benchmark
        that did not exist.
      </figcaption>

      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-[var(--accent-info)]">
          Table view
        </summary>
        <div className="card mt-2 overflow-x-auto">
          <table className="min-w-[460px]">
            <thead>
              <tr>
                <th scope="col">Season</th>
                <th scope="col" className="numeric text-right">Games</th>
                <th scope="col" className="numeric text-right">Model</th>
                <th scope="col" className="numeric text-right">Elo</th>
                <th scope="col" className="numeric text-right">Market</th>
                <th scope="col" className="numeric text-right">Gap (paired)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(bySeason)
                .sort((a, b) => Number(b[0]) - Number(a[0]))
                .map(([season, score]) => (
                  <tr key={season}>
                    <td className="numeric">{season}</td>
                    <td className="numeric text-right text-[var(--text-tertiary)]">
                      {score.n}
                    </td>
                    <td className="numeric text-right">
                      {score.model_brier?.toFixed(4) ?? '—'}
                    </td>
                    <td className="numeric text-right text-[var(--text-secondary)]">
                      {score.elo_brier?.toFixed(4) ?? '—'}
                    </td>
                    <td className="numeric text-right text-[var(--accent-market)]">
                      {score.market_brier?.toFixed(4) ?? '—'}
                    </td>
                    <td className="numeric text-right">
                      {score.gap_to_market == null
                        ? '—'
                        : `${score.gap_to_market > 0 ? '+' : ''}${score.gap_to_market.toFixed(4)}`}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
          The gap column is computed on the PAIRED subset — the priced games
          only — never by subtracting the model and market columns beside it.
          Those two are measured on different game sets, and in a season where
          the unpriced games happened to be lopsided their difference is
          mostly a fact about coverage.
        </p>
      </details>
    </figure>
  )
}
