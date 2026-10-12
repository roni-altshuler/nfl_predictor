/** Production journey: static backgrounds, both system schemes and preserved interactions. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(path.join(process.env.BROWSER_TEST_MODULE_ROOT || process.cwd(), 'package.json'))
const { chromium } = require('playwright')
const axePath = require.resolve('axe-core/axe.min.js')
const forecast = JSON.parse(await fs.readFile('backend/data/predictions/game_forecasts.json', 'utf8'))
const fixture = JSON.parse(await fs.readFile('scripts/fixtures/espn-player-summary.json', 'utf8'))
const athlete = fixture.leaders[0].leaders[0].leaders[0].athlete
const base = process.env.BASE_URL || 'http://127.0.0.1:3012'
const output = process.env.THEME_AUDIT_OUTPUT || '/tmp/nfl-theme-journey-audit'
const controlled = process.env.PLAYER_AUDIT_EXPECT_FIXTURE === '1'
const now = process.env.AUDIT_USE_PUBLICATION_TIME === '1' ? Date.parse(forecast.generated_at) : Date.now()
const game = forecast.games.find(game => Date.parse(game.date_utc) > now)
assert.ok(game, 'Need a real published future fixture')
await fs.mkdir(output, { recursive: true })
await fs.rm(path.join(output, 'results.json'), { force: true })
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
  ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) })
const checks = [], pending = [], errors = [], hydrationErrors = [], portraits = []
const tokenNames = ['--background', '--card-bg', '--text-primary', '--text-secondary', '--text-tertiary',
  '--accent-primary', '--accent-info', '--logo-plate', '--font-sans', '--font-mono-numeric']

async function newPage(width, scheme, stored) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: scheme, reducedMotion: 'no-preference' })
  await context.route(/https:\/\/[^/]*(espn\.com|espncdn\.com)\//, route => route.abort())
  await context.addInitScript(value => {
    if (value !== undefined) try { localStorage.setItem('gridiron-ambient', value) } catch { /* opaque audit frame */ }
    const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window)
    const pending = new Set()
    const audit = window.__motionAudit = { frames: 0, pending: () => pending.size }
    window.requestAnimationFrame = callback => {
      const id = raf(time => { pending.delete(id); audit.frames++; callback(time) })
      pending.add(id); return id
    }
    window.cancelAnimationFrame = id => { pending.delete(id); cancel(id) }
  }, stored)
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  if (process.env.AUDIT_USE_PUBLICATION_TIME === '1') await page.clock.setFixedTime(new Date(now))
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource|net::ERR_/i.test(message.text())) hydrationErrors.push(message.text())
  })
  page.on('request', request => { if (/\/headshots\//.test(request.url())) portraits.push(request.url()) })
  return { context, page }
}

async function audit(page, name, width, scheme) {
  // Allow finite foreground data/route transitions to finish; reduced motion is off.
  await page.waitForTimeout(1200)
  const framesBefore = await page.evaluate(() => window.__motionAudit.frames)
  await page.waitForTimeout(200)
  await page.addScriptTag({ path: axePath })
  const result = await page.evaluate(async names => {
    const root = document.documentElement, body = getComputedStyle(document.body)
    const heading = document.querySelector('h1'), card = document.querySelector('.card')
    return {
      route: location.pathname, rootClass: root.className, ambient: root.dataset.ambient,
      systemDark: matchMedia('(prefers-color-scheme: dark)').matches,
      tokens: Object.fromEntries(names.map(key => [key, getComputedStyle(root).getPropertyValue(key).trim()])),
      body: { color: body.color, background: body.backgroundColor, font: body.fontFamily, image: body.backgroundImage },
      heading: heading ? { color: getComputedStyle(heading).color, font: getComputedStyle(heading).fontFamily, transform: getComputedStyle(heading).textTransform } : null,
      card: card ? { background: getComputedStyle(card).backgroundColor } : null,
      overflow: root.scrollWidth > innerWidth, mainCount: document.querySelectorAll('#main').length,
      axe: (await window.axe.run('#main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }))
        .violations.map(violation => ({ id: violation.id, targets: violation.nodes.map(node => node.target) })),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      canvas: document.querySelectorAll('canvas').length,
      ambientLayers: document.querySelectorAll('.ambient-layer').length,
      ambientControls: document.querySelectorAll('[aria-label="Chalkboard animation"]').length,
      svgAnimationElements: document.querySelectorAll('svg animate, svg animateTransform, svg set').length,
      frames: window.__motionAudit.frames, pendingRafs: window.__motionAudit.pending(),
      runningAnimations: document.getAnimations().filter(a => a.playState === 'running').map(a => {
        const target = a.effect?.target
        const useful = target?.closest?.('[role="status"], .skeleton-shimmer, [aria-label^="Live:"]')
        return { name: a.animationName, usefulIndicator: !!useful }
      }),
    }
  }, tokenNames)
  result.frameDelta = result.frames - framesBefore
  checks.push({ name, width, scheme, ...result })
  assert.equal(result.rootClass, 'dark')
  assert.equal(result.ambient, undefined)
  assert.equal(result.body.background, 'rgb(11, 18, 14)')
  assert.equal(result.tokens['--logo-plate'], '#f4efe6')
  assert.equal(result.systemDark, scheme === 'dark')
  assert.equal(result.overflow, false)
  assert.equal(result.mainCount, 1)
  assert.deepEqual(result.axe, [], `${name} at ${width}px with ${scheme} preference`)
  assert.equal(result.reducedMotion, false)
  assert.equal(result.body.image, 'none')
  assert.equal(result.canvas, 0)
  assert.equal(result.ambientLayers, 0)
  assert.equal(result.ambientControls, 0)
  assert.equal(result.svgAnimationElements, 0)
  assert.equal(result.pendingRafs, 0)
  assert.equal(result.frameDelta, 0)
  assert.deepEqual(result.runningAnimations.filter(a => !a.usefulIndicator), [])
  if (result.heading) {
    assert.equal(result.heading.color, 'rgb(244, 247, 242)')
    assert.equal(result.heading.transform, 'uppercase')
  }
  // Every destination uses the same palette, fonts and flat background.
  const first = checks[0]
  assert.deepEqual(result.tokens, first.tokens)
  assert.deepEqual(result.body, first.body)
  if (result.card) assert.deepEqual(result.card, checks.find(check => check.card).card)
  if (result.heading && first.heading) assert.equal(result.heading.font, first.heading.font)
  await page.screenshot({ path: path.join(output, `${name}-${width}-${scheme}.png`), fullPage: false })
}

async function pendingPreference(width, scheme, stored) {
  const { context, page } = await newPage(width, scheme, stored)
  let release
  const held = new Promise(resolve => { release = resolve })
  await page.route('**/_next/static/**/*.js', async route => { await held; await route.continue() })
  try {
    await page.goto(base, { waitUntil: 'commit' })
    await page.getByRole('heading', { name: 'The slate', exact: true }).waitFor()
    const state = await page.evaluate(() => ({
      ambient: document.documentElement.dataset.ambient,
      image: getComputedStyle(document.body).backgroundImage,
      background: getComputedStyle(document.body).backgroundColor,
      canvas: document.querySelectorAll('canvas, .ambient-layer').length,
      controls: document.querySelectorAll('[aria-label="Chalkboard animation"]').length,
    }))
    assert.equal(state.ambient, undefined); assert.equal(state.image, 'none')
    assert.equal(state.background, 'rgb(11, 18, 14)')
    assert.equal(state.canvas, 0); assert.equal(state.controls, 0)
    pending.push({ width, scheme, stored, ...state })
  } finally { release() }
  await page.unrouteAll({ behavior: 'wait' })
  await page.waitForLoadState('networkidle')
  assert.equal(await page.locator('canvas, .ambient-layer, [aria-label="Chalkboard animation"]').count(), 0)
  await context.close()
}

try {
  for (const stored of ['soft', 'vivid', 'off', 'unsupported']) await pendingPreference(390, 'light', stored)
  await pendingPreference(1440, 'dark', 'off')
  for (const width of [320, 390, 768, 1440]) for (const scheme of ['light', 'dark']) {
    const { context, page } = await newPage(width, scheme, 'vivid')
    await page.goto(base)
    await page.getByRole('heading', { name: 'The slate', exact: true }).waitFor()
    const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute('href')
    const manifest = await (await page.request.get(new URL(manifestUrl, base).href)).json()
    const boardColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim())
    assert.equal(manifest.theme_color, boardColor)
    assert.equal(manifest.background_color, boardColor)
    assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), boardColor)
    await page.locator('#forecast-tools > summary').focus()
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: 'Your Sunday starts here.', exact: true }).waitFor()
    assert.match(await page.getByRole('link', { name: 'Explore every matchup ↗', exact: true }).evaluate(link => getComputedStyle(link).fontFamily), /monospace/)
    await page.locator('#forecast-tools > summary').focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.locator('#forecast-tools').getAttribute('open'), null)
    await audit(page, 'home', width, scheme)
    await page.reload()
    await audit(page, 'home-reload', width, scheme)
    await page.emulateMedia({ colorScheme: scheme === 'light' ? 'dark' : 'light' })
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(11, 18, 14)')
    await page.emulateMedia({ colorScheme: scheme })
    await page.getByRole('link', { name: width < 768 ? 'Games' : 'Schedule', exact: true }).click()
    await page.locator('[data-ready="true"]').waitFor(); await audit(page, 'schedule', width, scheme)
    const week = page.getByRole('combobox', { name: 'Select week', exact: true })
    const team = page.getByRole('combobox', { name: 'Filter by team', exact: true })
    await week.selectOption(String(game.week)); await team.selectOption(game.away)
    await page.getByRole('checkbox').check()
    await page.getByRole('heading', { name: 'No games match these filters', exact: true }).waitFor()
    await audit(page, 'schedule-empty', width, scheme)
    await page.getByRole('button', { name: 'Show the whole week', exact: true }).click(); await team.selectOption(game.away)
    await page.locator(`a[href="/games/${game.game_id}"]`).first().focus(); await page.keyboard.press('Enter')
    await page.locator('[data-paths-ready="true"]').waitFor(); await audit(page, 'game', width, scheme)
    const jump = page.getByRole('navigation', { name: 'Game sections', exact: true }).getByRole('link', { name: 'Close-game paths', exact: true })
    await jump.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Narrow winning margin')
    const margin = page.getByRole('combobox', { name: 'Narrow winning margin', exact: true })
    await margin.selectOption('3')
    await page.locator('#paths').screenshot({ path: path.join(output, `paths-${width}-${scheme}.png`) })
    await audit(page, 'paths', width, scheme)
    await page.goBack(); await page.waitForURL(`**/games?week=${game.week}&team=${game.away}`)
    await page.locator('[data-ready="true"]').waitFor()
    assert.equal(await week.inputValue(), String(game.week)); assert.equal(await team.inputValue(), game.away)
    await audit(page, 'schedule-back', width, scheme)
    await page.goForward(); await page.waitForURL(`**/games/${game.game_id}?marginBand=3#paths`)
    await margin.waitFor(); assert.equal(await margin.inputValue(), '3')
    await page.getByRole('link', { name: width < 768 ? 'Lab' : 'Forecast Lab', exact: true }).click()
    await page.locator('[data-paths-ready="true"]').waitFor(); await audit(page, 'lab', width, scheme)
    await page.getByRole('searchbox', { name: 'Search teams', exact: true }).fill('No matching franchise')
    await page.getByText('No games match these filters.', { exact: true }).waitFor(); await audit(page, 'lab-empty', width, scheme)
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click()
    await page.route('**/api/forecast-lab', route => route.fulfill({ status: 503, body: 'Controlled outage' }))
    await page.getByRole('button', { name: 'Refresh forecasts', exact: true }).click()
    await page.getByText('Refresh unavailable. Your last loaded forecasts are still here.', { exact: true }).waitFor()
    await audit(page, 'lab-error', width, scheme)
    await page.goto(`${base}/games/${fixture.header.id}#players`)
    const profileLink = page.getByRole('region', { name: 'Players in this matchup', exact: true })
      .getByRole('link', { name: `${athlete.displayName} — player profile`, exact: true })
    if (controlled) await profileLink.click()
    else await page.goto(`${base}/players/espn/${athlete.id}?game=${fixture.header.id}`)
    const populated = page.getByRole('heading', { level: 1, name: athlete.displayName, exact: true })
    const unavailable = page.getByRole('heading', { name: 'Player profile unavailable', exact: true })
    await populated.or(unavailable).waitFor()
    if (controlled) assert.equal(await populated.isVisible(), true)
    await audit(page, 'profile', width, scheme)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForURL(`**/games/${fixture.header.id}#players`)
    await audit(page, 'profile-return', width, scheme)
    await page.goto(`${base}/teams/${game.home}`)
    await page.getByRole('region', { name: 'Published matchup', exact: true }).waitFor()
    await audit(page, 'team', width, scheme)
    await page.goto(`${base}/bracket`)
    await page.getByRole('heading', { level: 1 }).waitFor()
    await audit(page, 'bracket', width, scheme)
    await page.goto(`${base}/players/espn/${athlete.id}`)
    await unavailable.waitFor(); await audit(page, 'profile-missing-context', width, scheme)
    await page.goto(`${base}/missing-theme-qa-page`)
    await page.getByRole('heading', { name: 'No such page', exact: true }).waitFor()
    await audit(page, 'not-found', width, scheme)
    await context.close()
    console.log(`Theme journey: ${width}px with ${scheme} system preference passed`)
  }
  assert.deepEqual(errors, []); assert.deepEqual(hydrationErrors, []); assert.deepEqual(portraits, [])
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ generated_at: new Date().toISOString(),
    forecast_generated_at: forecast.generated_at, controlled, darkOnlyIntentional: true, decorativeBackgroundRemoved: true, legacyPreferencesIgnored: true, motionMode: 'no-preference', creamPlate: '#f4efe6',
    palette: checks[0].tokens, body: checks[0].body,
    checks: checks.map(({ tokens, body, card, ...check }) => ({ ...check, paletteMatches: true, bodyMatches: true,
      cardBackground: card?.background ?? null })),
    pending, errors, consoleErrors: hydrationErrors, portraits, passed: true }, null, 2))
  console.log(JSON.stringify({ passed: true, checks: checks.length, pending: pending.length, output }))
} finally { await browser.close() }
