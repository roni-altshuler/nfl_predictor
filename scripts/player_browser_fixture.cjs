/** Opt-in local browser fixture. Never loaded by the application or a production job. */
const fixture = require('./fixtures/espn-player-summary.json')
const archived = require('./fixtures/espn-archived-summary.json')
const originalFetch = globalThis.fetch
globalThis.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : input?.url || String(input)
  if (/^https:\/\/[^/]*espn\.com\//.test(url)) {
    const event = new URL(url).searchParams.get('event')
    if (process.env.PLAYER_AUDIT_SLOW_EVENT === event) await new Promise(resolve => setTimeout(resolve, 1500))
    if (event === fixture.header.id) return new Response(JSON.stringify(fixture), {
      status: 200, headers: { 'content-type': 'application/json', date: 'Tue, 06 Oct 2026 15:00:00 GMT' },
    })
    // Explicitly synthetic archive QA; never a claim about a historical athlete.
    if (event === archived.header.id) return new Response(JSON.stringify(archived), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
    if (process.env.PLAYER_AUDIT_COMPARE_STATES === '1' && ['401547421', '401220253'].includes(event)) {
      // Synthetic absence/unknown fixtures for already-published archive IDs;
      // no real player, roster, statistic or source-update assertion is made.
      const home = event === '401547421' ? 'ARI' : 'NYG'
      const away = home === 'ARI' ? 'NYG' : 'ARI'
      const summary = { _qa: { synthetic: true }, header: { id: event, competitions: [{ competitors: [
        { homeAway: 'home', team: { abbreviation: home } }, { homeAway: 'away', team: { abbreviation: away } },
      ] }] }, leaders: event === '401547421' ? [] : [{ team: { abbreviation: home }, leaders: [{
        name: 'passingYards', displayName: 'Passing Yards', leaders: [{ athlete: { displayName: 'Unidentified QA Leader' }, displayValue: '' }],
      }] }] }
      return new Response(JSON.stringify(summary), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('Controlled source outage for local profile QA', { status: 503 })
  }
  return originalFetch(input, init)
}
