'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Back, meaning BACK — not "up to the section index".
 *
 * The hardcoded `← All 32` style link the sibling projects use has a real
 * failure mode: a reader who reached a team page from a game page, or a game
 * page from the home slate, gets teleported to a list they never came from.
 * `router.back()` restores their actual scroll position and filter state,
 * which is what the back gesture means everywhere else on their phone.
 *
 * **The fallback is the canonical parent, and it is not decoration.** On a
 * fresh tab (a shared link, a search result) there is no in-app history and
 * `router.back()` would exit the site. `history.length` cannot distinguish
 * the two cases reliably, so the first in-app navigation is recorded on
 * `sessionStorage` and the button only goes `back()` once one has happened.
 * Until the client knows, it renders the fallback link — so with JavaScript
 * disabled or not yet hydrated this is still a working `<a>`.
 */

const KEY = 'gridiron:navigated'

/** Called by AppShell on every route change after the first. */
export function markNavigation() {
  try {
    sessionStorage.setItem(KEY, '1')
  } catch {
    /* private mode — the fallback link still works */
  }
}

export function BackButton({
  fallback,
  label,
}: {
  /** Where to go when the reader landed here directly. */
  fallback: string
  /** Names the fallback destination, e.g. "All teams". */
  label: string
}) {
  const router = useRouter()
  const [canGoBack, setCanGoBack] = useState(false)

  useEffect(() => {
    try {
      setCanGoBack(sessionStorage.getItem(KEY) === '1')
    } catch {
      /* keep the fallback */
    }
  }, [])

  const className =
    'inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]'

  if (!canGoBack) {
    return (
      <Link href={fallback} className={className}>
        ← {label}
      </Link>
    )
  }

  return (
    <button type="button" onClick={() => router.back()} className={className}>
      ← Back
    </button>
  )
}
