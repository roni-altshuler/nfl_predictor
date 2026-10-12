const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const loaded = {}
Function('exports', ts.transpileModule(fs.readFileSync('src/lib/forecastLab.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(loaded)
const {parseForecast,recordAfter,validTeams} = loaded
const artifact = JSON.parse(fs.readFileSync('backend/data/predictions/game_forecasts.json','utf8'))
test('published forecasts survive validation without changing any probabilities',()=>{
  const result=parseForecast(artifact)
  assert.equal(result.withheld,0)
  for (const game of result.forecast.games) assert.deepEqual(game,artifact.games.find(g=>g.game_id===game.game_id))
})
test('invalid triples, lattices, dates and duplicate IDs are withheld',()=>{
  for (const update of [{margin_sd:0},{exp_total:-1},{p_home:NaN},{p_home:-.1},{p_tie:.5},{date_utc:'not a date'},
    {date_utc:'2026-09-20T12:00:00'},{margin_distribution:{low:-1,high:1,p:[.1,.2,.3],outside:.1}},
    {spread_surface:[{line:3,home_cover:2,push:0,away_cover:-1}]}]) {
    assert.equal(parseForecast({...artifact,games:[{...artifact.games[0],...update}]}).withheld,1)
  }
  assert.equal(parseForecast({...artifact,games:[artifact.games[0],artifact.games[0]]}).forecast.games.length,1)
  assert.equal(parseForecast(null).forecast,null)
})
test('homepage withholding notice identifies the Lab cohort when the raw snapshot has invalid and duplicate rows',()=>{
  const valid=structuredClone(artifact.games[0])
  const invalid={...structuredClone(valid),game_id:'900000121',p_home:.8,p_away:.1,p_tie:.4}
  const fixture={...artifact,games:[valid,invalid,structuredClone(valid)]}
  const parsed=parseForecast(fixture)
  assert.equal(parsed.withheld,2)
  assert.deepEqual(parsed.forecast.games,[valid])
  assert.equal(fixture.games.length,3,'Validation must not mutate the original snapshot used by other views')
  const format={},context={}
  const compile=(file)=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
  Function('exports','require',compile('src/lib/format.ts'))(format,require)
  Function('exports','require',compile('src/components/forecast/ForecastContext.tsx'))(context,name=>name==='@/lib/format'?format:require(name))
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
  const html=renderToStaticMarkup(React.createElement(context.ForecastContext,{publishedAt:fixture.generated_at,resultsThrough:fixture.trained_through,asOf:fixture.generated_at,withheld:parsed.withheld}))
  assert.match(html,/Forecast Lab: 2 invalid or duplicate forecasts withheld\./)
  assert.match(html,/Forecast published/)
  assert.match(html,/Results used through/)
})
test('record scenario adds only the selected result',()=>{
 const t={current_wins:2,current_losses:1,current_ties:0}
 assert.equal(recordAfter(t,'win'),'3–1–0');assert.equal(recordAfter(t,'loss'),'2–2–0');assert.equal(recordAfter(t,'tie'),'2–1–1')
 assert.deepEqual(t,{current_wins:2,current_losses:1,current_ties:0})
 assert.deepEqual(validTeams({teams:[{...t,p_playoffs:NaN}]}),[])
})
const scenariosModule = {}
Function('exports',ts.transpileModule(fs.readFileSync('src/lib/playoffScenarios.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(scenariosModule)
const scenariosArtifact=JSON.parse(fs.readFileSync('backend/data/predictions/playoff_scenarios.json','utf8'))
test('conditional playoff frequencies preserve the published simulation artifact',()=>{
 assert.deepEqual(scenariosModule.parseScenarios(scenariosArtifact,artifact),scenariosArtifact)
 assert.ok(scenariosModule.playoffSwing(scenariosArtifact.games[0])>=0)
})
test('scenario cohorts reject stale, mismatched, incomplete and invalid branches',()=>{
 for (const mutate of [d=>d.baseline.forEach(t=>t.team_id+=1000),d=>d.baseline.forEach(t=>t.abbreviation='INVALID'),d=>d.generated_at='2000-01-01T00:00:00Z',d=>d.games[0].home_team_id=999,d=>d.games.push(d.games[0]),d=>d.games[0].branches.home.samples++,d=>d.games[0].branches.home.teams.pop(),d=>d.games[0].branches.home.teams[0].p_playoffs=NaN,d=>d.games[0].branches.home.teams[0].playoff_mc_interval=[1,0]]) {
  const copy=structuredClone(scenariosArtifact);mutate(copy)
  assert.equal(scenariosModule.parseScenarios(copy,artifact),null)
 }
 assert.equal(scenariosModule.parseScenarios(null,artifact),null)
})
