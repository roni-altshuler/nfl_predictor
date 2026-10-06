export default function PlayerLoading() {
  return <div role="status" aria-label="Loading player profile" className="space-y-6">
    <span className="sr-only">Loading player profile…</span>
    <div className="skeleton-shimmer h-4 w-40" />
    <div className="skeleton-shimmer h-40 w-full" />
    <div className="grid gap-4 lg:grid-cols-2"><div className="skeleton-shimmer h-48" /><div className="skeleton-shimmer h-48" /></div>
  </div>
}
