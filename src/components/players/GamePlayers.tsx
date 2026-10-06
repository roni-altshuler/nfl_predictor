import Link from 'next/link'
import { playerSnapshots } from '@/lib/playerProfiles'
import { athleteHref } from '@/lib/athletes'
import type { GameDetail } from '@/lib/espn'
import { forecastStamp } from '@/lib/format'

export function GamePlayers({ detail, gameId, includeInjuries = true }: { detail: GameDetail; gameId: string; includeInjuries?: boolean }) {
  const players = playerSnapshots(detail, includeInjuries)
  return <section id="players" className="card scroll-mt-20 p-4 sm:p-6" aria-label="Players in this matchup">
    <h2 className="text-lg">Players in this matchup</h2>
    <p className="mt-2 text-sm text-[var(--text-secondary)]">Selected leaders{includeInjuries ? ' and reported availability' : ''} from this game summary. This is not a full roster.</p>
    <p className="mt-2 font-mono text-xs text-[var(--text-tertiary)]">ESPN · summary update {detail.source.asOf ? forecastStamp(detail.source.asOf) : 'not supplied'}</p>
    {players.length ? <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {players.map(player => <li key={`${player.athlete.provider}-${player.athlete.id}`}>
        <Link href={athleteHref(player.athlete, gameId)!} prefetch={false}
          className="block h-full rounded-sm border border-[var(--border-color)] p-3 hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)]"
          aria-label={`${player.athlete.displayName} — player profile`}>
          <span className="eyebrow">{player.team} · {player.athlete.position || 'Position not supplied'}{player.athlete.jersey ? ` · #${player.athlete.jersey}` : ''}</span>
          <span className="mt-2 block break-words text-sm text-[var(--text-primary)]">{player.athlete.displayName}</span>
          <span className="mt-2 block text-xs text-[var(--text-secondary)]">{player.statistics[0] ? `${player.statistics[0].label}: ${player.statistics[0].value || 'Not supplied'}` : player.availability[0]?.status || 'Report available'}</span>
          <span className="mt-3 block font-mono text-xs text-[var(--accent-info)]">Open player profile →</span>
        </Link>
      </li>)}
    </ul> : <div className="mt-4 border-t border-[var(--border-color)] pt-4">
      <h3 className="text-sm">Player profiles unavailable</h3>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">{detail.source.status === 'mismatched' ? 'The provider response could not be matched to this fixture.' : 'This response has no players with a provider ID, or the summary could not be read.'} No roster is inferred.</p>
    </div>}
  </section>
}
