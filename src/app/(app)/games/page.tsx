import { GameCard } from '@/components/forecast/GameCard'
import { getGameForecasts } from '@/lib/artifacts'
import { stamp } from '@/lib/format'

export const dynamic = 'force-static'

/**
 * The whole season, by week.
 *
 * **Weeks are the NFL's own index, not a derived bucket.** ESPN serves the
 * schedule week by week and the warehouse stores the week as a NOT-NULL
 * column, so this page groups on a fact rather than on arithmetic over
 * kickoff dates. That matters because games get flexed between Sunday and
 * Monday, and an international game in London kicks off on a UTC date that
 * belongs to the previous week everywhere in the United States.
 */
export default function GamesPage() {
  const forecasts = getGameForecasts()

  if (!forecasts || forecasts.games.length === 0) {
    return (
      <p className="font-mono text-sm text-[var(--text-tertiary)]">
        No schedule published.
      </p>
    )
  }

  const weeks = [...new Set(forecasts.games.map((g) => g.week))].sort(
    (a, b) => a - b,
  )

  return (
    <div className="space-y-10">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
          {forecasts.season} season
        </p>
        <h1 className="mt-2 text-3xl font-semibold uppercase tracking-[0.1em]">
          Schedule
        </h1>
        <p className="mt-2 font-mono text-[11px] text-[var(--text-tertiary)]">
          {forecasts.games.length} fixtures over {weeks.length} weeks ·
          published {stamp(forecasts.generated_at)}
        </p>
      </header>

      {weeks.map((week) => {
        const slate = forecasts.games
          .filter((g) => g.week === week)
          .sort((a, b) => a.date_utc.localeCompare(b.date_utc))
        return (
          <section key={week} id={`week-${week}`}>
            <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              Week {week} · {slate.length} games
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {slate.map((game) => (
                <GameCard key={game.game_id} game={game} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
