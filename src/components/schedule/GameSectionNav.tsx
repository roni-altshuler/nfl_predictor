'use client'

import Link from 'next/link'

export function GameSectionNav({ sections }: { sections?: string[] } = {}) {
  return <nav aria-label="Game sections" className="flex flex-wrap gap-2">
    {[['forecast', 'Projection'], ['distribution', 'Score range'], ['market', 'Market'], ['availability', 'Availability'], ['comparison', 'Compare leaders'], ['players', 'Players'], ['context', 'Recent meetings']].filter(([id]) => !sections || sections.includes(id)).map(([id, label]) =>
      <a key={id} href={`#${id}`} className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--border-color)] px-3 font-mono text-xs text-[var(--text-secondary)] hover:border-[var(--border-hover)]"
        onClick={event => {
          const target = document.getElementById(id)
          if (!target) return
          event.preventDefault()
          window.history.replaceState(window.history.state, '', `#${id}`)
          target.tabIndex = -1
          target.scrollIntoView()
          target.focus({ preventScroll: true })
        }}>{label}</a>)}
    <Link href="/accuracy" className="inline-flex min-h-[44px] items-center px-3 font-mono text-xs text-[var(--accent-info)] hover:underline">Model evidence →</Link>
  </nav>
}
