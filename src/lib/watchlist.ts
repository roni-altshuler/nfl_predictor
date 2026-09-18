'use client'

import { useEffect, useState } from 'react'

/**
 * The followed-teams list, on localStorage — the soccer sibling's pattern.
 *
 * **This is a device preference, not an account.** There is no server, no
 * sync, and nothing here feeds the model; it only filters what a reader
 * sees first. Reads re-run on `storage` (another tab changed it) and on
 * `focus` (this tab came back), so two tabs never disagree for long.
 *
 * Stored as an array of team abbreviations. Everything degrades to an empty
 * list — private mode, disabled storage, malformed JSON — because a broken
 * preference must never break a page of forecasts.
 */

const KEY = 'gridiron:watchlist:v1'
let memory: string[] | null = null

export function readWatchlist(): string[] {
  if (memory !== null) return memory
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : []
  } catch {
    return []
  }
}

function write(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    memory = null
  } catch {
    memory = list
  }
  // `storage` only fires in OTHER tabs; notify this one explicitly.
  window.dispatchEvent(new Event('gridiron:watchlist'))
}

export function toggleTeam(abbr: string): string[] {
  const current = readWatchlist()
  const next = current.includes(abbr)
    ? current.filter((t) => t !== abbr)
    : [...current, abbr]
  write(next)
  return next
}

/** The list, live: re-reads on storage, focus, and same-tab toggles. */
export function useWatchlist(): string[] {
  const [list, setList] = useState<string[]>([])

  useEffect(() => {
    const sync = () => setList(readWatchlist())
    sync()
    window.addEventListener('storage', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('gridiron:watchlist', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('gridiron:watchlist', sync)
    }
  }, [])

  return list
}
