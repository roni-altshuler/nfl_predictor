import { validGame } from './forecastLab'

export const MARGIN_BANDS = [3, 7, 8] as const
export type MarginBand = typeof MARGIN_BANDS[number]
export interface PredictionPaths {
  homeClose: number; awayClose: number; homeWider: number; awayWider: number; tie: number
}

/** Summaries of one published forecast, not new predictions or fitted explanations. */
export function predictionPaths(game: unknown, band: number): PredictionPaths | null {
  if (!MARGIN_BANDS.some(value => value === band) || !validGame(game)) return null
  const d = game.margin_distribution
  if (d.low > -band || d.high < band) return null
  let homeInside = 0, awayInside = 0, homeClose = 0, awayClose = 0
  d.p.forEach((p, index) => {
    const margin = d.low + index
    if (margin > 0) homeInside += p
    if (margin < 0) awayInside += p
    if (margin >= 1 && margin <= band) homeClose += p
    if (margin >= -band && margin <= -1) awayClose += p
  })
  // The lattice is rounded more coarsely than headline probabilities. Withhold
  // contradictory sources; never allocate the unlabeled tail by an assumed shape.
  const tolerance = 0.001
  if (Math.abs(d.p[-d.low] - game.p_tie) > 0.0001 ||
      homeInside > game.p_home + tolerance || awayInside > game.p_away + tolerance ||
      Math.abs((game.p_home - homeInside) + (game.p_away - awayInside) - d.outside) > tolerance ||
      homeClose > game.p_home || awayClose > game.p_away) return null
  return { homeClose, awayClose, homeWider: game.p_home - homeClose,
    awayWider: game.p_away - awayClose, tie: game.p_tie }
}

export function marginBand(value: string | null): { band: MarginBand; unsupported: boolean } {
  const band = MARGIN_BANDS.find(band => String(band) === value)
  return { band: band ?? 8, unsupported: value !== null && band === undefined }
}
