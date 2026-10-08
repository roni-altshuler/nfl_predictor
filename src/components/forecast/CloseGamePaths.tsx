'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import type { GameForecast, GameForecasts } from '@/lib/artifacts'
import { forecastStamp, pct } from '@/lib/format'
import { marginBand, MARGIN_BANDS, predictionPaths, type MarginBand } from '@/lib/predictionPaths'

type Snapshot = Pick<GameForecasts, 'generated_at' | 'trained_through' | 'model_version'>
export function CloseGamePaths({ game, snapshot }: { game: GameForecast | null; snapshot: Snapshot | null }) {
  return <section id="paths" className="card scroll-mt-20 p-4 sm:p-6" aria-label="Close-game paths">
    <header>
      <p className="eyebrow">{game ? `${game.away} at ${game.home} · published probabilities` : 'Prediction coverage'}</p>
      <h2 className="mt-2 text-lg">Close-game paths</h2>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">Explore a narrow win, a wider win, or a tie.</p>
    </header>
    {game && snapshot ? <>
      <Suspense fallback={<PathsLoading />}><PathPicker key={game.game_id} game={game} /></Suspense>
      <dl className="mt-5 grid gap-3 border-t border-[var(--border-color)] pt-4 text-xs sm:grid-cols-2">
        <div><dt className="eyebrow">Forecast published</dt><dd className="mt-1 font-mono">{forecastStamp(snapshot.generated_at)}</dd></div>
        <div><dt className="eyebrow">Results cutoff</dt><dd className="mt-1 font-mono">{forecastStamp(snapshot.trained_through)}</dd></div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-tertiary)]">{snapshot.model_version}. Narrow wins sum published margin probabilities. Wider wins use the remainder of each team&apos;s published win chance. Ties stay separate.</p>
    </> : <p className="mt-4 border-t border-[var(--border-color)] pt-4 text-sm text-[var(--text-secondary)]">This snapshot has no pre-game forecast for this archived matchup. Retrospective win probabilities are withheld.</p>}
    <div className="mt-3 flex flex-wrap gap-x-6">
      <Link href="/accuracy#published-record" prefetch={false} className="inline-flex min-h-[44px] items-center text-sm text-[var(--accent-info)] hover:underline">Read the published-ahead record →</Link>
      {!game ? <Link href="/games" className="inline-flex min-h-[44px] items-center text-sm text-[var(--accent-info)] hover:underline">Browse published games →</Link> : null}
    </div>
  </section>
}

function PathPicker({ game }: { game: GameForecast }) {
  const params = useSearchParams()
  const [band, setBand] = useState<MarginBand>(8)
  const [ready, setReady] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  useEffect(() => {
    const selected = marginBand(new URLSearchParams(window.location.search).get('marginBand'))
    setBand(selected.band); setUnsupported(selected.unsupported); setReady(true)
  }, [params])
  const paths = predictionPaths(game, band)
  if (!ready) return <PathsLoading />
  if (!paths) return <div className="mt-4" role="status"><h3 className="text-sm">Published margin data unavailable</h3><p className="mt-2 text-sm text-[var(--text-secondary)]">This snapshot does not supply a consistent margin range. No outcome path is inferred.</p></div>
  function choose(value: string) {
    const selected = marginBand(value)
    setBand(selected.band); setUnsupported(false)
    const url = new URL(window.location.href)
    url.searchParams.set('marginBand', value); url.hash = 'paths'
    window.history.replaceState(window.history.state, '', url)
  }
  return <div className="mt-5" data-paths-ready="true" data-paths-game={game.game_id}>
    <label className="block max-w-sm"><span className="eyebrow mb-2 block">Narrow winning margin</span>
      <select className="lab-control w-full" aria-label="Narrow winning margin" value={band} onChange={event => choose(event.target.value)}>
        {MARGIN_BANDS.map(band => <option key={band} value={band}>1–{band} points</option>)}
      </select>
    </label>
    {unsupported ? <p className="lab-notice mt-3">The requested margin band is unsupported. Showing 1–8 points.</p> : null}
    <p className="mt-4 font-mono text-xs text-[var(--text-secondary)]" aria-live="polite">Winning by 1–{band} points or more than {band} · tie {pct(paths.tie, 2)}</p>
    <div className="mt-3 grid grid-cols-2 gap-3">
      {[{ team: game.away, side: 'away', close: paths.awayClose, wider: paths.awayWider },
        { team: game.home, side: 'home', close: paths.homeClose, wider: paths.homeWider }].map(({ team, side, close, wider }) =>
        <article key={side} className="min-w-0 rounded-sm border border-[var(--border-color)] p-3 sm:p-4" aria-label={`${team} winning paths`}>
          <h3 className="font-mono text-sm">{team} wins</h3>
          <dl className="mt-4 space-y-5">
            {[{ label: `By 1–${band} points`, value: close, key: 'close' }, { label: `By more than ${band}`, value: wider, key: 'wider' }].map(item =>
              <div key={item.key}><dt className="text-xs text-[var(--text-secondary)]">{item.label}</dt><dd className="numeric mt-1 text-xl sm:text-2xl" data-testid={`path-${side}-${item.key}`}>{pct(item.value, 1)}</dd>
                <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-[var(--background-tertiary)]" aria-hidden="true"><div className="h-full" style={{ width: `${item.value * 100}%`, background: `var(--viz-cat-${side === 'home' ? 1 : 2})` }} /></div>
              </div>)}
          </dl>
        </article>)}
    </div>
  </div>
}

export function PathsLoading() {
  return <div role="status" aria-label="Loading close-game paths" className="mt-5 grid grid-cols-2 gap-3"><span className="sr-only">Loading close-game controls…</span><div className="skeleton-shimmer h-56" /><div className="skeleton-shimmer h-56" /></div>
}
