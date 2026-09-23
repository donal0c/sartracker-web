import {
  BETA13_CLAIM_SCOPE,
  BETA13_NOT_CLAIMED_CAPABILITIES,
  validateCandidateClaimScope,
} from './product-capabilities.mjs'

const FAILURE_PRIORITY = ['INVALID_EVIDENCE', 'CLEANUP_BLOCKED', 'FAIL', 'ABORTED_SAFE', 'ENVIRONMENT_BLOCKED', 'NEEDS_HUMAN_DECISION']

/** Enforce the approved separation between draft admission and fresh public-byte verification. */
export function validateQualificationPhase(binding) {
  const phase = binding.phase ?? 'prepublication'
  if (!['prepublication', 'postpublication'].includes(phase)) throw new Error('Qualification phase is invalid.')
  if (phase === 'postpublication' && binding.contractId !== 'C00') throw new Error('Only C00 fresh-public verification belongs to the postpublication gate.')
  if (phase === 'postpublication' && binding.proofMode !== 'public-release') throw new Error('Postpublication verification requires distinct public-release evidence.')
  if (binding.proofMode === 'public-release' && phase !== 'postpublication') throw new Error('Fresh public evidence cannot be required or claimed before publication.')
}

/** Compute phase outcomes; scoped omissions remain visible and can never become PASS. */
export function evaluateQualificationPhases(bindings, attempts, evidenceErrors, notClaimedCapabilities = [], { mode = 'calibration' } = {}) {
  const prepublication = evaluatePhase('prepublication', bindings, attempts, evidenceErrors, notClaimedCapabilities)
  const postpublication = evaluatePhase('postpublication', bindings, attempts, evidenceErrors, notClaimedCapabilities)
  const evidenceComplete = prepublication.status === 'PASS' && postpublication.status === 'PASS'
    && notClaimedCapabilities.length === 0
  const releaseComplete = mode === 'candidate' && evidenceComplete
  return Object.freeze({ prepublication, postpublication,
    evidenceComplete,
    releaseComplete,
    teamRolloutEligible: releaseComplete && postpublication.status === 'PASS',
    requiredDisposition: ['FAIL', 'INVALID_EVIDENCE'].includes(postpublication.status)
      ? 'block-team-rollout-and-withdraw-or-rollback' : 'retain-release-and-rollout-gates',
  })
}

/** Retain all failures and require every mandatory variant in the named phase. */
function evaluatePhase(phase, bindings, attempts, evidenceErrors, notClaimedCapabilities = []) {
  const required = bindings.filter((binding) => binding.mandatory && (binding.phase ?? 'prepublication') === phase)
  const keys = new Set(required.map((binding) => `${binding.contractId}:${binding.variantId}`))
  const rows = attempts.filter((row) => keys.has(`${row.contractId}:${row.variantId}`))
  const missing = [...keys].filter((key) => !rows.some((row) => `${row.contractId}:${row.variantId}` === key))
  const failure = FAILURE_PRIORITY.find((status) => rows.some((row) => row.status === status))
  const phaseContracts = new Set(required.map((binding) => binding.contractId))
  const residuals = notClaimedCapabilities.filter((entry) => entry.contractIds.some((contractId) => phaseContracts.has(contractId)))
  const status = evidenceErrors.length ? 'INVALID_EVIDENCE' : failure
    ?? (missing.length || !required.length ? 'NOT_RUN' : rows.every((row) => row.status === 'PASS') ? 'PASS' : 'INVALID_EVIDENCE')
  const scopedStatus = status === 'PASS' && residuals.length > 0 ? 'SCOPE_LIMITED' : status
  return Object.freeze({ phase, status: scopedStatus, missing: Object.freeze(missing), requiredVariants: required.length,
    notClaimedCapabilities: Object.freeze([...residuals]),
  })
}

/** Require the full applicable prepublication matrix and C29 before running C27. */
export function assertC27Admission(verdict, bindings, pendingBinding) {
  const phase = verdict?.phases?.prepublication
  const c27BindingKeys = bindings
    .filter((binding) => binding.mandatory && binding.contractId === 'C27' && (binding.phase ?? 'prepublication') === 'prepublication')
    .map((binding) => `${binding.contractId}:${binding.variantId}`)
  const pendingC27 = phase?.missing
  const pendingC00 = verdict?.phases?.postpublication?.missing
  const expectedBlockers = [
    ...(Array.isArray(pendingC27) ? pendingC27.map((key) => `missing required variant ${key}`) : []),
    ...(Array.isArray(pendingC00) ? pendingC00.map((key) => `missing required variant ${key}`) : []),
    'missing required contract C27',
    'missing required contract C00',
  ]
  if (verdict?.verdict !== 'ENVIRONMENT_BLOCKED'
      // Missing mandatory C27 rows make the computed prepublication phase NOT_RUN.
      // The campaign verdict itself remains ENVIRONMENT_BLOCKED because those rows
      // are required before candidate admission.
      || phase?.status !== 'NOT_RUN'
      || !Array.isArray(pendingC27) || pendingC27.length === 0
      || pendingC27.some((key) => !c27BindingKeys.includes(key))
      || !pendingC27.includes(`${pendingBinding?.contractId}:${pendingBinding?.variantId}`)
      || !sameStringSets(verdict.blockers, expectedBlockers)
      || !hasPassingContract(verdict, 'C29') || !hasReviewedResidualSet(verdict)
      || !sameStrings(phase.notClaimedCapabilities?.map((entry) => entry.issueId), verdict.notClaimedCapabilities?.map((entry) => entry.issueId))
      || !allOtherContractsReady(verdict, ['C27', 'C00'])
      || !allRetainedAttemptsPass(verdict)) {
    throw new Error('C27 requires every applicable BCP-17 gate and C29 to pass first; unresolved scope or evidence remains blocking.')
  }
  if ((verdict.deterministicFailures?.length ?? 0) > 0 || (verdict.evidenceErrors?.length ?? 0) > 0
      || (phase.notClaimedCapabilities?.length ?? 0) === 0) {
    throw new Error('C27 cannot run with failed evidence, invalid evidence, or an unreviewed claim scope.')
  }
}

/** Require C27 and C29 before checking public release bytes after publication. */
export function assertPostpublicationAdmission(verdict, bindings, pendingBinding) {
  const status = verdict?.phases?.prepublication?.status
  const postpublication = verdict?.phases?.postpublication
  const c00BindingKeys = bindings
    .filter((binding) => binding.mandatory && binding.contractId === 'C00' && (binding.phase ?? 'prepublication') === 'postpublication')
    .map((binding) => `${binding.contractId}:${binding.variantId}`)
  const pendingC00 = postpublication?.missing
  const expectedBlockers = [
    ...(Array.isArray(pendingC00) ? pendingC00.map((key) => `missing required variant ${key}`) : []),
    'missing required contract C00',
  ]
  if (!['PASS', 'SCOPE_LIMITED'].includes(status)
      || verdict?.verdict !== 'ENVIRONMENT_BLOCKED'
      || postpublication?.status !== 'NOT_RUN'
      || !Array.isArray(pendingC00) || pendingC00.length === 0
      || pendingC00.some((key) => !c00BindingKeys.includes(key))
      || !pendingC00.includes(`${pendingBinding?.contractId}:${pendingBinding?.variantId}`)
      || !sameStringSets(verdict.blockers, expectedBlockers)
      || !hasPassingContract(verdict, 'C27') || !hasPassingContract(verdict, 'C29')) {
    throw new Error('C00 requires the completed BCP-17 campaign, C29 acceptance, and a passing C27 publication decision.')
  }
  if (verdict.mode === 'candidate' && (status !== 'SCOPE_LIMITED' || !hasReviewedResidualSet(verdict))) {
    throw new Error('C00 cannot follow an unrecognized or changed not-claimed capability scope.')
  }
  if ((verdict.deterministicFailures?.length ?? 0) > 0 || (verdict.evidenceErrors?.length ?? 0) > 0) {
    throw new Error('C00 cannot run while candidate evidence contains failures or integrity errors.')
  }
  if (!allOtherContractsReady(verdict, ['C00']) || !allRetainedAttemptsPass(verdict)) {
    throw new Error('C00 requires every prior applicable contract attempt to pass with no retained blockers.')
  }
}

/** Confirm that one aggregate contract row passed. */
function hasPassingContract(verdict, contractId) {
  return verdict?.contractRows?.some((row) => row.contractId === contractId && row.status === 'PASS') === true
}

/** Confirm that the exact repository-approved residual capability IDs remain visible. */
function hasReviewedResidualSet(verdict) {
  const actual = verdict?.notClaimedCapabilities?.map((entry) => entry.issueId)
  try {
    validateCandidateClaimScope(verdict?.claimScope)
    return sameStrings(actual, BETA13_CLAIM_SCOPE.notClaimedIssueIds)
      && sameCapabilityRecords(verdict.notClaimedCapabilities, BETA13_NOT_CLAIMED_CAPABILITIES)
  } catch {
    return false
  }
}

/** Compare the reviewed residual records without depending on object key order. */
function sameCapabilityRecords(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length
    && actual.every((entry, index) => {
      const reviewed = expected[index]
      return entry && typeof entry === 'object' && !Array.isArray(entry)
        && sameStringSets(Object.keys(entry), Object.keys(reviewed))
        && entry.capabilityId === reviewed.capabilityId
        && entry?.issueId === reviewed.issueId
        && entry?.status === reviewed.status
        && entry?.description === reviewed.description
        && sameStrings(entry?.contractIds, reviewed.contractIds)
        && sameStrings(entry?.hazardIds, reviewed.hazardIds)
    })
}

/** Require every in-scope contract row to pass while allowing only listed phase rows to remain pending. */
function allOtherContractsReady(verdict, pendingContractIds) {
  return verdict?.contractRows?.filter((row) => row.required).every((row) => pendingContractIds.includes(row.contractId)
    ? row.status === 'not-run' : ['PASS', 'SCOPE_LIMITED'].includes(row.status)) === true
}

/** Compare ordered identity lists without coercing malformed values. */
function sameStrings(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected)
    && actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

/** Compare blocker identities without depending on their collection order. */
function sameStringSets(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected)
    && sameStrings([...actual].sort(), [...expected].sort())
}

/** Reject any historical failed or environment-blocked attempt instead of letting a later pass erase it. */
function allRetainedAttemptsPass(verdict) {
  return Array.isArray(verdict?.retainedAttemptStatuses)
    && verdict.retainedAttemptStatuses.length > 0
    && verdict.retainedAttemptStatuses.every((attempt) => attempt.status === 'PASS')
}
