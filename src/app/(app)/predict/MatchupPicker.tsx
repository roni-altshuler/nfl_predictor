'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import { pct, signed, spread } from '@/lib/format'
import type { Matchups } from '@/lib/history'

/**
 * Head-to-head: pick any two franchises, get the forecast.
 *
 * **Every pairing is precomputed and shipped as static JSON.** 992 ordered
 * pairs is a small file, and a lookup cannot disagree with the game
 * forecasts the way a second inference path would — same model, different
 * code, free to drift. This also means the page needs no server round-trip
 * and works offline.
 *
 * The venue swap is real rather than cosmetic: home field is the largest
 * non-rating term in the model, so reversing it reprices the game.
 *
 * **The basis is stated, not hidden.** A hypothetical meeting has no date,
 * so rest is neutral for both sides and the week is the opener. That is an
 * assumption, and a page that quietly picked one would be claiming an answer
 * to a question it was not asked.
 *
 * **The pair lives in the URL.** `?home=&away=` initialises the picker and
 * every change is written back with `router.replace`, so a matchup is a
 * link — the home page's quick picks and the game page's "price this
 * matchup" arrive here prefilled, and a reader can send one on. An unknown
 * or duplicated abbreviation falls back to the defaults rather than
 * erroring: a bad link should still land on a working picker.
 *
 * **The URL is read after mount, from `window.location`.** This page is
 * `force-static`, which makes `useSearchParams()` empty during the
 * prerender WITHOUT the usual bail-out to client rendering — so the HTML
 * carries the default pair, and a first render that read the URL would
 * mismatch it on hydration. The picker therefore renders its skeleton
 * until the mount effect has applied the URL, and only syncs the selection
 * back to the URL after that, so the incoming pair is never overwritten
 * by the defaults. `useSearchParams` is kept only as the trigger for a
 * same-page navigation (a quick-pick chip followed while already here).
 */
export function MatchupPicker({ data }: { data: Matchups }) {
  const teams = data.teams
  const router = useRouter()
  const params = useSearchParams()

  const [awayKey, setAway] = useState(teams[0]?.abbreviation ?? '')
  const [homeKey, setHome] = useState(teams[1]?.abbreviation ?? '')
  const [applied, setApplied] = useState(false)

  // The current selection through a ref, so the URL effect depends on the
  // URL alone and cannot race the write below.
  const current = useRef({ home: homeKey, away: awayKey })
  current.current = { home: homeKey, away: awayKey }

  // URL -> selection: on mount, and again whenever the router reports new
  // search params. `window.location` is the source of truth here because
  // the router's own copy is empty on the static first render.
  useEffect(() => {
    const known = (value: string | null) => {
      const key = value?.toUpperCase()
      return key && teams.some((t) => t.abbreviation === key) ? key : null
    }
    const search = new URLSearchParams(window.location.search)
    const home = known(search.get('home'))
    const away = known(search.get('away'))
    if (home && away && home !== away) {
      if (home !== current.current.home) setHome(home)
      if (away !== current.current.away) setAway(away)
    }
    setApplied(true)
  }, [params, teams])

  // Selection -> URL, only once the URL has been applied. Replace, never
  // push: dragging through five pairs should not leave five history
  // entries behind.
  useEffect(() => {
    if (!applied || !homeKey || !awayKey) return
    const next = `/predict?home=${homeKey}&away=${awayKey}`
    if (`${window.location.pathname}${window.location.search}` !== next) {
      router.replace(next, { scroll: false })
    }
  }, [applied, homeKey, awayKey, router])

  const lookup = useMemo(() => {
    const map = new Map<string, Matchups['matchups'][number]>()
    for (const m of data.matchups) map.set(`${m.home}|${m.away}`, m)
    return map
  }, [data.matchups])

  const home = teams.find((t) => t.abbreviation === homeKey)
  const away = teams.find((t) => t.abbreviation === awayKey)
  const result = lookup.get(`${homeKey}|${awayKey}`)
  const fixture = data.scheduled[`${homeKey}|${awayKey}`]

  const swap = () => {
    setHome(awayKey)
    setAway(homeKey)
  }

  if (!applied) {
    return <div className="card h-24 skeleton-shimmer" aria-hidden="true" />
  }

  return (
    <div>
      <div className="card p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <Picker
            label="Away team"
            value={awayKey}
            onChange={setAway}
            teams={teams}
            blocked={homeKey}
          />
          <button
            type="button"
            onClick={swap}
            className="h-9 rounded-sm border border-[var(--border-color)] px-3 numeric text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
            aria-label="Swap home and away"
          >
            Swap
          </button>
          <Picker
            label="Home team"
            value={homeKey}
            onChange={setHome}
            teams={teams}
            blocked={awayKey}
          />
        </div>
      </div>

      {home && away && result ? (
        <>
          <div className="card mt-4 p-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <Side team={away} elo={data.elo[away.abbreviation]} />
              <span className="numeric text-[11px] text-[var(--text-tertiary)]">
                at
              </span>
              <Side
                team={home}
                elo={data.elo[home.abbreviation]}
                align="right"
              />
            </div>

            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="numeric text-sm text-[var(--text-secondary)]">
                {pct(result.p_away)}
              </span>
              <span className="numeric text-sm text-[var(--text-secondary)]">
                {pct(result.p_home)}
              </span>
            </div>
            <div
              className="prob-track flex"
              role="img"
              aria-label={`${home.abbreviation} ${pct(result.p_home)}, ${away.abbreviation} ${pct(result.p_away)}, tie ${pct(result.p_tie)}`}
            >
              {/* prob-segment: a new selection settles into place rather
                  than snapping — the one visible payoff of the picker being
                  a client component. */}
              <span
                className="prob-segment"
                style={{
                  width: `${result.p_away * 100}%`,
                  background: 'var(--viz-cat-2)',
                }}
              />
              <span
                className="prob-segment"
                style={{
                  width: `${Math.max(result.p_tie * 100, 0.4)}%`,
                  background: 'var(--viz-reference)',
                }}
              />
              <span
                className="prob-segment"
                style={{
                  width: `${result.p_home * 100}%`,
                  background: 'var(--viz-cat-1)',
                }}
              />
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--border-color)] pt-4 sm:grid-cols-4">
              <Stat
                label="Projected margin"
                value={`${result.exp_margin >= 0 ? home.abbreviation : away.abbreviation} ${signed(Math.abs(result.exp_margin))}`}
              />
              <Stat label="Projected total" value={result.exp_total.toFixed(1)} />
              <Stat
                label="Projected score"
                value={`${Math.round(result.exp_away_score)}–${Math.round(result.exp_home_score)}`}
              />
              <Stat
                label="Rating gap"
                value={signed(
                  (data.elo[home.abbreviation] ?? 1500) -
                    (data.elo[away.abbreviation] ?? 1500),
                  0,
                )}
              />
            </dl>

            <p className="mt-3 numeric text-[10px] text-[var(--text-tertiary)]">
              tie {pct(result.p_tie, 2)}
            </p>
          </div>

          {result.key_spreads?.length ? (
            <div className="card mt-4 p-4">
              <h2 className="eyebrow mb-1">At the key numbers</h2>
              <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                Football&apos;s two most common margins — and at either, the
                push is worth real probability.
              </p>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{home.abbreviation} line</th>
                    <th scope="col" className="numeric text-right">covers</th>
                    <th scope="col" className="numeric text-right">push</th>
                    <th scope="col" className="numeric text-right">against</th>
                  </tr>
                </thead>
                <tbody>
                  {result.key_spreads.map((row) => (
                    <tr key={row.line}>
                      <td className="numeric">{spread(row.line)}</td>
                      <td className="numeric text-right">{pct(row.home_cover)}</td>
                      <td className="numeric text-right text-[var(--accent-warn)]">
                        {pct(row.push)}
                      </td>
                      <td className="numeric text-right">{pct(row.away_cover)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {fixture ? (
            <Link
              href={`/games/${fixture.game_id}`}
              className="card mt-4 flex items-center justify-between gap-3 p-4 transition-colors hover:border-[var(--border-hover)]"
            >
              <span className="text-[13px] text-[var(--text-secondary)]">
                These two actually meet in week {fixture.week}.
              </span>
              <span className="numeric shrink-0 text-[11px] text-[var(--accent-info)]">
                the real fixture →
              </span>
            </Link>
          ) : (
            <p className="mt-4 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              These two are not scheduled to meet this season, so this is a
              hypothetical.
            </p>
          )}
        </>
      ) : (
        <p className="mt-4 text-sm text-[var(--text-tertiary)]">
          Pick two different teams.
        </p>
      )}

      <p className="mt-6 border-t border-[var(--border-color)] pt-3 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        Hypothetical basis · {data.basis} · no date, so rest is neutral and
        the ratings carry the offseason regression.
      </p>
    </div>
  )
}

function Picker({
  label,
  value,
  onChange,
  teams,
  blocked,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  teams: Matchups['teams']
  blocked: string
}) {
  return (
    <label className="block">
      <span className="eyebrow mb-1.5 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-sm border border-[var(--border-color)] bg-[var(--input-bg)] px-2 text-[13px] text-[var(--text-primary)] transition-colors hover:border-[var(--border-hover)]"
      >
        {teams.map((team) => (
          <option
            key={team.abbreviation}
            value={team.abbreviation}
            disabled={team.abbreviation === blocked}
          >
            {team.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function Side({
  team,
  elo,
  align = 'left',
}: {
  team: Matchups['teams'][number]
  elo?: number
  align?: 'left' | 'right'
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-2.5 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}
    >
      <TeamLogo abbreviation={team.abbreviation} name={team.name} size={32} />
      <div className="min-w-0">
        {/* The selected side names a real franchise, so it links to it. The
            select above is the control; this is the answer, and the answer
            being a dead end is what the team pages exist to fix. */}
        <Link
          href={`/teams/${team.abbreviation}`}
          className="block truncate text-[13px] text-[var(--text-primary)] hover:underline"
        >
          {team.name}
        </Link>
        <p className="numeric text-[10px] text-[var(--text-tertiary)]">
          {team.division} · elo {elo?.toFixed(0) ?? '—'}
        </p>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="numeric mt-1 text-sm text-[var(--text-primary)]">{value}</dd>
    </div>
  )
}
