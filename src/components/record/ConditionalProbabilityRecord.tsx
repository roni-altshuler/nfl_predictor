import { getForecastLog } from '@/lib/artifacts'
import { pct, stamp } from '@/lib/format'

export function ConditionalProbabilityRecord() {
  const forecastLog = getForecastLog()
  if (!forecastLog) return <p className="text-sm text-[var(--text-secondary)]">Conditional probability record unavailable.</p>
  return (
      <section id="conditional-record" className="card scroll-mt-20 p-4" aria-label="Conditional binary probability record">
        <h2 className="eyebrow">Conditional binary probability record · {forecastLog.season}</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div><dt className="eyebrow">Decided games</dt><dd className="numeric mt-1 text-xl">{forecastLog.n}</dd></div>
          <div><dt className="eyebrow">Brier</dt><dd className="numeric mt-1 text-xl">{forecastLog.brier?.toFixed(4) ?? '—'}</dd></div>
          <div><dt className="eyebrow">Accuracy</dt><dd className="numeric mt-1 text-xl">{pct(forecastLog.accuracy)}</dd></div>
          <div><dt className="eyebrow">Pending</dt><dd className="numeric mt-1 text-xl">{forecastLog.games_pending}</dd></div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-[var(--text-secondary)]">Home-versus-away scoring conditional on a decided game; actual ties are excluded. This is separate from the three-way outcome record above and retrospective tests below. Published {stamp(forecastLog.generated_at)}.</p>
        {forecastLog.cohorts ? <details className="mt-4"><summary className="cursor-pointer font-mono text-xs">Break down by model and forecast horizon</summary>
          {Object.entries(forecastLog.cohorts).map(([scope,cohorts])=><div key={scope} className="mt-3 overflow-x-auto"><p className="eyebrow mb-2">{scope.replace('_',' ')}</p><table className="w-full text-left font-mono text-xs"><thead><tr><th className="p-2">Cohort</th><th className="p-2">Games</th><th className="p-2">Brier</th><th className="p-2">Log loss</th></tr></thead><tbody>{Object.entries(cohorts).map(([key,c])=><tr key={key}><td className="p-2">{key.replaceAll('_',' ')}</td><td className="p-2">{c.n}</td><td className="p-2">{c.brier?.toFixed(4)??'—'}</td><td className="p-2">{c.log_loss?.toFixed(4)??'—'}</td></tr>)}</tbody></table></div>)}
        </details>:null}
      </section>
  )
}
