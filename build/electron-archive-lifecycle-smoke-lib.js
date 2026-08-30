/**
 * Pure CLI, CI, privacy, and evidence gates for the packaged Electron archive
 * lifecycle smoke. Runtime control remains in the adjacent scripts.
 */

import path from 'node:path'

const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const RECOVERY_CODE = /^(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/u
const SENSITIVE_ARGUMENT = /passphrase|recovery|secret|credential/iu
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u
const REQUIRED_CREATE_PHASES = Object.freeze([
  'snapshot',
  'encrypt',
  'publish',
  'seal',
  'staged',
])
const REQUIRED_VERIFY_PHASES = Object.freeze([
  'decrypt',
  'inventory',
  'replay',
  'plaintext_cleanup',
  'verified',
])
const REVIEW_KEYS = Object.freeze([
  'archiveIdMatched',
  'breadcrumbCount',
  'closed',
  'contentSha256',
  'denialAudited',
  'immutable',
  'mutationAttempt',
  'mutationBoundary',
  'mutationDenied',
  'openDirectoriesOwnerOnly',
  'openFilesOwnerOnly',
  'openPrivacyCanaryDetected',
  'openResidualFileCount',
  'opened',
  'plaintextResidual',
  'readMissionIdMatched',
  'residualEntriesAfterClose',
  'verified',
])

/** Requires the public addPositionsBulk result to contain every requested row. */
export function archiveLifecycleSmokeBatchInsertedEveryRow(result, expectedCount) {
  return Array.isArray(result)
    && Number.isSafeInteger(expectedCount)
    && expectedCount > 0
    && result.length === expectedCount
}

/** Matches one exact rendered 40-hex build head while tolerating CSS letter casing. */
export function renderedVersionContainsExactHead(renderedText, expectedHead) {
  if (typeof renderedText !== 'string' || typeof expectedHead !== 'string'
    || !SHA1.test(expectedHead)) {
    return false
  }
  const renderedHeads = renderedText.matchAll(
    /(?:^|[^0-9a-f])([0-9a-f]{40})(?![0-9a-f])/giu,
  )
  for (const match of renderedHeads) {
    if (match[1]?.toLowerCase() === expectedHead) return true
  }
  return false
}

/** Parses the fail-closed packaged archive-lifecycle runner command line. */
export function parseArchiveLifecycleSmokeArgs(argv) {
  const parsed = { extraArgs: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    /** Returns the next non-option value and advances the parser. */
    const nextValue = () => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${token} requires a value.`)
      }
      index += 1
      return value
    }
    switch (token) {
      case '--app':
        parsed.appPath = nextValue()
        break
      case '--evidence':
        parsed.evidenceDir = nextValue()
        break
      case '--expected-head':
        parsed.expectedHead = nextValue()
        break
      case '--seed-position-rows':
        parsed.seedPositionRows = Number(nextValue())
        break
      case '--timeout-ms':
        parsed.timeoutMs = Number(nextValue())
        break
      case '--':
        parsed.extraArgs.push(...argv.slice(index + 1))
        index = argv.length
        break
      default:
        throw new Error(`Unknown archive-lifecycle smoke argument: ${String(token)}`)
    }
  }

  requireAbsolutePath(parsed.appPath, '--app')
  requireAbsolutePath(parsed.evidenceDir, '--evidence')
  if (typeof parsed.expectedHead !== 'string' || !SHA1.test(parsed.expectedHead)) {
    throw new Error('--expected-head must be one exact lowercase 40-character repository head.')
  }
  const seedPositionRows = boundedInteger(
    parsed.seedPositionRows,
    4_096,
    1_024,
    10_000,
    '--seed-position-rows',
  )
  const timeoutMs = boundedInteger(
    parsed.timeoutMs,
    180_000,
    30_000,
    15 * 60_000,
    '--timeout-ms',
  )
  for (const argument of parsed.extraArgs) {
    if (typeof argument !== 'string' || !argument.startsWith('--')
      || argument.length > 200 || CONTROL_CHARACTER.test(argument)
      || SENSITIVE_ARGUMENT.test(argument)) {
      throw new Error('Archive-lifecycle smoke launch arguments cannot contain custody secrets or invalid flags.')
    }
  }
  return Object.freeze({
    appPath: parsed.appPath,
    evidenceDir: parsed.evidenceDir,
    expectedHead: parsed.expectedHead,
    seedPositionRows,
    timeoutMs,
    extraArgs: Object.freeze([...parsed.extraArgs]),
  })
}

/** Builds the deterministic exact-head packaged smoke invocation for CI. */
export function buildArchiveLifecycleSmokeCiRunnerArgs(input) {
  if (typeof input?.projectRoot !== 'string' || !path.isAbsolute(input.projectRoot)
    || typeof input?.appPath !== 'string' || !path.isAbsolute(input.appPath)
    || typeof input?.expectedHead !== 'string' || !SHA1.test(input.expectedHead)
    || !['darwin', 'linux'].includes(input.platform)) {
    throw new Error('Archive-lifecycle smoke CI inputs are invalid.')
  }
  const args = [
    path.join(input.projectRoot, 'scripts', 'electron-archive-lifecycle-smoke.mjs'),
    '--app',
    input.appPath,
    '--evidence',
    path.join(input.projectRoot, 'tmp', 'breadcrumb-pr6-packaged-archive-smoke'),
    '--expected-head',
    input.expectedHead,
  ]
  if (input.platform === 'linux') {
    args.push(
      '--',
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=gl',
      '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    )
  }
  return Object.freeze(args)
}

/** Scopes Mesa software rendering to the Linux packaged-smoke process tree. */
export function buildArchiveLifecycleSmokeCiEnvironment(input) {
  if (input?.environment === null || typeof input?.environment !== 'object') {
    throw new Error('Archive-lifecycle smoke CI environment is invalid.')
  }
  if (input.platform !== 'linux') return { ...input.environment }
  return {
    ...input.environment,
    LIBGL_ALWAYS_SOFTWARE: '1',
    GALLIUM_DRIVER: 'llvmpipe',
  }
}

/** Resolves the packaged app.asar independently from its platform wrapper executable. */
export function resolvePackagedApplicationArchivePath(appPath, platform) {
  requireAbsolutePath(appPath, 'Packaged executable')
  if (platform === 'linux') {
    return path.join(path.dirname(appPath), 'resources', 'app.asar')
  }
  if (platform === 'darwin') {
    return path.join(path.dirname(path.dirname(appPath)), 'Resources', 'app.asar')
  }
  throw new Error('Packaged application archive platform is unsupported.')
}

/** Rejects evidence serialization that contains either exact in-memory custody value. */
export function assertArchiveLifecycleSmokeEvidenceOmitsSecrets(evidence, secrets) {
  let serialized
  try {
    serialized = JSON.stringify(evidence)
  } catch {
    throw new Error('Archive-lifecycle evidence is not serializable.')
  }
  if (!Array.isArray(secrets) || secrets.length < 1
    || secrets.some((secret) => typeof secret !== 'string' || secret.length < 1)) {
    throw new Error('Archive-lifecycle custody secret set is invalid.')
  }
  if (secrets.some((secret) => serialized.includes(secret))) {
    throw new Error('Archive-lifecycle evidence contained custody secret material.')
  }
  return true
}

/** Validates one closed, machine-readable packaged archive-lifecycle proof. */
export function validateArchiveLifecycleSmokeEvidence(evidence) {
  const failures = []
  const root = exactRecord(evidence, [
    'archive',
    'cleanup',
    'interruptedRestore',
    'mission',
    'privacy',
    'proofKind',
    'reviewAfterCleanup',
    'reviewBeforeCleanup',
    'run',
    'schemaVersion',
    'source',
    'verdict',
  ], 'archive-lifecycle evidence', failures)
  if (root === null) return verdict(failures)
  requireExact(failures, root.schemaVersion, 1, 'Evidence schema version')
  requireExact(
    failures,
    root.proofKind,
    'packaged-electron-archive-lifecycle-v1',
    'Evidence proof kind',
  )

  validateSource(root.source, failures)
  validateRun(root.run, failures)
  const mission = validateMission(root.mission, failures)
  validateArchive(root.archive, failures)
  validateReview(
    root.reviewBeforeCleanup,
    'Pre-cleanup archive review',
    mission?.seededPositionRows,
    failures,
  )
  validateInterruptedRestore(root.interruptedRestore, failures)
  validateCleanup(root.cleanup, mission?.seededPositionRows, failures)
  validateReview(
    root.reviewAfterCleanup,
    'Post-cleanup archive review',
    mission?.seededPositionRows,
    failures,
  )
  if (typeof root.reviewBeforeCleanup?.contentSha256 === 'string'
    && typeof root.reviewAfterCleanup?.contentSha256 === 'string'
    && root.reviewBeforeCleanup.contentSha256 !== root.reviewAfterCleanup.contentSha256) {
    failures.push('Archive Review content changed after cleanup.')
  }
  validatePrivacy(root.privacy, failures)
  validateEmbeddedVerdict(root.verdict, failures)
  scanEvidencePrivacy(root, failures)
  return verdict(failures)
}

/** Validates exact repository and packaged-binary identity. */
function validateSource(value, failures) {
  const source = exactRecord(value, [
    'expectedHead',
    'headAfter',
    'headBefore',
    'packagedApplicationArchiveSha256',
    'packagedBuildHeadMatched',
    'packagedExecutableSha256',
    'treeAfter',
    'treeBefore',
    'worktreeCleanAfter',
    'worktreeCleanBefore',
  ], 'source evidence', failures)
  if (source === null) return
  for (const key of ['expectedHead', 'headBefore', 'headAfter', 'treeBefore', 'treeAfter']) {
    if (typeof source[key] !== 'string' || !SHA1.test(source[key])) {
      failures.push(`Source ${key} is not a lowercase repository digest.`)
    }
  }
  if (source.expectedHead !== source.headBefore || source.expectedHead !== source.headAfter) {
    failures.push('Source head before and after must equal the expected exact head.')
  }
  if (source.treeBefore !== source.treeAfter) {
    failures.push('Source tree changed during the packaged smoke.')
  }
  if (source.worktreeCleanBefore !== true || source.worktreeCleanAfter !== true) {
    failures.push('Source worktree must be clean before and after the packaged smoke.')
  }
  if (typeof source.packagedExecutableSha256 !== 'string'
    || !SHA256.test(source.packagedExecutableSha256)) {
    failures.push('Packaged executable SHA-256 is invalid.')
  }
  if (typeof source.packagedApplicationArchiveSha256 !== 'string'
    || !SHA256.test(source.packagedApplicationArchiveSha256)) {
    failures.push('Packaged application archive SHA-256 is invalid.')
  }
  if (source.packagedBuildHeadMatched !== true) {
    failures.push('Packaged visible build head did not match the expected exact head.')
  }
}

/** Validates bounded host/run identity without retaining local paths. */
function validateRun(value, failures) {
  const run = exactRecord(value, [
    'architecture',
    'durationMs',
    'finishedAt',
    'launchCount',
    'nodeVersion',
    'observedLaunchExitCount',
    'platform',
    'startedAt',
  ], 'run evidence', failures)
  if (run === null) return
  const started = canonicalTimestamp(run.startedAt)
  const finished = canonicalTimestamp(run.finishedAt)
  if (started === null || finished === null || finished < started) {
    failures.push('Run timestamps are invalid or reversed.')
  }
  if (!Number.isSafeInteger(run.durationMs) || run.durationMs < 1
    || (started !== null && finished !== null && run.durationMs !== finished - started)) {
    failures.push('Run duration must exactly bind its timestamps.')
  }
  if (!['darwin', 'linux'].includes(run.platform)) failures.push('Run platform is unsupported.')
  if (!['arm64', 'x64'].includes(run.architecture)) failures.push('Run architecture is unsupported.')
  if (typeof run.nodeVersion !== 'string' || !/^v\d+\.\d+\.\d+$/u.test(run.nodeVersion)) {
    failures.push('Run Node.js version is invalid.')
  }
  requireExact(failures, run.launchCount, 2, 'Packaged Electron launch count')
  if (run.observedLaunchExitCount !== run.launchCount) {
    failures.push('Packaged Electron launch exit count was not fully observed.')
  }
}

/** Validates the bounded mission lifecycle seeded only through the preload bridge. */
function validateMission(value, failures) {
  const mission = exactRecord(value, [
    'createdStatus',
    'finalizedStatus',
    'finishedStatus',
    'missionId',
    'missionNameSha256',
    'seededPositionRows',
  ], 'mission evidence', failures)
  if (mission === null) return null
  boundedText(mission.missionId, 1, 200, 'Mission identity', failures)
  if (typeof mission.missionNameSha256 !== 'string' || !SHA256.test(mission.missionNameSha256)) {
    failures.push('Mission-name SHA-256 is invalid.')
  }
  requireExact(failures, mission.createdStatus, 'active', 'Created mission status')
  requireExact(failures, mission.finishedStatus, 'finished', 'Finished mission status')
  requireExact(failures, mission.finalizedStatus, 'finalized', 'Finalized mission status')
  if (!Number.isSafeInteger(mission.seededPositionRows)
    || mission.seededPositionRows < 1_024 || mission.seededPositionRows > 10_000) {
    failures.push('Seeded position-row count is outside the bounded smoke profile.')
  }
  return mission
}

/** Validates independent verification and retained encrypted archive identity. */
function validateArchive(value, failures) {
  const archive = exactRecord(value, [
    'archiveId',
    'availability',
    'ciphertextSha256',
    'containerVersion',
    'createProgressPhases',
    'sizeBytes',
    'statusAfterFinalize',
    'statusAfterIndependentVerify',
    'verifyProgressPhases',
  ], 'archive evidence', failures)
  if (archive === null) return
  boundedText(archive.archiveId, 1, 200, 'Archive identity', failures)
  requireExact(failures, archive.containerVersion, 2, 'Archive container version')
  requireExact(failures, archive.statusAfterFinalize, 'verified', 'Finalization archive status')
  if (archive.statusAfterIndependentVerify !== 'verified') {
    failures.push('Independent archive verification did not finish verified.')
  }
  requireExact(failures, archive.availability, 'present', 'Archive availability')
  if (typeof archive.ciphertextSha256 !== 'string' || !SHA256.test(archive.ciphertextSha256)) {
    failures.push('Archive ciphertext SHA-256 is invalid.')
  }
  if (!Number.isSafeInteger(archive.sizeBytes) || archive.sizeBytes < 1) {
    failures.push('Archive ciphertext byte size is invalid.')
  }
  validateProgressPhases(
    archive.createProgressPhases,
    REQUIRED_CREATE_PHASES,
    'Create',
    failures,
  )
  validateProgressPhases(
    archive.verifyProgressPhases,
    REQUIRED_VERIFY_PHASES,
    'Independent verify',
    failures,
  )
}

/** Validates one open-read-deny-close read-only archive review. */
function validateReview(value, label, expectedBreadcrumbCount, failures) {
  const review = exactRecord(value, REVIEW_KEYS, `${label} evidence`, failures)
  if (review === null) return
  for (const key of [
    'opened',
    'immutable',
    'verified',
    'archiveIdMatched',
    'readMissionIdMatched',
    'mutationDenied',
    'denialAudited',
    'closed',
  ]) {
    if (review[key] !== true) failures.push(`${label} ${key} proof is missing.`)
  }
  if (typeof review.contentSha256 !== 'string' || !SHA256.test(review.contentSha256)) {
    failures.push(`${label} content SHA-256 is invalid.`)
  }
  requireExact(
    failures,
    review.plaintextResidual,
    'permission_restricted_session_open',
    `${label} plaintext residual disclosure`,
  )
  requireExact(failures, review.mutationAttempt, 'upsertMarker', `${label} mutation attack`)
  requireExact(
    failures,
    review.mutationBoundary,
    'preload_read_only',
    `${label} mutation boundary`,
  )
  if (!Number.isSafeInteger(review.openResidualFileCount)
    || review.openResidualFileCount < 1) {
    failures.push(`${label} did not observe a plaintext Review file while open.`)
  }
  if (review.openDirectoriesOwnerOnly !== true || review.openFilesOwnerOnly !== true) {
    failures.push(`${label} Review residual permissions were not owner-only.`)
  }
  if (review.openPrivacyCanaryDetected !== true) {
    failures.push(`${label} did not observe the mission privacy canary while open.`)
  }
  if (!Number.isSafeInteger(review.breadcrumbCount) || review.breadcrumbCount < 0) {
    failures.push(`${label} breadcrumb count is invalid.`)
  } else if (Number.isSafeInteger(expectedBreadcrumbCount)
    && review.breadcrumbCount !== expectedBreadcrumbCount) {
    failures.push(`${label} breadcrumb count did not match the seeded archive evidence.`)
  }
  requireExact(failures, review.residualEntriesAfterClose, 0, `${label} residual entries after close`)
}

/** Validates a decrypt-progress-triggered SIGKILL and startup plaintext sweep. */
function validateInterruptedRestore(value, failures) {
  const interruption = exactRecord(value, [
    'exitSignal',
    'killSignalRequested',
    'plaintextFileObservedBeforeRestart',
    'privacyCanaryDetectedBeforeRestart',
    'progressTriggered',
    'residualEntriesAfterRestart',
    'residualEntriesBeforeRestart',
    'restartSweepCompleted',
    'supported',
    'triggerPhase',
  ], 'interrupted restore evidence', failures)
  if (interruption === null) return
  if (interruption.supported !== true) failures.push('Interrupted restore proof must be supported.')
  if (interruption.progressTriggered !== true || interruption.triggerPhase !== 'decrypt') {
    failures.push('Interrupted restore must be triggered by decrypt progress.')
  }
  if (interruption.killSignalRequested !== 'SIGKILL' || interruption.exitSignal !== 'SIGKILL') {
    failures.push('Interrupted restore must request and observe exact SIGKILL.')
  }
  if (!Number.isSafeInteger(interruption.residualEntriesBeforeRestart)
    || interruption.residualEntriesBeforeRestart < 1) {
    failures.push('Interrupted restore must observe an app-addressable residual before restart.')
  }
  if (interruption.plaintextFileObservedBeforeRestart !== true) {
    failures.push('Interrupted restore did not observe a plaintext file before restart.')
  }
  if (interruption.privacyCanaryDetectedBeforeRestart !== true) {
    failures.push('Interrupted restore did not observe the privacy canary before restart.')
  }
  if (interruption.restartSweepCompleted !== true
    || interruption.residualEntriesAfterRestart !== 0) {
    failures.push('Restart sweep must remove every interrupted restore residual.')
  }
}

/** Validates credential-gated live-row cleanup without weakening the archive. */
function validateCleanup(value, seededPositionRows, failures) {
  const cleanup = exactRecord(value, [
    'completed',
    'eligibilityChecked',
    'eligibleBeforeCredential',
    'freshCredentialOnlyBlocker',
    'movedRows',
    'remainingBreadcrumbRows',
    'storageState',
  ], 'cleanup evidence', failures)
  if (cleanup === null) return
  if (cleanup.eligibilityChecked !== true
    || cleanup.eligibleBeforeCredential !== false
    || cleanup.freshCredentialOnlyBlocker !== true) {
    failures.push('Cleanup eligibility did not fail closed on the fresh credential gate.')
  }
  if (cleanup.completed !== true || cleanup.storageState !== 'archived') {
    failures.push('Cleanup did not complete in archived storage state.')
  }
  if (!Number.isSafeInteger(cleanup.movedRows) || cleanup.movedRows < 0
    || (Number.isSafeInteger(seededPositionRows) && cleanup.movedRows < seededPositionRows)) {
    failures.push('Cleanup moved-row count did not cover the seeded mission evidence.')
  }
  if (cleanup.remainingBreadcrumbRows !== 0) {
    failures.push('Breadcrumb rows remain in the live store after cleanup.')
  }
}

/** Validates exact-secret scans and the truthful app-addressable-residue boundary. */
function validatePrivacy(value, failures) {
  const privacy = exactRecord(value, [
    'exactSecretMatches',
    'exactSecretScanFiles',
    'plaintextResidueEntriesAtEnd',
    'secretsAbsentFromEvidence',
    'secretsAbsentFromProcessArguments',
    'secretsProvidedOnlyViaPreload',
  ], 'privacy evidence', failures)
  if (privacy === null) return
  for (const key of [
    'secretsProvidedOnlyViaPreload',
    'secretsAbsentFromProcessArguments',
    'secretsAbsentFromEvidence',
  ]) {
    if (privacy[key] !== true) failures.push(`Privacy proof ${key} is missing.`)
  }
  if (!Number.isSafeInteger(privacy.exactSecretScanFiles) || privacy.exactSecretScanFiles < 1) {
    failures.push('Exact secret scan did not inspect any profile files.')
  }
  requireExact(failures, privacy.exactSecretMatches, 0, 'Exact secret scan matches')
  if (privacy.plaintextResidueEntriesAtEnd !== 0) {
    failures.push('Final app-addressable plaintext residue count is not zero.')
  }
}

/** Requires the embedded producer verdict to be a closed successful claim. */
function validateEmbeddedVerdict(value, failures) {
  const embedded = exactRecord(value, ['failureReasons', 'passed'], 'embedded verdict', failures)
  if (embedded === null) return
  if (embedded.passed !== true || !Array.isArray(embedded.failureReasons)
    || embedded.failureReasons.length !== 0) {
    failures.push('Embedded packaged-smoke verdict is not a clean pass.')
  }
}

/** Rejects local paths and recovery-code material anywhere in evidence. */
function scanEvidencePrivacy(value, failures, seen = new Set()) {
  if (typeof value === 'string') {
    if (RECOVERY_CODE.test(value)) failures.push('Evidence contains recovery-code material.')
    if (/^(?:\/|[A-Za-z]:[\\/])/u.test(value)) failures.push('Evidence contains an absolute local path.')
    return
  }
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) {
    failures.push('Evidence contains a cyclic value.')
    return
  }
  seen.add(value)
  for (const child of Object.values(value)) scanEvidencePrivacy(child, failures, seen)
  seen.delete(value)
}

/** Requires a unique, closed phase set containing each required phase. */
function validateProgressPhases(value, required, label, failures) {
  if (!Array.isArray(value) || value.length < 1
    || value.some((phase) => typeof phase !== 'string' || phase.length > 40)
    || new Set(value).size !== value.length
    || [...value].sort().some((phase, index) => phase !== value[index])) {
    failures.push(`${label} progress phases are not one sorted closed set.`)
    return
  }
  for (const phase of required) {
    if (!value.includes(phase)) failures.push(`${label} progress did not prove ${phase}.`)
  }
}

/** Returns a plain object only when its key set exactly matches the contract. */
function exactRecord(value, expectedKeys, label, failures) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    failures.push(`${label} is not an object.`)
    return null
  }
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    failures.push(`${label} contains missing or unknown fields.`)
    return null
  }
  return value
}

/** Requires one exact primitive value. */
function requireExact(failures, actual, expected, label) {
  if (actual !== expected) failures.push(`${label} must equal ${String(expected)}.`)
}

/** Validates one bounded operator-safe identifier. */
function boundedText(value, minimum, maximum, label, failures) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum
    || CONTROL_CHARACTER.test(value)) {
    failures.push(`${label} is invalid.`)
  }
}

/** Parses one canonical millisecond UTC timestamp. */
function canonicalTimestamp(value) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null
}

/** Returns the public validation result without leaking evidence values. */
function verdict(failures) {
  const unique = [...new Set(failures)]
  return Object.freeze({
    valid: unique.length === 0,
    passed: unique.length === 0,
    failureReasons: Object.freeze(unique),
  })
}

/** Requires one absolute CLI path without normalizing attacker-controlled text. */
function requireAbsolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || CONTROL_CHARACTER.test(value)) {
    throw new Error(`${label} must be an absolute path.`)
  }
}

/** Applies one inclusive integer bound with a default. */
function boundedInteger(value, fallback, minimum, maximum, label) {
  const candidate = value === undefined ? fallback : value
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`)
  }
  return candidate
}
