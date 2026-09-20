import { validateArchiveLifecycleSmokeEvidence } from '../../build/electron-archive-lifecycle-smoke-lib.js'
import { validateProducerPackageTier } from './package-proof-tier.mjs'

const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const ARCHIVE_CONTRACTS = new Set(['C20', 'C22'])
const ACTUAL_PROOF_MODE = 'packaged-electron-unpacked'
const REQUIRED_CREATE_PHASES = Object.freeze(['encrypt', 'publish', 'seal', 'snapshot', 'staged'])
const REQUIRED_VERIFY_PHASES = Object.freeze(['decrypt', 'inventory', 'plaintext_cleanup', 'replay', 'verified'])
const FAILURE_STATUS = Object.freeze({ INVALID_EVIDENCE: 'INVALID_EVIDENCE', PASS: 'PASS' })

const C21_PRODUCER_GAP = Object.freeze({
  missing: 'No independent C21 archive-security report producer is present.',
  required: Object.freeze([
    'wrong-key and unavailable-key rejection',
    'ciphertext/frame corruption and structural mutation rejection',
    'registered ciphertext/manifest/archive identity and custody binding',
    'hostile-byte secret and plaintext-residue sweep',
  ]),
  insufficientExistingEvidence:
    'The lifecycle report only proves a read-only Review mutation denial; that is C22 evidence and cannot establish C21 key, authenticity, or hostile-byte custody.',
})

/**
 * Validate the independent archive receipt for C20 or C22.
 *
 * The lifecycle producer is intentionally treated as an unpacked packaged-
 * Electron source. `expected` is controller-owned input and must bind source,
 * artifact, workload, and proof mode; no embedded producer verdict is trusted
 * as a substitute for those predicates.
 *
 * C21 has no independent producer in this repository and returns an explicit
 * environment gap. Its lifecycle Review mutation denial is not promoted to
 * archive-security evidence.
 *
 * @param {string} contractId archive contract identifier
 * @param {unknown} report packaged archive-lifecycle report
 * @param {unknown} expected controller-owned source/artifact/workload binding
 * @returns {object} fail-closed receipt validation result
 */
export function validateArchiveContractEvidence(contractId, report, expected) {
  if (contractId === 'C21') return c21MissingProducerResult()
  if (!ARCHIVE_CONTRACTS.has(contractId)) {
    return invalidResult(contractId, ['Archive contract must be C20, C21, or C22.'])
  }

  const failures = []
  const predicates = {
    integrity: false,
    custody: false,
    replay: false,
    cleanup: false,
  }
  const binding = readExpectedBinding(expected, failures)
  validateSchemaAndProducer(report, failures)
  if (binding !== null && isRecord(report)) validateIdentityBinding(report, binding, failures)

  if (contractId === 'C20') {
    validateC20Predicates(report, binding, predicates, failures)
  } else {
    validateC22Predicates(report, binding, predicates, failures)
  }

  return makeResult({
    contractId,
    proofMode: binding?.proofMode,
    predicates,
    failures,
  })
}

/** Return the explicit C21 producer gap without accepting another contract's proof. */
function c21MissingProducerResult() {
  const reason = `C21 producer gap: ${C21_PRODUCER_GAP.missing} ${C21_PRODUCER_GAP.insufficientExistingEvidence}`
  return Object.freeze({
    contractId: 'C21',
    status: 'ENVIRONMENT_BLOCKED',
    valid: false,
    passed: false,
    releaseEligible: false,
    proofMode: null,
    predicates: Object.freeze({ integrity: false, custody: false, replay: false, cleanup: false }),
    failureReasons: Object.freeze([reason]),
    producerGap: C21_PRODUCER_GAP,
  })
}

/** Return a closed invalid-evidence result for unsupported input. */
function invalidResult(contractId, failures) {
  return makeResult({ contractId, proofMode: null, predicates: emptyPredicates(), failures })
}

/** Construct one immutable result without leaking the report or expected values. */
function makeResult({ contractId, proofMode, predicates, failures }) {
  const uniqueFailures = [...new Set(failures)]
  return Object.freeze({
    contractId,
    status: uniqueFailures.length === 0 ? FAILURE_STATUS.PASS : FAILURE_STATUS.INVALID_EVIDENCE,
    valid: uniqueFailures.length === 0,
    passed: uniqueFailures.length === 0,
    releaseEligible: false,
    proofMode: proofMode ?? null,
    predicates: Object.freeze({ ...predicates }),
    failureReasons: Object.freeze(uniqueFailures),
  })
}

/** Return the four archive predicate flags in their initial failed state. */
function emptyPredicates() {
  return { integrity: false, custody: false, replay: false, cleanup: false }
}

/** Validate the latest report schema and run the existing closed lifecycle gates. */
function validateSchemaAndProducer(report, failures) {
  if (!isRecord(report) || report.schemaVersion !== 2
      || report.proofKind !== 'packaged-electron-archive-lifecycle-v2') {
    failures.push('Archive contract requires the latest packaged archive-lifecycle schema v2 report.')
    return
  }
  let lifecycle
  try {
    lifecycle = validateArchiveLifecycleSmokeEvidence(report)
  } catch {
    failures.push('Archive lifecycle report could not be validated.')
    return
  }
  if (lifecycle.valid !== true || lifecycle.passed !== true) {
    failures.push(...(Array.isArray(lifecycle.failureReasons)
      ? lifecycle.failureReasons.map((reason) => `Lifecycle producer gate: ${reason}`)
      : ['Lifecycle producer gate did not return a closed pass.']))
  }
}

/** Read and validate controller-owned exact identity inputs. */
function readExpectedBinding(expected, failures) {
  const candidateTier = ['ci-appimage', 'installed-deb'].includes(expected?.proofMode)
  if (!hasExactKeys(expected, ['artifact', 'proofMode', 'source', 'workload', ...(candidateTier ? ['runtime'] : [])])) {
    failures.push('Archive contract expected binding has missing or unsupported fields.')
    return null
  }
  if (!hasExactKeys(expected.source, ['expectedHead', 'tree'])) {
    failures.push('Archive contract expected source binding is incomplete.')
    return null
  }
  if (!hasExactKeys(expected.artifact, [
    'packagedApplicationArchiveSha256',
    'packagedExecutableSha256',
  ])) {
    failures.push('Archive contract expected artifact binding is incomplete.')
    return null
  }
  if (!hasExactKeys(expected.workload, [
    'missionId',
    'seededOutingChoices',
    'seededPositionRows',
    'seededReplayObjectRows',
  ])) {
    failures.push('Archive contract expected workload binding is incomplete.')
    return null
  }
  if (!SHA1.test(expected.source.expectedHead) || !SHA1.test(expected.source.tree)) {
    failures.push('Archive contract expected source digests are invalid.')
  }
  for (const field of ['packagedExecutableSha256', 'packagedApplicationArchiveSha256']) {
    if (!SHA256.test(expected.artifact[field])) failures.push(`Expected artifact ${field} is invalid.`)
  }
  if (typeof expected.workload.missionId !== 'string' || expected.workload.missionId.length < 1) {
    failures.push('Expected archive workload mission identity is invalid.')
  }
  for (const field of ['seededPositionRows', 'seededReplayObjectRows', 'seededOutingChoices']) {
    if (!Number.isSafeInteger(expected.workload[field]) || expected.workload[field] < 1) {
      failures.push(`Expected archive workload ${field} is invalid.`)
    }
  }
  if (candidateTier) {
    try {
      const runtime = validateProducerPackageTier(expected.proofMode, expected.runtime)
      const launcherSha256 = expected.proofMode === 'ci-appimage' ? runtime.artifactSha256 : runtime.executableSha256
      if (expected.artifact.packagedExecutableSha256 !== launcherSha256
          || expected.artifact.packagedApplicationArchiveSha256 !== runtime.asarSha256) throw new Error('Archive artifact hashes differ from independently observed package runtime.')
    } catch (error) { failures.push(error.message) }
  } else if (expected.proofMode !== ACTUAL_PROOF_MODE) {
    failures.push(
      `Archive lifecycle producer establishes ${ACTUAL_PROOF_MODE}; expected proof mode is not independently produced by this adapter.`,
    )
  }
  return expected
}

/** Bind every source, artifact and workload identity to controller-owned values. */
function validateIdentityBinding(report, expected, failures) {
  const source = report.source
  const workload = report.mission
  if (!isRecord(source) || !isRecord(workload)) {
    failures.push('Archive report source or workload identity is missing.')
    return
  }
  for (const field of ['expectedHead', 'headBefore', 'headAfter']) {
    if (source[field] !== expected.source.expectedHead) {
      failures.push(`Archive source ${field} does not match the expected exact source head.`)
    }
  }
  for (const field of ['treeBefore', 'treeAfter']) {
    if (source[field] !== expected.source.tree) {
      failures.push(`Archive source ${field} does not match the expected exact source tree.`)
    }
  }
  if (source.worktreeCleanBefore !== true || source.worktreeCleanAfter !== true) {
    failures.push('Archive source worktree cleanliness is not independently proven.')
  }
  for (const field of ['packagedExecutableSha256', 'packagedApplicationArchiveSha256']) {
    if (source[field] !== expected.artifact[field]) {
      failures.push(`Archive artifact ${field} does not match the expected exact artifact.`)
    }
  }
  for (const field of [
    'missionId',
    'seededPositionRows',
    'seededReplayObjectRows',
    'seededOutingChoices',
  ]) {
    const expectedField = field
    if (workload[field] !== expected.workload[expectedField]) {
      failures.push(`Archive workload ${field} does not match the expected exact workload.`)
    }
  }
}

/** Validate C20's streamed creation, verification and source-snapshot predicates. */
function validateC20Predicates(report, expected, predicates, failures) {
  predicates.integrity = checkC20Integrity(report, failures)
  predicates.custody = checkCustody(report, failures)
  predicates.replay = checkReplay(report, expected, 'reviewBeforeCleanup', failures)
  predicates.cleanup = checkCleanup(report, expected, failures)
}

/** Validate C22's independent restore/review/revision and cleanup predicates. */
function validateC22Predicates(report, expected, predicates, failures) {
  predicates.integrity = checkC22Integrity(report, failures)
  predicates.custody = checkC22Custody(report, failures)
  predicates.replay = checkReplayEquality(report, expected, failures)
  predicates.cleanup = checkCleanup(report, expected, failures)
}

/** Check archive status, ciphertext identity and exhaustive create/verify phases. */
function checkC20Integrity(report, failures) {
  const archive = report?.archive
  const valid = isRecord(archive)
    && archive.containerVersion === 2
    && archive.statusAfterFinalize === 'verified'
    && archive.statusAfterIndependentVerify === 'verified'
    && archive.availability === 'present'
    && SHA256.test(archive.ciphertextSha256)
    && Number.isSafeInteger(archive.sizeBytes)
    && archive.sizeBytes > 0
    && containsRequiredPhases(archive.createProgressPhases, REQUIRED_CREATE_PHASES)
    && containsRequiredPhases(archive.verifyProgressPhases, REQUIRED_VERIFY_PHASES)
  if (!valid) failures.push('C20 integrity predicate failed for archive identity or exhaustive phases.')
  return valid
}

/** Check C22 archive identity and both immutable review sessions. */
function checkC22Integrity(report, failures) {
  const archive = report?.archive
  const before = report?.reviewBeforeCleanup
  const after = report?.reviewAfterCleanup
  const valid = isRecord(archive)
    && archive.containerVersion === 2
    && archive.statusAfterIndependentVerify === 'verified'
    && archive.availability === 'present'
    && SHA256.test(archive.ciphertextSha256)
    && reviewVerified(before)
    && reviewVerified(after)
  if (!valid) failures.push('C22 integrity predicate failed for verified archive review identity.')
  return valid
}

/** Check interrupted restore, secret handling, and final plaintext custody. */
function checkCustody(report, failures) {
  const interruption = report?.interruptedRestore
  const privacy = report?.privacy
  const before = report?.reviewBeforeCleanup
  const after = report?.reviewAfterCleanup
  const valid = isRecord(interruption)
    && interruption.supported === true
    && interruption.progressTriggered === true
    && interruption.triggerPhase === 'decrypt'
    && interruption.killSignalRequested === 'SIGKILL'
    && interruption.exitSignal === 'SIGKILL'
    && Number.isSafeInteger(interruption.residualEntriesBeforeRestart)
    && interruption.residualEntriesBeforeRestart > 0
    && interruption.plaintextFileObservedBeforeRestart === true
    && interruption.privacyCanaryDetectedBeforeRestart === true
    && interruption.restartSweepCompleted === true
    && interruption.residualEntriesAfterRestart === 0
    && isRecord(privacy)
    && privacy.secretsProvidedOnlyViaPreload === true
    && privacy.secretsAbsentFromProcessArguments === true
    && privacy.secretsAbsentFromEvidence === true
    && privacy.exactSecretMatches === 0
    && privacy.plaintextResidueEntriesAtEnd === 0
    && reviewCustody(before)
    && reviewCustody(after)
  if (!valid) failures.push('Archive custody predicate failed for interruption, privacy, or review residue.')
  return valid
}

/** Check C22's read-only review custody boundary independently of C20. */
function checkC22Custody(report, failures) {
  const before = report?.reviewBeforeCleanup
  const after = report?.reviewAfterCleanup
  const valid = reviewCustody(before) && reviewCustody(after)
    && before.archiveIdMatched === after.archiveIdMatched
    && before.readMissionIdMatched === after.readMissionIdMatched
  if (!valid) failures.push('C22 custody predicate failed for immutable review sessions.')
  return valid
}

/** Check one review's immutable, redacted and mutation-denial custody facts. */
function reviewCustody(review) {
  return isRecord(review)
    && review.opened === true
    && review.immutable === true
    && review.verified === true
    && review.mutationDenied === true
    && review.denialAudited === true
    && review.openPrivacyCanaryDetected === true
    && review.openDirectoriesOwnerOnly === true
    && review.openFilesOwnerOnly === true
    && review.openResidualFileCount > 0
    && review.residualEntriesAfterClose === 0
    && review.closed === true
}

/** Check C20's exhaustive Replay counts against the exact expected workload. */
function checkReplay(report, expected, field, failures) {
  const review = report?.[field]
  const workload = expected?.workload
  const valid = isRecord(review) && isRecord(workload)
    && review.breadcrumbCount === workload.seededPositionRows
    && review.replayTrackCount === workload.seededPositionRows
    && review.replayObjectCount === workload.seededReplayObjectRows
    && review.replayOutingFilterCount === workload.seededOutingChoices
    && SHA256.test(review.contentSha256)
  if (!valid) failures.push('C20 replay predicate failed for exhaustive seeded evidence.')
  return valid
}

/** Check C22 Replay equality before and after live-store cleanup. */
function checkReplayEquality(report, expected, failures) {
  const before = report?.reviewBeforeCleanup
  const after = report?.reviewAfterCleanup
  const countsMatch = isRecord(before) && isRecord(after)
    && before.breadcrumbCount === after.breadcrumbCount
    && before.replayTrackCount === after.replayTrackCount
    && before.replayObjectCount === after.replayObjectCount
    && before.replayOutingFilterCount === after.replayOutingFilterCount
    && before.contentSha256 === after.contentSha256
  const expectedCounts = checkReplay(report, expected, 'reviewBeforeCleanup', [])
  const valid = countsMatch && expectedCounts
  if (!valid) failures.push('C22 replay predicate failed for restored review equality.')
  return valid
}

/** Check cleanup completion, live-row removal, and archive retention. */
function checkCleanup(report, expected, failures) {
  const cleanup = report?.cleanup
  const workload = expected?.workload
  const after = report?.reviewAfterCleanup
  const valid = isRecord(cleanup) && isRecord(workload)
    && cleanup.eligibilityChecked === true
    && cleanup.eligibleBeforeCredential === false
    && cleanup.freshCredentialOnlyBlocker === true
    && cleanup.completed === true
    && cleanup.storageState === 'archived'
    && Number.isSafeInteger(cleanup.movedRows)
    && cleanup.movedRows >= workload.seededPositionRows
    && cleanup.remainingBreadcrumbRows === 0
    && isRecord(after)
    && after.residualEntriesAfterClose === 0
  if (!valid) failures.push('Archive cleanup predicate failed for archived state or live-row removal.')
  return valid
}

/** Check that every required phase is present exactly once in a sorted set. */
function containsRequiredPhases(value, required) {
  return Array.isArray(value)
    && new Set(value).size === value.length
    && [...value].sort().join('\0') === value.join('\0')
    && required.every((phase) => value.includes(phase))
}

/** Check a review has a verified archive identity and a stable content digest. */
function reviewVerified(review) {
  return isRecord(review)
    && review.opened === true
    && review.verified === true
    && review.archiveIdMatched === true
    && review.readMissionIdMatched === true
    && SHA256.test(review.contentSha256)
}

/** Return whether a value is a non-array record. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Return whether a record has exactly the expected own keys. */
function hasExactKeys(value, keys) {
  return isRecord(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}
