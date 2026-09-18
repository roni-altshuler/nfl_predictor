'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { MarginDistribution } from '@/components/charts/MarginDistribution'
import { PlayoffImpact } from './PlayoffImpact'
import { parseScenarios } from '@/lib/playoffScenarios'
import { SpreadSlider } from './SpreadSlider'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import { toggleTeam, useWatchlist } from '@/lib/watchlist'
import { kickoff, pct, stamp } from '@/lib/format'
import { parseForecast, validTeams, recordAfter, type LabData } from '@/lib/forecastLab'

export function ForecastLab({ initial, compact = false }: { initial: LabData; compact?: boolean }) {
  const [data, setData] = useState(initial)
  const [now, setNow] = useState(Date.parse(initial.asOf))
  const [selected, setSelected] = useState('')
  const [requested, setRequested] = useState('')
  const [query, setQuery] = useState('')
  const [week, setWeek] = useState('next')
  const [following, setFollowing] = useState(false)
  const [sort, setSort] = useState('kickoff')
  const [outcome, setOutcome] = useState<'home'|'away'|'tie'|null>(null)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const watchlist = useWatchlist()

  useEffect(() => {
    const syncUrl = () => {
      const id = new URL(window.location.href).searchParams.get('game') || ''
      setSelected(id); setRequested(id)
      setQuery(''); setFollowing(false); setSort('kickoff')
      if (id) setWeek('all')
      setOutcome(null)
    }
    syncUrl()
    const tick = () => setNow(Date.now())
    tick()
    const timer = window.setInterval(tick, 30000)
    window.addEventListener('popstate', syncUrl)
    return () => { clearInterval(timer); window.removeEventListener('popstate', syncUrl); controller.current?.abort() }
  }, [])

  const games = (data.forecast?.games ?? []).filter(g => Date.parse(g.date_utc) > now)
  const nextWeek = games[0]?.week
  const weeks = [...new Set(games.map(g=>g.week))]
  const search = query.trim().toLowerCase()
  const visible = games.filter(g =>
    (week === 'all' || g.week === (week === 'next' ? nextWeek : Number(week))) &&
    (!following || watchlist.includes(g.home) || watchlist.includes(g.away)) &&
    `${g.home} ${g.away} ${g.home_name} ${g.away_name}`.toLowerCase().includes(search),
  ).sort((a,b)=> sort === 'close' ? Math.abs(a.p_home-a.p_away)-Math.abs(b.p_home-b.p_away) : Date.parse(a.date_utc)-Date.parse(b.date_utc))
  const game = visible.find(g=>g.game_id===selected) ?? visible[0]
  const home = data.teams.find(t=>t.abbreviation===game?.home)
  const away = data.teams.find(t=>t.abbreviation===game?.away)
  const stale = data.forecast && now-Date.parse(data.forecast.generated_at)>48*3600000
  const missingShare = requested && !games.some(g=>g.game_id===requested)
  useEffect(() => { setOutcome(null) }, [game?.game_id])

  function choose(id: string) {
    setSelected(id); setRequested(''); setOutcome(null); setStatus('')
    if (!compact) {
      const url = new URL(window.location.href); url.searchParams.set('game',id)
      window.history.pushState(null,'',url)
    }
  }
  function reset() { setQuery(''); setFollowing(false); setWeek('all'); setSort('kickoff'); setOutcome(null) }
  async function refresh() {
    if (controller.current) return
    const abort = new AbortController(); controller.current=abort
    const timer = setTimeout(()=>abort.abort(),12000)
    setLoading(true); setStatus('')
    try {
      const response = await fetch('/api/forecast-lab',{cache:'no-store',signal:abort.signal})
      if (!response.ok) throw new Error('unavailable')
      const value = await response.json()
      const parsed = parseForecast(value.forecast)
      if (!parsed.forecast) throw new Error('invalid')
      setData({forecast:parsed.forecast,withheld:parsed.withheld+(Number(value.withheld)||0),teams:validTeams({teams:value.teams}),scenarios:parseScenarios(value.scenarios,parsed.forecast),unavailable:false,asOf:new Date().toISOString()})
      setNow(Date.now()); setOutcome(null); setStatus('Latest published forecasts loaded.')
    } catch { setStatus('Refresh unavailable. Your last loaded forecasts are still here.') }
    finally { clearTimeout(timer); controller.current=null; setLoading(false) }
  }
  async function share() {
    if (!game) return
    const url = new URL('/lab',window.location.origin); url.searchParams.set('game',game.game_id)
    try { await navigator.clipboard.writeText(url.toString()); setStatus('Game link copied.') }
    catch { setStatus(`Share this game: ${url.toString()}`) }
  }

  return <section aria-label="Forecast Lab" className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="eyebrow">Gridiron / Forecast Lab</p>
        {compact ? <h2 className="mt-2 text-2xl font-semibold">Your Sunday starts here.</h2> : <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Read the game. Play it out.</h1>}
        <p className="mt-2 text-sm text-[var(--text-secondary)]">Pick a matchup. Explore the numbers. Follow your teams.</p>
      </div>
      {compact ? <Link href="/lab" className="lab-control">Open the lab ↗</Link> : <button type="button" className="lab-control" onClick={refresh} disabled={loading}>{loading?'Refreshing…':'Refresh forecasts'}</button>}
    </header>
    <p className="font-mono text-[11px] text-[var(--text-tertiary)]">{data.forecast ? `${data.forecast.season} · ${data.forecast.model_version} · published ${stamp(data.forecast.generated_at)} · pregame probabilities` : 'No forecast artifact available'}</p>
    {stale ? <p className="lab-notice">Forecasts are more than 48 hours old. Check their publication date before using them.</p> : null}
    {data.withheld>0 ? <p className="lab-notice">{data.withheld} invalid or duplicate forecasts withheld.</p>:null}
    {missingShare ? <p className="lab-notice">The shared game has kicked off or is no longer in the published schedule. Explore another matchup below.</p>:null}
    <div className="flex flex-wrap gap-2">
      <label className="min-w-0 basis-full sm:flex-1 sm:basis-48"><span className="sr-only">Search teams</span><input className="lab-control w-full" type="search" placeholder="Find your team…" value={query} onChange={e=>{setQuery(e.target.value);setOutcome(null)}} /></label>
      <label><span className="sr-only">Week</span><select className="lab-control" value={week} onChange={e=>{setWeek(e.target.value);setOutcome(null)}}><option value="next">Next week{nextWeek?` · ${nextWeek}`:''}</option><option value="all">All weeks</option>{weeks.map(w=><option key={w} value={w}>Week {w}</option>)}</select></label>
      <button type="button" className="lab-control" aria-pressed={following} onClick={()=>{setFollowing(!following);setOutcome(null)}}>Following{watchlist.length?` · ${watchlist.length}`:''}</button>
      {!compact ? <label><span className="sr-only">Sort games</span><select className="lab-control" value={sort} onChange={e=>{setSort(e.target.value);setOutcome(null)}}><option value="kickoff">Kickoff order</option><option value="close">Closest matchups</option></select></label>:null}
    </div>
    {data.unavailable ? <div className="card p-6"><p>Forecasts are unavailable. Try refreshing in a moment.</p><Link className="mt-3 inline-block text-[var(--accent-info)]" href="/accuracy">Explore the model’s record →</Link></div> : !game ? <div className="card space-y-3 p-6"><p>{games.length?'No games match these filters.':'No upcoming games in this published forecast.'}</p><button type="button" className="lab-control" onClick={reset}>Reset filters</button><Link href="/seasons" className="ml-3 text-[var(--accent-info)]">Season archive →</Link></div> : <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0 space-y-4" key={game.game_id}>
        <article className="card overflow-hidden">
          <div className="flex flex-wrap justify-between gap-2 border-b border-[var(--border-color)] px-4 py-3"><span className="eyebrow">Week {game.week} · {game.neutral_site?'Neutral venue':'Matchup'}</span><span className="font-mono text-[11px] text-[var(--text-secondary)]">{kickoff(game.date_utc)}</span></div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-4 sm:p-6">
            {[{abbr:game.away,name:game.away_name,p:game.p_away,side:'away'},{abbr:game.home,name:game.home_name,p:game.p_home,side:'home'}].map((team,index)=><div key={team.abbr} className={index===0?'col-start-1 row-start-1 text-center':'col-start-3 row-start-1 text-center'}>
              <Link href={`/teams/${team.abbr}`} className="inline-flex flex-col items-center gap-2"><TeamLogo abbreviation={team.abbr} name={team.name} size={52}/><span className="text-lg font-semibold tracking-wider">{team.abbr}</span><span className="hidden text-xs text-[var(--text-secondary)] sm:block">{team.name}</span></Link>
              <p className="numeric mt-3 text-3xl sm:text-4xl" data-testid={`${team.side}-probability`}>{pct(team.p)}</p><p className="eyebrow mt-1">to win</p>
              <button type="button" className="lab-control mt-3 text-xs" aria-label={`${watchlist.includes(team.abbr)?'Unfollow':'Follow'} ${team.name}`} aria-pressed={watchlist.includes(team.abbr)} onClick={()=>toggleTeam(team.abbr)}>{watchlist.includes(team.abbr)?'Following':'+ Follow'}</button>
            </div>)}
            <div className="col-start-2 row-start-1 text-center"><span className="eyebrow">at</span><p className="mt-4 font-mono text-[11px] text-[var(--text-secondary)]">Tie</p><p className="numeric text-xs">{pct(game.p_tie)}</p></div>
          </div>
          <div className="mx-4 flex h-2 gap-[2px] overflow-hidden rounded-sm" aria-hidden="true"><span style={{width:`${game.p_away*100}%`,background:'var(--viz-cat-2)'}}/><span style={{width:`${game.p_tie*100}%`,background:'var(--viz-reference)'}}/><span style={{width:`${game.p_home*100}%`,background:'var(--viz-cat-1)'}}/></div>
          <dl className="grid grid-cols-2 gap-3 p-4 text-center sm:grid-cols-3"><div><dt className="eyebrow">Expected score</dt><dd className="numeric mt-1 text-sm">{game.away} {game.exp_away_score.toFixed(1)} · {game.home} {game.exp_home_score.toFixed(1)}</dd></div><div><dt className="eyebrow">Expected total</dt><dd className="numeric mt-1 text-sm">{game.exp_total.toFixed(1)} points</dd></div><div className="col-span-2 sm:col-span-1"><dt className="eyebrow">Venue</dt><dd className="mt-1 text-xs text-[var(--text-secondary)]">{game.venue || 'Not published'}</dd></div></dl>
          <div className="flex flex-wrap gap-3 border-t border-[var(--border-color)] p-4"><Link className="lab-control" href={`/games/${game.game_id}`}>Game breakdown →</Link><button type="button" className="lab-control" onClick={share}>Share game</button>{compact?<Link className="lab-control" href={`/lab?game=${game.game_id}`}>Play it out ↗</Link>:null}</div>
        </article>
        {!compact ? <>
          <PlayoffImpact key={`${game.game_id}:${data.scenarios?.computed_at ?? ""}`} game={game} data={data.scenarios} />
          <details className="card p-4"><summary className="cursor-pointer text-sm">Try a simple record scenario</summary>
          <section className="card p-4 sm:p-5" aria-label="Record scenario"><h2 className="eyebrow">What if this game goes your way?</h2><p className="mt-2 text-sm text-[var(--text-secondary)]">Add one hypothetical result to the published standings.</p>
            <div className="mt-4 flex flex-wrap gap-2">{(['away','tie','home'] as const).map(o=><button type="button" key={o} className="lab-control" aria-pressed={outcome===o} disabled={!home || !away} onClick={()=>setOutcome(o)}>{o==='tie'?'Tie':`${game[o]} wins`}</button>)}</div>
            <div className="mt-4 grid grid-cols-2 gap-3" aria-live="polite">{[{t:away,side:'away'},{t:home,side:'home'}].map(({t,side})=><div key={side}><p className="eyebrow">{game[side as 'home'|'away']} {outcome?'hypothetical':'current'}</p><p className="numeric mt-1 text-2xl" data-testid={`${side}-record`}>{t ? outcome ? recordAfter(t,outcome==='tie'?'tie':outcome===side?'win':'loss') : `${t.current_wins}–${t.current_losses}–${t.current_ties}` : '—'}</p><p className="mt-1 font-mono text-[11px] text-[var(--text-secondary)]">Published playoff chance {pct(t?.p_playoffs)}</p></div>)}</div>
            <p className="mt-3 text-xs leading-relaxed text-[var(--text-tertiary)]">{home&&away?'This adds only the selected game; intervening fixtures are not simulated. Playoff odds remain the published forecast.':'Matching standings are unavailable; record scenarios are disabled.'}</p><Link className="mt-3 inline-block text-sm text-[var(--accent-info)]" href="/season">Explore the conference race →</Link>
          </section>
          </details>
          <section className="card p-4 sm:p-5"><h2 className="eyebrow mb-4">Explore the spread</h2><SpreadSlider key={game.game_id} rows={game.spread_surface} home={game.home} away={game.away} marketLine={game.market.spread_home}/><p className="mt-4 text-xs text-[var(--text-tertiary)]">Move between published lines. A push is a separate outcome at football’s key numbers.</p></section>
          <section className="card p-4 sm:p-5"><h2 className="eyebrow mb-4">Every point tells a story</h2><MarginDistribution data={game.margin_distribution} home={game.home} away={game.away}/></section>
        </>:null}
      </div>
      <div className="min-w-0 space-y-3 xl:sticky xl:top-6"><div className="flex items-center justify-between"><h2 className="eyebrow">The matchups</h2><span className="numeric text-xs text-[var(--text-tertiary)]">{visible.length} games</span></div>
        <div className="lab-fixtures" style={compact ? {maxHeight:"24rem"} : undefined}>{visible.map(g=><button type="button" key={g.game_id} onClick={()=>choose(g.game_id)} aria-pressed={game.game_id===g.game_id} className="lab-fixture"><span className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><TeamLogo abbreviation={g.away} name={g.away_name} size={20}/><span>{g.away}</span><span className="text-[var(--text-tertiary)]">@</span><span>{g.home}</span><TeamLogo abbreviation={g.home} name={g.home_name} size={20}/></span><span className="numeric text-[10px]">W{g.week}</span></span><span className="mt-2 block text-[10px] text-[var(--text-secondary)]">{kickoff(g.date_utc)}</span><span className="mt-1 block text-[11px]">{g.away} {pct(g.p_away)} · {g.home} {pct(g.p_home)}</span></button>)}</div>
        {!compact ? <div className="card p-4"><p className="eyebrow">Know the model</p><p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">Elo strength, form, rest and a discrete margin model. No quarterback availability, injuries or in-game updates in these probabilities.</p><p className="mt-2 text-xs text-[var(--text-tertiary)]">Training cutoff: {data.forecast?.trained_through ? stamp(data.forecast.trained_through) : 'not recorded in this artifact'}.</p><Link href="/accuracy" className="mt-3 inline-block text-xs text-[var(--accent-info)]">See how it performs →</Link></div> : null}
      </div>
    </div>}
    <p role="status" className="break-words text-xs text-[var(--text-secondary)]">{status}</p>
  </section>
}
