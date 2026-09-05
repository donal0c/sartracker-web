'use strict'

const path = require('node:path')

const { normalizeCustodyFileIdentity } = require('./archive-custody-file.cjs')

const PROTOCOL_VERSION = 1
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u
const ACTIONS = new Set(['publish', 'quarantine', 'staging_cleanup'])
const PROGRESS_PHASE_ORDER = Object.freeze([
  'preflight',
  'inspect',
  'hash',
  'transfer',
  'cleanup',
  'sync',
])
const PROGRESS_UNITS = new Set(['phases', 'files', 'bytes', 'directories'])
const TICKET_KEYS = Object.freeze([
  'action',
  'archiveDirectory',
  'creationOperationId',
  'expectedCiphertextSha256',
  'expectedFileIdentity',
  'expectedSizeBytes',
  'finalRelativePath',
  'journalRevision',
  'maintenanceOperationId',
  'protocolVersion',
  'sourceRelativePath',
  'stagingRelativePath',
  'targetRelativePath',
])
const RESULT_KEYS = Object.freeze([
  'action',
  'creationOperationId',
  'directoriesSynced',
  'journalRevision',
  'maintenanceOperationId',
  'outcome',
  'protocolVersion',
  'sourceIdentity',
  'sourceRelativePath',
  'targetIdentity',
  'targetRelativePath',
  'type',
])
const PROGRESS_KEYS = Object.freeze([
  'completed',
  'maintenanceOperationId',
  'phase',
  'sequence',
  'total',
  'type',
  'unit',
])
const OUTCOMES = Object.freeze({
  publish: new Set([
    'moved', 'target_only', 'both_present', 'neither_present', 'not_regular', 'changed',
  ]),
  quarantine: new Set([
    'moved', 'target_only', 'both_present', 'neither_present', 'not_regular', 'changed',
    'staging_only',
  ]),
  staging_cleanup: new Set([
    'removed', 'source_absent', 'unexpected_final', 'not_regular',
  ]),
})

/** Signals one malformed or substituted custody-operation message. */
class ArchiveCustodyOperationEnvelopeError extends Error {
  /** Creates a stable closed boundary error. */
  constructor(message) {
    super(message)
    this.name = 'ArchiveCustodyOperationEnvelopeError'
    this.code = 'ARCHIVE_CUSTODY_OPERATION_ENVELOPE_INVALID'
  }
}

/** Requires a plain object containing exactly the declared fields. */
function requireExactRecord(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArchiveCustodyOperationEnvelopeError(`${label} must be an object.`)
  }
  const actual = Object.keys(value).sort()
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new ArchiveCustodyOperationEnvelopeError(
      `${label} has missing or unsupported fields.`,
    )
  }
}

/** Requires one canonical lowercase RFC-4122 version-four identity. */
function normalizeUuid(value, label) {
  if (typeof value !== 'string' || !UUID_V4.test(value)) {
    throw new ArchiveCustodyOperationEnvelopeError(`${label} is invalid.`)
  }
  return value
}

/** Requires one bounded canonical path below the custody root. */
function normalizeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 4_096 || CONTROL_CHARACTERS.test(value)
    || path.isAbsolute(value) || value.includes('\\')
    || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ArchiveCustodyOperationEnvelopeError(`${label} is invalid.`)
  }
  return value
}

/** Requires one bounded canonical absolute custody directory. */
function normalizeArchiveDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value
    || Buffer.byteLength(value, 'utf8') > 8_192 || CONTROL_CHARACTERS.test(value)) {
    throw new ArchiveCustodyOperationEnvelopeError(
      'Archive custody directory must be one canonical absolute path.',
    )
  }
  return value
}

/** Validates the exact journal-issued custody operation ticket. */
function normalizeArchiveCustodyOperationTicket(input) {
  requireExactRecord(input, TICKET_KEYS, 'Archive custody operation ticket')
  if (input.protocolVersion !== PROTOCOL_VERSION
    || !Number.isSafeInteger(input.journalRevision) || input.journalRevision < 1
    || !ACTIONS.has(input.action)) {
    throw new ArchiveCustodyOperationEnvelopeError(
      'Archive custody operation protocol, revision, or action is invalid.',
    )
  }
  const maintenanceOperationId = normalizeUuid(
    input.maintenanceOperationId,
    'Archive maintenance operation identity',
  )
  const creationOperationId = normalizeUuid(
    input.creationOperationId,
    'Archive creation operation identity',
  )
  const archiveDirectory = normalizeArchiveDirectory(input.archiveDirectory)
  const stagingRelativePath = normalizeRelativePath(
    input.stagingRelativePath,
    'Archive staging path',
  )
  const finalRelativePath = normalizeRelativePath(input.finalRelativePath, 'Archive final path')
  const finalMatch = /^([0-9a-f-]{36})\.sararch$/u.exec(finalRelativePath)
  if (finalMatch === null || !UUID_V4.test(finalMatch[1])) {
    throw new ArchiveCustodyOperationEnvelopeError(
      'Archive final path does not contain its exact archive identity.',
    )
  }
  const archiveId = finalMatch[1]
  const expectedStagingPath = `.staging/${creationOperationId}/${archiveId}.sararch.tmp`
  if (stagingRelativePath !== expectedStagingPath) {
    throw new ArchiveCustodyOperationEnvelopeError(
      'Archive staging path does not match the issued operation identity.',
    )
  }
  const sourceRelativePath = normalizeRelativePath(
    input.sourceRelativePath,
    'Archive operation source path',
  )
  let targetRelativePath = null
  if (input.targetRelativePath !== null) {
    targetRelativePath = normalizeRelativePath(
      input.targetRelativePath,
      'Archive operation target path',
    )
  }
  if (input.action === 'publish' && (
    sourceRelativePath !== stagingRelativePath || targetRelativePath !== finalRelativePath
  )) {
    throw new ArchiveCustodyOperationEnvelopeError(
      'Archive publish ticket does not use its exact staging and final paths.',
    )
  }
  if (input.action === 'quarantine') {
    const quarantineMatch = new RegExp(
      `^quarantine/orphan-([0-9a-f-]{36})/${archiveId}\\.sararch$`,
      'u',
    ).exec(targetRelativePath ?? '')
    if (sourceRelativePath !== finalRelativePath || targetRelativePath === null
      || quarantineMatch === null || !UUID_V4.test(quarantineMatch[1])) {
      throw new ArchiveCustodyOperationEnvelopeError(
        'Archive quarantine ticket does not use its exact final and quarantine paths.',
      )
    }
  }
  if (input.action === 'staging_cleanup' && (
    sourceRelativePath !== `.staging/${creationOperationId}` || targetRelativePath !== null
  )) {
    throw new ArchiveCustodyOperationEnvelopeError(
      'Archive staging-cleanup ticket does not use its exact operation directory.',
    )
  }

  let expectedFileIdentity = null
  if (input.action === 'staging_cleanup') {
    if (input.expectedSizeBytes !== null || input.expectedCiphertextSha256 !== null
      || input.expectedFileIdentity !== null) {
      throw new ArchiveCustodyOperationEnvelopeError(
        'Archive staging cleanup must not carry a ciphertext identity.',
      )
    }
  } else {
    if (!Number.isSafeInteger(input.expectedSizeBytes) || input.expectedSizeBytes < 1
      || typeof input.expectedCiphertextSha256 !== 'string'
      || !SHA256.test(input.expectedCiphertextSha256)) {
      throw new ArchiveCustodyOperationEnvelopeError(
        'Archive custody transfer requires an exact ciphertext size and SHA-256.',
      )
    }
    try {
      expectedFileIdentity = normalizeCustodyFileIdentity(input.expectedFileIdentity)
    } catch {
      throw new ArchiveCustodyOperationEnvelopeError(
        'Archive custody transfer requires one closed file identity.',
      )
    }
    if (expectedFileIdentity.sizeBytes !== input.expectedSizeBytes) {
      throw new ArchiveCustodyOperationEnvelopeError(
        'Archive custody size and expected file identity disagree.',
      )
    }
  }

  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    maintenanceOperationId,
    creationOperationId,
    journalRevision: input.journalRevision,
    action: input.action,
    archiveDirectory,
    sourceRelativePath,
    targetRelativePath,
    stagingRelativePath,
    finalRelativePath,
    expectedSizeBytes: input.expectedSizeBytes,
    expectedCiphertextSha256: input.expectedCiphertextSha256,
    expectedFileIdentity,
  })
}

/** Validates a terminal worker result against its complete issued ticket. */
function normalizeArchiveCustodyOperationResult(input, expectedInput) {
  const expected = normalizeArchiveCustodyOperationTicket(expectedInput)
  requireExactRecord(input, RESULT_KEYS, 'Archive custody operation result')
  if (input.type !== 'complete' || input.protocolVersion !== PROTOCOL_VERSION
    || input.maintenanceOperationId !== expected.maintenanceOperationId
    || input.creationOperationId !== expected.creationOperationId
    || input.journalRevision !== expected.journalRevision
    || input.action !== expected.action
    || input.sourceRelativePath !== expected.sourceRelativePath
    || input.targetRelativePath !== expected.targetRelativePath
    || input.directoriesSynced !== true
    || !OUTCOMES[expected.action].has(input.outcome)) {
    throw new ArchiveCustodyOperationEnvelopeError(
      'Archive custody operation result identity was substituted.',
    )
  }
  let sourceIdentity = null
  let targetIdentity = null
  try {
    if (input.sourceIdentity !== null) {
      sourceIdentity = normalizeCustodyFileIdentity(input.sourceIdentity)
    }
    if (input.targetIdentity !== null) {
      targetIdentity = normalizeCustodyFileIdentity(input.targetIdentity)
    }
  } catch {
    throw new ArchiveCustodyOperationEnvelopeError(
      'Archive custody operation result contains an invalid file identity.',
    )
  }
  if (expected.action === 'staging_cleanup') {
    if (sourceIdentity !== null || targetIdentity !== null) {
      throw new ArchiveCustodyOperationEnvelopeError(
        'Archive staging-cleanup result must not claim a file identity.',
      )
    }
  } else if (['moved', 'target_only'].includes(input.outcome)) {
    if (sourceIdentity !== null || targetIdentity === null
      || targetIdentity.linkCount !== 1
      || targetIdentity.device !== expected.expectedFileIdentity.device
      || targetIdentity.inode !== expected.expectedFileIdentity.inode
      || targetIdentity.modifiedTimeNanoseconds
        !== expected.expectedFileIdentity.modifiedTimeNanoseconds
      || targetIdentity.sizeBytes !== expected.expectedSizeBytes
      || BigInt(targetIdentity.changedTimeNanoseconds)
        < BigInt(expected.expectedFileIdentity.changedTimeNanoseconds)) {
      throw new ArchiveCustodyOperationEnvelopeError(
        'Successful archive custody transfer lacks its exact target identity.',
      )
    }
  } else if (input.outcome === 'both_present') {
    if (sourceIdentity === null || targetIdentity === null) {
      throw new ArchiveCustodyOperationEnvelopeError(
        'Archive custody conflict lacks both preserved file identities.',
      )
    }
  } else if (sourceIdentity !== null || targetIdentity !== null) {
    throw new ArchiveCustodyOperationEnvelopeError(
      'Archive custody failure result claims an unsupported file identity.',
    )
  }
  return Object.freeze({ ...input, sourceIdentity, targetIdentity })
}

/** Validates one closed, monotonic-runner progress message. */
function normalizeArchiveCustodyOperationProgress(input, maintenanceOperationId) {
  requireExactRecord(input, PROGRESS_KEYS, 'Archive custody operation progress')
  if (input.type !== 'progress' || input.maintenanceOperationId !== maintenanceOperationId
    || !Number.isSafeInteger(input.sequence) || input.sequence < 1
    || !PROGRESS_PHASE_ORDER.includes(input.phase) || !PROGRESS_UNITS.has(input.unit)
    || !Number.isSafeInteger(input.completed) || input.completed < 0
    || !Number.isSafeInteger(input.total) || input.total < 1
    || input.completed > input.total) {
    throw new ArchiveCustodyOperationEnvelopeError(
      'Archive custody operation progress is invalid.',
    )
  }
  return Object.freeze({
    type: 'progress',
    maintenanceOperationId,
    sequence: input.sequence,
    phase: input.phase,
    unit: input.unit,
    completed: input.completed,
    total: input.total,
  })
}

module.exports = {
  ArchiveCustodyOperationEnvelopeError,
  PROGRESS_PHASE_ORDER,
  normalizeArchiveCustodyOperationProgress,
  normalizeArchiveCustodyOperationResult,
  normalizeArchiveCustodyOperationTicket,
}
