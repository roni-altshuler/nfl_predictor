'use client'

import { useEffect, useState } from 'react'

/**
 * Live scores, straight from ESPN's public scoreboard, in the browser.
 *
 * **The site stays fully static.** There is no API route and no server
 * polling — the scoreboard endpoint serves `access-control-allow-origin: *`,
 * so the reader's own browser asks ESPN directly. One module-level poller is
 * shared by every badge on the page; sixteen cards do not make sixteen
 * requests.
 *
 * **Polling is gated on the schedule, not always-on.** The store only
 * fetches while some subscribed game is inside its live window (30 minutes
 * before kickoff to six hours after, generous enough for overtime and
 * weather delays) or already known to be in progress. On any other day of
 * the week this module does exactly nothing.
 *
 * **The forecast is never overwritten.** A live score is a fact about now;
 * the probabilities beside it are the pre-game call this site is graded on.
 * The badge adds the score — it does not restate the model.
 */

export interface LiveGame {
  state: 'pre' | 'in' | 'post'
  homeScore: number
  awayScore: number
  /** ESPN's human phrasing: "Q3 4:12", "Final", "Final/OT". */
  detail: string
}

const SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
const POLL_MS = 60_000
const BEFORE_MS = 30 * 60_000
const AFTER_MS = 6 * 60 * 60_000

const games = new Map<string, LiveGame>()
const interests = new Map<string, number>() // gameId -> kickoff epoch ms
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
let fetching = false

function windowOpen(): boolean {
  const now = Date.now()
  for (const [id, kickoff] of interests) {
    if (games.get(id)?.state === 'in') return true
    if (now >= kickoff - BEFORE_MS && now <= kickoff + AFTER_MS) return true
  }
  return false
}

async function poll() {
  if (fetching || !windowOpen()) return
  fetching = true
  try {
    const res = await fetch(SCOREBOARD, { cache: 'no-store' })
    if (!res.ok) return
    const data = await res.json()
    for (const event of data?.events ?? []) {
      const id = String(event?.id ?? '')
      if (!interests.has(id)) continue
      const status = event?.status?.type
      const competitors = event?.competitions?.[0]?.competitors ?? []
      const home = competitors.find((c: { homeAway?: string }) => c.homeAway === 'home')
      const away = competitors.find((c: { homeAway?: string }) => c.homeAway === 'away')
      const state = status?.state
      if (state !== 'pre' && state !== 'in' && state !== 'post') continue
      games.set(id, {
        state,
        homeScore: Number(home?.score ?? 0),
        awayScore: Number(away?.score ?? 0),
        detail: String(status?.shortDetail ?? ''),
      })
    }
    listeners.forEach((fn) => fn())
  } catch {
    /* transient network failure — keep the last known state */
  } finally {
    fetching = false
  }
}

function ensureTimer() {
  if (timer) return
  timer = setInterval(() => {
    if (!interests.size) {
      clearInterval(timer!)
      timer = null
      return
    }
    void poll()
  }, POLL_MS)
  void poll()
}

/**
 * Subscribe one game. Returns its live state, or null before anything is
 * known — which is also the permanent answer outside the live window.
 */
export function useLiveGame(gameId: string, kickoffIso: string): LiveGame | null {
  const [state, setState] = useState<LiveGame | null>(games.get(gameId) ?? null)

  useEffect(() => {
    interests.set(gameId, new Date(kickoffIso).getTime())
    const update = () => setState(games.get(gameId) ?? null)
    listeners.add(update)
    ensureTimer()
    update()
    return () => {
      listeners.delete(update)
      interests.delete(gameId)
    }
  }, [gameId, kickoffIso])

  return state
}
