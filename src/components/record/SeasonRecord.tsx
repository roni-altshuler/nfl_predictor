'use client'

import Link from 'next/link'
import type { SeasonRecord as RecordData } from '@/lib/record'
import { forecastStamp } from '@/lib/format'
import { AccuracyTimeline } from './AccuracyTimeline'
import { PredictionLedger } from './PredictionLedger'
import { useRecordQuery } from './useRecordQuery'

export function SeasonRecord({ record, seasons }: { record: RecordData; seasons: number[] }) {
  const selection = useRecordQuery(record.season, seasons)
  const current = selection.season === record.season
  const counts = current ? record.counts : null
  const weeks = [...new Set([...record.weeks, ...(selection.week ? [selection.week] : [])])].sort((a, b) => a - b)
  const index = selection.week === null ? -1 : weeks.indexOf(selection.week)
  const weekRows = record.rows.filter(row => selection.week === null || row.week === selection.week)
  const gradedWeek = weekRows.filter(row => row.eligible)
  const rows = weekRows.filter(row => selection.view === 'all' || (selection.view === 'pending' ? row.status === 'pending' : selection.view === 'unscored' ? row.status === 'ungraded' || row.status === 'unpicked' : row.actualOutcome !== null))
    .sort((a, b) => selection.view === 'pending' ? (a.scheduledKickoff ?? a.kickoff ?? '').localeCompare(b.scheduledKickoff ?? b.kickoff ?? '') : (b.kickoff ?? b.date ?? '').localeCompare(a.kickoff ?? a.date ?? '') || a.gameId.localeCompare(b.gameId))
  return <section id="published-record" className="scroll-mt-20 space-y-6" aria-label="Published forecast record" data-record-ready={selection.ready}>
    <header><p className="eyebrow">Saved before kickoff · checked against recorded results</p><h1 className="mt-3 text-3xl sm:text-4xl">Model accuracy</h1><p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">See what the model picked, what happened, and how the record changed through the season.</p></header>
    <div className="card p-4 sm:p-5">
      <h2 className="eyebrow">Published forecast record · {selection.season ?? 'season unavailable'} regular season</h2>
      <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3"><p className="numeric text-5xl text-[var(--accent-primary)] sm:text-6xl" data-testid="record-percentage">{counts?.accuracy === null || !counts ? '—' : `${counts.accuracy.toFixed(1)}%`}</p><div><p className="text-xl" data-testid="record-fraction">{counts && counts.eligible ? `${counts.correct} of ${counts.eligible} correct` : counts ? 'Not yet scored' : 'Record unavailable'}</p><p className="mt-1 text-xs text-[var(--text-secondary)]">First-published three-way outcome picks</p></div></div>
      <p className="mt-4 text-sm leading-relaxed text-[var(--text-secondary)]">Home win, tie or away win: the unique highest saved probability is the pick. An actual tie counts as an outcome. Missing or ambiguous picks are listed separately.</p>
      {counts ? <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--border-color)] pt-4 sm:grid-cols-4">{[['Recorded outcomes', counts.settled], ['Without a recorded result', counts.pending ?? 'Unknown'], ['Unscored / unpicked', counts.ungraded + counts.unpicked], ['Actual ties', counts.actualTies]].map(([label, value]) => <div key={label}><dt className="text-xs text-[var(--text-secondary)]">{label}</dt><dd className="numeric mt-1 text-xl">{value}</dd></div>)}</dl> : null}
      {current ? <p className="mt-4 text-xs leading-relaxed text-[var(--text-secondary)]">Results published {forecastStamp(record.meta.resultsUpdatedAt)}. {record.meta.resultKickoffThrough ? `Latest recorded kickoff: ${forecastStamp(record.meta.resultKickoffThrough)}.` : 'Recorded kickoff coverage unavailable.'} No later results are inferred.</p> : <p className="mt-4 text-sm text-[var(--text-secondary)]">A verified saved pregame record is not available for this season. Historical forecasts are retrospective testing and are never used to fill this record. <Link className="text-[var(--accent-info)] hover:underline" href={`/seasons/${selection.season}/games`}>Browse the recorded results →</Link></p>}
      {current && record.meta.publicationStart ? <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">Calls saved {forecastStamp(record.meta.publicationStart)}{record.meta.publicationStart !== record.meta.publicationEnd ? ` through ${forecastStamp(record.meta.publicationEnd)}` : ''} · {record.meta.firstModelVersions.join(', ')}. This is the record of those saved calls, not the latest weekly fit.</p> : null}
      {current && record.availability === 'unavailable' ? <p className="lab-notice mt-4">{record.availabilityReason} Totals and the timeline are withheld.</p> : null}
    </div>
    <nav aria-label="Record season and week" className="card p-4">
      <div className="grid gap-3 sm:grid-cols-3"><label className="flex flex-col gap-1 text-xs"><span>Season</span><select className="lab-control w-full" value={selection.season ?? ''} onChange={e => selection.select({ season: Number(e.target.value), week: null, view: 'settled' })}>{seasons.map(year => <option key={year} value={year}>{year}{year === record.season ? ' · saved picks' : ' · record unavailable'}</option>)}</select></label><label className="flex flex-col gap-1 text-xs"><span>Week</span><select className="lab-control w-full" value={selection.week ?? 'all'} disabled={!current} onChange={e => selection.select({ week: e.target.value === 'all' ? null : Number(e.target.value) })}><option value="all">Full season</option>{weeks.map(week => <option key={week} value={week}>Week {week}</option>)}</select></label><label className="flex flex-col gap-1 text-xs"><span>Game coverage</span><select className="lab-control w-full" disabled={!current} value={selection.view} onChange={e => selection.select({ view: e.target.value as 'settled' | 'pending' | 'unscored' | 'all' })}><option value="settled">Recorded outcomes</option><option value="pending">Results not recorded</option><option value="unscored">Unscored / unpicked</option><option value="all">All retained games</option></select></label></div>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="lab-control" disabled={!current || index <= 0} onClick={() => selection.select({ week: weeks[index - 1] })}>← Previous week</button><button type="button" className="lab-control" disabled={!current || (index >= weeks.length - 1)} onClick={() => selection.select({ week: weeks[index + 1] })}>Next week →</button><Link href={current ? `/games${selection.week ? `?week=${selection.week}` : ''}` : `/seasons/${selection.season}/games`} className="lab-control inline-flex items-center">Browse the week →</Link></div>
    </nav>
    {current ? <>
      {selection.week !== null ? <p className="font-mono text-sm" aria-live="polite">Week {selection.week}: {gradedWeek.length ? `${gradedWeek.filter(row => row.correct).length} of ${gradedWeek.length} graded picks correct` : 'No eligible graded picks'}. The headline and timeline retain the full-season record.</p> : null}
      <AccuracyTimeline points={record.timeline} />
      <PredictionLedger key={`${selection.season}:${selection.week}:${selection.view}`} rows={rows} />
      <section className="card p-4 text-xs leading-relaxed text-[var(--text-secondary)]" aria-label="Record protocol">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">What this record can tell you</h3>
        <p className="mt-3">These are the earliest retained pre-event calls, not the accuracy of today’s weekly fit. Saved publications span {forecastStamp(record.meta.publicationStart)} to {forecastStamp(record.meta.publicationEnd)}; models: {record.meta.firstModelVersions.join(', ') || 'unavailable'}.</p>
        {record.binary ? <p className="mt-3">Separate conditional binary benchmark: <span>Decided games</span> <strong>{record.binary.eligible}</strong> · {record.binary.correct} correct · {record.binary.tiesExcluded} actual ties excluded. Its probability scores use a different denominator from the three-way record.</p> : null}
        <p className="mt-3">“Result not recorded” describes this source’s coverage, not a claim that the game is still unplayed. Canonical first-call JSON lacks original exact home/away score estimates, so no exact-score error is reported.</p>
        <details className="mt-2"><summary className="flex min-h-[44px] cursor-pointer items-center text-[var(--accent-info)]">Source checks and limitations</summary><ul className="list-disc space-y-2 pl-4">{record.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul><p className="mt-3">Raw first-log SHA256 verified: {record.meta.firstHashVerified ? 'yes' : 'no'}. Stored metadata and matching forecast values do not independently establish exact-run publication timing or historical training cutoffs.</p></details>
      </section>
    </> : null}
  </section>
}
