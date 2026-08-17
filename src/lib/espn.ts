/**
 * Request-time reads from ESPN, for the things the warehouse deliberately
 * does not hold.
 *
 * The warehouse stores what the MODEL consumes. Player box scores and injury
 * reports feed no probability here, so keeping 6,499 games of player lines
 * would be hundreds of megabytes of JSON that nothing reads. They are
 * fetched when a game page is rendered and cached for a day.
 *
 * **The host is `site.web.api.espn.com`, never `site.api`.** The two serve
 * byte-identical payloads and Akamai answers `site.api` with a 403 from
 * datacentre IPs — which is every Vercel builder and every CI runner. The
 * host is named once in `backend/services/espn/client.py` and once here.
 */

const ESPN_HOST = 'https://site.web.api.espn.com'
const SUMMARY = `${ESPN_HOST}/apis/site/v2/sports/football/nfl/summary`

// A day. Box scores and injury reports for a game that has been played never
// change; for one that has not, a day-old injury report is still the right
// order of freshness for a weekly sport.
const REVALIDATE = 86_400

export interface TeamStat {
  label: string
  home: string
  away: string
}

export interface Linescore {
  team: string
  periods: number[]
  total: number
}

export interface PlayerLine {
  name: string
  stat: string
}

export interface PlayerGroup {
  team: string
  label: string
  leaders: PlayerLine[]
}

export interface InjuryEntry {
  team: string
  player: string
  position: string
  status: string
  detail: string
}

export interface GameDetail {
  teamStats: TeamStat[]
  linescores: Linescore[]
  leaders: PlayerGroup[]
  injuries: InjuryEntry[]
  attendance: number | null
  venue: string | null
}

/**
 * Stats worth showing, in the order they read.
 *
 * An explicit whitelist rather than the whole `statistics` array, for the
 * same reason the ingester uses one: **`interceptions` appears TWICE** in an
 * NFL team box score, once as passing interceptions thrown and once inside
 * the turnover block, with different values. Building a dict over the array
 * keeps whichever came last and nothing reports the collision.
 */
const TEAM_STATS: { key: string; label: string }[] = [
  { key: 'firstDowns', label: 'First downs' },
  { key: 'totalYards', label: 'Total yards' },
  { key: 'netPassingYards', label: 'Passing yards' },
  { key: 'rushingYards', label: 'Rushing yards' },
  { key: 'yardsPerPlay', label: 'Yards per play' },
  { key: 'thirdDownEff', label: 'Third down' },
  { key: 'fourthDownEff', label: 'Fourth down' },
  { key: 'redZoneAttempts', label: 'Red zone' },
  { key: 'totalPenaltiesYards', label: 'Penalties' },
  { key: 'sacksYardsLost', label: 'Sacks allowed' },
  { key: 'turnovers', label: 'Turnovers' },
  { key: 'possessionTime', label: 'Possession' },
]

async function fetchSummary(gameId: string): Promise<any | null> {
  try {
    const response = await fetch(`${SUMMARY}?event=${encodeURIComponent(gameId)}`, {
      next: { revalidate: REVALIDATE },
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    // ESPN being unreachable is not a page failure. The sections that need
    // this render their absence and everything published stays on screen.
    return null
  }
}

/** First occurrence wins — see the note on TEAM_STATS. */
function statMap(entry: any): Map<string, string> {
  const out = new Map<string, string>()
  for (const stat of entry?.statistics ?? []) {
    if (stat?.name && !out.has(stat.name)) {
      out.set(stat.name, String(stat.displayValue ?? ''))
    }
  }
  return out
}

export async function getGameDetail(
  gameId: string,
  homeAbbr: string,
  awayAbbr: string,
): Promise<GameDetail> {
  const empty: GameDetail = {
    teamStats: [],
    linescores: [],
    leaders: [],
    injuries: [],
    attendance: null,
    venue: null,
  }
  const summary = await fetchSummary(gameId)
  if (!summary) return empty

  // ---- team statistics
  const teams: any[] = summary?.boxscore?.teams ?? []
  const byAbbr = new Map<string, Map<string, string>>()
  for (const entry of teams) {
    const abbr = entry?.team?.abbreviation
    if (abbr) byAbbr.set(String(abbr), statMap(entry))
  }
  const home = byAbbr.get(homeAbbr)
  const away = byAbbr.get(awayAbbr)
  const teamStats: TeamStat[] = []
  if (home && away) {
    for (const { key, label } of TEAM_STATS) {
      const h = home.get(key)
      const a = away.get(key)
      // Absent stays absent. A dash in one column and a number in the other
      // is a fact about coverage; a zero would be a claim about the game.
      if (h || a) teamStats.push({ label, home: h ?? '—', away: a ?? '—' })
    }
  }

  // ---- period scoring
  const competitors: any[] = summary?.header?.competitions?.[0]?.competitors ?? []
  const linescores: Linescore[] = competitors
    .map((competitor) => ({
      team: String(competitor?.team?.abbreviation ?? ''),
      periods: (competitor?.linescores ?? []).map((l: any) => Number(l?.displayValue ?? l?.value ?? 0)),
      total: Number(competitor?.score ?? 0),
    }))
    .filter((l) => l.team)
    // Away first, matching how every scoreboard in the sport is written.
    .sort((a) => (a.team === awayAbbr ? -1 : 1))

  // ---- leaders
  const leaders: PlayerGroup[] = []
  for (const group of summary?.leaders ?? []) {
    const abbr = String(group?.team?.abbreviation ?? '')
    for (const category of group?.leaders ?? []) {
      const lines: PlayerLine[] = (category?.leaders ?? [])
        .slice(0, 1)
        .map((leader: any) => ({
          name: String(leader?.athlete?.displayName ?? ''),
          stat: String(leader?.displayValue ?? ''),
        }))
        .filter((l: PlayerLine) => l.name)
      if (lines.length && abbr) {
        leaders.push({
          team: abbr,
          label: String(category?.displayName ?? category?.name ?? ''),
          leaders: lines,
        })
      }
    }
  }

  // ---- injuries
  //
  // The NBA sibling lists roster availability as one of its largest gaps,
  // because its summary endpoint does not carry it. The NFL one does, and
  // for a sport where a single position is worth several points a game it is
  // the most decision-relevant thing on the page. It still feeds no
  // probability — the model does not know about it, and `/about` says so.
  const injuries: InjuryEntry[] = []
  for (const block of summary?.injuries ?? []) {
    const abbr = String(block?.team?.abbreviation ?? '')
    for (const item of block?.injuries ?? []) {
      const player = String(item?.athlete?.displayName ?? '')
      if (!player) continue
      injuries.push({
        team: abbr,
        player,
        position: String(item?.athlete?.position?.abbreviation ?? ''),
        status: String(item?.status ?? ''),
        detail: String(item?.details?.type ?? item?.type?.description ?? ''),
      })
    }
  }

  const info = summary?.gameInfo ?? {}
  return {
    teamStats,
    linescores,
    leaders,
    injuries,
    attendance: info?.attendance ? Number(info.attendance) : null,
    venue: info?.venue?.fullName ? String(info.venue.fullName) : null,
  }
}
