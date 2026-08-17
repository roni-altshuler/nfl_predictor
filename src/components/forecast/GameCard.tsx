import Link from 'next/link'

import type { GameForecast } from '@/lib/artifacts'
import { kickoff, logoUrl, moneyline, pct, signed, spread } from '@/lib/format'

/**
 * One fixture, with the model's call and the market's beside it.
 *
 * **The whole card is a link, and the destination has to earn it.** A card
 * that shows a fixture and does nothing when clicked is the most common
 * complaint any schedule gets, and it was this one's. The game page
 * therefore carries what a card cannot: the full margin lattice with
 * football's 3s and 7s, the cover/push/lose surface at every key number, the
 * injury report, the last meetings and both sides' recent form.
 *
 * **The tie is shown only when it is material.** A ~0.5% tie probability
 * printed on all sixteen cards is noise that trains the reader to skip the
 * row; a 2% tie on a pick'em in a dome is a real fact about that game. The
 * threshold is 1%.
 *
 * **The market column renders as absent when there is no line**, never as
 * zero or as a dash that could be mistaken for a pick'em. "No line
 * published" and "the line is even" are different facts.
 */

function Side({
  abbr,
  probability,
  score,
  favoured,
}: {
  abbr: string
  probability: number
  score: number
  favoured: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl(abbr)}
        alt=""
        width={28}
        height={28}
        className="h-7 w-7 shrink-0 rounded bg-white/90 p-0.5"
      />
      <div className="min-w-0 flex-1">
        <div
          className={
            favoured
              ? 'font-mono text-sm font-semibold text-[var(--text-primary)]'
              : 'font-mono text-sm text-[var(--text-secondary)]'
          }
        >
          {abbr}
        </div>
        <div className="font-mono text-[11px] text-[var(--text-tertiary)]">
          {score.toFixed(1)} pts
        </div>
      </div>
      <div
        className={
          favoured
            ? 'font-mono text-sm font-semibold text-[var(--accent-primary)]'
            : 'font-mono text-sm text-[var(--text-secondary)]'
        }
      >
        {pct(probability)}
      </div>
    </div>
  )
}

export function GameCard({ game }: { game: GameForecast }) {
  const homeFavoured = game.p_home >= game.p_away
  const hasLine =
    game.market.spread_home !== null ||
    (game.market.ml_home !== null && game.market.ml_away !== null)

  return (
    <Link
      href={`/games/${game.game_id}`}
      className="block rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--card-bg)] p-4 transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)] focus-visible:border-[var(--border-hover)]"
      aria-label={`${game.away} at ${game.home}, week ${game.week} — full forecast`}
    >
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
          {kickoff(game.date_utc)}
        </span>
        {game.neutral_site ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--accent-warn)]">
            neutral
          </span>
        ) : null}
      </header>

      <div className="space-y-2.5">
        <Side
          abbr={game.away}
          probability={game.p_away}
          score={game.exp_away_score}
          favoured={!homeFavoured}
        />
        <Side
          abbr={game.home}
          probability={game.p_home}
          score={game.exp_home_score}
          favoured={homeFavoured}
        />
      </div>

      <footer className="mt-3 border-t border-[var(--border-color)] pt-3">
        <dl className="grid grid-cols-3 gap-2 font-mono text-[11px]">
          <div>
            <dt className="text-[var(--text-tertiary)]">model</dt>
            <dd className="text-[var(--text-secondary)]">
              {game.home} {signed(game.exp_margin)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-tertiary)]">total</dt>
            <dd className="text-[var(--text-secondary)]">
              {game.exp_total.toFixed(1)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-tertiary)]">market</dt>
            <dd
              className={
                hasLine
                  ? 'text-[var(--accent-market)]'
                  : 'text-[var(--text-tertiary)]'
              }
            >
              {hasLine ? (
                game.market.spread_home !== null ? (
                  spread(game.market.spread_home)
                ) : (
                  moneyline(game.market.ml_home)
                )
              ) : (
                'no line'
              )}
            </dd>
          </div>
        </dl>

        {game.p_tie >= 0.01 ? (
          <p className="mt-2 font-mono text-[10px] text-[var(--accent-warn)]">
            tie {pct(game.p_tie)}
          </p>
        ) : null}
      </footer>
    </Link>
  )
}
