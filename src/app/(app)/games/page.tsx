import Link from 'next/link'

import { WeekCalendar } from '@/components/schedule/WeekCalendar'
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
 * **Inside a week, the calendar.** The previous version rendered 272 forecast
 * cards down a single column — the whole season at roughly one screen per
 * three games. The calendar is about a fifth the height per week and puts a
 * whole slate in view, which is the only way the shape of a week (a lone
 * Thursday game, five Sunday windows, one Monday) is visible at all.
 *
 * The jump rail is anchor links rather than a client component: the whole
 * page is one static document, so moving between weeks costs no JavaScript
 * and works with the page half-loaded.
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
    <div className="space-y-8">
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

      {/* The jump rail. Sticky, because a season is eighteen weeks tall and a
          reader who wants week 14 should not have to scroll back to the top
          to say so. */}
      <nav
        aria-label="Jump to week"
        className="sticky top-0 z-20 -mx-4 border-b border-[var(--border-color)] bg-[var(--background)]/95 px-4 py-2 backdrop-blur lg:top-0"
      >
        <ul className="flex flex-wrap gap-1">
          {weeks.map((week) => (
            <li key={week}>
              <Link
                href={`#week-${week}`}
                className={
                  week === next
                    ? 'block rounded-sm border border-[var(--accent-primary)] px-2 py-1 font-mono text-[11px] text-[var(--accent-primary)]'
                    : 'block rounded-sm border border-[var(--border-color)] px-2 py-1 font-mono text-[11px] text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-secondary)]'
                }
                aria-current={week === next ? 'true' : undefined}
              >
                {week}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {weeks.map((week) => {
        const slate = forecasts.games
          .filter((g) => g.week === week)
          .sort((a, b) => a.date_utc.localeCompare(b.date_utc))
        return (
          <section key={week} id={`week-${week}`} className="scroll-mt-16">
            <h2 className="mb-3 flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
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
            </h2>
            <WeekCalendar games={slate} />
          </section>
        )
      })}

      <p className="font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        Kickoffs are US Eastern, and games are filed under the Eastern day they
        are played on. A Sunday night kickoff carries a Monday UTC timestamp,
        so bucketing on UTC would move the whole prime-time slate forward a day
        every week — and the resulting calendar would look entirely plausible.
      </p>
    </div>
  )
}
