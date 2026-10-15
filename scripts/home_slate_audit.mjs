import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

/** Real homepage hierarchy, native disclosure and one-tap matchup journeys. */
export async function auditHomeSlate({ browser, base, output, axePath, publication }) {
  await fs.mkdir(output, { recursive: true })
  const checks = [], errors = [], journeys = []
  const source = page => page.getByRole('region', { name: 'Forecast source', exact: true })
  const slate = page => page.getByRole('region', { name: 'Published slate', exact: true })
  async function context(width, scheme = 'dark') {
    const c = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 1000 }, colorScheme: scheme, reducedMotion: 'no-preference' })
    await c.route(/^https:/, r => r.abort())
    c.on('page', p => p.on('pageerror', e => errors.push(e.message)))
    return c
  }
  async function health(page, name, width, scheme) {
    await page.waitForTimeout(1200)
    await page.addScriptTag({ path: axePath })
    const result = await page.evaluate(async () => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      axe: (await window.axe.run('#main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })),
      bodyImage: getComputedStyle(document.body).backgroundImage,
      palette: getComputedStyle(document.body).backgroundColor,
      canvas: document.querySelectorAll('canvas').length,
    }))
    assert.equal(result.overflow, false); assert.deepEqual(result.axe, [])
    assert.equal(result.bodyImage, 'none'); assert.equal(result.canvas, 0)
    assert.equal(result.palette, 'rgb(11, 18, 14)')
    checks.push({ name, width, scheme, ...result })
  }
  let firstId, inactiveTeam
  for (const width of [320, 390, 768, 1440]) for (const scheme of ['light', 'dark']) {
    const c = await context(width, scheme), p = await c.newPage()
    if (process.env.AUDIT_USE_PUBLICATION_TIME === '1') await p.clock.setFixedTime(new Date(publication.generated_at))
    await p.goto(base, { waitUntil: 'networkidle' })
    const details = p.locator('#forecast-tools'), summary = details.locator(':scope > summary')
    assert.equal(await details.getAttribute('open'), null)
    assert.equal(await p.getByRole('heading', { name: 'Your Sunday starts here.' }).isVisible(), false)
    const sourceText = await source(p).innerText()
    assert.match(sourceText, /Forecast published/); assert.match(sourceText, /Results used through/)
    assert.match(sourceText, /Published pre-game probabilities, not a live schedule/)
    const links = slate(p).getByRole('link', { name: /full forecast/ }), link = links.first()
    const href = await link.getAttribute('href'), game = publication.games.find(g => `/games/${g.game_id}` === href)
    assert.ok(game); firstId = game.game_id
    const expected = publication.games.filter(g => g.week === game.week)
    assert.equal(await links.count(), expected.length)
    const teams = new Set(expected.flatMap(g => [g.home, g.away]))
    // Full 32-team weeks have no bye team. An explicit browser-only stored
    // preference still exercises the empty view without changing forecast data.
    inactiveTeam = publication.games.flatMap(g => [g.home, g.away]).find(t => !teams.has(t)) ?? '__audit_empty_following__'
    await health(p, 'closed', width, scheme)
    const bounds = await link.boundingBox(); assert.ok(bounds.y < 500, 'A matchup must be reachable on the first screen')
    await p.screenshot({ path: path.join(output, `home-${width}-${scheme}.png`) })
    const fullSlate = await links.evaluateAll(rows => rows.map(row => ({ href: row.getAttribute('href'), text: row.innerText })))
    const setFollowing = async team => p.evaluate(value => {
      localStorage.setItem('gridiron:watchlist:v1', JSON.stringify(value ? [value] : []))
      window.dispatchEvent(new Event('gridiron:watchlist'))
    }, team)
    await setFollowing(game.home)
    const filter = slate(p).getByRole('group', { name: 'Filter the slate' })
    const all = filter.getByRole('button', { name: /^All/ }), following = filter.getByRole('button', { name: /^Following/ })
    await filter.waitFor()
    const targets = await filter.getByRole('button').evaluateAll(buttons => buttons.map(button => ({
      name: button.textContent, width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height,
    })))
    for (const target of targets) assert.ok(target.width >= 44 && target.height >= 44, `${width}px: ${target.name} must have a 44px target`)
    const assertFocus = async button => {
      const focus = await button.evaluate(el => ({ active: document.activeElement === el, visible: el.matches(':focus-visible'),
        style: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth), color: getComputedStyle(el).outlineColor }))
      assert.equal(focus.active, true); assert.equal(focus.visible, true)
      assert.equal(focus.style, 'solid'); assert.ok(focus.width >= 2); assert.equal(focus.color, 'rgb(95, 166, 87)')
    }
    await all.focus(); await p.keyboard.press('Tab'); await assertFocus(following)
    await p.screenshot({ path: path.join(output, `home-filter-focus-${width}-${scheme}.png`) })
    await p.keyboard.press('Space')
    assert.equal(await following.getAttribute('aria-pressed'), 'true'); assert.equal(await all.getAttribute('aria-pressed'), 'false')
    assert.equal(await links.count(), expected.filter(g => [g.home, g.away].includes(game.home)).length)
    await p.keyboard.press('Shift+Tab'); await assertFocus(all); await p.keyboard.press('Enter')
    assert.deepEqual(await links.evaluateAll(rows => rows.map(row => ({ href: row.getAttribute('href'), text: row.innerText }))), fullSlate)
    await setFollowing(inactiveTeam)
    await all.focus(); await p.keyboard.press('Tab'); await p.keyboard.press('Enter')
    await slate(p).getByText(/None of your teams play this week/).waitFor()
    assert.equal(await links.count(), 0); assert.equal(await following.getAttribute('aria-pressed'), 'true')
    await health(p, 'following-empty', width, scheme)
    await p.screenshot({ path: path.join(output, `home-following-empty-${width}-${scheme}.png`) })
    await following.focus(); await p.keyboard.press('Shift+Tab'); await assertFocus(all); await p.keyboard.press('Space')
    assert.equal(await all.getAttribute('aria-pressed'), 'true'); assert.equal(await following.getAttribute('aria-pressed'), 'false')
    assert.deepEqual(await links.evaluateAll(rows => rows.map(row => ({ href: row.getAttribute('href'), text: row.innerText }))), fullSlate)
    assert.equal(await source(p).innerText(), sourceText)
    await health(p, 'following-recovered', width, scheme)
    journeys.push({ width, scheme, targets, keyboardTabOrder: 'All → Following → All', enterAndSpaceActivation: true,
      visibleFocus: true, emptyFollowingRecovery: true, recoveredFullSlate: fullSlate.length })
    await setFollowing(null); assert.equal(await filter.count(), 0)
    for (let i = 0; i < 2; i++) {
      await link.focus(); await p.keyboard.press('Enter')
      await p.waitForURL(base + href)
      const forecast = p.getByRole('region', { name: 'Forecast', exact: true }); await forecast.waitFor()
      assert.ok((await forecast.innerText()).includes((game.p_home * 100).toFixed(1) + '%'))
      await p.getByRole('button', { name: 'Back', exact: true }).click(); await p.waitForURL(base + '/')
      await slate(p).waitFor(); assert.equal(await links.count(), expected.length)
    }
    await summary.focus(); await p.keyboard.press('Enter')
    await p.getByRole('heading', { name: 'Your Sunday starts here.' }).waitFor()
    assert.ok((await summary.boundingBox()).height >= 44)
    assert.notEqual(await summary.evaluate(el => getComputedStyle(el).outlineStyle), 'none')
    await health(p, 'expanded', width, scheme)
    await summary.focus(); await p.keyboard.press('Space')
    assert.equal(await details.getAttribute('open'), null)
    await p.reload(); await slate(p).waitFor(); assert.equal(await details.getAttribute('open'), null)
    journeys.push({ width, scheme, game: game.game_id, firstCardY: bounds.y, repeatedKeyboardMatchupReturns: 2, nativeDisclosureKeyboard: true, sourceVisibleWhenClosed: true, reloadStartsWithSlate: true })
    await c.close()
  }
  const c = await context(390), p = await c.newPage()
  await p.clock.install({ time: new Date(Date.parse(publication.generated_at) + 49 * 3600000) })
  await p.goto(base, { waitUntil: 'networkidle' })
  await source(p).getByText('Forecasts are more than 48 hours old. Check their publication date before using them.').waitFor()
  assert.equal(await p.locator('#forecast-tools').getAttribute('open'), null)
  await health(p, 'stale-with-tools-closed', 390, 'dark')
  await p.screenshot({ path: path.join(output, 'home-stale-390.png') })
  await p.clock.setFixedTime(new Date(Date.parse(publication.generated_at) + 47 * 3600000)); await p.reload()
  await source(p).waitFor(); assert.equal(await source(p).getByText(/more than 48 hours/).count(), 0)
  {
    await p.evaluate(team => { localStorage.setItem('gridiron:watchlist:v1', JSON.stringify([team])); window.dispatchEvent(new Event('gridiron:watchlist')) }, inactiveTeam)
    const filter = slate(p).getByRole('group', { name: 'Filter the slate' })
    await filter.getByRole('button', { name: /^Following/ }).click()
    await slate(p).getByText(/None of your teams play this week/).waitFor()
    await health(p, 'following-empty', 390, 'dark')
    await p.screenshot({ path: path.join(output, 'home-following-empty-390.png') })
    await filter.getByRole('button', { name: /^All/ }).click()
    assert.ok(await slate(p).getByRole('link', { name: /full forecast/ }).count())
  }
  await c.close()
  const interrupted = await context(390), q = await interrupted.newPage()
  let release, observed, held = 0
  const barrier = new Promise(resolve => { release = resolve }), seen = new Promise(resolve => { observed = resolve })
  await interrupted.route(url => url.pathname === `/games/${firstId}` && url.searchParams.has('_rsc'), async r => {
    held++; observed(); await barrier; await r.continue().catch(() => {})
  })
  try {
    await q.goto(base, { waitUntil: 'domcontentloaded' })
    await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(new Error('No matchup prefetch observed')), 10000))])
    await slate(q).getByRole('link', { name: /full forecast/ }).first().click({ noWaitAfter: true })
    await q.waitForTimeout(300)
    const loading = await q.getByRole('status', { name: 'Loading game', exact: true }).isVisible()
    await q.screenshot({ path: path.join(output, 'home-held-navigation-390.png') })
    await q.getByRole('link', { name: 'Games', exact: true }).click({ noWaitAfter: true })
    await q.waitForURL(base + '/games'); await q.locator('[data-ready="true"]').waitFor()
    release(); await q.waitForTimeout(500); assert.equal(q.url(), base + '/games')
    await q.goto(base, { waitUntil: 'networkidle' })
    await slate(q).getByRole('link', { name: /full forecast/ }).first().click()
    await q.getByRole('region', { name: 'Forecast', exact: true }).waitFor()
    journeys.push({ interruptedForSchedule: true, heldRscRequests: held, loadingSkeletonObserved: loading, lateResponseDidNotReplaceDestination: true, retryPassed: true })
  } finally { release(); await interrupted.unrouteAll({ behavior: 'wait' }); await interrupted.close() }
  assert.deepEqual(errors, [])
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, source: 'Committed artifacts; controlled browser provider/CDN outages; current clock plus explicit 47/49-hour freshness probes', checks, journeys, emptyFilterTeam: inactiveTeam ?? null, errors }, null, 2) + '\n')
  console.log(`Homepage slate: ${checks.length} strict checks; first-screen matchups, disclosure, freshness, repeated and interrupted returns passed`)
}
