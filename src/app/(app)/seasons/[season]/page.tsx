import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PlayoffBracket } from '@/components/playoffs/PlayoffBracket'
import { TeamLabel } from '@/components/primitives/TeamLogo'
import {
  byDivision,
  getArchivedSeason,
  getSeasonsIndex,
  recordText,
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
  return { title: `${season} season` }
}

/**
 * One completed season: the bracket, the standings, and where the model was
 * most wrong.
 *
 * **Every forecast on this page is a backtest and says so on every surface it
 * appears.** The retrodictions come from the same weekly walk-forward the
 * accuracy page reports — the model never saw the game it is scoring — but
 * nobody read those numbers before those kickoffs, and a page that blurs the
 * two is claiming a record it does not have.
 */
export default async function SeasonPage({
  params,
}: {
  params: Promise<{ season: string }>
}) {
  const { season: raw } = await params
  const season = Number(raw)
  const data = getArchivedSeason(season)
  if (!data) notFound()

  const index = getSeasonsIndex()
  const position = (index?.seasons ?? []).findIndex((s) => s.season === season)
  const newer = position > 0 ? index!.seasons[position - 1] : null
  const older =
    position >= 0 && position < (index?.seasons.length ?? 0) - 1
      ? index!.seasons[position + 1]
      : null

  const groups = byDivision(data.standings)
  const conferences = [...new Set(groups.map((g) => g.conference))].sort()
  const misses = biggestMisses(data.games)
  const withForecast = data.games.filter((g) => g.p_home !== null)

  return (
    <div className="space-y-8">
      <header>
        <Link
          href="/seasons"
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
        >
          ← All seasons
        </Link>
        <h1 className="mt-3 text-3xl font-semibold uppercase tracking-[0.1em]">
          {season}
        </h1>
        <p className="mt-2 font-mono text-[11px] text-[var(--text-tertiary)]">
          {data.regular_season_games} regular-season games ·{' '}
          {data.postseason_games} in the postseason
          {data.champion ? (
            <>
              {' '}
              ·{' '}
              <Link
                href={`/teams/${data.champion}`}
                className="text-[var(--accent-primary)] hover:underline"
              >
                {data.champion}
              </Link>{' '}
              won the Super Bowl
            </>
          ) : null}
        </p>
        <nav className="mt-3 flex gap-3 font-mono text-[11px]">
          {older ? (
            <Link
              href={`/seasons/${older.season}`}
              className="text-[var(--accent-info)] hover:underline"
            >
              ← {older.season}
            </Link>
          ) : null}
          <Link
            href={`/seasons/${season}/games`}
            className="text-[var(--accent-info)] hover:underline"
          >
            every game
          </Link>
          {newer ? (
            <Link
              href={`/seasons/${newer.season}`}
              className="text-[var(--accent-info)] hover:underline"
            >
              {newer.season} →
            </Link>
          ) : null}
        </nav>
      </header>

      {/* ---------------------------------------------------------- bracket */}
      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          The postseason
        </h2>
        {Object.keys(data.bracket.rounds).length ? (
          <div className="card p-4">
            <PlayoffBracket bracket={data.bracket} season={season} />
          </div>
        ) : (
          <p className="card p-4 font-mono text-[11px] text-[var(--text-tertiary)]">
            No postseason games published for this season.
          </p>
        )}
        {Object.values(data.seeds_verified).some((v) => !v) ? (
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--accent-warn)]">
            Seed numbers are withheld for{' '}
            {Object.entries(data.seeds_verified)
              .filter(([, ok]) => !ok)
              .map(([conference]) => conference)
              .join(' and ')}
            . The reconstruction from final standings did not produce the field
            that actually played, which means the season turned on a tiebreaker
            below the four this project models. The games are real; the numbers
            beside them would not be.
          </p>
        ) : null}
      </section>

      {/* -------------------------------------------------------- standings */}
      {conferences.map((conference) => (
        <section key={conference}>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            {conference}
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {groups
              .filter((g) => g.conference === conference)
              .map((group) => (
                <div
                  key={group.division}
                  className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--card-bg)]"
                >
                  <table className="w-full min-w-[380px] border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--border-color)] text-left">
                        <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                          {group.division}
                        </th>
                        {['w-l', 'pf', 'pa', 'diff', 'seed'].map((label) => (
                          <th
                            key={label}
                            className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.teams.map((team) => (
                        <tr
                          key={team.team_id}
                          className="border-b border-[var(--border-color)] last:border-0"
                        >
                          <td className="px-3 py-2">
                            <TeamLabel
                              abbreviation={team.abbreviation}
                              name={team.name}
                              size={18}
                              className="text-[13px]"
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-[12px] text-[var(--text-primary)]">
                            {recordText(team.wins, team.losses, team.ties)}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-tertiary)]">
                            {team.points_for}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-tertiary)]">
                            {team.points_against}
                          </td>
                          <td
                            className={
                              team.point_diff >= 0
                                ? 'px-3 py-2 font-mono text-[11px] text-[var(--accent-primary)]'
                                : 'px-3 py-2 font-mono text-[11px] text-[var(--accent-loss)]'
                            }
                          >
                            {signed(team.point_diff, 0)}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-secondary)]">
                            {team.seed ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        </section>
      ))}

      {/* ----------------------------------------------------------- misses */}
      {misses.length ? (
        <section>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Where the model was most wrong
          </h2>
          <div className="card divide-y divide-[var(--border-color)]">
            {misses.map((game) => {
              const homeWon = game.home_score > game.away_score
              const said = homeWon ? game.p_home! : 1 - game.p_home!
              return (
                <Link
                  key={game.game_id}
                  href={`/games/${game.game_id}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3 transition-colors hover:bg-[var(--card-hover)]"
                >
                  <span className="w-20 shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">
                    {game.date}
                  </span>
                  <span className="font-mono text-[12px] text-[var(--text-secondary)]">
                    {game.away} {game.away_score} – {game.home_score} {game.home}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-[var(--accent-warn)]">
                    gave the winner {pct(said)}
                  </span>
                </Link>
              )
            })}
          </div>
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
            <span className="text-[var(--accent-warn)]">A reconstruction.</span>{' '}
            These probabilities come from the weekly walk-forward — refit on
            games strictly earlier than the week being scored, so the model
            never saw the result — but nobody read them before those kickoffs.
            {withForecast.length < data.games.length ? (
              <>
                {' '}
                {data.games.length - withForecast.length} games this season
                carry no forecast at all: they fall inside the three-season
                warm-up the model was fitted on, and a number for them would be
                a forecast that had seen the answer.
              </>
            ) : null}
          </p>
        </section>
      ) : null}
    </div>
  )
}

/**
 * The five games the model was furthest wrong about.
 *
 * **`p_home` is a HOME probability and orienting it is the whole trap.** An
 * away upset is a low probability for the away side, which is a *high*
 * `p_home` — sorting on it directly puts every home favourite's loss at the
 * top and every away favourite's loss at the bottom, and the resulting list
 * looks entirely plausible. What is sorted here is the probability the model
 * gave to whoever actually won.
 *
 * Ties are excluded rather than assigned to a winner. A game that finished
 * level has no winner whose probability could have been too low.
 */
function biggestMisses(games: ArchivedGame[]): ArchivedGame[] {
  return games
    .filter((g) => g.p_home !== null && g.home_score !== g.away_score)
    .map((g) => ({
      game: g,
      gaveWinner: g.home_score > g.away_score ? g.p_home! : 1 - g.p_home!,
    }))
    .sort((a, b) => a.gaveWinner - b.gaveWinner)
    .slice(0, 5)
    .map((x) => x.game)
}
