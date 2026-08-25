import Link from 'next/link'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import { pct, signed } from '@/lib/format'
import {
  biggestMarginMisses,
  biggestUpsets,
  scoredGameCount,
  widestDisagreements,
  type BoardGame,
} from '@/lib/upsets'

export const dynamic = 'force-static'

export const metadata = { title: 'Upsets' }

/**
 * The games nobody saw coming — ported from the NBA sibling, which keeps
 * this page for the same reason: a forecast archive is at its most honest
 * and its most fun at the tail. Every row is a link into the game.
 *
 * **All three boards are backtests and each says so.** The probabilities are
 * the weekly walk-forward's; the model never saw the result, but nobody read
 * these numbers before kickoff either.
 */
export default function UpsetsPage() {
  const upsets = biggestUpsets()
  const disagreements = widestDisagreements()
  const misses = biggestMarginMisses()
  const total = scoredGameCount()

  if (!upsets.length) {
    return (
      <p className="font-mono text-sm text-[var(--text-tertiary)]">
        No scored archive published.
      </p>
    )
  }

  return (
    <div className="space-y-10">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
          {total.toLocaleString()} scored games · backtest
        </p>
        <h1 className="mt-2 text-3xl font-semibold uppercase tracking-[0.1em]">
          Upsets
        </h1>
        <p className="mt-2 max-w-2xl font-mono text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          The games nobody saw coming, across every scored season since 2005.
        </p>
      </header>

      <Board
        title="Biggest upsets"
        note="How much the walk-forward gave the side that actually won."
        games={upsets}
        metric={(g) => (
          <span className="text-[var(--accent-warn)]">
            gave the winner {pct(g.gave_winner)}
          </span>
        )}
      />

      <Board
        title="Model vs market"
        note="Where the two disagreed hardest on the eventual winner — model first, market second."
        games={disagreements}
        metric={(g) => {
          const modelRight = g.gave_winner! >= g.market_gave_winner!
          return (
            <span
              className={
                modelRight
                  ? 'text-[var(--accent-primary)]'
                  : 'text-[var(--accent-market)]'
              }
            >
              {pct(g.gave_winner)} vs {pct(g.market_gave_winner)}
            </span>
          )
        }}
      />

      <Board
        title="Biggest margin misses"
        note="Actual margin against the projected one, home perspective."
        games={misses}
        metric={(g) => (
          <span className="text-[var(--accent-loss)]">
            off by {Math.abs(g.margin_miss!).toFixed(1)} · proj{' '}
            {signed(g.exp_margin)}
          </span>
        )}
      />

      <p className="font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        <span className="text-[var(--accent-warn)]">Backtest</span> — refit
        strictly before each week, read by nobody before kickoff. Ties are
        excluded from the upset board: a level game has no winner to have
        underrated.
      </p>
    </div>
  )
}

function Board({
  title,
  note,
  games,
  metric,
}: {
  title: string
  note: string
  games: BoardGame[]
  metric: (game: BoardGame) => React.ReactNode
}) {
  if (!games.length) return null
  return (
    <section>
      <h2 className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
        {title}
      </h2>
      <p className="mb-3 font-mono text-[10px] text-[var(--text-tertiary)]">
        {note}
      </p>
      <div className="card divide-y divide-[var(--border-color)]">
        {games.map((game, index) => (
          <Link
            key={game.game_id}
            href={`/games/${game.game_id}`}
            className="rise flex flex-wrap items-center gap-x-3 gap-y-1 p-3 transition-colors hover:bg-[var(--card-hover)]"
            style={{ '--rise-i': Math.min(index, 11) } as React.CSSProperties}
          >
            <span className="w-9 shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">
              {game.season}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <TeamLogo abbreviation={game.away} size={16} />
              <span className="font-mono text-[12px] text-[var(--text-secondary)]">
                {game.away} {game.away_score}
              </span>
            </span>
            <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
              {game.neutral ? 'vs' : '@'}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <TeamLogo abbreviation={game.home} size={16} />
              <span className="font-mono text-[12px] text-[var(--text-secondary)]">
                {game.home} {game.home_score}
              </span>
            </span>
            {game.postseason ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--accent-warn)]">
                {game.round ?? 'playoff'}
              </span>
            ) : null}
            <span className="ml-auto font-mono text-[11px]">{metric(game)}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
