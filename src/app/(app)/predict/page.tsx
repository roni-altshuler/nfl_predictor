import { Suspense } from 'react'

import { MatchupPicker } from './MatchupPicker'
import { getMatchups } from '@/lib/history'
import { stamp } from '@/lib/format'

export const metadata = { title: 'Head to head' }
export const dynamic = 'force-static'

/**
 * Any two franchises, priced.
 *
 * The interactive surface of the same model that produces the schedule and
 * the season projection — not a second one. Every pair is precomputed by
 * `build_game_context` through the identical serving path, so a matchup here
 * and the same fixture on its game page cannot disagree.
 *
 * The picker reads `?home=&away=` and writes them back as the selection
 * changes, so any pairing is a shareable URL; that needs `useSearchParams`,
 * which on a statically rendered page needs a Suspense boundary around it.
 */
export default function PredictPage() {
  const matchups = getMatchups()

  if (!matchups) {
    return (
      <p className="text-sm text-[var(--text-tertiary)]">
        No matchup grid published.
      </p>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <p className="eyebrow">{matchups.season} ratings</p>
        <h1 className="mt-2 text-2xl">Head to head</h1>
        <p className="mt-2 numeric text-[11px] text-[var(--text-tertiary)]">
          {matchups.matchups.length} pairings priced in advance · published{' '}
          {stamp(matchups.generated_at)}
        </p>
      </header>

      <Suspense
        fallback={
          <div className="card h-24 skeleton-shimmer" aria-hidden="true" />
        }
      >
        <MatchupPicker data={matchups} />
      </Suspense>
    </div>
  )
}
