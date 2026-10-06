const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const Module = require('node:module')
const path = require('node:path')
const file = path.resolve(__dirname, '../src/lib/weekBrowser.ts')
const moduleUnderTest = new Module(file, module)
moduleUnderTest.filename = file
moduleUnderTest.paths = module.paths
moduleUnderTest._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file)
const { publishedWeek, easternGameDay, weekDays } = moduleUnderTest.exports

assert.equal(publishedWeek('4', [4,5,6], 5), 4)
for (const invalid of ['4evil','3','999','NaN','',null]) assert.equal(publishedWeek(invalid,[4,5,6],5),5)
assert.equal(easternGameDay('2026-10-05T00:20:00Z'), '2026-10-04')
assert.equal(easternGameDay('2026-11-02T01:20:00Z'), '2026-11-01')
const rows = [
  {game_id:'monday',date_utc:'2026-10-06T00:15:00Z'},
  {game_id:'sunday-night',date_utc:'2026-10-05T00:20:00Z'},
  {game_id:'sunday-day',date_utc:'2026-10-04T17:00:00Z'},
]
assert.deepEqual(weekDays(rows).map(([day,games])=>[day,games.map(game=>game.game_id)]),[
  ['2026-10-04',['sunday-day','sunday-night']],['2026-10-05',['monday']],
])
assert.deepEqual(weekDays([]),[])
assert.equal(rows[0].game_id,'monday','Grouping must not reorder the source artifact')
console.log('Week browser: week validation, Eastern/DST bucketing, sorted grouping and empty/source preservation passed')
