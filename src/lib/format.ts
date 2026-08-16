/**
 * Display formatting.
 *
 * **Every probability renders as text**, never as colour alone. Colour in
 * this design system carries meaning, but it is always secondary encoding —
 * a reader who cannot distinguish the accent from the loss colour must still
 * get the whole number.
 */

/** A probability as a percentage string. `null` renders as absent. */
export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

/**
 * A probability that is small but not zero.
 *
 * A team on 0.04% is not eliminated, and printing "0.0%" says it is. The
 * distinction matters most exactly where it is least visible, so anything
 * under a tenth of a percent renders as `<0.1%` and a true zero renders as a
 * dash.
 */
export function longshot(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  if (value === 0) return '—'
  if (value < 0.001) return '<0.1%'
  return `${(value * 100).toFixed(1)}%`
}

/** A signed point margin, always with its sign. */
export function signed(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`
}

/** An American moneyline, with its sign. */
export function moneyline(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value > 0 ? '+' : ''}${Math.round(value)}`
}

/**
 * A win-loss-tie record.
 *
 * **The tie column is dropped when it is zero and shown when it is not.**
 * Printing `10-7-0` on every row is noise; printing `10-7` on a team that
 * tied loses a real result.
 */
export function record(
  wins: number,
  losses: number,
  ties = 0,
  digits = 0,
): string {
  const w = wins.toFixed(digits)
  const l = losses.toFixed(digits)
  if (ties >= 0.5) return `${w}-${l}-${ties.toFixed(digits)}`
  return `${w}-${l}`
}

/** A spread from the home side's perspective. */
export function spread(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  if (value === 0) return 'PK'
  return `${value > 0 ? '+' : ''}${value}`
}

const WEEKDAY = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'America/New_York',
})

const TIME = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/New_York',
})

/**
 * Kickoff, in US Eastern.
 *
 * **Eastern, not UTC and not the reader's locale.** The NFL schedules in
 * Eastern and every broadcast window is named in it, so a Sunday 1pm game is
 * "Sun 1:00 PM" to everyone who follows the sport. Rendering it in UTC moves
 * Sunday night games to Monday, and rendering it in the reader's zone makes
 * two people describing the same slate disagree.
 */
export function kickoff(iso: string): string {
  const date = new Date(iso)
  return `${WEEKDAY.format(date)} · ${TIME.format(date)} ET`
}

export function kickoffDay(iso: string): string {
  return WEEKDAY.format(new Date(iso))
}

/** An ISO timestamp as a plain date, for "generated at" lines. */
export function stamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso))
}

/** ESPN's team logo for an abbreviation. */
export function logoUrl(abbreviation: string): string {
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${abbreviation.toLowerCase()}.png`
}
