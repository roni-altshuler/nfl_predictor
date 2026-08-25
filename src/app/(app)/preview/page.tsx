import Link from 'next/link'

import { KickoffCountdown } from '@/components/preview/KickoffCountdown'
import { TeamLabel } from '@/components/primitives/TeamLogo'
import { getArchivedSeason } from '@/lib/archive'
import {
  byDivision,
  getForecastLog,
  getGameForecasts,
  getSeasonProjections,
  type TeamProjection,
} from '@/lib/artifacts'
import { longshot, record, signed, stamp } from '@/lib/format'

export const dynamic = 'force-static'

export const metadata = { title: 'Season preview' }

/**
 * The season before it starts — ported in spirit from the NBA sibling.
 *
 * **The accountability section the NBA page carries is absent here for an
 * honest reason**: no opening-day projection artifact from last season was
 * archived, so there is nothing to grade. What CAN be said in advance is
 * said instead: the contenders, the projected movement against last
 * season's real records, the division favourites — and the fact that all
 * 272 game forecasts are already logged, so this season's record cannot be
 * quietly rewritten later.
 */
export default function PreviewPage() {
  const projections = getSeasonProjections()
  const forecasts = getGameForecasts()
  const log = getForecastLog()

  if (!projections) {
    return (
      <p className="font-mono text-sm text-[var(--text-tertiary)]">
        No projection published.
      </p>
    )
  }

  const lastSeason = getArchivedSeason(projections.season - 1)
  const lastRecords = new Map(
    (lastSeason?.standings ?? []).map((row) => [row.abbreviation, row]),
  )

  // Projected 2026 wins against last season's REAL record. Both are
  // 17-game seasons, so the delta is in games, not rates.
  const swings = projections.teams
    .map((team) => {
      const last = lastRecords.get(team.abbreviation)
      if (!last) return null
      return {
        team,
        lastWins: last.wins + 0.5 * last.ties,
        delta: team.wins + 0.5 * team.ties - (last.wins + 0.5 * last.ties),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.delta - a.delta)

  const risers = swings.slice(0, 5)
  const fallers = swings.slice(-5).reverse()

  const contenders = [...projections.teams]
    .sort((a, b) => b.p_championship - a.p_championship)
    .slice(0, 8)
  const maxTitle = contenders[0]?.p_championship ?? 0.01

  const divisions = byDivision(projections.teams).map((group) => ({
    ...group,
    favourite: [...group.teams].sort((a, b) => b.p_division - a.p_division)[0],
  }))

  const kickoff = forecasts?.season_start ?? forecasts?.games[0]?.date_utc ?? null

  return (
    <div className="space-y-10">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
          {projections.season} season
        </p>
        <h1 className="mt-2 text-3xl font-semibold uppercase tracking-[0.1em]">
          Season preview
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {kickoff ? <KickoffCountdown kickoffIso={kickoff} /> : null}
          <p className="font-mono text-[11px] text-[var(--text-tertiary)]">
            {kickoff
              ? `kicks off ${new Intl.DateTimeFormat('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  timeZone: 'America/New_York',
                }).format(new Date(kickoff))} · `
              : ''}
            {projections.simulations.toLocaleString()} simulated seasons ·
            published {stamp(projections.generated_at)}
          </p>
        </div>
      </header>

      {/* --------------------------------------------------- the contenders */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Who wins it
          </h2>
          <Link
            href="/bracket"
            className="font-mono text-[11px] text-[var(--accent-info)] hover:underline"
          >
            the bracket
          </Link>
        </div>
        <div className="card divide-y divide-[var(--border-color)]">
          {contenders.map((team, index) => (
            <div
              key={team.team_id}
              className="rise flex items-center gap-3 px-4 py-2.5"
              style={{ '--rise-i': index } as React.CSSProperties}
            >
              <span className="w-5 font-mono text-[11px] text-[var(--text-tertiary)]">
                {index + 1}
              </span>
              <TeamLabel
                abbreviation={team.abbreviation}
                name={team.name}
                size={22}
                className="w-44 shrink-0 text-sm sm:w-56"
              />
              <span className="hidden font-mono text-[11px] text-[var(--text-tertiary)] sm:block">
                {record(team.wins, team.losses, team.ties, 1)}
              </span>
              <span className="prob-track hidden flex-1 md:block">
                <span
                  className="prob-fill bar-grow block"
                  style={{
                    width: `${Math.max((team.p_championship / maxTitle) * 100, 2)}%`,
                  }}
                />
              </span>
              <span className="ml-auto w-14 text-right font-mono text-sm text-[var(--accent-primary)] md:ml-0">
                {longshot(team.p_championship)}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 font-mono text-[10px] text-[var(--text-tertiary)]">
          No injury or roster data, so these stay more concentrated than a
          futures market.
        </p>
      </section>

      {/* ------------------------------------------------------- the swings */}
      {risers.length ? (
        <section>
          <h2 className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Projected movement
          </h2>
          <p className="mb-3 font-mono text-[10px] text-[var(--text-tertiary)]">
            Projected {projections.season} wins against the{' '}
            {projections.season - 1} record actually posted.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <SwingBoard title="Rising" rows={risers} tone="up" />
            <SwingBoard title="Falling" rows={fallers} tone="down" />
          </div>
        </section>
      ) : null}

      {/* --------------------------------------------- division favourites */}
      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          Division favourites
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {divisions.map((group) => (
            <div key={group.division} className="card p-3">
              <p className="eyebrow mb-2">{group.division}</p>
              <div className="flex items-center justify-between gap-2">
                <TeamLabel
                  abbreviation={group.favourite.abbreviation}
                  name={group.favourite.name}
                  showAbbreviation
                  size={20}
                  className="text-sm"
                />
                <span className="font-mono text-sm text-[var(--text-primary)]">
                  {longshot(group.favourite.p_division)}
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 font-mono text-[10px] text-[var(--text-tertiary)]">
          Winners take seeds 1–4 regardless of record.
        </p>
      </section>

      {/* -------------------------------------------- the record starts now */}
      {log ? (
        <section className="card p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="eyebrow">The record starts at zero</h2>
            <Link
              href="/accuracy"
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent-info)] hover:underline"
            >
              the accounting
            </Link>
          </div>
          <dl className="grid grid-cols-3 gap-4">
            <div>
              <dt className="eyebrow">Forecasts logged</dt>
              <dd className="numeric mt-1 text-sm text-[var(--text-primary)]">
                {log.forecasts_made}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Games played</dt>
              <dd className="numeric mt-1 text-sm text-[var(--text-primary)]">
                {log.games_played}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Scored</dt>
              <dd className="numeric mt-1 text-sm text-[var(--text-primary)]">
                {log.n}
              </dd>
            </div>
          </dl>
          <p className="mt-3 border-t border-[var(--border-color)] pt-3 font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
            Every {projections.season} forecast is already logged, strictly
            before its kickoff — this season&apos;s record cannot be quietly
            rewritten later.
          </p>
        </section>
      ) : null}
    </div>
  )
}

function SwingBoard({
  title,
  rows,
  tone,
}: {
  title: string
  rows: { team: TeamProjection; lastWins: number; delta: number }[]
  tone: 'up' | 'down'
}) {
  return (
    <div className="card divide-y divide-[var(--border-color)]">
      <p className="eyebrow px-4 py-2.5">{title}</p>
      {rows.map(({ team, lastWins, delta }) => (
        <div key={team.team_id} className="flex items-center gap-3 px-4 py-2.5">
          <TeamLabel
            abbreviation={team.abbreviation}
            name={team.name}
            size={20}
            className="flex-1 text-sm"
          />
          <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
            {lastWins % 1 ? lastWins.toFixed(1) : lastWins} →{' '}
            {record(team.wins, team.losses, team.ties, 1)}
          </span>
          <span
            className={
              tone === 'up'
                ? 'w-12 text-right font-mono text-sm text-[var(--accent-primary)]'
                : 'w-12 text-right font-mono text-sm text-[var(--accent-loss)]'
            }
          >
            {signed(delta, 1)}
          </span>
        </div>
      ))}
    </div>
  )
}
