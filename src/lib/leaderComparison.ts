import type { GameDetail, PlayerLine } from './espn'
import { playerSnapshots } from './playerProfiles'

export interface ComparedLeader {
  line: PlayerLine | null
  state: 'reported' | 'missing' | 'ambiguous' | 'conflicting'
}

export interface LeaderComparisonRow {
  key: string
  label: string
  away: ComparedLeader
  home: ComparedLeader
}

/** Pair only the same provider category in this event; preserve display values verbatim. */
export function leaderComparisons(detail: GameDetail, home: string, away: string): LeaderComparisonRow[] {
  if (detail.source.status !== 'available' || home === away) return []
  const identities = new Map(playerSnapshots(detail, false).map(player => [
    `${player.athlete.provider}:${player.athlete.id}`, player.team,
  ]))
  const rows = new Map<string, LeaderComparisonRow>()
  for (const group of detail.leaders) {
    const side = group.team === away ? 'away' : group.team === home ? 'home' : null
    const key = group.categoryKey?.trim() || (group.label.trim() ? `label:${group.label.trim()}` : '')
    if (!side || !key) continue
    let row = rows.get(key)
    if (!row) {
      row = { key, label: group.label || 'Category not supplied',
        away: { line: null, state: 'missing' }, home: { line: null, state: 'missing' } }
      rows.set(key, row)
    }
    const line = group.leaders[0]
    if (!line) continue
    if (row[side].state !== 'missing' || group.leaders.length > 1) {
      row[side] = { line: null, state: 'ambiguous' }
    } else if (line.athlete.id && identities.get(`${line.athlete.provider}:${line.athlete.id}`) !== group.team) {
      row[side] = { line: null, state: 'conflicting' }
    } else {
      row[side] = { line, state: 'reported' }
    }
  }
  return [...rows.values()]
}
