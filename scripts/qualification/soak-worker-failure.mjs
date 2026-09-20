const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const CLEAN_FAILURES = new Set([
  'WORKER_PROCESS_FAILED', 'WORKER_EXECUTION_FAILED', 'WORKER_OUTPUT_INVALID',
  'WORKER_INPUT_INVALID', 'WORKER_INPUT_TOO_LARGE',
])
const FAILURE_CLEANUP = Object.freeze({
  WORKER_UNAVAILABLE: { timedOut: false, cleanupVerified: false, resourceCleanupBlocked: false },
  WORKER_TIMEOUT_CLEAN: { timedOut: true, cleanupVerified: true, resourceCleanupBlocked: false },
  WORKER_TIMEOUT_CLEANUP_UNPROVEN: { timedOut: true, cleanupVerified: false, resourceCleanupBlocked: true },
  WORKER_CLEANUP_UNPROVEN: { timedOut: false, cleanupVerified: false, resourceCleanupBlocked: true },
})
const EMPTY_IDENTITIES = [
  'artifact', 'runtime', 'rawReportPath', 'runtimeObservationsPath',
  'stdoutPath', 'stderrPath', 'rawReportSha256', 'runtimeObservationsSha256',
  'competingOperationReportPath', 'competingOperationReportSha256',
]

/** Admit only an invalid definition-bound worker failure, without artifact I/O. */
export function validateSoakWorkerFailure(receipt, binding, definition) {
  const worker = receipt.workerExecution
  const source = definition?.identities?.source
  if (receipt.schema !== 'sartracker-soak-adapter-receipt-v1'
      || receipt.status !== 'INVALID_EVIDENCE'
      || !['C04', 'C24', 'C25'].includes(binding.contractId)
      || !['ci-appimage', 'installed-deb'].includes(binding.proofMode)
      || receipt.contractId !== binding.contractId || receipt.variantId !== binding.variantId
      || receipt.proofMode !== binding.proofMode
      || !SHA256.test(definition?.definitionDigest ?? '')
      || receipt.definitionDigest !== definition.definitionDigest
      || !SHA1.test(source?.sha ?? '') || !SHA1.test(source?.tree ?? '')
      || receipt.sourceSha !== source.sha || receipt.sourceTree !== source.tree
      || EMPTY_IDENTITIES.some(key => receipt[key] !== null)
      || ['captures', 'captureErrors', 'evidence'].some(key => !Array.isArray(receipt[key]) || receipt[key].length !== 0)
      || receipt.validation?.passed !== false || receipt.validation?.valid !== false
      || receipt.validation?.qualificationEligible !== false
      || receipt.runtimeValidation?.passed !== false || receipt.process?.processError !== null
      || worker?.schema !== 'sartracker-soak-execution-v1'
      || worker.status !== 'INVALID_EVIDENCE'
      || typeof worker.failureCode !== 'string'
      || ['timedOut', 'cleanupVerified', 'zeroDescendantsAfterRun', 'resourceCleanupBlocked']
        .some(key => typeof worker[key] !== 'boolean')
      || worker.cleanupVerified !== worker.zeroDescendantsAfterRun
      || receipt.process?.timedOut !== worker.timedOut
      || receipt.process?.zeroDescendantsAfterRun !== worker.zeroDescendantsAfterRun) {
    throw new Error('Code-only soak failure is not bound to its immutable definition and cleanup facts.')
  }
  const expected = CLEAN_FAILURES.has(worker.failureCode)
    ? { timedOut: false, cleanupVerified: true, resourceCleanupBlocked: false }
    : Object.hasOwn(FAILURE_CLEANUP, worker.failureCode) ? FAILURE_CLEANUP[worker.failureCode] : null
  if (!expected || Object.entries(expected).some(([key, value]) => worker[key] !== value)) {
    throw new Error('Code-only soak failure has an unreviewed code or inconsistent cleanup state.')
  }
  return Object.freeze({
    ...receipt,
    status: 'INVALID_EVIDENCE',
    valid: false,
    passed: false,
    qualificationEligible: false,
    releaseEligible: false,
    failureReasons: Object.freeze([`Owned soak worker failed: ${worker.failureCode}.`]),
  })
}
