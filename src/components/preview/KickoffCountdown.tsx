'use client'

import { useEffect, useState } from 'react'

/**
 * Time to kickoff, ticking by the minute.
 *
 * The server renders the full date beside this, so the countdown is an
 * enhancement rather than the only statement of when the season starts —
 * before hydration, with JavaScript off, or after kickoff it renders
 * nothing and the date stands alone.
 */
export function KickoffCountdown({ kickoffIso }: { kickoffIso: string }) {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    const kickoff = new Date(kickoffIso).getTime()
    const tick = () => {
      const ms = kickoff - Date.now()
      if (ms <= 0) {
        setLabel(null)
        return
      }
      const days = Math.floor(ms / 86_400_000)
      const hours = Math.floor((ms % 86_400_000) / 3_600_000)
      const minutes = Math.floor((ms % 3_600_000) / 60_000)
      setLabel(
        days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
      )
    }
    tick()
    const timer = setInterval(tick, 60_000)
    return () => clearInterval(timer)
  }, [kickoffIso])

  if (!label) return null

  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--accent-primary)] px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--accent-primary)]">
      kickoff in {label}
    </span>
  )
}
