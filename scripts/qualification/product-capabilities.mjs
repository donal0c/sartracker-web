/** Product capabilities intentionally absent from the Beta 13 release claim. */
export const BETA13_NOT_CLAIMED_CAPABILITIES = Object.freeze([
  {
    capabilityId: 'DON-249-background-integrity-arbitration',
    issueId: 'DON-249',
    status: 'NOT_CLAIMED',
    contractIds: Object.freeze(['C19', 'C24']),
    hazardIds: Object.freeze(['PST-003', 'IPC-003']),
    description: 'Background integrity scheduling, resource arbitration, cancellation and stale-result handling are not implemented.',
  },
  {
    capabilityId: 'DON-250-oversized-store-recovery',
    issueId: 'DON-250',
    status: 'NOT_CLAIMED',
    contractIds: Object.freeze(['C19']),
    hazardIds: Object.freeze(['PST-005']),
    description: 'Mission-state-aware oversized-store classification and recovery actions are not implemented.',
  },
  {
    capabilityId: 'DON-251-bounded-retention-policy',
    issueId: 'DON-251',
    status: 'NOT_CLAIMED',
    contractIds: Object.freeze(['C19', 'C24']),
    hazardIds: Object.freeze(['PST-004', 'IPC-003']),
    description: 'Measured index and telemetry-only retention policy with interruption recovery is not implemented.',
  },
].map((entry) => Object.freeze(entry)))

const BETA13_NOT_CLAIMED_ISSUE_IDS = Object.freeze(BETA13_NOT_CLAIMED_CAPABILITIES.map((entry) => entry.issueId))

/** Immutable Beta 13 team-testing scope; changing it requires a reviewed plan change. */
export const BETA13_CLAIM_SCOPE = Object.freeze({
  id: 'beta13-controlled-team-testing',
  permittedUse: 'controlled-team-testing',
  allowedData: Object.freeze(['synthetic', 'replayed', 'disposable']),
  independentPrimaryRequired: true,
  notClaimedIssueIds: BETA13_NOT_CLAIMED_ISSUE_IDS,
})

/** Validate the exact controlled Beta 13 scope before compiling a candidate plan. */
export function validateCandidateClaimScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)
      || !sameStringSequence(Object.keys(scope).sort(), Object.keys(BETA13_CLAIM_SCOPE).sort())) {
    throw new Error('Candidate claim scope fields differ from the reviewed Beta 13 scope.')
  }
  if (scope.id !== BETA13_CLAIM_SCOPE.id || scope.permittedUse !== BETA13_CLAIM_SCOPE.permittedUse
      || scope.independentPrimaryRequired !== true
      || !sameStringSequence(scope.allowedData, BETA13_CLAIM_SCOPE.allowedData)
      || !sameStringSequence(scope.notClaimedIssueIds, BETA13_CLAIM_SCOPE.notClaimedIssueIds)) {
    throw new Error('Candidate claim scope does not match the reviewed Beta 13 limits.')
  }
  return true
}

/** Compare a retained scope with the reviewed plan without relying on object key order. */
export function candidateClaimScopeMatchesReviewedPlan(reviewedScope, candidateScope) {
  try {
    validateCandidateClaimScope(reviewedScope)
    validateCandidateClaimScope(candidateScope)
  } catch {
    return false
  }
  return reviewedScope.id === candidateScope.id
    && reviewedScope.permittedUse === candidateScope.permittedUse
    && reviewedScope.independentPrimaryRequired === candidateScope.independentPrimaryRequired
    && sameStringSequence(reviewedScope.allowedData, candidateScope.allowedData)
    && sameStringSequence(reviewedScope.notClaimedIssueIds, candidateScope.notClaimedIssueIds)
}

/** Return immutable NOT_CLAIMED records only for the exact reviewed candidate scope. */
export function candidateProductCapabilityResiduals(mode, claimScope) {
  if (mode !== 'candidate') return Object.freeze([])
  validateCandidateClaimScope(claimScope)
  return BETA13_NOT_CLAIMED_CAPABILITIES
}

/** Compare an ordered list of strings without coercing malformed values. */
function sameStringSequence(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected)
    && actual.length === expected.length
    && actual.every((value, index) => typeof value === 'string' && value === expected[index])
}
