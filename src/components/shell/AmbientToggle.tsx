'use client'

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * The ambient dial: "Board · soft / vivid / off".
 *
 * The chalkboard is the site's identity layer and also the thing most
 * likely to compete with the numbers, so the reader holds the dial. Three
 * states, persisted per device in localStorage under `gridiron-ambient`,
 * applied as `data-ambient` on <html> (globals.css does the dimming;
 * ChalkboardField stops its loop on `off`), and announced with an
 * `ambientchange` event so the canvas and every other instance of this
 * control — the sidebar and the mobile header both carry one — stay in
 * step. The root layout stamps the attribute before first paint, so this
 * component only ever reads a value that is already there.
 *
 * It is a preference, not an account setting, like the watchlist.
 */

export type Ambient = 'soft' | 'vivid' | 'off'

const KEY = 'gridiron-ambient'
const OPTIONS: Ambient[] = ['soft', 'vivid', 'off']

function isAmbient(value: unknown): value is Ambient {
  return value === 'soft' || value === 'vivid' || value === 'off'
}

function readAmbient(): Ambient {
  const current = document.documentElement.dataset.ambient
  return isAmbient(current) ? current : 'soft'
}

export function AmbientToggle({ className }: { className?: string }) {
  // Render the default first and correct it after mount: the server has no
  // idea what this device chose, and a wrong initial `aria-pressed` for one
  // frame is cheaper than a hydration mismatch.
  const [value, setValue] = useState<Ambient>('soft')

  useEffect(() => {
    setValue(readAmbient())
    const follow = () => setValue(readAmbient())
    window.addEventListener('ambientchange', follow)
    return () => window.removeEventListener('ambientchange', follow)
  }, [])

  const choose = (next: Ambient) => {
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // Storage blocked: the choice still applies for this page view.
    }
    document.documentElement.dataset.ambient = next
    window.dispatchEvent(new CustomEvent('ambientchange', { detail: next }))
    setValue(next)
  }

  return (
    <div
      role="group"
      aria-label="Chalkboard animation"
      className={cn('flex items-center gap-1', className)}
    >
      <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
        Board
      </span>
      <div className="flex items-center rounded-sm border border-[var(--border-color)]">
        {OPTIONS.map((option, index) => {
          const pressed = value === option
          return (
            <button
              key={option}
              type="button"
              aria-pressed={pressed}
              onClick={() => choose(option)}
              className={cn(
                // 44px tap targets below md (the header), a quieter 28px in
                // the sidebar, where a pointer is the norm.
                'min-h-[44px] min-w-[44px] px-2 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors md:min-h-[28px] md:min-w-0',
                index > 0 && 'border-l border-[var(--border-color)]',
                pressed
                  ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
              )}
            >
              {option}
            </button>
          )
        })}
      </div>
    </div>
  )
}
