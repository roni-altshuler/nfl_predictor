'use client'

import Link from 'next/link'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import { kickoff, pct } from '@/lib/format'
import { useWatchlist } from '@/lib/watchlist'

/**
 * The followed teams' next kickoffs, one glance, one tap each.
 *
 * Renders nothing until the reader follows a team, so a first visit sees
 * no empty section. The per-team next fixture is computed server-side and
 * passed down — this component only intersects it with the watchlist.
 */

export interface NextFixture {
  game_id: string
  opponent: string
  opponentName: string
  home: boolean
  date_utc: string
  p_win: number
}

export function FollowingStrip({
  fixtures,
}: {
  fixtures: Record<string, NextFixture>
}) {
  const watchlist = useWatchlist()
  if (!watchlist.length) return null

  const rows = watchlist
    .map((abbr) => ({ abbr, next: fixtures[abbr] }))
    .filter((r): r is { abbr: string; next: NextFixture } => Boolean(r.next))
  if (!rows.length) return null

  return (
    <section aria-label="Following">
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
        Following
      </h2>
      <div className="flex flex-wrap gap-2">
        {rows.map(({ abbr, next }) => (
          <Link
            key={abbr}
            href={`/games/${next.game_id}`}
            className="inline-flex min-h-[36px] items-center gap-2 rounded-sm border border-[var(--border-color)] bg-[var(--card-bg)] px-2.5 py-1.5 transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)]"
          >
            <TeamLogo abbreviation={abbr} size={18} />
            <span className="font-mono text-[11px] text-[var(--text-secondary)]">
              {next.home ? 'vs' : '@'} {next.opponent}
            </span>
            <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
              {kickoff(next.date_utc)}
            </span>
            <span
              className={
                next.p_win >= 0.5
                  ? 'font-mono text-[11px] text-[var(--accent-primary)]'
                  : 'font-mono text-[11px] text-[var(--text-tertiary)]'
              }
            >
              {pct(next.p_win, 0)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
