/** Production record/navigation audit. Expectations recompute raw H/T/A outcomes independently. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(path.join(process.env.BROWSER_TEST_MODULE_ROOT || process.cwd(), 'package.json'))
const { chromium } = require('playwright')
const axePath = require.resolve('axe-core/axe.min.js')
const base = process.env.BASE_URL || 'http://127.0.0.1:3012'
const output = process.env.RECORD_AUDIT_OUTPUT || '/tmp/nfl-record-audit'
const raw = await fs.readFile('backend/data/predictions/forecast_log.json')
const first = JSON.parse(raw), comparison = JSON.parse(await fs.readFile('backend/data/predictions/forecast_comparison.json', 'utf8'))
const current = JSON.parse(await fs.readFile('backend/data/predictions/game_forecasts.json', 'utf8'))
const history = JSON.parse(await fs.readFile(`backend/data/history/season_${first.season}.json`, 'utf8'))
assert.equal(comparison.sources.first_sha256, createHash('sha256').update(raw).digest('hex'))
const outcomes = history.games.filter(game => game.postseason === false)
const calls = outcomes.map(result => {
  const saved = first.games.filter(row => row.game_id === result.game_id), evidence = comparison.games.filter(row => row.game_id === result.game_id)
  const actual = result.home_score > result.away_score ? 0 : result.home_score === result.away_score ? 1 : 2
  if (saved.length !== 1 || evidence.length !== 1) return { ...result, kickoff: evidence[0]?.actual_kickoff_utc ?? null, picked: false, pickStatus: 'ungraded', correct: false, actual }
  const prediction = saved[0], source = evidence[0], vector = [prediction.p_home, prediction.p_tie, prediction.p_away]
  const valid = vector.every(p => Number.isFinite(p) && p >= 0 && p <= 1) && Math.abs(vector.reduce((a, b) => a + b, 0) - 1) < 0.00001 && Date.parse(prediction.generated_at) < Date.parse(source.actual_kickoff_utc)
  if (!valid) return { ...result, kickoff: source.actual_kickoff_utc ?? null, picked: false, pickStatus: 'ungraded', correct: false, actual }
  const winners = vector.map((p, i) => p === Math.max(...vector) ? i : -1).filter(i => i >= 0)
  return { ...result, kickoff: source.actual_kickoff_utc, picked: winners.length === 1, pickStatus: winners.length === 1 ? 'graded' : 'unpicked', correct: winners.length === 1 && winners[0] === actual, actual }
}).sort((a, b) => (Date.parse(a.kickoff) || Infinity) - (Date.parse(b.kickoff) || Infinity) || a.game_id.localeCompare(b.game_id))
const graded = calls.filter(row => row.picked), correct = graded.filter(row => row.correct).length
const headline = graded.length ? `${correct} of ${graded.length} correct` : 'Not yet scored', percentage = graded.length ? `${(correct / graded.length * 100).toFixed(1)}%` : '—'
const pending = current.games.filter(game => !outcomes.some(result => result.game_id === game.game_id)).length
const previousSeason = first.season - 1
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) })
const checks = [], errors = [], consoleErrors = []
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
    await context.route(url => url.protocol === 'https:' && url.origin !== new URL(base).origin, route => route.abort())
    const page = await context.newPage()
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource|net::ERR_/i.test(message.text())) consoleErrors.push(message.text()) })
    page.on('pageerror', error => errors.push(error.message))
    const record = page.getByRole('region', { name: 'Published forecast record', exact: true })
    await page.goto(`${base}/accuracy`)
    await page.locator('[data-record-ready="true"]').waitFor()
    assert.equal(await page.getByTestId('record-fraction').innerText(), headline)
    assert.equal(await page.getByTestId('record-percentage').innerText(), percentage)
    assert.ok((await page.getByTestId('record-fraction').boundingBox()).y < 550, 'Overall record is prominent on first screen')
    await page.screenshot({ path: path.join(output, `accuracy-top-${width}.png`), fullPage: false })
    assert.match(await record.innerText(), /Actual ties/)
    assert.ok((await record.innerText()).includes(String(pending)))
    const names = ['Season', 'Week', 'Game coverage', ...(graded.length ? ['Timeline series'] : [])]
    const session = await context.newCDPSession(page)
    const ax = await session.send('Accessibility.getFullAXTree')
    for (const name of names) {
      const control = record.getByRole('combobox', { name, exact: true })
      const size = await control.boundingBox(); assert.ok(size.width >= 44 && size.height >= 44)
      assert.ok(ax.nodes.some(node => node.role?.value === 'combobox' && node.name?.value === name), `Native AX name matches ${name}`)
    }
    await record.getByRole('combobox', { name: 'Season', exact: true }).focus()
    await page.keyboard.press('Tab')
    const week = record.getByRole('combobox', { name: 'Week', exact: true })
    assert.equal(await week.evaluate(el => document.activeElement === el && el.matches(':focus-visible')), true)
    assert.ok(await week.evaluate(el => parseFloat(getComputedStyle(el).outlineWidth) >= 2))
    const offeredWeeks = await week.locator('option:not([value="all"])').evaluateAll(options => options.map(option => Number(option.value)))
    const firstWeek = offeredWeeks[0] ?? null
    if (firstWeek !== null) {
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
    await page.waitForFunction(value => new URLSearchParams(location.search).get('week') === String(value), firstWeek)
    await page.reload(); await page.locator('[data-record-ready="true"]').waitFor()
    assert.equal(await week.inputValue(), String(firstWeek)); assert.equal(await page.getByTestId('record-fraction').innerText(), headline)
    await week.selectOption('all')
    await page.waitForFunction(() => !new URLSearchParams(location.search).has('week'))
    await page.goBack()
    await page.waitForFunction(value => document.querySelector('[aria-label="Record season and week"] select') && new URLSearchParams(location.search).get('week') === String(value), firstWeek)
    assert.equal(await week.inputValue(), String(firstWeek))
    await page.goForward(); await page.waitForFunction(() => !new URLSearchParams(location.search).has('week'))
    } else {
      assert.equal(await week.inputValue(), 'all')
      assert.equal(await week.locator('option').count(), 1)
      assert.equal(await record.getByRole('button', { name: 'Next week →', exact: true }).isDisabled(), true)
      assert.equal(await record.getByRole('button', { name: '← Previous week', exact: true }).isDisabled(), true)
    }
    const recent = graded.slice(-16), recentCorrect = recent.filter(row => row.correct).length
    if (graded.length) {
    await record.getByRole('combobox', { name: 'Timeline series', exact: true }).selectOption('recent')
    assert.equal(await record.locator('svg polyline').count(), 1)
    assert.equal(await record.locator('svg polyline').getAttribute('stroke-dasharray'), '6 4')
    await record.getByRole('combobox', { name: 'Timeline series', exact: true }).selectOption('both')
    const timeline = record.getByRole('region', { name: 'Season accuracy timeline', exact: true })
    await timeline.locator('summary').focus(); await page.keyboard.press('Enter')
    const table = page.getByRole('region', { name: 'Accuracy timeline data', exact: true })
    assert.equal(await table.locator('tbody tr').count(), graded.length)
    assert.ok((await table.locator('tbody tr').last().innerText()).includes(`${correct}/${graded.length}`))
    assert.ok((await table.locator('tbody tr').last().innerText()).includes(`${recentCorrect}/${recent.length}`))
    await table.focus(); assert.equal(await table.evaluate(el => document.activeElement === el), true)
    if (width < 490) {
      await page.keyboard.press('ArrowRight')
      await page.waitForFunction(() => document.querySelector('[aria-label="Accuracy timeline data"]')?.scrollLeft > 0)
    }
    await timeline.locator('summary').click()
    } else {
      assert.equal(await record.locator('svg').count(), 0)
      assert.match(await record.innerText(), /No eligible settled predictions to plot/)
      assert.equal(await page.getByTestId('record-percentage').innerText(), '—')
    }
    await record.getByRole('combobox', { name: 'Game coverage', exact: true }).selectOption('pending')
    if (pending) {
      await page.getByText('Result not recorded', { exact: true }).first().waitFor()
      assert.equal(await record.locator('[data-record-game]').first().getByText('No recorded outcome', { exact: true }).count(), 1)
    } else {
      assert.equal(await record.locator('[data-record-game]').count(), 0)
      assert.match(await record.innerText(), /No games match this view/)
    }
    await record.getByRole('combobox', { name: 'Game coverage', exact: true }).selectOption('settled')
    const tie = calls.find(row => row.actual === 1)
    if (tie) {
      await week.selectOption(String(tie.week))
      const row = record.locator(`[data-record-game="${tie.game_id}"]`)
      await row.waitFor(); assert.match(await row.innerText(), /Tie/)
      const expectedStatus = tie.pickStatus === 'unpicked' ? /No unique pick/ : tie.pickStatus === 'ungraded' ? /Pick unavailable/ : tie.correct ? /Correct/ : /Incorrect/
      assert.match(await row.innerText(), expectedStatus)
      await row.locator('summary').focus(); await page.keyboard.press('Enter')
      assert.match(await row.innerText(), /Original probabilities/); assert.match(await row.innerText(), /Saved publication/)
      await page.screenshot({ path: path.join(output, `tie-${width}.png`), fullPage: false })
    }
    await week.selectOption('all')
    await record.getByRole('combobox', { name: 'Season', exact: true }).selectOption(String(previousSeason))
    await page.getByText('Record unavailable', { exact: true }).waitFor()
    assert.equal(await page.getByTestId('record-percentage').innerText(), '—')
    assert.equal(await record.locator('svg').count(), 0)
    await page.reload(); await page.locator('[data-record-ready="true"]').waitFor()
    assert.equal(await record.getByRole('combobox', { name: 'Season', exact: true }).inputValue(), String(previousSeason))
    await record.getByRole('combobox', { name: 'Season', exact: true }).selectOption(String(first.season))
    await page.addScriptTag({ path: axePath })
    const health = await page.evaluate(async () => ({ overflow: document.documentElement.scrollWidth > innerWidth, axe: (await window.axe.run('#main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), animations: document.getAnimations().filter(a => a.playState === 'running').length }))
    assert.equal(health.overflow, false); assert.deepEqual(health.axe, []); assert.equal(health.animations, 0)
    await page.screenshot({ path: path.join(output, `accuracy-${width}.png`), fullPage: true })
    const scheduleWeek = outcomes.some(row => row.week === 1) ? 1 : firstWeek ?? 1
    await page.goto(`${base}/games?week=${scheduleWeek}`); await page.locator('[data-ready="true"]').waitFor()
    const schedule = page.getByRole('region', { name: 'Weekly slate', exact: true })
    assert.equal(await schedule.getByRole('combobox', { name: 'Week', exact: true }).inputValue(), String(scheduleWeek))
    const weekOne = outcomes.filter(row => row.week === scheduleWeek)
    assert.equal(await schedule.locator('[data-record-game]').count(), Math.min(16, weekOne.length))
    assert.match(await schedule.innerText(), /Recorded result/)
    await page.reload(); await page.locator('[data-ready="true"]').waitFor()
    assert.equal(await schedule.getByRole('combobox', { name: 'Week', exact: true }).inputValue(), String(scheduleWeek))
    await page.screenshot({ path: path.join(output, `completed-week-${width}.png`), fullPage: true })
    checks.push({ width, headline, percentage, pending, recentCorrect, recentN: recent.length, actualTieHandled: !!tie, nativeAXNames: names, keyboard: true, queryReloadBackForward: true, previousSeasonUnavailable: true, checkedScheduleWeek: scheduleWeek, completedWeekResults: weekOne.length, ...health })
    await context.close()
  }
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, [])
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, source: 'Raw original probability triples and recorded results; no stored correctness aggregates', checks, errors, consoleErrors }, null, 2) + '\n')
  console.log(`Season record: four widths; raw H/T/A counts, cumulative/recent values, ties, pending/missing coverage, keyboard/native labels, history and completed weeks passed`)
} finally { await browser.close() }
