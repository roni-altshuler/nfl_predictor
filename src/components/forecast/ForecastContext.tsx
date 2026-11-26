'use client'

import { useEffect, useState } from 'react'
import { forecastStamp } from '@/lib/format'

/** Source detail is optional; stale and withholding notices always stay visible. */
export function ForecastContext({
  publishedAt,
  resultsThrough,
  asOf,
  withheld,
  compact = false,
  modelVersion,
  description = 'Published pre-game probabilities, not a live schedule. Open a matchup for the outlook and evidence.',
}: {
  publishedAt: string
  resultsThrough: string | null | undefined
  asOf: string
  withheld: number
  compact?: boolean
  modelVersion?: string
  description?: string
}) {
  const [now, setNow] = useState(Date.parse(asOf))
  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const timer = window.setInterval(tick, 30000)
    return () => window.clearInterval(timer)
  }, [])
  const stale = now - Date.parse(publishedAt) > 48 * 3600000
  const provenance = <>
    <dl className="grid gap-2 sm:grid-cols-2">
      <div>
        <dt className="text-[var(--text-tertiary)]">Forecast published</dt>
        <dd className="mt-1 font-mono">{forecastStamp(publishedAt)}</dd>
      </div>
      <div>
        <dt className="text-[var(--text-tertiary)]">Results used through</dt>
        <dd className="mt-1 font-mono">{forecastStamp(resultsThrough)}</dd>
      </div>
    </dl>
    {modelVersion ? <p className="mt-2 font-mono text-[var(--text-tertiary)]">Model {modelVersion}</p> : null}
    <p className="mt-2 text-[var(--text-secondary)]">{description}</p>
  </>

  return (
    <section aria-label="Forecast source" className="mt-3 space-y-2 text-xs">
      {compact ? <details>
        <summary className="min-h-[44px] cursor-pointer py-3 font-mono text-[11px] text-[var(--accent-info)]">Pre-game forecast · source &amp; dates</summary>
        <div className="pb-3">{provenance}</div>
      </details> : provenance}
      {stale ? <p className="lab-notice">Forecasts are more than 48 hours old. Check their publication date before using them.</p> : null}
      {withheld > 0 ? <p className="lab-notice">Forecast Lab: {withheld} invalid or duplicate forecasts withheld.</p> : null}
    </section>
  )
}
