import Link from 'next/link'
import type { ForecastComparison as Comparison, ComparisonCohort, ComparisonScore } from '@/lib/artifacts'
import { signed, forecastStamp } from '@/lib/format'

const HORIZONS = [['under_24h', 'Under 24 hours'], ['1_to_7_days', '1–7 days'], ['7_days_or_more', '7 days or more']] as const
const score = (value: number | null) => value?.toFixed(5) ?? '—'
const cohortRows = (cohort: ComparisonCohort): [string, ComparisonScore][] => [
  ['All decided', cohort], ...HORIZONS.map(([key, name]): [string, ComparisonScore] => [name, cohort.horizons[key]]), ...Object.entries(cohort.models),
]

export function ForecastComparison({ comparison }: { comparison: Comparison | null }) {
  if (!comparison) return <section id="forecast-comparison" tabIndex={-1} aria-label="First versus latest forecasts" className="card scroll-mt-20 p-4">
    <h2 className="text-lg font-semibold">First vs latest forecasts</h2>
    <p className="mt-3 text-sm text-[var(--text-secondary)]">Comparison unavailable. Retained forecast history has not been scored for this publication.</p>
    <Link className="mt-3 inline-flex min-h-[44px] items-center font-mono text-xs text-[var(--accent-info)]" href="#published-record">Read the first-publication record ↑</Link>
  </section>

  const { paired, sources, coverage, latest } = comparison
  const short = latest.horizons.under_24h.n
  const missingShort = comparison.settled_decided - short
  const sides: [string, ComparisonCohort][] = [['First publication', paired.first], ['Latest pregame', paired.latest]]
  return <section id="forecast-comparison" tabIndex={-1} aria-label="First versus latest forecasts" className="card scroll-mt-20 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="eyebrow">Retained publications · {comparison.season}</p>
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--accent-warn)]">Small sample</span>
    </div>
    <h2 className="mt-2 text-lg font-semibold">First vs latest forecasts</h2>
    <p className="mt-2 text-xs text-[var(--text-secondary)]">{paired.n ? `${paired.n} identical decided games · probability scores, lower is better.` : 'No shared decided games. Paired scores are unavailable.'}</p>
    <div className="mt-4 grid grid-cols-2 gap-3">
      {sides.map(([label, cohort]) => <div key={label} className="rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--background-tertiary)] p-3 sm:p-4">
        <h3 className="min-h-[32px] font-mono text-xs text-[var(--text-secondary)] sm:min-h-0">{label}</h3>
        <dl className="mt-3 space-y-2">
          <div><dt className="eyebrow">Paired Brier</dt><dd className="numeric mt-1 text-xl sm:text-2xl">{score(cohort.brier)}</dd></div>
          <div className="flex flex-wrap justify-between gap-x-2 text-xs"><dt className="text-[var(--text-secondary)]">Log loss</dt><dd className="numeric">{score(cohort.log_loss)}</dd></div>
          <div className="flex justify-between text-xs"><dt className="text-[var(--text-secondary)]">Games</dt><dd className="numeric">{cohort.n}</dd></div>
        </dl>
      </div>)}
    </div>
    <p className="mt-3 font-mono text-[11px] text-[var(--text-secondary)]">Latest − first Brier: <span className="numeric text-[var(--text-primary)]">{paired.latest_minus_first_brier === null ? '—' : signed(paired.latest_minus_first_brier, 5)}</span> · descriptive difference only.</p>
    <div className="mt-4 border-t border-[var(--border-color)] pt-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div><dt className="eyebrow">Latest under 24h</dt><dd className="numeric mt-1">{short} / {comparison.settled_decided}</dd></div>
        <div><dt className="eyebrow">Missing latest</dt><dd className="numeric mt-1">{coverage.missing_latest}</dd></div>
        <div><dt className="eyebrow">Ties excluded</dt><dd className="numeric mt-1">{latest.ties_excluded}</dd></div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">{missingShort > 0 ? `${missingShort} decided ${missingShort === 1 ? 'game has' : 'games have'} no valid stored forecast under 24 hours before kickoff. ` : comparison.settled_decided ? 'Every settled decided game has a retained forecast under 24 hours before kickoff. ' : 'No settled decided games are available. '}This sample does not establish an accuracy gain or support model promotion.</p>
    </div>
    <details className="mt-4">
      <summary className="min-h-[44px] cursor-pointer py-3 font-mono text-xs text-[var(--accent-info)]">All cohorts, horizons and source coverage</summary>
      <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">All-cohort scores below can have different game IDs. Only the paired cards above compare identical decided games; ties are counted and excluded.</p>
      <div role="region" aria-label="First and latest forecast cohorts" tabIndex={0} className="mt-3 overflow-x-auto rounded-[var(--radius)] border border-[var(--border-color)]">
        <table className="w-full min-w-[570px] text-left font-mono text-xs">
          <caption className="sr-only">Separate first-publication and latest-pregame cohorts, with probability scores by horizon and model</caption>
          <thead><tr>{['Publication / cohort', 'Games', 'Brier', 'Log loss'].map(h => <th key={h} scope="col" className="p-3 font-normal text-[var(--text-secondary)]">{h}</th>)}</tr></thead>
          <tbody>{([['First', comparison.first], ['Latest', comparison.latest]] as const).flatMap(([label, cohort]) => cohortRows(cohort).map(([name, c]) => <tr key={`${label}-${name}`} className="border-t border-[var(--border-color)]">
            <th scope="row" className="p-3 font-normal">{label} · {name}</th><td className="numeric p-3">{c.n}</td><td className="numeric p-3">{score(c.brier)}</td><td className="numeric p-3">{score(c.log_loss)}</td>
          </tr>))}</tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">Missing first: {coverage.missing_first} · missing latest: {coverage.missing_latest} · later publications in paired set: {coverage.paired_with_later_publication}. {Object.entries(coverage.excluded).map(([reason, n]) => `${n} ${reason.replaceAll('_', ' ')}`).join(' · ') || 'No invalid candidates excluded'}.</p>
      <p className="mt-3 font-mono text-[11px] leading-relaxed text-[var(--text-tertiary)]">{sources.snapshots.toLocaleString()} stored snapshots · through {forecastStamp(sources.snapshot_through)}<br />Results fetched through {forecastStamp(sources.results_fetched_through)} · latest result kickoff {forecastStamp(sources.latest_result_kickoff)}<br />Comparison scored {forecastStamp(comparison.generated_at)} · first log {forecastStamp(sources.first_generated_at)}</p>
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">Latest valid publication strictly before the stored result kickoff; old schedule timestamps do not set eligibility. Equal instants use lexical model version order, without ranking models. Conflicting probabilities for the same instant and version are withheld.</p>
      <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">Both cohorts use stored results and full-precision conditional home-win probabilities. Kickoff and outcomes have not been independently recollected. The original first-publication record above remains unchanged.</p>
      {sources.warehouse_url ? <a href={sources.warehouse_url} className="mt-2 inline-flex min-h-[44px] items-center font-mono text-xs text-[var(--accent-info)]">Retained warehouse source ↗</a> : null}
    </details>
  </section>
}
