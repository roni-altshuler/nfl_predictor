import Link from 'next/link'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import type { Bracket, BracketGame } from '@/lib/archive'
import {
  CARD_H,
  CARD_W,
  connector,
  nodeId,
  planBracket,
  roundName,
  ROUND_SLUGS,
  type BracketNode,
} from '@/lib/bracketLayout'

/**
 * A postseason that was played.
 *
 * Nothing here is simulated or reconstructed — these are results, grouped by
 * the round the ingester filed them under. The only reconstructed thing on the
 * board is the seed NUMBER, and where the pipeline could not verify that
 * reconstruction against the field that actually played, it is absent and
 * renders as a dash.
 *
 * **The connectors are computed from participation, not from tree position,
 * and that is what makes them cross.** The NFL reseeds after every round —
 * highest surviving seed plays lowest — so the winner of the 4v5 game can
 * appear in either divisional game depending on results elsewhere. Drawing
 * the edges from who actually turned up means the crossings on this board are
 * the reseeding, visible. A fixed tree would draw a tidier bracket and a false
 * one.
 */

export function PlayoffBracket({
  bracket,
  season,
}: {
  bracket: Bracket
  season: number
}) {
  const geometry = planBracket(bracket.byes_per_conference)
  const conferences = [...new Set(
    Object.values(bracket.rounds)
      .flat()
      .map((g) => g.conference)
      .filter((c): c is string => !!c),
  )].sort()

  // AFC on the left, NFC on the right — alphabetical puts "American" first,
  // which is also the order every broadcast board uses. A conference always
  // has a side; only the Super Bowl is centre, and it is placed directly.
  const sideOf = (conference: string): 'left' | 'right' =>
    conference === conferences[0] ? 'left' : 'right'

  // Placement: one card per bye, then the round's games in seed order. The
  // pipeline already sorted each round by home seed.
  const placed = new Map<string, { game?: BracketGame; bye?: string }>()

  for (const conference of conferences) {
    const side = sideOf(conference)
    let row = 0
    for (const seed of bracket.byes[conference] ?? []) {
      const team = firstAppearance(bracket, conference, seed)
      placed.set(nodeId(side, 0, row), { bye: team ?? `#${seed}` })
      row += 1
    }
    ROUND_SLUGS.slice(0, 3).forEach((slug, round) => {
      const games = (bracket.rounds[slug] ?? []).filter(
        (g) => g.conference === conference,
      )
      games.forEach((game, index) => {
        const slot = round === 0 ? row + index : index
        placed.set(nodeId(side, round, slot), { game })
      })
    })
  }

  const final = (bracket.rounds['super-bowl'] ?? [])[0]
  if (final) placed.set(nodeId('centre', 3, 0), { game: final })

  // ---- edges, from who actually appeared where.
  const edges: { from: BracketNode; to: BracketNode; side: 'left' | 'right' }[] = []
  for (const conference of conferences) {
    const side = sideOf(conference)
    for (let round = 1; round <= 2; round += 1) {
      const parents = nodesInColumn(placed, side, round)
      const children = nodesInColumn(placed, side, round - 1)
      for (const parent of parents) {
        const teams = new Set(
          [parent.entry.game?.home, parent.entry.game?.away].filter(Boolean),
        )
        for (const child of children) {
          const advanced = child.entry.bye ?? child.entry.game?.winner
          if (advanced && teams.has(advanced)) {
            const from = geometry.byId[child.id]
            const to = geometry.byId[parent.id]
            if (from && to) edges.push({ from, to, side })
          }
        }
      }
    }
    // Conference champion into the Super Bowl.
    const champ = nodesInColumn(placed, side, 2)[0]
    const centre = geometry.byId[nodeId('centre', 3, 0)]
    if (champ && centre) {
      const from = geometry.byId[champ.id]
      if (from) edges.push({ from, to: centre, side })
    }
  }

  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <div
          className="relative"
          style={{ width: geometry.width, height: geometry.height }}
        >
          <svg
            className="pointer-events-none absolute inset-0"
            width={geometry.width}
            height={geometry.height}
            aria-hidden="true"
          >
            {edges.map((edge, i) => (
              <path
                key={i}
                d={connector(edge.from, edge.to, edge.side)}
                fill="none"
                stroke="var(--border-color)"
                strokeWidth="1"
              />
            ))}
          </svg>

          {geometry.nodes.map((node) => {
            const entry = placed.get(node.id)
            return (
              <div
                key={node.id}
                className="absolute"
                style={{
                  left: node.x,
                  top: node.y,
                  width: CARD_W,
                  height: CARD_H,
                }}
              >
                {entry?.game ? (
                  <GameCardCell game={entry.game} />
                ) : entry?.bye ? (
                  <ByeCell team={entry.bye} />
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        {[0, 1, 2, 3].map((round) => (
          <span key={round}>{roundName(round)}</span>
        ))}
      </div>

      <p className="mt-3 font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        The connectors are drawn from who actually appeared in each game, not
        from a fixed tree — the NFL reseeds after every round, so the winner of
        one wild-card game can land in either divisional game. Where two lines
        cross, that is the reseeding.
        {Object.values(bracket.byes).some((b) => b.length) ? (
          <>
            {' '}
            The {bracket.byes_per_conference === 1 ? 'top seed' : 'top two seeds'} in
            each conference had a bye in {season} and enter at the divisional
            round.
          </>
        ) : null}
      </p>
    </div>
  )
}

function nodesInColumn(
  placed: Map<string, { game?: BracketGame; bye?: string }>,
  side: 'left' | 'right',
  round: number,
): { id: string; entry: { game?: BracketGame; bye?: string } }[] {
  const out: { id: string; entry: { game?: BracketGame; bye?: string } }[] = []
  for (const [id, entry] of placed) {
    if (id.startsWith(`${side}-${round}-`)) out.push({ id, entry })
  }
  return out
}

/** The first postseason game a bye team appears in, so the card can name it. */
function firstAppearance(
  bracket: Bracket,
  conference: string,
  seed: number,
): string | null {
  for (const slug of ROUND_SLUGS) {
    for (const game of bracket.rounds[slug] ?? []) {
      if (game.conference !== conference) continue
      if (game.home_seed === seed && game.home) return game.home
      if (game.away_seed === seed && game.away) return game.away
    }
  }
  return null
}

function GameCardCell({ game }: { game: BracketGame }) {
  return (
    <Link
      href={`/games/${game.game_id}`}
      className="flex h-full flex-col justify-center gap-0.5 rounded-sm border border-[var(--border-color)] bg-[var(--card-bg)] px-2 py-1 transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)]"
    >
      <SideRow
        abbr={game.away}
        seed={game.away_seed}
        score={game.away_score}
        won={game.winner === game.away}
      />
      <SideRow
        abbr={game.home}
        seed={game.home_seed}
        score={game.home_score}
        won={game.winner === game.home}
      />
    </Link>
  )
}

function SideRow({
  abbr,
  seed,
  score,
  won,
}: {
  abbr: string | null
  seed: number | null
  score: number
  won: boolean
}) {
  return (
    <span className="flex items-center gap-1.5">
      {/* A seed that could not be verified renders as a dash, never as a
          number — the pipeline withholds it and the board must not fill it
          back in. */}
      <span className="w-3 shrink-0 numeric text-[9px] text-[var(--text-tertiary)]">
        {seed ?? '—'}
      </span>
      {abbr ? <TeamLogo abbreviation={abbr} size={14} /> : null}
      <span
        className={
          won
            ? 'flex-1 truncate font-mono text-[11px] text-[var(--text-primary)]'
            : 'flex-1 truncate font-mono text-[11px] text-[var(--text-tertiary)]'
        }
      >
        {abbr ?? '—'}
      </span>
      <span
        className={
          won
            ? 'numeric text-[11px] text-[var(--accent-primary)]'
            : 'numeric text-[11px] text-[var(--text-tertiary)]'
        }
      >
        {score}
      </span>
    </span>
  )
}

function ByeCell({ team }: { team: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 rounded-sm border border-dashed border-[var(--border-color)] px-2">
      <span className="flex items-center gap-1.5">
        <TeamLogo abbreviation={team} size={16} />
        <span className="font-mono text-[11px] text-[var(--text-secondary)]">
          {team}
        </span>
      </span>
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        bye
      </span>
    </div>
  )
}
