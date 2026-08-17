import Link from 'next/link'
import { notFound } from 'next/navigation'

import { MarginDistribution } from '@/components/charts/MarginDistribution'
import { getGameForecasts, type GameForecast } from '@/lib/artifacts'
import { getGameDetail, type GameDetail } from '@/lib/espn'
import {
  getGameContext,
  meetingsBetween,
  recordLine,
  seriesSplit,
  type FormGame,
  type Meeting,
} from '@/lib/history'
import { kickoff, logoUrl, moneyline, pct, signed, spread } from '@/lib/format'

// The 272 scheduled fixtures are prerendered. A played game resolves from
// the published context at request time and is cached for a day, so the
// archive is explorable without prerendering thousands of pages that almost
// nobody opens.
export const dynamic = 'force-static'
export const dynamicParams = true
export const revalidate = 86_400

export function generateStaticParams() {
  return (getGameForecasts()?.games ?? []).map((game) => ({ id: game.game_id }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const upcoming = getGameForecasts()?.games.find((g) => g.game_id === id)
  if (upcoming) {
    return { title: `${upcoming.away} at ${upcoming.home} · Week ${upcoming.week}` }
  }
  const played = findPlayedGame(id)
  if (played) return { title: `${played.away} at ${played.home} · ${played.season}` }
  return { title: 'Game' }
}

/** Resolve a played game from the published meeting index. */
function findPlayedGame(id: string): Meeting | null {
  const context = getGameContext()
  if (!context) return null
  for (const meetings of Object.values(context.meetings)) {
    const hit = meetings.find((m) => m.game_id === id)
    if (hit) return hit
  }
  return null
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const upcoming = getGameForecasts()?.games.find((g) => g.game_id === id)
  if (upcoming) {
    // Injuries and the ESPN summary are only fetched on the branch that can
    // use them. On an archived fixture an injury report would be today's
    // news about a game played years ago, which is worse than nothing.
    const detail = await getGameDetail(id, upcoming.home, upcoming.away)
    return <UpcomingGame game={upcoming} detail={detail} />
  }

  const played = findPlayedGame(id)
  if (played) {
    const detail = await getGameDetail(id, played.home, played.away)
    return <PlayedGame game={played} detail={detail} />
  }

  notFound()
}

/* ------------------------------------------------------------- upcoming */

function UpcomingGame({
  game,
  detail,
}: {
  game: GameForecast
  detail: GameDetail
}) {
  const meetings = meetingsBetween(game.home, game.away)
  const split = seriesSplit(meetings, game.home)
  const market = game.market
  const hasLine =
    market.spread_home !== null ||
    (market.ml_home !== null && market.ml_away !== null)

  // The market's own line, pulled out of the published surface so the page
  // can show what the model says about the number actually being traded.
  const atMarket =
    market.spread_home !== null
      ? game.spread_surface.find((r) => r.line === market.spread_home)
      : undefined

  return (
    <div className="space-y-6">
      <GameHeader game={game} />

      <section className="card p-4" aria-label="Forecast">
        <h2 className="eyebrow mb-3">Forecast</h2>
        <ProbabilityRow game={game} />

        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--border-color)] pt-4 sm:grid-cols-4">
          <Stat
            label="Projected margin"
            value={`${game.exp_margin >= 0 ? game.home : game.away} ${signed(Math.abs(game.exp_margin))}`}
          />
          <Stat label="Projected total" value={game.exp_total.toFixed(1)} />
          <Stat
            label="Projected score"
            value={`${Math.round(game.exp_away_score)}–${Math.round(game.exp_home_score)}`}
          />
          <Stat label="Margin sd" value={game.margin_sd.toFixed(1)} />
        </dl>
      </section>

      {/* The distinctive surface. Every sibling project shows a win
          probability; this is the one that shows football's lattice. */}
      {game.margin_distribution ? (
        <section className="card p-4" aria-label="Margin distribution">
          <h2 className="eyebrow mb-1">How it is likely to finish</h2>
          <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            Football margins are not smooth. Three and seven points are the
            two most likely results of any game, because that is what a field
            goal and a touchdown are worth — a normal curve fitted to these
            games would draw a tidy bell straight through it.
          </p>
          <MarginDistribution
            data={game.margin_distribution}
            home={game.home}
            away={game.away}
          />
        </section>
      ) : null}

      {game.spread_surface?.length ? (
        <section className="card p-4" aria-label="Against the spread">
          <h2 className="eyebrow mb-1">Against the spread</h2>
          <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            A bet on a whole number can win, lose <em>or push</em>. At −3 the
            push is worth roughly one game in twelve, and a model that assumes
            a continuous margin prices it at zero.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-[420px]">
              <thead>
                <tr>
                  <th scope="col">{game.home} line</th>
                  <th scope="col" className="numeric text-right">covers</th>
                  <th scope="col" className="numeric text-right">push</th>
                  <th scope="col" className="numeric text-right">{game.away} covers</th>
                </tr>
              </thead>
              <tbody>
                {game.spread_surface.map((row) => {
                  const isMarket = row.line === market.spread_home
                  return (
                    <tr key={row.line}>
                      <td
                        className={
                          isMarket
                            ? 'numeric text-[var(--accent-market)]'
                            : 'numeric'
                        }
                      >
                        {spread(row.line)}
                        {isMarket ? ' · market' : ''}
                      </td>
                      <td className="numeric text-right">{pct(row.home_cover)}</td>
                      <td
                        className={
                          row.push >= 0.04
                            ? 'numeric text-right text-[var(--accent-warn)]'
                            : 'numeric text-right text-[var(--text-tertiary)]'
                        }
                      >
                        {row.push < 0.0005 ? '—' : pct(row.push)}
                      </td>
                      <td className="numeric text-right">{pct(row.away_cover)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card p-4" aria-label="Market">
        <h2 className="eyebrow mb-3">The market</h2>
        {hasLine ? (
          <>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Spread" value={spread(market.spread_home)} />
              <Stat
                label="Total"
                value={market.total_points?.toFixed(1) ?? '—'}
              />
              <Stat label={`${game.home} ML`} value={moneyline(market.ml_home)} />
              <Stat label={`${game.away} ML`} value={moneyline(market.ml_away)} />
            </dl>
            {atMarket ? (
              <p className="mt-4 border-t border-[var(--border-color)] pt-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                At the market&apos;s {spread(market.spread_home)}, the model
                gives {game.home} {pct(atMarket.home_cover)} to cover and{' '}
                {pct(atMarket.away_cover)} against
                {atMarket.push < 0.0005 ? (
                  <>
                    . A half-point line{' '}
                    <strong className="text-[var(--text-primary)]">
                      cannot push
                    </strong>
                    , which is exactly what the hook is bought for — at the
                    whole number beside it the push is worth{' '}
                    {pct(
                      game.spread_surface.find(
                        (r) => r.line === Math.trunc(market.spread_home ?? 0),
                      )?.push ?? 0,
                    )}
                    .
                  </>
                ) : (
                  <>, with {pct(atMarket.push)} on the push.</>
                )}
              </p>
            ) : null}
            <p className="mt-3 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
              Provider {market.provider ?? 'unknown'}. The market is the
              benchmark here, not the target — it beats this model by a
              published margin.
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--text-tertiary)]">
            No line published for this game. That is different from an even
            line, and it is rendered differently.
          </p>
        )}
      </section>

      <Availability detail={detail} game={game} />

      <HeadToHead
        meetings={meetings}
        split={split}
        home={game.home}
        away={game.away}
      />

      <FormBlock home={game.home} away={game.away} />
    </div>
  )
}

/* --------------------------------------------------------------- played */

function PlayedGame({
  game,
  detail,
}: {
  game: Meeting
  detail: GameDetail
}) {
  const meetings = meetingsBetween(game.home, game.away).filter(
    (m) => m.game_id !== game.game_id,
  )
  const split = seriesSplit(meetings, game.home)
  const tie = game.home_score === game.away_score

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">
          {game.season} · {game.postseason ? (game.round ?? 'postseason') : `Week ${game.week}`}
          {game.neutral ? ' · neutral site' : ''}
        </p>
        <h1 className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-2xl">
          <TeamName abbr={game.away} />
          <span className="numeric text-[var(--text-primary)]">
            {game.away_score}
          </span>
          <span className="text-[var(--text-tertiary)]">–</span>
          <span className="numeric text-[var(--text-primary)]">
            {game.home_score}
          </span>
          <TeamName abbr={game.home} />
        </h1>
        <p className="mt-2 numeric text-[11px] text-[var(--text-tertiary)]">
          {game.date}
          {tie ? ' · finished level' : ''}
        </p>
      </header>

      {tie ? (
        <p className="card px-4 py-3 text-[11px] leading-relaxed text-[var(--accent-warn)]">
          This game ended in a tie. Fifteen of 6,223 regular-season games in
          this corpus did — rare, but a real outcome, and one the model
          allocates probability to rather than assuming away.
        </p>
      ) : null}

      {detail.linescores.length ? (
        <section className="card p-4" aria-label="Scoring by quarter">
          <h2 className="eyebrow mb-3">By quarter</h2>
          <div className="overflow-x-auto">
            <table className="min-w-[360px]">
              <thead>
                <tr>
                  <th scope="col">Team</th>
                  {detail.linescores[0].periods.map((_, index) => (
                    <th key={index} scope="col" className="numeric text-right">
                      {index < 4 ? index + 1 : 'OT'}
                    </th>
                  ))}
                  <th scope="col" className="numeric text-right">T</th>
                </tr>
              </thead>
              <tbody>
                {detail.linescores.map((line) => (
                  <tr key={line.team}>
                    <td className="numeric">{line.team}</td>
                    {line.periods.map((value, index) => (
                      <td key={index} className="numeric text-right">
                        {value}
                      </td>
                    ))}
                    <td className="numeric text-right text-[var(--text-primary)]">
                      {line.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {detail.teamStats.length ? (
        <section className="card p-4" aria-label="Team statistics">
          <h2 className="eyebrow mb-3">Team totals</h2>
          <div className="overflow-x-auto">
            <table className="min-w-[420px]">
              <thead>
                <tr>
                  <th scope="col" className="numeric text-right">{game.away}</th>
                  <th scope="col" className="text-center">Stat</th>
                  <th scope="col" className="numeric text-right">{game.home}</th>
                </tr>
              </thead>
              <tbody>
                {detail.teamStats.map((stat) => (
                  <tr key={stat.label}>
                    <td className="numeric text-right">{stat.away}</td>
                    <td className="text-center text-[var(--text-tertiary)]">
                      {stat.label}
                    </td>
                    <td className="numeric text-right">{stat.home}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="card p-4">
          <h2 className="eyebrow">No team statistics</h2>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            ESPN publishes no box score for this game. Absent rather than
            zeroed.
          </p>
        </section>
      )}

      {detail.leaders.length ? (
        <section className="card p-4" aria-label="Leaders">
          <h2 className="eyebrow mb-3">Leaders</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {detail.leaders.map((group, index) => (
              <li
                key={`${group.team}-${group.label}-${index}`}
                className="flex items-baseline justify-between gap-3 border-b border-[var(--border-color)] pb-1.5"
              >
                <span className="min-w-0">
                  <span className="numeric text-[10px] text-[var(--text-tertiary)]">
                    {group.team} · {group.label}
                  </span>
                  <span className="block truncate text-[13px] text-[var(--text-secondary)]">
                    {group.leaders[0]?.name}
                  </span>
                </span>
                <span className="numeric shrink-0 text-[11px] text-[var(--text-primary)]">
                  {group.leaders[0]?.stat}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <HeadToHead
        meetings={meetings}
        split={split}
        home={game.home}
        away={game.away}
      />

      <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        No forecast is shown for this game. The model was fitted on a corpus
        that includes it, so anything printed here would be a reconstruction
        rather than a call made in advance — and this project does not blur
        the two.
      </p>
    </div>
  )
}

/* --------------------------------------------------------------- pieces */

function GameHeader({ game }: { game: GameForecast }) {
  const context = getGameContext()
  const homeRecord = context?.records[game.home] ?? null
  const awayRecord = context?.records[game.away] ?? null

  return (
    <header>
      <p className="eyebrow">
        Week {game.week} · {game.season}
        {game.neutral_site ? ' · neutral site' : ''}
      </p>
      <h1 className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-2xl">
        <TeamName abbr={game.away} name={game.away_name} />
        <span className="text-[var(--text-tertiary)]">at</span>
        <TeamName abbr={game.home} name={game.home_name} />
      </h1>
      <p className="mt-2 numeric text-[11px] text-[var(--text-tertiary)]">
        {kickoff(game.date_utc)}
        {game.venue ? ` · ${game.venue}` : ''}
        {awayRecord && homeRecord
          ? ` · ${recordLine(awayRecord)} vs ${recordLine(homeRecord)}`
          : ''}
      </p>
    </header>
  )
}

function TeamName({ abbr, name }: { abbr: string; name?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl(abbr)}
        alt=""
        width={26}
        height={26}
        className="h-[26px] w-[26px] rounded bg-white/90 p-0.5"
      />
      <span className="text-[var(--text-primary)]">{name ?? abbr}</span>
    </span>
  )
}

function ProbabilityRow({ game }: { game: GameForecast }) {
  const homePct = game.p_home * 100
  const tiePct = game.p_tie * 100
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="numeric text-sm text-[var(--text-secondary)]">
          {game.away} {pct(game.p_away)}
        </span>
        <span className="numeric text-sm text-[var(--text-secondary)]">
          {pct(game.p_home)} {game.home}
        </span>
      </div>
      <div className="prob-track flex" role="img" aria-label={`${game.home} ${pct(game.p_home)}, ${game.away} ${pct(game.p_away)}, tie ${pct(game.p_tie)}`}>
        <span
          style={{ width: `${game.p_away * 100}%`, background: 'var(--viz-cat-2)' }}
        />
        <span
          style={{ width: `${Math.max(tiePct, 0.4)}%`, background: 'var(--viz-reference)' }}
        />
        <span
          style={{ width: `${homePct}%`, background: 'var(--viz-cat-1)' }}
        />
      </div>
      <p className="mt-2 numeric text-[10px] text-[var(--text-tertiary)]">
        tie {pct(game.p_tie, 2)}
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="numeric mt-1 text-sm text-[var(--text-primary)]">{value}</dd>
    </div>
  )
}

function Availability({
  detail,
  game,
}: {
  detail: GameDetail
  game: GameForecast
}) {
  if (!detail.injuries.length) return null
  const byTeam = [game.away, game.home].map((team) => ({
    team,
    entries: detail.injuries.filter((i) => i.team === team),
  }))

  return (
    <section className="card p-4" aria-label="Availability">
      <h2 className="eyebrow mb-1">Availability</h2>
      <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        From ESPN, at request time. <strong>The model does not see this.</strong>{' '}
        It knows nothing about who is playing, which is the largest single gap
        in the forecast above — shown here so a reader can apply what the
        model cannot.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {byTeam.map(({ team, entries }) => (
          <div key={team}>
            <h3 className="numeric mb-2 text-[11px] text-[var(--text-secondary)]">
              {team}
            </h3>
            {entries.length ? (
              <ul className="space-y-1.5">
                {entries.slice(0, 8).map((entry, index) => (
                  <li
                    key={`${entry.player}-${index}`}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="min-w-0 truncate text-[12px] text-[var(--text-secondary)]">
                      {entry.player}
                      {entry.position ? (
                        <span className="text-[var(--text-tertiary)]">
                          {' '}
                          {entry.position}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={`numeric shrink-0 text-[10px] ${
                        /out|doubtful/i.test(entry.status)
                          ? 'text-[var(--accent-loss)]'
                          : 'text-[var(--accent-warn)]'
                      }`}
                    >
                      {entry.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Nothing reported.
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function HeadToHead({
  meetings,
  split,
  home,
  away,
}: {
  meetings: Meeting[]
  split: { wins: number; losses: number; ties: number }
  home: string
  away: string
}) {
  if (!meetings.length) {
    return (
      <section className="card p-4">
        <h2 className="eyebrow">No previous meetings</h2>
        <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
          These two have not met inside the published window.
        </p>
      </section>
    )
  }

  return (
    <section className="card p-4" aria-label="Head to head">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="eyebrow">Recent meetings</h2>
        <span className="numeric text-[11px] text-[var(--text-tertiary)]">
          {home} {split.wins}-{split.losses}
          {split.ties ? `-${split.ties}` : ''}
        </span>
      </div>
      <ul className="space-y-1.5">
        {meetings.map((meeting) => {
          const homeWon = meeting.home_score > meeting.away_score
          const level = meeting.home_score === meeting.away_score
          return (
            <li key={meeting.game_id}>
              <Link
                href={`/games/${meeting.game_id}`}
                className="flex items-baseline justify-between gap-3 border-b border-[var(--border-color)] pb-1.5 transition-colors hover:text-[var(--text-primary)]"
              >
                <span className="numeric text-[11px] text-[var(--text-tertiary)]">
                  {meeting.date}
                  {meeting.postseason ? ` · ${meeting.round ?? 'playoff'}` : ''}
                </span>
                <span className="numeric text-[12px] text-[var(--text-secondary)]">
                  {meeting.away} {meeting.away_score} – {meeting.home_score}{' '}
                  {meeting.home}
                  {level ? ' (T)' : ''}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function FormBlock({ home, away }: { home: string; away: string }) {
  const context = getGameContext()
  if (!context) return null
  return (
    <section className="grid gap-4 sm:grid-cols-2" aria-label="Recent form">
      {[away, home].map((team) => (
        <div key={team} className="card p-4">
          <h2 className="eyebrow mb-3">{team} form</h2>
          <FormList games={context.form[team] ?? []} />
        </div>
      ))}
    </section>
  )
}

function FormList({ games }: { games: FormGame[] }) {
  if (!games.length) {
    return (
      <p className="text-[11px] text-[var(--text-tertiary)]">
        No recent games published.
      </p>
    )
  }
  return (
    <ul className="space-y-1.5">
      {games.slice(0, 6).map((game) => (
        <li key={game.game_id}>
          <Link
            href={`/games/${game.game_id}`}
            className="flex items-baseline justify-between gap-2 transition-colors hover:text-[var(--text-primary)]"
          >
            <span className="numeric text-[11px] text-[var(--text-tertiary)]">
              {game.home ? 'vs' : '@'} {game.opponent}
            </span>
            <span className="flex items-baseline gap-2">
              <span className="numeric text-[11px] text-[var(--text-secondary)]">
                {game.scored}–{game.allowed}
              </span>
              <span
                className={`numeric w-3 text-[11px] ${
                  game.result === 'W'
                    ? 'text-[var(--accent-primary)]'
                    : game.result === 'L'
                      ? 'text-[var(--accent-loss)]'
                      : 'text-[var(--accent-warn)]'
                }`}
              >
                {game.result}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
