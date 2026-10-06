/** Production week/detail audit using committed forecasts and controlled logo responses. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(path.join(process.env.BROWSER_TEST_MODULE_ROOT || process.cwd(), 'package.json'))
const { chromium } = require('playwright')
const axePath = require.resolve('axe-core/axe.min.js')
const base = process.env.BASE_URL || 'http://127.0.0.1:3012'
const output = process.env.WEEK_AUDIT_OUTPUT || '/tmp/nfl-week-browser-audit'
const forecast = JSON.parse(await fs.readFile('backend/data/predictions/game_forecasts.json', 'utf8'))
const weeks = [...new Set(forecast.games.map(game => game.week))].sort((a, b) => a - b)
assert.ok(weeks.length > 1, 'Need at least two published weeks')
const game = forecast.games.find(game => game.week === weeks[0])
const gameUrl = `${base}/games/${game.game_id}`
const slateUrl = `${base}/games?week=${game.week}&team=${game.away}`
const logoPattern = '**/a.espncdn.com/**'
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
  ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) })
const context = await browser.newContext({ reducedMotion: 'reduce' })
// Deliberate CDN outage: the slate and header must remain identifiable.
await context.route(logoPattern, route => route.abort())
const page = await context.newPage()
page.setDefaultTimeout(30000)
const errors = []
const checks = []
let missingGameStatus
page.on('pageerror', error => errors.push(error.message))
const slate = page.getByRole('region', { name: 'Weekly slate', exact: true })
const ready = () => page.locator('[data-ready="true"]').waitFor()
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth)

async function auditViewport(width, name) {
  await page.setViewportSize({ width, height: 900 })
  await page.addScriptTag({ path: axePath })
  const result = await page.evaluate(async () => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    axe: (await window.axe.run('#main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }))
      .violations.map(violation => ({ id: violation.id, targets: violation.nodes.map(node => node.target) })),
    overlay: !!document.querySelector('[data-nextjs-dialog]'),
  }))
  assert.equal(result.overflow, false, `${name} overflow at ${width}px`)
  assert.deepEqual(result.axe, [], `${name} accessibility at ${width}px`)
  assert.equal(result.overlay, false)
  await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true })
  checks.push({ page: name, width, ...result })
}

try {
  assert.equal((await page.goto(slateUrl)).status(), 200)
  await ready()
  assert.equal(await slate.getByRole('combobox', { name: 'Select week', exact: true }).inputValue(), String(game.week))
  assert.equal(await slate.getByRole('combobox', { name: 'Filter by team', exact: true }).inputValue(), game.away)
  assert.equal(await slate.locator(`a[href="/games/${game.game_id}"]`).count(), 1)
  const stamp = new Date(forecast.generated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
  assert.match(await page.locator('#main').innerText(), /Pre-game snapshots|pre-game snapshots/)
  assert.ok((await page.locator('#main').innerText()).includes(stamp))
  const mark = slate.getByRole('img', { name: game.away_name, exact: true }).first()
  await page.waitForFunction(name => document.querySelector(`[role="img"][aria-label="${name}"]`)?.dataset.logoState === 'failed', game.away_name)
  assert.equal(await mark.innerText(), game.away)
  assert.equal(await mark.locator('img').count(), 0, 'Broken image must be removed')

  const week = slate.getByRole('combobox', { name: 'Select week', exact: true })
  await week.selectOption(String(weeks.at(-1)))
  assert.equal(await slate.getByRole('button', { name: 'Next week →', exact: true }).isDisabled(), true)
  await slate.getByRole('button', { name: '← Previous week', exact: true }).click()
  assert.equal(await week.inputValue(), String(weeks.at(-2)))
  await page.goBack()
  assert.equal(await week.inputValue(), String(weeks.at(-1)), 'Back restores a week selection')
  await page.goForward()
  assert.equal(await week.inputValue(), String(weeks.at(-2)), 'Forward restores a week selection')
  await page.goto(slateUrl)
  await ready()
  assert.equal(await slate.getByRole('button', { name: '← Previous week', exact: true }).isDisabled(), true)

  await slate.locator(`a[href="/games/${game.game_id}"]`).focus()
  await page.keyboard.press('Enter')
  await page.waitForURL(`**/games/${game.game_id}`)
  await page.getByRole('heading', { level: 1 }).waitFor()
  assert.ok((await page.getByRole('heading', { level: 1 }).textContent()).includes(game.away_name))
  assert.ok((await page.getByRole('heading', { level: 1 }).textContent()).includes(game.home_name))
  await page.waitForFunction(() => document.querySelectorAll('h1 [data-logo-state="failed"]').length === 2)
  for (const [code, name] of [[game.away, game.away_name], [game.home, game.home_name]]) {
    assert.equal(await page.getByRole('heading', { level: 1 }).getByRole('img', { name, exact: true }).innerText(), code)
  }
  await page.getByRole('navigation', { name: 'Game sections', exact: true }).getByRole('link', { name: 'Availability', exact: true }).click()
  assert.equal(await page.evaluate(() => document.activeElement.id), 'availability')
  const availability = await page.locator('#availability').innerText()
  if (process.env.WEEK_AUDIT_EXPECT_UNAVAILABLE === '1') assert.match(availability, /unavailable/i)
  const slider = page.getByRole('slider').first()
  const before = await slider.inputValue()
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  assert.notEqual(await slider.inputValue(), before, 'Keyboard slider changes the published line')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.waitForURL(slateUrl)
  await ready()
  assert.equal(await week.inputValue(), String(game.week))
  assert.equal(await slate.getByRole('combobox', { name: 'Filter by team', exact: true }).inputValue(), game.away)

  await slate.getByRole('checkbox', { name: 'Following only (0)', exact: true }).check()
  await slate.getByRole('heading', { name: 'No games match these filters', exact: true }).waitFor()
  await slate.getByRole('button', { name: 'Show the whole week', exact: true }).click()
  assert.equal(await slate.getByRole('combobox', { name: 'Filter by team', exact: true }).inputValue(), '')
  assert.equal(await slate.getByRole('checkbox').isChecked(), false)
  assert.equal(await slate.locator('li').count(), forecast.games.filter(row => row.week === game.week).length)
  console.log('Week selection, keyboard matchup/return, header outage and empty-filter recovery passed')

  for (const width of [320, 390, 768, 1440]) {
    await page.goto(`${base}/games?week=${game.week}`)
    await ready()
    await auditViewport(width, 'week')
    await page.goto(gameUrl)
    await page.waitForFunction(() => document.querySelectorAll('h1 [data-logo-state="failed"]').length === 2)
    await auditViewport(width, 'game')
    console.log(`Week and game at ${width}px: zero axe violations and no overflow`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/games?week=4evil&team=NOT-A-TEAM`)
  await ready()
  assert.ok(weeks.includes(Number(await week.inputValue())))
  assert.equal(await slate.getByRole('combobox', { name: 'Filter by team', exact: true }).inputValue(), '')
  await slate.getByRole('combobox', { name: 'Season or results archive', exact: true }).selectOption('2025')
  await page.waitForURL('**/seasons/2025/games')
  assert.ok((await page.getByRole('heading', { level: 1 }).innerText()).includes('2025'))
  assert.equal(await overflow(), false)
  missingGameStatus = (await page.goto(`${base}/games/no-such-published-game`)).status()
  // Next can send 200 once its loading boundary has started streaming.
  assert.ok([200, 404].includes(missingGameStatus))
  await page.getByRole('heading', { name: 'No such page', exact: true }).waitFor()
  const robots = await page.locator('meta[name="robots"]').evaluateAll(nodes => nodes.map(node => node.content))
  assert.ok(robots.length > 0)
  for (const content of robots) assert.match(content, /noindex/)
  assert.equal(await overflow(), false)
  await page.screenshot({ path: path.join(output, 'missing-game-390.png'), fullPage: true })

  // Fresh tabs retain the canonical parent. The static slate also keeps text marks without JS.
  const directContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await directContext.route(logoPattern, route => route.abort())
  const directPage = await directContext.newPage()
  directPage.on('pageerror', error => errors.push(error.message))
  await directPage.goto(gameUrl)
  assert.equal(await directPage.getByRole('link', { name: new RegExp(`^Week ${game.week} slate$`, 'i') }).getAttribute('href'), `/games?week=${game.week}`)
  await directContext.close()
  const staticContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
  const staticPage = await staticContext.newPage()
  await staticContext.route(logoPattern, route => route.abort())
  await staticPage.goto(`${base}/games`)
  const staticMark = staticPage.getByRole('region', { name: 'Weekly slate', exact: true }).getByRole('img').first()
  assert.equal(await staticMark.isVisible(), true)
  assert.match(await staticMark.innerText(), /^[A-Z]{2,3}$/)
  await staticContext.close()

  // A controlled valid PNG tests decoding/loading/cached hydration, not ESPN availability.
  const loadedContext = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } })
  const loadedPage = await loadedContext.newPage()
  loadedPage.on('pageerror', error => errors.push(error.message))
  let release
  const pending = new Promise(resolve => { release = resolve })
  const png = await fs.readFile('public/favicon-16.png')
  await loadedContext.route(logoPattern, async route => {
    await pending
    await route.fulfill({ status: 200, contentType: 'image/png', body: png })
  })
  await loadedPage.goto(gameUrl, { waitUntil: 'domcontentloaded' })
  const loadingMark = loadedPage.getByRole('heading', { level: 1 }).getByRole('img', { name: game.home_name, exact: true })
  assert.equal(await loadingMark.innerText(), game.home)
  assert.equal(await loadingMark.getAttribute('data-logo-state'), 'loading')
  await loadedPage.screenshot({ path: path.join(output, 'logo-loading-390.png') })
  release()
  await loadedPage.waitForFunction(() => document.querySelectorAll('h1 [data-logo-state="loaded"]').length === 2)
  assert.equal(await loadingMark.innerText(), '')
  assert.equal(await loadingMark.locator('img').getAttribute('alt'), '')
  await loadedPage.reload()
  await loadedPage.waitForFunction(() => document.querySelectorAll('h1 [data-logo-state="loaded"]').length === 2)
  await loadedContext.close()
  assert.deepEqual(errors, [])
  const result = { passed: true, checked_at: new Date().toISOString(), browser: browser.version(),
    forecast_generated_at: forecast.generated_at, trained_through: forecast.trained_through, game_id: game.game_id,
    clock: 'current (no clock override)', logo_outage: 'all ESPN CDN requests aborted',
    no_js: 'Static slate retains text marks; interactive filters require JavaScript',
    logo_success: 'controlled bundled favicon PNG; ESPN availability not verified', availability, missing_game_status: missingGameStatus, checks, errors,
    flows: ['week bounds and Back/Forward', 'team URL restoration', 'keyboard matchup entry and return',
      'section focus', 'keyboard spread slider', 'empty watchlist/reset', 'invalid query recovery',
      '2025 archive on mobile', 'missing-game error with noindex', 'no-JS slate marks and fresh-tab return', 'logo loading/failure/success/reload'] }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ passed: true, viewports: [320, 390, 768, 1440], game: game.game_id, output }))
} catch (error) {
  console.error(error)
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
  await fs.writeFile(path.join(output, 'failure.txt'), String(error) + '\n' + await page.locator('body').innerText().catch(() => ''))
  throw error
} finally {
  await browser.close()
}
