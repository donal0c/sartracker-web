'use strict'

const path = require('node:path')
const { randomUUID } = require('node:crypto')

const { canonicalJson } = require('./archive-container.cjs')
const { normalizeCustodyFileIdentity } = require('./archive-custody-file.cjs')

const ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY = 'archive_custody_active_operation'
const ARCHIVE_CUSTODY_BLOCKING_CONFLICT_KEY = 'archive_custody_blocking_conflict'
const TERMINAL_ARCHIVE_CUSTODY_JOURNAL_PREFIX = 'archive_custody_operation:'
const JOURNAL_VERSION = 1
const PROTOCOL_VERSION = 1
const MAX_JOURNAL_BYTES = 256 * 1024
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u
const ARCHIVE_KINDS = new Set(['finalized', 'direct', 'finalized_recovery'])
const ACTIVE_STATES = new Set([
  'building',
  'publish_prepared',
  'staging_cleanup_planned',
  'quarantine_planned',
])
const TERMINAL_STATES = new Set([
  'registered',
  'staging_removed',
  'quarantined',
  'missing',
  'conflict',
])
const BUILDING_INPUT_KEYS = Object.freeze([
  'archiveId',
  'archiveKind',
  'createdAt',
  'fenceRequestedAt',
  'finalRelativePath',
  'missionId',
  'operationId',
  'previousArchiveId',
  'previousArchiveSha256',
  'protectedFinalizationEpoch',
  'requestEventId',
  'requestEventRowid',
  'temporaryRelativePath',
])
const RECEIPT_KEYS = Object.freeze([
  'ciphertextSha256',
  'containerVersion',
  'entryCount',
  'frameCount',
  'headerSha256',
  'inventorySha256',
  'inventoryVersion',
  'kdfDurationMs',
  'manifestSha256',
  'plaintextCleanupConfirmed',
  'schemaVersion',
  'sizeBytes',
  'slots',
  'tableCount',
  'temporaryFileIdentity',
])
const JOURNAL_KEYS = Object.freeze([
  'archiveId',
  'archiveKind',
  'createdAt',
  'fenceRequestedAt',
  'finalRelativePath',
  'journalVersion',
  'lastErrorCode',
  'missionId',
  'operationId',
  'previousArchiveId',
  'previousArchiveSha256',
  'protectedFinalizationEpoch',
  'quarantine',
  'receipt',
  'requestEventId',
  'requestEventRowid',
  'revision',
  'settledAt',
  'state',
  'temporaryRelativePath',
  'updatedAt',
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

/** Signals an invalid, stale, or unresolved custody-journal transition. */
class ArchiveCustodyJournalError extends Error {
  /** Creates one stable journal failure without reflecting secrets or local paths. */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ArchiveCustodyJournalError'
    this.code = code
    this.details = Object.freeze({ ...details })
  }
}

/** Requires a plain record with exactly the declared keys. */
function requireExactRecord(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      `${label} must be an object.`,
    )
  }
  const actual = Object.keys(value).sort()
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      `${label} has missing or unsupported fields.`,
    )
  }
}

/** Requires one RFC-4122 version-four internal identity. */
function normalizeUuid(value, label) {
  if (typeof value !== 'string' || !UUID_V4.test(value)) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      `${label} is invalid.`,
    )
  }
  return value
}

/** Requires one bounded non-control identity. */
function normalizeId(value, label) {
  if (typeof value !== 'string' || value.trim() === ''
    || Buffer.byteLength(value, 'utf8') > 200 || CONTROL_CHARACTERS.test(value)) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      `${label} is invalid.`,
    )
  }
  return value
}

/** Requires one canonical timestamp. */
function normalizeTimestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      `${label} must be a canonical ISO-8601 timestamp.`,
    )
  }
  return value
}

/** Requires one canonical path below the configured archive root. */
function normalizeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 4_096 || CONTROL_CHARACTERS.test(value)
    || path.isAbsolute(value) || value.includes('\\')
    || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_PATH',
      `${label} must remain inside the archive custody directory.`,
    )
  }
  return value
}

/** Requires one canonical absolute archive directory. */
function normalizeArchiveDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)
    || path.resolve(value) !== value || Buffer.byteLength(value, 'utf8') > 8_192
    || CONTROL_CHARACTERS.test(value)) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_PATH',
      'Archive custody directory must be a canonical absolute path.',
    )
  }
  return value
}

/** Requires a positive exact row identity. */
function normalizePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      `${label} must be a positive safe integer.`,
    )
  }
  return value
}

/** Requires lowercase SHA-256 hex. */
function normalizeSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      `${label} must be lowercase SHA-256 hex.`,
    )
  }
  return value
}

/** Validates a non-secret key-slot projection. */
function normalizeSlots(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      'Archive creation receipt must retain exactly two non-secret key slots.',
    )
  }
  const normalized = value.map((slot) => {
    requireExactRecord(slot, ['slotId', 'slotType'], 'Archive receipt slot')
    const slotType = normalizeId(slot.slotType, 'Archive receipt slot type')
    const slotId = normalizeId(slot.slotId, 'Archive receipt slot identity')
    if (!['passphrase', 'recovery'].includes(slotType)) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
        'Archive creation receipt contains an unsupported slot type.',
      )
    }
    return Object.freeze({ slotType, slotId })
  })
  if (new Set(normalized.map((slot) => slot.slotType)).size !== 2
    || new Set(normalized.map((slot) => slot.slotId)).size !== 2) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      'Archive creation receipt contains duplicate slot custody.',
    )
  }
  normalized.sort((left, right) => left.slotType.localeCompare(right.slotType))
  return Object.freeze(normalized)
}

/** Validates the complete worker receipt before any publish side effect. */
function normalizeCreationReceipt(value) {
  requireExactRecord(value, RECEIPT_KEYS, 'Archive creation receipt')
  if (value.containerVersion !== 2 || value.schemaVersion !== 13
    || value.inventoryVersion !== 1 || value.plaintextCleanupConfirmed !== true
    || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1
    || !Number.isSafeInteger(value.frameCount) || value.frameCount < 2
    || !Number.isSafeInteger(value.entryCount) || value.entryCount < 4
    || value.tableCount !== 49 || !Number.isFinite(value.kdfDurationMs)
    || value.kdfDurationMs < 0 || value.kdfDurationMs > 10 * 60_000) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      'Archive creation receipt is incomplete or unsupported.',
    )
  }
  let temporaryFileIdentity
  try {
    temporaryFileIdentity = normalizeCustodyFileIdentity(value.temporaryFileIdentity)
  } catch {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      'Archive creation receipt has an invalid staging-file identity.',
    )
  }
  if (temporaryFileIdentity.sizeBytes !== value.sizeBytes) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      'Archive creation receipt size and staging-file identity disagree.',
    )
  }
  return Object.freeze({
    containerVersion: 2,
    schemaVersion: 13,
    inventoryVersion: 1,
    ciphertextSha256: normalizeSha256(value.ciphertextSha256, 'Archive ciphertext identity'),
    sizeBytes: value.sizeBytes,
    frameCount: value.frameCount,
    headerSha256: normalizeSha256(value.headerSha256, 'Archive header identity'),
    manifestSha256: normalizeSha256(value.manifestSha256, 'Archive manifest identity'),
    inventorySha256: normalizeSha256(value.inventorySha256, 'Archive inventory identity'),
    entryCount: value.entryCount,
    tableCount: 49,
    slots: normalizeSlots(value.slots),
    temporaryFileIdentity,
    plaintextCleanupConfirmed: true,
    kdfDurationMs: value.kdfDurationMs,
  })
}

/** Validates and closes a journal-before-create identity. */
function normalizeBuildingInput(input, updatedAt) {
  requireExactRecord(input, BUILDING_INPUT_KEYS, 'Archive custody building plan')
  const operationId = normalizeUuid(input.operationId, 'Archive creation operation identity')
  const archiveId = normalizeUuid(input.archiveId, 'Archive identity')
  if (!ARCHIVE_KINDS.has(input.archiveKind)) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      'Archive kind is unsupported.',
    )
  }
  const expectedTemporaryPath = `.staging/${operationId}/${archiveId}.sararch.tmp`
  const expectedFinalPath = `${archiveId}.sararch`
  const temporaryRelativePath = normalizeRelativePath(
    input.temporaryRelativePath,
    'Archive staging path',
  )
  const finalRelativePath = normalizeRelativePath(input.finalRelativePath, 'Archive final path')
  if (temporaryRelativePath !== expectedTemporaryPath || finalRelativePath !== expectedFinalPath) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_PATH',
      'Archive custody plan does not use the exact operation-issued paths.',
    )
  }
  let protectedFinalizationEpoch = null
  if (input.protectedFinalizationEpoch !== null) {
    protectedFinalizationEpoch = normalizePositiveInteger(
      input.protectedFinalizationEpoch,
      'Protected finalization epoch',
    )
  } else if (input.archiveKind === 'finalized_recovery') {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      'A finalized recovery archive requires its protected finalization epoch.',
    )
  }
  const hasPreviousId = input.previousArchiveId !== null
  const hasPreviousHash = input.previousArchiveSha256 !== null
  if (hasPreviousId !== hasPreviousHash) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      'Archive predecessor identity must include both row and ciphertext identities.',
    )
  }
  return Object.freeze({
    journalVersion: JOURNAL_VERSION,
    revision: 1,
    state: 'building',
    operationId,
    archiveId,
    missionId: normalizeId(input.missionId, 'Archive mission identity'),
    requestEventRowid: normalizePositiveInteger(
      input.requestEventRowid,
      'Archive request event row identity',
    ),
    requestEventId: normalizeUuid(input.requestEventId, 'Archive request event identity'),
    archiveKind: input.archiveKind,
    protectedFinalizationEpoch,
    previousArchiveId: hasPreviousId
      ? normalizeUuid(input.previousArchiveId, 'Previous archive identity')
      : null,
    previousArchiveSha256: hasPreviousHash
      ? normalizeSha256(input.previousArchiveSha256, 'Previous archive ciphertext identity')
      : null,
    fenceRequestedAt: normalizeTimestamp(input.fenceRequestedAt, 'Archive fence time'),
    createdAt: normalizeTimestamp(input.createdAt, 'Archive creation time'),
    temporaryRelativePath,
    finalRelativePath,
    receipt: null,
    quarantine: null,
    updatedAt,
    settledAt: null,
    lastErrorCode: null,
  })
}

/** Parses a bounded journal value and rejects corrupted durable state. */
function parseJournalValue(value, expectedStateClass = null) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_JOURNAL_BYTES) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
      'Archive custody journal is missing or exceeds its safe bound.',
    )
  }
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
      'Archive custody journal is not valid JSON.',
    )
  }
  try {
    if (canonicalJson(parsed) !== value) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
        'Archive custody journal is not in canonical durable form.',
      )
    }
    requireExactRecord(parsed, JOURNAL_KEYS, 'Archive custody journal')
    if (parsed.journalVersion !== JOURNAL_VERSION
      || !Number.isSafeInteger(parsed.revision) || parsed.revision < 1
      || !ACTIVE_STATES.has(parsed.state) && !TERMINAL_STATES.has(parsed.state)) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
        'Archive custody journal version, revision, or state is invalid.',
      )
    }
    if (expectedStateClass === 'active' && !ACTIVE_STATES.has(parsed.state)
      || expectedStateClass === 'terminal' && !TERMINAL_STATES.has(parsed.state)) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
        'Archive custody journal is retained under the wrong durable key.',
      )
    }
    normalizeUuid(parsed.operationId, 'Archive creation operation identity')
    normalizeUuid(parsed.archiveId, 'Archive identity')
    normalizeId(parsed.missionId, 'Archive mission identity')
    normalizePositiveInteger(parsed.requestEventRowid, 'Archive request event row identity')
    normalizeUuid(parsed.requestEventId, 'Archive request event identity')
    if (!ARCHIVE_KINDS.has(parsed.archiveKind)) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
        'Archive custody journal kind is unsupported.',
      )
    }
    if (parsed.protectedFinalizationEpoch !== null) {
      normalizePositiveInteger(
        parsed.protectedFinalizationEpoch,
        'Protected finalization epoch',
      )
    } else if (parsed.archiveKind === 'finalized_recovery') {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
        'Archive custody recovery journal lost its protected finalization epoch.',
      )
    }
    const hasPreviousId = parsed.previousArchiveId !== null
    const hasPreviousHash = parsed.previousArchiveSha256 !== null
    if (hasPreviousId !== hasPreviousHash) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
        'Archive custody journal predecessor identity is incomplete.',
      )
    }
    if (hasPreviousId) {
      normalizeUuid(parsed.previousArchiveId, 'Previous archive identity')
      normalizeSha256(parsed.previousArchiveSha256, 'Previous archive ciphertext identity')
      if (parsed.previousArchiveId === parsed.archiveId) {
        throw new ArchiveCustodyJournalError(
          'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
          'Archive custody journal cannot name itself as its predecessor.',
        )
      }
    }
    normalizeTimestamp(parsed.fenceRequestedAt, 'Archive fence time')
    normalizeTimestamp(parsed.createdAt, 'Archive creation time')
    normalizeTimestamp(parsed.updatedAt, 'Archive journal update time')
    const temporaryRelativePath = normalizeRelativePath(
      parsed.temporaryRelativePath,
      'Archive staging path',
    )
    const finalRelativePath = normalizeRelativePath(parsed.finalRelativePath, 'Archive final path')
    if (temporaryRelativePath
        !== `.staging/${parsed.operationId}/${parsed.archiveId}.sararch.tmp`
      || finalRelativePath !== `${parsed.archiveId}.sararch`) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
        'Archive custody journal paths do not match their immutable identities.',
      )
    }
    if (parsed.receipt !== null) {
      const normalizedReceipt = normalizeCreationReceipt(parsed.receipt)
      if (canonicalJson(normalizedReceipt) !== canonicalJson(parsed.receipt)) {
        throw new ArchiveCustodyJournalError(
          'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
          'Archive custody journal receipt is not in normalized durable form.',
        )
      }
    }
    if (parsed.quarantine !== null) {
      requireExactRecord(
        parsed.quarantine,
        ['quarantineId', 'relativePath'],
        'Archive quarantine plan',
      )
      normalizeUuid(parsed.quarantine.quarantineId, 'Archive quarantine identity')
      const quarantinePath = normalizeRelativePath(
        parsed.quarantine.relativePath,
        'Archive quarantine path',
      )
      if (quarantinePath !== `quarantine/orphan-${parsed.quarantine.quarantineId}/${parsed.archiveId}.sararch`) {
        throw new ArchiveCustodyJournalError(
          'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
          'Archive quarantine path does not match its immutable identities.',
        )
      }
    }
    if (ACTIVE_STATES.has(parsed.state) && parsed.settledAt !== null
      || TERMINAL_STATES.has(parsed.state) && parsed.settledAt === null) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
        'Archive custody journal settlement state is inconsistent.',
      )
    }
    if (parsed.settledAt !== null) normalizeTimestamp(parsed.settledAt, 'Archive settlement time')
    if (parsed.lastErrorCode !== null) normalizeId(parsed.lastErrorCode, 'Archive journal error code')
    const hasReceipt = parsed.receipt !== null
    const hasQuarantine = parsed.quarantine !== null
    const shapeIsValid = parsed.state === 'building'
      ? parsed.revision === 1 && !hasReceipt && !hasQuarantine && parsed.lastErrorCode === null
      : parsed.state === 'publish_prepared'
        ? parsed.revision === 2 && hasReceipt && !hasQuarantine && parsed.lastErrorCode === null
        : parsed.state === 'staging_cleanup_planned'
          ? parsed.revision === 2 && !hasReceipt && !hasQuarantine
            && parsed.lastErrorCode === null
          : parsed.state === 'quarantine_planned'
            ? parsed.revision === 3 && hasReceipt && hasQuarantine
              && parsed.lastErrorCode === null
            : parsed.state === 'registered'
              ? parsed.revision === 3 && hasReceipt && !hasQuarantine
                && parsed.lastErrorCode === null
              : parsed.state === 'staging_removed'
                ? parsed.revision === 3 && !hasReceipt && !hasQuarantine
                  && parsed.lastErrorCode === null
                : parsed.state === 'quarantined'
                  ? parsed.revision === 4 && hasReceipt && hasQuarantine
                    && parsed.lastErrorCode === null
                  : parsed.state === 'missing'
                    ? parsed.revision === 4 && hasReceipt && hasQuarantine
                      && parsed.lastErrorCode !== null
                    : parsed.state === 'conflict'
                      && parsed.lastErrorCode !== null
                      && (parsed.revision === 3 && !hasReceipt && !hasQuarantine
                        || parsed.revision === 4 && hasReceipt && hasQuarantine)
    if (!shapeIsValid
      || TERMINAL_STATES.has(parsed.state) && parsed.updatedAt !== parsed.settledAt) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
        'Archive custody journal transition shape is inconsistent.',
      )
    }
    return Object.freeze(parsed)
  } catch (error) {
    if (error instanceof ArchiveCustodyJournalError
      && error.code === 'ARCHIVE_CUSTODY_JOURNAL_CORRUPT') {
      throw error
    }
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
      'Archive custody journal contains malformed durable state.',
    )
  }
}

/** Serializes one bounded journal record deterministically. */
function serializeJournal(record) {
  const serialized = canonicalJson(record)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_JOURNAL_BYTES) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      'Archive custody journal exceeds its safe storage bound.',
    )
  }
  return serialized
}

/** Creates one stable cancellation error. */
function createAbortError() {
  const error = new Error('Archive custody recovery was cancelled.')
  error.name = 'AbortError'
  error.code = 'ARCHIVE_CANCELLED'
  return error
}

/** Validates an exact maintenance result against its issued ticket. */
function normalizeMaintenanceResult(input, ticket) {
  requireExactRecord(input, RESULT_KEYS, 'Archive custody maintenance result')
  if (input.type !== 'complete' || input.protocolVersion !== PROTOCOL_VERSION
    || input.maintenanceOperationId !== ticket.maintenanceOperationId
    || input.creationOperationId !== ticket.creationOperationId
    || input.journalRevision !== ticket.journalRevision
    || input.action !== ticket.action
    || input.sourceRelativePath !== ticket.sourceRelativePath
    || input.targetRelativePath !== ticket.targetRelativePath
    || input.directoriesSynced !== true) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_RESULT_SUBSTITUTED',
      'Archive custody worker returned a substituted maintenance result.',
    )
  }
  const allowedOutcomes = ticket.action === 'publish'
    ? new Set(['moved', 'target_only', 'both_present', 'neither_present', 'not_regular', 'changed'])
    : ticket.action === 'quarantine'
      ? new Set([
        'moved', 'target_only', 'both_present', 'neither_present', 'not_regular',
        'changed', 'staging_only',
      ])
      : new Set(['removed', 'source_absent', 'unexpected_final', 'not_regular'])
  if (!allowedOutcomes.has(input.outcome)) {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_RESULT_SUBSTITUTED',
      'Archive custody worker returned an unsupported maintenance outcome.',
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
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_RESULT_SUBSTITUTED',
      'Archive custody worker returned an invalid maintenance file identity.',
    )
  }
  return Object.freeze({ ...input, sourceIdentity, targetIdentity })
}

/** Parses one audit-details object without allowing malformed JSON to become a witness. */
function parseAuditDetails(value) {
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null
  } catch {
    return null
  }
}

/** Returns whether the published identity is the staged file covered by the receipt. */
function publishedIdentityMatchesReceipt(value, receipt) {
  let published
  try {
    published = normalizeCustodyFileIdentity(value)
  } catch {
    return false
  }
  let changedTimeDidNotRegress = false
  try {
    changedTimeDidNotRegress = BigInt(published.changedTimeNanoseconds)
      >= BigInt(receipt.temporaryFileIdentity.changedTimeNanoseconds)
  } catch {
    return false
  }
  return published.device === receipt.temporaryFileIdentity.device
    && published.inode === receipt.temporaryFileIdentity.inode
    && published.modifiedTimeNanoseconds
      === receipt.temporaryFileIdentity.modifiedTimeNanoseconds
    && published.sizeBytes === receipt.sizeBytes
    && published.linkCount === 1
    && changedTimeDidNotRegress
}

/** Returns whether the registry slot inventory exactly matches both non-secret receipt slots. */
function registrySlotsMatch(value, receipt) {
  if (typeof value !== 'string') return false
  try {
    return canonicalJson(normalizeSlots(JSON.parse(value))) === canonicalJson(receipt.slots)
  } catch {
    return false
  }
}

/** Returns whether the mission state and finalization audit agree with the archive kind. */
function missionStateMatchesJournal(db, journal, mission, sealDetails) {
  if (mission === undefined || sealDetails?.resulting_status !== mission.status) return false
  if (journal.archiveKind === 'direct') {
    if (!['finished', 'finalized'].includes(mission.status)) return false
    if (journal.protectedFinalizationEpoch === null) return true
  } else if (mission.status !== 'finalized') {
    return false
  }

  const latestFinalization = db.prepare(`SELECT rowid AS event_rowid, id, mission_id,
      event_type, details_json
    FROM mission_events
    WHERE mission_id = ? AND event_type = 'mission_finalized'
    ORDER BY rowid DESC LIMIT 1`).get(journal.missionId)
  const finalizationDetails = parseAuditDetails(latestFinalization?.details_json)
  if (journal.archiveKind === 'finalized') {
    return latestFinalization?.mission_id === journal.missionId
      && latestFinalization?.event_type === 'mission_finalized'
      && finalizationDetails?.resulting_status === 'finalized'
      && finalizationDetails?.archive_id === journal.archiveId
      && finalizationDetails?.archive_relative_path === journal.finalRelativePath
      && finalizationDetails?.container_version === 2
  }
  if (journal.protectedFinalizationEpoch === null
    || Number(latestFinalization?.event_rowid) !== journal.protectedFinalizationEpoch
    || latestFinalization?.mission_id !== journal.missionId
    || latestFinalization?.event_type !== 'mission_finalized'
    || finalizationDetails?.resulting_status !== 'finalized') {
    return false
  }
  return true
}

/** Returns whether one registry row is the complete sealed witness for a journal receipt. */
function registryMatchesJournal(db, journal) {
  if (journal.receipt === null) return false
  const receipt = journal.receipt
  const row = db.prepare(`SELECT id, mission_id, request_event_rowid, request_event_id,
      creation_operation_id, protected_finalization_epoch, archive_kind, container_version,
      relative_path, ciphertext_sha256, size_bytes, created_at, sealed_event_id,
      frame_count, header_sha256, manifest_sha256, entry_count, table_count,
      previous_archive_id, status, slots_json
    FROM mission_archives WHERE id = ?`).get(journal.archiveId)
  if (row === undefined
    || row.id !== journal.archiveId
    || row.mission_id !== journal.missionId
    || Number(row.request_event_rowid) !== journal.requestEventRowid
    || row.request_event_id !== journal.requestEventId
    || row.creation_operation_id !== journal.operationId
    || (row.protected_finalization_epoch === null
      ? null
      : Number(row.protected_finalization_epoch)) !== journal.protectedFinalizationEpoch
    || row.archive_kind !== journal.archiveKind
    || Number(row.container_version) !== receipt.containerVersion
    || row.relative_path !== journal.finalRelativePath
    || row.ciphertext_sha256 !== receipt.ciphertextSha256
    || Number(row.size_bytes) !== receipt.sizeBytes
    || row.created_at !== journal.createdAt
    || typeof row.sealed_event_id !== 'string' || row.sealed_event_id.length < 1
    || Number(row.frame_count) !== receipt.frameCount
    || row.header_sha256 !== receipt.headerSha256
    || row.manifest_sha256 !== receipt.manifestSha256
    || Number(row.entry_count) !== receipt.entryCount
    || Number(row.table_count) !== receipt.tableCount
    || row.previous_archive_id !== journal.previousArchiveId
    || row.status !== 'sealed'
    || !registrySlotsMatch(row.slots_json, receipt)) {
    return false
  }

  if (journal.previousArchiveId !== null) {
    const previous = db.prepare(`SELECT mission_id, ciphertext_sha256
      FROM mission_archives WHERE id = ?`).get(journal.previousArchiveId)
    if (previous?.mission_id !== journal.missionId
      || previous?.ciphertext_sha256 !== journal.previousArchiveSha256) {
      return false
    }
  } else if (journal.previousArchiveSha256 !== null) {
    return false
  }

  const requestEvent = db.prepare(`SELECT rowid AS event_rowid, id, mission_id,
      event_type, timestamp, details_json
    FROM mission_events WHERE rowid = ?`).get(journal.requestEventRowid)
  const requestDetails = parseAuditDetails(requestEvent?.details_json)
  const expectedRequestEventType = journal.archiveKind === 'finalized'
    ? 'mission_finalize_requested'
    : 'mission_archive_requested'
  const expectedRequestStatus = journal.archiveKind === 'finalized'
    ? 'finished'
    : journal.archiveKind === 'finalized_recovery'
      ? 'finalized'
      : null
  if (requestEvent?.id !== journal.requestEventId
    || requestEvent?.mission_id !== journal.missionId
    || requestEvent?.event_type !== expectedRequestEventType
    || requestEvent?.timestamp !== journal.fenceRequestedAt
    || requestDetails?.archive_id !== journal.archiveId
    || requestDetails?.archive_kind !== journal.archiveKind
    || requestDetails?.archive_relative_path !== journal.finalRelativePath
    || requestDetails?.operation_id !== journal.operationId
    || requestDetails?.protected_finalization_epoch !== journal.protectedFinalizationEpoch
    || expectedRequestStatus !== null
      && requestDetails?.resulting_status !== expectedRequestStatus) {
    return false
  }

  const sealEvent = db.prepare(`SELECT id, mission_id, event_type, timestamp, details_json
    FROM mission_events WHERE id = ?`).get(row.sealed_event_id)
  const sealDetails = parseAuditDetails(sealEvent?.details_json)
  if (sealEvent?.id !== row.sealed_event_id
    || sealEvent?.mission_id !== journal.missionId
    || sealEvent?.event_type !== 'mission_archive_sealed_v2'
    || sealEvent?.timestamp !== journal.createdAt
    || sealDetails?.archive_id !== journal.archiveId
    || sealDetails?.request_event_rowid !== journal.requestEventRowid
    || sealDetails?.request_event_id !== journal.requestEventId
    || sealDetails?.creation_operation_id !== journal.operationId
    || sealDetails?.protected_finalization_epoch !== journal.protectedFinalizationEpoch
    || sealDetails?.relative_path !== journal.finalRelativePath
    || sealDetails?.ciphertext_sha256 !== receipt.ciphertextSha256
    || sealDetails?.size_bytes !== receipt.sizeBytes
    || sealDetails?.frame_count !== receipt.frameCount
    || sealDetails?.header_sha256 !== receipt.headerSha256
    || sealDetails?.manifest_sha256 !== receipt.manifestSha256
    || sealDetails?.inventory_sha256 !== receipt.inventorySha256
    || sealDetails?.entry_count !== receipt.entryCount
    || sealDetails?.table_count !== receipt.tableCount
    || !publishedIdentityMatchesReceipt(sealDetails?.publish_file_identity, receipt)) {
    return false
  }

  const mission = db.prepare('SELECT id, status FROM missions WHERE id = ?')
    .get(journal.missionId)
  return mission?.id === journal.missionId
    && missionStateMatchesJournal(db, journal, mission, sealDetails)
}

/** Returns whether any registry row already occupies the immutable archive identity. */
function registryArchiveExists(db, archiveId) {
  return db.prepare('SELECT 1 AS present FROM mission_archives WHERE id = ?').get(archiveId)
    !== undefined
}

/** Creates the metadata-backed single-active-operation custody state machine. */
function createArchiveCustodyJournal({
  db,
  archiveDirectory,
  now = () => new Date().toISOString(),
  randomUuid = randomUUID,
  runCustodyOperation = null,
}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new ArchiveCustodyJournalError(
      'ARCHIVE_CUSTODY_JOURNAL_INVALID_DATABASE',
      'Archive custody journal requires an open better-sqlite3 database.',
    )
  }
  const custodyDirectory = normalizeArchiveDirectory(archiveDirectory)

  /** Reads the one active journal record and its exact serialized CAS token. */
  function readActiveWithToken() {
    const row = db.prepare('SELECT value FROM metadata WHERE key = ?')
      .get(ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY)
    if (row === undefined) return null
    return Object.freeze({
      record: parseJournalValue(row.value, 'active'),
      token: row.value,
    })
  }

  /** Replaces the active record only if its complete prior serialization still matches. */
  function compareAndSwapActive(previous, next) {
    const nextToken = serializeJournal(next)
    const result = db.prepare(`UPDATE metadata SET value = ?
      WHERE key = ? AND value = ?`).run(
      nextToken,
      ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY,
      previous.token,
    )
    if (result.changes !== 1) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_STALE_REVISION',
        'Archive custody journal revision changed; restart reconciliation.',
      )
    }
    return Object.freeze(next)
  }

  /** Requires one exact active operation/revision. */
  function requireActive(operationId, expectedRevision, expectedStates = null) {
    const active = readActiveWithToken()
    if (active === null || active.record.operationId !== normalizeUuid(
      operationId,
      'Archive creation operation identity',
    )) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_NOT_FOUND',
        'The active archive custody operation was not found.',
      )
    }
    if (active.record.revision !== expectedRevision) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_STALE_REVISION',
        'Archive custody journal revision changed; restart reconciliation.',
      )
    }
    if (expectedStates !== null && !expectedStates.includes(active.record.state)) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_INVALID_STATE',
        'Archive custody journal is not in the required transition state.',
      )
    }
    return active
  }

  /** Moves the active record to immutable terminal history in the current transaction. */
  function terminalize(active, state, settledAt, lastErrorCode = null) {
    if (!TERMINAL_STATES.has(state)) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_INVALID_STATE',
        'Archive custody terminal state is invalid.',
      )
    }
    const terminal = Object.freeze({
      ...active.record,
      revision: active.record.revision + 1,
      state,
      updatedAt: settledAt,
      settledAt,
      lastErrorCode,
    })
    const terminalKey = `${TERMINAL_ARCHIVE_CUSTODY_JOURNAL_PREFIX}${active.record.operationId}`
    const terminalToken = serializeJournal(terminal)
    const existing = db.prepare('SELECT value FROM metadata WHERE key = ?').get(terminalKey)
    if (existing !== undefined) {
      parseJournalValue(existing.value, 'terminal')
      throw new ArchiveCustodyJournalError(
        existing.value === terminalToken
          ? 'ARCHIVE_CUSTODY_JOURNAL_TERMINAL_EXISTS'
          : 'ARCHIVE_CUSTODY_JOURNAL_TERMINAL_CONFLICT',
        existing.value === terminalToken
          ? 'Archive custody terminal history already exists.'
          : 'Archive custody terminal history conflicts with the active operation.',
      )
    }
    let inserted
    try {
      inserted = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)')
        .run(terminalKey, terminalToken)
    } catch (error) {
      if (error?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
        || error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new ArchiveCustodyJournalError(
          'ARCHIVE_CUSTODY_JOURNAL_TERMINAL_CONFLICT',
          'Archive custody terminal history changed during settlement.',
        )
      }
      throw error
    }
    if (inserted.changes !== 1) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_TERMINAL_CONFLICT',
        'Archive custody terminal history could not be settled exactly once.',
      )
    }
    if (state === 'conflict') {
      const blocker = canonicalJson({
        version: 1,
        operationId: terminal.operationId,
        archiveId: terminal.archiveId,
        missionId: terminal.missionId,
        errorCode: terminal.lastErrorCode,
        observedAt: terminal.settledAt,
      })
      try {
        const blocked = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)')
          .run(ARCHIVE_CUSTODY_BLOCKING_CONFLICT_KEY, blocker)
        if (blocked.changes !== 1) {
          throw new ArchiveCustodyJournalError(
            'ARCHIVE_CUSTODY_RECOVERY_REQUIRED',
            'Archive custody conflict could not be retained durably.',
          )
        }
      } catch (error) {
        if (error instanceof ArchiveCustodyJournalError) throw error
        if (error?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
          || error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new ArchiveCustodyJournalError(
            'ARCHIVE_CUSTODY_RECOVERY_REQUIRED',
            'A prior archive custody conflict still requires explicit review.',
          )
        }
        throw error
      }
    }
    const removed = db.prepare('DELETE FROM metadata WHERE key = ? AND value = ?')
      .run(ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY, active.token)
    if (removed.changes !== 1) {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_STALE_REVISION',
        'Archive custody journal revision changed before settlement.',
      )
    }
    return terminal
  }

  /** Issues one closed maintenance ticket from current durable state. */
  function createTicket(active, action, sourceRelativePath, targetRelativePath) {
    return Object.freeze({
      protocolVersion: PROTOCOL_VERSION,
      maintenanceOperationId: normalizeUuid(
        randomUuid(),
        'Archive maintenance operation identity',
      ),
      creationOperationId: active.record.operationId,
      journalRevision: active.record.revision,
      action,
      archiveDirectory: custodyDirectory,
      sourceRelativePath,
      targetRelativePath,
      stagingRelativePath: active.record.temporaryRelativePath,
      finalRelativePath: active.record.finalRelativePath,
      expectedSizeBytes: active.record.receipt?.sizeBytes ?? null,
      expectedCiphertextSha256: active.record.receipt?.ciphertextSha256 ?? null,
      expectedFileIdentity: active.record.receipt?.temporaryFileIdentity ?? null,
    })
  }

  /** Runs one injected/worker maintenance operation and validates its closed reply. */
  async function executeTicket(ticket, signal) {
    if (signal?.aborted === true) throw createAbortError()
    if (typeof runCustodyOperation !== 'function') {
      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_RUNNER_REQUIRED',
        'Archive custody maintenance runner is unavailable.',
      )
    }
    const operation = runCustodyOperation(ticket, signal)
    let result
    try {
      result = await operation
    } finally {
      if (operation?.workerExited !== undefined) await operation.workerExited
    }
    if (signal?.aborted === true) throw createAbortError()
    return normalizeMaintenanceResult(result, ticket)
  }

  const api = {
    /** Commits the exact staging/final plan before a create worker can touch disk. */
    planBuildingWithinTransaction(input) {
      if (db.prepare('SELECT 1 FROM metadata WHERE key = ?')
        .get(ARCHIVE_CUSTODY_BLOCKING_CONFLICT_KEY) !== undefined) {
        throw new ArchiveCustodyJournalError(
          'ARCHIVE_CUSTODY_RECOVERY_REQUIRED',
          'A prior archive custody conflict requires explicit review.',
        )
      }
      if (readActiveWithToken() !== null) {
        throw new ArchiveCustodyJournalError(
          'ARCHIVE_CUSTODY_JOURNAL_BUSY',
          'An active archive custody operation must settle before another can start.',
        )
      }
      const updatedAt = normalizeTimestamp(now(), 'Archive journal update time')
      const record = normalizeBuildingInput(input, updatedAt)
      try {
        db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run(
          ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY,
          serializeJournal(record),
        )
      } catch (error) {
        if (error?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
          || error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new ArchiveCustodyJournalError(
            'ARCHIVE_CUSTODY_JOURNAL_BUSY',
            'An active archive custody operation must settle before another can start.',
          )
        }
        throw error
      }
      return record
    },

    /** Returns the single active operation or null; corrupt state fails loudly. */
    readActive() {
      return readActiveWithToken()?.record ?? null
    },

    /** Returns whether a durable conflict blocks every new archive operation. */
    hasBlockingConflict() {
      return db.prepare('SELECT 1 FROM metadata WHERE key = ?')
        .get(ARCHIVE_CUSTODY_BLOCKING_CONFLICT_KEY) !== undefined
    },

    /** Returns immutable terminal history for one creation operation. */
    readTerminal(operationId) {
      const normalizedOperationId = normalizeUuid(
        operationId,
        'Archive creation operation identity',
      )
      const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get(
        `${TERMINAL_ARCHIVE_CUSTODY_JOURNAL_PREFIX}${normalizedOperationId}`,
      )
      return row === undefined ? null : parseJournalValue(row.value, 'terminal')
    },

    /** Persists the complete worker receipt before any staging-to-final rename. */
    recordPublishPrepared(input) {
      requireExactRecord(
        input,
        ['expectedRevision', 'observedAt', 'operationId', 'receipt'],
        'Archive publish-prepared transition',
      )
      const observedAt = normalizeTimestamp(input.observedAt, 'Archive receipt observation time')
      const receipt = normalizeCreationReceipt(input.receipt)
      const transaction = db.transaction(() => {
        const active = requireActive(
          input.operationId,
          input.expectedRevision,
          ['building'],
        )
        const next = Object.freeze({
          ...active.record,
          revision: active.record.revision + 1,
          state: 'publish_prepared',
          receipt,
          updatedAt: observedAt,
          lastErrorCode: null,
        })
        return compareAndSwapActive(active, next)
      })
      return transaction.immediate()
    },

    /** Publishes only from a durable complete receipt; sealing remains a separate transaction. */
    async publishPrepared(input) {
      requireExactRecord(
        input,
        input.signal === undefined
          ? ['expectedRevision', 'operationId']
          : ['expectedRevision', 'operationId', 'signal'],
        'Archive publish operation',
      )
      const active = requireActive(
        input.operationId,
        input.expectedRevision,
        ['publish_prepared'],
      )
      const ticket = createTicket(
        active,
        'publish',
        active.record.temporaryRelativePath,
        active.record.finalRelativePath,
      )
      const result = await executeTicket(ticket, input.signal)
      if (result.outcome !== 'moved' && result.outcome !== 'target_only') {
        throw new ArchiveCustodyJournalError(
          'ARCHIVE_CUSTODY_JOURNAL_PUBLISH_FAILED',
          `Archive custody publish stopped safely (${result.outcome}).`,
        )
      }
      return result
    },

    /** Settles the journal only inside the caller's registry+seal transaction. */
    completeRegisteredWithinTransaction(input) {
      requireExactRecord(
        input,
        ['expectedRevision', 'operationId', 'registeredAt'],
        'Archive registered transition',
      )
      const registeredAt = normalizeTimestamp(input.registeredAt, 'Archive registration time')
      const active = requireActive(
        input.operationId,
        input.expectedRevision,
        ['publish_prepared'],
      )
      if (!registryMatchesJournal(db, active.record)) {
        throw new ArchiveCustodyJournalError(
          'ARCHIVE_CUSTODY_JOURNAL_REGISTRY_MISMATCH',
          'Archive registry does not match the custody creation receipt.',
        )
      }
      return terminalize(active, 'registered', registeredAt)
    },

    /** Recovers exactly one journalled side effect without enumerating the archive root. */
    async reconcileActive(input = {}) {
      requireExactRecord(
        input,
        input.signal === undefined ? [] : ['signal'],
        'Archive custody reconciliation request',
      )
      if (input.signal?.aborted === true) throw createAbortError()
      let active = readActiveWithToken()
      if (active === null) return null

      if (active.record.state === 'publish_prepared' && registryMatchesJournal(db, active.record)) {
        const transaction = db.transaction(() => {
          const current = requireActive(
            active.record.operationId,
            active.record.revision,
            ['publish_prepared'],
          )
          return terminalize(
            current,
            'registered',
            normalizeTimestamp(now(), 'Archive journal settlement time'),
          )
        })
        return transaction.immediate()
      }

      if (active.record.state === 'building') {
        const transaction = db.transaction(() => {
          const current = requireActive(
            active.record.operationId,
            active.record.revision,
            ['building'],
          )
          return compareAndSwapActive(current, Object.freeze({
            ...current.record,
            revision: current.record.revision + 1,
            state: 'staging_cleanup_planned',
            updatedAt: normalizeTimestamp(now(), 'Archive journal update time'),
          }))
        })
        transaction.immediate()
        active = readActiveWithToken()
      } else if (active.record.state === 'publish_prepared') {
        const quarantineIdentity = normalizeUuid(
          randomUuid(),
          'Archive quarantine identity',
        )
        const quarantineRelativePath = normalizeRelativePath(
          `quarantine/orphan-${quarantineIdentity}/${path.basename(active.record.finalRelativePath)}`,
          'Archive quarantine path',
        )
        const transaction = db.transaction(() => {
          const current = requireActive(
            active.record.operationId,
            active.record.revision,
            ['publish_prepared'],
          )
          if (registryMatchesJournal(db, current.record)) {
            return terminalize(
              current,
              'registered',
              normalizeTimestamp(now(), 'Archive journal settlement time'),
            )
          }
          return compareAndSwapActive(current, Object.freeze({
            ...current.record,
            revision: current.record.revision + 1,
            state: 'quarantine_planned',
            quarantine: Object.freeze({
              quarantineId: quarantineIdentity,
              relativePath: quarantineRelativePath,
            }),
            updatedAt: normalizeTimestamp(now(), 'Archive journal update time'),
          }))
        })
        const planned = transaction.immediate()
        if (planned.state === 'registered') return planned
        active = readActiveWithToken()
      }

      if (active.record.state === 'staging_cleanup_planned') {
        const sourceRelativePath = `.staging/${active.record.operationId}`
        const ticket = createTicket(active, 'staging_cleanup', sourceRelativePath, null)
        const result = await executeTicket(ticket, input.signal)
        const terminalState = ['removed', 'source_absent'].includes(result.outcome)
          ? 'staging_removed'
          : 'conflict'
        const transaction = db.transaction(() => {
          const current = requireActive(
            active.record.operationId,
            active.record.revision,
            ['staging_cleanup_planned'],
          )
          return terminalize(
            current,
            terminalState,
            normalizeTimestamp(now(), 'Archive journal settlement time'),
            terminalState === 'conflict' ? `cleanup_${result.outcome}` : null,
          )
        })
        return transaction.immediate()
      }

      if (active.record.state === 'quarantine_planned') {
        if (registryArchiveExists(db, active.record.archiveId)) {
          const transaction = db.transaction(() => {
            const current = requireActive(
              active.record.operationId,
              active.record.revision,
              ['quarantine_planned'],
            )
            return terminalize(
              current,
              'conflict',
              normalizeTimestamp(now(), 'Archive journal settlement time'),
              'registry_appeared_during_quarantine',
            )
          })
          return transaction.immediate()
        }
        const ticket = createTicket(
          active,
          'quarantine',
          active.record.finalRelativePath,
          active.record.quarantine.relativePath,
        )
        const result = await executeTicket(ticket, input.signal)
        let terminalState
        let lastErrorCode = null
        if (['moved', 'target_only'].includes(result.outcome)) {
          terminalState = 'quarantined'
        } else if (result.outcome === 'neither_present') {
          terminalState = 'missing'
          lastErrorCode = 'quarantine_neither_present'
        } else {
          terminalState = 'conflict'
          lastErrorCode = `quarantine_${result.outcome}`
        }
        const transaction = db.transaction(() => {
          const current = requireActive(
            active.record.operationId,
            active.record.revision,
            ['quarantine_planned'],
          )
          if (registryArchiveExists(db, current.record.archiveId)) {
            return terminalize(
              current,
              'conflict',
              normalizeTimestamp(now(), 'Archive journal settlement time'),
              'registry_appeared_during_quarantine',
            )
          }
          return terminalize(
            current,
            terminalState,
            normalizeTimestamp(now(), 'Archive journal settlement time'),
            lastErrorCode,
          )
        })
        return transaction.immediate()
      }

      throw new ArchiveCustodyJournalError(
        'ARCHIVE_CUSTODY_JOURNAL_INVALID_STATE',
        'Archive custody journal cannot reconcile its current state.',
      )
    },
  }

  return Object.freeze(api)
}

module.exports = {
  ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY,
  ARCHIVE_CUSTODY_BLOCKING_CONFLICT_KEY,
  ArchiveCustodyJournalError,
  createArchiveCustodyJournal,
}
