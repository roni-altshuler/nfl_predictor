'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

const destinations = [['forecast', 'Prediction'], ['players', 'Players'], ['comparison', 'Compare leaders'], ['availability', 'Availability'], ['context', 'Recent meetings'], ['paths', 'Close-game paths'], ['distribution', 'Score range'], ['market', 'Market']]

/** Section links also reveal optional detail, including shared hash URLs. */
function revealSection(id: string) {
  const target = document.getElementById(id)
  if (!target) return
  let parent = target.parentElement
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true
    parent = parent.parentElement
  }
  target.tabIndex = -1
  target.scrollIntoView()
  target.focus({ preventScroll: true })
}

export function GameSectionNav({ sections }: { sections?: string[] } = {}) {
  const pathname = usePathname()
  useEffect(() => {
    const revealHash = () => {
      const id = window.location.hash.slice(1)
      if (destinations.some(([destination]) => destination === id)) revealSection(id)
    }
    revealHash()
    window.addEventListener('hashchange', revealHash)
    return () => window.removeEventListener('hashchange', revealHash)
  }, [pathname])
  return <nav aria-label="Game sections" className="flex gap-2 overflow-x-auto pb-1">
    {destinations.filter(([id]) => !sections || sections.includes(id)).map(([id, label]) =>
      <a key={id} href={`#${id}`} className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-[var(--border-color)] px-3 font-mono text-xs text-[var(--text-secondary)] hover:border-[var(--border-hover)]"
        onClick={event => {
          if (!document.getElementById(id)) return
          event.preventDefault()
          window.history.replaceState(window.history.state, '', `#${id}`)
          revealSection(id)
        }}>{label}</a>)}
    <Link href="/accuracy" className="inline-flex min-h-[44px] shrink-0 items-center px-3 font-mono text-xs text-[var(--accent-info)] hover:underline">Model evidence →</Link>
  </nav>
}
