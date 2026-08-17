/**
 * Bracket geometry — computed, never laid out.
 *
 * Every card position and every connector path is arithmetic. The component
 * absolutely positions from this and draws one `<svg>` underneath.
 *
 * **Why not nested flexbox.** The obvious implementation builds the shape from
 * nested rows with half-height bordered divs for connectors. That gets a
 * bracket approximately right and cannot be checked: whether a card sits on
 * the centre line between the two feeding it becomes an emergent property of
 * the box model rather than something anyone asserted. Here it is arithmetic,
 * and there is a test on it.
 *
 * **The NFL bracket is not a balanced tree, and this is the whole reason it
 * could not be ported from the sibling NBA project.** Two structural facts:
 *
 * 1. **A bye.** The top seed — the top two before 2020 — does not play in the
 *    first round at all. A balanced 8-slot tree would draw it against a
 *    phantom opponent. Here the bye is a card of its own in the first column,
 *    because "this team had a week off" is a fact about the bracket that a
 *    reader cannot infer from an absence.
 *
 * 2. **The bracket RESEEDS after every round.** The highest surviving seed
 *    plays the lowest surviving seed, so who a team meets next depends on
 *    games it was not playing in. There is no fixed parent for a first-round
 *    card. **So this module lays out positions and the caller supplies the
 *    edges**, from the games that were actually played. On a completed season
 *    those connectors cross, and the crossing is the reseeding made visible —
 *    it is the most informative thing on the board, not a defect in it.
 *
 * The shape is mirrored: AFC flows left-to-right, NFC right-to-left, the
 * Super Bowl in the middle. That is the shape the league itself publishes.
 */

export interface BracketNode {
  id: string
  side: 'left' | 'right' | 'centre'
  /** 0 = wild card, 1 = divisional, 2 = conference, 3 = Super Bowl. */
  round: number
  /** Row within the column, 0-indexed from the top. */
  row: number
  x: number
  y: number
  width: number
  height: number
}

export interface BracketGeometry {
  width: number
  height: number
  nodes: BracketNode[]
  byId: Record<string, BracketNode>
}

/*
 * Card metrics.
 *
 * Sized so the whole mirrored board fits a 1160px content shell at desktop:
 * six columns of (CARD_W + COL_GAP) plus the centre column comes to 1124px.
 *
 * **It pans rather than shrinking when it does not fit.** Below the shell
 * width the board scrolls horizontally; it is never scaled by a transform. A
 * bracket rendered at two-thirds size is the one thing a reader came to the
 * page for, drawn too small to read.
 */
export const CARD_W = 152
export const CARD_H = 62
export const COL_GAP = 14
export const ROW_GAP = 14

/** Rows in each column of one conference: wild card, divisional, conference. */
export const COLUMN_ROWS = [4, 2, 1]

export function nodeId(
  side: 'left' | 'right' | 'centre',
  round: number,
  row: number,
): string {
  return `${side}-${round}-${row}`
}

/**
 * Lay out one mirrored NFL postseason board.
 *
 * The first column holds `byes + firstRoundGames` rows — four in both eras,
 * which is a coincidence worth stating rather than relying on: 1 bye + 3
 * wild-card games from 2020, 2 byes + 2 wild-card games before it.
 */
export function planBracket(byes = 1): BracketGeometry {
  const firstRoundGames = 4 - byes
  const columnRows = [byes + firstRoundGames, 2, 1]

  const laneH = CARD_H + ROW_GAP
  const height = columnRows[0] * laneH
  const colW = CARD_W + COL_GAP
  const width = colW * columnRows.length * 2 + CARD_W + COL_GAP * 2

  const nodes: BracketNode[] = []

  for (const side of ['left', 'right'] as const) {
    columnRows.forEach((rows, round) => {
      const slotH = height / rows
      for (let row = 0; row < rows; row += 1) {
        nodes.push({
          id: nodeId(side, round, row),
          side,
          round,
          row,
          x: side === 'left' ? round * colW : width - CARD_W - round * colW,
          y: row * slotH + slotH / 2 - CARD_H / 2,
          width: CARD_W,
          height: CARD_H,
        })
      }
    })
  }

  nodes.push({
    id: nodeId('centre', 3, 0),
    side: 'centre',
    round: 3,
    row: 0,
    x: width / 2 - CARD_W / 2,
    y: height / 2 - CARD_H / 2,
    width: CARD_W,
    height: CARD_H,
  })

  const byId: Record<string, BracketNode> = {}
  for (const node of nodes) byId[node.id] = node

  return { width, height, nodes, byId }
}

/**
 * An elbow from one card to the card it feeds.
 *
 * Drawn per EDGE rather than per sibling pair, because reseeding means two
 * cards feeding the same parent are not necessarily adjacent — and when they
 * are not, the two elbows cross. That crossing is the point.
 *
 * The vertical segment sits in the gap between the columns, so a connector
 * never runs across a card.
 */
export function connector(
  from: BracketNode,
  to: BracketNode,
  side: 'left' | 'right',
): string {
  const fromX = side === 'left' ? from.x + from.width : from.x
  const toX = side === 'left' ? to.x : to.x + to.width
  const fromY = from.y + from.height / 2
  const toY = to.y + to.height / 2
  const midX = (fromX + toX) / 2
  return `M${fromX},${fromY} H${midX} V${toY} H${toX}`
}

/**
 * Round names, DERIVED from the column index rather than parsed from a label.
 *
 * ESPN's own vocabulary drifts across seasons, and the ingester already
 * normalises it into a slug. Anything that maps a display string back to a
 * bracket position is wrong in the seasons nobody checks.
 */
export const ROUND_SLUGS = [
  'wild-card',
  'divisional',
  'conference',
  'super-bowl',
] as const

export function roundName(round: number): string {
  return (
    ['Wild card', 'Divisional', 'Conference championship', 'Super Bowl'][round] ??
    `Round ${round}`
  )
}
