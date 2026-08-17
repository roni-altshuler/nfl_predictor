import Link from 'next/link'

import { GameCard } from '@/components/forecast/GameCard'
import { TeamLabel } from '@/components/primitives/TeamLogo'
import {
  currentWeek,
  gamesForWeek,
  getGameForecasts,
  getPowerRatings,
  getSeasonProjections,
} from '@/lib/artifacts'
import { longshot, record, stamp } from '@/lib/format'

export const dynamic = 'force-static'

/**
 * The landing page: the next slate, the title race, and the top of the
 * power ratings.
 *
 * **The week shown is the next one to KICK OFF**, taken from the schedule
 * rather than from mapping today's date onto a week number. The NFL flexes
 * games between Sunday and Monday and plays Thursdays, so a date-derived
 * week is wrong for part of every week.
 */
export default function HomePage() {
  const forecasts = getGameForecasts()
  const projections = getSeasonProjections()
  const ratings = getPowerRatings()

  const week = currentWeek(forecasts)
  const slate = week === null ? [] : gamesForWeek(forecasts, week)
  const preseason = projections?.games_played === 0

  return (
    <div className="space-y-10">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
          {forecasts ? `${forecasts.season} season` : 'no forecast published'}
        </p>
        <h1 className="mt-2 text-3xl font-semibold uppercase tracking-[0.1em] text-[var(--text-primary)]">
          {week === null ? 'Gridiron' : `Week ${week}`}
        </h1>
        {forecasts ? (
          <p className="mt-2 font-mono text-[11px] text-[var(--text-tertiary)]">
            {slate.length} games · model {forecasts.model_version} · published{' '}
            {stamp(forecasts.generated_at)}
          </p>
        ) : null}
      </header>

      {preseason ? (
        <p className="rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-3 font-mono text-[11px] leading-relaxed text-[var(--accent-warn)]">
          The season has not kicked off. Every number here is a projection
          from ratings carried over and regressed from last season — there is
          no live record yet, and{' '}
          <Link href="/accuracy" className="underline">
            the accuracy page
          </Link>{' '}
          reports the historical walk-forward only, labelled as such.
        </p>
      ) : null}

      {/* ------------------------------------------------------- the slate */}
      <section>
        <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          The slate
        </h2>
        {slate.length === 0 ? (
          <p className="font-mono text-sm text-[var(--text-tertiary)]">
            No fixtures published.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {slate.map((game) => (
              <GameCard key={game.game_id} game={game} />
            ))}
          </div>
        )}
      </section>

      {/* --------------------------------------------------- the title race */}
      {projections ? (
        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              Super Bowl odds
            </h2>
            <Link
              href="/season"
              className="font-mono text-[11px] text-[var(--accent-info)] hover:underline"
            >
              full projection
            </Link>
          </div>
          <ol className="divide-y divide-[var(--border-color)] rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--card-bg)]">
            {projections.teams.slice(0, 10).map((team, index) => (
              <li
                key={team.team_id}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <span className="w-5 font-mono text-[11px] text-[var(--text-tertiary)]">
                  {index + 1}
                </span>
                <TeamLabel
                  abbreviation={team.abbreviation}
                  name={team.name}
                  size={22}
                  className="flex-1 text-sm"
                />
                <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                  {record(team.wins, team.losses, team.ties, 1)}
                </span>
                <span className="w-16 text-right font-mono text-sm text-[var(--accent-primary)]">
                  {longshot(team.p_championship)}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-2 font-mono text-[10px] text-[var(--text-tertiary)]">
            {projections.simulations.toLocaleString()} simulated seasons. The
            model carries no injury or roster data, so these stay more
            concentrated than a real futures market.
          </p>
        </section>
      ) : null}

      {/* ------------------------------------------------------- the ratings */}
      {ratings ? (
        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              Power ratings
            </h2>
            <Link
              href="/ratings"
              className="font-mono text-[11px] text-[var(--accent-info)] hover:underline"
            >
              all 32
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {ratings.teams.slice(0, 8).map((team, index) => (
              <div
                key={team.team_id}
                className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2"
              >
                <span className="w-5 font-mono text-[11px] text-[var(--text-tertiary)]">
                  {index + 1}
                </span>
                <TeamLabel
                  abbreviation={team.abbreviation}
                  name={team.name}
                  size={20}
                  className="flex-1 text-sm"
                />
                <span className="font-mono text-sm text-[var(--text-primary)]">
                  {team.elo.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
