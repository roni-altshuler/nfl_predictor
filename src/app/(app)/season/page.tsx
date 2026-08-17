import { ConferenceRaceChart } from '@/components/charts/ConferenceRaceChart'
import { TeamLabel } from '@/components/primitives/TeamLogo'
import { byDivision, getSeasonProjections } from '@/lib/artifacts'
import { longshot, record, stamp } from '@/lib/format'
import { getConferenceRace, getLiveRace } from '@/lib/history'

export const dynamic = 'force-static'

export const metadata = { title: 'Season' }

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
  const race = getConferenceRace()
  const live = getLiveRace()

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

      {race ? (
        <section aria-label="The race">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              The race · {race.season}
            </h2>
            <span
              className={
                race.basis === 'live'
                  ? 'font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--accent-primary)]'
                  : 'font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--accent-warn)]'
              }
            >
              {race.basis === 'live' ? 'published in advance' : 'backtest'}
            </span>
          </div>

          {/* Two panels rather than one chart with 32 lines. Conference-title
              probability is only a distribution WITHIN a conference, so
              drawing both on one axis would put two separate unit-sum
              distributions on one scale and invite the reader to compare
              across them. */}
          <div className="grid gap-4 xl:grid-cols-2">
            {[
              'American Football Conference',
              'National Football Conference',
            ].map((conference) => (
              <div key={conference} className="card p-4">
                <h3 className="eyebrow mb-3">{conference}</h3>
                <ConferenceRaceChart race={race} conference={conference} />
              </div>
            ))}
          </div>

          {race.basis === 'backtest' ? (
            <p className="mt-3 font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
              This is {race.season} replayed, shown because the{' '}
              {projections.season} line does not exist yet — the live tracker
              has {live?.checkpoints?.length ?? 0} point
              {(live?.checkpoints?.length ?? 0) === 1 ? '' : 's'} and a line
              needs two. It is replaced by the live race the moment there are
              two days of published forecasts, and the two are never merged:
              one was read before the games and one was not.
            </p>
          ) : null}
        </section>
      ) : null}

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
                      <TeamLabel
                        abbreviation={team.abbreviation}
                        name={team.name}
                        size={20}
                        className="text-sm"
                      />
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
