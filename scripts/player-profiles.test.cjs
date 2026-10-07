const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { test } = require('node:test')
const modules = new Map()
function load(file) {
  file = path.resolve(__dirname, '../src/lib', file)
  if (modules.has(file)) return modules.get(file).exports
  const m = new Module(file, module)
  m.filename = file
  m.paths = module.paths
  modules.set(file, m)
  const originalRequire = m.require.bind(m)
  m.require = name => name.startsWith('.') ? load(path.resolve(path.dirname(file), `${name}.ts`))
    : name.startsWith('@/lib/') ? load(`${name.slice(6)}.ts`) : originalRequire(name)
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, file)
  return m.exports
}
const { normalizeGameSummary, getGameDetail } = load('espn.ts')
const { providerId, normalizeAthlete, athleteHref, permittedPortrait, athleteInitials } = load('athletes.ts')
const { playerSnapshots } = load('playerProfiles.ts')
const fixture = require('./fixtures/espn-player-summary.json')
const archiveFixture = require('./fixtures/espn-archived-summary.json')
const { playerGameContext } = load('server/playerContext.ts')
const { playerMatchDate, kickoff } = load('format.ts')
const { leaderComparisons } = load('leaderComparison.ts')
const clone = () => structuredClone(fixture)
const normalize = s => normalizeGameSummary(s, '401872966', 'NYG', 'ARI')

test('leader comparison pairs provider categories and preserves the observed ID, position and raw lines', () => {
  const before = JSON.stringify(fixture)
  const rows = leaderComparisons(normalize(fixture), 'NYG', 'ARI')
  assert.equal(rows.length, 5)
  const passing = rows.find(row => row.key === 'passingYards')
  assert.equal(passing.home.line.athlete.id, '2969939')
  assert.equal(passing.away.line.athlete.id, '2578570')
  assert.equal(passing.home.line.athlete.position, 'QB')
  assert.equal(passing.home.line.stat, fixture.leaders[0].leaders[0].leaders[0].displayValue)
  assert.equal(passing.away.line.stat, fixture.leaders[1].leaders[0].leaders[0].displayValue)
  assert.equal(JSON.stringify(fixture), before)
  const sameLabel = clone()
  sameLabel.leaders[1].leaders[0].name = 'differentProviderCategory'
  const unpaired = leaderComparisons(normalize(sameLabel), 'NYG', 'ARI').find(row => row.key === 'passingYards')
  assert.equal(unpaired.away.state, 'missing', 'A display-label collision does not merge different provider categories')
})

test('comparison leaves absent sides, IDs, positions and statistics unknown; supplied zero stays zero', () => {
  const s = clone()
  s.leaders[1].leaders.shift()
  const athlete = s.leaders[0].leaders[0].leaders[0].athlete
  delete athlete.id
  delete athlete.position
  s.leaders[0].leaders[0].leaders[0].displayValue = ''
  s.leaders[0].leaders[3].leaders[0].displayValue = '0'
  const rows = leaderComparisons(normalize(s), 'NYG', 'ARI')
  const passing = rows.find(row => row.key === 'passingYards')
  assert.equal(passing.away.line, null)
  assert.equal(passing.away.state, 'missing')
  assert.equal(passing.home.line.athlete.position, null)
  assert.equal(athleteHref(passing.home.line.athlete, fixture.header.id), null)
  assert.equal(passing.home.line.stat, '')
  assert.equal(rows.find(row => row.key === 'sacks').home.line.stat, '0')
})

test('comparison withholds conflicting identities, duplicate team/category lines and unverified source context', () => {
  const duplicate = normalize(fixture)
  duplicate.leaders.push(structuredClone(duplicate.leaders[0]))
  assert.equal(leaderComparisons(duplicate, 'NYG', 'ARI')[0].home.state, 'ambiguous')
  const multiple = normalize(fixture)
  multiple.leaders[0].leaders.push(structuredClone(multiple.leaders[0].leaders[0]))
  assert.equal(leaderComparisons(multiple, 'NYG', 'ARI')[0].home.state, 'ambiguous', 'Multiple supplied leaders must not become an arbitrary single-player comparison')
  const conflict = clone()
  conflict.leaders[1].leaders[0].leaders[0].athlete.id = '2969939'
  const passing = leaderComparisons(normalize(conflict), 'NYG', 'ARI')[0]
  assert.equal(passing.home.line, null)
  assert.equal(passing.away.line, null)
  assert.equal(passing.home.state, 'conflicting')
  for (const status of ['unavailable', 'mismatched']) {
    const detail = normalize(fixture)
    detail.source.status = status
    assert.deepEqual(leaderComparisons(detail, 'NYG', 'ARI'), [])
  }
  assert.deepEqual(leaderComparisons(normalize(fixture), 'NYG', 'NYG'), [])
})

test('archived profiles preserve published date precision across Eastern daylight/standard time', () => {
  const cases = [['401547421', '2023-09-17', 'Sep 17, 2023'], ['401220253', '2020-12-13', 'Dec 13, 2020'],
    ['401030706', '2018-10-14', 'Oct 14, 2018']]
  for (const [id, date, label] of cases) {
    const game = playerGameContext(id)
    assert.equal(game.date, date)
    assert.equal(game.datePrecision, 'day')
    assert.equal(game.includeInjuries, false)
    assert.equal(playerMatchDate(game.date, game.datePrecision), `${label} · Kickoff time unavailable`)
  }
  const publishedForecasts = require('../backend/data/predictions/game_forecasts.json')
  const upcoming = playerGameContext(publishedForecasts.games[0].game_id)
  assert.equal(upcoming.datePrecision, 'instant')
  assert.equal(playerMatchDate(upcoming.date, upcoming.datePrecision), kickoff(upcoming.date))
  for (const invalid of ['2023-02-30', '2023-13-17', '', '2023-09-17T20:00:00Z'])
    assert.equal(playerMatchDate(invalid, 'day'), 'Date unavailable · Kickoff time unavailable')
})

test('controlled OAK/LV archive uses stable ESPN franchise ID; wrong/missing IDs and wrong teams are withheld', () => {
  const normalizeArchive = s => normalizeGameSummary(s, '401030706', 'LV', 'SEA')
  const detail = normalizeArchive(archiveFixture)
  assert.equal(detail.source.status, 'available')
  assert.equal(detail.source.asOf, null, 'Synthetic response supplies no source update')
  assert.deepEqual(detail.linescores.map(row => row.team), ['SEA', 'LV'])
  assert.equal(detail.teamStats[0].home, '1')
  assert.equal(detail.leaders[0].team, 'LV')
  assert.equal(detail.injuries[0].team, 'LV')
  const profile = playerSnapshots(detail, false)[0]
  assert.equal(profile.team, 'LV')
  assert.deepEqual(profile.availability, [])
  for (const identity of [{ id: '17', abbreviation: 'OAK' }, { abbreviation: 'OAK' }, { id: '13', abbreviation: 'MIA' },
    { id: '17', abbreviation: 'LV' }]) {
    const wrong = structuredClone(archiveFixture)
    wrong.header.competitions[0].competitors[0].team = identity
    assert.equal(normalizeArchive(wrong).source.status, 'mismatched')
    assert.deepEqual(normalizeArchive(wrong).leaders, [])
  }
  const wrongBlocks = structuredClone(archiveFixture)
  wrongBlocks.leaders[0].team.id = '17'
  wrongBlocks.injuries[0].team.id = '17'
  wrongBlocks.boxscore.teams[0].team.id = '17'
  assert.deepEqual(normalizeArchive(wrongBlocks).leaders, [])
  assert.deepEqual(normalizeArchive(wrongBlocks).injuries, [])
  assert.deepEqual(normalizeArchive(wrongBlocks).teamStats, [])
  const wrongEvent = structuredClone(archiveFixture)
  wrongEvent.header.id = '999'
  assert.equal(normalizeArchive(wrongEvent).source.status, 'mismatched')
})

test('real response fixture preserves provider IDs, context and distinct source/report dates', () => {
  const before = JSON.stringify(fixture)
  const detail = normalize(fixture)
  assert.equal(detail.source.status, 'available')
  assert.equal(detail.source.asOf, '2026-10-04T20:11:04.000Z')
  assert.equal(detail.leaders[0].leaders[0].athlete.id, '2969939')
  assert.equal(detail.leaders[0].leaders[0].athlete.position, 'QB')
  assert.equal(detail.leaders[0].leaders[0].athlete.jersey, '19')
  assert.equal(detail.injuries[0].athlete.id, fixture.injuries[0].injuries[0].athlete.id)
  assert.equal(detail.injuries[0].reportedAt, new Date(fixture.injuries[0].injuries[0].date).toISOString())
  assert.equal(JSON.stringify(fixture), before, 'Normalization does not mutate a provider response')
  const player = playerSnapshots(detail).find(p => p.athlete.id === '2969939')
  assert.equal(player.team, 'NYG')
  assert.equal(player.statistics[0].value, fixture.leaders[0].leaders[0].leaders[0].displayValue)
  assert.equal(athleteHref(player.athlete, '401872966'), '/players/espn/2969939?game=401872966')
})

test('same names with different IDs stay separate; repeated IDs combine category lines', () => {
  const s = clone()
  const category = s.leaders[0].leaders[0]
  s.leaders[0].leaders.push({ ...structuredClone(category), displayName: 'Another category' })
  const other = structuredClone(category)
  other.leaders[0].athlete.id = '100001'
  s.leaders[0].leaders.push(other)
  const players = playerSnapshots(normalize(s))
  assert.equal(players.filter(p => p.athlete.displayName === 'Jameis Winston').length, 2)
  assert.equal(players.find(p => p.athlete.id === '2969939').statistics.length, 2)
})

test('missing/invalid IDs retain names but do not create routes or profile identity', () => {
  const s = clone()
  delete s.leaders[0].leaders[0].leaders[0].athlete.id
  const detail = normalize(s)
  const athlete = detail.leaders[0].leaders[0].athlete
  assert.equal(athlete.displayName, 'Jameis Winston')
  assert.equal(athlete.id, null)
  assert.equal(athleteHref(athlete, '401872966'), null)
  assert.equal(playerSnapshots(detail).some(p => p.athlete.displayName === 'Jameis Winston'), false)
  for (const bad of ['jameis-winston', '42evil', '0', '01', '../42', '', {}, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.equal(providerId(bad), null)
  assert.equal(providerId(42), '42')
  assert.equal(athleteInitials('  Jameis Winston  '), 'JW')
  assert.equal(athleteInitials(''), '—')
})

test('mismatched event/team identity withholds player data and ignores unrelated teams', () => {
  const event = clone()
  event.header.id = '999'
  assert.equal(normalize(event).source.status, 'mismatched')
  assert.equal(normalize(event).source.asOf, null, 'A different event cannot supply this fixture’s source timestamp')
  const teams = clone()
  teams.header.competitions[0].competitors[0].team.abbreviation = 'IND'
  assert.deepEqual(normalize(teams).leaders, [])
  assert.deepEqual(normalize(teams).injuries, [])
  const unrelated = clone()
  unrelated.leaders[0].team.abbreviation = 'IND'
  assert.equal(normalize(unrelated).leaders.some(g => g.team === 'IND'), false)
  const malformed = clone()
  malformed.leaders = {}
  malformed.injuries = 'not a list'
  assert.deepEqual(playerSnapshots(normalize(malformed)), [])
})

test('conflicting team context is withheld; archived profiles omit current injuries', () => {
  const s = clone()
  const line = structuredClone(s.leaders[0].leaders[0])
  s.leaders[1].leaders.push(line)
  assert.equal(playerSnapshots(normalize(s)).some(p => p.athlete.id === '2969939'), false)
  const archived = playerSnapshots(normalize(fixture), false)
  assert.equal(archived.every(p => p.availability.length === 0), true)
  const injuryId = fixture.injuries[0].injuries[0].athlete.id
  assert.equal(archived.some(p => p.athlete.id === injuryId), false)
})

test('official supplied URLs never grant image permission; reviewed assets require subject/provenance', () => {
  const raw = structuredClone(fixture.leaders[0].leaders[0].leaders[0].athlete)
  raw.permission = { status: 'permitted', evidence: 'untrusted response claim' }
  const athlete = normalizeAthlete(raw, 'https://site.web.api.espn.com/summary?event=401872966')
  assert.equal(athlete.portrait.permission.status, 'unverified')
  assert.equal(athlete.portrait.providerUrl, raw.headshot.href, 'Only the supplied reference is retained')
  assert.equal(permittedPortrait(athlete.portrait, athlete), null)
  const permitted = { ...structuredClone(athlete.portrait), assetPath: '/athletes/reviewed-example.png',
    permission: { status: 'permitted', evidence: 'Example test permission record' },
    verification: { status: 'verified', verifiedAt: '2026-10-06T12:00:00Z' } }
  assert.equal(permittedPortrait(permitted, athlete), '/athletes/reviewed-example.png')
  const forbidden = [
    { permission: { status: 'denied', evidence: 'No reuse' } },
    { permission: { status: 'permitted', evidence: null } },
    { verification: { status: 'unverified', verifiedAt: null } },
    { verification: { status: 'verified', verifiedAt: 'invalid' } },
    { subject: { provider: 'espn', id: '999' } },
    { subject: { provider: 'other', id: athlete.id } },
    { provenance: { sourceUrl: '', suppliedBy: '' } },
    { assetPath: raw.headshot.href }, { assetPath: '//example.com/image.png' },
    { assetPath: '/athletes/../unreviewed.png' }, { assetPath: '/favicon-16.png' },
  ]
  for (const change of forbidden) assert.equal(permittedPortrait({ ...permitted, ...change }, athlete), null)
})

test('failed requests and invalid JSON are explicit unavailable responses, using only the summary endpoint', async () => {
  const original = global.fetch
  const requests = []
  try {
    for (const response of [new Response('', { status: 503 }), new Response('invalid JSON', { status: 200 })]) {
      global.fetch = async url => { requests.push(url); return response }
      const detail = await getGameDetail('401872966', 'NYG', 'ARI')
      assert.equal(detail.source.status, 'unavailable')
      assert.deepEqual(playerSnapshots(detail), [])
      assert.equal(detail.source.asOf, null)
    }
    assert.equal(requests.every(url => url === 'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401872966'), true)
  } finally { global.fetch = original }
})
