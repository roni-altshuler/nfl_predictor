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
  m.require = name => name.startsWith('.') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : originalRequire(name)
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, file)
  return m.exports
}
const { normalizeGameSummary, getGameDetail } = load('espn.ts')
const { providerId, normalizeAthlete, athleteHref, permittedPortrait, athleteInitials } = load('athletes.ts')
const { playerSnapshots } = load('playerProfiles.ts')
const fixture = require('./fixtures/espn-player-summary.json')
const clone = () => structuredClone(fixture)
const normalize = s => normalizeGameSummary(s, '401872966', 'NYG', 'ARI')

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
