import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'

/** The public ledger reports experiments separately from the production scorecard. */
export function ResearchLedger() {
  const experiments = [
    {file:'recency_experiment.json',name:'Recent seasons, more weight',years:'2019–2025',key:'paired_brier'},
    {file:'calibration_experiment.json',name:'Elo blend + calibration',years:'2022–2025',key:'candidate_minus_incumbent'},
  ].flatMap(config => {
    try {
      const report=JSON.parse(fs.readFileSync(path.join(process.cwd(),'reports',config.file),'utf8'))
      const paired=report.summary[config.key]
      if (!paired || ![paired.mean,paired.lo,paired.hi,report.summary.n].every(Number.isFinite)) return []
      return [{...config,n:report.summary.n as number,mean:paired.mean as number,lo:paired.lo as number,hi:paired.hi as number}]
    } catch { return [] }
  })
  if (!experiments.length) return null
  const signed=(x:number)=>`${x>=0?'+':''}${x.toFixed(5)}`
  return <section aria-label="Model development" className="space-y-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="eyebrow">The model is accountable</h2><span className="chip text-[var(--accent-warn)]">Exploratory research · not live performance</span></div>
    <div className="grid gap-3 sm:grid-cols-2">{experiments.map(e=><article key={e.file} className="card p-4 sm:p-5"><p className="eyebrow">Held from production</p><h3 className="mt-3 text-base font-semibold">{e.name}</h3><p className="numeric mt-4 text-2xl">{signed(e.mean)}</p><p className="mt-1 text-xs text-[var(--text-secondary)]">Brier change versus the incumbent · lower is better</p><p className="numeric mt-3 text-xs text-[var(--text-secondary)]">95% interval {signed(e.lo)} to {signed(e.hi)}</p><p className="mt-2 text-xs text-[var(--text-tertiary)]">{e.n.toLocaleString()} paired games · {e.years} · weekly block bootstrap</p></article>)}</div>
    <p className="text-xs leading-relaxed text-[var(--text-secondary)]">Neither challenger established better probability forecasts. These experiments use the archived local corpus through the 2025 postseason; their samples differ from the production benchmark. Game probabilities remain on the incumbent model.</p>
    <div className="card flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold">Better season simulations, now explorable</p><p className="mt-1 text-xs text-[var(--text-secondary)]">Actual and simulated head-to-head results now reach the playoff seeding step.</p></div><Link className="lab-control" href="/lab">Explore playoff stakes ↗</Link></div>
  </section>
}
