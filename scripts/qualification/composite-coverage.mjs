/**
 * Fixed C28 producer variants and their independently reviewed coverage axes.
 * The map is intentionally immutable: a producer receipt may prove a variant,
 * but it cannot add an axis or declare the family complete.
 */
export const C28_VARIANT_AXIS_MAP = Object.freeze({
  routine: Object.freeze([
    'routine.settings-bootstrap',
    'routine.mission-outing-participants',
    'routine.gpx-dated-undated',
    'routine.marker-search',
    'routine.coverage-replay',
    'routine.pause-restart',
    'routine.finish-finalize-archive',
    'routine.archive-review-restore',
    'routine.sanitized-diagnostics',
  ]),
  'field-scale-seed': Object.freeze([
    'field-scale.100-devices',
    'field-scale.12-outings',
    'field-scale.bulk-positions-seed',
  ]),
  'field-scale-960k': Object.freeze([
    'field-scale.960k-positions',
  ]),
  'field-scale-2m': Object.freeze([
    'field-scale.2m-positions',
  ]),
  'failure-injection': Object.freeze([
    'failure-injection.invalid-position-rejection',
  ]),
  'failure-settings-bootstrap': Object.freeze(['failure.settings-bootstrap']),
  'failure-mission-outing': Object.freeze(['failure.mission-outing']),
  'failure-gpx': Object.freeze(['failure.gpx']),
  'failure-marker-search': Object.freeze(['failure.marker-search']),
  'failure-coverage-replay': Object.freeze(['failure.coverage-replay']),
  'failure-pause-restart': Object.freeze(['failure.pause-restart']),
  'failure-finish-finalize-archive': Object.freeze(['failure.finish-finalize-archive']),
  'failure-archive-review-restore': Object.freeze(['failure.archive-review-restore']),
  'failure-sanitized-diagnostics': Object.freeze(['failure.sanitized-diagnostics']),
  'archive-revision-supplement': Object.freeze([
    'archive-revision-supplement.unlock-republish',
    'archive-revision-supplement.predecessor-custody',
    'archive-revision-supplement.revision-chain',
  ]),
})

export const C28_REQUIRED_VARIANTS = Object.freeze([
  'routine',
  'field-scale-960k',
  'field-scale-2m',
  'failure-settings-bootstrap',
  'failure-mission-outing',
  'failure-gpx',
  'failure-marker-search',
  'failure-coverage-replay',
  'failure-pause-restart',
  'failure-finish-finalize-archive',
  'failure-archive-review-restore',
  'failure-sanitized-diagnostics',
  'archive-revision-supplement',
])

/**
 * Validates the closed coverage identity for one producer variant.
 * `familyComplete` is deliberately not accepted as input.
 */
export function validateC28VariantCoverage(receipt, expected = {}) {
  const failures = []
  const variantId = receipt?.variantId
  if (expected.contractId !== undefined && expected.contractId !== 'C28') {
    failures.push('C28 coverage contract binding is invalid.')
  }
  if (typeof variantId !== 'string' || !Object.hasOwn(C28_VARIANT_AXIS_MAP, variantId)) {
    failures.push('C28 coverage variant is not in the fixed reviewed variant map.')
  }
  if (expected.variantId !== undefined && variantId !== expected.variantId) {
    failures.push('C28 coverage variant does not match the expected binding.')
  }
  const expectedAxes = typeof variantId === 'string' && Object.hasOwn(C28_VARIANT_AXIS_MAP, variantId)
    ? C28_VARIANT_AXIS_MAP[variantId]
    : []
  const axes = receipt?.coveredAxes
  if (!sameStringSet(axes, expectedAxes)) {
    failures.push('C28 coverage axes differ from the fixed reviewed variant map.')
  }
  if (receipt?.missingAxes !== undefined
    && (!Array.isArray(receipt.missingAxes) || receipt.missingAxes.length !== 0)) {
    failures.push('C28 variant coverage cannot carry undeclared missing axes.')
  }
  if (receipt?.familyComplete !== undefined) {
    failures.push('C28 producer familyComplete is not an accepted evidence field.')
  }
  return Object.freeze({
    valid: failures.length === 0,
    variantId: typeof variantId === 'string' ? variantId : null,
    coveredAxes: Object.freeze([...expectedAxes]),
    failureReasons: Object.freeze([...new Set(failures)]),
  })
}

/**
 * Derives family admission from validated variant identities only.
 * Missing required variants are an environment block, never a partial pass.
 */
export function deriveC28FamilyCoverage(validatedVariantIds, expected = {}) {
  const requestedVariants = expected.requiredVariants
  const requiredVariants = C28_REQUIRED_VARIANTS
  const failures = []
  if (requestedVariants !== undefined
    && (!Array.isArray(requestedVariants)
      || requestedVariants.length !== requiredVariants.length
      || requestedVariants.some((value, index) => value !== requiredVariants[index]))) {
    failures.push('C28 admission cannot narrow the fixed mandatory variant set.')
  }
  const ids = Array.isArray(validatedVariantIds) ? validatedVariantIds : []
  const validIds = [...new Set(ids.filter((value) => typeof value === 'string'))]
    .filter((value) => Object.hasOwn(C28_VARIANT_AXIS_MAP, value))
  const missingVariants = (Array.isArray(requiredVariants) ? requiredVariants : [])
    .filter((value) => !validIds.includes(value))
  const coveredAxes = validIds.flatMap((value) => C28_VARIANT_AXIS_MAP[value])
  const uniqueAxes = [...new Set(coveredAxes)]
  const valid = failures.length === 0 && missingVariants.length === 0
  return Object.freeze({
    status: valid ? 'PASS' : 'ENVIRONMENT_BLOCKED',
    valid,
    familyComplete: valid,
    requiredVariants: Object.freeze([...(Array.isArray(requiredVariants) ? requiredVariants : [])]),
    observedVariants: Object.freeze(validIds),
    missingVariants: Object.freeze(missingVariants),
    coveredAxes: Object.freeze(uniqueAxes),
    failureReasons: Object.freeze([...new Set(failures)]),
  })
}

/** Compares an ordered, duplicate-free reviewed axis list. */
function sameStringSet(actual, expected) {
  return Array.isArray(actual)
    && new Set(actual).size === actual.length
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index])
}
