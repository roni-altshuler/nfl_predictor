import Link from 'next/link'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import type { GameForecast } from '@/lib/artifacts'
import { pct } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * One NFL week as a calendar, not a list.
 *
 * **The list was the problem.** A full slate is sixteen games, and at one
 * forecast card each a season is 272 cards — a page you scroll for two
 * minutes to reach December. A calendar puts a whole week on one screen: a
 * column per day, every game a compact chip, and the detail one click away on
 * a page that has room for it.
 *
 * **The columns are the week's OWN days, not Monday-to-Sunday.** The sibling
 * NBA project draws a fixed seven-column Mon–Sun grid, which is right for a
 * sport that plays every night. A football week runs Thursday to Monday, so
 * that grid would split every single week across its own boundary — Monday
 * night in the first column, the Thursday that opened the same week in the
 * fourth. Here the span is read from the fixtures: first kickoff to last,
 * inclusive, one column per day.
 *
 * That also gets the irregular weeks right for free. Christmas moves games to
 * Wednesday, the last weeks of the season add Saturdays, and Thanksgiving
 * puts three games on a Thursday — none of which needs a special case,
 * because the column list comes from the schedule rather than from a
 * calendar rule.
 *
 * **Days are bucketed in US Eastern, never UTC.** A Sunday night kickoff is
 * stamped Monday 00:20 UTC and a Monday night one is stamped Tuesday. Grouping
 * on the UTC date would move the whole prime-time slate forward a day, every
 * week, and the resulting calendar would look entirely plausible.
 *
 * **Empty days inside the span are drawn.** A week with no Saturday game
 * shows an empty Saturday; collapsing it shifts every other column and makes
 * two weeks with different shapes look identical.
 */

const DAY = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  timeZone: 'America/New_York',
})

const DAY_NUMBER = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  timeZone: 'America/New_York',
})

const MONTH = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  timeZone: 'America/New_York',
})

const TIME = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/New_York',
})

// en-CA formats as YYYY-MM-DD, which sorts lexicographically and is the same
// shape the rest of the pipeline speaks.
const EASTERN_DAY = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'America/New_York',
})

/** The Eastern calendar day of a UTC timestamp, as `YYYY-MM-DD`. */
function easternDay(iso: string): string {
  return EASTERN_DAY.format(new Date(iso))
}

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

/** Midday Eastern, so formatting the label never crosses a day boundary. */
function noon(day: string): Date {
  return new Date(`${day}T17:00:00Z`)
}

/**
 * One column per day, from `lg` up.
 *
 * Written out rather than interpolated because Tailwind's compiler scans
 * source text for literal class names — a template string would produce a
 * class that exists in the DOM and in no stylesheet. Five is the ordinary
 * week (Thursday to Monday); the range covers a Wednesday Christmas at one
 * end and a two-day week 18 at the other.
 */
const COLUMNS: Record<number, string> = {
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
  7: 'lg:grid-cols-7',
  8: 'lg:grid-cols-8',
}

export function WeekCalendar({ games }: { games: GameForecast[] }) {
  if (!games.length) return null

  const byDay = new Map<string, GameForecast[]>()
  for (const game of games) {
    const day = easternDay(game.date_utc)
    const list = byDay.get(day)
    if (list) list.push(game)
    else byDay.set(day, [game])
  }

  const present = [...byDay.keys()].sort()
  const first = present[0]
  const last = present[present.length - 1]

  const days: { day: string; games: GameForecast[] }[] = []
  for (let cursor = first; cursor <= last; cursor = addDays(cursor, 1)) {
    days.push({
      day: cursor,
      games: [...(byDay.get(cursor) ?? [])].sort((a, b) =>
        a.date_utc.localeCompare(b.date_utc),
      ),
    })
  }

  // **Week 18 is one column, and that is the whole point of reading the span
  // from the fixtures.** The league plays the final week's sixteen games on a
  // single Sunday so that nothing is decided against a known result. A fixed
  // seven-column grid would draw six empty days beside it; one column would
  // stack sixteen chips into a tower. So the single-day case spreads its
  // games sideways INSIDE the day instead — still one column per day, still
  // no invented days.
  const single = days.length === 1

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-2',
        single ? '' : 'md:grid-cols-2',
        single ? '' : COLUMNS[days.length],
      )}
    >
      {days.map(({ day, games: slate }) => (
        <section
          key={day}
          className={cn(
            'rounded-sm border border-[var(--border-color)] p-2',
            slate.length ? '' : 'md:opacity-45',
          )}
        >
          <h3 className="mb-2 flex items-baseline justify-between gap-2 border-b border-[var(--border-color)] pb-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              {DAY.format(noon(day))} {MONTH.format(noon(day))}{' '}
              {DAY_NUMBER.format(noon(day))}
            </span>
            {slate.length ? (
              <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                {slate.length}
              </span>
            ) : null}
          </h3>

          {slate.length ? (
            <ul
              className={cn(
                'space-y-1',
                single
                  ? 'sm:grid sm:grid-cols-2 sm:gap-1 sm:space-y-0 lg:grid-cols-4'
                  : '',
              )}
            >
              {slate.map((game) => (
                <li key={game.game_id}>
                  <GameChip game={game} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-1 font-mono text-[10px] text-[var(--text-tertiary)]">
              No games
            </p>
          )}
        </section>
      ))}
    </div>
  )
}

/**
 * One game, at the smallest size that still says something.
 *
 * The favourite is named and its probability printed as text — never a bar or
 * a colour alone at this size, where a bar would be four pixels of hue
 * carrying the only number on the chip.
 *
 * **The team marks here are not separately clickable, deliberately.** The
 * whole chip is a link to the game, and an anchor inside an anchor is invalid
 * HTML that React refuses to hydrate. The team page is one further click from
 * the game page, where there is room to say which link is which.
 */
function GameChip({ game }: { game: GameForecast }) {
  const homeFavoured = game.p_home >= game.p_away

  return (
    <Link
      href={`/games/${game.game_id}`}
      className="block rounded-sm px-1.5 py-1.5 transition-colors hover:bg-[var(--card-hover)]"
      aria-label={`${game.away_name} at ${game.home_name}, ${TIME.format(new Date(game.date_utc))} Eastern. ${
        homeFavoured ? game.home_name : game.away_name
      } favoured at ${pct(homeFavoured ? game.p_home : game.p_away, 0)}.`}
    >
      <span className="mb-1 flex items-baseline justify-between gap-1">
        <span className="font-mono text-[9px] text-[var(--text-tertiary)]">
          {TIME.format(new Date(game.date_utc))}
        </span>
        {game.neutral_site ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--accent-warn)]">
            neutral
          </span>
        ) : null}
      </span>

      <ChipRow
        abbr={game.away}
        name={game.away_name}
        favoured={!homeFavoured}
        probability={game.p_away}
      />
      <ChipRow
        abbr={game.home}
        name={game.home_name}
        favoured={homeFavoured}
        probability={game.p_home}
      />
    </Link>
  )
}

function ChipRow({
  abbr,
  name,
  favoured,
  probability,
}: {
  abbr: string
  name: string
  favoured: boolean
  probability: number
}) {
  return (
    <span className="flex items-center gap-1.5">
      <TeamLogo abbreviation={abbr} name={name} size={14} />
      <span
        className={cn(
          'flex-1 truncate font-mono text-[11px]',
          favoured
            ? 'text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)]',
        )}
      >
        {abbr}
      </span>
      <span
        className={cn(
          'numeric text-[10px]',
          favoured
            ? 'text-[var(--accent-primary)]'
            : 'text-[var(--text-tertiary)]',
        )}
      >
        {pct(probability, 0)}
      </span>
    </span>
  )
}
