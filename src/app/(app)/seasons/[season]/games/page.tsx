import Link from 'next/link'
import { notFound } from 'next/navigation'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import {
  getArchivedSeason,
  getSeasonsIndex,
  type ArchivedGame,
} from '@/lib/archive'
import { pct, signed } from '@/lib/format'

export const dynamic = 'force-static'

export function generateStaticParams() {
  return (getSeasonsIndex()?.seasons ?? []).map((s) => ({
    season: String(s.season),
  }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ season: string }>
}) {
  const { season } = await params
  return { title: `${season} games` }
}

/**
 * Every game of one season, by week.
 *
 * The model's call sits beside each result — and it is a **backtest**, in the
 * warn colour, every time it appears. Games inside the three-season warm-up
 * carry no number rather than a number that had seen the answer.
 */
export default async function SeasonGamesPage({
  params,
}: {
  params: Promise<{ season: string }>
}) {
  const { season: raw } = await params
  const season = Number(raw)
  const data = getArchivedSeason(season)
  if (!data) notFound()

  const regular = data.games.filter((g) => !g.postseason)
  const postseason = data.games.filter((g) => g.postseason)
  const weeks = [...new Set(regular.map((g) => g.week))].sort((a, b) => a - b)
  const scored = data.games.filter((g) => g.p_home !== null)

  return (
    <div className="space-y-8">
      <header>
        <Link
          href={`/seasons/${season}`}
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
        >
          ← {season}
        </Link>
        <h1 className="mt-3 text-3xl font-semibold uppercase tracking-[0.1em]">
          {season} games
        </h1>
        <p className="mt-2 font-mono text-[11px] text-[var(--text-tertiary)]">
          {data.games.length} games over {weeks.length} weeks ·{' '}
          {scored.length} carry a retrodicted forecast
        </p>
      </header>

      {scored.length ? (
        <p className="rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-3 font-mono text-[11px] leading-relaxed text-[var(--accent-warn)]">
          The model column is a <strong>backtest</strong>. Each figure comes
          from a model refit on games strictly earlier than the week it scores,
          so it never saw the result — but nobody read these numbers before
          those kickoffs, and this project does not blur a reconstruction into
          a call made in advance.
        </p>
      ) : null}

      {weeks.map((week) => (
        <section key={week}>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Week {week}
          </h2>
          <div className="card divide-y divide-[var(--border-color)]">
            {regular
              .filter((g) => g.week === week)
              .map((game) => (
                <GameRow key={game.game_id} game={game} />
              ))}
          </div>
        </section>
      ))}

      {postseason.length ? (
        <section>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Postseason
          </h2>
          <div className="card divide-y divide-[var(--border-color)]">
            {postseason.map((game) => (
              <GameRow key={game.game_id} game={game} showRound />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function GameRow({
  game,
  showRound = false,
}: {
  game: ArchivedGame
  showRound?: boolean
}) {
  const homeWon = game.home_score > game.away_score
  const level = game.home_score === game.away_score

  return (
    <Link
      href={`/games/${game.game_id}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 transition-colors hover:bg-[var(--card-hover)]"
    >
      <span className="w-20 shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">
        {showRound ? (game.round ?? game.date) : game.date}
      </span>

      <span className="flex min-w-0 items-center gap-2">
        <TeamLogo abbreviation={game.away} size={16} />
        <span
          className={
            !homeWon && !level
              ? 'font-mono text-[12px] text-[var(--text-primary)]'
              : 'font-mono text-[12px] text-[var(--text-tertiary)]'
          }
        >
          {game.away}
        </span>
        <span className="numeric text-[12px] text-[var(--text-secondary)]">
          {game.away_score}
        </span>
      </span>

      <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
        {game.neutral ? 'vs' : '@'}
      </span>

      <span className="flex min-w-0 items-center gap-2">
        <TeamLogo abbreviation={game.home} size={16} />
        <span
          className={
            homeWon
              ? 'font-mono text-[12px] text-[var(--text-primary)]'
              : 'font-mono text-[12px] text-[var(--text-tertiary)]'
          }
        >
          {game.home}
        </span>
        <span className="numeric text-[12px] text-[var(--text-secondary)]">
          {game.home_score}
        </span>
      </span>

      <span className="ml-auto flex items-baseline gap-3">
        {game.exp_margin !== null ? (
          <span className="hidden numeric text-[10px] text-[var(--text-tertiary)] sm:inline">
            proj {signed(game.exp_margin)}
          </span>
        ) : null}
        <span
          className={
            game.p_home === null
              ? 'numeric w-16 text-right text-[11px] text-[var(--text-tertiary)]'
              : 'numeric w-16 text-right text-[11px] text-[var(--accent-warn)]'
          }
          title={
            game.p_home === null
              ? 'Inside the warm-up the model was fitted on — no forecast'
              : 'Backtest: refit on games strictly earlier than this week'
          }
        >
          {game.p_home === null ? 'warm-up' : pct(game.p_home, 0)}
        </span>
      </span>
    </Link>
  )
}
