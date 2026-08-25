'use client'

import { useEffect, useState } from 'react'

import { useWatchlist } from '@/lib/watchlist'
import { cn } from '@/lib/utils'

/**
 * "My teams only" on the schedule.
 *
 * The schedule is 272 server-rendered chips; re-rendering them client-side
 * would mean serializing every forecast into the page. Instead each chip
 * carries `data-teams`, and this toggle hides the non-matching ones in the
 * DOM — progressive enhancement in the literal sense: without JavaScript
 * the control never appears and the schedule is simply complete.
 *
 * When the filter is on, every week is unfolded — a filter that leaves the
 * reader to open eighteen `<details>` to find their team is not a filter.
 */
export function FollowFilter() {
  const watchlist = useWatchlist()
  const [on, setOn] = useState(false)

  useEffect(() => {
    const followed = new Set(watchlist)
    const chips = document.querySelectorAll<HTMLElement>('[data-teams]')
    chips.forEach((chip) => {
      const teams = (chip.dataset.teams ?? '').split(',')
      const match = teams.some((t) => followed.has(t))
      const row = chip.closest('li') ?? chip
      ;(row as HTMLElement).style.display = on && !match ? 'none' : ''
    })
    if (on) {
      document
        .querySelectorAll<HTMLDetailsElement>('details[id^="week-"]')
        .forEach((d) => {
          d.open = true
        })
    }
    return () => {
      chips.forEach((chip) => {
        const row = chip.closest('li') ?? chip
        ;(row as HTMLElement).style.display = ''
      })
    }
  }, [on, watchlist])

  if (!watchlist.length) return null

  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setOn((v) => !v)}
      className={cn(
        'min-h-[30px] rounded-full px-3 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors',
        on
          ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
          : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
      )}
    >
      My teams only · {watchlist.length}
    </button>
  )
}
