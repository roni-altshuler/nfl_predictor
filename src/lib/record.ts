/** Pure, serializable evidence derivation. No fitting, fetching or current-clock inference. */
export type Outcome = 'home_win' | 'tie' | 'away_win'
export interface RecordProbabilities { home: number; tie: number; away: number }
export interface RecordRow {
  gameId: string; season: number | null; week: number; home: string; away: string; date: string | null
  kickoff: string | null; scheduledKickoff: string | null; resultFetchedAt: string | null
  actualHomeScore: number | null; actualAwayScore: number | null; actualOutcome: Outcome | null
  firstPick: Outcome | null; probabilities: RecordProbabilities | null
  publishedAt: string | null; modelVersion: string | null; horizonHours: number | null
  status: 'graded' | 'unpicked' | 'ungraded' | 'pending'; reason: string | null
  eligible: boolean; correct: boolean | null
}
export interface RecordPoint {
  gameId: string; kickoff: string; date: string; week: number
  correct: number; eligible: number; accuracy: number
  recentCorrect: number; recentEligible: number; recentAccuracy: number
}
export interface RecordCounts {
  settled: number; eligible: number; correct: number; accuracy: number | null
  pending: number | null; ungraded: number; unpicked: number; actualTies: number; predictedTies: number
}
export interface BinaryCounts { eligible: number; correct: number; accuracy: number | null; tiesExcluded: number }
export interface RecordInput {
  season?: number; first: unknown; comparison: unknown; history: unknown; current: unknown
  firstHashVerified: boolean; sourceHashes?: Record<string, string | null>
}
export interface SeasonRecord {
  season: number | null; availability: 'available' | 'unavailable'; availabilityReason: string | null
  rows: RecordRow[]; timeline: RecordPoint[]; weeks: number[]
  counts: RecordCounts | null; binary: BinaryCounts | null
  meta: {
    firstUpdatedAt: string | null; resultsUpdatedAt: string | null; currentUpdatedAt: string | null
    resultKickoffThrough: string | null; publicationStart: string | null; publicationEnd: string | null
    firstModelVersions: string[]; horizonMinHours: number | null; horizonMaxHours: number | null
    firstHashVerified: boolean; currentAvailable: boolean; sourceHashes: Record<string, string | null>
  }
  warnings: string[]
}
type Json = Record<string, unknown>
const object = (value: unknown): Json | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : null
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)
const week = (value: unknown): value is number => integer(value) && value >= 1 && value <= 18
function day(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}
function instant(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !day(value.slice(0, 10))) return null
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}
const iso = (value: unknown): string | null => instant(value) === null ? null : value as string
const percent = (correct: number, n: number) => n ? correct / n * 100 : null
function probabilities(row: Json | null): RecordProbabilities | null {
  if (!row) return null
  const values = [row.p_home, row.p_tie, row.p_away]
  if (!values.every(p => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1)) return null
  const [home, tie, away] = values as number[]
  return Math.abs(home + tie + away - 1) <= 0.00001 + Number.EPSILON * 4 ? { home, tie, away } : null
}
function pick(p: RecordProbabilities | null): Outcome | null {
  if (!p) return null
  const entries: [Outcome, number][] = [['home_win', p.home], ['tie', p.tie], ['away_win', p.away]]
  const winners = entries.filter(([, value]) => value === Math.max(p.home, p.tie, p.away))
  return winners.length === 1 ? winners[0][0] : null
}
function index(rows: unknown[]): Map<string, Json[]> {
  const result = new Map<string, Json[]>()
  for (const value of rows) { const row = object(value); if (row && text(row.game_id)) result.set(row.game_id, [...(result.get(row.game_id) ?? []), row]) }
  return result
}
const one = (rows: Json[] | undefined): Json | null => rows?.length === 1 ? rows[0] : null
function resultShape(value: unknown): boolean {
  const row = object(value)
  return !!row && text(row.game_id) && text(row.home) && text(row.away) && row.home !== row.away &&
    integer(row.week) && row.week >= 1 && typeof row.postseason === 'boolean' && (row.postseason || week(row.week)) &&
    day(row.date) && integer(row.home_score) && integer(row.away_score) && row.home_score >= 0 && row.away_score >= 0
}
function fixtureShape(value: unknown, season: number | null): boolean {
  const row = object(value)
  return !!row && text(row.game_id) && text(row.home) && text(row.away) && row.home !== row.away && week(row.week) &&
    (row.season === undefined || row.season === season) && (row.postseason === undefined || row.postseason === false) && instant(row.date_utc) !== null
}
function evidenceReason(first: Json | null, result: Json, source: Json | null, season: number | null): string | null {
  if (!first) return 'No unique retained first forecast'
  if (!source) return 'No unique comparison evidence'
  if (first.season !== season || !week(first.week) || !text(first.model_version)) return 'First forecast season, week or model is invalid'
  for (const key of ['game_id', 'week', 'home', 'away', 'home_score', 'away_score']) {
    if (first[key] !== result[key] || result[key] !== source[key]) return 'First forecast, result and source identity/scores disagree'
  }
  if (!probabilities(first)) return 'Invalid first probability triple'
  const published = instant(first.generated_at), scheduled = instant(first.kickoff_utc), actual = instant(source.actual_kickoff_utc), fetched = instant(source.fetched_at)
  if (published === null || scheduled === null || actual === null || !(published < scheduled && published < actual)) return 'Strict pre-event timestamps are unverified'
  if (new Date(actual).toISOString().slice(0, 10) !== result.date || source.source !== 'espn' || fetched === null || fetched <= actual) return 'Result source, date or fetch chronology is unverified'
  const original = object(source.first)
  if (!original || !['generated_at', 'model_version', 'p_home', 'p_tie', 'p_away'].every(key => original[key] === first[key]) || original.scheduled_kickoff_utc !== first.kickoff_utc) return 'Comparison does not preserve the exact first forecast'
  if (first.trained_through !== undefined && (instant(first.trained_through) === null || instant(first.trained_through)! > published)) return 'Training cutoff is later than publication or unverified'
  return null
}

export function buildSeasonRecord(input: RecordInput): SeasonRecord {
  const first = object(input.first), comparison = object(input.comparison), history = object(input.history), current = object(input.current)
  const candidateSeason = input.season ?? current?.season ?? first?.season
  const season = integer(candidateSeason) ? candidateSeason : null
  const historyAvailable = season !== null && history?.season === season && Array.isArray(history.games) && history.games.every(resultShape) &&
    integer(history.regular_season_games) && history.regular_season_games >= 0 && integer(history.postseason_games) && history.postseason_games >= 0 &&
    history.regular_season_games === history.games.filter(value => object(value)?.postseason === false).length &&
    history.postseason_games === history.games.filter(value => object(value)?.postseason === true).length
  const firstAvailable = first?.season === season && first?.basis === 'published' && Array.isArray(first.games)
  const comparisonAvailable = comparison?.season === season && Array.isArray(comparison.games)
  const currentRows = Array.isArray(current?.games) ? current.games.filter(row => object(row)?.postseason !== true) : []
  const currentAvailable = season !== null && current?.season === season && Array.isArray(current.games) && currentRows.every(row => fixtureShape(row, season)) && index(currentRows).size === currentRows.length
  const firsts = index(firstAvailable ? first!.games as unknown[] : [])
  const sources = index(comparisonAvailable ? comparison!.games as unknown[] : [])
  const outcomes = index(historyAvailable ? (history!.games as unknown[]).filter(value => object(value)?.postseason === false) : [])
  const postseason = historyAvailable ? (history!.games as unknown[]).filter(value => object(value)?.postseason === true) : []
  const postseasonIds = new Set(postseason.map(value => object(value)!.game_id as string))
  for (const value of postseason) { const row = object(value)!; if (outcomes.has(row.game_id as string)) outcomes.get(row.game_id as string)!.push(row) }
  const fixtures = index(currentAvailable ? currentRows : [])
  const ids = new Set([...outcomes.keys(), ...fixtures.keys(), ...[...firsts].filter(([, rows]) => input.firstHashVerified && rows.some(row => row.season === season && week(row.week) && text(row.home) && text(row.away))).map(([id]) => id)].filter(id => !postseasonIds.has(id) || outcomes.has(id)))
  const rows: RecordRow[] = []
  let binaryCorrect = 0, binaryEligible = 0, binaryTies = 0
  const audited: RecordRow[] = []
  for (const gameId of ids) {
    const resultRows = outcomes.get(gameId), result = resultRows?.[0], fixture = one(fixtures.get(gameId)), forecast = one(firsts.get(gameId)), source = one(sources.get(gameId))
    const identity = result ?? fixture ?? firsts.get(gameId)!.find(row => row.season === season && week(row.week) && text(row.home) && text(row.away))!
    const p = probabilities(forecast), scheduled = iso(fixture?.date_utc ?? (input.firstHashVerified ? forecast?.kickoff_utc : null))
    const actual = resultRows?.length === 1 && source && ['game_id', 'week', 'home', 'away', 'home_score', 'away_score'].every(key => source[key] === result![key]) && source.source === 'espn' && iso(source.actual_kickoff_utc) && instant(source.fetched_at) !== null && instant(source.fetched_at)! > instant(source.actual_kickoff_utc)! && new Date(instant(source.actual_kickoff_utc)!).toISOString().slice(0, 10) === result!.date ? source.actual_kickoff_utc as string : null
    const outcome: Outcome | null = resultRows?.length === 1 ? result!.home_score === result!.away_score ? 'tie' : Number(result!.home_score) > Number(result!.away_score) ? 'home_win' : 'away_win' : null
    const row: RecordRow = { gameId, season, week: Number(identity.week), home: String(identity.home), away: String(identity.away), date: result ? result.date as string : scheduled ? new Date(instant(scheduled)!).toISOString().slice(0, 10) : null,
      kickoff: actual, scheduledKickoff: scheduled, resultFetchedAt: actual ? iso(source!.fetched_at) : null, actualHomeScore: outcome ? result!.home_score as number : null, actualAwayScore: outcome ? result!.away_score as number : null, actualOutcome: outcome,
      firstPick: null, probabilities: null, publishedAt: null, modelVersion: null, horizonHours: null,
      status: 'ungraded', reason: null, eligible: false, correct: null }
    if (!historyAvailable) row.reason = 'Recorded outcome source unavailable; no settlement status inferred'
    else if (!result) {
      row.status = 'pending'; row.reason = 'No recorded outcome; first-publication eligibility cannot yet be graded'
    } else {
      row.reason = resultRows!.length !== 1 ? 'Duplicate result ID; outcome ambiguous' : !firstAvailable ? 'Published first forecast source unavailable' : !input.firstHashVerified ? 'Exact first-log SHA256 binding failed' : !comparisonAvailable ? 'Comparison source unavailable or wrong season' : evidenceReason(forecast, result, source, season)
      if (row.reason === null) {
        row.probabilities = p; row.firstPick = pick(p); row.publishedAt = iso(forecast!.generated_at); row.modelVersion = forecast!.model_version as string
        row.scheduledKickoff = iso(forecast!.kickoff_utc)
        row.horizonHours = (instant(actual)! - instant(forecast!.generated_at)!) / 3600000
        audited.push(row)
        if (outcome === 'tie') binaryTies++
        else if (p!.home + p!.away > 0) { binaryEligible++; binaryCorrect += Number((p!.home >= p!.away) === (outcome === 'home_win')) }
        if (row.firstPick === null) { row.status = 'unpicked'; row.reason = 'Nonunique maximum: no unique H/T/A pick' }
        else { row.status = 'graded'; row.eligible = true; row.correct = row.firstPick === outcome }
      }
    }
    rows.push(row)
  }
  rows.sort((a, b) => (instant(a.kickoff) ?? Number.POSITIVE_INFINITY) - (instant(b.kickoff) ?? Number.POSITIVE_INFINITY) || (a.date ?? '').localeCompare(b.date ?? '') || a.gameId.localeCompare(b.gameId))
  const graded = rows.filter(row => row.eligible)
  let correct = 0
  const timeline = graded.map((row, index): RecordPoint => {
    correct += Number(row.correct)
    const recent = graded.slice(Math.max(0, index - 15), index + 1), recentCorrect = recent.filter(value => value.correct).length
    return { gameId: row.gameId, kickoff: row.kickoff!, date: row.date!, week: row.week, correct, eligible: index + 1, accuracy: correct / (index + 1) * 100, recentCorrect, recentEligible: recent.length, recentAccuracy: recentCorrect / recent.length * 100 }
  })
  const publications = audited.map(row => row.publishedAt!).sort((a, b) => instant(a)! - instant(b)!), horizons = audited.map(row => row.horizonHours!)
  const knownKickoffs = rows.map(row => row.kickoff).filter((value): value is string => value !== null).sort((a, b) => instant(a)! - instant(b)!)
  const warnings = [
    'Descriptive first-publication H/T/A record, not a market comparison or a guarantee. Historical backtest probabilities and latest forecasts are never substituted.',
    'Result finality follows the existing ESPN completed/final ingestion contract; stored scores and timestamps were not independently recollected live.',
    'Legacy training cutoffs and independent publication attestations are not established. Retained timestamps do not prove exact-run public publication.',
    'Calendar chronology uses actual kickoff, then game ID for simultaneous games; no observed settlement times are inferred.',
    'Canonical first JSON lacks home/away score estimates. No exact-score errors are computed; warehouse margin/total derivation has not been audited.',
    'Pending means no retained recorded outcome, not guaranteed unplayed. Current snapshots never fill a missing original forecast.',
  ]
  if (!currentAvailable) warnings.push('Current fixture source unavailable; remaining fixture coverage and pending total are unknown.')
  if (!input.firstHashVerified) warnings.push('The exact first-log byte binding is unavailable or mismatched; settled forecasts remain ungraded.')
  return { season, availability: historyAvailable ? 'available' : 'unavailable', availabilityReason: historyAvailable ? null : 'Recorded history is missing, malformed, has inconsistent stage counts or belongs to another season', rows, timeline: historyAvailable ? timeline : [], weeks: [...new Set(rows.map(row => row.week).filter(week))].sort((a, b) => a - b),
    counts: historyAvailable ? { settled: outcomes.size, eligible: graded.length, correct, accuracy: percent(correct, graded.length), pending: currentAvailable ? rows.filter(row => row.status === 'pending').length : null, ungraded: rows.filter(row => outcomes.has(row.gameId) && row.status === 'ungraded').length, unpicked: rows.filter(row => row.status === 'unpicked').length, actualTies: rows.filter(row => row.actualOutcome === 'tie').length, predictedTies: graded.filter(row => row.firstPick === 'tie').length } : null,
    binary: historyAvailable ? { eligible: binaryEligible, correct: binaryCorrect, accuracy: percent(binaryCorrect, binaryEligible), tiesExcluded: binaryTies } : null,
    meta: { firstUpdatedAt: iso(first?.generated_at), resultsUpdatedAt: historyAvailable ? iso(history?.generated_at) : null, currentUpdatedAt: currentAvailable ? iso(current?.generated_at) : null, resultKickoffThrough: knownKickoffs.at(-1) ?? null, publicationStart: publications[0] ?? null, publicationEnd: publications.at(-1) ?? null, firstModelVersions: [...new Set(audited.map(row => row.modelVersion!))].sort(), horizonMinHours: horizons.length ? Math.min(...horizons) : null, horizonMaxHours: horizons.length ? Math.max(...horizons) : null, firstHashVerified: input.firstHashVerified, currentAvailable, sourceHashes: input.sourceHashes ?? {} }, warnings }
}
