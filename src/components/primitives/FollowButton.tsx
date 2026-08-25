'use client'

import { toggleTeam, useWatchlist } from '@/lib/watchlist'

/**
 * Follow / following, on a team page.
 *
 * A device preference (localStorage), not an account. The pressed state is
 * carried by `aria-pressed` and by words — "Following" versus "Follow" —
 * never by colour alone.
 */
export function FollowButton({ abbr }: { abbr: string }) {
  const list = useWatchlist()
  const following = list.includes(abbr)

  return (
    <button
      type="button"
      aria-pressed={following}
      onClick={() => toggleTeam(abbr)}
      className={
        following
          ? 'inline-flex min-h-[32px] items-center gap-1.5 rounded-sm border border-[var(--accent-primary)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--accent-primary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-secondary)]'
          : 'inline-flex min-h-[32px] items-center gap-1.5 rounded-sm border border-[var(--border-color)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]'
      }
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill={following ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path
          d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14l-5-4.87 7.1-1.01z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {following ? 'Following' : 'Follow'}
    </button>
  )
}
