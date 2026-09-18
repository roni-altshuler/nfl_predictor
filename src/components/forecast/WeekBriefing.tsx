'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { GameForecast } from '@/lib/artifacts'
import { kickoff, pct } from '@/lib/format'
import { TeamLogo } from '@/components/primitives/TeamLogo'

/** An editorial view derived only from published forecasts and simulation rows. */
export function WeekBriefing({ games, stakes: publishedStakes, asOf }: { games: Pick<GameForecast,'game_id'|'date_utc'|'week'|'home'|'away'|'home_name'|'away_name'|'p_home'|'p_away'>[]; stakes: {game_id:string;swing:number|null}[]; asOf: string }) {
  const [now, setNow] = useState(Date.parse(asOf))
  useEffect(() => { const update=()=>setNow(Date.now()); update(); const timer=setInterval(update,30000); return ()=>clearInterval(timer) },[])
  const upcoming=games.filter(g=>Date.parse(g.date_utc)>now).sort((a,b)=>Date.parse(a.date_utc)-Date.parse(b.date_utc))
  const week=upcoming[0]?.week
  const slate=upcoming.filter(g=>g.week===week)
  if (!slate.length) return null
  const closest=[...slate].sort((a,b)=>Math.abs(a.p_home-a.p_away)-Math.abs(b.p_home-b.p_away))[0]
  const stakes=slate.map(g=>({game:g,value:publishedStakes.find(s=>s.game_id===g.game_id)?.swing ?? null})).filter(x=>x.value!==null).sort((a,b)=>(b.value??0)-(a.value??0))[0]
  const picks=[
    {label:'First on the board',game:slate[0],value:kickoff(slate[0].date_utc),note:'The next kickoff in this week’s published schedule.'},
    {label:'Too close to call',game:closest,value:`${pct(closest.p_away)} / ${pct(closest.p_home)}`,note:`${closest.away} / ${closest.home} win chances · closest matchup in the model.`},
    ...(stakes?[{label:'January on the line',game:stakes.game,value:`${stakes.value!.toFixed(1)} pp`,note:'Largest playoff-chance difference between home-win and away-win scenarios for either team.'}]:[]),
  ]
  return <section aria-label="Week briefing" className="space-y-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><div><p className="eyebrow">Your week {week} briefing</p><h2 className="mt-2 text-2xl font-semibold">Find your game.</h2></div><Link href="/lab" className="text-sm text-[var(--accent-info)]">Explore every matchup ↗</Link></div>
    <div className="grid gap-3 lg:grid-cols-3">{picks.map((pick,index)=><Link key={pick.label} href={`/lab?game=${pick.game.game_id}`} className="briefing-card card group flex flex-col p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2"><p className="eyebrow">{pick.label}</p><span className="numeric text-xs text-[var(--text-tertiary)]">0{index+1} ↗</span></div>
      <div className="mt-6 flex items-center gap-2"><TeamLogo abbreviation={pick.game.away} name={pick.game.away_name} size={30}/><span className="text-lg font-semibold">{pick.game.away}</span><span className="text-xs text-[var(--text-tertiary)]">at</span><span className="text-lg font-semibold">{pick.game.home}</span><TeamLogo abbreviation={pick.game.home} name={pick.game.home_name} size={30}/></div>
      <p className="numeric mt-4 text-lg">{pick.value}</p><p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">{pick.note}</p>
    </Link>)}</div>
  </section>
}
