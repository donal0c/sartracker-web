import path from 'node:path'

const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const PROOF_MODES = new Set(['packaged-module', 'source-calibration'])
export const CASE_IDS = Object.freeze([
  'valid-roundtrip',
  'recovery-roundtrip',
  'machine-slot-unlock',
  'wrong-key',
  'flip',
  'truncate',
  'append',
  'duplicate-frame',
  'reorder-frame',
  'missing-key-slot',
  'duplicate-key-slot',
  'slot-replacement',
  'unavailable-key-slot',
  'splice-frame',
  'mission-header-swap',
  'epoch-header-swap',
  'entry-boundary-duplicate',
  'entry-boundary-index-gap',
  'legacy-v1-roundtrip',
  'legacy-v1-mutant',
  'manifest-inventory-extra',
  'registry-ciphertext-swap',
  'archive-replaced-during-verify',
  'same-open-file-replacement',
  'cross-process-custody-reconciliation',
])
export const KEY_SLOT_CASE_IDS = Object.freeze([
  'recovery-roundtrip',
  'machine-slot-unlock',
  'missing-key-slot',
  'duplicate-key-slot',
  'slot-replacement',
  'unavailable-key-slot',
])
export const CUSTODY_CASE_IDS = Object.freeze([
  'registry-ciphertext-swap',
  'archive-replaced-during-verify',
  'same-open-file-replacement',
  'cross-process-custody-reconciliation',
])
const RUNTIME_KEYS = Object.freeze([
  'appAsarPath', 'appAsarSha256', 'executablePath', 'executableSha256', 'sourceRoot', 'tier',
])
const REPORT_KEYS = Object.freeze([
  'cases', 'contractId', 'corpus', 'fixture', 'proofKind', 'proofMode',
  'runtime', 'schemaVersion', 'secretCanaryScan', 'sourceSha',
])
const FIXTURE_KEYS = Object.freeze([
  'archiveSha256', 'entryCount', 'entryNames', 'frameCount', 'headerSha256',
  'plaintextBytes', 'plaintextSha256', 'sizeBytes',
])
const CORPUS_KEYS = Object.freeze([
  'caseIds', 'coveredCaseIds', 'coveredCustodyCases', 'coveredKeySlotCases', 'id',
  'missingCustodyCases', 'missingKeySlotCases', 'missingStructuralCases', 'requiredCaseIds',
])
const CASE_KEYS = Object.freeze(['boundary', 'custody', 'id', 'input', 'kind', 'mutation', 'original', 'plaintext', 'result'])
const BOUNDARY_KEYS = Object.freeze(['byteOffset', 'frameIndex', 'operation'])
const INPUT_KEYS = Object.freeze(['sha256', 'sizeBytes'])
const RESULT_KEYS = Object.freeze(['accepted', 'classification', 'code', 'message', 'name'])
const PLAINTEXT_KEYS = Object.freeze([
  'entryNames', 'observedBytes', 'observedSha256', 'residueDetected', 'residuePaths', 'retainedBytes',
])
const ORIGINAL_KEYS = Object.freeze(['sha256', 'sizeBytes', 'unchanged'])
const CUSTODY_KEYS = Object.freeze([
  'callbackRan', 'identityChanged', 'initialSha256', 'initialSizeBytes', 'inspected',
  'reconciliationExpectedSha256', 'reconciliationExpectedSizeBytes',
  'reconciliationFileIdentity', 'reconciliationObservedSha256',
  'reconciliationObservedSizeBytes', 'reconciliationOutcome',
  'reconciliationWorkerExited', 'replacementSha256', 'replacementSizeBytes',
])

/** Validate one bounded C21 archive-security report without trusting a producer verdict. */
export function validateArchiveSecurityReceipt(report, expected) {
  const failures = []
  const binding = readExpectedBinding(expected, failures)
  if (binding === null) return makeResult(null, failures, null)
  try {
    validateReport(report, binding, failures)
  } catch (error) {
    failures.push(`Archive-security report could not be validated: ${error instanceof Error ? error.message : 'unknown parser error'}.`)
  }
  const coverageGaps = extractCoverageGaps(report)
  return makeResult(binding, failures, report, coverageGaps)
}

/** Read the exact controller-owned source, runtime, and corpus binding. */
function readExpectedBinding(expected, failures) {
  if (!hasExactKeys(expected, ['caseIds', 'corpusId', 'proofMode', 'runtime', 'sourceSha'])) {
    failures.push('C21 expected binding has missing or unsupported fields.')
    return null
  }
  if (!SHA1.test(expected.sourceSha)) failures.push('C21 expected source SHA is invalid.')
  if (expected.corpusId !== 'sararch2-frame-mutation-v1') failures.push('C21 expected corpus ID is unsupported.')
  if (!sameArray(expected.caseIds, CASE_IDS)) failures.push('C21 expected corpus case identity is incomplete or reordered.')
  validateExpectedRuntime(expected.runtime, expected.proofMode, failures)
  return expected
}

/** Validate the package/source runtime identity required by the evidence tier. */
function validateExpectedRuntime(runtime, proofMode, failures) {
  if (!PROOF_MODES.has(proofMode)) failures.push('C21 expected proof mode is unsupported.')
  if (!hasExactKeys(runtime, RUNTIME_KEYS)) {
    failures.push('C21 expected runtime binding has missing or unsupported fields.')
    return
  }
  validatePath(runtime.executablePath, 'C21 expected executable path', failures)
  if (!SHA256.test(runtime.executableSha256)) failures.push('C21 expected executable SHA-256 is invalid.')
  if (proofMode === 'source-calibration') {
    if (runtime.tier !== 'source-calibration' || typeof runtime.sourceRoot !== 'string') {
      failures.push('C21 source-calibration runtime binding is invalid.')
    } else validatePath(runtime.sourceRoot, 'C21 expected source root', failures)
    if (runtime.appAsarPath !== null || runtime.appAsarSha256 !== null) {
      failures.push('C21 source-calibration evidence must not carry package identity.')
    }
  }
  if (proofMode === 'packaged-module') {
    if (runtime.tier !== 'packaged-module' || typeof runtime.appAsarPath !== 'string'
        || !runtime.appAsarPath.endsWith('.asar') || !SHA256.test(runtime.appAsarSha256)) {
      failures.push('C21 packaged-module runtime must bind an app.asar and its SHA-256.')
    } else validatePath(runtime.appAsarPath, 'C21 expected app.asar path', failures)
    if (runtime.sourceRoot !== null) failures.push('C21 packaged-module evidence must not carry source-root identity.')
  }
}

/** Validate the exact report schema and every independently observed case fact. */
function validateReport(report, binding, failures) {
  if (!hasExactKeys(report, REPORT_KEYS)) {
    failures.push('C21 archive-security report has missing or unsupported fields.')
    return
  }
  if (report.schemaVersion !== 1 || report.proofKind !== 'c21-archive-security-probe-v1'
      || report.contractId !== 'C21' || report.proofMode !== binding.proofMode
      || report.sourceSha !== binding.sourceSha) {
    failures.push('C21 archive-security report identity is not independently bound.')
  }
  validateRuntime(report.runtime, binding.runtime, failures)
  validateFixture(report.fixture, failures)
  validateCorpus(report.corpus, binding, failures)
  validateSecretScan(report.secretCanaryScan, failures)
  validateCases(report, binding, failures)
}

/** Compare the producer runtime identity with controller-owned values. */
function validateRuntime(runtime, expected, failures) {
  if (!hasExactKeys(runtime, RUNTIME_KEYS)) {
    failures.push('C21 report runtime identity has missing or unsupported fields.')
    return
  }
  for (const field of RUNTIME_KEYS) {
    if (runtime[field] !== expected[field]) failures.push(`C21 runtime ${field} differs from expected binding.`)
  }
  validateExpectedRuntime(runtime, expected.tier, failures)
}

/** Validate the fixture digest/count facts used by every mutation case. */
function validateFixture(fixture, failures) {
  if (!hasExactKeys(fixture, FIXTURE_KEYS)) {
    failures.push('C21 fixture identity has missing or unsupported fields.')
    return
  }
  for (const field of ['archiveSha256', 'headerSha256', 'plaintextSha256']) {
    if (!SHA256.test(fixture[field])) failures.push(`C21 fixture ${field} is invalid.`)
  }
  for (const field of ['sizeBytes', 'frameCount', 'entryCount', 'plaintextBytes']) {
    if (!Number.isSafeInteger(fixture[field]) || fixture[field] < 1) failures.push(`C21 fixture ${field} is invalid.`)
  }
  if (!Array.isArray(fixture.entryNames) || fixture.entryNames.length !== fixture.entryCount
      || fixture.entryNames.some((name) => typeof name !== 'string' || name.length < 1)
      || new Set(fixture.entryNames).size !== fixture.entryNames.length
      || fixture.entryNames[0] !== 'manifest.json') {
    failures.push('C21 fixture entry inventory is invalid.')
  }
}

/** Validate the exact required corpus and preserve declared key/custody gaps. */
function validateCorpus(corpus, binding, failures) {
  if (!hasExactKeys(corpus, CORPUS_KEYS)) {
    failures.push('C21 corpus has missing or unsupported fields.')
    return
  }
  if (corpus.id !== binding.corpusId || !sameArray(corpus.caseIds, CASE_IDS)
      || !sameArray(corpus.requiredCaseIds, CASE_IDS) || !sameArray(corpus.coveredCaseIds, CASE_IDS)
      || !sameArray(corpus.coveredKeySlotCases, KEY_SLOT_CASE_IDS)
      || !sameArray(corpus.coveredCustodyCases, CUSTODY_CASE_IDS)) {
    failures.push('C21 corpus does not contain the exact required mutation identities.')
  }
  for (const [field, label] of [
    ['missingKeySlotCases', 'key-slot'],
    ['missingCustodyCases', 'custody'],
    ['missingStructuralCases', 'structural'],
  ]) {
    if (!Array.isArray(corpus[field])
        || corpus[field].some((entry) => typeof entry !== 'string' || entry.length < 1)
        || new Set(corpus[field]).size !== corpus[field].length) {
      failures.push(`C21 ${label} coverage gap must remain explicit.`)
    }
  }
}

/** Reject secret-canary claims and require both scans to remain false. */
function validateSecretScan(scan, failures) {
  if (!hasExactKeys(scan, ['passphrase', 'recoveryCode'])
      || scan.passphrase !== false || scan.recoveryCode !== false) {
    failures.push('C21 secret-canary scan detected a secret or has an invalid shape.')
  }
}

/** Validate every corpus case independently, including raw error and digest facts. */
function validateCases(report, binding, failures) {
  if (!Array.isArray(report.cases) || report.cases.length !== CASE_IDS.length) {
    failures.push('C21 report does not contain exactly one result for every required case.')
    return
  }
  const ids = report.cases.map((entry) => entry?.id)
  if (!sameArray(ids, CASE_IDS) || new Set(ids).size !== ids.length) {
    failures.push('C21 case ordering or identity is missing, duplicated, or unexpected.')
  }
  const fixture = report.fixture
  for (const entry of report.cases) validateCase(entry, fixture, binding, failures)
}

/** Validate one mutation boundary, rejection code, digest, and cleanup observation. */
function validateCase(entry, fixture, binding, failures) {
  if (!hasExactKeys(entry, CASE_KEYS)) {
    failures.push('C21 case has missing or unsupported fields.')
    return
  }
  if (!CASE_IDS.includes(entry.id) || entry.mutation !== entry.id) failures.push(`C21 case ${String(entry.id)} identity is invalid.`)
  const expectedKind = entry.id === 'valid-roundtrip' ? 'roundtrip'
    : entry.id === 'wrong-key' || entry.id === 'recovery-roundtrip' || entry.id === 'machine-slot-unlock' ? 'key'
      : KEY_SLOT_CASE_IDS.includes(entry.id) ? 'key-slot'
        : entry.id.startsWith('legacy-v1-') ? 'legacy'
          : CUSTODY_CASE_IDS.includes(entry.id) ? 'custody' : 'mutation'
  if (entry.kind !== expectedKind) failures.push(`C21 case ${String(entry.id)} kind is invalid.`)
  validateBoundary(entry.boundary, failures)
  validateInput(entry.input, failures)
  validateResult(entry.result, entry.id, failures)
  validatePlaintext(entry.plaintext, fixture, entry.id, failures)
  validateCustody(entry.custody, fixture, entry.id, failures)
  validateOriginal(entry.original, fixture, failures)
  if (!['valid-roundtrip', 'recovery-roundtrip', 'machine-slot-unlock', 'wrong-key', ...CUSTODY_CASE_IDS, 'legacy-v1-roundtrip'].includes(entry.id)
      && entry.input.sha256 === fixture.archiveSha256) {
    failures.push(`C21 mutation ${entry.id} did not change ciphertext identity.`)
  }
  if (entry.id === 'valid-roundtrip' || entry.id === 'recovery-roundtrip' || entry.id === 'machine-slot-unlock') {
    if (entry.result.accepted !== true || entry.result.code !== 'PASS') failures.push('C21 valid roundtrip was not accepted.')
    if (entry.plaintext.observedBytes !== fixture.plaintextBytes
        || entry.plaintext.observedSha256 !== fixture.plaintextSha256
        || JSON.stringify(entry.plaintext.entryNames) !== JSON.stringify(fixture.entryNames)) {
      failures.push('C21 valid roundtrip plaintext facts do not match the fixture.')
    }
  } else if (entry.id === 'legacy-v1-roundtrip') {
    if (entry.result.accepted !== true || entry.result.code !== 'PASS'
        || entry.plaintext.observedBytes < 1 || entry.plaintext.entryNames.length !== 3) {
      failures.push('C21 legacy-v1 roundtrip did not restore the production legacy payload.')
    }
  } else {
    if (!['unavailable-key-slot', 'legacy-v1-mutant'].includes(entry.id)
      && (entry.result.accepted !== false || entry.result.code === 'PASS'
        || (!entry.result.code.startsWith('ARCHIVE_') && !entry.result.code.startsWith('SARARCH2_')))) {
      failures.push(`C21 mutation ${entry.id} did not retain an independent parser rejection code.`)
    }
  }
  if (entry.id === 'wrong-key' && entry.result.code !== 'ARCHIVE_WRONG_KEY') {
    failures.push('C21 wrong-key case did not retain ARCHIVE_WRONG_KEY.')
  }
  if (entry.id === 'unavailable-key-slot'
      && (entry.result.accepted !== false || entry.result.code !== null
        || entry.result.classification !== 'key-slot-unavailable'
        || entry.result.name !== 'TypeError'
        || !/archive key slot must be an object/iu.test(entry.result.message ?? ''))) {
    failures.push('C21 unavailable-key-slot did not retain the production unwrap boundary error.')
  }
  if (entry.id === 'legacy-v1-mutant'
      && (entry.result.accepted !== false || entry.result.code === null
        || !entry.result.code.startsWith('LEGACY_ARCHIVE_'))) {
    failures.push('C21 legacy-v1 mutation did not retain the production legacy rejection code.')
  }
  if (KEY_SLOT_CASE_IDS.includes(entry.id) && !['recovery-roundtrip', 'machine-slot-unlock', 'unavailable-key-slot'].includes(entry.id)
      && (entry.result.accepted !== false || !entry.result.code.startsWith('SARARCH2_') && !entry.result.code.startsWith('ARCHIVE_'))) {
    failures.push(`C21 key-slot case ${entry.id} did not retain an independent rejection code.`)
  }
  const expectedCustodyCode = entry.id === 'registry-ciphertext-swap'
    || entry.id === 'cross-process-custody-reconciliation'
    ? 'ARCHIVE_CUSTODY_REGISTRY_MISMATCH' : 'ARCHIVE_CUSTODY_IDENTITY_CHANGED'
  if (CUSTODY_CASE_IDS.includes(entry.id)
      && (entry.result.accepted !== false || entry.result.code !== expectedCustodyCode)) {
    failures.push(`C21 custody case ${entry.id} did not retain identity-change rejection.`)
  }
  if (binding.proofMode === 'packaged-module' && entry.result.message?.includes('source-calibration')) {
    failures.push('C21 package evidence contains an unbound source-calibration substitution.')
  }
}

/** Validate raw custody hashes and the independent identity-change observation. */
function validateCustody(custody, fixture, caseId, failures) {
  if (!hasExactKeys(custody, CUSTODY_KEYS) || typeof custody.inspected !== 'boolean'
      || typeof custody.callbackRan !== 'boolean' || typeof custody.identityChanged !== 'boolean'
      || (custody.initialSha256 !== null && !SHA256.test(custody.initialSha256))
      || (custody.replacementSha256 !== null && !SHA256.test(custody.replacementSha256))
      || (custody.reconciliationExpectedSha256 !== null && !SHA256.test(custody.reconciliationExpectedSha256))
      || (custody.reconciliationObservedSha256 !== null && !SHA256.test(custody.reconciliationObservedSha256))
      || (custody.initialSizeBytes !== null && (!Number.isSafeInteger(custody.initialSizeBytes) || custody.initialSizeBytes < 1))
      || (custody.replacementSizeBytes !== null && (!Number.isSafeInteger(custody.replacementSizeBytes) || custody.replacementSizeBytes < 1))
      || (custody.reconciliationExpectedSizeBytes !== null && (!Number.isSafeInteger(custody.reconciliationExpectedSizeBytes) || custody.reconciliationExpectedSizeBytes < 1))
      || (custody.reconciliationObservedSizeBytes !== null && (!Number.isSafeInteger(custody.reconciliationObservedSizeBytes) || custody.reconciliationObservedSizeBytes < 1))
      || (custody.reconciliationOutcome !== null && typeof custody.reconciliationOutcome !== 'string')
      || typeof custody.reconciliationWorkerExited !== 'boolean'
      || (custody.reconciliationFileIdentity !== null && !isCustodyIdentity(custody.reconciliationFileIdentity))) {
    failures.push(`C21 case ${caseId} custody observation is invalid.`)
    return
  }
  if (!CUSTODY_CASE_IDS.includes(caseId)) {
    if (custody.inspected || custody.callbackRan || custody.identityChanged
        || custody.initialSha256 !== null || custody.replacementSha256 !== null
        || custody.initialSizeBytes !== null || custody.replacementSizeBytes !== null
        || custody.reconciliationExpectedSha256 !== null || custody.reconciliationObservedSha256 !== null
        || custody.reconciliationExpectedSizeBytes !== null || custody.reconciliationObservedSizeBytes !== null
        || custody.reconciliationOutcome !== null || custody.reconciliationWorkerExited
        || custody.reconciliationFileIdentity !== null) {
      failures.push(`C21 non-custody case ${caseId} contains an unbound custody observation.`)
    }
    return
  }
  if (caseId === 'registry-ciphertext-swap') {
    if (!custody.inspected || custody.callbackRan || custody.identityChanged
        || custody.initialSha256 !== fixture.archiveSha256 || custody.initialSizeBytes !== fixture.sizeBytes
        || !SHA256.test(custody.replacementSha256) || custody.replacementSha256 === fixture.archiveSha256
        || custody.replacementSizeBytes !== fixture.sizeBytes
        || custody.reconciliationOutcome !== 'available'
        || custody.reconciliationExpectedSha256 !== fixture.archiveSha256
        || custody.reconciliationObservedSha256 !== custody.replacementSha256
        || custody.reconciliationExpectedSizeBytes !== fixture.sizeBytes
        || custody.reconciliationObservedSizeBytes !== fixture.sizeBytes
        || custody.reconciliationWorkerExited !== false || custody.reconciliationFileIdentity === null) {
      failures.push('C21 registry swap did not retain the exact worker identity mismatch facts.')
    }
    return
  }
  if (caseId === 'cross-process-custody-reconciliation') {
    if (!custody.inspected || custody.callbackRan || custody.identityChanged
        || !SHA256.test(custody.initialSha256) || !SHA256.test(custody.replacementSha256)
        || custody.initialSha256 === custody.replacementSha256
        || custody.initialSizeBytes !== custody.replacementSizeBytes
        || custody.reconciliationOutcome !== 'available'
        || custody.reconciliationExpectedSha256 !== custody.initialSha256
        || custody.reconciliationObservedSha256 !== custody.replacementSha256
        || custody.reconciliationExpectedSizeBytes !== custody.initialSizeBytes
        || custody.reconciliationObservedSizeBytes !== custody.replacementSizeBytes
        || custody.reconciliationWorkerExited !== true || custody.reconciliationFileIdentity === null) {
      failures.push('C21 cross-process custody reconciliation did not retain the worker change facts.')
    }
    return
  }
  if (!custody.inspected || custody.callbackRan || !custody.identityChanged
      || custody.initialSha256 !== fixture.archiveSha256 || custody.initialSizeBytes !== fixture.sizeBytes
      || !SHA256.test(custody.replacementSha256) || custody.replacementSizeBytes !== fixture.sizeBytes
      || custody.reconciliationExpectedSha256 !== null || custody.reconciliationObservedSha256 !== null
      || custody.reconciliationExpectedSizeBytes !== null || custody.reconciliationObservedSizeBytes !== null
      || custody.reconciliationOutcome !== null || custody.reconciliationWorkerExited !== false
      || custody.reconciliationFileIdentity !== null) {
    failures.push(`C21 custody case ${caseId} did not retain the exact original/replacement identity facts.`)
  }
}

/** Validate the closed filesystem identity returned by the reconciliation worker. */
function isCustodyIdentity(value) {
  return hasExactKeys(value, [
    'changedTimeNanoseconds', 'device', 'inode', 'linkCount',
    'modifiedTimeNanoseconds', 'sizeBytes',
  ]) && ['changedTimeNanoseconds', 'device', 'inode', 'modifiedTimeNanoseconds']
    .every((key) => typeof value[key] === 'string' && /^\d+$/u.test(value[key]))
    && value.linkCount === 1 && Number.isSafeInteger(value.sizeBytes) && value.sizeBytes > 0
}

/** Validate the exact mutation boundary record without accepting a free-form claim. */
function validateBoundary(boundary, failures) {
  if (!hasExactKeys(boundary, BOUNDARY_KEYS)
      || typeof boundary.operation !== 'string' || boundary.operation.length < 1
      || (boundary.frameIndex !== null && (!Number.isSafeInteger(boundary.frameIndex) || boundary.frameIndex < 0))
      || (boundary.byteOffset !== null && (!Number.isSafeInteger(boundary.byteOffset) || boundary.byteOffset < 0))) {
    failures.push('C21 mutation boundary is invalid.')
  }
}

/** Validate one candidate ciphertext digest and exact positive byte count. */
function validateInput(input, failures) {
  if (!hasExactKeys(input, INPUT_KEYS) || !SHA256.test(input.sha256)
      || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) failures.push('C21 candidate input identity is invalid.')
}

/** Validate one parser outcome and retain its raw safe name/message fields. */
function validateResult(result, caseId, failures) {
  if (!hasExactKeys(result, RESULT_KEYS) || typeof result.accepted !== 'boolean'
      || (result.code !== null && (typeof result.code !== 'string' || result.code.length < 1))
      || (result.classification !== null && (typeof result.classification !== 'string' || result.classification.length < 1))
      || (result.name !== null && typeof result.name !== 'string')
      || (result.message !== null && typeof result.message !== 'string')) {
    failures.push(`C21 case ${caseId} parser result is invalid.`)
    return
  }
  if (result.accepted === false && (typeof result.name !== 'string' || typeof result.message !== 'string'
      || result.name.length < 1 || result.message.length < 1)) {
    failures.push(`C21 case ${caseId} rejection did not retain its safe error facts.`)
  }
  if (result.accepted === false && result.code === null && result.classification === null) {
    failures.push(`C21 case ${caseId} has neither a production error code nor an explicit controller classification.`)
  }
  if (result.accepted === true && (result.code !== 'PASS' || result.name !== null || result.message !== null)) {
    failures.push(`C21 case ${caseId} accepted with an inconsistent result record.`)
  }
  if (result.accepted === true && result.classification !== null) {
    failures.push(`C21 case ${caseId} accepted with an unexpected controller classification.`)
  }
}

/** Validate plaintext observation, immediate scrubbing, and residue sweep facts. */
function validatePlaintext(plaintext, fixture, caseId, failures) {
  if (!hasExactKeys(plaintext, PLAINTEXT_KEYS)
      || !Array.isArray(plaintext.entryNames)
      || plaintext.entryNames.some((name) => typeof name !== 'string')
      || !Number.isSafeInteger(plaintext.observedBytes) || plaintext.observedBytes < 0
      || !SHA256.test(plaintext.observedSha256)
      || !Number.isSafeInteger(plaintext.retainedBytes) || plaintext.retainedBytes < 0
      || plaintext.residueDetected !== false
      || !Array.isArray(plaintext.residuePaths) || plaintext.residuePaths.length !== 0) {
    failures.push(`C21 case ${caseId} plaintext observation is invalid.`)
    return
  }
  if (plaintext.observedBytes > fixture.plaintextBytes || plaintext.retainedBytes !== 0) {
    failures.push(`C21 case ${caseId} retained or observed plaintext exceeds the bounded fixture.`)
  }
  if (plaintext.observedBytes === 0 && plaintext.observedSha256 !== emptySha256()) {
    failures.push(`C21 case ${caseId} empty plaintext digest is invalid.`)
  }
}

/** Require every case to preserve the original encrypted source identity. */
function validateOriginal(original, fixture, failures) {
  if (!hasExactKeys(original, ORIGINAL_KEYS)
      || original.sha256 !== fixture.archiveSha256 || original.sizeBytes !== fixture.sizeBytes
      || original.unchanged !== true) failures.push('C21 original encrypted source was changed or unbound.')
}

/** Return the explicit key-slot/custody gaps without hiding them behind a pass flag. */
function extractCoverageGaps(report) {
  const corpus = report?.corpus
  if (!isRecord(corpus)) return []
  return [
    ...(Array.isArray(corpus.missingKeySlotCases) ? corpus.missingKeySlotCases.map((entry) => `key-slot: ${entry}`) : []),
    ...(Array.isArray(corpus.missingCustodyCases) ? corpus.missingCustodyCases.map((entry) => `custody: ${entry}`) : []),
    ...(Array.isArray(corpus.missingStructuralCases) ? corpus.missingStructuralCases.map((entry) => `structural: ${entry}`) : []),
  ]
}

/** Build an immutable bounded result and prevent partial C21 evidence from looking complete. */
function makeResult(binding, failures, report, coverageGaps = []) {
  const uniqueFailures = [...new Set(failures)]
  const passed = uniqueFailures.length === 0
  return Object.freeze({
    contractId: 'C21',
    proofMode: binding?.proofMode ?? null,
    sourceSha: binding?.sourceSha ?? null,
    corpusId: binding?.corpusId ?? null,
    status: passed ? 'PASS_WITH_GAPS' : 'INVALID_EVIDENCE',
    valid: passed,
    passed,
    complete: false,
    releaseEligible: false,
    caseIds: Object.freeze(Array.isArray(report?.cases) ? report.cases.map((entry) => entry?.id) : []),
    cases: Object.freeze(Array.isArray(report?.cases) ? report.cases.map(freezeCase) : []),
    secretCanaryScan: isRecord(report?.secretCanaryScan)
      ? Object.freeze({ ...report.secretCanaryScan })
      : null,
    coverageGaps: Object.freeze([...new Set(coverageGaps)]),
    failureReasons: Object.freeze(uniqueFailures),
  })
}

/** Clone and freeze one case so callers cannot mutate the retained receipt. */
function freezeCase(entry) {
  if (!isRecord(entry)) return Object.freeze({ id: null })
  const clone = JSON.parse(JSON.stringify(entry))
  for (const field of ['boundary', 'input', 'result', 'plaintext', 'original']) {
    if (isRecord(clone[field])) Object.freeze(clone[field])
  }
  return Object.freeze(clone)
}

/** Validate one canonical absolute filesystem path. */
function validatePath(value, label, failures) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) failures.push(`${label} is invalid.`)
}

/** Return whether a value is a non-array record. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Return whether a record has exactly the requested own keys. */
function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}

/** Compare ordered string arrays without coercion or duplicate removal. */
function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index])
}

/** Return the SHA-256 of an empty plaintext stream. */
function emptySha256() {
  return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
}
