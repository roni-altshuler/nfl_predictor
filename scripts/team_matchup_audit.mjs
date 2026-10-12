/** Published team→matchup exploration, with real Chromium and controlled outages. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(path.join(process.env.BROWSER_TEST_MODULE_ROOT || process.cwd(), 'package.json'))
const { chromium } = require('playwright')
const axePath = require.resolve('axe-core/axe.min.js')
const publication = JSON.parse(await fs.readFile('backend/data/predictions/game_forecasts.json', 'utf8'))
const base = process.env.BASE_URL || 'http://127.0.0.1:3012'
const output = process.env.TEAM_MATCHUP_OUTPUT || '/tmp/nfl-team-matchup-audit'
const team = publication.games.some(g => [g.home, g.away].includes('NYG')) ? 'NYG' : publication.games[0].away
const fixtures = publication.games.filter(g => [g.home, g.away].includes(team)).sort((a, b) => a.date_utc.localeCompare(b.date_utc))
const game = fixtures[0]
assert.ok(game && fixtures.length > 1)
const opponent = game.home === team ? game.away : game.home
const opponentName = game.home === team ? game.away_name : game.home_name
const teamName = game.home === team ? game.home_name : game.away_name
const teamUrl = `${base}/teams/${team}`
const gameUrl = `${base}/games/${game.game_id}`
const hero = page => page.getByRole('region', { name: 'Published matchup', exact: true })
const teamReady = page => page.getByRole('heading', { level: 1, name: teamName, exact: true }).waitFor()
const gameReady = page => page.getByRole('region', { name: 'Forecast', exact: true }).waitFor()
const date = value => new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
const checks = [], errors = [], blocked = [], journeys = []
await fs.mkdir(output, { recursive: true })
await fs.rm(path.join(output, 'results.json'), { force: true })
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
  ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) })
async function context(width, options = {}) {
  const c = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', ...options })
  await c.route(/^https:/, route => { blocked.push(route.request().url()); return route.abort() })
  c.on('page', p => p.on('pageerror', error => errors.push(error.message)))
  return c
}
async function verifyHero(page, selected) {
  const card = hero(page)
  for (const side of ['away', 'home']) {
    const group = card.getByRole('group', { name: `${selected[side]} published forecast`, exact: true })
    const text = await group.innerText()
    assert.ok(text.includes((selected[`p_${side}`] * 100).toFixed(1) + '%'))
    assert.ok(text.includes(selected[`exp_${side}_score`].toFixed(1)))
  }
  assert.ok((await card.innerText()).includes((selected.p_tie * 100).toFixed(1) + '%'))
  assert.ok((await card.innerText()).includes(date(publication.generated_at)))
  assert.ok((await card.innerText()).includes(date(publication.trained_through)))
  assert.match(await card.innerText(), /does not track game progress/)
  assert.equal(await card.getByRole('link', { name: 'Explore matchup →', exact: true }).getAttribute('href'), `/games/${selected.game_id}`)
  assert.equal(await card.getByRole('link', { name: 'Player reports →', exact: true }).getAttribute('href'), `/games/${selected.game_id}#players`)
}
async function health(page, width, state) {
  await page.addScriptTag({ path: axePath })
  const result = await page.evaluate(async () => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    axe: (await window.axe.run('#main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })),
    palette: getComputedStyle(document.body).backgroundColor,
    overlay: !!document.querySelector('[data-nextjs-dialog]'),
  }))
  assert.equal(result.overflow, false)
  assert.deepEqual(result.axe, [])
  assert.equal(result.palette, 'rgb(11, 18, 14)')
  assert.equal(result.overlay, false)
  checks.push({ width, state, ...result })
}
try {
  for (const width of [320, 390, 768, 1440]) {
    const c = await context(width), page = await c.newPage()
    await page.goto(teamUrl, { waitUntil: 'networkidle' })
    await verifyHero(page, game)
    const probabilityTops = await hero(page).getByRole('group').locator('dl dt').evaluateAll(labels => labels.filter(label => label.textContent === 'Win chance').map(label => label.getBoundingClientRect().top))
    assert.equal(probabilityTops.length, 2)
    assert.ok(Math.abs(probabilityTops[0] - probabilityTops[1]) < 1, 'Side-by-side win chances align despite different team-name lengths')
    await health(page, width, 'team')
    await page.screenshot({ path: path.join(output, `team-${width}.png`) })
    await hero(page).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, `featured-${width}.png`) })
    const controlSizes = await hero(page).locator('a').evaluateAll(links => links.map(a => ({ name: a.textContent.trim(), height: a.getBoundingClientRect().height })))
    assert.ok(controlSizes.every(c => c.height >= 44), 'Featured links retain 44px targets')
    const match = hero(page).getByRole('link', { name: 'Explore matchup →', exact: true })
    await match.focus(); await page.keyboard.press('Enter'); await page.waitForURL(gameUrl)
    await gameReady(page)
    await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.waitForURL(teamUrl)
    await teamReady(page)
    await verifyHero(page, game)
    await hero(page).getByRole('link', { name: `View ${opponentName} team`, exact: true }).click()
    await page.waitForURL(`${base}/teams/${opponent}`)
    await page.getByRole('heading', { level: 1, name: opponentName, exact: true }).waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.waitForURL(teamUrl)
    await teamReady(page)
    await hero(page).getByRole('link', { name: 'Player reports →', exact: true }).click()
    await page.waitForURL(`${gameUrl}#players`)
    await page.getByRole('region', { name: 'Players in this matchup', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.waitForURL(teamUrl)
    await teamReady(page)
    const scheduleLink = hero(page).getByRole('link', { name: 'Published schedule ↓', exact: true })
    await scheduleLink.focus(); await page.keyboard.press('Enter')
    await page.waitForURL(`${teamUrl}#team-schedule`)
    const schedule = page.getByRole('region', { name: `${publication.season} schedule`, exact: true })
    assert.equal(await schedule.evaluate(el => document.activeElement === el), true, 'Schedule link transfers keyboard focus')
    const dates = await schedule.locator('time').allTextContents()
    assert.equal(dates.length, fixtures.length)
    assert.ok(dates.every(d => d.includes('ET')))
    assert.equal(await schedule.locator('time').first().isVisible(), true)
    assert.ok((await schedule.locator('a').first().innerText()).includes(`${team} win`))
    for (let cycle = 0; cycle < 2; cycle++) {
      await schedule.locator(`a[href="/games/${fixtures[1].game_id}"]`).click()
      await page.waitForURL(`${base}/games/${fixtures[1].game_id}`)
      await gameReady(page)
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await page.waitForURL(`${teamUrl}#team-schedule`)
      await teamReady(page)
      await schedule.locator('time').first().waitFor()
      assert.deepEqual(await schedule.locator('time').allTextContents(), dates)
    }
    const records = page.getByRole('region', { name: 'Season by season record', exact: true })
    await records.focus()
    assert.equal(await records.evaluate(el => document.activeElement === el), true)
    if (width < 768) {
      await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150)
      assert.ok(await records.evaluate(el => el.scrollLeft > 0), 'Historical record remains keyboard-scrollable')
    }
    await schedule.evaluate(el => el.scrollIntoView({ block: 'start' }))
    await health(page, width, 'schedule-return')
    await page.screenshot({ path: path.join(output, `schedule-${width}.png`) })
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(page.url(), `${teamUrl}#team-schedule`)
    await verifyHero(page, game)
    // A later clock never invents settlement or picks a different retained game.
    const before = await hero(page).innerText()
    await page.clock.setFixedTime(new Date('2030-01-01T12:00:00Z'))
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await hero(page).innerText(), before)
    journeys.push({ width, team, game: game.game_id, controls: controlSizes, probabilityRowsAligned: true, keyboardMatchup: true, opponentReturn: true, playerReportsReturn: true, scheduleFocus: true, repeatedReturnCycles: 2, hashReload: true, publishedCardUnchangedByLaterClock: true })
    await c.close()
    console.log(`Team matchup ${width}px: parity, keyboard, opponent/player return and repeated schedule flows passed`)
  }

  const neutral = publication.games.find(g => g.neutral_site)
  if (neutral) {
    const c = await context(390), p = await c.newPage()
    await p.goto(`${base}/teams/${neutral.home}`, { waitUntil: 'networkidle' })
    const first = publication.games.filter(g => [g.home,g.away].includes(neutral.home)).sort((a,b) => a.date_utc.localeCompare(b.date_utc))[0]
    await verifyHero(p, first)
    if (first.neutral_site) assert.match(await hero(p).innerText(), /home\/away are the published designations/)
    await health(p, 390, 'neutral-team')
    await p.screenshot({ path: path.join(output, 'neutral-390.png') }); await c.close()
  }

  const direct = await context(390, { javaScriptEnabled: false }), nojs = await direct.newPage()
  await nojs.goto(teamUrl); await verifyHero(nojs, game)
  await hero(nojs).getByRole('link', { name: 'Published schedule ↓', exact: true }).click()
  await nojs.waitForURL(`${teamUrl}#team-schedule`)
  assert.equal(await nojs.locator('#team-schedule time').first().isVisible(), true)
  await hero(nojs).getByRole('link', { name: `View ${opponentName} team`, exact: true }).click()
  await nojs.getByRole('heading', { name: opponentName, exact: true, level: 1 }).waitFor()
  await direct.close()

  // The inherited game loading boundary needs JS to reveal streamed content.
  // Verify the fresh-tab canonical parent in a separate hydrated context.
  const fresh = await context(390), shared = await fresh.newPage()
  await shared.goto(gameUrl, { waitUntil: 'networkidle' })
  await gameReady(shared)
  await shared.getByRole('link', { name: `Week ${game.week} slate`, exact: true }).click()
  await shared.waitForURL(`${base}/games?week=${game.week}`)
  await shared.locator('[data-ready="true"]').waitFor()
  await fresh.close()

  const interrupted = await context(390), p = await interrupted.newPage()
  let release, held = 0, observed
  const barrier = new Promise(r => { release = r }), seen = new Promise(r => { observed = r })
  await interrupted.route(url => url.pathname === `/games/${game.game_id}` && url.searchParams.has('_rsc'), async route => {
    held++; observed(); await barrier; await route.continue().catch(() => {})
  })
  await p.goto(teamUrl, { waitUntil: 'domcontentloaded' })
  await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(new Error('No held matchup RSC request observed')), 10000))])
  await p.getByRole('button', { name: /^follow$/i, exact: true }).click()
  await p.getByRole('button', { name: /^following$/i, exact: true }).waitFor()
  await hero(p).getByRole('link', { name: 'Explore matchup →', exact: true }).click({ noWaitAfter: true })
  await p.getByRole('link', { name: /^Games$/i, exact: true }).click({ noWaitAfter: true })
  await p.waitForURL(`${base}/games`); await p.locator('[data-ready="true"]').waitFor()
  release(); await p.waitForTimeout(500)
  assert.equal(p.url(), `${base}/games`, 'An older response cannot replace the interrupted destination')
  await p.goto(teamUrl, { waitUntil: 'networkidle' })
  await hero(p).getByRole('link', { name: 'Explore matchup →', exact: true }).click(); await p.waitForURL(gameUrl)
  await gameReady(p)
  await p.getByRole('button', { name: 'Back', exact: true }).click(); await p.waitForURL(teamUrl)
  await teamReady(p)
  await verifyHero(p, game)
  const interruption = { heldRscRequests: held, cancelledFor: '/games', olderResponseDidNotReplaceDestination: true, retryAndReturnPassed: true }
  await interrupted.close()
  assert.deepEqual(errors, [])
  assert.equal(blocked.filter(url => /\/headshots\//.test(url)).length, 0)
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, generated_at: new Date().toISOString(), browser: browser.version(), publication: publication.generated_at, resultsThrough: publication.trained_through, clock: 'current (plus explicit 2030 stability probe)', sourceMode: 'Committed artifacts; ESPN images blocked; server fixture mode recorded separately', checks, journeys, interruption, noJavaScript: { teamCard: true, scheduleAnchor: true, opponentTeam: true, matchupDetail: 'Inherited game streaming needs JavaScript; no no-JS detail claim' }, freshTabCanonicalParent: true, blockedRequests: blocked.length, errors }, null, 2) + '\n')
  console.log(JSON.stringify({ passed: true, checks: checks.length, output, interruption }))
} finally {
  await browser.close()
}
