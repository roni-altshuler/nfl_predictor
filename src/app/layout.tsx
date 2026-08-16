import type { Metadata } from 'next'

import './globals.css'

export const metadata: Metadata = {
  title: 'Gridiron — NFL forecast',
  description:
    'NFL game and season probabilities, scored against the closing line.',
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
    <html lang="en" className="dark">
      <body className="bg-[var(--background)] text-[var(--text-primary)] antialiased">
        {children}
      </body>
    </html>
  )
}
