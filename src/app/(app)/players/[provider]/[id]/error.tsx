'use client'

import Link from 'next/link'

export default function PlayerError({ reset }: { reset: () => void }) {
  return <section className="card p-6" role="alert">
    <h1 className="text-2xl">Player profile could not load</h1>
    <p className="mt-3 text-sm text-[var(--text-secondary)]">The profile is unavailable. Published matchups remain available.</p>
    <div className="mt-4 flex flex-wrap gap-4">
      <button onClick={reset} className="inline-flex min-h-[44px] items-center border border-[var(--border-color)] px-3 text-sm">Try again</button>
      <Link href="/games" className="inline-flex min-h-[44px] items-center text-sm text-[var(--accent-info)]">Published games →</Link>
    </div>
  </section>
}
