import Link from 'next/link'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import type { TeamProjection } from '@/lib/artifacts'
import { CARD_H, CARD_W, nodeId, planBracket, roundName } from '@/lib/bracketLayout'
import { longshot } from '@/lib/format'

/**
 * The road to the Super Bowl, before any of it has been played.
 *
 * **Only the first round is drawn as matchups, and every later cell shows the
 * likeliest occupant with its MARGINAL probability of getting there.** That is
 * a deliberate refusal, and it is the single most important thing about this
 * component.
 *
 * Advancing the modal winner and re-pricing the next round draws a far more
 * satisfying board — a full tree, every game filled in. It is also wrong twice
 * over here:
 *
 * 1. It compounds one seeding assumption three rounds deep and publishes the
 *    result as a Super Bowl probability, when the simulation already has a
 *    correctly-marginalised one.
 * 2. **The NFL reseeds after every round.** So even granting the seeding, the
 *    divisional pairing is not determined by the first round alone — the top
 *    seed plays whichever of three survivors is worst, which depends on the
 *    other two games. There is no honest line to draw from a wild-card card to
 *    a divisional card before the wild-card games are played, and this board
 *    does not draw one.
 *
 * The first-round cards ARE real matchups, because 2v7, 3v6 and 4v5 are fixed
 * by the seeds. Each side carries its probability of actually holding that
 * seed, so a card between two teams that are 30% each to be there does not
 * read like a fixture.
 *
 * Every number is read from `season_projections.json`. Nothing here computes a
 * probability.
 */

interface Slot {
  team: TeamProjection | null
  /** The probability the header prints for this cell. */
  probability: number
  seed: number
}

export function ProjectedBracket({
  teams,
  seedsPerConference,
  byesPerConference,
}: {
  teams: TeamProjection[]
  seedsPerConference: number
  byesPerConference: number
}) {
  const geometry = planBracket(byesPerConference)
  const conferences = [...new Set(teams.map((t) => t.conference))].sort()

  const seededBy = new Map<string, Slot[]>()
  for (const conference of conferences) {
    seededBy.set(
      conference,
      modalSeeding(
        teams.filter((t) => t.conference === conference),
        seedsPerConference,
      ),
    )
  }

  const champion = [...teams].sort(
    (a, b) => b.p_championship - a.p_championship,
  )[0]

  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <div
          className="relative"
          style={{ width: geometry.width, height: geometry.height }}
        >
          {conferences.map((conference, index) => {
            const side = index === 0 ? 'left' : 'right'
            const seeds = seededBy.get(conference) ?? []
            const byes = seeds.slice(0, byesPerConference)
            const playing = seeds.slice(byesPerConference)

            // 2v7, 3v6, 4v5 — the outside-in pairing the league fixes by
            // seed. The later rounds have no fixed pairing at all.
            const pairs: [Slot, Slot][] = []
            for (let i = 0; i < Math.floor(playing.length / 2); i += 1) {
              pairs.push([playing[i], playing[playing.length - 1 - i]])
            }

            const contenders = [...teams]
              .filter((t) => t.conference === conference)
              .sort((a, b) => b.p_conference_title - a.p_conference_title)

            return (
              <div key={conference}>
                {byes.map((slot, row) => (
                  <Cell key={`bye-${row}`} node={geometry.byId[nodeId(side, 0, row)]}>
                    <ByeCard slot={slot} />
                  </Cell>
                ))}
                {pairs.map((pair, index2) => (
                  <Cell
                    key={`wc-${index2}`}
                    node={geometry.byId[nodeId(side, 0, byes.length + index2)]}
                  >
                    <MatchupCard away={pair[1]} home={pair[0]} />
                  </Cell>
                ))}
                {[0, 1].map((row) => (
                  <Cell key={`div-${row}`} node={geometry.byId[nodeId(side, 1, row)]}>
                    <OccupantCard
                      team={rank(teams, conference, 'p_divisional_round', row)}
                      metric="p_divisional_round"
                      label="to divisional"
                    />
                  </Cell>
                ))}
                <Cell node={geometry.byId[nodeId(side, 2, 0)]}>
                  <OccupantCard
                    team={contenders[0]}
                    metric="p_conference_title"
                    label={`to win the ${conference.startsWith('American') ? 'AFC' : 'NFC'}`}
                  />
                </Cell>
              </div>
            )
          })}

          <Cell node={geometry.byId[nodeId('centre', 3, 0)]}>
            <OccupantCard
              team={champion}
              metric="p_championship"
              label="Super Bowl"
              emphasis
            />
          </Cell>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        {[0, 1, 2, 3].map((round) => (
          <span key={round}>{roundName(round)}</span>
        ))}
      </div>

      <div className="mt-4 space-y-2 font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        <p>
          <strong className="text-[var(--text-secondary)]">
            Only the first column is a matchup.
          </strong>{' '}
          2v7, 3v6 and 4v5 are fixed by the seeds, so those cards name two
          teams — each with the probability it actually holds that seed. Every
          later cell names its likeliest occupant and the probability that team
          reaches that round, taken straight from the simulation.
        </p>
        <p>
          <strong className="text-[var(--text-secondary)]">
            There are no connectors, deliberately.
          </strong>{' '}
          The NFL reseeds after every round — the top seed plays whichever
          survivor is worst — so there is no line from a wild-card card to a
          divisional card that is true before the wild-card games are played.
          Drawing one, and advancing the modal winner through it, would compound
          a single seeding assumption three rounds deep and publish the result
          as a Super Bowl number the simulation already computes correctly.
        </p>
      </div>
    </div>
  )
}

function Cell({
  node,
  children,
}: {
  node: { x: number; y: number } | undefined
  children: React.ReactNode
}) {
  if (!node) return null
  return (
    <div
      className="absolute"
      style={{ left: node.x, top: node.y, width: CARD_W, height: CARD_H }}
    >
      {children}
    </div>
  )
}

/**
 * The modal seeding: for each seed in turn, the team most likely to hold it
 * that has not already been placed.
 *
 * Greedy rather than an assignment solve, and the difference matters less than
 * the honesty about it: this is one plausible ordering, and every card carries
 * the probability that its occupant is actually there.
 */
function modalSeeding(teams: TeamProjection[], seeds: number): Slot[] {
  const taken = new Set<number>()
  const out: Slot[] = []
  for (let seed = 1; seed <= seeds; seed += 1) {
    let best: TeamProjection | null = null
    let bestP = -1
    for (const team of teams) {
      if (taken.has(team.team_id)) continue
      const p = team.seed_distribution?.[String(seed)] ?? 0
      if (p > bestP) {
        bestP = p
        best = team
      }
    }
    if (best) taken.add(best.team_id)
    out.push({ team: best, probability: Math.max(bestP, 0), seed })
  }
  return out
}

function rank(
  teams: TeamProjection[],
  conference: string,
  metric: keyof TeamProjection,
  index: number,
): TeamProjection | undefined {
  return [...teams]
    .filter((t) => t.conference === conference)
    .sort((a, b) => (b[metric] as number) - (a[metric] as number))[index]
}

function MatchupCard({ away, home }: { away: Slot; home: Slot }) {
  return (
    <div className="flex h-full flex-col justify-center gap-0.5 rounded-sm border border-[var(--border-color)] bg-[var(--card-bg)] px-2 py-1">
      <SeedRow slot={away} />
      <SeedRow slot={home} />
    </div>
  )
}

function SeedRow({ slot }: { slot: Slot }) {
  if (!slot.team) {
    return (
      <span className="numeric text-[11px] text-[var(--text-tertiary)]">
        {slot.seed} —
      </span>
    )
  }
  return (
    <Link
      href={`/teams/${slot.team.abbreviation}`}
      className="flex items-center gap-1.5 transition-colors hover:text-[var(--text-primary)]"
    >
      <span className="w-3 shrink-0 numeric text-[9px] text-[var(--text-tertiary)]">
        {slot.seed}
      </span>
      <TeamLogo abbreviation={slot.team.abbreviation} size={14} />
      <span className="flex-1 truncate font-mono text-[11px] text-[var(--text-secondary)]">
        {slot.team.abbreviation}
      </span>
      <span className="numeric text-[9px] text-[var(--text-tertiary)]">
        {longshot(slot.probability)}
      </span>
    </Link>
  )
}

function ByeCard({ slot }: { slot: Slot }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-0.5 rounded-sm border border-dashed border-[var(--border-color)] px-2">
      {slot.team ? (
        <Link
          href={`/teams/${slot.team.abbreviation}`}
          className="flex items-center gap-1.5 hover:underline"
        >
          <TeamLogo abbreviation={slot.team.abbreviation} size={16} />
          <span className="font-mono text-[11px] text-[var(--text-secondary)]">
            {slot.team.abbreviation}
          </span>
        </Link>
      ) : null}
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        bye · {longshot(slot.probability)}
      </span>
    </div>
  )
}

function OccupantCard({
  team,
  metric,
  label,
  emphasis = false,
}: {
  team: TeamProjection | undefined
  metric: keyof TeamProjection
  label: string
  emphasis?: boolean
}) {
  if (!team) {
    return (
      <div className="flex h-full items-center justify-center rounded-sm border border-[var(--border-color)] px-2 font-mono text-[10px] text-[var(--text-tertiary)]">
        —
      </div>
    )
  }
  return (
    <Link
      href={`/teams/${team.abbreviation}`}
      className={
        emphasis
          ? 'flex h-full flex-col items-center justify-center gap-0.5 rounded-sm border border-[var(--accent-primary)] bg-[var(--card-bg)] px-2 transition-colors hover:bg-[var(--card-hover)]'
          : 'flex h-full flex-col items-center justify-center gap-0.5 rounded-sm border border-[var(--border-color)] bg-[var(--card-bg)] px-2 transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)]'
      }
    >
      <span className="flex items-center gap-1.5">
        <TeamLogo abbreviation={team.abbreviation} size={16} />
        <span className="font-mono text-[11px] text-[var(--text-primary)]">
          {team.abbreviation}
        </span>
      </span>
      <span
        className={
          emphasis
            ? 'numeric text-[11px] text-[var(--accent-primary)]'
            : 'numeric text-[10px] text-[var(--text-secondary)]'
        }
      >
        {longshot(team[metric] as number)}
      </span>
      <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
        {label}
      </span>
    </Link>
  )
}
