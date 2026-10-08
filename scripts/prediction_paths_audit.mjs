/** Actual Chromium QA against committed probabilities; no provider refresh or new fitted model. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(path.join(process.env.BROWSER_TEST_MODULE_ROOT || process.cwd(), 'package.json'))
const { chromium } = require('playwright')
const axePath = require.resolve('axe-core/axe.min.js')
const forecast = JSON.parse(await fs.readFile('backend/data/predictions/game_forecasts.json', 'utf8'))
const log = JSON.parse(await fs.readFile('backend/data/predictions/forecast_log.json', 'utf8'))
const base = process.env.BASE_URL || 'http://127.0.0.1:3012'
const output = process.env.PATHS_AUDIT_OUTPUT || '/tmp/nfl-prediction-paths-audit'
const auditNow = process.env.AUDIT_USE_PUBLICATION_TIME === '1' ? Date.parse(forecast.generated_at) : Date.now()
const games = forecast.games.filter(g => Date.parse(g.date_utc) > auditNow)
const game = games[0], other = games[1]
assert.ok(game && other, 'Need two published future fixtures')
await fs.mkdir(output, { recursive: true })
await fs.rm(path.join(output, 'results.json'), { force: true })
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
  ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) })
const errors = [], requests = [], checks = [], journeys = []
const percentage = p => `${(p * 100).toFixed(1)}%`
async function newPage(width) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'] })
  await context.route(/https:\/\/[^/]*(espn\.com|espncdn\.com)\//, route => route.abort())
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  if (process.env.AUDIT_USE_PUBLICATION_TIME === '1') await page.clock.install({ time: new Date(auditNow) })
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => requests.push({ url: request.url(), prefetch: request.headers()['next-router-prefetch'] === '1' }))
  return { context, page }
}
const board = page => page.getByRole('region', { name: 'Close-game paths', exact: true })
async function ready(page, g, band) {
  await page.waitForFunction(({ id, band }) => document.querySelector('[data-paths-game]')?.getAttribute('data-paths-game') === id &&
    document.querySelector('select[aria-label="Narrow winning margin"]')?.value === String(band), { id: g.game_id, band })
  // Independent source-cell sum checks orientation, included boundaries and headline conservation.
  for (const side of ['away', 'home']) {
    // Keep the actual numerical oracle explicit, rather than import the UI helper.
    const cells = g.margin_distribution.p.filter((_, i) => {
      const m = g.margin_distribution.low + i
      return side === 'home' ? m >= 1 && m <= band : m >= -band && m <= -1
    }).reduce((sum, p) => sum + p, 0)
    assert.equal(await page.getByTestId(`path-${side}-close`).innerText(), percentage(cells))
    assert.equal(await page.getByTestId(`path-${side}-wider`).innerText(), percentage(g[`p_${side}`] - cells))
  }
  assert.match(await board(page).innerText(), new RegExp(`${(g.p_tie * 100).toFixed(2)}%`))
}
async function audit(page, width, name, target = '#paths') {
  await page.locator(target).scrollIntoViewIfNeeded()
  await page.addScriptTag({ path: axePath })
  const result = await page.evaluate(async () => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    axe: (await window.axe.run('#main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }))
      .violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })),
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    enterDuration: getComputedStyle(document.querySelector('.page-enter')).animationDuration,
    overlay: !!document.querySelector('[data-nextjs-dialog]'),
  }))
  assert.equal(result.overflow, false, `${name} at ${width}px`)
  assert.deepEqual(result.axe, [], `${name} accessibility at ${width}px`)
  assert.equal(result.overlay, false)
  assert.equal(result.reducedMotion, true)
  assert.ok(result.enterDuration.split(',').every(d => (d.trim().endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000) <= .02))
  await page.locator(target).screenshot({ path: path.join(output, `${name}-${width}.png`) })
  checks.push({ name, width, ...result })
}
try {
  // Hold actual client bundles to capture the server-rendered pending state.
  const loading = await newPage(390)
  let release
  const hold = new Promise(resolve => { release = resolve })
  await loading.page.route('**/_next/static/**/*.js', async route => { await hold; await route.continue() })
  try {
    await loading.page.goto(`${base}/games/${game.game_id}#paths`, { waitUntil: 'commit' })
    await loading.page.getByRole('status', { name: 'Loading close-game paths', exact: true }).waitFor()
    const clip = await loading.page.locator('#paths').evaluate(el => {
      const r = el.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, scale: 1 }
    })
    const cdp = await loading.context.newCDPSession(loading.page)
    const frame = await cdp.send('Page.captureScreenshot', { captureBeyondViewport: true, clip })
    await fs.writeFile(path.join(output, 'paths-loading-390.png'), Buffer.from(frame.data, 'base64'))
    await cdp.detach()
  } finally { release() }
  await ready(loading.page, game, 8)
  await loading.context.close()
  for (const width of [320, 390, 768, 1440]) {
    const { context, page } = await newPage(width)
    await page.goto(`${base}/games?week=${game.week}&team=${game.away}`)
    await page.locator('[data-ready="true"]').waitFor()
    const entry = page.locator(`a[href="/games/${game.game_id}"]`).first()
    await entry.focus(); await page.keyboard.press('Enter')
    await ready(page, game, 8)
    const jump = page.getByRole('navigation', { name: 'Game sections', exact: true }).getByRole('link', { name: 'Close-game paths', exact: true })
    await jump.focus(); await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => document.activeElement.id), 'paths')
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Narrow winning margin')
    assert.ok(await page.getByRole('combobox', { name: 'Narrow winning margin' }).evaluate(el => parseFloat(getComputedStyle(el).outlineWidth) >= 2))
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter')
    await ready(page, game, 7)
    const rscBefore = requests.filter(r => r.url.includes('_rsc=') && !r.prefetch).length
    for (const band of [3, 8, 7, 3]) {
      await page.getByRole('combobox', { name: 'Narrow winning margin' }).selectOption(String(band))
      await ready(page, game, band)
      assert.equal(new URL(page.url()).searchParams.get('marginBand'), String(band))
    }
    assert.equal(requests.filter(r => r.url.includes('_rsc=') && !r.prefetch).length, rscBefore, 'Band lookup must not refetch a source or navigate a server component')
    await audit(page, width, 'paths-game')
    await page.locator(`a[href="/teams/${game.home}"]`).first().click()
    await page.waitForURL(`**/teams/${game.home}`)
    await page.getByRole('button', { name: /Back/ }).first().click()
    await ready(page, game, 3)
    await page.getByRole('button', { name: /Back/ }).first().click()
    await page.waitForURL(`**/games?week=${game.week}&team=${game.away}`)
    await page.locator('[data-ready="true"]').waitFor()
    assert.equal(await page.getByRole('combobox', { name: 'Select week', exact: true }).inputValue(), String(game.week))
    await page.goto(`${base}/lab?game=${game.game_id}&marginBand=3#paths`)
    await ready(page, game, 3)
    assert.equal(await page.getByTestId('home-probability').innerText(), percentage(game.p_home))
    await page.getByRole('combobox', { name: 'Narrow winning margin' }).selectOption('7')
    await ready(page, game, 7)
    await page.getByRole('button', { name: 'Share game', exact: true }).click()
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${base}/lab?game=${game.game_id}&marginBand=7#paths`)
    const second = page.locator('.lab-fixture').nth(1)
    await second.click(); await ready(page, other, 7)
    await page.goBack(); await ready(page, game, 7)
    await board(page).getByRole('link', { name: 'Read the published-ahead record →', exact: true }).click()
    await page.waitForURL('**/accuracy#published-record')
    const record = page.getByRole('region', { name: 'Published forecast record', exact: true })
    assert.match(await record.innerText(), new RegExp(String(log.n)))
    assert.match(await record.innerText(), /small live sample is separate from the historical backtest/)
    if (width === 320) {
      const scoreTable = page.getByRole('region', { name: 'Historical forecast scorecards', exact: true })
      await scoreTable.focus(); await page.keyboard.press('ArrowRight')
      await page.waitForFunction(() => document.querySelector('[aria-label="Historical forecast scorecards"]').scrollLeft > 0)
      await audit(page, width, 'paths-record', '#published-record')
    }
    await page.goBack(); await ready(page, game, 7)
    if (width === 390) {
      const response = await page.request.get(`${base}/api/forecast-lab`), data = await response.json()
      let releaseRefresh
      const refreshHold = new Promise(resolve => { releaseRefresh = resolve })
      await page.route('**/api/forecast-lab', async route => { await refreshHold; await route.fulfill({ status: 503, body: 'Controlled outage' }) })
      await page.getByRole('button', { name: 'Refresh forecasts', exact: true }).click()
      await page.getByRole('button', { name: 'Refreshing…', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Refreshing…', exact: true }).isDisabled(), true)
      await ready(page, game, 7); releaseRefresh()
      await page.getByText('Refresh unavailable. Your last loaded forecasts are still here.', { exact: true }).waitFor()
      await ready(page, game, 7)
      await audit(page, width, 'paths-refresh-outage')
      await page.unroute('**/api/forecast-lab')
      const contradictory = structuredClone(data)
      const g = contradictory.forecast.games.find(g => g.game_id === game.game_id)
      g.margin_distribution.p[-g.margin_distribution.low] += .001
      g.margin_distribution.outside -= .001
      await page.route('**/api/forecast-lab', route => route.fulfill({ json: contradictory }))
      await page.getByRole('button', { name: 'Refresh forecasts', exact: true }).click()
      await board(page).getByRole('heading', { name: 'Published margin data unavailable', exact: true }).waitFor()
      assert.equal(await board(page).locator('[data-testid]').count(), 0)
      await audit(page, width, 'paths-inconsistent-source')
      await page.unroute('**/api/forecast-lab')
      await page.getByRole('button', { name: 'Refresh forecasts', exact: true }).click()
      await page.getByText('Latest published forecasts loaded.', { exact: true }).waitFor(); await ready(page, game, 7)
      await page.getByRole('searchbox', { name: 'Search teams', exact: true }).fill('No matching franchise')
      await page.getByText('No games match these filters.', { exact: true }).waitFor()
      assert.equal(await board(page).count(), 0)
      await page.getByRole('button', { name: 'Reset filters', exact: true }).click(); await ready(page, game, 7)
    }
    await audit(page, width, 'paths-lab')
    await page.goto(`${base}/games/${game.game_id}?compare=sacks&marginBand=4#paths`)
    await ready(page, game, 8)
    await page.getByText('The requested margin band is unsupported. Showing 1–8 points.', { exact: true }).waitFor()
    await page.getByRole('combobox', { name: 'Narrow winning margin' }).selectOption('3')
    assert.equal(new URL(page.url()).searchParams.get('compare'), 'sacks')
    await page.goto(`${base}/games/401872966?marginBand=3#paths`)
    await board(page).getByText(/This snapshot has no pre-game forecast for this archived matchup/).waitFor()
    assert.equal(await board(page).locator('[data-testid]').count(), 0)
    if (width === 390) await audit(page, width, 'paths-archive-empty')
    journeys.push({ width, game: game.game_id, other: other.game_id, keyboard: true, share: true, repeatedBandLookup: true,
      matchupTeamBack: true, labFixtureBack: true, recordBack: true, slateFiltersBack: true, unsupportedBand: true, preservesCompare: true, archiveWithheld: true })
    await context.close()
    console.log(`Prediction paths: ${width}px journey passed`)
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(requests.filter(r => /\/headshots\//.test(r.url)), [])
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ generated_at: new Date().toISOString(),
    forecast_generated_at: forecast.generated_at, trained_through: forecast.trained_through, model: forecast.model_version,
    clock: process.env.AUDIT_USE_PUBLICATION_TIME === '1' ? 'publication' : 'current', loadingObserved: true,
    checks, journeys, errors, portraits: [], passed: true }, null, 2))
  console.log(JSON.stringify({ passed: true, output }))
} finally { await browser.close() }
