'use client'

import { useState } from 'react'

import { GameCard } from '@/components/forecast/GameCard'
import type { GameForecast } from '@/lib/artifacts'
import { useWatchlist } from '@/lib/watchlist'
import { cn } from '@/lib/utils'

/**
 * The week's slate, with a Following filter — the soccer sibling's pattern.
 *
 * The pills only render once the reader has followed at least one team, so
 * a first visit sees no control it cannot use. The filter is a view, not a
 * state: "All" is always one tap away and the empty-filter case names the
 * fix rather than showing a blank grid.
 */
export function SlateWithFilter({ games }: { games: GameForecast[] }) {
  const watchlist = useWatchlist()
  const [onlyFollowing, setOnlyFollowing] = useState(false)

  const followed = new Set(watchlist)
  const filtered =
    onlyFollowing && watchlist.length
      ? games.filter((g) => followed.has(g.home) || followed.has(g.away))
      : games

  return (
    <div>
      {watchlist.length ? (
        <div className="mb-3 flex gap-1" role="group" aria-label="Filter the slate">
          {[
            { key: false, label: `All · ${games.length}` },
            {
              key: true,
              label: `Following · ${games.filter((g) => followed.has(g.home) || followed.has(g.away)).length}`,
            },
          ].map((pill) => (
            <button
              key={String(pill.key)}
              type="button"
              aria-pressed={onlyFollowing === pill.key}
              onClick={() => setOnlyFollowing(pill.key)}
              className={cn(
                'min-h-[30px] rounded-full px-3 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors',
                onlyFollowing === pill.key
                  ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
              )}
            >
              {pill.label}
            </button>
          ))}
        </div>
      ) : null}

      {filtered.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((game, index) => (
            <GameCard
              key={game.game_id}
              game={game}
              riseIndex={Math.min(index, 11)}
            />
          ))}
        </div>
      ) : (
        <p className="card p-6 text-center font-mono text-[12px] text-[var(--text-tertiary)]">
          None of your teams play this week — the full slate is one tap away.
        </p>
      )}
    </div>
  )
}
