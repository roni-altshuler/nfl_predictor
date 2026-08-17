import type { ReliabilityBucket } from '@/lib/artifacts'
import { pct } from '@/lib/format'

/**
 * A reliability diagram: what the forecaster said against what happened.
 *
 * **This is the most important chart in the product.** Accuracy is a fact
 * about the schedule as much as about the model — a season of blowouts is
 * easy to call. Calibration is a fact about the model alone. A forecaster
 * that says 70% and is right 70% of the time is useful at modest accuracy,
 * and one that says 70% and is right 55% of the time is dangerous at any
 * accuracy.
 *
 * Design decisions, in the order the dataviz procedure takes them:
 *
 * - **Form**: paired quantities against an ideal → dots on a diagonal. The
 *   "series vs baseline" job, so the diagonal is a de-emphasised reference
 *   and the data carries the only accent.
 * - **Dot AREA encodes sample size.** A bucket holding 26 games and one
 *   holding 1,362 are not the same evidence, and drawing them identically is
 *   the chart lying. Capped at 10px: uncapped, the middle buckets drew discs
 *   that covered the reference line they exist to be compared against.
 * - **Colour by job**: at most two series here, each a categorical entity
 *   (this model, the market) — `--viz-model` / `--viz-market`, the validated
 *   pair. Their tritan separation is ΔE 5.7, so the legend is always present
 *   and both series carry a distinct dot shape as a second channel.
 * - **Text wears text tokens.** Axis labels and values are ink.
 *
 * **Empty buckets are absent, not zero.** The pipeline drops a bucket holding
 * no games; a 0% observed rate drawn on the floor would read as catastrophic
 * miscalibration and is actually an absence of evidence. This model never
 * says 5%, so the leftmost bucket simply is not there.
 */

const W = 460
const H = 300
const PAD = { top: 16, right: 16, bottom: 42, left: 48 }

export interface Series {
  key: string
  label: string
  color: string
  buckets: ReliabilityBucket[]
  /** Second encoding channel, because tritan separation is below the floor. */
  shape: 'circle' | 'square'
}

export function CalibrationChart({
  series,
  caption,
}: {
  series: Series[]
  caption?: string
}) {
  const live = series.filter((s) => s.buckets?.length)
  if (!live.length) {
    return (
      <p className="text-xs text-[var(--text-tertiary)]">
        No calibration data published.
      </p>
    )
  }

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (v: number) => PAD.left + v * plotW
  const y = (v: number) => PAD.top + (1 - v) * plotH

  const maxCount = Math.max(...live.flatMap((s) => s.buckets.map((b) => b.count)), 1)
  const radius = (count: number) =>
    Math.max(3, Math.min(10, 3 + 7 * Math.sqrt(count / maxCount)))

  const ticks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <figure className="m-0">
      {live.length > 1 ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
          {live.map((s) => (
            <span
              key={s.key}
              className="inline-flex items-center gap-2 text-[var(--text-secondary)]"
            >
              <span
                aria-hidden="true"
                className={
                  s.shape === 'circle'
                    ? 'inline-block h-2.5 w-2.5 rounded-full'
                    : 'inline-block h-2.5 w-2.5 rounded-[1px]'
                }
                style={{ background: s.color }}
              />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}

      {/* Capped width so the SVG renders near its natural size. Left to fill a
          1100px container the 460-wide viewBox scales 2.4x and every dot,
          label and stroke scales with it — the chart stops looking designed
          and starts looking zoomed. */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-[560px]"
        role="img"
        aria-label={
          'Reliability diagram. ' +
          live
            .map(
              (s) =>
                `${s.label}: ` +
                s.buckets
                  .map(
                    (b) =>
                      `said ${pct(b.mean_predicted, 0)}, happened ${pct(b.observed, 0)} over ${b.count} games`,
                  )
                  .join('; '),
            )
            .join('. ')
        }
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={x(t)} y1={PAD.top} x2={x(t)} y2={PAD.top + plotH}
              stroke="var(--viz-grid)" strokeWidth="1"
            />
            <line
              x1={PAD.left} y1={y(t)} x2={PAD.left + plotW} y2={y(t)}
              stroke="var(--viz-grid)" strokeWidth="1"
            />
          </g>
        ))}

        {/* The ideal. Dashed and de-emphasised: it is the reference, not a
            series, and an accent here would make it compete with the data. */}
        <line
          x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)}
          stroke="var(--viz-reference)" strokeWidth="2" strokeDasharray="4 4"
        />
        <text
          x={x(0.14)} y={y(0.21)}
          fill="var(--text-tertiary)" fontSize="9"
          fontFamily="var(--font-mono-numeric), monospace"
          transform={`rotate(-45 ${x(0.14)} ${y(0.21)})`}
        >
          perfect calibration
        </text>

        <line
          x1={PAD.left} y1={PAD.top + plotH} x2={PAD.left + plotW} y2={PAD.top + plotH}
          stroke="var(--viz-axis)" strokeWidth="1"
        />
        <line
          x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + plotH}
          stroke="var(--viz-axis)" strokeWidth="1"
        />
        {ticks.map((t) => (
          <g key={`lbl-${t}`}>
            <text
              x={x(t)} y={PAD.top + plotH + 16}
              fill="var(--text-tertiary)" fontSize="10" textAnchor="middle"
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {Math.round(t * 100)}%
            </text>
            <text
              x={PAD.left - 8} y={y(t) + 3}
              fill="var(--text-tertiary)" fontSize="10" textAnchor="end"
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}

        {live.map((s) => (
          <g key={s.key}>
            {/* Connected so the SHAPE of a miscalibration is legible — a
                consistent bow reads differently from scatter. */}
            <polyline
              points={s.buckets
                .map((b) => `${x(b.mean_predicted)},${y(b.observed)}`)
                .join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeOpacity="0.45"
            />
            {s.buckets.map((b, i) =>
              s.shape === 'circle' ? (
                <circle
                  key={i}
                  cx={x(b.mean_predicted)}
                  cy={y(b.observed)}
                  r={radius(b.count)}
                  fill={s.color}
                  fillOpacity="0.75"
                  // A 2px surface ring so overlapping dots stay countable.
                  stroke="var(--viz-surface)"
                  strokeWidth="2"
                >
                  <title>
                    {`${s.label} — said ${pct(b.mean_predicted, 1)}, happened ${pct(b.observed, 1)} over ${b.count.toLocaleString()} games`}
                  </title>
                </circle>
              ) : (
                <rect
                  key={i}
                  x={x(b.mean_predicted) - radius(b.count)}
                  y={y(b.observed) - radius(b.count)}
                  width={radius(b.count) * 2}
                  height={radius(b.count) * 2}
                  rx="1"
                  fill={s.color}
                  fillOpacity="0.75"
                  stroke="var(--viz-surface)"
                  strokeWidth="2"
                >
                  <title>
                    {`${s.label} — said ${pct(b.mean_predicted, 1)}, happened ${pct(b.observed, 1)} over ${b.count.toLocaleString()} games`}
                  </title>
                </rect>
              ),
            )}
          </g>
        ))}

        <text
          x={PAD.left + plotW / 2} y={H - 6}
          fill="var(--text-tertiary)" fontSize="10" textAnchor="middle"
          fontFamily="var(--font-mono-numeric), monospace"
        >
          what it said
        </text>
        <text
          x={12} y={PAD.top + plotH / 2}
          fill="var(--text-tertiary)" fontSize="10" textAnchor="middle"
          fontFamily="var(--font-mono-numeric), monospace"
          transform={`rotate(-90 12 ${PAD.top + plotH / 2})`}
        >
          what happened
        </text>
      </svg>

      <figcaption className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        {caption ??
          'Dot area is the number of games in the bucket. Above the dashed line means it was too cautious; below it, too confident.'}
      </figcaption>

      {/* The table view. Required, not a nicety: it is what makes the chart
          readable without colour, without vision, and in print. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-[var(--accent-info)]">
          Table view
        </summary>
        <div className="card mt-2 overflow-x-auto">
          <table className="min-w-[420px]">
            <thead>
              <tr>
                <th scope="col">Forecaster</th>
                <th scope="col" className="numeric text-right">Said</th>
                <th scope="col" className="numeric text-right">Happened</th>
                <th scope="col" className="numeric text-right">Games</th>
                <th scope="col" className="numeric text-right">Gap</th>
              </tr>
            </thead>
            <tbody>
              {live.flatMap((s) =>
                s.buckets.map((b, i) => (
                  <tr key={`${s.key}-${i}`}>
                    <td className="text-[var(--text-tertiary)]">
                      {i === 0 ? s.label : ''}
                    </td>
                    <td className="numeric text-right">{pct(b.mean_predicted, 1)}</td>
                    <td className="numeric text-right">{pct(b.observed, 1)}</td>
                    <td className="numeric text-right text-[var(--text-tertiary)]">
                      {b.count.toLocaleString()}
                    </td>
                    <td className="numeric text-right">
                      {pct(b.observed - b.mean_predicted, 1)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
