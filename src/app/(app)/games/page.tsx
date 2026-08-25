import { WeekCalendar } from '@/components/schedule/WeekCalendar'
import { WeekRail } from '@/components/schedule/WeekRail'
import { currentWeek, getGameForecasts } from '@/lib/artifacts'
import { stamp } from '@/lib/format'

export const dynamic = 'force-static'

export const metadata = { title: 'Schedule' }

/**
 * The whole season, week by week, as a calendar.
 *
 * **Weeks are the NFL's own index, not a derived bucket.** ESPN serves the
 * schedule week by week and the warehouse stores the week as a NOT-NULL
 * column, so this page groups on a fact rather than on arithmetic over
 * kickoff dates. That matters because games get flexed between Sunday and
 * Monday, and an international game in London kicks off on a UTC date that
 * belongs to the previous week everywhere in the United States.
 *
 * **Each week is a `<details>` and only the next one ships open**, the NBA
 * sibling's pattern: eighteen expanded calendars are a two-minute scroll,
 * but a folded week is still one click away AND still in the DOM for
 * in-page search. The rail unfolds a week before jumping to it.
 *
 * Kickoffs are US Eastern, and games are filed under the Eastern day they
 * are played on — bucketing on UTC would move every prime-time slate a day
 * forward and the result would look entirely plausible.
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
  const next = currentWeek(forecasts)

  return (
    <div className="space-y-6">
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

      <WeekRail weeks={weeks} next={next} />

      <div className="space-y-3">
        {weeks.map((week) => {
          const slate = forecasts.games
            .filter((g) => g.week === week)
            .sort((a, b) => a.date_utc.localeCompare(b.date_utc))
          return (
            <details
              key={week}
              id={`week-${week}`}
              open={week === next || (next === null && week === weeks[0])}
              className="group scroll-mt-16"
            >
              <summary className="flex cursor-pointer list-none items-baseline gap-3 rounded-sm border border-transparent px-1 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)] [&::-webkit-details-marker]:hidden">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                  className="shrink-0 self-center transition-transform group-open:rotate-90"
                >
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span
                  className={
                    week === next
                      ? 'text-[var(--accent-primary)]'
                      : 'text-[var(--text-secondary)]'
                  }
                >
                  Week {week}
                </span>
                <span>{slate.length} games</span>
                {week === next ? <span>· next up</span> : null}
              </summary>
              <div className="pt-2">
                <WeekCalendar games={slate} />
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}
