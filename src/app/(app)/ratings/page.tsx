import { getPowerRatings } from '@/lib/artifacts'
import { logoUrl, stamp } from '@/lib/format'

export const dynamic = 'force-static'

/**
 * All 32 power ratings.
 *
 * These are the ratings AFTER the offseason regression toward the mean —
 * `forecast_season` calls `regress_to_season` before publishing, because a
 * projection built on end-of-last-season ratings skips the single most
 * valuable Elo setting the sweep found. The page says so rather than
 * printing a number whose basis is invisible.
 */
export default function RatingsPage() {
  const ratings = getPowerRatings()

  if (!ratings) {
    return (
      <p className="font-mono text-sm text-[var(--text-tertiary)]">
        No ratings published.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
          {ratings.season} season
        </p>
        <h1 className="mt-2 text-3xl font-semibold uppercase tracking-[0.1em]">
          Power ratings
        </h1>
        <p className="mt-2 font-mono text-[11px] text-[var(--text-tertiary)]">
          Elo · published {stamp(ratings.generated_at)}
          {ratings.carryover_applied
            ? ' · offseason regression applied'
            : ' · NO offseason regression'}
        </p>
      </header>

      <ol className="divide-y divide-[var(--border-color)] rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--card-bg)]">
        {ratings.teams.map((team, index) => (
          <li key={team.team_id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-6 font-mono text-[11px] text-[var(--text-tertiary)]">
              {index + 1}
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl(team.abbreviation)}
              alt=""
              width={22}
              height={22}
              className="h-[22px] w-[22px] rounded bg-white/90 p-0.5"
            />
            <span className="flex-1 truncate text-sm text-[var(--text-secondary)]">
              {team.name}
            </span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] sm:block">
              {team.division}
            </span>
            <span className="w-16 text-right font-mono text-sm text-[var(--text-primary)]">
              {team.elo.toFixed(0)}
            </span>
          </li>
        ))}
      </ol>

      <p className="font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        100 rating points is worth about 3.4 points of margin, measured on the
        2002–2025 corpus. The scale is not comparable to the sibling NBA
        project&apos;s, whose conversion depends on a different k-factor and a
        different margin-of-victory multiplier.
      </p>
    </div>
  )
}
