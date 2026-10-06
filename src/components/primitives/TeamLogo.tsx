'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { logoUrl } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * A club mark, seated on a light plate.
 *
 * **The plate is not decoration.** NFL marks are authored for light
 * backgrounds and several of them go effectively invisible on this site's
 * pure-black canvas — the Ravens' black-and-purple shield, the Raiders' silver
 * on grey, the Steelers' black outline. Every product of this class (ESPN,
 * NFL.com, the networks' scorebugs) seats club marks on a light tile for
 * exactly this reason, and the hairline ring separates the tile from the card
 * beneath it.
 *
 * Plain `<img>` rather than `next/image`: these are remote ESPN CDN assets at
 * a fixed small size, and the optimiser buys nothing at 24px while adding a
 * serverless hop per logo on a page that renders sixty of them.
 */
export function TeamLogo({
  abbreviation,
  name,
  size = 24,
  className,
}: {
  abbreviation: string
  name?: string | null
  size?: number
  className?: string
}) {
  // A different team gets fresh loading state even when React reuses the slot.
  return <TeamMark key={abbreviation} abbreviation={abbreviation} name={name} size={size} className={className} />
}

function TeamMark({ abbreviation, name, size, className }: {
  abbreviation: string
  name?: string | null
  size: number
  className?: string
}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading')
  const image = useRef<HTMLImageElement>(null)

  useEffect(() => {
    // Cached images can finish before hydration attaches the load handler.
    if (image.current?.complete) {
      setStatus(image.current.naturalWidth > 0 ? 'loaded' : 'failed')
    }
  }, [])

  return (
    <span
      role="img"
      aria-label={name || abbreviation}
      data-logo-state={status}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm',
        className,
      )}
      style={{
        width: size,
        height: size,
        background: 'var(--logo-plate)',
        color: 'var(--logo-ink)',
        boxShadow: 'inset 0 0 0 1px var(--logo-plate-ring)',
      }}
    >
      {status !== 'loaded' && <span aria-hidden="true" className="font-mono font-bold" style={{ fontSize: Math.max(7, size * 0.32) }}>{abbreviation}</span>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {status !== 'failed' && <img
        ref={image}
        src={logoUrl(abbreviation)}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('failed')}
        className="absolute"
        style={{ width: size * 0.84, height: size * 0.84, objectFit: 'contain', opacity: status === 'loaded' ? 1 : 0 }}
      />}
    </span>
  )
}

/**
 * The standard way a franchise is named on this site: mark, name, and a link
 * to its page.
 *
 * **Every team named outside a card is clickable.** A team mark that does
 * nothing when clicked is the second most common complaint a table like this
 * gets, after a fixture that does nothing when clicked — and this project has
 * already fixed the first one. The destination carries what a row cannot: the
 * rating across twenty-four seasons against the league, the seed
 * distribution, the remaining schedule and the season-by-season record.
 *
 * `interactive={false}` renders the same thing without the anchor, which is
 * what the inside of a `GameCard` needs — the card is itself a link, and an
 * anchor inside an anchor is invalid HTML that React will refuse to hydrate.
 */
export function TeamLabel({
  abbreviation,
  name,
  size = 20,
  showAbbreviation = false,
  interactive = true,
  className,
}: {
  abbreviation: string
  name?: string | null
  size?: number
  showAbbreviation?: boolean
  interactive?: boolean
  className?: string
}) {
  const body = (
    <>
      <TeamLogo abbreviation={abbreviation} name={name} size={size} />
      <span className="truncate">
        {showAbbreviation ? abbreviation : (name ?? abbreviation)}
      </span>
    </>
  )

  if (!interactive) {
    return (
      <span className={cn('inline-flex min-w-0 items-center gap-2.5', className)}>
        {body}
      </span>
    )
  }

  return (
    <Link
      href={`/teams/${abbreviation}`}
      className={cn(
        'inline-flex min-w-0 items-center gap-2.5 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] hover:underline',
        className,
      )}
    >
      {body}
    </Link>
  )
}
