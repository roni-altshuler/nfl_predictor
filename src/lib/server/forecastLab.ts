import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { parseScenarios } from '../playoffScenarios'
import path from 'node:path'
import { parseForecast, validTeams, type LabData } from '../forecastLab'

function read(name: string): unknown {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(),'backend/data/predictions',name),'utf8')) }
  catch { return null }
}
export function getLabData(): LabData {
  const {forecast,withheld} = parseForecast(read('game_forecasts.json'))
  const projection = read('season_projections.json') as {season?:number;generated_at?:string} | null
  // Mixing a new slate with older standings would fabricate the scenario baseline.
  const teams = projection?.season === forecast?.season && projection?.generated_at === forecast?.generated_at ? validTeams(projection) : []
  let scenarios = parseScenarios(read('playoff_scenarios.json'),forecast)
  if (scenarios) {
    try {
      const raw = fs.readFileSync(path.join(process.cwd(),'backend/data/predictions/game_forecasts.json'))
      if (createHash('sha256').update(raw).digest('hex') !== scenarios.forecast_sha256) scenarios=null
    } catch { scenarios=null }
  }
  return {forecast,withheld,teams,scenarios,unavailable:forecast===null,asOf:new Date().toISOString()}
}
