import { TeamLabel } from '@/components/primitives/TeamLogo'
import { getPowerRatings } from '@/lib/artifacts'
import { stamp } from '@/lib/format'

export const dynamic = 'force-static'

export const metadata = { title: 'Power ratings' }

/**
 * All 32 power ratings.
 *
 * These are the ratings AFTER the offseason regression toward the mean —
 * `forecast_season` calls `regress_to_season` before publishing, because a
 * projection built on end-of-last-season ratings skips the single most
 * valuable Elo setting the sweep found. The page says so rather than
 * printing a number whose basis is invisible.
 *
 * The relative bar is scaled to the CURRENT spread of the league, worst to
 * best, matching the NBA sibling — a bar scaled from zero would render
 * thirty-two nearly full bars and say nothing.
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

  const values = ratings.teams.map((t) => t.elo)
  const best = Math.max(...values)
  const worst = Math.min(...values)
  const span = Math.max(best - worst, 1)

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
          <li
            key={team.team_id}
            className="rise flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--card-hover)]"
            style={{ '--rise-i': Math.min(index, 11) } as React.CSSProperties}
          >
            <span className="w-6 font-mono text-[11px] text-[var(--text-tertiary)]">
              {index + 1}
            </span>
            <TeamLabel
              abbreviation={team.abbreviation}
              name={team.name}
              size={22}
              className="w-44 shrink-0 text-sm sm:w-56"
            />
            <span className="hidden w-24 shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] md:block">
              {team.division}
            </span>
            <span
              className="prob-track hidden flex-1 sm:block"
              role="img"
              aria-label={`Relative strength ${Math.round(((team.elo - worst) / span) * 100)} of 100`}
            >
              <span
                className="prob-fill bar-grow block"
                style={{ width: `${Math.max(((team.elo - worst) / span) * 100, 2)}%` }}
              />
            </span>
            <span className="ml-auto w-14 text-right font-mono text-sm text-[var(--text-primary)] sm:ml-0">
              {team.elo.toFixed(0)}
            </span>
          </li>
        ))}
      </ol>

      <p className="font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        100 rating points ≈ 3.4 points of margin on the 2002–2025 corpus. Not
        comparable to the sibling projects&apos; scales.
      </p>
    </div>
  )
}
