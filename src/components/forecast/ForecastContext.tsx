'use client'

import { useEffect, useState } from 'react'
import { forecastStamp } from '@/lib/format'

/** Publication context stays visible when the optional forecast tools are closed. */
export function ForecastContext({
  publishedAt,
  resultsThrough,
  asOf,
  withheld,
}: {
  publishedAt: string
  resultsThrough: string | null | undefined
  asOf: string
  withheld: number
}) {
  const [now, setNow] = useState(Date.parse(asOf))
  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const timer = window.setInterval(tick, 30000)
    return () => window.clearInterval(timer)
  }, [])
  const stale = now - Date.parse(publishedAt) > 48 * 3600000

  return (
    <section aria-label="Forecast source" className="mt-3 space-y-2 text-xs">
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
      <p className="text-[var(--text-secondary)]">
        Published pre-game probabilities, not a live schedule. Open a matchup for the outlook and evidence.
      </p>
      {stale ? <p className="lab-notice">Forecasts are more than 48 hours old. Check their publication date before using them.</p> : null}
      {withheld > 0 ? <p className="lab-notice">Forecast Lab: {withheld} invalid or duplicate forecasts withheld.</p> : null}
    </section>
  )
}
