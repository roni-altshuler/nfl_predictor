import type { PlayoffScenarios } from './playoffScenarios'
import type { GameForecast, GameForecasts, TeamProjection } from './artifacts'

export interface LabData {
  forecast: GameForecasts | null
  teams: TeamProjection[]
  withheld: number
  unavailable: boolean
  asOf: string
  scenarios: PlayoffScenarios | null
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const probability = (v: unknown): v is number => number(v) && v >= 0 && v <= 1
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const date = (v: unknown): v is string => text(v) && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))
const triple = (a: unknown, b: unknown, c: unknown) => probability(a) && probability(b) && probability(c) && Math.abs(a+b+c-1) < 0.0001

export function validGame(v: unknown): v is GameForecast {
  if (!object(v) || !text(v.game_id) || !/^\d+$/.test(v.game_id) || !date(v.date_utc) || !Number.isInteger(v.week) || Number(v.week) < 1 || !Number.isInteger(v.season)) return false
  if (!['home','away'].every(k => text(v[k]) && /^[A-Z]{2,4}$/.test(String(v[k]))) || v.home === v.away || !text(v.home_name) || !text(v.away_name)) return false
  if (!triple(v.p_home,v.p_tie,v.p_away) || !['exp_margin','exp_total','exp_home_score','exp_away_score','margin_sd','total_sd'].every(k => number(v[k]))) return false
  if (Number(v.margin_sd) <= 0 || Number(v.total_sd) <= 0 || Number(v.exp_total) < 0 || Number(v.exp_home_score) < 0 || Number(v.exp_away_score) < 0) return false
  const d = v.margin_distribution
  if (!object(d) || !Number.isInteger(d.low) || !Number.isInteger(d.high) || Number(d.low)>0 || Number(d.high)<0 || !Array.isArray(d.p) || d.p.length !== Number(d.high)-Number(d.low)+1 || !d.p.every(probability) || !probability(d.outside)) return false
  if (Math.abs(d.p.reduce((a:number,b:number)=>a+b,0)+d.outside-1) > .001) return false
  if (!Array.isArray(v.spread_surface) || !v.spread_surface.every(r => object(r) && number(r.line) && triple(r.home_cover,r.push,r.away_cover))) return false
  if (!object(v.market) || !['ml_home','ml_away','spread_home','total_points'].every(k => v.market && object(v.market) && (v.market[k] === null || number(v.market[k])))) return false
  return typeof v.neutral_site === 'boolean' && (v.venue === null || text(v.venue))
}

export function parseForecast(input: unknown): { forecast: GameForecasts | null; withheld: number } {
  if (!object(input) || !date(input.generated_at) || !text(input.model_version) || !Number.isInteger(input.season) || !Array.isArray(input.games)) return {forecast:null,withheld:0}
  const seen = new Set<string>()
  const games = input.games.filter((g): g is GameForecast => {
    if (!validGame(g) || g.season !== input.season || seen.has(g.game_id)) return false
    seen.add(g.game_id); return true
  }).sort((a,b)=>Date.parse(a.date_utc)-Date.parse(b.date_utc))
  return {forecast:{season:Number(input.season),generated_at:input.generated_at,model_version:input.model_version,
    trained_through:date(input.trained_through)?input.trained_through:null,
    training_games:number(input.training_games)?input.training_games:undefined,
    season_start:typeof input.season_start === 'string' ? input.season_start : null,
    weeks_in_season:Number(input.weeks_in_season)||18,games},withheld:input.games.length-games.length}
}

export function validTeams(input: unknown): TeamProjection[] {
  if (!object(input) || !Array.isArray(input.teams)) return []
  return input.teams.filter((t): t is TeamProjection => object(t) && text(t.abbreviation) &&
    ['current_wins','current_losses','current_ties'].every(k=>number(t[k]) && Number.isInteger(t[k]) && Number(t[k])>=0) &&
    probability(t.p_playoffs) && probability(t.p_championship))
}

export function recordAfter(team: Pick<TeamProjection,'current_wins'|'current_losses'|'current_ties'>, outcome: 'win'|'loss'|'tie') {
  return [team.current_wins + Number(outcome==='win'), team.current_losses + Number(outcome==='loss'), team.current_ties + Number(outcome==='tie')].join('–')
}
