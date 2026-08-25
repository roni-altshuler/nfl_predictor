'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { markNavigation } from '@/components/primitives/BackButton'
import { cn } from '@/lib/utils'

// The chalkboard never runs on the server: ssr:false keeps the canvas out
// of the prerendered HTML (zero CLS, zero hydration cost on crawlers), the
// same loader pattern as the personal site's particle field.
const ChalkboardField = dynamic(
  () => import('@/components/background/ChalkboardField'),
  { ssr: false },
)

/**
 * The app chrome: a fixed sidebar on desktop, a bottom tab bar on mobile.
 *
 * **There is no global search.** Every destination is one tap from here, and
 * a search field printed in the chrome advertises a product bigger than this
 * one. The sibling projects each removed theirs for the same reason.
 *
 * "Seasons" is both a destination and a disclosure, ported from the NBA
 * sibling: the row links to the archive index, and a separate chevron button
 * unfolds every season inline so a reader two seasons deep can jump straight
 * to a third. The list follows the route — it opens on entering `/seasons/*`
 * and folds on leaving — and closes on Escape.
 */

export interface ShellSeason {
  season: number
  champion: string | null
}

const NAV = [
  { href: '/', label: 'This week', short: 'Week' },
  { href: '/preview', label: 'Season preview', short: 'Preview' },
  { href: '/season', label: 'Season', short: 'Season' },
  { href: '/games', label: 'Schedule', short: 'Games' },
  { href: '/bracket', label: 'Road to the Super Bowl', short: 'Bracket' },
  { href: '/playoffs', label: 'Playoff picture', short: 'Playoff' },
  { href: '/predict', label: 'Head to head', short: 'H2H' },
  { href: '/ratings', label: 'Power ratings', short: 'Ratings' },
  { href: '/upsets', label: 'Upsets', short: 'Upsets' },
  { href: '/seasons', label: 'Seasons', short: 'Past', menu: true },
  { href: '/accuracy', label: 'Accuracy', short: 'Record' },
  { href: '/about', label: 'How it works', short: 'About' },
]

// The mobile bar shows five. The record is one of them deliberately: the
// central claim of this product is that its probabilities are calibrated,
// and the page that shows whether that is true should not be two taps down.
const MOBILE_NAV = NAV.filter((item) =>
  ['/', '/games', '/bracket', '/seasons', '/accuracy'].includes(item.href),
)

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AppShell({
  seasons = [],
  children,
}: {
  seasons?: ShellSeason[]
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? '/'

  // Record that an in-app navigation happened, so BackButton knows there is
  // history behind it. The first render is a landing, not a navigation.
  const landed = useRef(false)
  useEffect(() => {
    if (landed.current) markNavigation()
    else landed.current = true
  }, [pathname])

  return (
    // No background here, deliberately: the body paints the black, the
    // chalkboard canvas sits at z-index -1 above it, and an opaque wrapper
    // would put a wall between the two.
    <div className="min-h-screen">
      <ChalkboardField />
      {/* ---------------------------------------------------- desktop rail */}
      <aside
        className="fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-[var(--nav-border)] bg-[var(--nav-bg)] md:flex"
        style={{ width: 'var(--shell-sidebar-w)' }}
      >
        <Link href="/" className="flex items-center gap-3 px-5 py-6">
          {/* The same asset the browser tab uses. Served as the SVG rather
              than a PNG so it stays crisp at any density, and marked
              aria-hidden because the wordmark beside it already names the
              site — a screen reader announcing "Gridiron Gridiron" is worse
              than one that ignores the decoration. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/favicon.svg"
            alt=""
            aria-hidden="true"
            width={30}
            height={30}
            className="h-[30px] w-[30px] shrink-0"
          />
          <span className="block">
            <span className="block font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              NFL forecast
            </span>
            <span className="mt-0.5 block text-lg font-semibold uppercase tracking-[0.14em] text-[var(--text-primary)]">
              Gridiron
            </span>
          </span>
        </Link>

        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {NAV.map((item) =>
            item.menu && seasons.length ? (
              <SeasonsMenu
                key={item.href}
                item={item}
                seasons={seasons}
                pathname={pathname}
              />
            ) : (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-2 font-mono text-[12px] uppercase tracking-[0.12em] transition-colors',
                  isActive(pathname, item.href)
                    ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] hover:bg-[var(--card-bg)] hover:text-[var(--text-secondary)]',
                )}
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>

        <div className="border-t border-[var(--nav-border)] px-5 py-4">
          <p className="font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
            Model probabilities, scored against the closing line. Not betting
            advice.
          </p>
        </div>
      </aside>

      {/* -------------------------------------------------------- mobile bar */}
      <header className="sticky top-0 z-30 flex h-[var(--shell-topbar-h)] items-center justify-between border-b border-[var(--nav-border)] bg-[var(--nav-bg)] px-4 md:hidden">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/favicon.svg"
            alt=""
            aria-hidden="true"
            width={24}
            height={24}
            className="h-6 w-6 shrink-0"
          />
          <span className="text-base font-semibold uppercase tracking-[0.14em] text-[var(--text-primary)]">
            Gridiron
          </span>
        </Link>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          NFL forecast
        </span>
      </header>

      <main
        id="main"
        className="px-4 pb-24 pt-6 md:pb-12 md:pl-[calc(var(--shell-sidebar-w)+2rem)] md:pr-8"
      >
        {/* Keyed on the route so the enter animation replays on every
            navigation — the CSS-only equivalent of the soccer sibling's
            PageTransition. Enter-only; there is no exit animation to block
            the next page. */}
        <div
          key={pathname}
          className="page-enter"
          style={{ maxWidth: 'var(--shell-content-max)' }}
        >
          {children}
        </div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 border-t border-[var(--nav-border)] bg-[var(--nav-bg)] md:hidden">
        {MOBILE_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(pathname, item.href) ? 'page' : undefined}
            className={cn(
              'flex min-h-[52px] items-center justify-center py-3 text-center font-mono text-[10px] uppercase tracking-[0.1em] transition-colors',
              isActive(pathname, item.href)
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)]',
            )}
          >
            {item.short}
          </Link>
        ))}
      </nav>
    </div>
  )
}

/**
 * The Seasons row: a link on the left, a disclosure chevron on the right.
 *
 * The two jobs are separate controls on purpose — folding the archive into a
 * button-only row would cost the direct route to `/seasons`, and making the
 * whole row toggle would cost the link. Ported from the NBA sibling.
 */
function SeasonsMenu({
  item,
  seasons,
  pathname,
}: {
  item: { href: string; label: string }
  seasons: ShellSeason[]
  pathname: string
}) {
  const inside = isActive(pathname, item.href)
  const [open, setOpen] = useState(inside)

  // Follow the route: unfold on entering the archive, fold on leaving.
  useEffect(() => {
    setOpen(inside)
  }, [inside])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div>
      <div
        className={cn(
          'flex items-center rounded-md transition-colors',
          inside
            ? 'bg-[var(--card-hover)]'
            : 'hover:bg-[var(--card-bg)]',
        )}
      >
        <Link
          href={item.href}
          aria-current={inside ? 'page' : undefined}
          className={cn(
            'flex-1 px-3 py-2 font-mono text-[12px] uppercase tracking-[0.12em] transition-colors',
            inside
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
          )}
        >
          {item.label}
        </Link>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="seasons-menu"
          aria-label={open ? 'Fold the season list' : 'Unfold the season list'}
          onClick={() => setOpen((v) => !v)}
          className="flex h-9 w-9 shrink-0 items-center justify-center text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
            className={cn('transition-transform', open && 'rotate-180')}
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open ? (
        <ul
          id="seasons-menu"
          className="mb-1 ml-3 max-h-[42vh] overflow-y-auto border-l border-[var(--border-color)] pl-2"
        >
          {seasons.map((season) => {
            const href = `/seasons/${season.season}`
            const here =
              pathname === href || pathname.startsWith(`${href}/`)
            return (
              <li key={season.season}>
                <Link
                  href={href}
                  aria-current={here ? 'page' : undefined}
                  className={cn(
                    'flex items-baseline justify-between gap-2 rounded-sm px-2 py-1 font-mono text-[11px] transition-colors',
                    here
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                  )}
                >
                  <span>{season.season}</span>
                  {season.champion ? (
                    <span className="text-[10px] text-[var(--accent-warn)]">
                      {season.champion}
                    </span>
                  ) : null}
                </Link>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
