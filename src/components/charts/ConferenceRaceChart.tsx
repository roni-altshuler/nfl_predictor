import { pct } from '@/lib/format'
import type { ConferenceRace } from '@/lib/history'

/**
 * The conference race as a line per contender.
 *
 * **Change over time is the one job on this site that a line does and a table
 * cannot.** Every other surface here answers "what is true now"; this one
 * answers "how did it get there", and the shape of the answer — a team
 * climbing steadily, a favourite falling off a cliff in one week — is
 * invisible in any ranked list, however many columns it has.
 *
 * Design decisions, in the order the dataviz procedure takes them:
 *
 * - **Form**: a quantity over ordered time, several series → line chart. Not
 *   bars: the reader's question is the trajectory, not the value at any one
 *   checkpoint.
 * - **Colour by job**: three categorical slots carrying ENTITY identity —
 *   `--viz-cat-1/2/3`, the validated trio. The aggregated tail is
 *   `--viz-cat-field`, a deliberate de-emphasis rather than a fourth hue.
 * - **Validated, not eyeballed**: re-run with `--pairs all`, because every
 *   line is visible at once and adjacent-only checking misses the pair a
 *   reader actually confuses. `#5fa657,#3987e5,#c25ba6` passes; every
 *   four-hue set tried failed. See the token block in `globals.css`.
 * - **Identity is never colour alone.** Tritan separation for the trio is
 *   ΔE 5.7, below the floor colour alone may carry, so each line is
 *   direct-labelled at its right edge and those labels are **nudged apart
 *   before drawing** — two on one row means a team disappears entirely for a
 *   colour-blind reader.
 * - **Text wears text tokens.** The end labels are ink; the swatch beside the
 *   name carries identity.
 *
 * **Three named lines and a field, never sixteen.** Conference-title
 * probabilities sum to one inside a conference, so three leaders plus an
 * aggregated field account for the whole distribution: nothing is dropped
 * from this chart, it is folded, and the caption says so.
 *
 * **Time is the x-axis, not the checkpoint index.** The live tracker runs
 * daily and the replay steps once per week; plotting by index would stretch a
 * gap in the run history into a straight, confident line.
 *
 * **`basis` is printed, always.** A live line was published in advance. A
 * replay is a reconstruction that nobody read at the time. Drawing them with
 * one component makes labelling them the component's job.
 */

const W = 640
const H = 260
const PAD = { top: 14, right: 74, bottom: 30, left: 40 }
const LINE_COLORS = ['var(--viz-cat-1)', 'var(--viz-cat-2)', 'var(--viz-cat-3)']

interface Track {
  key: string
  label: string
  color: string
  values: Array<number | null>
  isField: boolean
}

export function ConferenceRaceChart({
  race,
  conference,
}: {
  race: ConferenceRace
  conference: string
}) {
  const checkpoints = race.checkpoints ?? []
  const members = Object.values(race.teams ?? {}).filter(
    (t) => t.conference === conference,
  )

  if (checkpoints.length < 2 || !members.length) {
    return <NotYetALine race={race} conference={conference} />
  }

  const named = race.named_per_conference || 3
  const latest = checkpoints[checkpoints.length - 1].probabilities ?? {}
  const ranked = [...members].sort(
    (a, b) => (latest[b.abbreviation] ?? 0) - (latest[a.abbreviation] ?? 0),
  )
  const leaders = ranked.slice(0, named)
  const rest = ranked.slice(named)

  const tracks: Track[] = leaders.map((team, i) => ({
    key: team.abbreviation,
    label: team.abbreviation,
    color: LINE_COLORS[i % LINE_COLORS.length],
    isField: false,
    values: checkpoints.map((c) => c.probabilities?.[team.abbreviation] ?? null),
  }))
  if (rest.length) {
    tracks.push({
      key: '__field',
      label: 'field',
      color: 'var(--viz-cat-field)',
      isField: true,
      values: checkpoints.map((c) =>
        rest.reduce((sum, t) => sum + (c.probabilities?.[t.abbreviation] ?? 0), 0),
      ),
    })
  }

  const times = checkpoints.map((c) => new Date(`${c.date}T00:00:00Z`).getTime())
  const tMin = times[0]
  const span = Math.max(1, times[times.length - 1] - tMin)

  const peak = Math.max(0.35, ...tracks.flatMap((t) => t.values.map((v) => v ?? 0)))
  const yMax = Math.min(1, Math.ceil((peak + 0.05) * 10) / 10)

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + ((times[i] - tMin) / span) * plotW
  const y = (v: number) => PAD.top + (1 - v / yMax) * plotH

  // Only THIS conference's champion is a comment on THIS chart. The AFC panel
  // noting that an NFC team is missing from its three lines reads as a
  // finding; it is a tautology.
  const champion =
    race.champion && race.champion_conference === conference ? race.champion : null

  const labelY = deCollide(
    tracks.map((track) => {
      const index = lastPresent(track.values)
      return index < 0 ? null : y(track.values[index] as number)
    }),
    11,
    PAD.top,
    PAD.top + plotH,
  )

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
        {tracks.map((track) => (
          <span
            key={track.key}
            className={
              track.isField
                ? 'inline-flex items-center gap-2 text-[var(--text-tertiary)]'
                : 'inline-flex items-center gap-2 text-[var(--text-secondary)]'
            }
          >
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4"
              style={{ background: track.color }}
            />
            {track.isField
              ? `the other ${rest.length}`
              : nameOf(race, track.key)}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-[720px]"
        role="img"
        aria-label={`Probability of winning the ${conference} over the ${race.season} season. ${tracks
          .map(
            (t) =>
              `${t.isField ? 'The field' : t.label}: ${pct(t.values[0] ?? 0, 0)} at the start, ${pct(
                t.values[t.values.length - 1] ?? 0,
                0,
              )} at the end.`,
          )
          .join(' ')}`}
      >
        {yTicks(yMax).map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              y1={y(value)}
              x2={PAD.left + plotW}
              y2={y(value)}
              stroke="var(--viz-grid)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={y(value) + 3}
              fill="var(--text-tertiary)"
              fontSize="9"
              textAnchor="end"
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {Math.round(value * 100)}%
            </text>
          </g>
        ))}

        {tracks.map((track, trackIndex) => {
          const points = track.values
            .map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
            .filter(Boolean) as string[]
          if (points.length < 2) return null
          const lastIndex = lastPresent(track.values)
          return (
            <g key={track.key}>
              <path
                d={`M${points.join('L')}`}
                fill="none"
                stroke={track.color}
                strokeWidth={track.isField ? 1.5 : 2}
                strokeDasharray={track.isField ? '4 3' : undefined}
                opacity={track.isField ? 0.75 : 1}
              />
              {/* Hit targets bigger than the mark, per the interaction spec:
                  an invisible 7px circle on a 2px line, and a native <title>
                  so the hover layer is also read by assistive tech. */}
              {track.values.map((v, i) =>
                v == null ? null : (
                  <circle key={i} cx={x(i)} cy={y(v)} r="7" fill="transparent">
                    <title>
                      {`${track.isField ? 'The field' : nameOf(race, track.key)} · ${
                        checkpoints[i].week != null
                          ? `after week ${checkpoints[i].week}`
                          : checkpoints[i].date
                      } · ${pct(v, 1)} (${checkpoints[i].games_played} games banked)`}
                    </title>
                  </circle>
                ),
              )}
              {lastIndex >= 0 && labelY[trackIndex] != null ? (
                <>
                  {/* A leader from the line's real end to its nudged label,
                      so the nudge never becomes a misreading. */}
                  <line
                    x1={x(lastIndex) + 2}
                    y1={y(track.values[lastIndex] as number)}
                    x2={x(lastIndex) + 6}
                    y2={labelY[trackIndex] as number}
                    stroke={track.color}
                    strokeWidth="1"
                    opacity="0.6"
                  />
                  <text
                    x={x(lastIndex) + 8}
                    y={(labelY[trackIndex] as number) + 3}
                    fill={
                      track.isField
                        ? 'var(--text-tertiary)'
                        : 'var(--text-primary)'
                    }
                    fontSize="10"
                    fontFamily="var(--font-mono-numeric), monospace"
                  >
                    {track.label} {pct(track.values[lastIndex] as number, 0)}
                  </text>
                </>
              ) : null}
            </g>
          )
        })}

        {[0, Math.floor((checkpoints.length - 1) / 2), checkpoints.length - 1].map(
          (i, n) => (
            <text
              key={`${i}-${n}`}
              x={x(i)}
              y={PAD.top + plotH + 16}
              fill="var(--text-tertiary)"
              fontSize="9"
              textAnchor={n === 0 ? 'start' : n === 2 ? 'end' : 'middle'}
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {checkpoints[i].week != null
                ? `wk ${checkpoints[i].week}`
                : shortDate(checkpoints[i].date)}
            </text>
          ),
        )}
      </svg>

      <figcaption className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        {race.basis === 'backtest' ? (
          <>
            <span className="text-[var(--accent-warn)]">A reconstruction.</span>{' '}
            Each week boundary was re-simulated from ratings built on games
            strictly earlier than it, so the model never saw the future — but
            nobody read these numbers on those dates.
            {champion && leaders.some((t) => t.abbreviation === champion) ? (
              <> {nameOf(race, champion)} went on to win the Super Bowl.</>
            ) : champion ? (
              <>
                {' '}
                {nameOf(race, champion)} won the Super Bowl from outside the
                three leaders here — which is the sort of thing this chart
                exists to show.
              </>
            ) : null}
          </>
        ) : (
          <>
            One point per day the forecast ran. These numbers were published in
            advance.
          </>
        )}{' '}
        Probabilities inside a conference sum to one, so the {leaders.length}{' '}
        named contenders and the field account for all {members.length} teams —
        nothing is dropped.
      </figcaption>

      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-[var(--accent-info)]">
          Table view
        </summary>
        <div className="card mt-2 overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th scope="col">{checkpoints[0].week != null ? 'Week' : 'Date'}</th>
                <th scope="col" className="numeric text-right">
                  Games
                </th>
                {tracks.map((t) => (
                  <th key={t.key} scope="col" className="numeric text-right">
                    {t.isField ? 'Field' : t.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {checkpoints.map((c, i) => (
                <tr key={c.date}>
                  <td className="numeric">{c.week != null ? c.week : c.date}</td>
                  <td className="numeric text-right text-[var(--text-tertiary)]">
                    {c.games_played}
                  </td>
                  {tracks.map((t) => (
                    <td key={t.key} className="numeric text-right">
                      {t.values[i] == null ? '—' : pct(t.values[i] as number, 1)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}

/**
 * What a line looks like before there is a line.
 *
 * Shown rather than hidden: an empty chart area and a missing chart look the
 * same to a reader, and only one of them is the truth here.
 */
function NotYetALine({
  race,
  conference,
}: {
  race: ConferenceRace
  conference: string
}) {
  const members = Object.values(race.teams ?? {}).filter(
    (t) => t.conference === conference,
  )
  const latest = race.checkpoints?.[race.checkpoints.length - 1]
  const leaders = members
    .map((t) => ({ team: t, p: latest?.probabilities?.[t.abbreviation] ?? 0 }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 5)

  return (
    <div>
      <p className="text-xs leading-relaxed text-[var(--text-tertiary)]">
        {!race.checkpoints?.length
          ? 'No projection has been tracked yet.'
          : `One snapshot so far, taken ${latest?.date}. A line needs two points, and the second arrives the next time the forecast runs — the pipeline appends one per day, so this becomes a race as the season is played.`}
      </p>
      {leaders.length ? (
        <ul className="mt-3 space-y-1">
          {leaders.map(({ team, p }) => (
            <li
              key={team.abbreviation}
              className="flex items-baseline justify-between gap-3 text-xs"
            >
              <span className="text-[var(--text-secondary)]">{team.name}</span>
              <span className="numeric text-[var(--text-primary)]">{pct(p)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function nameOf(race: ConferenceRace, abbreviation: string): string {
  return race.teams?.[abbreviation]?.name ?? abbreviation
}

/**
 * Push overlapping end-labels apart, preserving their vertical order.
 *
 * Two lines that finish a percentage point apart put their labels on the same
 * pixel row and the second one wins — so the reader sees three lines and two
 * labels. Because the direct label is the ONLY channel carrying identity for
 * a colour-blind reader here, that is a team disappearing, not a cosmetic
 * problem.
 *
 * Sorted by position, spaced by at least `gap`, then the whole stack is
 * shifted back inside the plot if it overflowed. Order is preserved rather
 * than recomputed, which is what makes this safe: a label never crosses
 * another, so it still points at the line it names.
 */
function deCollide(
  positions: Array<number | null>,
  gap: number,
  top: number,
  bottom: number,
): Array<number | null> {
  const present = positions
    .map((value, index) => ({ value, index }))
    .filter((item): item is { value: number; index: number } => item.value != null)
    .sort((a, b) => a.value - b.value)

  let previous = -Infinity
  for (const item of present) {
    const next = Math.max(item.value, previous + gap)
    item.value = next
    previous = next
  }

  // If the stack ran off the bottom, slide it up as a block rather than
  // compressing it — compression puts two labels back on one row.
  const overflow = present.length ? present[present.length - 1].value - bottom : 0
  if (overflow > 0) {
    for (const item of present) item.value -= overflow
  }
  for (const item of present) item.value = Math.max(top, item.value)

  const out: Array<number | null> = positions.map(() => null)
  for (const item of present) out[item.index] = item.value
  return out
}

function lastPresent(values: Array<number | null>): number {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] != null) return i
  }
  return -1
}

function yTicks(max: number): number[] {
  const step = max > 0.6 ? 0.25 : max > 0.35 ? 0.1 : 0.05
  const out: number[] = []
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100)
  return out
}

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
