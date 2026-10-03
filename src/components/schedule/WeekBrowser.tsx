'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import type { GameForecasts } from '@/lib/artifacts'
import { kickoff, logoUrl, pct, spread } from '@/lib/format'
import { useWatchlist } from '@/lib/watchlist'
import { publishedWeek, weekDays } from '@/lib/weekBrowser'

const control = 'min-h-[44px] rounded-sm border border-[var(--border-color)] bg-[var(--card-bg)] px-3 font-mono text-xs text-[var(--text-secondary)] hover:border-[var(--border-hover)] disabled:cursor-not-allowed disabled:opacity-40'

export function WeekBrowser({ forecasts, initialWeek, archiveSeasons }: { forecasts: GameForecasts; initialWeek: number; archiveSeasons: number[] }) {
  const router = useRouter()
  const watchlist = useWatchlist()
  const [selection, setSelection] = useState({ week: initialWeek, team: '', following: false })
  const [ready, setReady] = useState(false)
  const weeks = useMemo(() => [...new Set(forecasts.games.map(game => game.week))].sort((a, b) => a - b), [forecasts.games])
  const teams = useMemo(() => [...new Map(forecasts.games.flatMap(game => [[game.home, game.home_name], [game.away, game.away_name]])
    .map(([code, name]) => [code, name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [forecasts.games])

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search)
      const team = params.get('team') ?? ''
      setSelection({ week: publishedWeek(params.get('week'), weeks, initialWeek),
        team: teams.some(([code]) => code === team) ? team : '', following: params.get('following') === '1' })
    }
    restore()
    setReady(true)
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [initialWeek, weeks, teams])

  const select = (next: typeof selection) => {
    const url = new URL(window.location.href)
    url.searchParams.set('week', String(next.week))
    if (next.team) url.searchParams.set('team', next.team)
    else url.searchParams.delete('team')
    if (next.following) url.searchParams.set('following', '1')
    else url.searchParams.delete('following')
    window.history.pushState(null, '', url)
    setSelection(next)
  }
  const all = forecasts.games.filter(game => game.week === selection.week)
  const visible = all.filter(game => (!selection.team || [game.home, game.away].includes(selection.team)) &&
    (!selection.following || [game.home, game.away].some(team => watchlist.includes(team))))
  const days = weekDays(visible)
  const index = weeks.indexOf(selection.week)

  return <section aria-label="Weekly slate" data-ready={ready}>
    <div className="card p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex min-w-0 flex-col gap-2"><span className="eyebrow">Season / record</span>
          <select aria-label="Season or results archive" className={control} value="forecasts"
            onChange={event => { if (event.target.value !== 'forecasts') router.push(`/seasons/${event.target.value}/games`) }}>
            <option value="forecasts">{forecasts.season} published forecasts</option>
            {archiveSeasons.map(season => <option key={season} value={season}>{season} recorded results</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-2"><span className="eyebrow">Published week</span>
          <select aria-label="Select week" className={control} value={selection.week}
            onChange={event => select({ ...selection, week: Number(event.target.value) })}>
            {weeks.map(week => <option key={week} value={week}>Week {week}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-2"><span className="eyebrow">Team</span>
          <select aria-label="Filter by team" className={control} value={selection.team}
            onChange={event => select({ ...selection, team: event.target.value })}>
            <option value="">All teams</option>
            {teams.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button type="button" className={control} disabled={index <= 0} onClick={() => select({ ...selection, week: weeks[index - 1] })}>← Previous week</button>
          <button type="button" className={control} disabled={index === weeks.length - 1} onClick={() => select({ ...selection, week: weeks[index + 1] })}>Next week →</button>
        </div>
        <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 font-mono text-xs text-[var(--text-secondary)]">
          <input type="checkbox" checked={selection.following} onChange={event => select({ ...selection, following: event.target.checked })} />
          Following only ({watchlist.length})
        </label>
      </div>
    </div>

    <div className="my-5 flex flex-wrap items-baseline justify-between gap-2" aria-live="polite" aria-atomic="true">
      <h2 className="text-xl">Week {selection.week}</h2>
      <p className="font-mono text-xs text-[var(--text-secondary)]">{visible.length} of {all.length} published games · times in ET</p>
    </div>
    {!visible.length ? <div className="card p-6">
      <h3 className="text-sm">No games match these filters</h3>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">{selection.following && !watchlist.length ? 'Follow teams from their team pages to build your local watchlist.' : 'This published week has no fixtures for the selected teams.'}</p>
      <button type="button" className={`${control} mt-4`} onClick={() => select({ week: selection.week, team: '', following: false })}>Show the whole week</button>
    </div> : <div className="space-y-6">
      {days.map(([day, games]) => <section key={day} aria-label={`Games on ${day}`}>
        <h3 className="mb-3 flex flex-wrap items-center gap-3 border-b border-[var(--border-color)] pb-3 text-sm">
          {new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })}
          <span className="font-mono text-xs text-[var(--text-tertiary)]">{games.length} {games.length === 1 ? 'game' : 'games'}</span>
        </h3>
        <ul className="grid gap-3 lg:grid-cols-2">
          {games.map(game => <li key={game.game_id}>
            <Link href={`/games/${game.game_id}`} className="card block h-full p-4 transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)]"
              aria-label={`${game.away_name} at ${game.home_name}, ${kickoff(game.date_utc)} — game detail`}>
              <p className="mb-3 font-mono text-xs text-[var(--text-tertiary)]">{kickoff(game.date_utc)}{game.neutral_site ? ' · Neutral site' : ''}</p>
              <div className="space-y-3">
                {[[game.away, game.away_name, game.p_away], [game.home, game.home_name, game.p_home]].map(([code, name, probability]) =>
                  <div key={String(code)} className="flex items-center gap-3">
                    <WeekTeamMark abbreviation={String(code)} />
                    <span className="min-w-0 flex-1 text-sm text-[var(--text-secondary)]">{name}</span>
                    <span className="numeric shrink-0 text-base text-[var(--text-primary)]">{pct(Number(probability))}</span>
                  </div>)}
              </div>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border-color)] pt-3 font-mono text-xs text-[var(--text-secondary)]">
                <span>Tie {pct(game.p_tie, 2)}</span><span>Projected total {game.exp_total.toFixed(1)}</span>
                <span>{game.market.spread_home !== null ? `${game.home} market spread ${spread(game.market.spread_home)}`
                  : game.market.ml_home !== null && game.market.ml_away !== null ? 'Moneyline published' : 'No market line published'}</span>
              </div>
              <p className="mt-3 font-mono text-xs text-[var(--accent-info)]">Explore matchup →</p>
            </Link>
          </li>)}
        </ul>
      </section>)}
    </div>}
    <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--text-secondary)]">
      <p>Pre-game snapshots; this view does not report live scores.</p>
      <Link href={archiveSeasons.includes(forecasts.season) ? `/seasons/${forecasts.season}/games` : '/seasons'} className="inline-flex min-h-[44px] items-center text-[var(--accent-info)] hover:underline">Recorded results →</Link>
      <Link href="/accuracy" className="inline-flex min-h-[44px] items-center text-[var(--accent-info)] hover:underline">Check the model evidence →</Link>
    </div>
  </section>
}

function WeekTeamMark({ abbreviation }: { abbreviation: string }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  return <span aria-hidden="true" className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-sm"
    style={{ background: 'var(--logo-plate)', color: '#172019', boxShadow: 'inset 0 0 0 1px var(--logo-plate-ring)' }}>
    {!loaded && <span className="font-mono text-[9px] font-bold">{abbreviation}</span>}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {!failed && <img src={logoUrl(abbreviation)} alt="" width={24} height={24} loading="lazy" decoding="async"
      onLoad={() => setLoaded(true)} onError={() => { setFailed(true); setLoaded(false) }}
      className="absolute object-contain" style={{ opacity: loaded ? 1 : 0 }} />}
  </span>
}
