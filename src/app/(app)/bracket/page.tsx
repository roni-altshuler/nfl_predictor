import Link from 'next/link'

import { ProjectedBracket } from '@/components/playoffs/ProjectedBracket'
import { TeamLabel } from '@/components/primitives/TeamLogo'
import { getSeasonProjections } from '@/lib/artifacts'
import { longshot, record, stamp } from '@/lib/format'
import { getSeasonsIndex } from '@/lib/archive'

export const dynamic = 'force-static'

export const metadata = { title: 'Road to the Super Bowl' }

/**
 * The projected postseason.
 *
 * The board is the headline; the table underneath is the same distribution
 * written out, because a bracket can only show one occupant per cell and the
 * interesting fact about most of these cells is how close the second name is.
 */
export default function BracketPage() {
  const projections = getSeasonProjections()
  const archive = getSeasonsIndex()

  if (!projections) {
    return (
      <p className="font-mono text-sm text-[var(--text-tertiary)]">
        No projection published.
      </p>
    )
  }

  const byes = projections.season >= 2020 ? 1 : 2
  const conferences = [...new Set(projections.teams.map((t) => t.conference))].sort()

  return (
    <div className="space-y-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
          {projections.season} · {projections.simulations.toLocaleString()}{' '}
          simulated seasons
        </p>
        <h1 className="mt-2 text-3xl font-semibold uppercase tracking-[0.1em]">
          Road to the Super Bowl
        </h1>
        <p className="mt-2 font-mono text-[11px] text-[var(--text-tertiary)]">
          {projections.seeds_per_conference} seeds per conference ·{' '}
          {byes === 1 ? 'one bye' : 'two byes'} · published{' '}
          {stamp(projections.generated_at)}
        </p>
      </header>

      <section className="card p-4">
        <ProjectedBracket
          teams={projections.teams}
          seedsPerConference={projections.seeds_per_conference}
          byesPerConference={byes}
        />
      </section>

      {conferences.map((conference) => {
        const teams = [...projections.teams]
          .filter((t) => t.conference === conference)
          .sort((a, b) => b.p_conference_title - a.p_conference_title)
          .slice(0, 10)
        return (
          <section key={conference}>
            <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              {conference} · round by round
            </h2>
            <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--card-bg)]">
              <table className="w-full min-w-[620px] border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border-color)] text-left">
                    {['team', 'proj', 'make it', 'bye', 'divisional', 'conf game', 'conf title', 'super bowl'].map(
                      (label) => (
                        <th
                          key={label}
                          className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
                        >
                          {label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => (
                    <tr
                      key={team.team_id}
                      className="border-b border-[var(--border-color)] last:border-0"
                    >
                      <td className="px-3 py-2.5">
                        <TeamLabel
                          abbreviation={team.abbreviation}
                          name={team.name}
                          size={20}
                          className="text-sm"
                        />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-primary)]">
                        {record(team.wins, team.losses, team.ties, 1)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-primary)]">
                        {longshot(team.p_playoffs)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-tertiary)]">
                        {longshot(team.p_bye)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
                        {longshot(team.p_divisional_round)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
                        {longshot(team.p_conference_game)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
                        {longshot(team.p_conference_title)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--accent-primary)]">
                        {longshot(team.p_championship)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
              Every column is a marginal probability over{' '}
              {projections.simulations.toLocaleString()} simulated seasons, so
              each one already accounts for every path a team could take to get
              there. They are not multiplied down the row — a bye makes the next
              round easier, and the columns are not independent.
            </p>
          </section>
        )
      })}

      {archive?.seasons?.length ? (
        <section>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Brackets that were played
          </h2>
          <div className="flex flex-wrap gap-2">
            {archive.seasons.slice(0, 12).map((season) => (
              <Link
                key={season.season}
                href={`/seasons/${season.season}`}
                className="rounded-sm border border-[var(--border-color)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-secondary)]"
              >
                {season.season}
                {season.champion ? (
                  <span className="ml-2 text-[var(--accent-primary)]">
                    {season.champion}
                  </span>
                ) : null}
              </Link>
            ))}
            <Link
              href="/seasons"
              className="rounded-sm border border-[var(--border-color)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--accent-info)] transition-colors hover:border-[var(--border-hover)]"
            >
              all {archive.seasons.length} seasons →
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  )
}
