import type { PitBlock } from '@/lib/artifacts'

/**
 * The probability integral transform, against its uniform expectation.
 *
 * **This is the calibration chart for a DISTRIBUTION rather than for a
 * probability.** The reliability diagram tests whether "70%" means 70%. This
 * tests whether the whole published margin lattice — the object every win
 * probability, every cover probability and every playoff price on this site
 * is a sum over — has the right shape and the right width.
 *
 * Read it as: each bar is the share of games whose result landed in that
 * decile of the model's own published distribution. Flat is right. Heavy at
 * both ends means the distribution is too narrow, and because the win
 * probability is read off that same distribution, that would make *every
 * percentage on this site* overconfident. Heavy in the middle means too wide.
 * A tilt means bias.
 *
 * **The margin transform is mid-P, because the margin distribution is
 * discrete.** An ordinary `F(y)` on a lattice can only take as many values as
 * the lattice has cells, so its histogram is spiky however good the forecast
 * is — the correction is what makes this test apply at all.
 *
 * One series, so no legend: the title names it. The uniform expectation is a
 * recessive reference line rather than a second colour.
 */

const W = 460
const H = 190
const PAD = { top: 14, right: 14, bottom: 30, left: 42 }
/* 2px of surface between adjacent fills, per the mark spec. */
const GAP = 2

export function PitHistogram({
  pit,
  label,
}: {
  pit: PitBlock
  label: string
}) {
  const buckets = pit?.buckets ?? []
  if (!buckets.length) {
    return (
      <p className="text-xs text-[var(--text-tertiary)]">
        No PIT histogram published.
      </p>
    )
  }

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const expected = buckets[0].expected
  // Scaled to the taller of the biggest bar and twice the expectation, so a
  // near-perfect histogram is not magnified into looking dramatic.
  const max = Math.max(...buckets.map((b) => b.share), expected * 2)
  const barW = plotW / buckets.length
  const uniformY = PAD.top + plotH - (expected / max) * plotH

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-[560px]"
        role="img"
        aria-label={`Probability integral transform for ${label}. Flat bars mean the published distribution is the right shape. Shares: ${buckets
          .map((b) => `${(b.share * 100).toFixed(1)}%`)
          .join(', ')}.`}
      >
        {[0, 0.5, 1].map((t) => (
          <text
            key={t}
            x={PAD.left - 6}
            y={PAD.top + plotH - t * plotH + 3}
            fill="var(--text-tertiary)"
            fontSize="9"
            textAnchor="end"
            fontFamily="var(--font-mono-numeric), monospace"
          >
            {(t * max * 100).toFixed(0)}%
          </text>
        ))}

        {buckets.map((bucket, i) => {
          const height = (bucket.share / max) * plotH
          return (
            <rect
              key={bucket.lower}
              x={PAD.left + i * barW + GAP / 2}
              y={PAD.top + plotH - height}
              width={Math.max(barW - GAP, 1)}
              height={Math.max(height, 0)}
              rx="2"
              fill="var(--viz-model)"
            >
              <title>
                {`decile ${i + 1} — ${(bucket.share * 100).toFixed(1)}% of games (${bucket.count.toLocaleString()}), expected ${(bucket.expected * 100).toFixed(0)}%`}
              </title>
            </rect>
          )
        })}

        {/* Uniform. The whole test is whether the bars sit on this line. */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={uniformY}
          y2={uniformY}
          stroke="var(--text-tertiary)"
          strokeWidth="1"
          strokeDasharray="4 3"
        />
        <text
          x={W - PAD.right}
          y={uniformY - 5}
          textAnchor="end"
          fill="var(--text-tertiary)"
          fontSize="9"
          fontFamily="var(--font-mono-numeric), monospace"
        >
          uniform
        </text>

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke="var(--viz-axis)"
          strokeWidth="1"
        />
        {['below the model', 'model median', 'above the model'].map((text, i) => (
          <text
            key={text}
            x={PAD.left + (i / 2) * plotW}
            y={H - 10}
            textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
            fill="var(--text-tertiary)"
            fontSize="9"
            fontFamily="var(--font-mono-numeric), monospace"
          >
            {text}
          </text>
        ))}
      </svg>

      <figcaption className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        Where the real {label} fell inside the model&rsquo;s own published
        distribution, in deciles. Flat is correct.
        {pit.chi_square_per_dof != null ? (
          <>
            {' '}
            Chi-square per degree of freedom is{' '}
            <span className="numeric text-[var(--text-secondary)]">
              {pit.chi_square_per_dof.toFixed(2)}
            </span>
            , and <strong className="text-[var(--text-secondary)]">no p-value
            is reported</strong> — at {pit.n.toLocaleString()} games any real
            model fails a goodness-of-fit test on some decimal place, so
            &ldquo;p &lt; .001&rdquo; beside a visibly flat histogram would be
            true and completely misleading.
          </>
        ) : null}
      </figcaption>
    </figure>
  )
}
