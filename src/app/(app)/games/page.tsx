import Link from 'next/link'
import { WeekBrowser } from '@/components/schedule/WeekBrowser'
import { currentWeek, getGameForecasts } from '@/lib/artifacts'
import { forecastStamp } from '@/lib/format'
import { loadSeasonRecord } from '@/lib/server/record'
import { getSeasonsIndex } from '@/lib/archive'

export const dynamic = 'force-static'
export const metadata = { title: 'Schedule' }

/** Published forecasts and recorded season results stay separate. */
export default function GamesPage() {
  const forecasts = getGameForecasts()
  const record = loadSeasonRecord()
  if ((!forecasts || !forecasts.games.length) && record.availability === 'unavailable') {
    return <section className="card p-6">
      <h1 className="text-lg">No forecasts published</h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">The current snapshot has no scheduled game probabilities. Recorded results remain separate.</p>
      <Link href="/seasons" className="mt-3 inline-flex min-h-[44px] items-center text-sm text-[var(--accent-info)] hover:underline">Browse recorded seasons →</Link>
    </section>
  }
  const weeks = [...new Set((forecasts?.games ?? []).map(game => game.week))].sort((a, b) => a - b)
  const archiveSeasons = getSeasonsIndex()?.seasons.map(season => season.season) ?? []
  return <div className="space-y-6">
    <header>
      <p className="eyebrow">{forecasts?.season ?? record.season} season</p>
      <h1 className="mt-2 text-3xl">Your NFL week.</h1>
      <p className="mt-3 font-mono text-xs text-[var(--text-tertiary)]">{forecasts?.games.length ?? 0} published fixtures · {record.counts?.settled ?? 'unknown'} recorded outcomes · forecasts and results stay separate</p>
      <dl className="mt-4 grid gap-3 border-l-2 border-[var(--accent-primary)] pl-3 text-xs sm:grid-cols-2">
        <div><dt className="text-[var(--text-tertiary)]">Forecast published</dt><dd className="mt-1 font-mono">{forecastStamp(forecasts?.generated_at)}</dd></div>
        <div><dt className="text-[var(--text-tertiary)]">Results used through</dt><dd className="mt-1 font-mono">{forecastStamp(forecasts?.trained_through)}</dd></div>
      </dl>
      <p className="mt-3 text-sm text-[var(--text-secondary)]">Pick a week. Find your teams. Open the matchup behind every probability.</p>
    </header>
    <WeekBrowser forecasts={forecasts} initialWeek={currentWeek(forecasts) ?? record.weeks[record.weeks.length - 1] ?? weeks[0] ?? 1} archiveSeasons={archiveSeasons} record={record} />
  </div>
}
