'use client'

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * The week jump rail: sticky chips, one per week.
 *
 * Two client behaviours a plain anchor list cannot provide, which is why
 * this is the schedule's one island of JavaScript:
 *
 * - **Jumping to a folded week unfolds it first.** The weeks are `<details>`
 *   elements so eighteen calendars do not stack into one endless scroll; an
 *   anchor into a closed one would land the reader on a shut summary bar.
 * - **The chip for the week in view stays lit** while scrolling, so position
 *   in the season is always legible from the rail.
 *
 * Everything still works without JavaScript: the chips are real anchors and
 * the current week's `<details>` ships open from the server.
 */
export function WeekRail({ weeks, next }: { weeks: number[]; next: number | null }) {
  const [inView, setInView] = useState<number | null>(null)

  useEffect(() => {
    const sections = weeks
      .map((week) => document.getElementById(`week-${week}`))
      .filter((el): el is HTMLElement => el !== null)
    if (!sections.length || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => Number(entry.target.id.replace('week-', '')))
        if (visible.length) setInView(Math.min(...visible))
      },
      // The band is the upper third of the viewport: the week whose header
      // has most recently crossed it is the one the reader is looking at.
      { rootMargin: '-8% 0px -60% 0px' },
    )
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [weeks])

  const jump = (week: number) => {
    const target = document.getElementById(`week-${week}`)
    if (target instanceof HTMLDetailsElement) target.open = true
  }

  return (
    <nav
      aria-label="Jump to week"
      className="sticky top-[var(--shell-topbar-h)] z-20 -mx-4 border-b border-[var(--border-color)] bg-[var(--nav-bg)] px-4 py-2 backdrop-blur-md md:top-0"
    >
      <ul className="flex flex-wrap gap-1">
        {weeks.map((week) => {
          const active = week === inView
          const upNext = week === next
          return (
            <li key={week}>
              <a
                href={`#week-${week}`}
                onClick={() => jump(week)}
                aria-current={upNext ? 'true' : undefined}
                className={cn(
                  'block min-h-[28px] rounded-sm border px-2 py-1 font-mono text-[11px] transition-colors',
                  active
                    ? 'border-[var(--border-hover)] bg-[var(--card-hover)] text-[var(--text-primary)]'
                    : upNext
                      ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]'
                      : 'border-[var(--border-color)] text-[var(--text-tertiary)] hover:border-[var(--border-hover)] hover:text-[var(--text-secondary)]',
                )}
              >
                {week}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
