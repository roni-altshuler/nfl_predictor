import Link from 'next/link'
import { athleteHref, type AthleteReference } from '@/lib/athletes'

export function PlayerLink({ athlete, gameId }: { athlete: AthleteReference; gameId: string }) {
  const href = athleteHref(athlete, gameId)
  return href ? <Link href={href} prefetch={false} className="inline-flex min-h-[44px] min-w-0 max-w-full items-center break-words text-[var(--accent-info)] hover:underline"
    aria-label={`${athlete.displayName} — player profile`}>{athlete.displayName}</Link>
    : <span>{athlete.displayName}</span>
}
