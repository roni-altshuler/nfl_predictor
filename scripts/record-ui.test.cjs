/** Real React SSR boundary contracts; no component/router mocks and no artifact writes. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const root = path.resolve(__dirname, '..'), cache = new Map(), loadedSources = new Set()

function sourceFile(candidate) {
  return [candidate, candidate + '.ts', candidate + '.tsx', path.join(candidate, 'index.ts'), path.join(candidate, 'index.tsx')]
    .find(file => /\.tsx?$/.test(file) && fs.existsSync(file) && fs.statSync(file).isFile())
}
function actualSource(candidate) {
  const file = sourceFile(candidate)
  assert.ok(file, 'Actual source module must resolve: ' + candidate)
  if (cache.has(file)) return cache.get(file).exports
  const loaded = new Module(file, module); loaded.filename = file; loaded.paths = Module._nodeModulePaths(path.dirname(file)); cache.set(file, loaded); loadedSources.add(path.relative(root, file))
  loaded.require = name => {
    if (name.startsWith('@/')) return actualSource(path.join(root, 'src', name.slice(2)))
    if (name.startsWith('.')) { const local = sourceFile(path.resolve(path.dirname(file), name)); if (local) return actualSource(local) }
    return Module.prototype.require.call(loaded, name)
  }
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: file,
  }).outputText, file)
  return loaded.exports
}
const { buildSeasonRecord } = actualSource(path.join(root, 'src/lib/record'))
const { loadSeasonRecord } = actualSource(path.join(root, 'src/lib/server/record'))
const { SeasonRecord } = actualSource(path.join(root, 'src/components/record/SeasonRecord'))
const { PredictionLedger } = actualSource(path.join(root, 'src/components/record/PredictionLedger'))
const plain = html => html.replace(/<!--.*?-->/gs, '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
function testField(html, id) {
  const match = html.match(new RegExp('<([a-z0-9]+)[^>]*data-testid="' + id + '"[^>]*>([\\s\\S]*?)</\\1>'))
  assert.ok(match, 'SSR field exists: ' + id); return plain(match[2])
}
function ledgerRow(html, id) {
  const match = html.match(new RegExp('<li[^>]*data-record-game="' + id + '"[^>]*>([\\s\\S]*?)</li>'))
  assert.ok(match, 'Actual ledger row exists: ' + id); return match[1]
}
function savedPick(html) {
  const match = html.match(/<dt\b[^>]*>Saved pick<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/)
  assert.ok(match, 'Native saved-pick definition exists'); return plain(match[1])
}
function ssr(record) {
  // Exercise the actual server/client serialized-props boundary before the real component renders.
  const serialized = JSON.parse(JSON.stringify(record)); assert.deepEqual(serialized, record)
  return renderToStaticMarkup(React.createElement(SeasonRecord, { record: serialized, seasons: [record.season] }))
}
function noChartOrPercentage(html) {
  assert.doesNotMatch(html, /<svg\b/, 'No invented zero-series SVG may be rendered')
  assert.doesNotMatch(plain(html), /\d(?:\.\d+)?%/, 'Unknown/ungraded records must not fabricate a percentage')
}
function fixture() {
  const first = { game_id: 'known', season: 2026, week: 1, home: 'H', away: 'A', home_score: 10, away_score: 7, generated_at: '2026-08-16T15:19:07Z', kickoff_utc: '2026-09-10T00:20:00Z', model_version: 'test-model-v1', p_home: .6, p_tie: .1, p_away: .3 }
  const game = { game_id: 'known', week: 1, home: 'H', away: 'A', home_score: 10, away_score: 7, date: '2026-09-10', postseason: false }
  return { season: 2026, firstHashVerified: true,
    first: { season: 2026, basis: 'published', generated_at: '2026-10-30T00:00:00Z', games: [first] },
    history: { season: 2026, generated_at: '2026-10-30T00:00:00Z', regular_season_games: 1, postseason_games: 0, games: [game] },
    comparison: { season: 2026, games: [{ ...game, actual_kickoff_utc: first.kickoff_utc, fetched_at: '2026-10-30T00:00:00Z', source: 'espn', first: { ...first, scheduled_kickoff_utc: first.kickoff_utc } }] },
    current: { season: 2026, generated_at: '2026-10-30T00:00:00Z', games: [{ game_id: 'pending', season: 2026, week: 2, home: 'H', away: 'A', date_utc: '2026-09-20T17:00:00Z', p_home: .99, p_tie: 0, p_away: .01 }] } }
}

let data = fixture(); data.history = null
let record = buildSeasonRecord(data), html = ssr(record)
assert.equal(record.counts, null); assert.equal(testField(html, 'record-percentage'), '—'); assert.equal(testField(html, 'record-fraction'), 'Record unavailable')
assert.ok(plain(html).includes('Totals and the timeline are withheld.')); noChartOrPercentage(html)
console.log('SSR unavailable history: withheld counts, em dash, Record unavailable, no percentage or chart')

data = fixture(); data.history.games = [] // Published counter still declares one outcome: not an honest empty archive.
record = buildSeasonRecord(data); html = ssr(record)
assert.equal(testField(html, 'record-fraction'), 'Record unavailable'); assert.equal(testField(html, 'record-percentage'), '—'); noChartOrPercentage(html)
console.log('SSR inconsistent declared outcome count: withheld as unavailable, never reclassified as an empty scored record')

data = fixture(); data.history.games = []; data.history.regular_season_games = 0; data.history.postseason_games = 0; data.first.games = []; data.comparison.games = []; data.current.games = []
record = buildSeasonRecord(data); html = ssr(record)
assert.equal(record.availability, 'available'); assert.equal(record.counts.settled, 0); assert.equal(testField(html, 'record-percentage'), '—'); assert.equal(testField(html, 'record-fraction'), 'Not yet scored'); noChartOrPercentage(html)
assert.ok(!plain(html).includes('Record unavailable'))
console.log('SSR honest empty source: zero games and stage counters, Not yet scored, no false 0%/chart')

for (const failure of ['missing-first', 'hash-mismatch', 'source-mismatch']) {
  data = fixture()
  if (failure === 'missing-first') data.first.games = []
  else if (failure === 'hash-mismatch') data.firstHashVerified = false
  else data.comparison.games[0].first.model_version = 'different-source-model'
  record = buildSeasonRecord(data); html = ssr(record)
  assert.equal(record.counts.ungraded, 1); assert.equal(testField(html, 'record-percentage'), '—'); assert.equal(testField(html, 'record-fraction'), 'Not yet scored'); noChartOrPercentage(html)
  assert.match(plain(html), /Unscored \/ unpicked 1/)
  const row = ledgerRow(html, 'known'); assert.equal(savedPick(row), 'Unavailable'); assert.ok(plain(row).includes('A 7–10 H')); assert.ok(plain(row).includes('No eligible original probability vector')); assert.ok(plain(row).includes('Saved publication Not available'))
  assert.ok(!plain(row).includes('test-model-v1')); assert.ok(!plain(row).includes('60.00%')); assert.ok(!plain(row).includes('Incorrect'))
}
console.log('SSR missing/mismatched first evidence: ungraded coverage and actual score retained; authentic pick/probabilities/publication/model withheld')

record = buildSeasonRecord(fixture()); const pending = JSON.parse(JSON.stringify(record.rows.filter(row => row.status === 'pending')))
assert.equal(pending.length, 1); html = renderToStaticMarkup(React.createElement(PredictionLedger, { rows: pending }))
const pendingHtml = ledgerRow(html, 'pending'); assert.ok(plain(pendingHtml).includes('Scheduled ')); assert.ok(!plain(pendingHtml).includes('kickoff unavailable')); assert.equal(savedPick(pendingHtml), 'Unavailable'); assert.ok(plain(pendingHtml).includes('Result not recorded')); assert.ok(plain(pendingHtml).includes('No eligible original probability vector')); assert.ok(!plain(pendingHtml).includes('99.00%'))
console.log('SSR pending ledger: known scheduled time labelled Scheduled; no substituted current-snapshot first pick')

data = fixture()
for (const source of [data.first.games[0], data.history.games[0], data.comparison.games[0]]) { source.home_score = 0; source.away_score = 7 }
record = buildSeasonRecord(data); html = ssr(record)
assert.equal(testField(html, 'record-percentage'), '0.0%'); assert.equal(testField(html, 'record-fraction'), '0 of 1 correct'); assert.match(html, /<svg\b/, 'A real graded 0% remains a populated series, unlike unavailable evidence')
console.log('SSR legitimate graded zero: 0.0% of one verified outcome remains distinct from missing evidence')

const real = loadSeasonRecord()
const artifactPaths = ['predictions/forecast_log.json', 'predictions/forecast_comparison.json', 'predictions/game_forecasts.json', ...(real.season === null ? [] : [`history/season_${real.season}.json`])].map(file => path.join(root, 'backend/data', file))
const digest = file => { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
const before = artifactPaths.map(digest)
html = ssr(real)
if (real.availability === 'available') {
  assert.equal(testField(html, 'record-percentage'), real.counts.accuracy === null ? '—' : real.counts.accuracy.toFixed(1) + '%')
  assert.equal(testField(html, 'record-fraction'), real.counts.eligible ? `${real.counts.correct} of ${real.counts.eligible} correct` : 'Not yet scored')
  if (real.counts.eligible) {
    const heroIndex = html.indexOf('data-testid="record-percentage"'), timelineIndex = html.indexOf('aria-label="Season accuracy timeline"'), ledgerIndex = html.indexOf('aria-label="Prediction and result ledger"')
    assert.ok(heroIndex >= 0 && timelineIndex > heroIndex && ledgerIndex > heroIndex, 'Accuracy headline must precede chart/ledger')
    const earlySummary = plain(html.slice(heroIndex, Math.min(timelineIndex, ledgerIndex)))
    const text = plain(html); assert.ok(text.includes(`Decided games ${real.binary.eligible}`)); assert.ok(text.includes('Separate conditional binary benchmark')); assert.ok(text.includes('Results published ')); assert.ok(text.includes('Latest recorded kickoff:')); assert.ok(text.includes('not the latest weekly fit')); assert.ok(text.includes('First-published three-way outcome picks'))
    for (const version of real.meta.firstModelVersions) assert.ok(earlySummary.includes(version), 'Model scope must precede chart/ledger')
    const { forecastStamp } = actualSource(path.join(root, 'src/lib/format')); assert.ok(earlySummary.includes(forecastStamp(real.meta.resultsUpdatedAt))); assert.ok(earlySummary.includes(forecastStamp(real.meta.publicationStart))); assert.ok(earlySummary.includes('not the latest weekly fit'))
  } else noChartOrPercentage(html)
} else { assert.equal(testField(html, 'record-fraction'), 'Record unavailable'); noChartOrPercentage(html) }
assert.deepEqual(artifactPaths.map(digest), before, 'SSR tests must not mutate retained artifacts')
for (const file of ['src/components/record/SeasonRecord.tsx', 'src/components/record/AccuracyTimeline.tsx', 'src/components/record/PredictionLedger.tsx', 'src/components/record/useRecordQuery.ts']) assert.ok(loadedSources.has(file), 'Must use actual component source: ' + file)
assert.ok(require.resolve('next/link').includes('next'), 'Next Link remains the actual external module')
console.log(`SSR real current source: ${real.counts?.correct ?? 'unavailable'}/${real.counts?.eligible ?? 'unavailable'}; ${real.counts?.accuracy?.toFixed(1) ?? '—'}%; separate conditional ${real.binary?.eligible ?? 'unavailable'}; scope/freshness visible before drill-down`)
console.log('Record SSR UI contracts passed with actual ReactDOMServer, TSX components, hooks and Next Link; no component mocks or browser/window emulation')
