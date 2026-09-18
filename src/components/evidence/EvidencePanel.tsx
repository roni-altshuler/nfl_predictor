import Link from 'next/link'

import { getMarketBenchmark } from '@/lib/artifacts'
import { pct, signed } from '@/lib/format'

/**
 * The record, in four numbers, wherever a forecast is being shown.
 *
 * Ported from the NBA sibling: the page that asks a reader to trust a
 * probability also shows them the scoreboard it is graded on, one link away
 * from the full accounting. Reads the published benchmark artifact — if it
 * is missing the panel renders nothing rather than a placeholder claim.
 */
export function EvidencePanel() {
  const benchmark = getMarketBenchmark()
  if (!benchmark) return null

  const model = benchmark.scorecards.margin_model
  const market = benchmark.scorecards.market
  const paired = benchmark.paired_vs_market?.margin_model
  if (!model || !market) return null

  return (
    <section aria-label="The record" className="card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="eyebrow">The record</h2>
        <Link
          href="/accuracy"
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent-info)] hover:underline"
        >
          full accounting
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="eyebrow">Games scored</dt>
          <dd className="numeric mt-1 text-sm text-[var(--text-primary)]">
            {benchmark.scored_games.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Model Brier</dt>
          <dd className="numeric mt-1 text-sm text-[var(--text-primary)]">
            {model.brier.toFixed(4)}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Market Brier</dt>
          <dd className="numeric mt-1 text-sm text-[var(--accent-market)]">
            {market.brier.toFixed(4)}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Paired market gap</dt>
          <dd className="numeric mt-1 text-sm text-[var(--text-primary)]">
            {paired ? signed(paired.mean, 4) : '—'}
          </dd>
        </div>
      </dl>
      <p className="mt-3 border-t border-[var(--border-color)] pt-3 font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        Walk-forward on {benchmark.scored_games.toLocaleString()} games,
        accuracy {pct(model.accuracy, 1)}. Model and market scorecards cover
        different samples; the gap uses paired games. Historical retained
        prices have no verified closing timestamp.
      </p>
    </section>
  )
}
