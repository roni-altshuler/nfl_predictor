import type { GameForecasts } from './artifacts'

export type ScenarioOutcome = 'home' | 'away' | 'tie'
export interface ScenarioTeam {
  team_id: number
  p_playoffs: number
  p_division: number
  p_championship: number
  playoff_mc_interval: [number, number]
}
export interface ScenarioBranch { samples: number; available: boolean; teams: ScenarioTeam[] }
export interface GameScenario {
  game_id: string
  home_team_id: number
  away_team_id: number
  branches: Record<ScenarioOutcome, ScenarioBranch>
}
export interface ScenarioBaseline extends Omit<ScenarioTeam, 'playoff_mc_interval'> {
  abbreviation: string
  name: string
}
export interface PlayoffScenarios {
  season: number
  generated_at: string
  computed_at: string
  model_version: string
  simulation_version: string
  forecast_sha256: string
  simulations: number
  min_branch_samples: number
  method: 'conditional_simulation'
  seeding_note: string
  baseline: ScenarioBaseline[]
  games: GameScenario[]
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const probability = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
const team = (v: unknown): v is ScenarioTeam => object(v) && Number.isInteger(v.team_id) && ['p_playoffs','p_division','p_championship'].every(k => probability(v[k]))

/** Reject an incoherent scenario artifact as a unit: a partial branch changes its meaning. */
export function parseScenarios(input: unknown, forecast: GameForecasts | null): PlayoffScenarios | null {
  if (!forecast || !object(input) || input.season !== forecast.season || input.generated_at !== forecast.generated_at || input.model_version !== forecast.model_version || input.method !== 'conditional_simulation') return null
  if (typeof input.simulation_version !== 'string' || typeof input.seeding_note !== 'string' || typeof input.computed_at !== 'string' || !Number.isFinite(Date.parse(input.computed_at))) return null
  if (typeof input.forecast_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.forecast_sha256) || !Number.isInteger(input.simulations) || Number(input.simulations)<1 || input.min_branch_samples !== 200) return null
  if (!Array.isArray(input.baseline) || input.baseline.length !== 32 || !input.baseline.every(t => team(t) && object(t) && typeof t.abbreviation === 'string' && typeof t.name === 'string')) return null
  const ids = new Set(input.baseline.map(t => t.team_id))
  if (ids.size !== 32 || !Array.isArray(input.games)) return null
  const seen = new Set<string>()
  for (const g of input.games) {
    if (!object(g) || typeof g.game_id !== 'string' || seen.has(g.game_id) || !object(g.branches)) return null
    seen.add(g.game_id)
    const fixture = forecast.games.find(f => f.game_id === g.game_id)
    if (!fixture || fixture.home_team_id !== g.home_team_id || fixture.away_team_id !== g.away_team_id) return null
    if (!ids.has(fixture.home_team_id) || !ids.has(fixture.away_team_id) || input.baseline.find(t=>t.team_id===fixture.home_team_id)?.abbreviation !== fixture.home || input.baseline.find(t=>t.team_id===fixture.away_team_id)?.abbreviation !== fixture.away) return null
    let samples = 0
    for (const outcome of ['home','away','tie']) {
      const b = g.branches[outcome]
      if (!object(b) || !Number.isInteger(b.samples) || Number(b.samples)<0 || b.available !== (Number(b.samples)>=200) || !Array.isArray(b.teams)) return null
      samples += Number(b.samples)
      if (!b.available) { if (b.teams.length) return null; continue }
      if (b.teams.length !== 32 || new Set(b.teams.map(t => t?.team_id)).size !== 32 || !b.teams.every(t => team(t) && ids.has(t.team_id) && Array.isArray(t.playoff_mc_interval) && t.playoff_mc_interval.length === 2 && t.playoff_mc_interval.every(probability) && t.playoff_mc_interval[0] <= t.p_playoffs && t.playoff_mc_interval[1] >= t.p_playoffs)) return null
    }
    if (samples !== input.simulations) return null
  }
  return input as unknown as PlayoffScenarios
}

/** Difference between published conditional frequencies, in percentage points. */
export function playoffSwing(game: GameScenario): number | null {
  if (!game.branches.home.available || !game.branches.away.available) return null
  const swings = [game.home_team_id,game.away_team_id].map(id => {
    const home = game.branches.home.teams.find(t => t.team_id === id)
    const away = game.branches.away.teams.find(t => t.team_id === id)
    return home && away ? Math.abs(home.p_playoffs-away.p_playoffs)*100 : 0
  })
  return Math.max(...swings)
}
