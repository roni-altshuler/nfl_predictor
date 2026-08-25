import { AppShell } from '@/components/shell/AppShell'
import { getSeasonsIndex } from '@/lib/archive'

/**
 * The season list is read HERE, in a server component, and passed down —
 * AppShell is a client component and cannot touch the filesystem. Same
 * pattern as the NBA sibling.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const seasons = (getSeasonsIndex()?.seasons ?? []).map((s) => ({
    season: s.season,
    champion: s.champion,
  }))

  return <AppShell seasons={seasons}>{children}</AppShell>
}
