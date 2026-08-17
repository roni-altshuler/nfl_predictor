/**
 * Reading the game-context and matchup artifacts.
 *
 * Same contract as `artifacts.ts`: the frontend reads what the pipeline
 * published and computes nothing. Missing returns `null` and renders as
 * absent.
 */

import fs from 'node:fs'
import path from 'node:path'

const PREDICTIONS_DIR = path.join(process.cwd(), 'backend', 'data', 'predictions')

export interface Meeting {
  game_id: string
  date: string
  season: number
  week: number
  home: string
  away: string
  home_score: number
  away_score: number
  postseason: boolean
  round: string | null
  neutral: boolean
}

export interface FormGame {
  game_id: string
  date: string
  season: number
  week: number
  opponent: string
  home: boolean
  scored: number
  allowed: number
  result: 'W' | 'L' | 'T'
}

export interface TeamRecord {
  name: string
  conference: string
  division: string
  wins: number
  losses: number
  ties: number
}

export interface GameContext {
  season: number
  generated_at: string
  meetings_per_pair: number
  form_per_team: number
  records: Record<string, TeamRecord>
  meetings: Record<string, Meeting[]>
  form: Record<string, FormGame[]>
}

export interface SpreadRow {
  line: number
  home_cover: number
  push: number
  away_cover: number
}

export interface Matchup {
  home: string
  away: string
  p_home: number
  p_tie: number
  p_away: number
  exp_margin: number
  exp_total: number
  exp_home_score: number
  exp_away_score: number
  key_spreads: SpreadRow[]
}

export interface MatchupTeam {
  abbreviation: string
  name: string
  conference: string
  division: string
}

export interface ScheduledMeeting {
  game_id: string
  date: string
  week: number
}

export interface Matchups {
  season: number
  generated_at: string
  basis: string
  note: string
  teams: MatchupTeam[]
  elo: Record<string, number>
  scheduled: Record<string, ScheduledMeeting>
  matchups: Matchup[]
}

export interface RaceTeam {
  name: string
  abbreviation: string
  conference: string
  division: string
}

export interface RaceCheckpoint {
  date: string
  /** Weeks banked. Null on a live point taken before the season starts. */
  week: number | null
  games_played: number
  probabilities: Record<string, number>
}

export interface ConferenceRace {
  season: number
  /** `live` was published in advance; `backtest` is a reconstruction. */
  basis: 'live' | 'backtest'
  metric: string
  generated_at: string
  named_per_conference: number
  champion: string | null
  champion_conference?: string | null
  teams: Record<string, RaceTeam>
  checkpoints: RaceCheckpoint[]
  note: string
}

export interface SeasonRecord {
  season: number
  wins: number
  losses: number
  ties: number
  points_for: number
  points_against: number
  postseason: boolean
}

export interface TeamHistory {
  generated_at: string
  seasons: number[]
  /** League 10th/90th percentile of end-of-season Elo, per season. */
  band: Array<{ low: number; high: number } | null>
  elo: Record<string, Array<number | null>>
  records: Record<string, SeasonRecord[]>
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(PREDICTIONS_DIR, file), 'utf8'),
    ) as T
  } catch {
    return null
  }
}

export function getGameContext(): GameContext | null {
  return readJson<GameContext>('game_context.json')
}

export function getMatchups(): Matchups | null {
  return readJson<Matchups>('matchups.json')
}

export function getTeamHistory(): TeamHistory | null {
  return readJson<TeamHistory>('team_history.json')
}

/**
 * The completed season the replay covers.
 *
 * Named here rather than globbed because the frontend reads a fixed set of
 * artifacts: a directory listing at build time would make the page's content
 * depend on what happened to be on the builder's disk.
 */
export const REPLAY_SEASON = 2025

/**
 * The race to draw, and whether anyone read it in advance.
 *
 * **The live line is preferred and the replay is the fallback, never a
 * merge.** They are different claims: one was published before the games, the
 * other reconstructed after them, and averaging or concatenating them would
 * produce a single line whose left half is a backtest wearing a live label.
 * A live line needs two points to be a line at all, so before the season has
 * run twice there is nothing live to draw and the most recent replay is shown
 * — with its own `basis`, which the chart prints.
 */
export function getConferenceRace(): ConferenceRace | null {
  const live = readJson<ConferenceRace>('conference_race_current.json')
  if (live && (live.checkpoints?.length ?? 0) >= 2) return live
  return readJson<ConferenceRace>(`conference_race_${REPLAY_SEASON}.json`)
}

/** The live tracker, whatever length it is — for the "not yet a line" note. */
export function getLiveRace(): ConferenceRace | null {
  return readJson<ConferenceRace>('conference_race_current.json')
}

/**
 * Previous meetings between two franchises, most recent first.
 *
 * The key is the SORTED pair, so a lookup does not depend on which side is
 * at home — the two orderings are the same rivalry and storing them twice
 * would double the file and let them drift apart.
 */
export function meetingsBetween(a: string, b: string): Meeting[] {
  const context = getGameContext()
  if (!context) return []
  return context.meetings[[a, b].sort().join('|')] ?? []
}

export function formFor(abbreviation: string): FormGame[] {
  return getGameContext()?.form[abbreviation] ?? []
}

export function recordFor(abbreviation: string): TeamRecord | null {
  return getGameContext()?.records[abbreviation] ?? null
}

/** A win-loss-tie record as text, dropping a zero tie column. */
export function recordLine(record: TeamRecord | null): string {
  if (!record) return '—'
  const base = `${record.wins}-${record.losses}`
  return record.ties > 0 ? `${base}-${record.ties}` : base
}

/**
 * The head-to-head split from one side's perspective.
 *
 * Ties are counted and returned, not folded into either column — an NFL
 * rivalry that includes a tie has three numbers, and dropping the third
 * would make the other two disagree with the number of meetings shown.
 */
export function seriesSplit(
  meetings: Meeting[],
  team: string,
): { wins: number; losses: number; ties: number } {
  let wins = 0
  let losses = 0
  let ties = 0
  for (const meeting of meetings) {
    const scored = meeting.home === team ? meeting.home_score : meeting.away_score
    const allowed = meeting.home === team ? meeting.away_score : meeting.home_score
    if (scored === allowed) ties += 1
    else if (scored > allowed) wins += 1
    else losses += 1
  }
  return { wins, losses, ties }
}
