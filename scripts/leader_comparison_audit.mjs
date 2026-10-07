/** Real Chromium UI journey. Controlled mode reuses recorded facts and explicit synthetic absence states. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(path.join(process.env.BROWSER_TEST_MODULE_ROOT || process.cwd(), 'package.json'))
const { chromium } = require('playwright')
const axePath = require.resolve('axe-core/axe.min.js')
const forecast = JSON.parse(await fs.readFile('backend/data/predictions/game_forecasts.json', 'utf8'))
const contextData = JSON.parse(await fs.readFile('backend/data/predictions/game_context.json', 'utf8'))
const fixture = JSON.parse(await fs.readFile('scripts/fixtures/espn-player-summary.json', 'utf8'))
const captured = forecast.games.find(g => g.game_id === fixture.header.id) ?? Object.values(contextData.meetings).flat().find(g => g.game_id === fixture.header.id)
const controlled = process.env.PLAYER_AUDIT_EXPECT_FIXTURE === '1'
const base = process.env.BASE_URL || 'http://127.0.0.1:3012'
const output = process.env.COMPARISON_AUDIT_OUTPUT || '/tmp/nfl-leader-comparison-audit'
await fs.mkdir(output, { recursive: true })
await fs.rm(path.join(output, 'results.json'), { force: true })
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
  ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) })
const errors = []
const portraits = []
const checks = []
const journeys = []
const ambiguityJourneys = []
let loadingObserved = false
async function newPage(width) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
  await context.route('**/a.espncdn.com/**', route => route.abort())
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/\/headshots\//.test(request.url())) portraits.push(request.url()) })
  return { context, page }
}
async function audit(page, width, name) {
  const board = page.getByRole('region', { name: 'Game leader comparison', exact: true })
  await board.scrollIntoViewIfNeeded()
  await page.addScriptTag({ path: axePath })
  const result = await page.evaluate(async () => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    axe: (await window.axe.run('#main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }))
      .violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })),
    overlay: !!document.querySelector('[data-nextjs-dialog]'),
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    enterDuration: getComputedStyle(document.querySelector('.page-enter')).animationDuration,
  }))
  assert.equal(result.overflow, false, `${name} at ${width}px`)
  assert.deepEqual(result.axe, [])
  assert.equal(result.overlay, false)
  assert.equal(result.reducedMotion, true)
  assert.ok(result.enterDuration.split(',').every(d => (d.trim().endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000) <= 0.02))
  await board.screenshot({ path: path.join(output, `${name}-${width}.png`) })
  checks.push({ name, width, ...result })
}
try {
  if (controlled) {
    assert.ok(captured, 'Recorded response must have a published game context')
    const { context, page } = await newPage(390)
    let releaseScripts
    const scriptsReady = new Promise(resolve => { releaseScripts = resolve })
    await page.route('**/_next/static/**/*.js', async route => { await scriptsReady; await route.continue() })
    try {
      await page.goto(`${base}/games/${captured.game_id}#comparison`, { waitUntil: 'commit' })
      const loading = page.getByRole('status', { name: 'Loading leader comparison', exact: true })
      await loading.waitFor()
      loadingObserved = true
      // Playwright waits for document.fonts.ready, which can wait for the held
      // scripts. CDP captures the actual pending frame without that load gate.
      const clip = await page.locator('#comparison').evaluate(element => {
        const r = element.getBoundingClientRect()
        return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, scale: 1 }
      })
      const cdp = await context.newCDPSession(page)
      const frame = await cdp.send('Page.captureScreenshot', { captureBeyondViewport: true, clip })
      await fs.writeFile(path.join(output, 'comparison-loading-390.png'), Buffer.from(frame.data, 'base64'))
      await cdp.detach()
    } finally { releaseScripts() }
    await page.locator('[data-comparison-ready="true"]').waitFor()
    await page.unroute('**/_next/static/**/*.js')
    await page.goto(`${base}/games/401127974`)
    await page.getByRole('region', { name: 'Game leader comparison', exact: true }).getByRole('heading', { name: 'Game leaders unavailable', exact: true }).waitFor()
    assert.match(await page.locator('#comparison').innerText(), /summary could not be read/)
    await audit(page, 390, 'comparison-source-outage')
    await page.locator('#comparison').getByRole('link', { name: 'Browse published games', exact: false }).click()
    await page.locator('[data-ready="true"]').waitFor()
    await context.close()
  }
  for (const width of [320, 390, 768, 1440]) {
    const { context, page } = await newPage(width)
    if (controlled) {
      await page.goto(`${base}/games`)
      await page.locator('[data-ready="true"]').waitFor()
      await page.getByRole('combobox', { name: 'Season or results archive', exact: true }).selectOption(String(captured.season))
      await page.waitForURL(`**/seasons/${captured.season}/games`)
      const entry = page.locator(`a[href="/games/${captured.game_id}"]`)
      await entry.focus()
      await page.keyboard.press('Enter')
      await page.waitForURL(`${base}/games/${captured.game_id}`)
      const jump = page.getByRole('navigation', { name: 'Game sections', exact: true }).getByRole('link', { name: 'Compare leaders', exact: true })
      await jump.focus()
      await page.keyboard.press('Enter')
      assert.equal(await page.evaluate(() => document.activeElement.id), 'comparison')
      await page.keyboard.press('Tab')
    } else await page.goto(`${base}/games/${forecast.games[0].game_id}#comparison`)
    const board = page.getByRole('region', { name: 'Game leader comparison', exact: true })
    await board.waitFor()
    await board.locator('[data-comparison-ready="true"]').or(board.getByRole('heading', { name: /^(Game leaders unavailable|No leader lines supplied)$/ })).waitFor()
    const picker = board.getByRole('combobox', { name: 'Compare leader category', exact: true })
    const populated = await picker.count() > 0
    if (controlled) assert.equal(populated, true)
    let profileAndTeamReturn = false
    let filterRequests = []
    if (populated) {
      await board.locator('[data-comparison-ready="true"]').waitFor()
      const focus = await picker.evaluate(element => ({ height: element.getBoundingClientRect().height,
        focused: document.activeElement === element, outline: getComputedStyle(element).outlineStyle,
        outlineWidth: getComputedStyle(element).outlineWidth }))
      assert.ok(focus.height >= 44)
      if (controlled) {
        assert.equal(focus.focused, true)
        assert.equal(focus.outline, 'solid')
        assert.equal(focus.outlineWidth, '2px')
        assert.match(await board.innerText(), /Oct 4, 2026 · Kickoff time unavailable/)
        assert.match(await board.innerText(), /Oct 4, 2026, 8:11 PM UTC/)
        const onRequest = request => {
          const url = new URL(request.url())
          if (url.pathname === `/games/${captured.game_id}` && url.searchParams.has('_rsc')) {
            const headers = request.headers()
            filterRequests.push({ url: url.href, prefetch: headers['next-router-prefetch'] === '1' || headers.purpose === 'prefetch' })
          }
        }
        page.on('request', onRequest)
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
        await page.getByRole('region', { name: 'Rushing Yards comparison', exact: true }).waitFor()
        assert.equal(await picker.inputValue(), 'rushingYards')
        for (const category of ['receivingYards', 'sacks', 'passingYards', 'receivingYards']) {
          await picker.selectOption(category)
          assert.equal(new URL(page.url()).searchParams.get('compare'), category)
        }
        page.off('request', onRequest)
        // Existing Recent meetings links may prefetch the same event as it
        // enters the viewport. Keep that evidence separate from navigation.
        assert.deepEqual(filterRequests.filter(request => !request.prefetch), [], 'Category changes must not navigate/refetch the game summary')
        const receiving = fixture.leaders.map(g => ({ team: g.team.abbreviation,
          line: g.leaders.find(row => row.name === 'receivingYards').leaders[0] }))
        for (const { team, line } of receiving) {
          const side = board.getByRole('article', { name: `${team} Receiving Yards leader`, exact: true })
          assert.ok((await side.innerText()).includes(line.displayValue))
          assert.match(await side.innerText(), /WR/)
          assert.equal(await side.getByRole('link', { name: `${line.athlete.displayName} — player profile`, exact: true }).getAttribute('href'), `/players/espn/${line.athlete.id}?game=${captured.game_id}`)
        }
        await audit(page, width, 'comparison-receiving')
        const comparisonUrl = page.url()
        const athlete = receiving[0].line.athlete
        const profile = board.getByRole('link', { name: `${athlete.displayName} — player profile`, exact: true })
        await profile.focus()
        await page.keyboard.press('Enter')
        await page.getByRole('heading', { level: 1, name: athlete.displayName, exact: true }).waitFor()
        await page.getByRole('button', { name: 'Back', exact: true }).click()
        await page.waitForURL(comparisonUrl)
        await board.locator('[data-comparison-ready="true"]').waitFor()
        assert.equal(await picker.inputValue(), 'receivingYards')
        await board.locator(`a[href="/teams/${captured.away}"]`).click()
        await page.waitForURL(`${base}/teams/${captured.away}`)
        await page.getByRole('button', { name: 'Back', exact: true }).click()
        await page.waitForURL(comparisonUrl)
        await board.locator('[data-comparison-ready="true"]').waitFor()
        assert.equal(await picker.inputValue(), 'receivingYards')
        await page.getByRole('button', { name: 'Back', exact: true }).click()
        await page.waitForURL(`${base}/seasons/${captured.season}/games`)
        profileAndTeamReturn = true
      } else {
        const options = await picker.locator('option').evaluateAll(options => options.map(o => o.value))
        for (const option of options.slice(0, 3)) await picker.selectOption(option)
        await audit(page, width, 'comparison-observed')
      }
    } else await audit(page, width, 'comparison-unavailable')
    journeys.push({ width, populated, keyboardFocus: controlled && populated, repeatedSelection: populated,
      profileAndTeamReturn, archiveReturn: profileAndTeamReturn,
      gameRefetchesDuringSelection: filterRequests.filter(request => !request.prefetch), backgroundLinkPrefetches: filterRequests.filter(request => request.prefetch) })
    await context.close()
    console.log(`Leader comparison ${width}px: ${populated ? 'paired leaders' : 'honest unavailable state'}; layout and accessibility passed`)
  }
  if (controlled) {
    for (const width of [320, 390, 768, 1440]) {
      const { context, page } = await newPage(width)
      await page.goto(`${base}/games/400554211?compare=passingYards#comparison`)
      await page.locator('[data-comparison-ready="true"]').waitFor()
      const board = page.getByRole('region', { name: 'Game leader comparison', exact: true })
      const home = board.getByRole('article', { name: 'NYG Passing Yards leader', exact: true })
      assert.match(await home.innerText(), /Multiple leader lines supplied; this comparison is withheld/)
      assert.equal(await home.locator('a[href^="/players/"]').count(), 0)
      assert.ok(!(await home.innerText()).includes('First QA Leader'))
      assert.ok(!(await home.innerText()).includes('Second QA Leader'))
      assert.match(await board.getByRole('article', { name: 'ARI Passing Yards leader', exact: true }).innerText(), /Unambiguous synthetic line/)
      await audit(page, width, 'comparison-ambiguous')
      const picker = board.getByRole('combobox', { name: 'Compare leader category', exact: true })
      await picker.focus()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await board.getByRole('region', { name: 'Rushing Yards comparison', exact: true }).waitFor()
      const selectedUrl = page.url()
      await board.getByRole('link', { name: 'Single QA Leader — player profile', exact: true }).click()
      await page.getByRole('heading', { level: 1, name: 'Single QA Leader', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await page.waitForURL(selectedUrl)
      await board.locator('[data-comparison-ready="true"]').waitFor()
      assert.equal(await picker.inputValue(), 'rushingYards')
      await picker.selectOption('passingYards')
      assert.match(await home.innerText(), /this comparison is withheld/)
      await picker.selectOption('receivingYards')
      const incomplete = board.getByRole('article', { name: 'NYG Receiving Yards leader', exact: true })
      assert.match(await incomplete.innerText(), /Multiple leader lines supplied; this comparison is withheld/)
      assert.equal(await incomplete.locator('a[href^="/players/"]').count(), 0)
      assert.ok(!(await incomplete.innerText()).includes('Named Before Unknown'))
      await audit(page, width, 'comparison-ambiguous-unnamed')
      await picker.selectOption('passingYards')
      await page.getByRole('navigation', { name: 'Game sections', exact: true }).getByRole('link', { name: 'Players', exact: true }).click()
      const players = page.getByRole('region', { name: 'Players in this matchup', exact: true })
      for (const name of ['First QA Leader', 'Second QA Leader']) assert.equal(await players.getByRole('link', { name: `${name} — player profile`, exact: true }).count(), 1)
      const playersUrl = page.url()
      await players.getByRole('link', { name: 'Second QA Leader — player profile', exact: true }).click()
      await page.getByRole('heading', { level: 1, name: 'Second QA Leader', exact: true }).waitFor()
      assert.match(await page.getByRole('region', { name: 'Game statistics', exact: true }).innerText(), /Synthetic second line/)
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await page.waitForURL(playersUrl)
      await board.locator('[data-comparison-ready="true"]').waitFor()
      assert.match(await home.innerText(), /this comparison is withheld/)
      ambiguityJourneys.push({ width, event: '400554211', sourceMode: 'Entirely synthetic raw response with two NYG passing leaders',
        homeWithheld: true, homeComparisonProfileLinks: 0, awayStillReported: true, categorySwitchAndProfileReturn: true,
        bothSourceLeadersRetainedInPlayers: true, secondSourceLeaderProfileAndReturn: true, unnamedRawEntryStillWithheld: true })
      await context.close()
      console.log(`Raw multiplicity ${width}px: comparison withheld; category recovery and both source profiles passed`)
    }
    const { context, page } = await newPage(390)
    await page.goto(`${base}/games/${captured.game_id}?compare=receivingYards#comparison`)
    await page.locator('[data-comparison-ready="true"]').waitFor()
    assert.equal(await page.getByRole('combobox', { name: 'Compare leader category', exact: true }).inputValue(), 'receivingYards')
    await page.goto(`${base}/games/${captured.game_id}?compare=unknown-category#comparison`)
    await page.locator('[data-comparison-ready="true"]').waitFor()
    assert.match(await page.locator('#comparison').innerText(), /requested category is not supplied/i)
    await audit(page, 390, 'comparison-unknown-category')
    await page.goto(`${base}/games/401220253#comparison`)
    await page.locator('[data-comparison-ready="true"]').waitFor()
    const unknown = await page.locator('#comparison').innerText()
    for (const label of ['Position not supplied', 'Profile identity not supplied', 'Statistic not supplied', 'The value is unknown']) assert.ok(unknown.includes(label))
    assert.equal(await page.locator('#comparison a[href^="/players/"]').count(), 0)
    await audit(page, 390, 'comparison-unknown-fields')
    await page.goto(`${base}/games/401547421#comparison`)
    await page.getByRole('heading', { name: 'No leader lines supplied', exact: true }).waitFor()
    await audit(page, 390, 'comparison-empty')
    await page.locator('#comparison').getByRole('link', { name: 'Browse published games', exact: false }).click()
    await page.locator('[data-ready="true"]').waitFor()
    await page.goto(`${base}/games/999999999`)
    await page.getByRole('heading', { name: 'No such page', exact: true }).waitFor()
    await page.locator('nav a[href="/games"]:visible').click()
    await page.locator('[data-ready="true"]').waitFor()
    await context.close()
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(portraits, [])
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, checked_at: new Date().toISOString(),
    browser: browser.version(), clock: 'current browser clock; no clock override', sourceMode: controlled
      ? 'Captured 2026 ESPN summary subset in its published archive context; synthetic ambiguity/absence/unknown fixtures; other ESPN server responses controlled 503'
      : 'Application responses; populated coverage conditional', capturedEvent: fixture.header.id,
    capturedSummaryUpdate: fixture.meta.lastUpdatedAt, forecastGeneratedAt: forecast.generated_at, trainedThrough: forecast.trained_through,
    loadingObserved, loadingMode: controlled ? 'Actual SSR comparison skeleton with local JavaScript bundles held, then released for hydration' : 'Not forced', checks, journeys, ambiguityJourneys, errors, portraitRequests: portraits,
    flows: ['archive→keyboard matchup→comparison anchor', 'keyboard category selection and repeated native selection without game refetch',
      'provider-ID profile→Back restores category URL', 'team→Back restores category', 'one Back restores archive',
      ...(controlled ? ['raw provider multiplicity→withheld comparison→single-category profile→Back', 'incomplete unnamed raw leader→withheld comparison', 'both raw source leader profiles retained→second profile→Back', 'fresh category deep link and unknown-category recovery', 'comparison skeleton→hydrated controls', 'source outage→published games', 'synthetic missing side/ID/position/statistic', 'empty response recovery', 'missing game recovery'] : [])],
  }, null, 2) + '\n')
} catch (error) {
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: false, checked_at: new Date().toISOString(), error: String(error), checks, journeys, ambiguityJourneys, errors }, null, 2) + '\n')
  throw error
} finally { await browser.close() }
