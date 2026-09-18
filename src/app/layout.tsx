import type { Metadata, Viewport } from 'next'

import './globals.css'

/**
 * The absolute origin, which `metadataBase` needs so `og:image` resolves to
 * a full URL — a relative one is silently ignored by every social scraper.
 *
 * Resolved rather than hardcoded, because a guessed hostname that does not
 * match the real deployment produces a card that 404s and a preview that
 * renders blank, with nothing failing at build time. Vercel injects
 * `VERCEL_PROJECT_PRODUCTION_URL` (the stable production domain, not the
 * per-deploy one) at build, so the correct value is available without anyone
 * having to configure it. `NEXT_PUBLIC_SITE_URL` overrides for a custom
 * domain.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000')

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Gridiron — Calibrated NFL forecasting',
    template: '%s · Gridiron',
  },
  description:
    'Calibrated NFL game and season forecasting, scored against the closing line over a 6,499-game corpus.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Gridiron' },
  // Chrome probes /favicon.ico before it reads these tags, so the .ico is
  // generated as well as the SVG — without it every cold load takes a 404.
  //
  // The SVG is listed FIRST because a browser that understands it should
  // prefer it: it is 1.5KB, resolution-independent, and stays crisp on a
  // retina tab strip where the 32px PNG does not.
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
  },
  openGraph: {
    type: 'website',
    siteName: 'Gridiron',
    title: 'Gridiron — Calibrated NFL forecasting',
    description:
      'Calibrated NFL game and season forecasting, scored against the closing line.',
    url: siteUrl,
    images: [
      {
        url: '/brand/og-default.png',
        width: 1200,
        height: 630,
        alt: 'Gridiron — calibrated NFL forecasting',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Gridiron — Calibrated NFL forecasting',
    description:
      'Calibrated NFL game and season forecasting, scored against the closing line.',
    images: ['/brand/og-default.png'],
  },
}

export const viewport: Viewport = {
  // The blackboard slate, so the mobile browser chrome reads as part of
  // the board rather than a bar floating above it.
  themeColor: '#0b120e',
  width: 'device-width',
  initialScale: 1,
}

/**
 * The ambient preference, applied BEFORE first paint.
 *
 * `data-ambient` on <html> drives the chalkboard's opacity (globals.css) and
 * its loop (ChalkboardField). Read from localStorage here, synchronously,
 * so a reader who chose `off` never sees one frame of the field; anything
 * absent or unrecognised is `soft`. ~200 bytes, wrapped so a blocked
 * storage API still yields the default. Kept in sync with AmbientToggle.
 */
const AMBIENT_SCRIPT =
  "try{var v=localStorage.getItem('gridiron-ambient');document.documentElement.dataset.ambient=v==='vivid'||v==='off'?v:'soft'}catch(e){document.documentElement.dataset.ambient='soft'}"

/**
 * Dark-only by design. `<html class="dark">` is hardcoded and there is no
 * theme provider; `:root` in globals.css is the single source of truth.
 * `suppressHydrationWarning` covers the one attribute the inline script
 * adds to <html> before React attaches.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className="dark"
      suppressHydrationWarning
    >
      <body className="bg-[var(--background)] text-[var(--text-primary)] antialiased">
        <script dangerouslySetInnerHTML={{ __html: AMBIENT_SCRIPT }} />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-[var(--card-bg)] focus:px-3 focus:py-2 focus:text-sm focus:font-semibold"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
