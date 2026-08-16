'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

/**
 * The app chrome: a fixed sidebar on desktop, a bottom tab bar on mobile.
 *
 * **There is no global search.** Every destination is one tap from here, and
 * a search field printed in the chrome advertises a product bigger than this
 * one. The sibling projects each removed theirs for the same reason.
 */

const NAV = [
  { href: '/', label: 'This week', short: 'Week' },
  { href: '/season', label: 'Season', short: 'Season' },
  { href: '/games', label: 'Schedule', short: 'Games' },
  { href: '/playoffs', label: 'Playoff picture', short: 'Playoff' },
  { href: '/ratings', label: 'Power ratings', short: 'Ratings' },
  { href: '/accuracy', label: 'Accuracy', short: 'Record' },
  { href: '/about', label: 'How it works', short: 'About' },
]

// The mobile bar shows five. The record is one of them deliberately: the
// central claim of this product is that its probabilities are calibrated,
// and the page that shows whether that is true should not be two taps down.
const MOBILE_NAV = NAV.filter((item) =>
  ['/', '/season', '/games', '/playoffs', '/accuracy'].includes(item.href),
)

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/'

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* ---------------------------------------------------- desktop rail */}
      <aside
        className="fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-[var(--nav-border)] bg-[var(--nav-bg)] lg:flex"
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

        <nav className="flex-1 px-2 py-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'block rounded-md px-3 py-2 font-mono text-[12px] uppercase tracking-[0.12em] transition-colors',
                isActive(pathname, item.href)
                  ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:bg-[var(--card-bg)] hover:text-[var(--text-secondary)]',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-[var(--nav-border)] px-5 py-4">
          <p className="font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
            Model probabilities, scored against the closing line. Not betting
            advice.
          </p>
        </div>
      </aside>

      {/* -------------------------------------------------------- mobile bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--nav-border)] bg-[var(--nav-bg)] px-4 py-3 lg:hidden">
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
        className="px-4 pb-24 pt-6 lg:pb-12 lg:pl-[calc(var(--shell-sidebar-w)+2rem)] lg:pr-8"
      >
        <div style={{ maxWidth: 'var(--shell-content-max)' }}>{children}</div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 border-t border-[var(--nav-border)] bg-[var(--nav-bg)] lg:hidden">
        {MOBILE_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'py-3 text-center font-mono text-[10px] uppercase tracking-[0.1em] transition-colors',
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
