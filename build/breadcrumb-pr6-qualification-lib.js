'use strict'

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { canonicalJson } = require('../electron/archive-container.cjs')
const { normalizeArchiveVerificationProofForIdentity } = require(
  '../electron/archive-envelope.cjs',
)

export const MAX_MAIN_CADENCE_MS = 200
export const MAX_DURABLE_SETTLE_MS = 120_000
export const MIN_ARCHIVE_CIPHERTEXT_BYTES = 2 * 1024 * 1024 * 1024
export const MIN_FIELD_FIXTURE_BYTES = 2 * 1024 * 1024 * 1024
export const MAX_ARCHIVE_PROCESS_RSS_BYTES = 512 * 1024 * 1024
export const REQUIRED_SCRYPT_MAXMEM_BYTES = 268_435_456
export const REQUIRED_SCRYPT_PROFILE = Object.freeze({
  version: 1,
  N: 131_072,
  r: 8,
  p: 1,
  keyLength: 32,
  saltBytes: 32,
  maxmem: REQUIRED_SCRYPT_MAXMEM_BYTES,
})

const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u
const REQUIRED_ARCHIVE_TABLE_COUNT = 49
const REQUIRED_LIVE_PHASES = Object.freeze(['create', 'verify', 'restore', 'cleanup'])
const REQUIRED_RUN_PHASES = Object.freeze(['migration', ...REQUIRED_LIVE_PHASES])
const REQUIRED_RESIDUE_ROOTS = Object.freeze([
  'archive-staging',
  'verification-scratch',
  'archive-review-sessions',
])

/** Stable failure for incomplete or overstated PR6 qualification evidence. */
export class BreadcrumbPr6QualificationError extends Error {
  /** Creates one closed machine-readable qualification failure. */
  constructor(code, message) {
    super(message)
    this.name = 'BreadcrumbPr6QualificationError'
    this.code = code
  }
}

/** Parses the closed, non-secret command line accepted by the PR6 qualifier. */
export function parseBreadcrumbPr6QualificationArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 8 || argv.some((value) =>
    typeof value !== 'string')) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_ARGUMENT_INVALID',
      'PR6 qualification requires one fixture, evidence path, mission, and expected head.',
    )
  }
  const allowed = ['--fixture', '--evidence', '--mission-id', '--expected-head']
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!allowed.includes(flag) || values.has(flag) || value.length < 1
      || CONTROL_CHARACTERS.test(value)) {
      throw qualificationFailure(
        'PR6_QUALIFICATION_ARGUMENT_INVALID',
        'PR6 qualification arguments are missing, repeated, or unsupported.',
      )
    }
    values.set(flag, value)
  }
  const fixturePath = values.get('--fixture')
  const evidencePath = values.get('--evidence')
  const missionId = values.get('--mission-id')
  const expectedRepositoryHead = values.get('--expected-head')
  if (!path.isAbsolute(fixturePath) || path.resolve(fixturePath) !== fixturePath
    || !path.isAbsolute(evidencePath) || path.resolve(evidencePath) !== evidencePath
    || !isBoundedText(missionId, 200) || !SHA1.test(expectedRepositoryHead)) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_ARGUMENT_INVALID',
      'PR6 qualification paths, mission identity, or expected head are invalid.',
    )
  }
  return Object.freeze({ fixturePath, evidencePath, missionId, expectedRepositoryHead })
}

/** Creates one terse qualification error without reflecting supplied evidence. */
function qualificationFailure(code, message) {
  return new BreadcrumbPr6QualificationError(code, message)
}

/** Returns whether one string is non-control UTF-8 text within a byte bound. */
function isBoundedText(value, maxBytes) {
  return typeof value === 'string' && value.length > 0
    && Buffer.byteLength(value, 'utf8') <= maxBytes && !CONTROL_CHARACTERS.test(value)
}

/** Requires one plain record with exactly the declared fields. */
function requireRecord(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw qualificationFailure('PR6_QUALIFICATION_INVALID', `${label} is invalid.`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_INVALID',
      `${label} has missing or unsupported fields.`,
    )
  }
  return value
}

/** Requires one finite non-negative measurement. */
function requireMeasurement(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw qualificationFailure('PR6_QUALIFICATION_INVALID', `${label} is invalid.`)
  }
  return Number(value)
}

/** Requires one non-negative safe integer. */
function requireNonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw qualificationFailure('PR6_QUALIFICATION_INVALID', `${label} is invalid.`)
  }
  return Number(value)
}

/** Requires one positive safe integer. */
function requirePositiveInteger(value, label) {
  const normalized = requireNonnegativeInteger(value, label)
  if (normalized < 1) {
    throw qualificationFailure('PR6_QUALIFICATION_INVALID', `${label} is invalid.`)
  }
  return normalized
}

/** Requires a true proof flag; false and missing evidence both fail closed. */
function requireProven(value, label) {
  if (value !== true) {
    throw qualificationFailure('PR6_QUALIFICATION_GATE_FAILED', `${label} was not proven.`)
  }
}

/** Requires one exact lowercase digest without reflecting supplied content. */
function requireDigest(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw qualificationFailure('PR6_QUALIFICATION_INVALID', `${label} is invalid.`)
  }
  return value
}

/** Requires one canonical ISO-8601 timestamp. */
function requireTimestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw qualificationFailure('PR6_QUALIFICATION_INVALID', `${label} is invalid.`)
  }
  return value
}

/** Rejects evidence lists that are absent, malformed, or non-empty. */
function requireEmptyEvidenceList(value, label) {
  if (!Array.isArray(value) || value.length !== 0) {
    throw qualificationFailure('PR6_QUALIFICATION_GATE_FAILED', `${label} is not empty.`)
  }
}

/** Validates immutable run, source, host, and flag identity. */
function validateRunIdentity(evidence, expectedHead) {
  const run = requireRecord(evidence.run, [
    'runId', 'startedAt', 'completedAt', 'durationMs', 'phaseDurationsMs',
  ], 'PR6 qualification run')
  if (typeof run.runId !== 'string' || !UUID_V4.test(run.runId)) {
    throw qualificationFailure('PR6_QUALIFICATION_INVALID', 'PR6 qualification run ID is invalid.')
  }
  const startedAt = requireTimestamp(run.startedAt, 'Qualification start time')
  const completedAt = requireTimestamp(run.completedAt, 'Qualification completion time')
  const durationMs = requireMeasurement(run.durationMs, 'Qualification duration')
  if (Date.parse(completedAt) < Date.parse(startedAt)
    || Math.abs((Date.parse(completedAt) - Date.parse(startedAt)) - durationMs) > 1_000) {
    throw qualificationFailure('PR6_QUALIFICATION_INVALID', 'Qualification run timing is inconsistent.')
  }
  const phaseDurations = requireRecord(
    run.phaseDurationsMs,
    REQUIRED_RUN_PHASES,
    'Qualification phase durations',
  )
  const phaseDurationSum = Object.entries(phaseDurations).reduce((sum, [phase, value]) =>
    sum + requireMeasurement(value, `Qualification ${phase} duration`), 0)
  if (phaseDurationSum > durationMs) {
    throw qualificationFailure('PR6_QUALIFICATION_INVALID', 'Qualification phase durations exceed the run.')
  }

  const source = requireRecord(evidence.source, [
    'repositoryHead', 'repositoryHeadAfterRun', 'repositoryTree',
    'repositoryTreeAfterRun', 'repositoryDirtyBefore', 'repositoryDirtyAfter',
  ], 'PR6 qualification source')
  const repositoryHead = requireDigest(source.repositoryHead, SHA1, 'Repository head')
  const repositoryTree = requireDigest(source.repositoryTree, SHA1, 'Repository tree')
  if (repositoryHead !== expectedHead
    || requireDigest(source.repositoryHeadAfterRun, SHA1, 'Repository head after run')
      !== repositoryHead
    || requireDigest(source.repositoryTreeAfterRun, SHA1, 'Repository tree after run')
      !== repositoryTree
    || source.repositoryDirtyBefore !== false || source.repositoryDirtyAfter !== false) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_HEAD_MISMATCH',
      'PR6 qualification did not remain on the clean expected repository head and tree.',
    )
  }

  const machine = requireRecord(evidence.machine, [
    'hostname', 'platform', 'release', 'architecture', 'cpuCount',
    'totalMemoryBytes', 'nodeVersion',
  ], 'PR6 qualification machine')
  if (!isBoundedText(machine.hostname, 255) || machine.platform !== 'linux'
    || !isBoundedText(machine.release, 255) || !isBoundedText(machine.architecture, 64)
    || !isBoundedText(machine.nodeVersion, 64)
    || requirePositiveInteger(machine.cpuCount, 'Machine CPU count') > 4_096
    || requirePositiveInteger(machine.totalMemoryBytes, 'Machine memory') < 1024 * 1024 * 1024) {
    throw qualificationFailure('PR6_QUALIFICATION_INVALID', 'Reference-host identity is invalid.')
  }

  const flags = requireRecord(evidence.flags, [
    'fixtureBasename', 'missionId', 'timezone', 'heartbeatHardGateMs',
    'currentCadenceHardGateMs', 'rssLimitBytes',
  ], 'PR6 qualification flags')
  if (!isBoundedText(flags.fixtureBasename, 255)
    || path.basename(flags.fixtureBasename) !== flags.fixtureBasename
    || !isBoundedText(flags.missionId, 200) || !isBoundedText(flags.timezone, 128)
    || flags.heartbeatHardGateMs !== MAX_MAIN_CADENCE_MS
    || flags.currentCadenceHardGateMs !== MAX_MAIN_CADENCE_MS
    || flags.rssLimitBytes !== MAX_ARCHIVE_PROCESS_RSS_BYTES) {
    throw qualificationFailure('PR6_QUALIFICATION_INVALID', 'Qualification flags are invalid or weakened.')
  }
  return { repositoryHead, repositoryTree, flags }
}

/** Validates that the source fixture was never opened or changed in place. */
function validateFixtureAndMigration(evidence) {
  const fixture = requireRecord(evidence.fixture, [
    'copiedBeforeOpen', 'sourceWasRegularFile', 'sourceWasSymlink',
    'sourceWalBytes', 'sourceShmBytes', 'sourceSha256Before',
    'sourceSha256After', 'copiedSha256', 'sourceBytes', 'copiedBytes',
  ], 'PR6 qualification fixture')
  requireProven(fixture.copiedBeforeOpen, 'Source fixture copy-before-open')
  if (fixture.sourceWasRegularFile !== true || fixture.sourceWasSymlink !== false
    || requireNonnegativeInteger(fixture.sourceWalBytes, 'Source WAL bytes') !== 0
    || requireNonnegativeInteger(fixture.sourceShmBytes, 'Source SHM bytes') !== 0) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_FIXTURE_MISMATCH',
      'Source fixture is unsafe or has uncheckpointed sidecars.',
    )
  }
  const sourceDigest = requireDigest(
    fixture.sourceSha256Before,
    SHA256,
    'Source fixture digest before run',
  )
  const sourceBytes = requirePositiveInteger(fixture.sourceBytes, 'Source fixture bytes')
  const copiedBytes = requirePositiveInteger(fixture.copiedBytes, 'Copied fixture bytes')
  if (requireDigest(fixture.sourceSha256After, SHA256, 'Source fixture digest after run')
      !== sourceDigest
    || requireDigest(fixture.copiedSha256, SHA256, 'Copied fixture digest') !== sourceDigest
    || sourceBytes !== copiedBytes
    || sourceBytes <= MIN_FIELD_FIXTURE_BYTES) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_FIXTURE_MISMATCH',
      'Copied qualification fixture or source immutability proof differs.',
    )
  }

  const migration = requireRecord(evidence.migration, [
    'schemaVersion', 'durationMs', 'heartbeatMaxGapMs', 'backfillsSettled',
    'failureMarkers',
  ], 'PR6 migration proof')
  const migrationHeartbeatMaxGapMs = requireMeasurement(
    migration.heartbeatMaxGapMs,
    'Migration heartbeat maximum gap',
  )
  if (migration.schemaVersion !== 13
    || requireMeasurement(migration.durationMs, 'Migration duration') <= 0
    || migrationHeartbeatMaxGapMs >= MAX_MAIN_CADENCE_MS
    || migration.backfillsSettled !== true) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_SCHEMA_MISMATCH',
      'PR6 qualification did not settle schema v13 migration.',
    )
  }
  requireEmptyEvidenceList(migration.failureMarkers, 'Migration failure markers')
}

/** Projects the exact non-secret identity understood by the production proof envelope. */
function projectArchiveIdentity(archive) {
  return {
    archiveId: archive.archiveId,
    archiveKind: archive.archiveKind,
    archiveRelativePath: archive.archiveRelativePath,
    missionId: archive.missionId,
    requestEventRowid: archive.requestEventRowid,
    requestEventId: archive.requestEventId,
    creationOperationId: archive.creationOperationId,
    protectedFinalizationEpoch: archive.protectedFinalizationEpoch,
    createdAt: archive.createdAt,
    previousArchiveSha256: archive.previousArchiveSha256,
    containerVersion: archive.containerVersion,
    schemaVersion: archive.schemaVersion,
    inventoryVersion: archive.inventoryVersion,
    ciphertextSha256: archive.ciphertextSha256,
    sizeBytes: archive.sizeBytes,
    frameCount: archive.frameCount,
    headerSha256: archive.headerSha256,
    manifestSha256: archive.manifestSha256,
    entryCount: archive.entryCount,
    tableCount: archive.tableCount,
  }
}

/** Validates the registry-bound archive and its complete durable verifier proof. */
function validateArchiveAndCompleteness(evidence, flags) {
  const archive = requireRecord(evidence.archive, [
    'archiveId', 'archiveKind', 'archiveRelativePath', 'missionId',
    'requestEventRowid', 'requestEventId', 'creationOperationId',
    'protectedFinalizationEpoch', 'createdAt', 'previousArchiveSha256',
    'containerVersion', 'schemaVersion', 'inventoryVersion', 'ciphertextSha256',
    'sizeBytes', 'frameCount', 'headerSha256', 'manifestSha256', 'inventorySha256',
    'entryCount', 'tableCount', 'status', 'availability',
  ], 'PR6 archive proof')
  if (archive.status !== 'verified' || archive.availability !== 'present'
    || archive.containerVersion !== 2 || archive.schemaVersion !== 13
    || archive.inventoryVersion !== 1 || archive.missionId !== flags.missionId) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_ARCHIVE_INVALID',
      'PR6 qualification archive identity or verified availability is invalid.',
    )
  }
  const ciphertextBytes = requirePositiveInteger(archive.sizeBytes, 'Archive ciphertext bytes')
  if (ciphertextBytes <= MIN_ARCHIVE_CIPHERTEXT_BYTES) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_SCALE_GATE_FAILED',
      'PR6 qualification ciphertext must be greater than 2 GiB.',
    )
  }
  requireDigest(archive.ciphertextSha256, SHA256, 'Archive ciphertext digest')
  requireDigest(archive.headerSha256, SHA256, 'Archive header digest')
  requireDigest(archive.manifestSha256, SHA256, 'Archive manifest digest')
  requireDigest(archive.inventorySha256, SHA256, 'Archive inventory digest')
  requirePositiveInteger(archive.frameCount, 'Archive frame count')
  requirePositiveInteger(archive.entryCount, 'Archive entry count')
  if (archive.tableCount !== REQUIRED_ARCHIVE_TABLE_COUNT) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_COMPLETENESS_FAILED',
      'PR6 qualification archive table count is incomplete.',
    )
  }

  const completeness = requireRecord(evidence.completeness, [
    'verificationProofSha256', 'verificationProof',
  ], 'PR6 completeness proof')
  const proofSha256 = createHash('sha256')
    .update(canonicalJson(completeness.verificationProof), 'utf8').digest('hex')
  if (requireDigest(
    completeness.verificationProofSha256,
    SHA256,
    'Verification proof digest',
  ) !== proofSha256) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_COMPLETENESS_FAILED',
      'Stored verification proof digest differs from its evidence.',
    )
  }
  let normalizedProof
  try {
    normalizedProof = normalizeArchiveVerificationProofForIdentity(
      completeness.verificationProof,
      projectArchiveIdentity(archive),
    )
  } catch {
    throw qualificationFailure(
      'PR6_QUALIFICATION_COMPLETENESS_FAILED',
      'Stored verification proof is incomplete or not bound to the archive identity.',
    )
  }
  return { archive, ciphertextBytes, normalizedProof }
}

/** Validates one complete permission-restricted archive-review session proof. */
function validateReviewProof(value, label) {
  const review = requireRecord(value, [
    'opened', 'readOnly', 'mutationDenied', 'replayPageCount', 'replayDigest',
    'openResidualFileCount', 'openPrivacyCanaryDetected', 'closed',
    'plaintextSweptAfterClose',
  ], label)
  for (const field of [
    'opened', 'readOnly', 'mutationDenied', 'openPrivacyCanaryDetected',
    'closed', 'plaintextSweptAfterClose',
  ]) requireProven(review[field], `${label} ${field}`)
  requirePositiveInteger(review.replayPageCount, `${label} Replay page count`)
  requireDigest(review.replayDigest, SHA256, `${label} Replay digest`)
  requirePositiveInteger(review.openResidualFileCount, `${label} open temporary residual count`)
  return review
}

/** Validates cleanup retention and archive-backed Review before and after deletion. */
function validateCleanupAndReview(evidence, archive) {
  const cleanup = requireRecord(evidence.cleanup, [
    'state', 'storageState', 'preCredentialBlockers', 'reviewLeaseHeld',
    'deletedTableRowsRemain', 'retainedMissionStub', 'retainedArchiveRegistry',
    'archiveSha256After',
  ], 'PR6 cleanup proof')
  if (cleanup.state !== 'completed' || cleanup.storageState !== 'archived'
    || requireNonnegativeInteger(
      cleanup.deletedTableRowsRemain,
      'Deleted table rows remaining',
    ) !== 0) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_CLEANUP_FAILED',
      'PR6 qualification cleanup did not complete to the archived state.',
    )
  }
  requireProven(cleanup.retainedMissionStub, 'Retained mission stub')
  requireProven(cleanup.retainedArchiveRegistry, 'Retained archive registry')
  requireProven(cleanup.reviewLeaseHeld, 'Archive Review cleanup lease')
  if (!Array.isArray(cleanup.preCredentialBlockers)
    || canonicalJson(cleanup.preCredentialBlockers)
      !== canonicalJson(['fresh_non_machine_unlock_required'])) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_CLEANUP_FAILED',
      'Cleanup did not prove the fresh non-machine credential gate before deletion.',
    )
  }
  if (requireDigest(cleanup.archiveSha256After, SHA256, 'Post-cleanup archive digest')
      !== archive.ciphertextSha256) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_CLEANUP_FAILED',
      'Immutable archive bytes changed during live-store cleanup.',
    )
  }

  const before = validateReviewProof(
    evidence.reviewBeforeCleanup,
    'Archive Review before cleanup',
  )
  const after = validateReviewProof(
    evidence.reviewAfterCleanup,
    'Archive Review after cleanup',
  )
  if (before.replayPageCount !== after.replayPageCount
    || before.replayDigest !== after.replayDigest) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_REVIEW_FAILED',
      'Archive-backed Review changed after live-store cleanup.',
    )
  }
}

/** Validates uninterrupted live current-position and heartbeat proof by phase. */
function validateLiveness(evidence) {
  const liveness = requireRecord(evidence.liveness, [
    'heartbeatMaxGapMs', 'currentPositionMaxCadenceMs',
    'currentPositionsIndependent', 'durableMaxLatencyMs', 'durableWriteCount',
    'durableVisibleWrites', 'durableBusyRetries', 'durableSettlementMs', 'byPhase',
  ], 'PR6 liveness proof')
  const heartbeatMaxGapMs = requireMeasurement(
    liveness.heartbeatMaxGapMs,
    'Main heartbeat maximum gap',
  )
  const currentPositionMaxCadenceMs = requireMeasurement(
    liveness.currentPositionMaxCadenceMs,
    'Current-position maximum cadence',
  )
  const durableMaxLatencyMs = requireMeasurement(
    liveness.durableMaxLatencyMs,
    'Durable current-position maximum latency',
  )
  const durableWriteCount = requirePositiveInteger(
    liveness.durableWriteCount,
    'Durable current-position writes',
  )
  const durableVisibleWrites = requirePositiveInteger(
    liveness.durableVisibleWrites,
    'Durable current-position visible writes',
  )
  const durableBusyRetries = requireNonnegativeInteger(
    liveness.durableBusyRetries,
    'Durable current-position contention retries',
  )
  const durableSettlementMs = requireMeasurement(
    liveness.durableSettlementMs,
    'Durable current-position settlement',
  )
  if (durableMaxLatencyMs > MAX_DURABLE_SETTLE_MS
    || durableSettlementMs > MAX_DURABLE_SETTLE_MS
    || durableVisibleWrites !== durableWriteCount) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_LIVENESS_FAILED',
      'PR6 durable current-position settlement was incomplete or exceeded its deadline.',
    )
  }
  requireProven(liveness.currentPositionsIndependent, 'Current-position independence')
  const byPhase = requireRecord(liveness.byPhase, REQUIRED_LIVE_PHASES, 'Phase liveness')
  let observedHeartbeatMax = 0
  let observedCadenceMax = 0
  for (const phase of REQUIRED_LIVE_PHASES) {
    const phaseEvidence = requireRecord(byPhase[phase], [
      'heartbeatMaxGapMs', 'currentPositionMaxCadenceMs', 'durableMaxLatencyMs',
      'durableWriteCount', 'durableVisibleWrites', 'durableBusyRetries',
      'currentWrites', 'visibleWrites',
    ], `Liveness during ${phase}`)
    const phaseHeartbeat = requireMeasurement(
      phaseEvidence.heartbeatMaxGapMs,
      `Heartbeat gap during ${phase}`,
    )
    const phaseCadence = requireMeasurement(
      phaseEvidence.currentPositionMaxCadenceMs,
      `Current-position cadence during ${phase}`,
    )
    const phaseDurableMax = requireMeasurement(
      phaseEvidence.durableMaxLatencyMs,
      `Durable current-position latency during ${phase}`,
    )
    const writes = requirePositiveInteger(
      phaseEvidence.currentWrites,
      `Current-position writes during ${phase}`,
    )
    const phaseDurableWrites = requirePositiveInteger(
      phaseEvidence.durableWriteCount,
      `Durable current-position writes during ${phase}`,
    )
    const phaseDurableVisibleWrites = requirePositiveInteger(
      phaseEvidence.durableVisibleWrites,
      `Durable current-position visible writes during ${phase}`,
    )
    requireNonnegativeInteger(
      phaseEvidence.durableBusyRetries,
      `Durable current-position contention retries during ${phase}`,
    )
    if (phaseHeartbeat >= MAX_MAIN_CADENCE_MS || phaseCadence >= MAX_MAIN_CADENCE_MS
      || phaseEvidence.visibleWrites !== writes
      || phaseDurableMax > MAX_DURABLE_SETTLE_MS
      || phaseDurableWrites !== writes
      || phaseDurableVisibleWrites !== phaseDurableWrites) {
      throw qualificationFailure(
        'PR6_QUALIFICATION_LIVENESS_FAILED',
        `PR6 qualification liveness failed during ${phase}.`,
      )
    }
    observedHeartbeatMax = Math.max(observedHeartbeatMax, phaseHeartbeat)
    observedCadenceMax = Math.max(observedCadenceMax, phaseCadence)
  }
  const observedDurableMax = Object.values(byPhase).reduce(
    (maximum, phase) => Math.max(maximum, phase.durableMaxLatencyMs), 0,
  )
  const observedDurableWrites = Object.values(byPhase).reduce(
    (total, phase) => total + phase.durableWriteCount, 0,
  )
  const observedDurableVisibleWrites = Object.values(byPhase).reduce(
    (total, phase) => total + phase.durableVisibleWrites, 0,
  )
  const observedDurableBusyRetries = Object.values(byPhase).reduce(
    (total, phase) => total + phase.durableBusyRetries, 0,
  )
  if (heartbeatMaxGapMs !== observedHeartbeatMax
    || currentPositionMaxCadenceMs !== observedCadenceMax
    || durableMaxLatencyMs !== observedDurableMax
    || durableWriteCount !== observedDurableWrites
    || durableVisibleWrites !== observedDurableVisibleWrites
    || durableBusyRetries !== observedDurableBusyRetries
    || heartbeatMaxGapMs >= MAX_MAIN_CADENCE_MS
    || currentPositionMaxCadenceMs >= MAX_MAIN_CADENCE_MS) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_LIVENESS_FAILED',
      'PR6 qualification liveness summary is inconsistent or exceeds 200 ms.',
    )
  }
  return { heartbeatMaxGapMs, currentPositionMaxCadenceMs }
}

/** Validates conservative whole-process memory measurements for worker-thread architecture. */
function validateResources(evidence) {
  const resources = requireRecord(evidence.resources, [
    'measurement', 'baselineProcessRssBytes', 'peakProcessRssBytes',
    'peakDeltaBytes', 'linuxVmHwmBytes', 'sampleCount',
  ], 'PR6 resource proof')
  const baseline = requirePositiveInteger(resources.baselineProcessRssBytes, 'Baseline process RSS')
  const peak = requirePositiveInteger(resources.peakProcessRssBytes, 'Peak process RSS')
  const delta = requireNonnegativeInteger(resources.peakDeltaBytes, 'Peak process RSS delta')
  const vmHwm = requirePositiveInteger(resources.linuxVmHwmBytes, 'Linux VmHWM')
  requirePositiveInteger(resources.sampleCount, 'RSS sample count')
  if (resources.measurement !== 'whole_process_rss_conservative_worker_upper_bound'
    || peak < baseline || peak - baseline !== delta || peak < vmHwm
    || peak > MAX_ARCHIVE_PROCESS_RSS_BYTES) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_MEMORY_FAILED',
      'PR6 qualification exceeded or misstated the 512 MiB whole-process RSS gate.',
    )
  }
  return peak
}

/** Validates truthful app-addressable residue and secret/privacy scans. */
function validateResidue(evidence) {
  const residue = requireRecord(evidence.residue, [
    'rootsChecked', 'filesScanned', 'bytesScanned', 'unreadableFiles',
    'appAddressablePlaintextFiles', 'secretMatches', 'privacyMatches',
    'claimsForensicSecureErasure',
  ], 'PR6 residue proof')
  if (!Array.isArray(residue.rootsChecked)
    || canonicalJson(residue.rootsChecked) !== canonicalJson(REQUIRED_RESIDUE_ROOTS)) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_RESIDUE_FAILED',
      'PR6 qualification did not scan every app-addressable plaintext root.',
    )
  }
  requireNonnegativeInteger(residue.filesScanned, 'Residue files scanned')
  requireNonnegativeInteger(residue.bytesScanned, 'Residue bytes scanned')
  requireEmptyEvidenceList(residue.unreadableFiles, 'Unreadable residue files')
  requireEmptyEvidenceList(
    residue.appAddressablePlaintextFiles,
    'App-addressable plaintext residue',
  )
  requireEmptyEvidenceList(residue.secretMatches, 'Secret residue')
  requireEmptyEvidenceList(residue.privacyMatches, 'Privacy-canary residue')
  if (residue.claimsForensicSecureErasure !== false) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_CLAIM_INVALID',
      'PR6 qualification must not claim forensic secure erasure.',
    )
  }
}

/** Validates the complete production KDF profile and supported-host measurement. */
function validateKdf(evidence) {
  const kdf = requireRecord(
    evidence.kdf,
    ['measuredOnHost', 'profile', 'durationMs'],
    'PR6 KDF proof',
  )
  requireProven(kdf.measuredOnHost, 'Supported-host KDF measurement')
  const profile = requireRecord(kdf.profile, Object.keys(REQUIRED_SCRYPT_PROFILE), 'PR6 KDF profile')
  if (Object.entries(REQUIRED_SCRYPT_PROFILE)
    .some(([key, expected]) => profile[key] !== expected)
    || requireMeasurement(kdf.durationMs, 'KDF duration') <= 0) {
    throw qualificationFailure(
      'PR6_QUALIFICATION_KDF_FAILED',
      'PR6 qualification KDF evidence is missing or weakened.',
    )
  }
}

/**
 * Validates one complete PR6 reference-host evidence record.
 *
 * Process RSS is deliberately a conservative whole-process upper bound: Node
 * archive workers are threads in the same process, so worker-only RSS would be
 * an unsupported and misleading claim.
 */
export function validateBreadcrumbPr6QualificationEvidence(input, expectedRepositoryHead) {
  const evidence = requireRecord(input, [
    'schema', 'run', 'source', 'machine', 'flags', 'fixture', 'migration',
    'archive', 'completeness', 'cleanup', 'reviewBeforeCleanup',
    'reviewAfterCleanup', 'liveness', 'resources', 'residue', 'kdf',
  ], 'PR6 qualification evidence')
  if (evidence.schema !== 'sartracker-breadcrumb-pr6-qualification-v1') {
    throw qualificationFailure('PR6_QUALIFICATION_INVALID', 'PR6 qualification schema is unsupported.')
  }
  const expectedHead = requireDigest(expectedRepositoryHead, SHA1, 'Expected repository head')
  const { repositoryHead, repositoryTree, flags } = validateRunIdentity(evidence, expectedHead)
  validateFixtureAndMigration(evidence)
  const { archive, ciphertextBytes, normalizedProof } = validateArchiveAndCompleteness(
    evidence,
    flags,
  )
  validateCleanupAndReview(evidence, archive)
  const { heartbeatMaxGapMs, currentPositionMaxCadenceMs } = validateLiveness(evidence)
  const peakArchiveProcessRssBytes = validateResources(evidence)
  validateResidue(evidence)
  validateKdf(evidence)

  return Object.freeze({
    passed: true,
    repositoryHead,
    repositoryTree,
    ciphertextBytes,
    tableCount: normalizedProof.tables.length,
    replaySampleCount: normalizedProof.replaySemantic.samples.length,
    peakArchiveProcessRssBytes,
    heartbeatMaxGapMs,
    currentPositionMaxCadenceMs,
  })
}
