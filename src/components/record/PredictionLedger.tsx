'use client'

import { useState } from 'react'
import type { RecordRow, Outcome } from '@/lib/record'
import { forecastStamp, kickoff } from '@/lib/format'

function label(outcome: Outcome | null, row: RecordRow) {
  return outcome === 'tie' ? 'Tie' : outcome === 'home_win' ? `${row.home} win` : outcome === 'away_win' ? `${row.away} win` : 'Unavailable'
}
export function PredictionLedger({ rows }: { rows: RecordRow[] }) {
  const [limit, setLimit] = useState(16)
  return <section aria-label="Prediction and result ledger" className="space-y-3">
    <div><h3 className="text-xl">Every pick. Every result.</h3><p className="mt-2 text-sm text-[var(--text-secondary)]">Original saved calls beside recorded outcomes. Expand a game to inspect its probabilities and timing.</p></div>
    {!rows.length ? <p className="card p-5 text-sm text-[var(--text-secondary)]">No games match this view. Choose another week or coverage filter.</p> : <ul className="space-y-3">{rows.slice(0, limit).map(row => <li key={row.gameId} className="card p-4" data-record-game={row.gameId}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-base font-semibold">{row.away} at {row.home}</p><span className={`font-mono text-xs ${row.correct === true ? 'text-[var(--accent-primary)]' : row.correct === false ? 'text-[var(--accent-loss-soft)]' : 'text-[var(--text-secondary)]'}`}>{row.correct === true ? 'Correct' : row.correct === false ? 'Incorrect' : row.status === 'pending' ? 'Result not recorded' : row.status === 'unpicked' ? 'No unique pick' : 'Pick unavailable'}</span></div>
      <p className="font-mono text-[11px] text-[var(--text-tertiary)]">Week {row.week} · {row.kickoff ? kickoff(row.kickoff) : row.scheduledKickoff ? `Scheduled ${kickoff(row.scheduledKickoff)}` : `${row.date ?? 'Date unavailable'} · kickoff unavailable`}</p>
      <dl className="mt-3 grid grid-cols-2 gap-4"><div><dt className="eyebrow">Saved pick</dt><dd className="mt-1 text-base">{label(row.firstPick, row)}</dd></div><div><dt className="eyebrow">Recorded result</dt><dd className="mt-1 text-base">{row.actualOutcome ? `${row.away} ${row.actualAwayScore}–${row.actualHomeScore} ${row.home} · ${label(row.actualOutcome, row)}` : 'No recorded outcome'}</dd></div></dl>
      {row.reason ? <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">{row.reason}</p> : null}
      <details className="mt-2"><summary className="flex min-h-[44px] cursor-pointer items-center text-xs text-[var(--accent-info)]">Prediction evidence</summary><dl className="grid gap-3 text-xs leading-relaxed sm:grid-cols-2"><div><dt className="text-[var(--text-tertiary)]">Saved publication</dt><dd>{row.publishedAt ? forecastStamp(row.publishedAt) : 'Not available'}</dd></div><div><dt className="text-[var(--text-tertiary)]">Model</dt><dd className="break-words font-mono">{row.modelVersion ?? 'Not available'}</dd></div><div><dt className="text-[var(--text-tertiary)]">Original probabilities</dt><dd>{row.probabilities ? `${row.home} ${(row.probabilities.home * 100).toFixed(2)}% · tie ${(row.probabilities.tie * 100).toFixed(2)}% · ${row.away} ${(row.probabilities.away * 100).toFixed(2)}%` : 'No eligible original probability vector'}</dd></div><div><dt className="text-[var(--text-tertiary)]">Lead before stored kickoff</dt><dd>{row.horizonHours === null ? 'Not available' : `${row.horizonHours.toFixed(1)} hours`}</dd></div><div><dt className="text-[var(--text-tertiary)]">Recorded result retrieved</dt><dd>{row.resultFetchedAt ? forecastStamp(row.resultFetchedAt) : 'Not available'}</dd></div></dl></details>
    </li>)}</ul>}
    {rows.length > limit ? <button type="button" className="lab-control" onClick={() => setLimit(n => n + 16)}>Show next {Math.min(16, rows.length - limit)} games ({Math.min(limit, rows.length)} of {rows.length} shown)</button> : null}
  </section>
}
