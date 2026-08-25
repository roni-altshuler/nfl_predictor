/**
 * The game-page skeleton.
 *
 * This is the one route that can genuinely take a moment: an archived game
 * outside the prerendered set resolves at request time and fetches its box
 * score from ESPN. A frozen screen there reads as a dead link; a skeleton
 * mirroring the page's real shape reads as loading.
 */
export default function GameLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading game">
      <span className="sr-only">Loading…</span>
      <div>
        <div className="skeleton-shimmer h-4 w-24" />
        <div className="skeleton-shimmer mt-3 h-8 w-72 max-w-full" />
        <div className="skeleton-shimmer mt-3 h-4 w-52 max-w-full" />
      </div>
      <div className="skeleton-shimmer h-40 w-full" />
      <div className="skeleton-shimmer h-56 w-full" />
      <div className="skeleton-shimmer h-40 w-full" />
    </div>
  )
}
