import Link from 'next/link'
import { notFound } from 'next/navigation'

import { RatingHistoryChart } from '@/components/charts/RatingHistoryChart'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import {
  getGameForecasts,
  getPowerRatings,
  getSeasonProjections,
} from '@/lib/artifacts'
import { kickoff, longshot, pct, record, signed } from '@/lib/format'
import {
  formFor,
  getTeamHistory,
  recordFor,
  recordLine,
  type SeasonRecord,
} from '@/lib/history'

export const dynamic = 'force-static'

export function generateStaticParams() {
  return (getPowerRatings()?.teams ?? []).map((team) => ({
    abbr: team.abbreviation,
  }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ abbr: string }>
}) {
  const { abbr } = await params
  const team = getPowerRatings()?.teams.find(
    (t) => t.abbreviation.toLowerCase() === abbr.toLowerCase(),
  )
  return { title: team?.name ?? abbr }
}

/**
 * One franchise.
 *
 * **This page is why every team mark on the site is a link.** A mark that
 * does nothing when clicked is the second most common complaint a table like
 * `/ratings` gets, after a fixture that does nothing when clicked. So the
 * destination has to carry what a row cannot: twenty-four seasons of rating
 * against the league, the seed distribution behind the single playoff
 * percentage, every remaining fixture priced, and the season-by-season record
 * the rating was earned on.
 *
 * Everything here is read from published artifacts. Nothing on this page
 * computes a probability.
 */
export default async function TeamPage({
  params,
}: {
  params: Promise<{ abbr: string }>
}) {
  const { abbr } = await params
  const key = abbr.toUpperCase()

  const ratings = getPowerRatings()
  const index = (ratings?.teams ?? []).findIndex(
    (t) => t.abbreviation.toUpperCase() === key,
  )
  const team = index >= 0 ? ratings!.teams[index] : undefined
  if (!team) notFound()

  const projections = getSeasonProjections()
  const projection = projections?.teams.find((t) => t.team_id === team.team_id)

  const forecasts = getGameForecasts()
  const fixtures = (forecasts?.games ?? [])
    .filter((g) => g.home === team.abbreviation || g.away === team.abbreviation)
    .sort((a, b) => a.date_utc.localeCompare(b.date_utc))

  const history = getTeamHistory()
  const seasonRecords = [...(history?.records[team.abbreviation] ?? [])].reverse()
  const form = formFor(team.abbreviation)
  const liveRecord = recordFor(team.abbreviation)

  return (
    <div className="space-y-8">
      <header>
        <Link
          href="/ratings"
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
        >
          ← All 32
        </Link>
        <div className="mt-3 flex items-center gap-4">
          <TeamLogo abbreviation={team.abbreviation} name={team.name} size={56} />
          <div className="min-w-0">
            <h1 className="text-2xl">{team.name}</h1>
            <p className="mt-1 font-mono text-[11px] text-[var(--text-tertiary)]">
              {team.division} · power rating #{index + 1} of{' '}
              {ratings!.teams.length}
              {liveRecord && liveRecord.wins + liveRecord.losses + liveRecord.ties > 0
                ? ` · ${recordLine(liveRecord)} this season`
                : ''}
            </p>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Elo" value={team.elo.toFixed(0)} />
        {projection ? (
          <>
            <Tile
              label="Projected"
              value={record(
                projection.wins,
                projection.losses,
                projection.ties,
                1,
              )}
            />
            <Tile label="Playoffs" value={longshot(projection.p_playoffs)} />
            <Tile label="Super Bowl" value={longshot(projection.p_championship)} />
          </>
        ) : (
          <Tile label="Projection" value="—" />
        )}
      </section>

      {history && history.seasons.length > 2 ? (
        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Rating history
          </h2>
          <div className="card p-4">
            <RatingHistoryChart
              seasons={history.seasons}
              values={history.elo[team.abbreviation] ?? []}
              band={history.band}
              label={team.name}
            />
          </div>
        </section>
      ) : null}

      {projection && Object.keys(projection.seed_distribution).length ? (
        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Where they seed
          </h2>
          <div className="card p-4">
            <SeedDistribution
              distribution={projection.seed_distribution}
              seeds={projections?.seeds_per_conference ?? 7}
            />
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          {forecasts?.season ?? ''} schedule
        </h2>
        {fixtures.length ? (
          <div className="card divide-y divide-[var(--border-color)]">
            {fixtures.map((game) => {
              const isHome = game.home === team.abbreviation
              const opponent = isHome ? game.away : game.home
              const opponentName = isHome ? game.away_name : game.home_name
              const win = isHome ? game.p_home : game.p_away
              return (
                <Link
                  key={game.game_id}
                  href={`/games/${game.game_id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 transition-colors hover:bg-[var(--card-hover)]"
                >
                  <span className="w-12 shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">
                    wk {game.week}
                  </span>
                  <span className="w-8 shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">
                    {game.neutral_site ? 'vs' : isHome ? 'vs' : '@'}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <TeamLogo
                      abbreviation={opponent}
                      name={opponentName}
                      size={18}
                    />
                    <span className="truncate text-sm text-[var(--text-secondary)]">
                      {opponentName}
                    </span>
                  </span>
                  <span className="ml-auto flex items-baseline gap-3">
                    <span className="hidden font-mono text-[10px] text-[var(--text-tertiary)] sm:inline">
                      {kickoff(game.date_utc)}
                    </span>
                    <span
                      className={
                        win >= 0.5
                          ? 'numeric w-14 text-right text-sm text-[var(--accent-primary)]'
                          : 'numeric w-14 text-right text-sm text-[var(--text-tertiary)]'
                      }
                    >
                      {pct(win)}
                    </span>
                  </span>
                </Link>
              )
            })}
          </div>
        ) : (
          <p className="card p-4 font-mono text-[11px] text-[var(--text-tertiary)]">
            No scheduled fixtures in the published forecast.
          </p>
        )}
      </section>

      {form.length ? (
        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Last {form.length}
          </h2>
          <div className="card divide-y divide-[var(--border-color)]">
            {form.map((game) => (
              <Link
                key={game.game_id}
                href={`/games/${game.game_id}`}
                className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--card-hover)]"
              >
                <span className="w-20 shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">
                  {game.date}
                </span>
                <span className="w-6 shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">
                  {game.home ? 'vs' : '@'}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <TeamLogo abbreviation={game.opponent} size={16} />
                  <span className="truncate font-mono text-[12px] text-[var(--text-secondary)]">
                    {game.opponent}
                  </span>
                </span>
                <span className="numeric text-[12px] text-[var(--text-secondary)]">
                  {game.scored}–{game.allowed}
                </span>
                <span
                  className={
                    game.result === 'W'
                      ? 'numeric w-4 text-right text-[12px] text-[var(--accent-primary)]'
                      : game.result === 'L'
                        ? 'numeric w-4 text-right text-[12px] text-[var(--accent-loss)]'
                        : 'numeric w-4 text-right text-[12px] text-[var(--accent-warn)]'
                  }
                >
                  {game.result}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {seasonRecords.length ? (
        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Season by season
          </h2>
          <div className="card overflow-x-auto">
            <table className="min-w-[460px]">
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col" className="numeric text-right">Record</th>
                  <th scope="col" className="numeric text-right">PF</th>
                  <th scope="col" className="numeric text-right">PA</th>
                  <th scope="col" className="numeric text-right">Diff</th>
                  <th scope="col" className="numeric text-right">Elo</th>
                  <th scope="col" className="text-right">Postseason</th>
                </tr>
              </thead>
              <tbody>
                {seasonRecords.map((season) => (
                  <SeasonRow
                    key={season.season}
                    season={season}
                    elo={eloFor(history, team.abbreviation, season.season)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
            Records are regular season only — a team that went 13-4 and then
            lost a wild-card game is 13-4, and folding the playoff loss in
            would print a record the league never published. The Elo column is
            where the rating finished, including any postseason run.
          </p>
        </section>
      ) : null}
    </div>
  )
}

/* --------------------------------------------------------------- pieces */

function SeasonRow({
  season,
  elo,
}: {
  season: SeasonRecord
  elo: number | null
}) {
  const diff = season.points_for - season.points_against
  return (
    <tr>
      <td className="numeric">{season.season}</td>
      <td className="numeric text-right text-[var(--text-primary)]">
        {season.wins}-{season.losses}
        {season.ties ? `-${season.ties}` : ''}
      </td>
      <td className="numeric text-right">{season.points_for}</td>
      <td className="numeric text-right">{season.points_against}</td>
      <td
        className={
          diff >= 0
            ? 'numeric text-right text-[var(--accent-primary)]'
            : 'numeric text-right text-[var(--accent-loss)]'
        }
      >
        {signed(diff, 0)}
      </td>
      <td className="numeric text-right text-[var(--text-secondary)]">
        {elo === null ? '—' : elo.toFixed(0)}
      </td>
      <td className="text-right font-mono text-[11px] text-[var(--text-tertiary)]">
        {season.postseason ? 'yes' : '—'}
      </td>
    </tr>
  )
}

function eloFor(
  history: ReturnType<typeof getTeamHistory>,
  abbreviation: string,
  season: number,
): number | null {
  if (!history) return null
  const index = history.seasons.indexOf(season)
  if (index < 0) return null
  return history.elo[abbreviation]?.[index] ?? null
}

/**
 * Seed likelihood as a sequential ramp — one hue, more-is-darker, never a
 * rainbow. The number is printed beside every bar because colour alone never
 * carries a value on this site.
 *
 * **The cut line is drawn where the conference's field ends**, which is 7
 * from 2020 and 6 before it. Hard-coding either would silently misdraw twenty
 * seasons or every future one.
 */
function SeedDistribution({
  distribution,
  seeds,
}: {
  distribution: Record<string, number>
  seeds: number
}) {
  const entries = Object.entries(distribution)
    .map(([seed, p]) => ({ seed: Number(seed), p }))
    .sort((a, b) => a.seed - b.seed)
  const max = Math.max(...entries.map((e) => e.p), 0.01)

  return (
    <div className="space-y-1.5">
      {entries.map(({ seed, p }) => (
        <div key={seed} className="flex items-center gap-3">
          <span className="w-8 shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">
            #{seed}
          </span>
          <div className="prob-track flex-1">
            <div
              className="h-full"
              style={{ width: `${(p / max) * 100}%`, background: rampStep(p / max) }}
            />
          </div>
          <span className="numeric w-14 shrink-0 text-right text-[11px] text-[var(--text-secondary)]">
            {longshot(p)}
          </span>
        </div>
      ))}
      <p className="pt-2 font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        Conference seed at the end of the regular season. Seeds 1–{seeds}{' '}
        qualify; the top seed gets the bye. Seeds 1–4 go to division winners
        regardless of record, so this is not a ranking by wins.
      </p>
    </div>
  )
}

function rampStep(t: number): string {
  if (t > 0.8) return 'var(--viz-seq-5)'
  if (t > 0.6) return 'var(--viz-seq-4)'
  if (t > 0.4) return 'var(--viz-seq-3)'
  if (t > 0.2) return 'var(--viz-seq-2)'
  return 'var(--viz-seq-1)'
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <p className="eyebrow">{label}</p>
      <p className="numeric mt-1 text-lg text-[var(--text-primary)]">{value}</p>
    </div>
  )
}
