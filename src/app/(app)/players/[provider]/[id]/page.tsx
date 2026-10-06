import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AthletePortrait } from '@/components/players/AthletePortrait'
import { BackButton } from '@/components/primitives/BackButton'
import { permittedPortrait, providerId } from '@/lib/athletes'
import { getGameDetail } from '@/lib/espn'
import { forecastStamp, kickoff } from '@/lib/format'
import { getPowerRatings } from '@/lib/artifacts'
import { playerSnapshots } from '@/lib/playerProfiles'
import { playerGameContext } from '@/lib/server/playerContext'

type Props = { params: Promise<{ provider: string; id: string }>; searchParams: Promise<{ game?: string | string[] }> }

export async function generateMetadata({ params }: Props) {
  const { provider, id } = await params
  return { title: 'Player profile', alternates: { canonical: `/players/${provider}/${id}` }, robots: { index: false, follow: true } }
}

export default async function PlayerPage({ params, searchParams }: Props) {
  const { provider, id } = await params
  if (provider !== 'espn' || !providerId(id)) notFound()
  const query = await searchParams
  const gameId = typeof query.game === 'string' ? providerId(query.game) : null
  const game = gameId ? playerGameContext(gameId) : null
  const fallback = game ? `/games/${game.id}#players` : '/games'
  const label = game ? `${game.away} at ${game.home} players` : 'Published games'
  if (!game) return <Unavailable fallback={fallback} label={label} id={id}
    message="Open a player from a published matchup to see the statistics and team context supplied in that game's summary. A full roster and career record are not available here." />
  const detail = await getGameDetail(game.id, game.home, game.away)
  const player = playerSnapshots(detail, game.includeInjuries).find(player => player.athlete.id === id)
  if (!player) return <Unavailable fallback={fallback} label={label} id={id}
    message={detail.source.status === 'unavailable' ? 'The ESPN summary could not be read. Player identity, statistics and availability cannot be confirmed from this response.'
      : detail.source.status === 'mismatched' ? 'The ESPN response could not be matched to the published fixture. Player context is withheld.'
        : 'This player is not in the selected leaders or reported availability for this matchup. That does not mean the player is absent from the team.'} />
  const team = getPowerRatings()?.teams.find(team => team.abbreviation === player.team)

  return <div className="space-y-6">
    <header>
      <BackButton fallback={fallback} label={label} />
      <div className="card mt-3 flex flex-wrap items-center gap-5 p-4 sm:p-6">
        <AthletePortrait key={id} athlete={player.athlete} />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">NFL · player snapshot</p>
          <h1 className="mt-2 break-words text-2xl sm:text-3xl">{player.athlete.displayName}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--text-secondary)]">
            <Link href={`/teams/${player.team}`} className="inline-flex min-h-[44px] items-center text-[var(--accent-info)] hover:underline">{team?.name ?? player.team} →</Link>
            <span>{player.athlete.position || 'Position not supplied'}</span>
            <span>{player.athlete.jersey ? `#${player.athlete.jersey}` : 'Number not supplied'}</span>
          </p>
          <p className="mt-2 font-mono text-xs text-[var(--text-tertiary)]">Team context in this response · {permittedPortrait(player.athlete.portrait, player.athlete) ? 'portrait permission verified' : 'portrait not cleared for display'}</p>
        </div>
      </div>
    </header>

    <section className="card p-4 sm:p-6" aria-label="Matchup context">
      <h2 className="eyebrow">Seen in this matchup</h2>
      <Link href={`/games/${game.id}#players`} className="mt-3 inline-flex min-h-[44px] items-center text-lg text-[var(--accent-info)] hover:underline">{game.away} at {game.home} →</Link>
      <p className="mt-1 font-mono text-xs text-[var(--text-secondary)]">{game.season} · Week {game.week} · {kickoff(game.date)}</p>
      <p className="mt-3 text-sm text-[var(--text-secondary)]">Selected game-summary fields, not a full season or career record.</p>
    </section>

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card p-4 sm:p-6" aria-label="Game statistics">
        <h2 className="text-lg">Game statistics</h2>
        {player.statistics.length ? <dl className="mt-4 space-y-4">{player.statistics.map((stat, index) => <div key={`${stat.label}-${index}`} className="border-t border-[var(--border-color)] pt-3">
          <dt className="eyebrow">{stat.label || 'Category not supplied'}</dt>
          <dd className="numeric mt-2 break-words text-sm text-[var(--text-primary)]">{stat.value || 'Not supplied'}</dd>
        </div>)}</dl> : <p className="mt-3 text-sm text-[var(--text-secondary)]">No leader statistics for this player in the response. A missing line is not a zero.</p>}
      </section>
      <section className="card p-4 sm:p-6" aria-label="Reported availability">
        <h2 className="text-lg">Reported availability</h2>
        {player.availability.length ? <ul className="mt-4 space-y-4">{player.availability.map((entry, index) => <li key={index} className="border-t border-[var(--border-color)] pt-3">
          <p className="text-sm text-[var(--text-primary)]">{entry.status || 'Status not supplied'}{entry.detail ? ` · ${entry.detail}` : ''}</p>
          <p className="mt-2 font-mono text-xs text-[var(--text-secondary)]">Report date: {entry.reportedAt ? forecastStamp(entry.reportedAt) : 'not supplied'}</p>
        </li>)}</ul> : <p className="mt-3 text-sm text-[var(--text-secondary)]">No availability report for this player in this response. Availability is unknown.</p>}
        <p className="mt-4 text-xs leading-relaxed text-[var(--text-tertiary)]">Reports may be newer than the game. They do not confirm game-day participation. Historical matchup profiles omit current injury reports.</p>
      </section>
    </div>

    <section className="card p-4 sm:p-6" aria-label="Source and coverage">
      <h2 className="eyebrow">Source and coverage</h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div><dt className="eyebrow">Source</dt><dd className="mt-2 text-sm text-[var(--text-secondary)]">ESPN game summary</dd></div>
        <div><dt className="eyebrow">Summary update</dt><dd className="numeric mt-2 text-xs text-[var(--text-secondary)]">{detail.source.asOf ? forecastStamp(detail.source.asOf) : 'Not supplied'}</dd></div>
        <div><dt className="eyebrow">Player identity</dt><dd className="numeric mt-2 text-xs text-[var(--text-secondary)]">ESPN · {id}</dd></div>
        <div><dt className="eyebrow">Coverage</dt><dd className="mt-2 text-sm text-[var(--text-secondary)]">Selected leaders and reports · no full roster or career totals</dd></div>
      </dl>
      <p className="mt-4 text-xs leading-relaxed text-[var(--text-tertiary)]">Summary responses may be cached for 24 hours. The summary update and individual report dates describe different records. A supplied portrait URL alone does not establish permission to display it.</p>
    </section>
  </div>
}

function Unavailable({ fallback, label, id, message }: { fallback: string; label: string; id: string; message: string }) {
  return <div className="space-y-6">
    <BackButton fallback={fallback} label={label} />
    <section className="card p-4 sm:p-6">
      <p className="eyebrow">NFL · ESPN identity {id}</p>
      <h1 className="mt-3 text-2xl">Player profile unavailable</h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">{message}</p>
      <Link href={fallback} className="mt-4 inline-flex min-h-[44px] items-center text-sm text-[var(--accent-info)] hover:underline">{label} →</Link>
    </section>
  </div>
}
