import Link from 'next/link'

import { AppShell } from '@/components/shell/AppShell'

/**
 * The 404 keeps the app chrome, so a dead link is a detour rather than an
 * exit — the reader is one tap from every real destination instead of
 * staring at a bare error page.
 */
export default function NotFound() {
  return (
    <AppShell>
      <div className="flex min-h-[50vh] flex-col items-start justify-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-2 text-3xl font-semibold uppercase tracking-[0.1em]">
          No such page
        </h1>
        <p className="mt-3 max-w-md font-mono text-[12px] leading-relaxed text-[var(--text-tertiary)]">
          Nothing is published at this address. If a game or season link got
          you here, the artifact behind it has not been published.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {[
            { href: '/', label: 'This week' },
            { href: '/games', label: 'Schedule' },
            { href: '/seasons', label: 'Seasons' },
            { href: '/ratings', label: 'Power ratings' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex min-h-[32px] items-center rounded-sm border border-[var(--border-color)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  )
}
