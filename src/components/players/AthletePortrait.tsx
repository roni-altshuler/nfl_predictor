'use client'

import { useState } from 'react'
import { athleteInitials, permittedPortrait, type AthleteReference } from '@/lib/athletes'

export function AthletePortrait({ athlete }: { athlete: AthleteReference }) {
  const [failed, setFailed] = useState(false)
  const asset = permittedPortrait(athlete.portrait, athlete)
  return <span role="img" aria-label={`${athlete.displayName}: ${asset && !failed ? 'portrait' : 'portrait unavailable'}`}
    className="relative flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-[var(--border-color)] bg-[var(--logo-plate)] text-[var(--logo-ink)]">
    {asset && !failed ? <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset} alt="" width={80} height={96} className="h-full w-full object-cover" onError={() => setFailed(true)} />
    </> : <span className="font-mono text-2xl font-semibold" aria-hidden="true">{athleteInitials(athlete.displayName)}</span>}
    {athlete.jersey ? <span aria-hidden="true" className="absolute bottom-1 right-1 px-1 font-mono text-xs">#{athlete.jersey}</span> : null}
  </span>
}
