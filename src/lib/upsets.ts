import {
  getArchivedSeason,
  getSeasonsIndex,
  type ArchivedGame,
} from '@/lib/archive'

/**
 * Cross-season boards for the upsets page.
 *
 * Everything here is read from the published archive and sorted — no
 * probability is computed. Runs at build time over ~24 season files, which
 * is cheap, and the result is a static page.
 *
 * **Ties are excluded from the upset board rather than assigned a winner.**
 * A game that finished level has no winner whose probability could have
 * been too low. They remain eligible for the margin board, where the miss
 * is real either way.
 */

export interface BoardGame extends ArchivedGame {
  season: number
  /** Probability the model gave the side that actually won. */
  gave_winner: number | null
  /** Probability the market gave the side that actually won. */
  market_gave_winner: number | null
  /** Actual margin minus expected margin, home perspective. */
  margin_miss: number | null
}

let cache: BoardGame[] | null = null

function allScoredGames(): BoardGame[] {
  if (cache) return cache
  const seasons = getSeasonsIndex()?.seasons ?? []
  const games: BoardGame[] = []
  for (const entry of seasons) {
    const data = getArchivedSeason(entry.season)
    if (!data) continue
    for (const game of data.games) {
      if (game.p_home === null) continue
      const decided = game.home_score !== game.away_score
      const homeWon = game.home_score > game.away_score
      games.push({
        ...game,
        season: entry.season,
        gave_winner: decided ? (homeWon ? game.p_home : 1 - game.p_home) : null,
        market_gave_winner:
          decided && game.p_market !== null
            ? homeWon
              ? game.p_market
              : 1 - game.p_market
            : null,
        margin_miss:
          game.exp_margin !== null
            ? game.home_score - game.away_score - game.exp_margin
            : null,
      })
    }
  }
  cache = games
  return games
}

/** The games the model was most sure would go the other way. */
export function biggestUpsets(limit = 15): BoardGame[] {
  return allScoredGames()
    .filter((g) => g.gave_winner !== null)
    .sort((a, b) => a.gave_winner! - b.gave_winner!)
    .slice(0, limit)
}

/**
 * The games where model and market disagreed hardest — and who was right.
 * Requires a priced game; unpriced games are excluded, not compared
 * against nothing.
 */
export function widestDisagreements(limit = 15): BoardGame[] {
  return allScoredGames()
    .filter((g) => g.gave_winner !== null && g.market_gave_winner !== null)
    .sort(
      (a, b) =>
        Math.abs(b.gave_winner! - b.market_gave_winner!) -
        Math.abs(a.gave_winner! - a.market_gave_winner!),
    )
    .slice(0, limit)
}

/** The margins furthest from the projection, either direction. */
export function biggestMarginMisses(limit = 15): BoardGame[] {
  return allScoredGames()
    .filter((g) => g.margin_miss !== null)
    .sort((a, b) => Math.abs(b.margin_miss!) - Math.abs(a.margin_miss!))
    .slice(0, limit)
}

export function scoredGameCount(): number {
  return allScoredGames().length
}
