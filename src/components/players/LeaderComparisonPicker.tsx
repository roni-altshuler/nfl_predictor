'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import { AthletePortrait } from './AthletePortrait'
import { PlayerLink } from './PlayerLink'
import type { ComparedLeader, LeaderComparisonRow } from '@/lib/leaderComparison'

export function LeaderComparisonPicker({ rows, home, away, gameId }: {
  rows: LeaderComparisonRow[]; home: string; away: string; gameId: string
}) {
  const params = useSearchParams()
  const [selected, setSelected] = useState(rows[0]?.key ?? '')
  const [ready, setReady] = useState(false)
  const [unknown, setUnknown] = useState(false)
  // Like MatchupPicker, force-static pages apply the real URL after hydration.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('compare')
    const known = rows.some(row => row.key === requested)
    setSelected(known ? requested! : rows[0]?.key ?? '')
    setUnknown(!!requested && !known)
    setReady(true)
  }, [params, rows])
  const row = rows.find(row => row.key === selected) ?? rows[0]
  if (!ready || !row) return <LeaderComparisonLoading />

  function choose(value: string) {
    setSelected(value)
    setUnknown(false)
    const url = new URL(window.location.href)
    url.searchParams.set('compare', value)
    url.hash = 'comparison'
    // Native history keeps selection shareable without refetching the summary
    // or inserting extra Back steps between the game and its originating slate.
    window.history.replaceState(window.history.state, '', url)
  }

  return <div className="mt-5" data-comparison-ready="true">
    <label className="block max-w-sm">
      <span className="eyebrow mb-2 block">Leader category</span>
      <select aria-label="Compare leader category" className="lab-control w-full" value={row.key} onChange={event => choose(event.target.value)}>
        {rows.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
    </label>
    {unknown ? <p className="lab-notice mt-3">The requested category is not supplied. Showing {row.label}.</p> : null}
    <p className="mt-4 font-mono text-xs text-[var(--text-secondary)]" role="status">Comparing {row.label} · away / home</p>
    <div className="mt-3 grid grid-cols-2 gap-3" role="region" aria-label={`${row.label} comparison`}>
      <LeaderSide team={away} venue="Away" leader={row.away} category={row.label} gameId={gameId} />
      <LeaderSide team={home} venue="Home" leader={row.home} category={row.label} gameId={gameId} />
    </div>
  </div>
}

function LeaderSide({ team, venue, leader, category, gameId }: {
  team: string; venue: string; leader: ComparedLeader; category: string; gameId: string
}) {
  const line = leader.line
  return <article className="flex min-w-0 flex-col rounded-sm border border-[var(--border-color)] p-3 sm:p-4" aria-label={`${team} ${category} leader`}>
    <div className="flex flex-wrap items-center justify-between gap-1 border-b border-[var(--border-color)] pb-3">
      <Link href={`/teams/${team}`} prefetch={false} className="inline-flex min-h-[44px] items-center gap-3 font-mono text-sm text-[var(--accent-info)] hover:underline">
        <TeamLogo abbreviation={team} size={28} />{team} →
      </Link>
      <span className="eyebrow">{venue}</span>
    </div>
    {line ? <>
      <div className="mb-5 mt-4 flex flex-col items-start gap-3 lg:flex-row lg:items-center lg:gap-4">
        <AthletePortrait key={`${line.athlete.provider}-${line.athlete.id ?? line.name}`} athlete={line.athlete} />
        <div className="min-w-0">
          <h3 className="break-words text-sm sm:text-base"><PlayerLink athlete={line.athlete} gameId={gameId} /></h3>
          <p className="mt-2 font-mono text-xs text-[var(--text-secondary)]">{line.athlete.position || 'Position not supplied'}{line.athlete.jersey ? ` · #${line.athlete.jersey}` : ''}</p>
          {!line.athlete.id ? <p className="mt-2 text-xs text-[var(--text-tertiary)]">Profile identity not supplied</p> : null}
        </div>
      </div>
      <dl className="mt-auto border-t border-[var(--border-color)] pt-4">
        <dt className="eyebrow">{category}</dt>
        <dd className="mt-2 break-words font-mono text-sm sm:text-base text-[var(--text-primary)]">{line.stat || 'Statistic not supplied'}</dd>
      </dl>
    </> : <p className="mt-5 text-sm leading-relaxed text-[var(--text-secondary)]">{leader.state === 'conflicting'
      ? 'Team context conflicts; this leader is withheld.' : leader.state === 'ambiguous'
        ? 'Multiple leader lines supplied; this comparison is withheld.' : `No ${category} leader supplied for ${team}. The value is unknown.`}</p>}
  </article>
}

export function LeaderComparisonLoading() {
  return <div className="mt-5 grid gap-3 md:grid-cols-2" role="status" aria-label="Loading leader comparison">
    <span className="sr-only">Loading comparison controls…</span>
    <div className="skeleton-shimmer h-56" /><div className="skeleton-shimmer h-56" />
  </div>
}
