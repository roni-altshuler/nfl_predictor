/** Published-artifact rendering contracts; synthetic variants remain test-only. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { test } = require('node:test')
const modules = new Map()
function load(file) {
  file = path.resolve(__dirname, '../src', file)
  if (modules.has(file)) return modules.get(file).exports
  const m = new Module(file, module)
  m.filename = file
  m.paths = module.paths
  modules.set(file, m)
  const original = m.require.bind(m)
  m.require = name => name.startsWith('@/') ? load(`${name.slice(2)}.${name.includes('/components/') || name.startsWith('@/components/') ? 'tsx' : 'ts'}`) : original(name)
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, file)
  return m.exports
}
const { TeamPublishedMatchup } = load('components/teams/TeamPublishedMatchup.tsx')
const { pct, forecastStamp, kickoff } = load('lib/format.ts')
const publication = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../backend/data/predictions/game_forecasts.json'), 'utf8'))
const game = publication.games[0]
assert.ok(game)
function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(TeamPublishedMatchup, {
    game, teamAbbreviation: game.home, publishedAt: publication.generated_at,
    resultsThrough: publication.trained_through, ...overrides,
  }))
}

test('each published side keeps its own win chance and projected points without changing source data', () => {
  const before = JSON.stringify(game)
  const html = render()
  const away = html.slice(html.indexOf(`aria-label="${game.away} published forecast"`), html.indexOf(`aria-label="${game.home} published forecast"`))
  const home = html.slice(html.indexOf(`aria-label="${game.home} published forecast"`))
  assert.ok(away.includes(`>${pct(game.p_away)}<`))
  assert.ok(away.includes(`>${game.exp_away_score.toFixed(1)}<`))
  assert.ok(home.includes(`>${pct(game.p_home)}<`))
  assert.ok(home.includes(`>${game.exp_home_score.toFixed(1)}<`))
  assert.ok(html.includes(`>${pct(game.p_tie)}<`))
  assert.equal(JSON.stringify(game), before)
})

test('matchup, players, opponent and schedule destinations remain distinct native links', () => {
  for (const team of [game.home, game.away]) {
    const html = render({ teamAbbreviation: team })
    const opponent = team === game.home ? game.away : game.home
    assert.ok(html.includes(`href="/games/${game.game_id}"`))
    assert.ok(html.includes(`href="/games/${game.game_id}#players"`))
    assert.ok(html.includes(`href="/teams/${opponent}"`))
    assert.equal(html.includes(`href="/teams/${team}"`), false, 'The current team is not a redundant same-page link')
    assert.ok(html.includes('href="#team-schedule"'))
  }
})

test('dated snapshots and neutral designations do not become clock-inferred live or final statuses', () => {
  const variant = { ...game, neutral_site: true, date_utc: '2020-10-11T13:30:00Z' }
  const html = render({ game: variant })
  assert.ok(html.includes(kickoff(variant.date_utc)))
  assert.ok(html.includes(forecastStamp(publication.generated_at)))
  assert.ok(html.includes(forecastStamp(publication.trained_through)))
  assert.ok(html.includes('home/away are the published designations'))
  assert.ok(html.includes('does not track game progress'))
  assert.equal(/\blive\b|\bfinal\b/i.test(html), false)
})

test('missing publication coverage stays unavailable instead of showing an invented matchup or zero', () => {
  const html = render({ game: undefined, publishedAt: undefined, resultsThrough: null })
  assert.ok(html.includes('No matchup in the published forecast'))
  assert.ok(html.includes('href="/games"'))
  assert.equal(html.match(/Unavailable/g).length, 2)
  assert.equal(html.includes('Win chance'), false)
  assert.equal(html.includes('Projected points'), false)
  assert.equal(html.includes('0.0%'), false)
})
