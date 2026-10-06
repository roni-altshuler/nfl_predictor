import type { AthleteReference } from './athletes'
import type { GameDetail, InjuryEntry } from './espn'

export interface PlayerSnapshot {
  athlete: AthleteReference
  team: string
  statistics: { label: string; value: string }[]
  availability: InjuryEntry[]
}

/** Selected category leaders and reported injuries, never a complete roster. */
export function playerSnapshots(detail: GameDetail, includeInjuries = true): PlayerSnapshot[] {
  const players = new Map<string, PlayerSnapshot>()
  const conflicts = new Set<string>()
  function get(athlete: AthleteReference, team: string) {
    if (!athlete.id || !athlete.displayName || conflicts.has(athlete.id)) return null
    const existing = players.get(athlete.id)
    if (existing && existing.team !== team) {
      players.delete(athlete.id)
      conflicts.add(athlete.id)
      return null
    }
    if (existing) return existing
    const player = { athlete, team, statistics: [], availability: [] } as PlayerSnapshot
    players.set(athlete.id, player)
    return player
  }
  for (const group of detail.leaders) for (const line of group.leaders) {
    get(line.athlete, group.team)?.statistics.push({ label: group.label, value: line.stat })
  }
  if (includeInjuries) for (const entry of detail.injuries) get(entry.athlete, entry.team)?.availability.push(entry)
  return [...players.values()]
}
