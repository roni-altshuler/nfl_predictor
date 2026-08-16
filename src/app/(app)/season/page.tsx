import { byDivision, getSeasonProjections } from '@/lib/artifacts'
import { logoUrl, longshot, pct, record, stamp } from '@/lib/format'

export const dynamic = 'force-static'

/**
 * Projected standings, by division.
 *
 * **Grouped by division rather than ranked by conference**, because the NFL
 * seeds four division winners into the top four slots regardless of record.
 * A flat conference table ordered by wins — which is what the sibling NBA
 * project renders, correctly, for basketball — would put a 12-win wild card
 * above a 9-win division leader and imply a seeding that will not happen.
 *
 * The win-total interval is p10-p90 and it is WIDE. That is the sport: over
 * 17 games a true .600 team's record has a binomial standard deviation of
 * about two wins, so a narrow interval here would be wrong rather than
 * confident.
 */
export default function SeasonPage() {
  const projections = getSeasonProjections()

  if (!projections) {
    return (
      <p className="font-mono text-sm text-[var(--text-tertiary)]">
        No projection published.
      </p>
    )
  }

  const groups = byDivision(projections.teams)

  return (
    <div className="space-y-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
          {projections.season} projection
        </p>
        <h1 className="mt-2 text-3xl font-semibold uppercase tracking-[0.1em]">
          Season
        </h1>
        <p className="mt-2 font-mono text-[11px] text-[var(--text-tertiary)]">
          {projections.simulations.toLocaleString()} simulated seasons ·{' '}
          {projections.games_played} played, {projections.games_remaining}{' '}
          remaining · published {stamp(projections.generated_at)}
        </p>
      </header>

      {groups.map((group) => (
        <section key={`${group.conference}-${group.division}`}>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            {group.division}
          </h2>
          <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--card-bg)]">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-color)] text-left">
                  {['team', 'proj', 'range', 'div', 'playoff', 'bye', 'title'].map(
                    (label) => (
                      <th
                        key={label}
                        className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)] last:text-right"
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {group.teams.map((team) => (
                  <tr
                    key={team.team_id}
                    className="border-b border-[var(--border-color)] last:border-0"
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={logoUrl(team.abbreviation)}
                          alt=""
                          width={20}
                          height={20}
                          className="h-5 w-5 rounded bg-white/90 p-0.5"
                        />
                        <span className="truncate text-sm text-[var(--text-secondary)]">
                          {team.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-sm text-[var(--text-primary)]">
                      {record(team.wins, team.losses, team.ties, 1)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-tertiary)]">
                      {team.wins_p10.toFixed(0)}–{team.wins_p90.toFixed(0)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
                      {longshot(team.p_division)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
                      {longshot(team.p_playoffs)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-tertiary)]">
                      {longshot(team.p_bye)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-[var(--accent-primary)]">
                      {longshot(team.p_championship)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <p className="font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        Win totals count a tie as half a win, which is the league&apos;s own
        definition. The p10–p90 range is deliberately wide: seventeen games is
        a short season and luck outranks skill over ordinary ranges.
      </p>
    </div>
  )
}
