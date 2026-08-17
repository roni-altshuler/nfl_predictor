/**
 * Reading the season archive.
 *
 * Same contract as `artifacts.ts` and `history.ts`: the frontend reads what
 * the pipeline published and computes nothing. Missing returns `null` and
 * renders as absent.
 *
 * **A seed can legitimately be `null` and must render as `—`, never as a
 * number.** `build_history` reconstructs seeds from final standings and then
 * checks that reconstruction against the postseason that was actually played;
 * where the two disagree it withholds the seeds for that conference. Eight of
 * forty-eight conference-seasons in this corpus need the league's
 * common-games tiebreaker, which this project does not model, so they carry
 * no seed numbers at all.
 */

import fs from 'node:fs'
import path from 'node:path'

const HISTORY_DIR = path.join(process.cwd(), 'backend', 'data', 'history')

export interface SeasonIndexEntry {
  season: number
  regular_season_games: number
  postseason_games: number
  champion: string | null
  runner_up: string | null
  best_record: {
    abbreviation: string
    name: string
    wins: number
    losses: number
    ties: number
  } | null
  seeds_verified: boolean
}

export interface SeasonsIndex {
  generated_at: string
  seasons: SeasonIndexEntry[]
  note: string
}

export interface StandingsRow {
  team_id: number
  name: string
  abbreviation: string
  conference: string
  division: string
  wins: number
  losses: number
  ties: number
  points_for: number
  points_against: number
  point_diff: number
  home_wins: number
  home_losses: number
  away_wins: number
  away_losses: number
  seed: number | null
}

export interface BracketGame {
  game_id: string
  date: string
  home: string | null
  away: string | null
  home_name: string | null
  away_name: string | null
  home_seed: number | null
  away_seed: number | null
  home_score: number
  away_score: number
  winner: string | null
  conference: string | null
  neutral: boolean
}

export interface Bracket {
  seeds_per_conference: number
  byes_per_conference: number
  byes: Record<string, number[]>
  rounds: Record<string, BracketGame[]>
}

export interface ArchivedGame {
  game_id: string
  date: string
  week: number
  postseason: boolean
  round: string | null
  home: string
  away: string
  home_score: number
  away_score: number
  neutral: boolean
  /** The walk-forward retrodiction. Null through the warm-up seasons. */
  p_home: number | null
  exp_margin: number | null
  p_market: number | null
}

export interface ArchivedSeason {
  season: number
  generated_at: string
  regular_season_games: number
  postseason_games: number
  champion: string | null
  runner_up: string | null
  seeds_verified: Record<string, boolean>
  standings: StandingsRow[]
  bracket: Bracket
  games: ArchivedGame[]
  forecast_basis: 'backtest' | null
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, file), 'utf8')) as T
  } catch {
    return null
  }
}

export function getSeasonsIndex(): SeasonsIndex | null {
  return readJson<SeasonsIndex>('seasons.json')
}

export function getArchivedSeason(season: number): ArchivedSeason | null {
  return readJson<ArchivedSeason>(`season_${season}.json`)
}

/** Standings grouped conference → division, in seed-agnostic record order. */
export function byDivision(
  rows: StandingsRow[],
): { conference: string; division: string; teams: StandingsRow[] }[] {
  const groups = new Map<string, StandingsRow[]>()
  for (const row of rows) {
    const key = `${row.conference}||${row.division}`
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }
  return [...groups.entries()]
    .map(([key, teams]) => {
      const [conference, division] = key.split('||')
      return {
        conference,
        division,
        teams: [...teams].sort(
          (a, b) =>
            b.wins + 0.5 * b.ties - (a.wins + 0.5 * a.ties) ||
            b.point_diff - a.point_diff,
        ),
      }
    })
    .sort((a, b) =>
      a.conference === b.conference
        ? a.division.localeCompare(b.division)
        : a.conference.localeCompare(b.conference),
    )
}

/** A win-loss-tie record, dropping a zero tie column. */
export function recordText(wins: number, losses: number, ties: number): string {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`
}
