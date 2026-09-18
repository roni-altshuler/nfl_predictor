'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { GameForecast } from '@/lib/artifacts'
import type { PlayoffScenarios, ScenarioOutcome } from '@/lib/playoffScenarios'
import { pct } from '@/lib/format'
import { TeamLogo } from '@/components/primitives/TeamLogo'

export function PlayoffImpact({ game, data }: { game: GameForecast; data: PlayoffScenarios | null }) {
  const [outcome, setOutcome] = useState<ScenarioOutcome | 'baseline'>('baseline')
  const scenario = data?.games.find(g => g.game_id === game.game_id)
  if (!data || !scenario) return <section className="card p-5" aria-label="Playoff stakes"><h2 className="eyebrow">The January effect</h2><p className="mt-3 text-sm text-[var(--text-secondary)]">Playoff scenarios are published for the next available week. This matchup has no matching simulation yet.</p></section>
  const branch = outcome === 'baseline' ? null : scenario.branches[outcome]
  const chosen = branch?.teams ?? data.baseline
  const participants = [game.away_team_id, game.home_team_id]
  const ripples = branch?.available ? data.baseline.filter(t => !participants.includes(t.team_id)).map(t => ({...t, delta:(chosen.find(c => c.team_id === t.team_id)?.p_playoffs ?? t.p_playoffs)-t.p_playoffs})).sort((a,b) => Math.abs(b.delta)-Math.abs(a.delta)).slice(0,3) : []
  return <section className="card overflow-hidden" aria-label="Playoff stakes" id="playoff-stakes">
    <div className="border-b border-[var(--border-color)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="eyebrow">The January effect</h2><span className="chip">{data.simulations.toLocaleString()} simulated seasons</span></div>
      <p className="mt-3 text-xl font-semibold">One game. A different playoff picture.</p>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">Choose a result to explore the seasons where it happened.</p>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Explore playoff outcomes">
        <button type="button" className="lab-control" aria-pressed={outcome==='baseline'} onClick={() => setOutcome('baseline')}>Baseline</button>
        {(['away','home','tie'] as const).map(o => <button key={o} type="button" className="lab-control" aria-pressed={outcome===o} disabled={!scenario.branches[o].available} onClick={() => setOutcome(o)}>{o==='tie'?'Tie':`${game[o]} wins`}</button>)}
      </div>
      {!scenario.branches.tie.available ? <p className="mt-2 text-xs text-[var(--text-tertiary)]">Tie scenario withheld: {scenario.branches.tie.samples.toLocaleString()} samples; at least {data.min_branch_samples} needed.</p> : null}
    </div>
    <div aria-live="polite" aria-atomic="true" className="p-4 sm:p-5">
      <p className="mb-4 font-mono text-xs text-[var(--text-secondary)]" data-testid="scenario-basis">{outcome==='baseline'?'Simulation baseline · all outcomes':`${outcome==='tie'?'A tie':`${game[outcome]} wins`} · ${branch?.samples.toLocaleString()} matching simulations`}</p>
      <div className="grid gap-5 sm:grid-cols-2">
        {participants.map(id => {
          const base = data.baseline.find(t => t.team_id===id)!
          const t = chosen.find(t => t.team_id===id)!
          const delta = (t.p_playoffs-base.p_playoffs)*100
          return <div key={id} className="min-w-0">
            <Link className="inline-flex items-center gap-2 text-sm" href={`/teams/${base.abbreviation}`}><TeamLogo abbreviation={base.abbreviation} name={base.name} size={28}/>{base.abbreviation}</Link>
            <div className="mt-3 flex flex-wrap items-baseline gap-2"><span className="numeric text-3xl" data-testid={`scenario-${base.abbreviation}`}>{pct(t.p_playoffs)}</span><span className="text-xs text-[var(--text-secondary)]">make playoffs</span></div>
            <div className="scenario-track my-3" aria-hidden="true"><span style={{width:`${t.p_playoffs*100}%`}}/><i style={{left:`${base.p_playoffs*100}%`}}/></div>
            <p className="numeric text-xs text-[var(--text-secondary)]">{delta>=0?'+':''}{delta.toFixed(1)} pp · baseline {pct(base.p_playoffs)}</p>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs"><div><dt className="text-[var(--text-tertiary)]">Win division</dt><dd className="numeric mt-1">{pct(t.p_division)}</dd></div><div><dt className="text-[var(--text-tertiary)]">Win Super Bowl</dt><dd className="numeric mt-1">{pct(t.p_championship)}</dd></div></dl>
          </div>
        })}
      </div>
      {ripples.length ? <div className="mt-5 border-t border-[var(--border-color)] pt-4"><h3 className="eyebrow">Elsewhere in the race</h3><div className="mt-3 flex flex-wrap gap-2">{ripples.map(t => <Link key={t.team_id} className="chip" href={`/teams/${t.abbreviation}`}>{t.abbreviation} <span className="numeric">{t.delta>=0?'+':''}{(t.delta*100).toFixed(1)} pp</span></Link>)}</div><p className="mt-2 text-xs text-[var(--text-tertiary)]">Largest changes for other teams. Tiny differences can be simulation noise.</p></div>:null}
    </div>
    <details className="border-t border-[var(--border-color)] p-4 text-xs text-[var(--text-secondary)] sm:px-5"><summary className="min-h-6 cursor-pointer">How to read this simulation</summary><div className="mt-3 space-y-3 leading-relaxed"><p>The bars show playoff chances; the white mark shows this simulation’s baseline. “pp” means percentage points. This is a comparison within the same simulated seasons, including shared team-strength uncertainty, not a causal effect of forcing a result.</p><p>These outlooks use the corrected head-to-head simulator ({data.simulation_version}); an older season page may use a previous simulator. {data.seeding_note}</p>{branch?.available ? <p>95% Monte Carlo ranges for playoff chances: {participants.map(id => { const t=branch.teams.find(t=>t.team_id===id)!;return `${data.baseline.find(t=>t.team_id===id)!.abbreviation} ${pct(t.playoff_mc_interval[0])}–${pct(t.playoff_mc_interval[1])}` }).join(' · ')}. These measure sampling precision, not model accuracy.</p>:null}<Link className="inline-block text-[var(--accent-info)]" href="/accuracy">Read the model’s record →</Link></div></details>
  </section>
}
