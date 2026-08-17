import { TeamLabel } from '@/components/primitives/TeamLogo'
import { getSeasonProjections } from '@/lib/artifacts'
import { longshot, record } from '@/lib/format'

export const dynamic = 'force-static'

export const metadata = { title: 'Playoff picture' }

/**
 * The playoff picture, by conference.
 *
 * **Ordered by playoff probability, and the seed column is a DISTRIBUTION
 * rather than a projected seed.** Advancing a modal seeding and printing it
 * as "the bracket" compounds one assumption four rounds deep; the sibling
 * NBA project makes the same call for the same reason. What a team actually
 * has is a spread over seeds, and the top-seed column is the part of it that
 * carries the bye.
 */
export default function PlayoffsPage() {
  const projections = getSeasonProjections()

  if (!projections) {
    return (
      <p className="font-mono text-sm text-[var(--text-tertiary)]">
        No projection published.
      </p>
    )
  }

  const conferences = [
    ...new Set(projections.teams.map((t) => t.conference)),
  ].sort()

  return (
    <div className="space-y-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
          {projections.season} · {projections.seeds_per_conference} seeds per
          conference
        </p>
        <h1 className="mt-2 text-3xl font-semibold uppercase tracking-[0.1em]">
          Playoff picture
        </h1>
      </header>

      {conferences.map((conference) => {
        const teams = projections.teams
          .filter((t) => t.conference === conference)
          .sort((a, b) => b.p_playoffs - a.p_playoffs)
        return (
          <section key={conference}>
            <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              {conference}
            </h2>
            <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--card-bg)]">
              <table className="w-full min-w-[600px] border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border-color)] text-left">
                    {['team', 'proj', 'division', 'playoff', 'bye', 'conf', 'title'].map(
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
                  {teams.map((team, index) => (
                    <tr
                      key={team.team_id}
                      className={
                        index === projections.seeds_per_conference - 1
                          ? 'border-b-2 border-[var(--accent-warn)]'
                          : 'border-b border-[var(--border-color)] last:border-0'
                      }
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="w-4 shrink-0 font-mono text-[10px] text-[var(--text-tertiary)]">
                            {index + 1}
                          </span>
                          <TeamLabel
                            abbreviation={team.abbreviation}
                            name={team.name}
                            size={20}
                            className="text-sm"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-primary)]">
                        {record(team.wins, team.losses, team.ties, 1)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
                        {longshot(team.p_division)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-primary)]">
                        {longshot(team.p_playoffs)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-tertiary)]">
                        {longshot(team.p_bye)}
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
            <p className="mt-2 font-mono text-[10px] text-[var(--text-tertiary)]">
              The rule above the line is the cut. Seeds 1–4 go to division
              winners regardless of record, so a team can sit below the line on
              probability and still be favoured to host a game.
            </p>
          </section>
        )
      })}
    </div>
  )
}
