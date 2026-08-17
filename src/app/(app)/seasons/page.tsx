import Link from 'next/link'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import { getSeasonsIndex, recordText } from '@/lib/archive'

export const dynamic = 'force-static'

export const metadata = { title: 'Seasons' }

/**
 * The archive index.
 *
 * Every completed season back to 2002, which is where the corpus starts and
 * that is structural rather than arbitrary: 2002 is when the league realigned
 * to 32 teams in eight four-team divisions. Before that there were 31 teams in
 * six uneven divisions with different seeding rules, and ESPN will happily
 * serve those seasons as if nothing had changed.
 */
export default function SeasonsPage() {
  const index = getSeasonsIndex()

  if (!index?.seasons?.length) {
    return (
      <p className="font-mono text-sm text-[var(--text-tertiary)]">
        No archive published.
      </p>
    )
  }

  const unverified = index.seasons.filter((s) => !s.seeds_verified).length

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
          {index.seasons.length} seasons ·{' '}
          {index.seasons[index.seasons.length - 1].season}–
          {index.seasons[0].season}
        </p>
        <h1 className="mt-2 text-3xl font-semibold uppercase tracking-[0.1em]">
          Seasons
        </h1>
        <p className="mt-2 max-w-2xl font-mono text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          The corpus starts at 2002 because that is when the league realigned
          to 32 teams in eight four-team divisions. Earlier seasons had 31
          teams, six uneven divisions and different seeding rules — ESPN will
          serve them, and they would quietly break every playoff calculation on
          this site.
        </p>
      </header>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--card-bg)]">
        <table className="w-full min-w-[620px] border-collapse">
          <thead>
            <tr className="border-b border-[var(--border-color)] text-left">
              {['season', 'champion', 'runner-up', 'best record', 'games', 'seeds'].map(
                (label) => (
                  <th
                    key={label}
                    className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
                  >
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {index.seasons.map((season) => (
              <tr
                key={season.season}
                className="border-b border-[var(--border-color)] last:border-0"
              >
                <td className="px-3 py-2.5">
                  <Link
                    href={`/seasons/${season.season}`}
                    className="font-mono text-sm text-[var(--text-primary)] hover:underline"
                  >
                    {season.season}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  {season.champion ? (
                    <span className="flex items-center gap-2">
                      <TeamLogo abbreviation={season.champion} size={18} />
                      <span className="font-mono text-[12px] text-[var(--accent-primary)]">
                        {season.champion}
                      </span>
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                      —
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-[12px] text-[var(--text-tertiary)]">
                  {season.runner_up ?? '—'}
                </td>
                <td className="px-3 py-2.5 font-mono text-[12px] text-[var(--text-secondary)]">
                  {season.best_record
                    ? `${season.best_record.abbreviation} ${recordText(
                        season.best_record.wins,
                        season.best_record.losses,
                        season.best_record.ties,
                      )}`
                    : '—'}
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-tertiary)]">
                  {season.regular_season_games} + {season.postseason_games}
                </td>
                <td className="px-3 py-2.5 font-mono text-[10px]">
                  {season.seeds_verified ? (
                    <span className="text-[var(--text-tertiary)]">verified</span>
                  ) : (
                    <span className="text-[var(--accent-warn)]">partial</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        <p>
          <strong className="text-[var(--text-secondary)]">
            The seeds column is a claim about this pipeline, not about the
            season.
          </strong>{' '}
          The warehouse stores results, not seeds, so a seed number here is a
          reconstruction from final standings — and it is checked against the
          postseason field that actually played.{' '}
          {unverified === 0
            ? 'Every season reconciles.'
            : `${unverified} of ${index.seasons.length} seasons have a conference where it does not, because they turn on the league's common-games tiebreaker, which this project does not model. Those conferences carry no seed numbers at all rather than confident wrong ones.`}
        </p>
        <p>
          2022 has 271 regular-season games rather than 272. Buffalo at
          Cincinnati was abandoned after Damar Hamlin&apos;s cardiac arrest and
          never resumed; the league declared a no-contest.
        </p>
      </div>
    </div>
  )
}
