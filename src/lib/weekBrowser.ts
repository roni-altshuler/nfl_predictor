import type { GameForecast } from './artifacts'

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function easternGameDay(iso: string): string { return formatter.format(new Date(iso)) }

export function publishedWeek(value: string | null, weeks: number[], fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback
  const number = Number(value)
  return weeks.includes(number) ? number : fallback
}

export function weekDays(games: GameForecast[]): Array<[string, GameForecast[]]> {
  const groups = new Map<string, GameForecast[]>()
  for (const game of [...games].sort((a, b) => a.date_utc.localeCompare(b.date_utc))) {
    const day = easternGameDay(game.date_utc)
    groups.set(day, [...(groups.get(day) ?? []), game])
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b))
}
