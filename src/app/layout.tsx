import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'

import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
})

// Monospace carries every number on the site — scores, probabilities, win
// totals, spreads. Tabular figures keep a column from shifting as digits
// change, which a probability table does constantly.
//
// globals.css has referenced `--font-mono-numeric` since it was ported from
// the sibling project, but nothing defined it here: every `.numeric` element
// was silently falling through to the ui-monospace fallback, so the tabular
// figures the design depends on were never actually applied.
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-numeric',
  display: 'swap',
  weight: ['400', '500', '700'],
})

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
  // The leather of the mark, so the mobile browser chrome matches the tab
  // icon rather than the page background. Black would disappear into the
  // canvas and leave the status bar looking detached.
  themeColor: '#a05c22',
  width: 'device-width',
  initialScale: 1,
}

/**
 * Dark-only by design. `<html class="dark">` is hardcoded and there is no
 * theme provider; `:root` in globals.css is the single source of truth.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="bg-[var(--background)] text-[var(--text-primary)] antialiased">
        {children}
      </body>
    </html>
  )
}
