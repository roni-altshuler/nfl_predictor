/** ESPN identity and image policy. Display names never identify a player. */
export interface AthleteImage {
  provider: 'espn'
  subject: { provider: 'espn'; id: string }
  providerUrl: string | null
  assetPath: string | null
  provenance: { sourceUrl: string; suppliedBy: string }
  permission: { status: 'unverified' | 'permitted' | 'denied'; evidence: string | null }
  verification: { status: 'unverified' | 'verified'; verifiedAt: string | null }
}

export interface AthleteReference {
  provider: 'espn'
  id: string | null
  displayName: string
  position: string | null
  jersey: string | null
  portrait: AthleteImage | null
}

export function providerId(value: unknown): string | null {
  const id = typeof value === 'string' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : ''
  return /^[1-9]\d{0,19}$/.test(id) ? id : null
}

export function sourceTimestamp(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString() : null
}

export function normalizeAthlete(value: any, sourceUrl: string): AthleteReference {
  const id = providerId(value?.id)
  const providerUrl = typeof value?.headshot?.href === 'string' ? value.headshot.href : null
  return { provider: 'espn', id, displayName: String(value?.displayName ?? ''),
    position: value?.position?.abbreviation ? String(value.position.abbreviation) : null,
    jersey: typeof value?.jersey === 'string' && /^\d{1,2}$/.test(value.jersey) ? value.jersey : null,
    portrait: id && providerUrl ? { provider: 'espn', subject: { provider: 'espn', id }, providerUrl,
      assetPath: null, provenance: { sourceUrl, suppliedBy: 'ESPN game summary' },
      permission: { status: 'unverified', evidence: null }, verification: { status: 'unverified', verifiedAt: null } } : null }
}

/** Only a previously reviewed local asset can render; provider URLs never render. */
export function permittedPortrait(image: AthleteImage | null, athlete: AthleteReference): string | null {
  if (!image || !athlete.id || image.provider !== athlete.provider || image.subject.provider !== athlete.provider ||
      image.subject.id !== athlete.id || image.permission.status !== 'permitted' || !image.permission.evidence ||
      image.verification.status !== 'verified' || !sourceTimestamp(image.verification.verifiedAt) ||
      !image.provenance.sourceUrl || !image.provenance.suppliedBy) return null
  const asset = image.assetPath
  return asset && /^\/athletes\/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp|svg)$/.test(asset) && !asset.includes('..') ? asset : null
}

export function athleteHref(athlete: AthleteReference, gameId: string): string | null {
  return athlete.provider === 'espn' && providerId(athlete.id) && providerId(gameId)
    ? `/players/espn/${athlete.id}?game=${gameId}` : null
}

export function athleteInitials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase() || '—'
}
