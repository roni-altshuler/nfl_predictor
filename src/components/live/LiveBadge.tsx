'use client'

import { useLiveGame } from '@/components/live/liveStore'

/**
 * The game-day state of one fixture: a pulsing dot and the score while it
 * is being played, the final score once it is done, nothing at all before —
 * on every other day of the season this renders null and costs nothing.
 *
 * The score reads away-first, matching how every scorebug in the sport is
 * written. The red is `--accent-loss`, which is the design system's LIVE
 * colour, not a judgement.
 */
export function LiveBadge({
  gameId,
  kickoff,
  away,
  home,
}: {
  gameId: string
  kickoff: string
  away: string
  home: string
}) {
  const live = useLiveGame(gameId, kickoff)
  if (!live || live.state === 'pre') return null

  if (live.state === 'in') {
    return (
      <span
        className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--live-text)]"
        aria-label={`Live: ${away} ${live.awayScore}, ${home} ${live.homeScore}, ${live.detail}`}
      >
        <span className="relative inline-flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-loss)] opacity-70" />
          <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-loss)]" />
        </span>
        {live.awayScore}–{live.homeScore} · {live.detail}
      </span>
    )
  }

  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
      final {live.awayScore}–{live.homeScore}
    </span>
  )
}
