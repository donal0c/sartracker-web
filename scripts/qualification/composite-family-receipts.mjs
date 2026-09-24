import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  C17_ADVERSARIAL_CASE_IDS,
  C17_NUMERIC_SECRET,
  C17_SOURCE_CORPUS_TESTS,
} from './c17-adversarial-corpus.mjs'
import {
  buildC17OutputScanIdentity,
  C17_OUTPUT_BYTE_LIMIT,
  C17_OUTPUT_SCAN_IDENTITY_SCHEMA,
  scanC17OutputFileSync,
} from './c17-output-scan.mjs'

const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const COMPOSITE_PROOF_KIND = 'packaged-composite-v1'
const PRODUCER_CONTRACT_ID = 'C28'
const PASS_PHRASE = 'C28-Composite-Archive-9!x'
const C17_EXPORT_PATH = ['diagnostics-reports', 'c17-diagnostics-support.txt']
export const C17_CANARY_IDS = Object.freeze([
  'direct-content-secret',
  'direct-content-passphrase',
  'direct-content-recovery-code',
  'direct-content-profile-path',
  'event-password',
  'event-nested-token',
  'event-authorization-header',
  'event-query-credential',
  'nested-array-secret',
  'nested-array-profile-path',
  'url-credentials',
  'event-numeric-recovery-code',
  'event-long-secret-key',
])
export const C17_POSITIVE_CONTROL_PREFIX = 'C17-CONTROL:'

/** Returns the non-secret marker proving one C17 canary reached the export. */
export function c17PositiveControlMarker(canaryId) {
  return `${C17_POSITIVE_CONTROL_PREFIX}${canaryId}`
}

/** The contract families which have an independently scoped composite receipt. */
export const COMPOSITE_FAMILY_CONTRACTS = Object.freeze(['C03', 'C11', 'C17'])

/** The retained C28 phase used as the source of each family receipt. */
export const COMPOSITE_FAMILY_PHASES = Object.freeze({
  C03: 'missionOutingParticipants',
  C11: 'markerSearch',
  C17: 'sanitizedDiagnostics',
})

/** Recompute the fixed C11 pass identity sequence without trusting a report digest. */
export function computeExpectedPassSequenceSha256(assignmentId) {
  if (!nonEmpty(assignmentId)) return null
  const sequence = createHash('sha256')
  for (let index = 0; index < 50_000; index += 1) {
    const passId = index === 0 ? 'c28-pass' : `c11-pass-${String(index).padStart(5, '0')}`
    const outcome = index === 1 ? 'partial' : index === 2 ? 'aborted' : 'full'
    sequence.update(JSON.stringify({ id: passId, assignmentId, outcome }) + '\n')
  }
  return sequence.digest('hex')
}

const FAMILY_COVERAGE_GAPS = Object.freeze({
  C03: Object.freeze([
    '12-outing-midnight-boundary',
    'known-at-fix-time-late-fix-scope',
    'excluded-device-zero-row',
  ]),
  C11: Object.freeze([
    'repeated-full-partial-aborted-pass-outcomes',
    '50000-pass-paging',
  ]),
  C17: Object.freeze([
    'recursive-adversarial-corpus',
    'bounded-output-scan-identity',
  ]),
})

const EXPECTED_KEYS = Object.freeze([
  'appPath', 'appSha256', 'contractId', 'evidencePath', 'profilePath',
  'sourceHead', 'sourceManifest', 'sourceRoot',
])

/**
 * Validate one independently scoped packaged-composite contract receipt.
 *
 * The report remains a C28 producer report. This function validates only the
 * requested C03, C11 or C17 phase facts and retains that producer identity in
 * the result. It never promotes source-suite or browser-suite evidence to the
 * package tier and never reads a producer pass/familyComplete flag.
 *
 * @param {unknown} report retained packaged C28 composite report
 * @param {unknown} expected controller-owned app/profile/source binding
 * @returns {Readonly<Record<string, unknown>>} fail-closed contract receipt
 */
export function validateCompositeFamilyReceipt(report, expected) {
  const failures = []
  const proof = {}
  const binding = readExpected(expected, failures)
  if (binding !== null) validateReportIdentity(report, binding, failures)
  if (binding !== null) validateFamilyPhase(report, binding.contractId, binding, failures, proof)
  const uniqueFailures = [...new Set(failures)]
  const valid = uniqueFailures.length === 0
  const coverageGaps = binding === null ? [] : deriveCoverageGaps(report, binding.contractId, proof)
  const observedProductFailure = binding !== null && binding.contractId === 'C17'
    && isObservedC17PrivacyFailure(report?.phases?.sanitizedDiagnostics, binding)
    && uniqueFailures.every((reason) => isC17ProductPredicateFailure(reason)
      || reason.startsWith('C17 bounded diagnostic scanner facts')
      || reason.startsWith('C17 output scan identity')
      || reason.startsWith('C17 retained output'))
  return Object.freeze({
    contractId: binding?.contractId ?? (isRecord(expected) ? expected.contractId : null),
    producerContractId: PRODUCER_CONTRACT_ID,
    phase: binding === null ? null : COMPOSITE_FAMILY_PHASES[binding.contractId],
    proofMode: 'packaged-composite',
    // A well-formed retained C17 export containing the fixed secret is an
    // observed product failure, not malformed evidence. It remains ineligible.
    status: observedProductFailure ? 'FAIL' : valid ? 'PASS' : 'INVALID_EVIDENCE',
    valid,
    passed: valid,
    observedProductFailure,
    evidenceComplete: valid || observedProductFailure,
    // `complete` is reserved for the fixed contract slice. Partial retained
    // phase facts must never look like full-family admission to a controller.
    complete: valid && coverageGaps.length === 0,
    coverageComplete: valid && coverageGaps.length === 0,
    coverageGaps: Object.freeze(coverageGaps),
    campaignEligible: false,
    releaseEligible: false,
    sourceBrowserSubstitution: false,
    appPath: binding?.appPath ?? null,
    profilePath: binding?.profilePath ?? null,
    sourceHead: binding?.sourceHead ?? null,
    failureReasons: Object.freeze(uniqueFailures),
    phaseFacts: clone(binding === null ? null : report?.phases?.[COMPOSITE_FAMILY_PHASES[binding.contractId]]),
  })
}

/**
 * Validate all fixed family bindings independently and expose omitted bindings.
 *
 * @param {unknown} report retained packaged C28 composite report
 * @param {unknown} expectedByContract map keyed by C03, C11 and C17
 * @returns {Readonly<Record<string, Readonly<Record<string, unknown>>>>} receipts by contract
 */
export function validateCompositeFamilyCoverage(report, expectedByContract) {
  const result = {}
  for (const contractId of COMPOSITE_FAMILY_CONTRACTS) {
    const expected = isRecord(expectedByContract) ? expectedByContract[contractId] : undefined
    if (expected === undefined) {
      result[contractId] = missingBindingReceipt(contractId)
    } else {
      result[contractId] = validateCompositeFamilyReceipt(report, expected)
    }
  }
  return Object.freeze(result)
}

/** Validate the strict expected identity supplied by the campaign controller. */
function readExpected(expected, failures) {
  const required = expected !== null && typeof expected === 'object'
    ? Object.fromEntries(Object.entries(expected).filter(([key]) => key !== 'retainedEvidencePath'))
    : expected
  if (!hasExactKeys(required, EXPECTED_KEYS)) {
    failures.push('Composite family expected binding has missing or unsupported fields.')
    return null
  }
  if (!COMPOSITE_FAMILY_CONTRACTS.includes(expected.contractId)) {
    failures.push('Composite family contract ID is unsupported.')
  }
  validateCanonicalPath(expected.appPath, 'app artifact', failures)
  validateCanonicalPath(expected.evidencePath, 'evidence directory', failures)
  if (expected.retainedEvidencePath !== undefined) {
    validateCanonicalPath(expected.retainedEvidencePath, 'retained evidence directory', failures)
  }
  validateCanonicalPath(expected.profilePath, 'profile directory', failures)
  validateCanonicalPath(expected.sourceRoot, 'source root', failures)
  if (typeof expected.evidencePath === 'string' && typeof expected.profilePath === 'string'
      && !isWithin(expected.profilePath, expected.evidencePath)) {
    failures.push('Composite family profile is outside the disposable evidence directory.')
  }
  if (!SHA256.test(expected.appSha256)) failures.push('Composite family expected app SHA-256 is invalid.')
  if (!SHA1.test(expected.sourceHead)) failures.push('Composite family expected source head is invalid.')
  validateManifest(expected.sourceManifest, expected.sourceRoot, failures)
  return expected
}

/** Validate app, source, profile, invocation and package proof identities. */
function validateReportIdentity(report, expected, failures) {
  if (!isRecord(report)) {
    failures.push('Composite family report is not an object.')
    return
  }
  if (report.schemaVersion !== 1 || report.proofKind !== COMPOSITE_PROOF_KIND
      || report.contractId !== PRODUCER_CONTRACT_ID) {
    failures.push('Composite family report is not a packaged C28 composite receipt.')
  }
  if (report.proofMode !== undefined && report.proofMode !== 'packaged-composite') {
    failures.push('Composite family report proof mode is not packaged-composite.')
  }
  validateSource(report.source, expected, failures)
  validateApp(report.app, expected, failures)
  validateInvocation(report.invocation, expected, failures)
  validateProfile(report.profile, expected, failures)
  validateMission(report.mission, failures)
  validateNetwork(report.network, failures)
  validateRuntime(report.run, report.stderr, failures, expected.contractId)
  if (!Array.isArray(report.gaps)) failures.push('Composite family report gap inventory is missing.')
  else if (report.gaps.some((gap) => !isRecord(gap) || typeof gap.phase !== 'string' || typeof gap.reason !== 'string')) {
    failures.push('Composite family report gap inventory contains malformed entries.')
  }
}

/** Validate the source head, clean-tree state and every manifest file on disk. */
function validateSource(source, expected, failures) {
  if (!hasExactKeys(source, ['dirty', 'expectedHead', 'manifest', 'observedHead'])
      || source.dirty !== false || source.expectedHead !== expected.sourceHead
      || source.observedHead !== expected.sourceHead || !sameManifest(source.manifest, expected.sourceManifest)) {
    failures.push('Composite family source identity is missing, dirty or substituted.')
    return
  }
  for (const entry of expected.sourceManifest) {
    try {
      const bytes = readFileSync(path.resolve(expected.sourceRoot, entry.relativePath))
      if (sha256(bytes) !== entry.sha256 || bytes.byteLength !== entry.sizeBytes) {
        failures.push(`Composite family source identity changed for ${entry.relativePath}.`)
      }
    } catch {
      failures.push(`Composite family source file is unavailable: ${entry.relativePath}.`)
    }
  }
}

/** Validate the expected artifact and the independently hashed packaged app. */
function validateApp(app, expected, failures) {
  if (!hasExactKeys(app, [
    'packagedAppPath', 'packagedAppSha256', 'path', 'retainedPackagedAppPath',
    'retainedPackagedAppSha256', 'sha256', 'sizeBytes',
  ])
      || app.path !== expected.appPath || app.sha256 !== expected.appSha256
      || !SHA256.test(app.sha256) || !Number.isSafeInteger(app.sizeBytes) || app.sizeBytes < 1
      || typeof app.packagedAppPath !== 'string' || !path.isAbsolute(app.packagedAppPath)
      || path.resolve(app.packagedAppPath) !== app.packagedAppPath
      || !app.packagedAppPath.endsWith('.asar') || !SHA256.test(app.packagedAppSha256)
      || typeof app.retainedPackagedAppPath !== 'string' || !path.isAbsolute(app.retainedPackagedAppPath)
      || path.resolve(app.retainedPackagedAppPath) !== app.retainedPackagedAppPath
      || !app.retainedPackagedAppPath.endsWith('.asar')
      || !isWithin(app.retainedPackagedAppPath, retainedEvidenceRoot(expected))
      || !SHA256.test(app.retainedPackagedAppSha256)
      || app.retainedPackagedAppSha256 !== app.packagedAppSha256) {
    failures.push('Composite family app identity is missing or substituted.')
    return
  }
  try {
    const artifact = readFileSync(expected.appPath)
    if (sha256(artifact) !== expected.appSha256 || artifact.byteLength !== app.sizeBytes) {
      failures.push('Composite family artifact bytes differ from the expected identity.')
    }
  } catch {
    failures.push('Composite family artifact is unavailable for independent hashing.')
  }
  try {
    // AppImage mounts are ephemeral and disappear when the packaged process
    // exits. Revalidate the controller-bound retained copy instead of
    // reopening the transient runtime path.
    const retainedPackaged = readFileSync(app.retainedPackagedAppPath)
    if (sha256(retainedPackaged) !== app.retainedPackagedAppSha256
        || sha256(retainedPackaged) !== app.packagedAppSha256) {
      failures.push('Composite family packaged app bytes differ from the retained digest.')
    }
  } catch {
    failures.push('Composite family retained packaged app copy is unavailable for independent hashing.')
  }
}

/** Validate the fixed command and network/profile handoff fields. */
function validateInvocation(invocation, expected, failures) {
  if (!hasExactKeys(invocation, ['app', 'evidence', 'expectedHead', 'networkBlocked', 'userDataPath'])
      || invocation.app !== '--app' || invocation.evidence !== '--evidence'
      || invocation.expectedHead !== '--expected-head' || invocation.networkBlocked !== true
      || invocation.userDataPath !== expected.profilePath) {
    failures.push('Composite family invocation did not retain the fixed app/evidence/head and profile binding.')
  }
}

/** Validate disposable profile custody across the entire composite run. */
function validateProfile(profile, expected, failures) {
  if (!hasExactKeys(profile, [
    'observedUserDataPaths', 'path', 'removed', 'sameProfileAcrossPhases',
    'usedSystemUserProfile', 'userDataPath',
  ]) || profile.path !== expected.profilePath || profile.userDataPath !== expected.profilePath
    || profile.removed !== true || profile.sameProfileAcrossPhases !== true
    || profile.usedSystemUserProfile !== false || !Array.isArray(profile.observedUserDataPaths)
    || profile.observedUserDataPaths.length < 1
    || profile.observedUserDataPaths.some((value) => value !== expected.profilePath)) {
    failures.push('Composite family profile custody is not exact, disposable and single-profile.')
  }
}

/** Validate one stable mission identity for cross-phase comparison. */
function validateMission(mission, failures) {
  if (!hasRequiredKeys(mission, ['missionId', 'nameSha256', 'phaseMissionIds'])
      || typeof mission.missionId !== 'string' || mission.missionId.trim() === ''
      || !SHA256.test(mission.nameSha256) || !Array.isArray(mission.phaseMissionIds)
      || mission.phaseMissionIds.length < 1 || mission.phaseMissionIds.some((id) => id !== mission.missionId)) {
    failures.push('Composite family mission identity is incomplete or cross-boundary substituted.')
  }
}

/** Require blocked network and no completed egress in the disposable run. */
function validateNetwork(network, failures) {
  if (!hasExactKeys(network, ['blocked', 'httpRequests', 'httpsRequests'])
      || network.blocked !== true || network.httpRequests !== 0 || network.httpsRequests !== 0) {
    failures.push('Composite family network boundary was not blocked with zero HTTP(S) egress.')
  }
}

/** Validate the raw primary/restart process identities and bounded stderr facts. */
function validateRuntime(run, stderr, failures, contractId = null) {
  if (!hasExactKeys(run, ['finishedAt', 'firstPid', 'restartPid', 'startedAt'])
      || !isIsoTimestamp(run.startedAt) || !isIsoTimestamp(run.finishedAt)
      || !validPid(run.firstPid)
      || (run.restartPid !== null && (!validPid(run.restartPid) || run.firstPid === run.restartPid))
      || (contractId === null && run.restartPid === null)) {
    failures.push('Composite family process identity is incomplete or duplicated.')
  }
  if (!hasExactKeys(stderr, ['byteLength', 'lines', 'sha256']) || !SHA256.test(stderr.sha256)
      || !Number.isSafeInteger(stderr.byteLength) || stderr.byteLength < 0
      || !Array.isArray(stderr.lines) || stderr.lines.some((line) => typeof line !== 'string')) {
    failures.push('Composite family raw process diagnostics are incomplete.')
  }
}

/** Validate only the requested retained phase, keeping family axes separate. */
function validateFamilyPhase(report, contractId, binding, failures, proof) {
  if (!COMPOSITE_FAMILY_CONTRACTS.includes(contractId)) return
  const phase = report?.phases?.[COMPOSITE_FAMILY_PHASES[contractId]]
  if (!isRecord(phase)) {
    failures.push(`Composite family ${contractId} phase facts are missing.`)
    return
  }
  if (contractId === 'C03') validateC03Phase(phase, report?.mission?.missionId, failures)
  if (contractId === 'C11') validateC11Phase(phase, report?.mission?.missionId, binding, failures)
  if (contractId === 'C17') validateC17Phase(phase, report?.diagnostics, binding, failures, proof)
}

/** Validate mission, outing, participant and backfill facts for the C03 slice. */
function validateC03Phase(phase, missionId, failures) {
  if (!hasRequiredKeys(phase, [
    'backfillCompleted', 'backfillCheckpointCount', 'missionId', 'missionStatus',
    'outingEnded', 'outingId', 'participantCount', 'participantIds', 'supported',
  ]) || phase.supported !== true || phase.missionId !== missionId || phase.missionStatus !== 'active'
    || phase.outingEnded !== true || !nonEmpty(phase.outingId)
    || !Number.isSafeInteger(phase.participantCount) || phase.participantCount < 1
    || !Array.isArray(phase.participantIds) || phase.participantIds.length !== phase.participantCount
    || phase.participantIds.some((id) => !nonEmpty(id)) || new Set(phase.participantIds).size !== phase.participantIds.length
    || phase.backfillCompleted !== true || !Number.isSafeInteger(phase.backfillCheckpointCount)
    || phase.backfillCheckpointCount < 1) {
    failures.push('C03 composite facts do not prove active mission, closed outing, participant scope and backfill.')
  }
  const scopedKeys = [
    'outingCount', 'midnightCrossings', 'scopeOracle', 'knownAtFixTime', 'excludedDeviceId',
    'excludedDeviceObserved', 'excludedDevicePositionRows', 'excludedDeviceRowsInSelectedScope',
  ]
  if (scopedKeys.some((key) => Object.hasOwn(phase, key))) {
    if (phase.outingCount !== 12 || phase.midnightCrossings !== true || phase.scopeOracle !== 'independent'
      || !isRecord(phase.knownAtFixTime) || phase.knownAtFixTime.scopeOracle !== 'independent'
      || !isIsoTimestamp(phase.knownAtFixTime.selectedAt) || !nonEmpty(phase.knownAtFixTime.selectedDeviceId)
      || !isIsoTimestamp(phase.knownAtFixTime.lateFixAt) || phase.knownAtFixTime.lateFixExcluded !== true
      || phase.knownAtFixTime.selectedFixCount !== 1 || phase.knownAtFixTime.lateFixCount !== 1
      || !Array.isArray(phase.knownAtFixTime.rawRows) || phase.knownAtFixTime.rawRows.length !== 2
      || phase.knownAtFixTime.rawRows.some((row) => !isRecord(row)
        || !nonEmpty(row.sourcePositionId) || !isIsoTimestamp(row.timestamp)
        || !isIsoTimestamp(row.receivedAt) || row.timestampSource !== 'fix')
      || new Set(phase.knownAtFixTime.rawRows.map((row) => row.sourcePositionId)).size !== 2
      || !nonEmpty(phase.excludedDeviceId) || phase.excludedDeviceObserved !== true
      || !Number.isSafeInteger(phase.excludedDevicePositionRows) || phase.excludedDevicePositionRows < 1
      || phase.excludedDeviceRowsInSelectedScope !== 0) {
      failures.push('C03 retained known-at-fix scope or excluded-device facts are incomplete or unsafe.')
    }
  }
}

/** Validate marker, area, assignment and pass identities for the C11 slice. */
function validateC11Phase(phase, missionId, binding, failures) {
  if (!hasRequiredKeys(phase, [
    'assignmentId', 'markerCount', 'markerId', 'missionId', 'searchAreaCount',
    'searchAreaId', 'searchPassCount', 'searchPassId', 'supported',
  ]) || phase.supported !== true || phase.missionId !== missionId
    || !nonEmpty(phase.markerId) || !nonEmpty(phase.searchAreaId)
    || !nonEmpty(phase.assignmentId) || !nonEmpty(phase.searchPassId)
    || phase.markerCount !== 1 || phase.searchAreaCount !== 1
    || !Number.isSafeInteger(phase.searchPassCount) || phase.searchPassCount < 1
    || (phase.passPaging !== undefined && phase.searchPassCount !== 50_000)) {
    failures.push('C11 composite facts do not prove one same-mission marker, area, assignment and pass.')
    return
  }
  if (phase.passOutcomes !== undefined) validatePassOutcomes(phase.passOutcomes, phase.assignmentId, failures)
  if (phase.passPaging !== undefined) validatePassPaging(phase.passPaging, phase.assignmentId, binding, failures)
}

/** Validate optional repeated pass outcomes when the producer retains them. */
function validatePassOutcomes(passOutcomes, assignmentId, failures) {
  const required = new Set(['full', 'partial', 'aborted'])
  if (!Array.isArray(passOutcomes) || passOutcomes.length < 3
      || passOutcomes.some((pass) => !isRecord(pass) || !nonEmpty(pass.passId)
        || pass.assignmentId !== assignmentId || !required.has(pass.outcome))
      || new Set(passOutcomes.map((pass) => pass.passId)).size !== passOutcomes.length
      || [...required].some((outcome) => !passOutcomes.some((pass) => pass.outcome === outcome))) {
    failures.push('C11 retained repeated pass outcomes are malformed or overwrite one another.')
  }
}

/** Validate a bounded independent page inventory for the fixed 50,000-pass lane. */
function validatePassPaging(passPaging, assignmentId, binding, failures) {
  if (!isRecord(passPaging) || passPaging.totalCount !== 50_000 || passPaging.complete !== true
      || !Number.isSafeInteger(passPaging.pageCount) || passPaging.pageCount < 2
      || passPaging.sequenceSha256 !== computeExpectedPassSequenceSha256(assignmentId)
      || !SHA256.test(passPaging.rawPagesSha256)
      || passPaging.rawPageCount !== passPaging.pageCount
      || passPaging.rawRowCount !== 50_000
      || !validateRawPassPages(passPaging, assignmentId, binding)) {
    failures.push('C11 retained pass paging inventory is incomplete or tampered.')
  }
}

/** Rehash and independently recompute the fixed pass sequence from retained NDJSON pages. */
function validateRawPassPages(passPaging, assignmentId, binding) {
  if (typeof passPaging.rawPagesPath !== 'string' || !path.isAbsolute(passPaging.rawPagesPath)
    || path.resolve(passPaging.rawPagesPath) !== passPaging.rawPagesPath
    || !isWithin(passPaging.rawPagesPath, retainedEvidenceRoot(binding))) return false
  try {
    const bytes = readFileSync(passPaging.rawPagesPath)
    if (sha256(bytes) !== passPaging.rawPagesSha256) return false
    const lines = bytes.toString('utf8').split('\n').filter((line) => line !== '')
    if (lines.length !== passPaging.pageCount) return false
    const sequence = createHash('sha256')
    let seen = 0
    let previousNextCursor = null
    for (let index = 0; index < lines.length; index += 1) {
      const page = JSON.parse(lines[index])
      if (!isRecord(page) || page.pageIndex !== index || page.cursor !== previousNextCursor
        || !Array.isArray(page.entries) || page.totalCount !== 50_000
        || (index === lines.length - 1 ? page.nextCursor !== null : typeof page.nextCursor !== 'string')) return false
      for (const entry of page.entries) {
        if (!isRecord(entry) || entry.assignment_id !== assignmentId || typeof entry.id !== 'string'
          || !['full', 'partial', 'aborted'].includes(entry.outcome)) return false
        sequence.update(JSON.stringify({ id: entry.id, assignmentId: entry.assignment_id, outcome: entry.outcome }) + '\n')
        seen += 1
      }
      previousNextCursor = page.nextCursor
    }
    return seen === 50_000 && sequence.digest('hex') === computeExpectedPassSequenceSha256(assignmentId)
  } catch {
    return false
  }
}

/** Validate both phase and top-level raw scanner facts for the C17 slice. */
function validateC17Phase(phase, diagnostics, binding, failures, proof) {
  if (!hasRequiredKeys(phase, [
    'adversarialMatchCount', 'containsProfilePath', 'containsSecret', 'exactSecretMatches',
    'exported', 'exportedPath', 'pathWithinProfile', 'requested', 'sanitized', 'supported',
  ]) || phase.supported !== true || phase.requested !== true || phase.exported !== true
    || phase.sanitized !== true || phase.containsSecret !== false || phase.containsProfilePath !== false
    || phase.exactSecretMatches !== 0 || phase.adversarialMatchCount !== 0 || phase.pathWithinProfile !== true) {
    failures.push('C17 composite facts do not prove a sanitized export and zero adversarial matches.')
  }
  const expectedExportPath = path.join(binding.profilePath, ...C17_EXPORT_PATH)
  const independentlyWithinProfile = isWithin(phase.exportedPath, binding.profilePath)
  if (phase.exportedPath !== expectedExportPath || phase.pathWithinProfile !== independentlyWithinProfile
    || independentlyWithinProfile !== true) {
    failures.push('C17 export path is not the exact disposable-profile diagnostics path.')
  }
  if (!hasRequiredKeys(diagnostics, [
    'adversarialMatchCount', 'containsProfilePath', 'containsSecret', 'exactSecretMatches',
    'exported', 'exportedPath', 'requested', 'sanitized',
  ]) || diagnostics.requested !== true || diagnostics.exported !== true || diagnostics.sanitized !== true
    || diagnostics.containsSecret !== false || diagnostics.containsProfilePath !== false
    || diagnostics.exactSecretMatches !== 0 || diagnostics.adversarialMatchCount !== 0
    || diagnostics.exportedPath !== phase.exportedPath) {
    failures.push('C17 top-level diagnostics facts are absent or contain an adversarial match.')
  }
  const scannerKeys = [
    'canaryManifestSha256', 'outputSha256', 'outputByteLength', 'canaryCount', 'outputWithinLimit',
    'retainedCanaryManifestPath', 'retainedOutputPath', 'leakedCanaryIds', 'positiveControlIds',
    'sourceCorpusReceiptPath', 'sourceCorpusReceiptSha256', 'outputScanIdentity',
  ]
  if (!hasRequiredKeys(phase, scannerKeys)) {
    failures.push('C17 bounded diagnostic scanner facts are missing.')
    return
  }
  if (!hasRequiredKeys(diagnostics, scannerKeys)) {
    failures.push('C17 top-level diagnostic scanner facts are missing.')
    return
  }
  if (!SHA256.test(phase.canaryManifestSha256) || !SHA256.test(phase.outputSha256)
    || !Number.isSafeInteger(phase.outputByteLength) || phase.outputByteLength < 0
    || phase.canaryCount !== C17_CANARY_IDS.length
    || phase.outputWithinLimit !== true
    || !Array.isArray(phase.leakedCanaryIds)
    || phase.leakedCanaryIds.some((id) => !C17_CANARY_IDS.includes(id))
    || !hasAllC17PositiveControls(phase.positiveControlIds)) {
    failures.push('C17 bounded diagnostic scanner facts are incomplete or unsafe.')
  }
  if (diagnostics.canaryManifestSha256 !== phase.canaryManifestSha256
    || diagnostics.outputSha256 !== phase.outputSha256
    || diagnostics.outputByteLength !== phase.outputByteLength
    || diagnostics.canaryCount !== phase.canaryCount
    || diagnostics.outputWithinLimit !== phase.outputWithinLimit
    || diagnostics.retainedOutputPath !== phase.retainedOutputPath
    || diagnostics.retainedCanaryManifestPath !== phase.retainedCanaryManifestPath
    || diagnostics.sourceCorpusReceiptPath !== phase.sourceCorpusReceiptPath
    || diagnostics.sourceCorpusReceiptSha256 !== phase.sourceCorpusReceiptSha256
    || JSON.stringify(diagnostics.outputScanIdentity) !== JSON.stringify(phase.outputScanIdentity)
    || JSON.stringify(diagnostics.leakedCanaryIds) !== JSON.stringify(phase.leakedCanaryIds)
    || JSON.stringify(diagnostics.positiveControlIds) !== JSON.stringify(phase.positiveControlIds)) {
    failures.push('C17 top-level diagnostics scanner facts do not match the retained phase output.')
  }
  proof.c17SourceCorpusComplete = validateC17SourceCorpusReceipt(phase, diagnostics, binding, failures)
  const outputProof = validateC17OutputProof(phase, binding, failures)
  proof.c17OutputIdentityComplete = outputProof.identityComplete
  proof.c17PackagedCorpusComplete = outputProof.canaryCorpusComplete
  validateRetainedCanaryManifest(phase, binding, failures)
}

/** Validate the retained source-mode runner receipt against the exact source and package bindings. */
function validateC17SourceCorpusReceipt(phase, diagnostics, binding, failures) {
  const receiptPath = path.join(retainedEvidenceRoot(binding), 'c17-source-corpus-receipt.json')
  if (phase.sourceCorpusReceiptPath !== receiptPath
    || !SHA256.test(phase.sourceCorpusReceiptSha256)
    || diagnostics.sourceCorpusReceiptPath !== receiptPath
    || diagnostics.sourceCorpusReceiptSha256 !== phase.sourceCorpusReceiptSha256) {
    failures.push('C17 source corpus receipt path or digest is missing or outside evidence custody.')
    return false
  }
  const scan = scanC17OutputFileSync(receiptPath)
  if (scan.complete !== true || scan.bytes === null
    || scan.sha256 !== phase.sourceCorpusReceiptSha256) {
    failures.push('C17 source corpus receipt is unavailable, oversized or does not match its retained digest.')
    return false
  }

  try {
    const receipt = JSON.parse(scan.bytes.toString('utf8'))
    const expectedManifestSha256 = sha256Text(JSON.stringify(binding.sourceManifest))
    const expectedTests = C17_SOURCE_CORPUS_TESTS.map(({ path: relativePath, name }) => ({ relativePath, name, passed: true }))
    const complete = hasExactKeys(receipt, [
      'appSha256', 'complete', 'corpusCaseIds', 'modes', 'schema', 'sourceHead',
      'sourceManifestSha256', 'status', 'tests', 'totalFailedTests', 'totalPassedTests',
    ]) && receipt.schema === 'sartracker-c17-source-corpus-receipt-v1'
      && receipt.sourceHead === binding.sourceHead
      && receipt.appSha256 === binding.appSha256
      && receipt.sourceManifestSha256 === expectedManifestSha256
      && receipt.status === 'PASS' && receipt.complete === true
      && JSON.stringify(receipt.modes) === JSON.stringify(['renderer', 'electron-main'])
      && JSON.stringify(receipt.corpusCaseIds) === JSON.stringify(C17_ADVERSARIAL_CASE_IDS)
      && Array.isArray(receipt.tests) && receipt.tests.length === expectedTests.length
      && receipt.tests.every((test, index) => hasExactKeys(test, ['name', 'passed', 'relativePath'])
        && test.name === expectedTests[index].name
        && test.relativePath === expectedTests[index].relativePath
        && test.passed === true)
      && Number.isSafeInteger(receipt.totalPassedTests)
      && receipt.totalPassedTests >= expectedTests.length
      && receipt.totalFailedTests === 0
    if (!complete) failures.push('C17 source corpus receipt does not prove the fixed renderer and Electron source tests passed for this head and app.')
    return complete
  } catch {
    failures.push('C17 source corpus receipt is malformed or unreadable.')
    return false
  }
}

/** Scan packaged and retained output bytes independently and recompute all fixed C17 facts. */
function validateC17OutputProof(phase, binding, failures) {
  const retainedRoot = retainedEvidenceRoot(binding)
  const expectedOutputPath = path.join(retainedRoot, 'c17-sanitized-output.txt')
  const expectedManifestPath = path.join(retainedRoot, 'c17-canary-manifest.txt')
  const expectedExportPath = path.join(binding.profilePath, ...C17_EXPORT_PATH)
  if (phase.exportedPath !== expectedExportPath
    || phase.retainedOutputPath !== expectedOutputPath
    || phase.retainedCanaryManifestPath !== expectedManifestPath) {
    failures.push('C17 retained scanner paths are not the exact evidence-custody paths.')
    return { identityComplete: false, canaryCorpusComplete: false }
  }
  const retainedScan = scanC17OutputFileSync(expectedOutputPath)
  if (retainedScan.complete !== true || retainedScan.bytes === null) {
    failures.push('C17 retained output identity scan is incomplete or exceeds the fixed byte limit.')
    return { identityComplete: false, canaryCorpusComplete: false }
  }

  // The packaged profile is deleted before the CLI validates this receipt.
  // The producer retained the exact bounded export bytes before cleanup, so
  // independently bind that snapshot back to the original scan facts here.
  const expectedIdentity = buildC17OutputScanIdentity({
    sourceHead: binding.sourceHead,
    appSha256: binding.appSha256,
    exportedPath: expectedExportPath,
    retainedOutputPath: expectedOutputPath,
    outputScan: retainedScan,
    retainedScan,
  })
  const identityMatches = hasExactKeys(phase.outputScanIdentity, Object.keys(expectedIdentity))
    && Object.entries(expectedIdentity).every(([key, value]) => phase.outputScanIdentity[key] === value)
    && expectedIdentity.schema === C17_OUTPUT_SCAN_IDENTITY_SCHEMA
    && expectedIdentity.scanLimitBytes === C17_OUTPUT_BYTE_LIMIT
    && expectedIdentity.exactBytesMatch === true
  const reportedOutputMatches = phase.outputSha256 === retainedScan.sha256
    && phase.outputByteLength === retainedScan.byteLength
    && phase.outputWithinLimit === true
  if (!identityMatches || !reportedOutputMatches) {
    failures.push('C17 output scan identity does not match the exact packaged and retained bytes.')
  }

  const output = retainedScan.bytes
  const text = output.toString('utf8')
  const values = c17CanaryValues(binding.profilePath)
  const profileVariants = [binding.profilePath, binding.profilePath.replaceAll('\\', '/')]
  const adversarialValues = [
    ...Object.values(values).flat(),
    ...profileVariants,
    `operator:${PASS_PHRASE}@example.invalid`,
    `https://operator:${PASS_PHRASE}@example.invalid/sar`,
  ]
  const leakedCanaryIds = C17_CANARY_IDS.filter((id) => values[id].some((value) => text.includes(value)))
  const positiveControlIds = C17_CANARY_IDS.filter((id) => text.includes(c17PositiveControlMarker(id)))
  const exactSecretMatches = Object.values(values)
    .flat()
    .reduce((count, value) => count + countOccurrences(text, value), 0)
  const adversarialMatchCount = adversarialValues
    .reduce((count, value) => count + countOccurrences(text, value), 0)
  const containsProfilePath = profileVariants.some((value) => text.includes(value))
  const scanFactsMatch = leakedCanaryIds.length === 0
    && JSON.stringify(leakedCanaryIds) === JSON.stringify(phase.leakedCanaryIds)
    && JSON.stringify(positiveControlIds) === JSON.stringify(phase.positiveControlIds)
    && exactSecretMatches === phase.exactSecretMatches
    && adversarialMatchCount === phase.adversarialMatchCount
    && containsProfilePath === phase.containsProfilePath
  if (!scanFactsMatch) failures.push('C17 retained output independently fails the fixed canary or bounded content scan.')
  if (!hasAllC17PositiveControls(positiveControlIds)) {
    failures.push('C17 retained output is missing one or more positive-control markers.')
  }
  return {
    identityComplete: identityMatches && reportedOutputMatches,
    canaryCorpusComplete: scanFactsMatch && hasAllC17PositiveControls(positiveControlIds),
  }
}

/** Require every fixed canary to have a distinct non-secret reachability marker. */
function hasAllC17PositiveControls(value) {
  return Array.isArray(value)
    && JSON.stringify(value) === JSON.stringify(C17_CANARY_IDS)
}

/** Return every fixed C17 canary value, including both platform path spellings. */
function c17CanaryValues(profilePath) {
  const profileVariants = [profilePath, profilePath.replaceAll('\\', '/')]
  const secret = (suffix) => [`${PASS_PHRASE}-${suffix}`]
  const profile = (suffix) => profileVariants.map((value) => `${value}/${suffix}`)
  return {
    'direct-content-secret': secret('direct-content'),
    'direct-content-passphrase': secret('direct-passphrase'),
    'direct-content-recovery-code': secret('direct-recovery-code'),
    'direct-content-profile-path': profile('direct-content-profile'),
    'event-password': secret('event-password'),
    'event-nested-token': secret('event-nested-token'),
    'event-authorization-header': secret('event-authorization-header'),
    'event-query-credential': secret('event-query-credential'),
    'nested-array-secret': secret('nested-array-secret'),
    'nested-array-profile-path': profile('nested-array-profile'),
    'url-credentials': secret('url-credentials'),
    'event-numeric-recovery-code': [String(C17_NUMERIC_SECRET)],
    'event-long-secret-key': secret('long-key-secret'),
  }
}

/** Count non-overlapping occurrences in independently retained diagnostic text. */
function countOccurrences(value, needle) {
  return needle === '' ? 0 : value.split(needle).length - 1
}

/** Rehash the non-secret C17 canary manifest retained beside every raw output. */
function validateRetainedCanaryManifest(phase, binding, failures) {
  if (typeof phase.retainedCanaryManifestPath !== 'string'
    || !path.isAbsolute(phase.retainedCanaryManifestPath)
    || path.resolve(phase.retainedCanaryManifestPath) !== phase.retainedCanaryManifestPath
    || !isWithin(phase.retainedCanaryManifestPath, retainedEvidenceRoot(binding))) {
    failures.push('C17 retained canary manifest path is missing or outside evidence custody.')
    return
  }
  try {
    const scan = scanC17OutputFileSync(phase.retainedCanaryManifestPath)
    const expected = Buffer.from(C17_CANARY_IDS.join('\n'), 'utf8')
    if (scan.complete !== true || scan.bytes === null
      || scan.sha256 !== phase.canaryManifestSha256
      || scan.byteLength !== expected.byteLength
      || !scan.bytes.equals(expected)
      || phase.canaryCount !== C17_CANARY_IDS.length) {
      failures.push('C17 retained canary manifest bytes do not match the fixed scanner corpus.')
    }
  } catch {
    failures.push('C17 retained canary manifest is unavailable for independent re-hash.')
  }
}

/** Recognize a real C17 privacy failure only when raw custody is independently valid. */
function isObservedC17PrivacyFailure(phase, binding) {
  if (!isRecord(phase) || phase.supported !== true || phase.requested !== true
    || phase.exported !== true || phase.pathWithinProfile !== true
    || phase.sanitized !== false || !Array.isArray(phase.leakedCanaryIds)
    || !Number.isSafeInteger(phase.outputByteLength)
    || !SHA256.test(phase.outputSha256) || !SHA256.test(phase.canaryManifestSha256)
    || phase.outputWithinLimit !== true) return false
  if (!isWithin(phase.retainedOutputPath, retainedEvidenceRoot(binding))
    || !isWithin(phase.retainedCanaryManifestPath, retainedEvidenceRoot(binding))) return false
  try {
    const output = scanC17OutputFileSync(phase.retainedOutputPath)
    const manifest = scanC17OutputFileSync(phase.retainedCanaryManifestPath)
    const expectedManifest = Buffer.from(C17_CANARY_IDS.join('\n'), 'utf8')
    return output.complete === true && output.bytes !== null
      && manifest.complete === true && manifest.bytes !== null
      && output.sha256 === phase.outputSha256
      && output.byteLength === phase.outputByteLength
      && manifest.sha256 === phase.canaryManifestSha256
      && manifest.bytes.equals(expectedManifest)
      && retainedTextLeaksC17Secret(output.bytes.toString('utf8'), binding.profilePath)
  } catch {
    return false
  }
}

/**
 * Detect any fixed C17 secret in retained text: the shared pass-phrase, every
 * canary value (including the numeric recovery code), or a bare profile path.
 */
function retainedTextLeaksC17Secret(text, profilePath) {
  const profileVariants = [profilePath, profilePath.replaceAll('\\', '/')]
  return [PASS_PHRASE, ...Object.values(c17CanaryValues(profilePath)).flat(), ...profileVariants]
    .some((value) => text.includes(value))
}

/** Keep a well-formed C17 product predicate failure distinct from identity/custody errors. */
function isC17ProductPredicateFailure(reason) {
  return reason.startsWith('C17 composite facts do not prove')
    || reason.startsWith('C17 top-level diagnostics facts are absent')
    || reason.startsWith('C17 retained output contains')
    || reason.startsWith('C17 retained output independently fails')
}

/** Derive only fixed coverage gaps from retained facts; never read producer flags. */
function deriveCoverageGaps(report, contractId, proof = {}) {
  const gaps = [...(FAMILY_COVERAGE_GAPS[contractId] ?? [])]
  const phase = report?.phases?.[COMPOSITE_FAMILY_PHASES[contractId]]
  if (contractId === 'C03' && hasRequiredKeys(phase, ['outingCount', 'midnightCrossings', 'scopeOracle'])) {
    if (phase.outingCount === 12 && phase.midnightCrossings === true && phase.scopeOracle === 'independent') {
      const knownAtFixComplete = isRecord(phase.knownAtFixTime)
        && phase.knownAtFixTime.scopeOracle === 'independent'
        && isIsoTimestamp(phase.knownAtFixTime.selectedAt)
        && nonEmpty(phase.knownAtFixTime.selectedDeviceId)
        && isIsoTimestamp(phase.knownAtFixTime.lateFixAt)
        && phase.knownAtFixTime.lateFixExcluded === true
        && phase.knownAtFixTime.selectedFixCount === 1
        && phase.knownAtFixTime.lateFixCount === 1
        && Array.isArray(phase.knownAtFixTime.rawRows)
        && phase.knownAtFixTime.rawRows.length === 2
        && phase.knownAtFixTime.rawRows.every((row) => isRecord(row)
          && nonEmpty(row.sourcePositionId) && isIsoTimestamp(row.timestamp)
          && isIsoTimestamp(row.receivedAt) && row.timestampSource === 'fix')
        && new Set(phase.knownAtFixTime.rawRows.map((row) => row.sourcePositionId)).size === 2
      const excludedComplete = nonEmpty(phase.excludedDeviceId)
        && phase.excludedDeviceObserved === true
        && Number.isSafeInteger(phase.excludedDevicePositionRows)
        && phase.excludedDevicePositionRows >= 1
        && phase.excludedDeviceRowsInSelectedScope === 0
      return gaps.filter((gap) => {
        if (gap === '12-outing-midnight-boundary') return false
        if (gap === 'known-at-fix-time-late-fix-scope') return !knownAtFixComplete
        if (gap === 'excluded-device-zero-row') return !excludedComplete
        return true
      })
    }
  }
  if (contractId === 'C11' && hasRequiredKeys(phase, ['passOutcomes', 'passPaging'])) {
    const outcomes = phase.passOutcomes
    const paging = phase.passPaging
    if (isCompletePassOutcomes(outcomes, phase.assignmentId)
        && isRecord(paging) && paging.totalCount === 50_000 && paging.complete === true
        && Number.isSafeInteger(paging.pageCount) && paging.pageCount >= 2
        && paging.sequenceSha256 === computeExpectedPassSequenceSha256(phase.assignmentId)
        && nonEmpty(paging.rawPagesPath) && SHA256.test(paging.rawPagesSha256)
        && paging.rawPageCount === paging.pageCount && paging.rawRowCount === 50_000) {
      return []
    }
  }
  if (contractId === 'C17') {
    return gaps.filter((gap) => {
      if (gap === 'recursive-adversarial-corpus') {
        return !(proof.c17SourceCorpusComplete === true && proof.c17PackagedCorpusComplete === true)
      }
      if (gap === 'bounded-output-scan-identity') {
        return proof.c17OutputIdentityComplete !== true
      }
      return true
    })
  }
  return gaps
}

/** Check the optional complete repeated-pass facts without trusting a summary flag. */
function isCompletePassOutcomes(passOutcomes, assignmentId) {
  if (!Array.isArray(passOutcomes) || passOutcomes.length < 3) return false
  const outcomes = new Set(passOutcomes.map((pass) => pass?.outcome))
  return passOutcomes.every((pass) => isRecord(pass) && nonEmpty(pass.passId) && pass.assignmentId === assignmentId)
    && outcomes.has('full') && outcomes.has('partial') && outcomes.has('aborted')
}

/** Validate a source manifest and independently hash every declared file. */
function validateManifest(manifest, sourceRoot, failures) {
  if (!Array.isArray(manifest) || manifest.length < 1 || new Set(manifest.map((entry) => entry?.relativePath)).size !== manifest.length) {
    failures.push('Composite family source manifest is missing or duplicated.')
    return
  }
  for (const entry of manifest) {
    if (!hasExactKeys(entry, ['relativePath', 'sha256', 'sizeBytes'])
        || typeof entry.relativePath !== 'string' || !isSafeRelativePath(entry.relativePath)
        || !SHA256.test(entry.sha256) || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 1) {
      failures.push('Composite family source manifest contains an invalid entry.')
      continue
    }
    if (typeof sourceRoot !== 'string' || !path.isAbsolute(sourceRoot) || !isWithin(path.resolve(sourceRoot, entry.relativePath), sourceRoot)) {
      failures.push(`Composite family source manifest escapes the source root: ${entry.relativePath}.`)
      continue
    }
    try {
      const bytes = readFileSync(path.resolve(sourceRoot, entry.relativePath))
      if (sha256(bytes) !== entry.sha256 || bytes.byteLength !== entry.sizeBytes) {
        failures.push(`Composite family source manifest digest mismatch: ${entry.relativePath}.`)
      }
    } catch {
      failures.push(`Composite family source manifest file is unavailable: ${entry.relativePath}.`)
    }
  }
}

/** Compare report and expected manifests by identity rather than order. */
function sameManifest(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
  return right.every((expected) => left.some((actual) => actual?.relativePath === expected.relativePath
    && actual.sha256 === expected.sha256 && actual.sizeBytes === expected.sizeBytes))
}

/** Return a fail-closed receipt when one of the fixed bindings was omitted. */
function missingBindingReceipt(contractId) {
  return Object.freeze({
    contractId,
    producerContractId: PRODUCER_CONTRACT_ID,
    phase: COMPOSITE_FAMILY_PHASES[contractId],
    proofMode: 'packaged-composite',
    status: 'INVALID_EVIDENCE',
    valid: false,
    passed: false,
    evidenceComplete: false,
    complete: false,
    coverageComplete: false,
    coverageGaps: Object.freeze([...FAMILY_COVERAGE_GAPS[contractId]]),
    campaignEligible: false,
    releaseEligible: false,
    sourceBrowserSubstitution: false,
    appPath: null,
    profilePath: null,
    sourceHead: null,
    failureReasons: Object.freeze([`${contractId} expected binding was not supplied.`]),
    phaseFacts: null,
  })
}

/** Test whether an object contains all named own properties. */
function hasRequiredKeys(value, keys) {
  return isRecord(value) && keys.every((key) => Object.hasOwn(value, key))
}

/** Test whether an object has exactly the named own properties. */
function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}

/** Test whether a value is a non-array object. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Test whether a string is non-empty after trimming. */
function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== ''
}

/** Validate an absolute canonical path. */
function validateCanonicalPath(value, label, failures) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) {
    failures.push(`Composite family ${label} path is not absolute and canonical.`)
  }
}

/** Test whether a child path is inside a parent path. */
function isWithin(child, parent) {
  if (typeof child !== 'string' || typeof parent !== 'string') return false
  const parentRoot = path.resolve(parent)
  const childRoot = path.resolve(child)
  return childRoot === parentRoot || childRoot.startsWith(`${parentRoot}${path.sep}`)
}

/** Select the optional flat retained-evidence root used after runtime cleanup. */
function retainedEvidenceRoot(binding) {
  return binding?.retainedEvidencePath ?? binding?.evidencePath
}

/** Test whether a manifest path is repository-relative and traversal-free. */
function isSafeRelativePath(value) {
  return value.length > 0 && !path.isAbsolute(value) && path.posix.normalize(value) === value
    && !value.startsWith('../') && value !== '..' && !value.includes('\\')
}

/** Validate a retained ISO-8601 timestamp. */
function isIsoTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

/** Validate a positive process identifier. */
function validPid(value) {
  return Number.isSafeInteger(value) && value > 0
}

/** Compute a SHA-256 digest for bytes. */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Hash one stable UTF-8 text identity. */
function sha256Text(value) {
  return sha256(Buffer.from(value, 'utf8'))
}

/** Clone report facts so callers cannot mutate the retained receipt. */
function clone(value) {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value))
}
