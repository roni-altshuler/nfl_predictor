import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

/** Game-led discovery, plain predictions and optional technical detail on real artifacts. */
export async function auditFanJourney({ browser, base, output, axePath, publication }) {
  await fs.mkdir(output, { recursive: true })
  const checks = [], journeys = [], errors = []
  const slate = p => p.getByRole('region', { name: 'Published slate', exact: true })
  async function health(p, width, state) {
    await p.waitForTimeout(700)
    await p.addScriptTag({ path: axePath })
    const result = await p.evaluate(async () => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      axe: (await window.axe.run('#main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })),
    }))
    assert.equal(result.overflow, false); assert.deepEqual(result.axe, [])
    checks.push({ width, state, ...result })
  }
  for (const width of [320, 390, 768, 1440]) {
    const c = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 1000 }, colorScheme: 'dark', reducedMotion: 'no-preference' })
    await c.route(/^https:/, r => r.abort())
    const p = await c.newPage()
    p.on('pageerror', e => errors.push(e.message))
    if (process.env.AUDIT_USE_PUBLICATION_TIME === '1') await p.clock.setFixedTime(new Date(publication.generated_at))
    try {
      await p.goto(base, { waitUntil: 'networkidle' })
      const explore = p.getByRole('navigation', { name: 'Explore Gridiron', exact: true })
      const targets = await explore.getByRole('link').evaluateAll(links => links.map(link => ({ label: link.textContent, height: link.getBoundingClientRect().height, width: link.getBoundingClientRect().width })))
      assert.equal(targets.length, 3)
      for (const target of targets) assert.ok(target.height >= 44 && target.width >= 44)
      // Derive primary labels from rendered text, then query the browser's
      // computed accessible names. Separate visibility/name tests miss 2.5.3.
      const nameMappings = []
      const labelInName = async (scope, link, visibleLabels) => {
        const labels = visibleLabels.map(label => label.replace(/\s+/g, ' ').trim())
        const pattern = new RegExp('^' + labels.map(label => '(?=.*' + label.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&') + ')').join(''), 'i')
        const named = scope.getByRole('link', { name: pattern })
        const href = await link.getAttribute('href')
        const matches = await named.count() === 1 && await named.getAttribute('href') === href
        nameMappings.push({ visibleLabels: labels, ariaLabel: await link.getAttribute('aria-label'), href, computedNameContainsLabels: matches })
      }
      for (const link of await explore.getByRole('link').all()) await labelInName(explore, link, [await link.innerText()])
      for (const link of await slate(p).getByRole('link').filter({ has: p.locator('footer') }).all()) {
        const href = await link.getAttribute('href')
        const fixture = publication.games.find(game => '/games/' + game.game_id === href)
        assert.ok(fixture)
        await labelInName(slate(p), link, [
          await link.getByText(fixture.away_name, { exact: true }).innerText(),
          await link.getByText(fixture.home_name, { exact: true }).innerText(),
          await link.locator('footer').getByText('View prediction', { exact: true }).innerText(),
        ])
      }
      assert.ok(nameMappings.length > 3, 'Check cards as well as navigation controls')
      assert.deepEqual(nameMappings.filter(mapping => !mapping.computedNameContainsLabels), [], 'Accessible names must contain the actual visible primary labels')
      checks.push({ width, state: 'label-in-name', nameMappings })
      const first = slate(p).getByRole('link', { name: /^View prediction:/i }).first()
      const href = await first.getAttribute('href'), game = publication.games.find(g => `/games/${g.game_id}` === href)
      assert.ok(game)
      const card = await first.innerText()
      for (const value of [game.away_name, game.home_name, (game.p_away * 100).toFixed(1) + '%', (game.p_home * 100).toFixed(1) + '%', 'Win chance', 'View prediction']) assert.ok(card.toLowerCase().includes(value.toLowerCase()), value)
      assert.doesNotMatch(card, /market|margin sd/i)
      assert.ok((await first.boundingBox()).y < 500)
      await health(p, width, 'home-game-led')
      await p.screenshot({ path: path.join(output, `home-${width}.png`) })

      const teams = p.getByRole('region', { name: 'Teams', exact: true })
      await explore.getByRole('link', { name: 'Teams', exact: true }).focus(); await p.keyboard.press('Enter')
      await p.waitForFunction(() => { const y = document.getElementById('teams').getBoundingClientRect().top; return y >= 0 && y < innerHeight / 2 })
      assert.ok((await teams.boundingBox()).y < (width < 768 ? 422 : 500))
      assert.equal(await teams.getByRole('link', { name: /, / }).count(), 32)
      const team = teams.locator('a[href^="/teams/"]').first(), teamHref = await team.getAttribute('href')
      await team.focus(); await p.keyboard.press('Enter'); await p.waitForURL(base + teamHref)
      await p.getByRole('button', { name: 'Back', exact: true }).click(); await p.waitForURL(base + '/#teams')
      await slate(p).waitFor()
      await explore.getByRole('link', { name: "Browse this week's games", exact: true }).click()
      await p.waitForURL(base + '/#slate')

      for (let cycle = 0; cycle < 2; cycle++) {
        await first.focus(); await p.keyboard.press('Enter'); await p.waitForURL(base + href)
        const prediction = p.getByRole('region', { name: 'Forecast', exact: true })
        await prediction.waitFor()
        const predictionText = await prediction.innerText()
        for (const value of [(game.p_home * 100).toFixed(1) + '%', (game.p_away * 100).toFixed(1) + '%', game.exp_away_score.toFixed(1), game.exp_home_score.toFixed(1), 'Projected points']) assert.ok(predictionText.toLowerCase().includes(value.toLowerCase()), value)
        const forecastBounds = await prediction.boundingBox()
        assert.ok(forecastBounds.y < (width < 768 ? 520 : 500), 'Prediction must start on the first screen')
        const advanced = p.locator('#prediction-details'), summary = advanced.locator(':scope > summary')
        assert.equal(await advanced.getAttribute('open'), null)
        assert.equal(await p.getByRole('region', { name: 'Market', exact: true }).isVisible(), false)
        const source = p.getByRole('region', { name: 'Forecast source', exact: true }), sourceDetails = source.locator('details')
        assert.equal(await sourceDetails.getAttribute('open'), null)
        await sourceDetails.locator('summary').focus(); await p.keyboard.press('Enter')
        assert.match(await source.innerText(), /Forecast published/); assert.match(await source.innerText(), /Results used through/)
        assert.ok((await source.innerText()).includes(publication.model_version))
        assert.match(await source.innerText(), /availability and roster changes are not inputs/)
        await p.keyboard.press('Space'); assert.equal(await sourceDetails.getAttribute('open'), null)
        const explanation = prediction.locator('details'), explain = explanation.locator('summary')
        await explain.focus(); await p.keyboard.press('Enter')
        assert.match(await explanation.innerText(), /averages, not an exact final score/)
        assert.match(await explanation.innerText(), /Either team can win/)
        await p.keyboard.press('Space'); assert.equal(await explanation.getAttribute('open'), null)
        if (cycle === 0) {
          await p.evaluate(() => window.scrollTo(0, 0))
          await health(p, width, 'game-simple')
          await p.screenshot({ path: path.join(output, `game-${width}.png`) })
        }
        const nav = p.getByRole('navigation', { name: 'Game sections', exact: true })
        await nav.getByRole('link', { name: 'Players', exact: true }).focus(); await p.keyboard.press('Enter')
        assert.equal(await p.evaluate(() => document.activeElement.id), 'players')
        await p.waitForFunction(() => { const y = document.getElementById('players').getBoundingClientRect().top; return y >= 0 && y < 160 })
        assert.ok((await p.locator('#players').boundingBox()).y < 160)
        const playerY = await p.locator('#players').evaluate(el => el.offsetTop)
        assert.ok(playerY < await advanced.evaluate(el => el.offsetTop), 'People precede model numbers')
        await summary.focus(); await p.keyboard.press('Enter')
        assert.notEqual(await advanced.getAttribute('open'), null)
        const model = p.getByRole('region', { name: 'Model numbers', exact: true })
        assert.match(await model.innerText(), /Margin sd/i)
        assert.ok((await model.innerText()).includes(game.exp_total.toFixed(1)))
        assert.ok((await model.innerText()).includes(game.margin_sd.toFixed(1)))
        await health(p, width, 'game-details-expanded')
        await summary.focus(); await p.keyboard.press('Space'); assert.equal(await advanced.getAttribute('open'), null)
        await nav.getByRole('link', { name: 'Score range', exact: true }).focus(); await p.keyboard.press('Enter')
        assert.notEqual(await advanced.getAttribute('open'), null)
        assert.equal(await p.evaluate(() => document.activeElement.id), 'distribution')
        await p.getByRole('button', { name: 'Back', exact: true }).click(); await p.waitForURL(base + '/#slate')
        await slate(p).waitFor()
        journeys.push({ width, cycle, game: game.game_id, firstScreenPredictionY: forecastBounds.y, sourceDisclosure: true, explanationKeyboard: true, technicalDetailKeyboard: true, jumpRevealsDetail: true, backReturnsToSlateOnce: true })
      }
      await explore.getByRole('link', { name: 'Explore players in the next matchup', exact: true }).click()
      await p.waitForURL(base + href + '#players')
      await p.waitForFunction(() => { const y = document.getElementById('players').getBoundingClientRect().top; return y >= 0 && y < 160 })
      assert.ok((await p.locator('#players').boundingBox()).y < 160)
      await p.goto(base + href + '?compare=receiving#market', { waitUntil: 'networkidle' })
      await p.getByRole('region', { name: 'Market', exact: true }).waitFor()
      assert.equal(new URL(p.url()).searchParams.get('compare'), 'receiving')
      assert.notEqual(await p.locator('#prediction-details').getAttribute('open'), null)
      await p.screenshot({ path: path.join(output, `shared-market-${width}.png`) })
      journeys.push({ width, homePlayersEntry: true, teamDiscoveryAndBack: true, directTechnicalHash: true, queryPreserved: true, targets })
    } catch (error) {
      console.error(JSON.stringify({ width, url: p.url(), error: String(error) }))
      await p.screenshot({ path: path.join(output, `failure-${width}.png`), fullPage: true }).catch(() => {})
      throw error
    } finally { await c.close() }
  }
  assert.deepEqual(errors, [])
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, source: 'Retained forecast artifacts; browser HTTPS outages; server fixture mode recorded separately', checks, journeys, errors }, null, 2) + '\n')
  console.log(`Fan journey: ${checks.length} strict checks; game/team/player discovery, prediction explanations, technical disclosure and repeated Back passed`)
}
