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
const archiveFixture = JSON.parse(await fs.readFile('scripts/fixtures/espn-archived-summary.json', 'utf8'))
const meetingIndex = JSON.parse(await fs.readFile('backend/data/predictions/game_context.json', 'utf8'))
const archiveGame = Object.values(meetingIndex.meetings).flat().find(row => row.game_id === archiveFixture.header.id)
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
const archiveChecks = []
let loadingObserved = false
let teamJourney
let delayedNavigation
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

async function archiveRegression() {
  assert.ok(archiveGame, 'Archive QA must use an already-published event')
  const athlete = archiveFixture.leaders[0].leaders[0].leaders[0].athlete
  const date = new Date(`${archiveGame.date}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
  for (const width of [390, 1440]) {
    const c = await context(width)
    const page = await c.newPage()
    await page.goto(`${base}/games/${archiveGame.game_id}#players`)
    const players = page.getByRole('region', { name: 'Players in this matchup', exact: true })
    await players.getByRole('link', { name: `${athlete.displayName} — player profile`, exact: true }).click()
    await page.waitForURL(`**/players/espn/${athlete.id}?game=${archiveGame.game_id}`)
    await waitProfile(page, athlete.displayName)
    const matchup = await page.getByRole('region', { name: 'Matchup context', exact: true }).innerText()
    assert.ok(matchup.includes(`${date} · Kickoff time unavailable`), matchup)
    assert.doesNotMatch(matchup, /\d{1,2}:\d{2}\s*(AM|PM)|\bET\b/, 'A date-only archive cannot supply a kickoff time')
    const availability = await page.getByRole('region', { name: 'Reported availability', exact: true }).innerText()
    assert.match(availability, /Availability is unknown/)
    assert.ok(!availability.includes('Controlled current report'), 'Current injury reports stay out of archived profiles')
    await page.locator(`a[href="/teams/${archiveGame.home}"]`).waitFor()
    const coverage = await page.getByRole('region', { name: 'Source and coverage', exact: true }).innerText()
    assert.match(coverage, /Summary update\s+Not supplied/i)
    await visual(page, width, 'profile-archive')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForURL(`${base}/games/${archiveGame.game_id}#players`)
    await players.waitFor()
    archiveChecks.push({ width, game: archiveGame.game_id, publishedDate: archiveGame.date, matchup,
      sourceMode: 'Synthetic OAK response with ESPN franchise ID 13; actual historical response not inspected',
      canonicalTeam: archiveGame.home, kickoffUnavailable: true, currentReportsOmitted: true, returnedToArchive: true })
    await c.close()
  }
}

async function delayedResponseRegression() {
  const c = await context(390)
  const page = await c.newPage()
  const injury = fixture.injuries[0].injuries[0]
  let releaseOlder
  let signalOlder
  const olderReady = new Promise(resolve => { signalOlder = resolve })
  const released = new Promise(resolve => { releaseOlder = resolve })
  const pending = []
  const deliveries = []
  await page.route(`**/players/espn/${fixtureAthlete.id}?*`, async route => {
    if (route.request().headers()['next-router-prefetch'] === '1') return route.abort()
    let finish
    pending.push(new Promise(resolve => { finish = resolve }))
    try {
      const response = await route.fetch()
      const body = await response.text()
      assert.ok(body.includes(fixtureAthlete.displayName), 'Older response contains the older athlete identity')
      signalOlder()
      await released
      await route.fulfill({ response, body })
      deliveries.push('released after newer profile')
    } catch (error) {
      deliveries.push(`cancelled by navigation: ${String(error)}`)
    } finally { finish() }
  })
  try {
    await page.goto(`${base}/games/${game.game_id}#players`)
    await page.getByRole('link', { name: `${fixtureAthlete.displayName} — player profile`, exact: true }).click()
    let timer
    try {
      await Promise.race([olderReady, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Older profile request was not held')), 15000) })])
    } finally { clearTimeout(timer) }
    // Navigate through the persistent app link while the older response is held.
    await page.locator('nav a[href="/games"]:visible').click()
    await page.locator('[data-ready="true"]').waitFor()
    await page.getByRole('combobox', { name: 'Select week', exact: true }).selectOption(String(game.week))
    await page.getByRole('combobox', { name: 'Filter by team', exact: true }).selectOption(game.away)
    await page.locator(`[aria-label="Weekly slate"] a[href="/games/${game.game_id}"]`).click()
    await page.getByRole('region', { name: 'Players in this matchup', exact: true }).getByRole('link', {
      name: `${injury.athlete.displayName} — player profile`, exact: true,
    }).click()
    const newerUrl = `${base}/players/espn/${injury.athlete.id}?game=${game.game_id}`
    await page.waitForURL(newerUrl)
    await waitProfile(page, injury.athlete.displayName)
    releaseOlder()
    await Promise.all(pending)
    await page.waitForTimeout(500)
    assert.equal(page.url(), newerUrl)
    assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), injury.athlete.displayName)
    assert.ok(!(await page.locator('#main').innerText()).includes(fixtureAthlete.displayName))
    assert.match(await page.getByRole('region', { name: 'Reported availability', exact: true }).innerText(), new RegExp(injury.status))
    await visual(page, 390, 'profile-newer-navigation')
    delayedNavigation = { olderIdentity: fixtureAthlete.id, newerIdentity: injury.athlete.id,
      olderResponseHeld: true, olderReleasedAfterNewerProfile: true, deliveries, newerUrl, newerIdentityStable: true }
  } finally {
    releaseOlder()
    await c.close()
  }
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
    await archiveRegression()
    await delayedResponseRegression()
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
    source_mode: controlled ? 'Captured ESPN subset for one event plus explicitly synthetic OAK archive QA; other ESPN server requests return controlled 503' : 'Application responses; populated coverage is conditional',
    fixture_event: game.game_id, forecast_generated_at: forecast.generated_at, summary_as_of: controlled ? fixture.meta.lastUpdatedAt : 'read from actual responses',
    portrait_policy: 'No permitted athlete assets; initials/number fallback; no portrait requests', portraitRequests, loadingObserved, checks, journeys, teamJourney, archiveChecks, delayedNavigation, errors,
    flows: ['keyboard filtered slate→game→player→Back→filtered slate', 'team→game→player→Back→team', 'fresh-tab canonical matchup parent',
      'no context/unknown player/unknown event unavailable states', 'invalid provider and name-slug recovery', ...(controlled ? ['archived date-only profile and stable-ID OAK/LV context', 'older profile response cannot overwrite newer navigation', 'injury-only profile with separate report date and absent statistics', 'source outage recovery'] : [])] }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n')
} catch (error) {
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: false, checked_at: new Date().toISOString(), error: String(error), errors, checks, journeys }, null, 2) + '\n')
  throw error
} finally { await browser.close() }
