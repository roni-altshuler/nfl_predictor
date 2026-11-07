const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const ts = require('typescript')
const Module = require('node:module')
function compile(relative, requireOverride) {
  const file = path.resolve(__dirname, '..', relative), loaded = new Module(file, module)
  loaded.filename = file; loaded.paths = module.paths
  if (requireOverride) loaded.require = name => requireOverride(name) ?? require(name)
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file)
  return loaded.exports
}
const pure = compile('src/lib/record.ts'), { buildSeasonRecord } = pure
const { loadSeasonRecord } = compile('src/lib/server/record.ts', name => name === '../record' ? pure : undefined)
const clone = value => JSON.parse(JSON.stringify(value))
function fixture() {
  const first = { game_id: 'a', season: 2026, week: 1, home: 'H', away: 'A', home_score: 10, away_score: 7, generated_at: '2026-08-16T15:19:07Z', kickoff_utc: '2026-09-10T00:20:00Z', model_version: 'v1', p_home: .6, p_tie: .1, p_away: .3 }
  const result = { game_id: 'a', week: 1, home: 'H', away: 'A', home_score: 10, away_score: 7, date: '2026-09-10', postseason: false, p_home: .01 }
  const source = { ...result, actual_kickoff_utc: first.kickoff_utc, source: 'espn', fetched_at: '2026-09-11T01:00:00Z', first: { ...first, scheduled_kickoff_utc: first.kickoff_utc }, latest: { p_home: .01, p_tie: .01, p_away: .98 } }
  return { season: 2026, firstHashVerified: true, first: { season: 2026, basis: 'published', generated_at: '2026-10-30T00:00:00Z', n: 999, accuracy: .01, games: [first] }, comparison: { season: 2026, games: [source] }, history: { season: 2026, regular_season_games: 1, postseason_games: 0, generated_at: '2026-10-30T00:00:00Z', forecast_basis: 'backtest', games: [result] }, current: { season: 2026, generated_at: '2026-10-30T00:00:00Z', games: [{ game_id: 'pending', season: 2026, week: 2, home: 'H', away: 'A', date_utc: '2026-09-20T00:00:00Z', p_home: .99, p_tie: 0, p_away: .01 }] } }
}
let input = fixture(), record = buildSeasonRecord(input)
const unchanged = JSON.stringify(input); buildSeasonRecord(input); assert.equal(JSON.stringify(input), unchanged, 'Pure derivation must not mutate inputs')
assert.deepEqual([record.counts.correct, record.counts.eligible, record.counts.pending, record.counts.accuracy], [1, 1, 1, 100])
assert.equal(record.rows.find(r => r.gameId === 'pending').firstPick, null, 'Current triples must never substitute for original calls')
assert.equal(record.rows.find(r => r.gameId === 'a').firstPick, 'home_win', 'Latest/archive triples must never substitute')
assert.equal(record.rows.find(r => r.gameId === 'a').resultFetchedAt,input.comparison.games[0].fetched_at)
assert.deepEqual(JSON.parse(JSON.stringify(record)), record, 'Return values must be serializable without NaN/undefined')
function ungraded(change, reason) {
  const data = fixture(); change(data); const value = buildSeasonRecord(data)
  assert.equal(value.counts.eligible, 0, reason); assert.equal(value.counts.correct, 0, reason); assert.equal(value.counts.accuracy, null, reason)
  assert.equal(value.counts.ungraded, 1, reason); assert.equal(value.rows.find(r => r.gameId === 'a').status, 'ungraded', reason)
  const row = value.rows.find(r => r.gameId === 'a')
  for (const key of ['firstPick','probabilities','publishedAt','modelVersion','horizonHours']) assert.equal(row[key],null,'Unauthenticated saved prediction must not be displayed: '+key)
}
for (const timestamp of ['invalid', '2026-08-16', '2026-08-16T00:00:00', '0000-08-16T00:00:00Z', '2026-02-30T00:00:00Z', '2026-09-10T00:20:00Z', '2026-09-11T00:00:00Z']) {
  ungraded(d => { d.first.games[0].generated_at = timestamp; d.comparison.games[0].first.generated_at = timestamp }, 'Invalid or non-strict pre-event cutoff: ' + timestamp)
}
ungraded(d => { d.firstHashVerified = false }, 'Byte SHA mismatch')
ungraded(d => { d.first.basis = 'backtest' }, 'Backtest first source')
ungraded(d => { d.first.games = [] }, 'Missing first cannot borrow latest/current')
ungraded(d => { d.first.games.push(clone(d.first.games[0])) }, 'Duplicate first ID')
ungraded(d => { d.history.games.push(clone(d.history.games[0])); d.history.regular_season_games++ }, 'Duplicate result ID')
ungraded(d => { d.comparison.games.push(clone(d.comparison.games[0])) }, 'Duplicate source ID')
ungraded(d => { d.comparison.season = 2025 }, 'Wrong comparison season')
ungraded(d => { d.first.season = 2025 }, 'Wrong first season')
for (const [field, value] of [['season', 2025], ['week', 2], ['home', 'X'], ['away', 'X'], ['home_score', 11], ['away_score', 9]]) ungraded(d => { d.first.games[0][field] = value }, 'First identity ' + field)
for (const [field, value] of [['week', 2], ['home', 'X'], ['away', 'X'], ['home_score', 11], ['source', 'other'], ['actual_kickoff_utc', 'unknown'], ['fetched_at', '2026-09-10T00:20:00Z'], ['actual_kickoff_utc', '2026-09-11T00:20:00Z']]) ungraded(d => { d.comparison.games[0][field] = value }, 'Source identity/cutoff ' + field)
for (const field of ['generated_at', 'model_version', 'p_home', 'p_tie', 'p_away', 'scheduled_kickoff_utc']) ungraded(d => { d.comparison.games[0].first[field] = 'different' }, 'Exact original field ' + field)
for (const value of [NaN, Infinity, -1, 2, '0.6']) ungraded(d => { d.first.games[0].p_home = value }, 'Invalid probability')
ungraded(d => { d.first.games[0].trained_through = '2026-09-11T00:00:00Z' }, 'Future training cutoff')
ungraded(d => { d.first.games[0].kickoff_utc = '2026-08-16T15:19:07Z'; d.comparison.games[0].first.scheduled_kickoff_utc = d.first.games[0].kickoff_utc }, 'Strict scheduled cutoff')
function tripleAndScores(data, values, home, away) {
  for (const obj of [data.first.games[0], data.comparison.games[0].first]) Object.assign(obj, { p_home: values[0], p_tie: values[1], p_away: values[2] })
  for (const obj of [data.first.games[0], data.comparison.games[0], data.history.games[0]]) Object.assign(obj, { home_score: home, away_score: away })
}
input = fixture(); tripleAndScores(input, [.2, .7, .1], 7, 7); record = buildSeasonRecord(input)
assert.deepEqual([record.counts.correct, record.counts.eligible, record.counts.actualTies, record.counts.predictedTies], [1, 1, 1, 1]); assert.deepEqual(record.binary, { eligible: 0, correct: 0, accuracy: null, tiesExcluded: 1 })
input = fixture(); tripleAndScores(input, [.45, .1, .45], 10, 7); record = buildSeasonRecord(input)
assert.equal(record.counts.unpicked, 1); assert.equal(record.counts.eligible, 0); assert.equal(record.rows[0].status, 'unpicked'); assert.deepEqual(record.binary, { eligible: 1, correct: 1, accuracy: 100, tiesExcluded: 0 })
assert.deepEqual(record.rows[0].probabilities,{home:.45,tie:.1,away:.45}); assert.equal(record.rows[0].publishedAt,input.first.games[0].generated_at); assert.equal(record.rows[0].modelVersion,'v1'); assert.ok(record.rows[0].horizonHours>0)
tripleAndScores(input, [.45, .1, .45], 7, 7); record = buildSeasonRecord(input); assert.equal(record.binary.tiesExcluded, 1); assert.equal(record.binary.eligible, 0)
input = fixture(); tripleAndScores(input, [.1, .1, .8], 3, 10); assert.equal(buildSeasonRecord(input).counts.correct, 1)
input = fixture(); input.comparison.games[0].actual_kickoff_utc = '2026-09-10T02:20:00+02:00'; assert.equal(buildSeasonRecord(input).counts.eligible, 1, 'Explicit offsets use the actual UTC calendar day')
input.comparison.games[0].actual_kickoff_utc = '2026-09-10T00:20:00+02:00'; assert.equal(buildSeasonRecord(input).counts.eligible, 0, 'UTC date mismatch must not be hidden by slicing the raw local timestamp')
for (const history of [null, 'invalid JSON', {}, { season: 2025, games: [] }, { season: 2026, games: {} }, { season: 2026, games: [null] }, { season: 2026, games: [{ ...fixture().history.games[0], postseason: undefined }] }]) {
  const data = fixture(); data.history = history; const value = buildSeasonRecord(data)
  assert.equal(value.availability, 'unavailable'); assert.equal(value.counts, null); assert.equal(value.binary, null); assert.deepEqual(value.timeline, []); assert.ok(value.rows.every(row => row.status === 'ungraded'))
}
for (const change of [
  h => { delete h.regular_season_games }, h => { delete h.postseason_games },
  h => { h.regular_season_games = 108; h.games = [] },
  h => { h.regular_season_games = 2 }, h => { h.regular_season_games = 0 },
  h => { h.postseason_games = 1 }, h => { h.regular_season_games = -1 },
  h => { h.regular_season_games = 1.5 }, h => { h.regular_season_games = '1' },
  h => { h.postseason_games = -1 }, h => { h.postseason_games = .5 }, h => { h.postseason_games = '0' },
]) {
  const data = fixture(); change(data.history); const value = buildSeasonRecord(data)
  assert.equal(value.availability,'unavailable','Missing, invalid or inconsistent declared stage counts must withhold coverage')
  assert.equal(value.counts,null); assert.equal(value.binary,null); assert.deepEqual(value.timeline,[])
  assert.ok(value.rows.every(row=>row.status==='ungraded' && row.firstPick===null && row.probabilities===null),'Dropped outcomes must not become apparent pending first calls')
}
input = fixture(); input.history.games = []; input.history.regular_season_games = 0; record = buildSeasonRecord(input); assert.equal(record.availability, 'available'); assert.equal(record.counts.accuracy, null); assert.equal(record.counts.eligible, 0)
input = fixture(); input.current = null; assert.equal(buildSeasonRecord(input).counts.pending, null)
input = fixture(); input.current.games.push(clone(input.current.games[0])); assert.equal(buildSeasonRecord(input).counts.pending, null)
input = fixture(); input.history.games.push({ ...input.history.games[0], game_id: 'playoff', postseason: true, week: 23 }); input.history.postseason_games = 1; assert.equal(buildSeasonRecord(input).counts.settled, 1)
input = fixture(); input.history.games.push({ ...input.history.games[0], game_id: 'playoff', postseason: true }); input.history.postseason_games = 1; input.first.games.push({ ...input.first.games[0], game_id: 'playoff' }); record = buildSeasonRecord(input); assert.equal(record.rows.some(row => row.gameId === 'playoff'), false, 'A known playoff Week1 must not reenter as a pending regular first call')
input = fixture(); input.history.games.push({ ...input.history.games[0], postseason: true }); input.history.postseason_games = 1; record = buildSeasonRecord(input); assert.equal(record.counts.eligible, 0); assert.equal(record.counts.ungraded, 1)
assert.equal(record.rows[0].actualHomeScore,null); assert.equal(record.rows[0].actualAwayScore,null); assert.equal(record.rows[0].actualOutcome,null)
input = fixture(); input.first.games.push({ ...input.first.games[0], game_id: 'only-first' }, { ...input.first.games[0], game_id: 'only-first' }); assert.doesNotThrow(() => buildSeasonRecord(input), 'Duplicate first-only evidence must not crash')
input.firstHashVerified=false; assert.equal(buildSeasonRecord(input).rows.some(row=>row.gameId==='only-first'),false,'Unbound first-only IDs must not introduce phantom schedule rows')
// Unequal/partial weeks and simultaneous kickoff ordering: weight games, never average week percentages.
input = fixture(); input.first.games = []; input.comparison.games = []; input.history.games = []; input.current.games = []
for (let n = 0; n < 19; n++) {
  const copy = fixture(), id = String(n).padStart(2, '0'), winning = n < 10, date = n < 10 ? '2026-09-10' : '2026-09-17', w = n < 10 ? 1 : 2
  for (const obj of [copy.first.games[0], copy.comparison.games[0], copy.history.games[0]]) Object.assign(obj, { game_id: id, week: w, date, home_score: winning ? 10 : 0 })
  copy.first.games[0].kickoff_utc = date + 'T12:00:00Z'; copy.comparison.games[0].actual_kickoff_utc = date + 'T12:00:00Z'; copy.comparison.games[0].fetched_at = '2026-09-18T00:00:00Z'; copy.comparison.games[0].first = { ...copy.first.games[0], scheduled_kickoff_utc: copy.first.games[0].kickoff_utc }
  input.first.games.unshift(copy.first.games[0]); input.comparison.games.unshift(copy.comparison.games[0]); input.history.games.unshift(copy.history.games[0])
}
input.history.regular_season_games = input.history.games.length
record = buildSeasonRecord(input); assert.deepEqual(record.timeline.map(p => p.gameId), Array.from({ length: 19 }, (_, n) => String(n).padStart(2, '0')))
assert.equal(record.counts.accuracy, 10 / 19 * 100); assert.notEqual(record.counts.accuracy, 50); assert.equal(record.timeline.at(-1).recentEligible, 16); assert.equal(record.timeline.at(-1).recentCorrect, 7)
assert.equal(record.timeline[0].recentEligible, 1); assert.equal(record.timeline.at(-1).accuracy, record.counts.accuracy)
// Actual source reconciliation uses independent row calculations, never warehouse aggregate totals.
const real = loadSeasonRecord(), dataDir = path.resolve('backend/data')
const json = relative => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, relative))) } catch { return null } }
const f = json('predictions/forecast_log.json'), h = json(`history/season_${real.season}.json`), comparison = json('predictions/forecast_comparison.json')
if (h?.games?.length && real.availability === 'available') {
  for (const games of [[], h.games.slice(1)]) {
    const truncated = buildSeasonRecord({first:f,history:{...h,games},comparison,current:json('predictions/game_forecasts.json'),firstHashVerified:true,season:real.season})
    assert.equal(truncated.availability,'unavailable','Real retained stage count must detect cleared/truncated outcome rows')
    assert.equal(truncated.counts,null); assert.equal(truncated.binary,null); assert.deepEqual(truncated.timeline,[])
  }
}
const unique = (rows, id) => { const matches = rows?.filter(row => row?.game_id === id) ?? []; return matches.length === 1 ? matches[0] : null }
let expectedCorrect = 0, expectedN = 0, expectedBinaryCorrect = 0, expectedBinaryN = 0
const actualRows = real.availability === 'available' ? h.games.filter(g => g.postseason === false) : []
for (const g of actualRows) {
  const first = unique(f?.games, g.game_id), source = unique(comparison?.games, g.game_id)
  if (!first || !source || !source.first || !real.meta.firstHashVerified || f.basis !== 'published' || f.season !== real.season || comparison.season !== real.season || !unique(h.games, g.game_id)) continue
  const values = [first.p_home, first.p_tie, first.p_away], actual = g.home_score > g.away_score ? 0 : g.home_score < g.away_score ? 2 : 1
  if (!values.every(p => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1) || Math.abs(values.reduce((a,b) => a+b,0)-1) > .000010000000001) continue
  if (!['game_id','week','home','away','home_score','away_score'].every(k => first[k] === g[k] && source[k] === g[k]) || first.season !== real.season || !first.model_version || !Number.isInteger(first.week) || first.week < 1 || first.week > 18) continue
  const parse = value => typeof value === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN
  const made=parse(first.generated_at),scheduled=parse(first.kickoff_utc),actualTime=parse(source.actual_kickoff_utc),fetched=parse(source.fetched_at)
  if (!(made < scheduled && made < actualTime && fetched > actualTime) || new Date(actualTime).toISOString().slice(0,10) !== g.date || source.source !== 'espn') continue
  if (!['generated_at','model_version','p_home','p_tie','p_away'].every(k => source.first[k] === first[k]) || source.first.scheduled_kickoff_utc !== first.kickoff_utc) continue
  if (first.trained_through !== undefined && !(parse(first.trained_through) <= made)) continue
  if (values.filter(p => p === Math.max(...values)).length === 1) { expectedN++; expectedCorrect += Number(values.indexOf(Math.max(...values)) === actual) }
  if (actual !== 1 && values[0]+values[2]>0) { expectedBinaryN++; expectedBinaryCorrect += Number((values[0] >= values[2]) === (actual === 0)) }
}
if (real.availability === 'available') { assert.equal(real.counts.eligible, expectedN); assert.equal(real.counts.correct, expectedCorrect); assert.equal(real.binary.eligible, expectedBinaryN); assert.equal(real.binary.correct, expectedBinaryCorrect); assert.equal(real.timeline.at(-1)?.accuracy ?? null, real.counts.accuracy) }
else { assert.equal(real.counts,null); assert.equal(real.binary,null); assert.deepEqual(real.timeline,[]) }
assert.deepEqual(JSON.parse(JSON.stringify(real)), real)
// Server loader must hash the original bytes, distinguish read/parse failure from valid empty, and never modify real artifacts.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nfl-record-contract-'))
try {
  fs.mkdirSync(path.join(temp, 'predictions')); fs.mkdirSync(path.join(temp, 'history')); const d = fixture()
  const firstRaw = JSON.stringify(d.first, null, 2) + '\n'; d.comparison.sources = { first_sha256: crypto.createHash('sha256').update(firstRaw).digest('hex') }
  fs.writeFileSync(path.join(temp, 'predictions/forecast_log.json'), firstRaw)
  fs.writeFileSync(path.join(temp, 'predictions/forecast_comparison.json'), JSON.stringify(d.comparison)); fs.writeFileSync(path.join(temp, 'predictions/game_forecasts.json'), JSON.stringify(d.current)); const historyFile = path.join(temp, 'history/season_2026.json'); fs.writeFileSync(historyFile, JSON.stringify(d.history))
  assert.equal(loadSeasonRecord({ dataDirectory: temp }).counts.eligible, 1)
  fs.appendFileSync(path.join(temp, 'predictions/forecast_log.json'), ' '); assert.equal(loadSeasonRecord({ dataDirectory: temp }).counts.eligible, 0, 'Whitespace byte mutation must break SHA binding')
  fs.writeFileSync(historyFile, '{broken'); assert.equal(loadSeasonRecord({ dataDirectory: temp }).counts, null)
  fs.unlinkSync(historyFile); assert.equal(loadSeasonRecord({ dataDirectory: temp }).counts, null)
  fs.writeFileSync(historyFile, JSON.stringify({...d.history,games:[]})); assert.equal(loadSeasonRecord({ dataDirectory: temp }).availability,'unavailable','Stale declared count is not an empty season')
  fs.writeFileSync(historyFile, JSON.stringify({season:2026,games:[]})); assert.equal(loadSeasonRecord({ dataDirectory: temp }).availability,'unavailable','Canonical stage counters are required')
  fs.writeFileSync(historyFile, JSON.stringify({ season: 2026, regular_season_games: 0, postseason_games: 0, games: [] })); assert.equal(loadSeasonRecord({ dataDirectory: temp }).availability, 'available')
} finally { fs.rmSync(temp, { recursive: true, force: true }) }
console.log('Record contracts passed: strict first evidence, H/T/A ties and ambiguity, separate binary counts, canonical stage counts and missing/empty states, weighted chronology/windows, raw-byte SHA and real-artifact reconciliation')
