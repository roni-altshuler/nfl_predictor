'use client'

import { useId, useState } from 'react'
import type { RecordPoint } from '@/lib/record'

const date = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const percent = (value: number) => `${value.toFixed(1)}%`

export function AccuracyTimeline({ points }: { points: RecordPoint[] }) {
  const id = useId()
  const [series, setSeries] = useState('both')
  if (!points.length) return <section className="card p-4"><h3 className="text-lg">Season timeline</h3><p className="mt-3 text-sm text-[var(--text-secondary)]">No eligible settled predictions to plot. Missing evidence is never drawn as zero accuracy.</p></section>
  const last = points[points.length - 1]
  const firstTime = Date.parse(points[0].kickoff), lastTime = Date.parse(last.kickoff)
  const x = (p: RecordPoint) => lastTime === firstTime ? 500 : ((Date.parse(p.kickoff) - firstTime) / (lastTime - firstTime)) * 1000
  const line = (recent: boolean) => points.map(p => `${x(p)},${1000 - (recent ? p.recentAccuracy : p.accuracy) * 10}`).join(' ')
  return <section className="card p-4 sm:p-5" aria-label="Season accuracy timeline">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h3 className="text-lg">How the season is going</h3><p className="mt-1 text-xs text-[var(--text-secondary)]">Cumulative record and the most recent 16 graded outcomes.</p></div>
      <label className="flex flex-col gap-1 text-xs"><span>Timeline series</span><select className="lab-control" value={series} onChange={e => setSeries(e.target.value)}><option value="both">Cumulative + recent</option><option value="cumulative">Cumulative</option><option value="recent">Recent 16</option></select></label>
    </div>
    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs">
      <p><span className="mr-2 inline-block w-5 border-t-2 border-[var(--accent-primary)]" aria-hidden="true" />Cumulative <strong>{percent(last.accuracy)}</strong> · {last.correct}/{last.eligible}</p>
      <p><span className="mr-2 inline-block w-5 border-t-2 border-dashed border-[var(--accent-info)]" aria-hidden="true" />Recent <strong>{percent(last.recentAccuracy)}</strong> · {last.recentCorrect}/{last.recentEligible}</p>
    </div>
    <figure className="mt-5" aria-labelledby={`${id}-caption`}>
      <div className="flex gap-2">
        <div className="flex h-[190px] shrink-0 flex-col justify-between text-right font-mono text-[11px] text-[var(--text-secondary)]" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="h-[190px] min-w-0 flex-1 overflow-visible" role="img" aria-labelledby={`${id}-title ${id}-description`}>
          <title id={`${id}-title`}>Season prediction accuracy, from 0 to 100 percent</title>
          <desc id={`${id}-description`}>Cumulative {percent(last.accuracy)}, {last.correct} correct of {last.eligible}. Recent {last.recentEligible}: {last.recentCorrect} correct. Dates follow recorded kickoff in UTC; an equivalent data table follows.</desc>
          {[0, 500, 1000].map(y => <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="var(--border-color)" vectorEffect="non-scaling-stroke" />)}
          {series !== 'recent' ? <polyline points={line(false)} fill="none" stroke="var(--accent-primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" /> : null}
          {series !== 'cumulative' ? <polyline points={line(true)} fill="none" stroke="var(--accent-info)" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" /> : null}
        </svg>
      </div>
      <div className="ml-10 mt-2 flex justify-between font-mono text-[11px] text-[var(--text-secondary)]"><span>{date(points[0].kickoff)}</span><span>{date(new Date((firstTime + lastTime) / 2).toISOString())}</span><span>{date(last.kickoff)}</span></div>
      <figcaption id={`${id}-caption`} className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">Recorded kickoff dates (UTC), not settlement times. Simultaneous games sort by game ID. Lines join saved observations without smoothing; recent form uses up to 16 outcomes and its actual denominator.</figcaption>
    </figure>
    <details className="mt-3"><summary className="flex min-h-[44px] cursor-pointer items-center text-xs text-[var(--accent-info)]">View every chart value</summary>
      <div role="region" aria-label="Accuracy timeline data" tabIndex={0} className="overflow-x-auto"><table className="w-full min-w-[490px] text-left font-mono text-xs"><caption className="sr-only">All graded outcomes in recorded kickoff order, UTC</caption><thead><tr>{['Date · week', 'Cumulative', 'Recent outcomes'].map(s => <th key={s} className="p-2">{s}</th>)}</tr></thead><tbody>{points.map(p => <tr key={p.gameId} className="border-t border-[var(--border-color)]"><td className="p-2">{date(p.kickoff)} · W{p.week}</td><td className="p-2">{p.correct}/{p.eligible} · {percent(p.accuracy)}</td><td className="p-2">{p.recentCorrect}/{p.recentEligible} · {percent(p.recentAccuracy)}</td></tr>)}</tbody></table></div>
    </details>
  </section>
}
