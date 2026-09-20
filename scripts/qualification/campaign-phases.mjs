const FAILURE_PRIORITY = ['INVALID_EVIDENCE', 'CLEANUP_BLOCKED', 'FAIL', 'ABORTED_SAFE', 'ENVIRONMENT_BLOCKED', 'NEEDS_HUMAN_DECISION']

/** Enforce the approved separation between draft admission and fresh public-byte verification. */
export function validateQualificationPhase(binding) {
  const phase = binding.phase ?? 'prepublication'
  if (!['prepublication', 'postpublication'].includes(phase)) throw new Error('Qualification phase is invalid.')
  if (phase === 'postpublication' && binding.contractId !== 'C00') throw new Error('Only C00 fresh-public verification belongs to the postpublication gate.')
  if (phase === 'postpublication' && binding.proofMode !== 'public-release') throw new Error('Postpublication verification requires distinct public-release evidence.')
  if (binding.proofMode === 'public-release' && phase !== 'postpublication') throw new Error('Fresh public evidence cannot be required or claimed before publication.')
}

/** Compute both mandatory phase outcomes from independently verified attempts; never authorise publication or rollout. */
export function evaluateQualificationPhases(bindings, attempts, evidenceErrors, productCapabilityBlockers = []) {
  const prepublication = evaluatePhase('prepublication', bindings, attempts, evidenceErrors, productCapabilityBlockers)
  const postpublication = evaluatePhase('postpublication', bindings, attempts, evidenceErrors)
  return Object.freeze({ prepublication, postpublication,
    evidenceComplete: prepublication.status === 'PASS' && postpublication.status === 'PASS',
    releaseComplete: false, teamRolloutEligible: false,
    requiredDisposition: ['FAIL', 'INVALID_EVIDENCE'].includes(postpublication.status)
      ? 'block-team-rollout-and-withdraw-or-rollback' : 'retain-release-and-rollout-gates',
  })
}

/** Retain all failures and require every mandatory variant in the named phase. */
function evaluatePhase(phase, bindings, attempts, evidenceErrors, productCapabilityBlockers = []) {
  const required = bindings.filter((binding) => binding.mandatory && (binding.phase ?? 'prepublication') === phase)
  const keys = new Set(required.map((binding) => `${binding.contractId}:${binding.variantId}`))
  const rows = attempts.filter((row) => keys.has(`${row.contractId}:${row.variantId}`))
  const missing = [...keys].filter((key) => !rows.some((row) => `${row.contractId}:${row.variantId}` === key))
  const failure = FAILURE_PRIORITY.find((status) => rows.some((row) => row.status === status))
  const status = evidenceErrors.length ? 'INVALID_EVIDENCE' : failure
    ?? (productCapabilityBlockers.length ? 'FAIL' : null)
    ?? (missing.length || !required.length ? 'NOT_RUN' : rows.every((row) => row.status === 'PASS') ? 'PASS' : 'INVALID_EVIDENCE')
  return Object.freeze({ phase, status, missing: Object.freeze(missing), requiredVariants: required.length,
    productCapabilityBlockers: Object.freeze([...productCapabilityBlockers]),
  })
}
