import Link from 'next/link'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import type { GameForecast } from '@/lib/artifacts'
import { forecastStamp, kickoff, pct } from '@/lib/format'

/** The first retained matchup, selected by the publication, never by a live clock. */
export function TeamPublishedMatchup({ game, teamAbbreviation, publishedAt, resultsThrough }: {
  game?: GameForecast
  teamAbbreviation: string
  publishedAt?: string | null
  resultsThrough?: string | null
}) {
  return (
    <section id="featured-matchup" aria-labelledby="featured-matchup-title" className="card scroll-mt-20 p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="featured-matchup-title" className="text-lg">Published matchup</h2>
        {game ? <span className="eyebrow">Week {game.week} · {game.season}</span> : null}
      </div>

      {game ? (
        <>
          <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
            <time dateTime={game.date_utc}>{kickoff(game.date_utc)}</time>
            {game.neutral_site ? ' · neutral site' : ''}
            {game.venue ? ` · ${game.venue}` : ''}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <MatchupSide abbreviation={game.away} name={game.away_name} side="Away"
              probability={game.p_away} score={game.exp_away_score} favoured={game.p_away > game.p_home} currentTeam={game.away === teamAbbreviation} />
            <MatchupSide abbreviation={game.home} name={game.home_name} side="Home"
              probability={game.p_home} score={game.exp_home_score} favoured={game.p_home >= game.p_away} currentTeam={game.home === teamAbbreviation} />
          </div>
          <p className="mt-3 text-xs text-[var(--text-secondary)]">
            Tie chance <span className="numeric">{pct(game.p_tie)}</span>
            {game.neutral_site ? ' · home/away are the published designations' : ''}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/games/${game.game_id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-sm bg-[var(--logo-plate)] px-4 py-2 text-sm font-semibold text-[var(--logo-ink)] hover:underline">
              Explore matchup →
            </Link>
            <Link href={`/games/${game.game_id}#players`} className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--border-color)] px-3 text-sm text-[var(--accent-info)] hover:underline">
              Player reports →
            </Link>
            <Link href="#team-schedule" className="inline-flex min-h-[44px] items-center px-3 text-sm text-[var(--accent-info)] hover:underline">
              Published schedule ↓
            </Link>
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          No matchup in the published forecast. <Link href="/games" className="inline-flex min-h-[44px] items-center text-[var(--accent-info)] hover:underline">Browse published games →</Link>
        </p>
      )}

      <dl className="mt-4 grid gap-3 border-t border-[var(--border-color)] pt-4 text-xs sm:grid-cols-2">
        <div><dt className="text-[var(--text-tertiary)]">Forecast published</dt><dd className="mt-1 font-mono">{forecastStamp(publishedAt)}</dd></div>
        <div><dt className="text-[var(--text-tertiary)]">Results used through</dt><dd className="mt-1 font-mono">{forecastStamp(resultsThrough)}</dd></div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
        Forecasts stay as published; this card does not track game progress. Player reports cover selected leaders and availability, separate from these probabilities.
      </p>
    </section>
  )
}

function MatchupSide({ abbreviation, name, side, probability, score, favoured, currentTeam }: {
  abbreviation: string
  name: string
  side: string
  probability: number
  score: number
  favoured: boolean
  currentTeam: boolean
}) {
  const identity = <><TeamLogo abbreviation={abbreviation} name={name} size={32} /><span className="min-h-[40px] min-w-0 sm:min-h-0">{name}</span></>
  const identityClass = 'grid min-h-[80px] content-start gap-2 text-sm font-semibold text-[var(--text-primary)] sm:min-h-[44px] sm:grid-cols-[32px_minmax(0,1fr)] sm:items-center sm:content-center'
  return (
    <div className="min-w-0 rounded-sm border border-[var(--border-color)] p-3" role="group" aria-label={`${abbreviation} published forecast`}>
      <p className="eyebrow mb-2">{side}</p>
      {currentTeam ? <div className={identityClass}>{identity}</div> : <Link href={`/teams/${abbreviation}`} aria-label={`View ${name} team`} className={`${identityClass} hover:underline`}>{identity}</Link>}
      <dl className="mt-3 space-y-3 text-xs">
        <div><dt className="text-[var(--text-secondary)]">Win chance</dt><dd className={`numeric mt-1 text-xl ${favoured ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'}`}>{pct(probability)}</dd></div>
        <div><dt className="text-[var(--text-secondary)]">Projected points</dt><dd className="numeric mt-1 text-base text-[var(--text-primary)]">{score.toFixed(1)}</dd></div>
      </dl>
    </div>
  )
}
