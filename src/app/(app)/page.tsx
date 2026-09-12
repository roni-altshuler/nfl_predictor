import Link from 'next/link'

import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import {
  FollowingStrip,
  type NextFixture,
} from '@/components/forecast/FollowingStrip'
import { SlateWithFilter } from '@/components/forecast/SlateWithFilter'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import {
  currentWeek,
  gamesForWeek,
  getGameForecasts,
  getPowerRatings,
  getSeasonProjections,
  type GameForecast,
  type PowerRatings,
  type SeasonProjections,
} from '@/lib/artifacts'
import { longshot, record, stamp } from '@/lib/format'

export const dynamic = 'force-static'

/**
 * The landing page: the next slate, the title race, the top of the power
 * ratings, and every franchise as a place to wander into.
 *
 * **The week shown is the next one to KICK OFF**, taken from the schedule
 * rather than from mapping today's date onto a week number. The NFL flexes
 * games between Sunday and Monday and plays Thursdays, so a date-derived
 * week is wrong for part of every week.
 *
 * 2026-09-12: the odds and ratings lists became bars (one number, one
 * shape, per row), the preseason paragraph became a chip, and two ways in
 * were added — quick-pick chips into `/predict` for every fixture on the
 * slate, and a 32-mark explorer grid into the team pages. Every number is
 * still read from a published artifact; the bars only scale them.
 */
export default function HomePage() {
  const forecasts = getGameForecasts()
  const projections = getSeasonProjections()
  const ratings = getPowerRatings()

  const week = currentWeek(forecasts)
  const slate = week === null ? [] : gamesForWeek(forecasts, week)
  const preseason = projections?.games_played === 0

  // Each team's next kickoff, for the Following strip. Computed at build —
  // the daily forecast deploy refreshes it, which is the cadence the
  // schedule itself changes at.
  const nextFixtures: Record<string, NextFixture> = {}
  const upcoming = [...(forecasts?.games ?? [])]
    .filter((g) => new Date(g.date_utc).getTime() >= Date.now())
    .sort((a, b) => a.date_utc.localeCompare(b.date_utc))
  for (const game of upcoming) {
    if (!(game.home in nextFixtures)) {
      nextFixtures[game.home] = {
        game_id: game.game_id,
        opponent: game.away,
        opponentName: game.away_name,
        home: true,
        date_utc: game.date_utc,
        p_win: game.p_home,
      }
    }
    if (!(game.away in nextFixtures)) {
      nextFixtures[game.away] = {
        game_id: game.game_id,
        opponent: game.home,
        opponentName: game.home_name,
        home: false,
        date_utc: game.date_utc,
        p_win: game.p_away,
      }
    }
  }

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
        // One line, not a paragraph. The honesty label stays: everything on
        // this page is projected, and the record is a walk-forward.
        <p className="chip text-[var(--accent-warn)]">
          <span>Preseason · projected from regressed ratings</span>
          <Link
            href="/accuracy"
            className="text-[var(--accent-info)] hover:underline"
          >
            the record →
          </Link>
        </p>
      ) : null}

      <FollowingStrip fixtures={nextFixtures} />

      {/* ------------------------------------------------------- the slate */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            The slate
          </h2>
          <Link
            href="/games"
            className="font-mono text-[11px] text-[var(--accent-info)] hover:underline"
          >
            full schedule
          </Link>
        </div>
        {slate.length === 0 ? (
          <p className="font-mono text-sm text-[var(--text-tertiary)]">
            No fixtures published.
          </p>
        ) : (
          <SlateWithFilter games={slate} />
        )}
      </section>

      {slate.length ? <QuickPicks games={slate} /> : null}

      {/* --------------------------------------------------- the title race */}
      {projections ? <TitleOdds projections={projections} /> : null}

      {/* ------------------------------------------------------- the ratings */}
      {ratings ? <RatingsLadder ratings={ratings} /> : null}

      {/* ------------------------------------------------------- the teams */}
      {projections || ratings ? (
        <TeamsExplorer projections={projections} ratings={ratings} />
      ) : null}

      <EvidencePanel />
    </div>
  )
}

/* ------------------------------------------------------------ sections */

function SectionHead({
  title,
  href,
  link,
}: {
  title: string
  href: string
  link: string
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
        {title}
      </h2>
      <Link
        href={href}
        className="font-mono text-[11px] text-[var(--accent-info)] hover:underline"
      >
        {link}
      </Link>
    </div>
  )
}

/**
 * Quick pick: one chip per fixture on the slate, each opening the
 * head-to-head picker prefilled. The picker prices a HYPOTHETICAL meeting
 * (neutral rest, week-1 conditions), so the number there can differ from
 * the card above it — that is the point of the tool, and the picker says
 * so on its own basis line.
 */
function QuickPicks({ games }: { games: GameForecast[] }) {
  return (
    <section aria-label="Quick pick">
      <SectionHead title="Price a matchup" href="/predict" link="any two teams" />
      <div className="flex flex-wrap gap-2">
        {games.map((game) => (
          <Link
            key={game.game_id}
            href={`/predict?home=${game.home}&away=${game.away}`}
            className="chip text-[var(--text-secondary)]"
            aria-label={`Price ${game.away} at ${game.home} in the head-to-head picker`}
          >
            <TeamLogo abbreviation={game.away} name={game.away_name} size={16} />
            <span>
              {game.away} @ {game.home}
            </span>
            <TeamLogo abbreviation={game.home} name={game.home_name} size={16} />
          </Link>
        ))}
      </div>
    </section>
  )
}

/**
 * Super Bowl odds as a labelled bar list. One series, one hue, every value
 * as text — the bar is scaled to the leader so the list reads as a shape,
 * and the number beside it is the fact.
 */
function TitleOdds({ projections }: { projections: SeasonProjections }) {
  const top = projections.teams.slice(0, 10)
  const max = Math.max(...top.map((t) => t.p_championship), 1e-9)
  return (
    <section aria-label="Super Bowl odds">
      <SectionHead title="Super Bowl odds" href="/season" link="all 32" />
      <ol className="card divide-y divide-[var(--border-color)]">
        {top.map((team, index) => (
          <li key={team.team_id}>
            <Link
              href={`/teams/${team.abbreviation}`}
              className="rise flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--card-hover)] sm:px-4"
              style={{ '--rise-i': index } as React.CSSProperties}
            >
              <span className="w-4 font-mono text-[11px] text-[var(--text-tertiary)]">
                {index + 1}
              </span>
              <TeamLogo
                abbreviation={team.abbreviation}
                name={team.name}
                size={22}
              />
              <span className="w-12 shrink-0 truncate text-sm text-[var(--text-secondary)] sm:w-44">
                <span className="sm:hidden">{team.abbreviation}</span>
                <span className="hidden sm:inline">{team.name}</span>
              </span>
              <span
                className="prob-track flex-1"
                role="img"
                aria-label={`${longshot(team.p_championship)} of simulated seasons`}
              >
                <span
                  className="prob-fill bar-grow block"
                  style={{ width: `${(team.p_championship / max) * 100}%` }}
                />
              </span>
              <span className="hidden w-14 text-right font-mono text-[11px] text-[var(--text-tertiary)] sm:inline">
                {record(team.wins, team.losses, team.ties, 1)}
              </span>
              <span className="numeric w-14 text-right text-sm text-[var(--text-primary)]">
                {longshot(team.p_championship)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="mt-2 font-mono text-[10px] text-[var(--text-tertiary)]">
        {projections.simulations.toLocaleString()} simulated seasons — no
        injury or roster data, so more concentrated than a futures market.
      </p>
    </section>
  )
}

/**
 * The top of the power ratings as a ladder. Bars scale between the
 * published worst and best of all 32 — from zero, every bar is nearly full
 * and says nothing.
 */
function RatingsLadder({ ratings }: { ratings: PowerRatings }) {
  const values = ratings.teams.map((t) => t.elo)
  const best = Math.max(...values)
  const worst = Math.min(...values)
  const span = Math.max(best - worst, 1)
  return (
    <section aria-label="Power ratings">
      <SectionHead title="Power ratings" href="/ratings" link="all 32" />
      <ol className="card divide-y divide-[var(--border-color)]">
        {ratings.teams.slice(0, 8).map((team, index) => (
          <li key={team.team_id}>
            <Link
              href={`/teams/${team.abbreviation}`}
              className="rise flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--card-hover)] sm:px-4"
              style={{ '--rise-i': index } as React.CSSProperties}
            >
              <span className="w-4 font-mono text-[11px] text-[var(--text-tertiary)]">
                {index + 1}
              </span>
              <TeamLogo
                abbreviation={team.abbreviation}
                name={team.name}
                size={22}
              />
              <span className="w-12 shrink-0 truncate text-sm text-[var(--text-secondary)] sm:w-44">
                <span className="sm:hidden">{team.abbreviation}</span>
                <span className="hidden sm:inline">{team.name}</span>
              </span>
              <span
                className="prob-track flex-1"
                role="img"
                aria-label={`Relative strength ${Math.round(((team.elo - worst) / span) * 100)} of 100`}
              >
                <span
                  className="prob-fill bar-grow block"
                  style={{ width: `${((team.elo - worst) / span) * 100}%` }}
                />
              </span>
              <span className="numeric w-12 text-right text-sm text-[var(--text-primary)]">
                {team.elo.toFixed(0)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="mt-2 font-mono text-[10px] text-[var(--text-tertiary)]">
        Elo, bars scaled from the league&apos;s worst ({worst.toFixed(0)}) to
        its best ({best.toFixed(0)}).
      </p>
    </section>
  )
}

/**
 * Every franchise as a mark, conference by division — a place to wander.
 *
 * The caption is the projected record when a projection is published and
 * the rating otherwise; the two are never mixed on one grid. Every mark is
 * a link to the team page, which is what the marks exist for.
 */
function TeamsExplorer({
  projections,
  ratings,
}: {
  projections: SeasonProjections | null
  ratings: PowerRatings | null
}) {
  type Mark = {
    abbreviation: string
    name: string
    division: string
    caption: string
    sort: number
  }
  const marks: Mark[] = projections
    ? projections.teams.map((t) => ({
        abbreviation: t.abbreviation,
        name: t.name,
        division: t.division,
        caption: record(t.wins, t.losses, t.ties, 1),
        sort: t.wins,
      }))
    : (ratings?.teams ?? []).map((t) => ({
        abbreviation: t.abbreviation,
        name: t.name,
        division: t.division,
        caption: t.elo.toFixed(0),
        sort: t.elo,
      }))
  if (!marks.length) return null

  const DIVISIONS = ['East', 'North', 'South', 'West']
  const conferences = ['AFC', 'NFC'].map((conference) => ({
    conference,
    divisions: DIVISIONS.map((name) => ({
      name: `${conference} ${name}`,
      teams: marks
        .filter((m) => m.division === `${conference} ${name}`)
        .sort((a, b) => b.sort - a.sort),
    })).filter((d) => d.teams.length),
  }))

  return (
    <section aria-label="Teams">
      <SectionHead
        title={projections ? 'Teams · projected record' : 'Teams · rating'}
        href="/ratings"
        link="all 32"
      />
      <div className="grid gap-6 md:grid-cols-2">
        {conferences.map((conf) => (
          <div key={conf.conference} className="space-y-4">
            {conf.divisions.map((division) => (
              <div key={division.name}>
                <p className="eyebrow mb-2">{division.name}</p>
                <div className="grid grid-cols-4 gap-2">
                  {division.teams.map((team) => (
                    <Link
                      key={team.abbreviation}
                      href={`/teams/${team.abbreviation}`}
                      className="card flex flex-col items-center gap-1 px-1 py-2.5 text-center hover:bg-[var(--card-hover)]"
                      aria-label={`${team.name}, ${team.caption}`}
                    >
                      <TeamLogo
                        abbreviation={team.abbreviation}
                        name={team.name}
                        size={32}
                      />
                      <span className="font-mono text-[11px] text-[var(--text-primary)]">
                        {team.abbreviation}
                      </span>
                      <span className="numeric text-[10px] text-[var(--text-tertiary)]">
                        {team.caption}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
