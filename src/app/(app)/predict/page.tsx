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
        <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
          Pick any two of the 32 franchises and see what the model makes of
          the game. All {matchups.matchups.length} ordered pairs are priced in
          advance, so this is the same forecast the schedule shows rather than
          a second one computed a different way.
        </p>
        <p className="mt-2 numeric text-[10px] text-[var(--text-tertiary)]">
          published {stamp(matchups.generated_at)}
        </p>
      </header>

      <MatchupPicker data={matchups} />
    </div>
  )
}
