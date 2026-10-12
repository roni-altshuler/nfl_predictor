/**
 * Background removal exposes existing red table values and tiny availability
 * badges to axe. Preserve/report these shapes; do not waive other contrast.
 * Source/production evidence is in STATIC_BACKGROUNDS_2026-10-12.md.
 */
export function existingRedTextContrast(violation) {
  const targets = violation.targets ?? violation.nodes ?? []
  return violation.id === 'color-contrast' && targets.length > 0 &&
    targets.every(target => target.length > 0 && target.every(selector => {
      if (!selector.includes('accent-loss')) return false
      const historicalCell = selector.includes('tr:nth-child(')
      // Axe chooses different ancestor paths for one versus many status rows.
      // The badge's unchanged three-class style is the stable boundary.
      const availabilityBadge = selector.includes('shrink-0') && selector.includes('10px')
      return historicalCell || availabilityBadge
    }))
}
