const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const validation = {}
Function('exports', ts.transpileModule(fs.readFileSync('src/lib/forecastLab.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(validation)
const loaded = {}
Function('exports', 'require', ts.transpileModule(fs.readFileSync('src/lib/predictionPaths.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(loaded, name => { assert.equal(name, './forecastLab'); return validation })
const { predictionPaths, marginBand, MARGIN_BANDS } = loaded
const artifact = JSON.parse(fs.readFileSync('backend/data/predictions/game_forecasts.json', 'utf8'))
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)
function analyticalGame() {
  const p = Array(17).fill(0)
  for (const [margin, mass] of [[-8, .1], [-3, .15], [-1, .1], [0, .05], [1, .2], [3, .1], [8, .1]]) p[margin + 8] = mass
  return { ...structuredClone(artifact.games[0]), p_home: .5, p_away: .45, p_tie: .05,
    margin_distribution: { low: -8, high: 8, p, outside: .2 } }
}
test('known finite distribution separates home/away signs, boundaries, ties and unlabeled tails', () => {
  const game = analyticalGame(), before = JSON.stringify(game)
  const narrow = predictionPaths(game, 3), allInside = predictionPaths(game, 8)
  for (const [key, expected] of Object.entries({ homeClose: .3, awayClose: .25, homeWider: .2, awayWider: .2, tie: .05 })) close(narrow[key], expected)
  for (const [key, expected] of Object.entries({ homeClose: .4, awayClose: .35, homeWider: .1, awayWider: .1, tie: .05 })) close(allInside[key], expected)
  close(predictionPaths(game, 7).homeClose, narrow.homeClose)
  assert.equal(JSON.stringify(game), before)
})
test('every retained forecast conserves team win chances and total probability for all supported bands', () => {
  const before = JSON.stringify(artifact)
  for (const game of artifact.games) for (const band of MARGIN_BANDS) {
    const paths = predictionPaths(game, band)
    assert.ok(paths, `${game.game_id} at ${band}`)
    close(paths.homeClose + paths.homeWider, game.p_home)
    close(paths.awayClose + paths.awayWider, game.p_away)
    close(paths.tie, game.p_tie)
    assert.ok(Math.abs(Object.values(paths).reduce((sum, p) => sum + p, 0) - 1) < .001)
    assert.ok(Object.values(paths).every(p => p >= 0 && p <= 1))
  }
  assert.equal(JSON.stringify(artifact), before)
})
test('zero is reported while unavailable, truncated, unsupported and contradictory sources are withheld', () => {
  const zero = analyticalGame()
  zero.margin_distribution.p[9] = 0
  zero.margin_distribution.p[11] += .2
  close(predictionPaths(zero, 3).homeClose, .3)
  const allWide = analyticalGame()
  allWide.margin_distribution.p[16] += .3
  allWide.margin_distribution.p[9] = allWide.margin_distribution.p[11] = 0
  assert.equal(predictionPaths(allWide, 3).homeClose, 0)
  assert.equal(predictionPaths(null, 3), null)
  for (const band of [0, 4, 9, NaN, Infinity]) assert.equal(predictionPaths(analyticalGame(), band), null)
  for (const mutate of [g => delete g.margin_distribution,
    g => g.margin_distribution.p[8] = NaN,
    g => g.margin_distribution.p[8] = -.1,
    g => { g.margin_distribution.p[8] += .01; g.margin_distribution.p[9] -= .01 },
    g => { g.margin_distribution.p[16] += .21; g.margin_distribution.outside -= .2; g.margin_distribution.p[0] -= .01 },
    g => { g.margin_distribution.low = -3; g.margin_distribution.high = 3; g.margin_distribution.p = [.1, 0, 0, .05, 0, 0, .2]; g.margin_distribution.outside = .65 },
  ]) { const game = analyticalGame(); mutate(game); assert.equal(predictionPaths(game, 8), null) }
})
test('shared margin bands accept only published choices and explicitly fall back for unsupported requests', () => {
  assert.deepEqual(marginBand(null), { band: 8, unsupported: false })
  for (const band of MARGIN_BANDS) assert.deepEqual(marginBand(String(band)), { band, unsupported: false })
  for (const value of ['4', '', '03', '8.0', 'Infinity', '<script>']) assert.deepEqual(marginBand(value), { band: 8, unsupported: true })
})
