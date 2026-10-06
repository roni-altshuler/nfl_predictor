import { getGameForecasts } from '@/lib/artifacts'
import { getGameContext } from '@/lib/history'

/** Resolve only events already published by this app; never arbitrary provider events. */
export function playerGameContext(id: string) {
  const forecasts = getGameForecasts()
  const upcoming = forecasts?.games.find(game => game.game_id === id)
  if (upcoming) return { id, home: upcoming.home, away: upcoming.away, season: upcoming.season,
    week: upcoming.week, date: upcoming.date_utc, datePrecision: 'instant' as const, includeInjuries: true }
  for (const meetings of Object.values(getGameContext()?.meetings ?? {})) {
    const played = meetings.find(game => game.game_id === id)
    if (played) return { id, home: played.home, away: played.away, season: played.season,
      week: played.week, date: played.date, datePrecision: 'day' as const, includeInjuries: false }
  }
  return null
}
