/** Production browser check. Fixture mode requires the explicit local fetch preloader. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(path.join(process.env.BROWSER_TEST_MODULE_ROOT || process.cwd(), 'package.json'))
const { chromium } = require('playwright')
const axePath = require.resolve('axe-core/axe.min.js')
const forecast = JSON.parse(await fs.readFile('backend/data/predictions/game_forecasts.json', 'utf8'))
const fixture = JSON.parse(await fs.readFile('scripts/fixtures/espn-player-summary.json', 'utf8'))
const game = forecast.games.find(game => game.game_id === fixture.header.id) ?? forecast.games[0]
const otherGame = forecast.games.find(row => row.game_id !== game.game_id)
const base = process.env.BASE_URL || 'http://127.0.0.1:3012'
const output = process.env.PLAYER_AUDIT_OUTPUT || '/tmp/nfl-player-profile-audit'
const controlled = process.env.PLAYER_AUDIT_EXPECT_FIXTURE === '1'
const fixtureAthlete = fixture.leaders[0].leaders[0].leaders[0].athlete
await fs.mkdir(output, { recursive: true })
await fs.rm(path.join(output, 'results.json'), { force: true })
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
  ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) })
const errors = []
const portraitRequests = []
const checks = []
const journeys = []
let loadingObserved = false
let teamJourney
async function context(width) {
  const c = await browser.newContext({ reducedMotion: 'reduce', viewport: { width, height: 900 } })
  await c.addInitScript(team => { try { localStorage.setItem('gridiron:watchlist:v1', JSON.stringify([team])) } catch { /* sandboxed audit frames have no storage */ } }, game.away)
  await c.route('**/a.espncdn.com/i/teamlogos/**', route => route.abort())
  c.on('page', page => {
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (/\/headshots\//.test(request.url())) portraitRequests.push(request.url()) })
  })
  return c
}
async function visual(page, width, name) {
  await page.addScriptTag({ path: axePath })
  const check = await page.evaluate(async () => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    axe: (await window.axe.run('#main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }))
      .violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })),
    overlay: !!document.querySelector('[data-nextjs-dialog]'),
  }))
  assert.equal(check.overflow, false)
  assert.deepEqual(check.axe, [])
  assert.equal(check.overlay, false)
  await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true })
  checks.push({ name, width, ...check })
}
async function waitProfile(page, name) {
  const populated = page.getByRole('heading', { level: 1, name, exact: true })
  await populated.or(page.getByRole('heading', { level: 1, name: 'Player profile unavailable', exact: true })).waitFor()
  const available = await populated.isVisible()
  if (controlled) assert.equal(available, true, 'Controlled response must populate the selected athlete')
  return available
}
try {
  for (const width of [320, 390, 768, 1440]) {
    const c = await context(width)
    const page = await c.newPage()
    await page.goto(`${base}/games`)
    await page.locator('[data-ready="true"]').waitFor()
    await page.getByRole('checkbox', { name: 'Following only (1)', exact: true }).waitFor()
    await page.getByRole('combobox', { name: 'Select week', exact: true }).selectOption(String(game.week))
    await page.getByRole('combobox', { name: 'Filter by team', exact: true }).selectOption(game.away)
    await page.getByRole('checkbox').check()
    const filteredUrl = page.url()
    const fixtureLinks = await page.getByRole('region', { name: 'Weekly slate', exact: true }).locator('li a').evaluateAll(links => links.map(a => a.getAttribute('href')))
    const match = page.locator(`[aria-label="Weekly slate"] a[href="/games/${game.game_id}"]`)
    await match.focus()
    await page.keyboard.press('Enter')
    await page.waitForURL(`**/games/${game.game_id}`)
    await page.getByRole('navigation', { name: 'Game sections', exact: true }).getByRole('link', { name: 'Players', exact: true }).click()
    assert.equal(await page.evaluate(() => document.activeElement.id), 'players')
    const players = page.getByRole('region', { name: 'Players in this matchup', exact: true })
    const links = players.getByRole('link', { name: /— player profile$/ })
    const populated = await links.count() > 0
    let profilePopulated = false
    if (controlled) assert.equal(populated, true, 'Captured-response fixture must produce a real ID profile')
    let profileUrl = `${base}/players/espn/${fixtureAthlete.id}?game=${game.game_id}`
    if (populated) {
      const link = links.first()
      profileUrl = new URL(await link.getAttribute('href'), base).href
      const name = (await link.getAttribute('aria-label')).replace(' — player profile', '')
      await link.focus()
      await page.keyboard.press('Enter')
      await page.waitForURL(profileUrl)
      profilePopulated = await waitProfile(page, name)
      if (profilePopulated) {
        await page.getByRole('img', { name: `${name}: portrait unavailable`, exact: true }).waitFor()
        assert.equal(await page.locator('img[src*="/headshots/"]').count(), 0)
        assert.match(await page.getByRole('region', { name: 'Source and coverage', exact: true }).innerText(), /no full roster or career totals/i)
      }
      await visual(page, width, profilePopulated ? 'player' : 'profile-unavailable')
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await page.waitForURL(`${base}/games/${game.game_id}#players`)
      await page.getByRole('region', { name: 'Players in this matchup', exact: true }).waitFor()
    } else {
      await players.getByRole('heading', { name: 'Player profiles unavailable', exact: true }).waitFor()
      await visual(page, width, 'players-unavailable')
    }
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForURL(filteredUrl)
    await page.locator('[data-ready="true"]').waitFor()
    assert.equal(await page.getByRole('combobox', { name: 'Select week', exact: true }).inputValue(), String(game.week))
    assert.equal(await page.getByRole('combobox', { name: 'Filter by team', exact: true }).inputValue(), game.away)
    assert.equal(await page.getByRole('checkbox').isChecked(), true)
    assert.deepEqual(await page.locator('[aria-label="Weekly slate"] li a').evaluateAll(links => links.map(a => a.getAttribute('href'))), fixtureLinks)
    journeys.push({ width, filteredUrl, profileUrl, populated, profilePopulated, keyboard: true, filtersAndFixturesRestored: true })
    await c.close()
    console.log(`Profile journey at ${width}px: ${populated ? 'populated response' : 'explicit unavailable state'}; return filters/fixtures passed`)
  }

  const c = await context(390)
  const page = await c.newPage()
  await page.goto(`${base}/teams/${game.home}`)
  const teamHeading = (await page.getByRole('heading', { level: 1 }).textContent()).trim()
  await page.getByRole('region', { name: 'Explore team players', exact: true }).getByRole('link').click()
  await page.waitForURL(/\/games\/\d+#players$/)
  await page.getByRole('region', { name: 'Players in this matchup', exact: true }).waitFor()
  const teamMatchUrl = page.url()
  const teamPlayers = page.getByRole('region', { name: 'Players in this matchup', exact: true }).getByRole('link', { name: /— player profile$/ })
  if (controlled) assert.ok(await teamPlayers.count() > 0)
  const teamPlayerOpened = await teamPlayers.count() > 0
  let teamProfilePopulated = false
  if (teamPlayerOpened) {
    const name = (await teamPlayers.first().getAttribute('aria-label')).replace(' — player profile', '')
    await teamPlayers.first().click()
    await page.waitForURL('**/players/espn/*?game=*')
    teamProfilePopulated = await waitProfile(page, name)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForURL(teamMatchUrl)
    await page.getByRole('region', { name: 'Players in this matchup', exact: true }).waitFor()
  }
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.waitForURL(`${base}/teams/${game.home}`)
  await page.getByRole('heading', { level: 1, name: teamHeading, exact: true }).waitFor()
  assert.equal((await page.getByRole('heading', { level: 1 }).textContent()).trim(), teamHeading)
  teamJourney = { team: game.home, teamMatchUrl, teamPlayerOpened, teamProfilePopulated, returnedToTeam: true }
  await c.close()

  const direct = await context(390)
  const directPage = await direct.newPage()
  await directPage.goto(`${base}/players/espn/${fixtureAthlete.id}?game=${game.game_id}`)
  assert.equal(await directPage.getByRole('link', { name: `${game.away} at ${game.home} players`, exact: true }).first().getAttribute('href'), `/games/${game.game_id}#players`)
  await directPage.goto(`${base}/players/espn/${fixtureAthlete.id}`)
  await directPage.getByRole('heading', { name: 'Player profile unavailable', exact: true }).waitFor()
  await visual(directPage, 390, 'profile-no-context')
  await directPage.goto(`${base}/players/espn/999999999?game=${game.game_id}`)
  await directPage.getByRole('heading', { name: 'Player profile unavailable', exact: true }).waitFor()
  if (controlled) assert.match(await directPage.locator('#main').innerText(), /not in the selected leaders/)
  await directPage.goto(`${base}/players/espn/${fixtureAthlete.id}?game=999999999`)
  await directPage.getByRole('heading', { name: 'Player profile unavailable', exact: true }).waitFor()
  await directPage.goto(`${base}/players/espn/name-slug?game=${game.game_id}`)
  await directPage.getByRole('heading', { name: 'No such page', exact: true }).waitFor()
  await directPage.goto(`${base}/players/other/${fixtureAthlete.id}?game=${game.game_id}`)
  await directPage.getByRole('heading', { name: 'No such page', exact: true }).waitFor()
  if (controlled) {
    const injury = fixture.injuries[0].injuries[0]
    await directPage.goto(`${base}/players/espn/${injury.athlete.id}?game=${game.game_id}`)
    await directPage.getByRole('heading', { name: injury.athlete.displayName, level: 1, exact: true }).waitFor()
    const availability = await directPage.getByRole('region', { name: 'Reported availability', exact: true }).innerText()
    assert.ok(availability.includes(injury.status))
    const reportDate = new Date(injury.date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
    assert.ok(availability.includes(reportDate))
    assert.match(await directPage.getByRole('region', { name: 'Game statistics', exact: true }).innerText(), /No leader statistics/)
    await visual(directPage, 390, 'profile-injury')
    await directPage.goto(`${base}/players/espn/${fixtureAthlete.id}?game=${otherGame.game_id}`, { waitUntil: process.env.PLAYER_AUDIT_SLOW_EVENT ? 'commit' : 'load' })
    if (process.env.PLAYER_AUDIT_SLOW_EVENT) {
      await directPage.getByRole('status', { name: 'Loading player profile', exact: true }).waitFor()
      loadingObserved = true
      await directPage.screenshot({ path: path.join(output, 'profile-loading-390.png') })
    }
    await directPage.getByRole('heading', { name: 'Player profile unavailable', exact: true }).waitFor()
    assert.match(await directPage.locator('#main').innerText(), /summary could not be read/)
    await visual(directPage, 390, 'profile-source-outage')
  }
  await direct.close()
  assert.deepEqual(errors, [])
  assert.deepEqual(portraitRequests, [], 'No unverified athlete image is requested')
  const result = { passed: true, checked_at: new Date().toISOString(), browser: browser.version(),
    source_mode: controlled ? 'Subset of captured ESPN response for one existing event; other ESPN server requests return controlled 503' : 'Application responses; populated coverage is conditional',
    fixture_event: game.game_id, forecast_generated_at: forecast.generated_at, summary_as_of: controlled ? fixture.meta.lastUpdatedAt : 'read from actual responses',
    portrait_policy: 'No permitted athlete assets; initials/number fallback; no portrait requests', portraitRequests, loadingObserved, checks, journeys, teamJourney, errors,
    flows: ['keyboard filtered slate→game→player→Back→filtered slate', 'team→game→player→Back→team', 'fresh-tab canonical matchup parent',
      'no context/unknown player/unknown event unavailable states', 'invalid provider and name-slug recovery', ...(controlled ? ['injury-only profile with separate report date and absent statistics', 'source outage recovery'] : [])] }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n')
} catch (error) {
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: false, checked_at: new Date().toISOString(), error: String(error), errors, checks, journeys }, null, 2) + '\n')
  throw error
} finally { await browser.close() }
