/** Chromium navigation and keyboard QA for separate publication cohorts. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(path.join(process.env.BROWSER_TEST_MODULE_ROOT || process.cwd(), 'package.json'))
const { chromium } = require('playwright')
const axePath = require.resolve('axe-core/axe.min.js')
const forecast = JSON.parse(await fs.readFile('backend/data/predictions/game_forecasts.json', 'utf8'))
const artifact = await fs.readFile('backend/data/predictions/forecast_comparison.json', 'utf8').then(JSON.parse).catch(() => null)
const first = JSON.parse(await fs.readFile('backend/data/predictions/forecast_log.json', 'utf8'))
const base = process.env.BASE_URL || 'http://127.0.0.1:3012'
const state = process.env.FORECAST_COMPARISON_STATE || 'published'
const output = process.env.FORECAST_COMPARISON_OUTPUT || '/tmp/nfl-forecast-comparison-audit'
const now = process.env.AUDIT_USE_PUBLICATION_TIME === '1' ? Date.parse(forecast.generated_at) : Date.now()
const game = forecast.games.find(g => Date.parse(g.date_utc) > now)
assert.ok(game)
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
  ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) })
const checks = [], errors = [], requests = []
const panel = page => page.getByRole('region', { name: 'First versus latest forecasts', exact: true })
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
    await context.route(/https:\/\/[^/]*(espn\.com|espncdn\.com)\//, route => route.abort())
    await context.addInitScript(() => localStorage.setItem('gridiron-ambient', 'off'))
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => requests.push(request.url()))
    if (process.env.AUDIT_USE_PUBLICATION_TIME === '1') await page.clock.install({ time: new Date(now) })
    await page.goto(`${base}/games/${game.game_id}?marginBand=3`, { waitUntil: 'networkidle' })
    await page.getByRole('link', { name: 'Read the published-ahead record' }).click()
    await page.waitForURL('**/accuracy#published-record')
    assert.match(await page.locator('#published-record').innerText(), new RegExp(`Decided games\\s+${first.n}`, 'i'))
    await panel(page).scrollIntoViewIfNeeded()
    if (state === 'missing') {
      assert.match(await panel(page).innerText(), /Comparison unavailable/)
      const link = panel(page).getByRole('link', { name: 'Read the first-publication record' })
      await link.focus()
      await page.keyboard.press('Enter')
      await page.waitForURL('**/accuracy#published-record')
      await panel(page).scrollIntoViewIfNeeded()
    } else {
      assert.ok(artifact)
      const text = await panel(page).innerText()
      if (state === 'empty-latest') {
        assert.match(text, /No shared decided games/)
        assert.match(text, /Paired Brier\s+—/i)
        assert.match(text, /no valid stored forecast under 24 hours/)
      } else {
        assert.match(text, new RegExp(`${artifact.paired.n} identical decided games`))
        for (const side of ['first', 'latest']) assert.ok(text.includes(artifact.paired[side].brier.toFixed(5)))
        assert.match(text, /descriptive difference only/)
        assert.match(text, /does not establish an accuracy gain/)
      }
      const summary = panel(page).locator('summary')
      await summary.focus()
      await page.keyboard.press('Enter')
      assert.equal(await panel(page).locator('details').getAttribute('open'), '')
      const region = panel(page).getByRole('region', { name: 'First and latest forecast cohorts' })
      await region.focus()
      assert.equal(await region.evaluate(el => document.activeElement === el), true)
      if (width < 768) {
        await page.keyboard.press('ArrowRight')
        await page.waitForTimeout(150)
        assert.ok(await region.evaluate(el => el.scrollLeft > 0), 'Keyboard scrolls cohort table on narrow screens')
      }
      for (const label of ['First', 'Latest']) {
        for (const [key, name] of [['under_24h', 'Under 24 hours'], ['1_to_7_days', '1–7 days'], ['7_days_or_more', '7 days or more']]) {
          const row = region.getByRole('row').filter({ has: page.getByRole('rowheader', { name: `${label} · ${name}`, exact: true }) })
          const expected = artifact[label.toLowerCase()].horizons[key]
          assert.deepEqual(await row.locator('td').allTextContents(), [String(expected.n), expected.brier?.toFixed(5) ?? '—', expected.log_loss?.toFixed(5) ?? '—'])
        }
      }
      if (artifact.sources.snapshot_through) assert.ok((await panel(page).innerText()).includes(new Date(artifact.sources.snapshot_through).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'))
      assert.equal(await panel(page).getByRole('link', { name: 'Retained warehouse source' }).getAttribute('href'), artifact.sources.warehouse_url)
    }
    await page.addScriptTag({ path: axePath })
    const health = await page.evaluate(async () => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      palette: getComputedStyle(document.body).backgroundColor,
      ambient: document.documentElement.dataset.ambient,
      axe: (await window.axe.run('#forecast-comparison', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => v.id),
    }))
    assert.equal(health.overflow, false)
    assert.equal(health.palette, 'rgb(11, 18, 14)')
    assert.equal(health.ambient, 'off')
    assert.deepEqual(health.axe, [])
    await panel(page).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, `${state}-${width}.png`) })
    if (state !== 'missing') {
      await panel(page).locator('summary').focus()
      await page.keyboard.press('Enter')
      assert.equal(await panel(page).locator('details').getAttribute('open'), null)
      await panel(page).scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(output, `${state}-compact-${width}.png`) })
    }
    await page.goBack()
    await page.waitForURL(`**/games/${game.game_id}?marginBand=3`)
    await page.goForward()
    await page.waitForURL('**/accuracy#published-record')
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await page.locator('html').getAttribute('data-ambient'), 'off')
    checks.push({ width, state, game: game.game_id, keyboardDisclosure: state !== 'missing', navigation: 'matchup → evidence → Back → Forward → reload', ...health })
    await context.close()
  }
  assert.deepEqual(errors, [])
  assert.equal(requests.filter(url => /\/headshots\//.test(url)).length, 0)
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, source: artifact?.sources ?? null }, null, 2))
  console.log(JSON.stringify({ output, state, checks: checks.length, errors }, null, 2))
} finally {
  await browser.close()
}
