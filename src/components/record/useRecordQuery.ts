'use client'

import { useSyncExternalStore } from 'react'

export type RecordView = 'settled' | 'pending' | 'unscored' | 'all'
export interface RecordQuery { season: number | null; week: number | null; view: RecordView }
const eventName = 'gridiron:record-query'
function subscribe(notify: () => void) {
  window.addEventListener('popstate', notify)
  window.addEventListener(eventName, notify)
  return () => { window.removeEventListener('popstate', notify); window.removeEventListener(eventName, notify) }
}
const snapshot = () => window.location.search
const serverSnapshot = () => null

/** The URL is the single source of truth; Back and reload restore the record view. */
export function useRecordQuery(defaultSeason: number | null, seasons: number[]) {
  const search = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const params = new URLSearchParams(search ?? '')
  const year = Number(params.get('season'))
  const week = params.get('week')
  const view = params.get('show')
  const selection: RecordQuery = {
    season: seasons.includes(year) ? year : defaultSeason,
    week: week && /^(?:[1-9]|1[0-8])$/.test(week) ? Number(week) : null,
    view: view === 'pending' || view === 'unscored' || view === 'all' ? view : 'settled',
  }
  function select(update: Partial<RecordQuery>) {
    const next = { ...selection, ...update }, url = new URL(window.location.href)
    for (const [key, value] of [['season', next.season], ['week', next.week], ['show', next.view]] as const) {
      if (value === null || (key === 'show' && value === 'settled')) url.searchParams.delete(key)
      else url.searchParams.set(key, String(value))
    }
    window.history.pushState(null, '', url)
    window.dispatchEvent(new Event(eventName))
  }
  return { ...selection, select, ready: search !== null }
}
