/**
 * Background removal exposes the unchanged small red historical values to axe.
 * Preserve and report that narrow finding; do not waive other contrast failures.
 * Original/static production evidence is in STATIC_BACKGROUNDS_2026-10-12.md.
 */
export function historicalTableContrast(violation) {
  const targets = violation.targets ?? violation.nodes ?? []
  return violation.id === 'color-contrast' && targets.length > 0 &&
    targets.every(target => target.length > 0 && target.every(selector =>
      selector.includes('tr:nth-child(') && selector.includes('accent-loss')))
}
