import Link from 'next/link'
import { Suspense } from 'react'
import type { GameDetail } from '@/lib/espn'
import { forecastStamp, playerMatchDate } from '@/lib/format'
import { leaderComparisons } from '@/lib/leaderComparison'
import { LeaderComparisonPicker, LeaderComparisonLoading } from './LeaderComparisonPicker'

export function GameLeaderComparison({ detail, gameId, home, away, date, datePrecision }: {
  detail: GameDetail; gameId: string; home: string; away: string; date: string; datePrecision: 'day' | 'instant'
}) {
  const rows = leaderComparisons(detail, home, away)
  return <section id="comparison" className="card scroll-mt-20 p-4 sm:p-6" aria-label="Game leader comparison">
    <header className="space-y-2">
      <p className="eyebrow">{away} at {home} · game summary</p>
      <h2 className="text-lg">Compare game leaders</h2>
      <p className="font-mono text-xs text-[var(--text-secondary)]">{playerMatchDate(date, datePrecision)}</p>
      <p className="font-mono text-xs text-[var(--text-tertiary)]">ESPN · summary update {detail.source.asOf ? forecastStamp(detail.source.asOf) : 'not supplied'}</p>
    </header>
    {rows.length ? <Suspense fallback={<LeaderComparisonLoading />}>
      <LeaderComparisonPicker key={gameId} rows={rows} home={home} away={away} gameId={gameId} />
    </Suspense> : <div className="mt-4 border-t border-[var(--border-color)] pt-4">
      <h3 className="text-sm">{detail.source.status === 'available' ? 'No leader lines supplied' : 'Game leaders unavailable'}</h3>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">{detail.source.status === 'mismatched'
        ? 'The source response does not match this fixture. Leader context is withheld.'
        : detail.source.status === 'unavailable' ? 'The ESPN summary could not be read. Player identity and game lines are unknown.'
          : 'This summary has no comparable leader categories. A missing leader is not a zero or a missing roster place.'}</p>
      <Link href="/games" className="mt-3 inline-flex min-h-[44px] items-center text-sm text-[var(--accent-info)] hover:underline">Browse published games →</Link>
    </div>}
    <p className="mt-4 text-xs leading-relaxed text-[var(--text-tertiary)]">Selected category leaders, not position starters or a full roster. Lines are shown as reported; no scouting grade or career comparison is inferred. Summaries may be cached for 24 hours.</p>
  </section>
}
