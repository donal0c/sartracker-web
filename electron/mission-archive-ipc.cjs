'use strict'

const { createHash, randomUUID: cryptoRandomUUID, timingSafeEqual } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const { generateRecoveryCode: generateArchiveRecoveryCode } = require('./archive-crypto.cjs')

const MISSION_ARCHIVE_PROGRESS_CHANNEL = 'sartracker:mission-archive:progress'
const RECOVERY_ISSUANCE_LIFETIME_MS = 10 * 60_000
const MAX_MISSION_ID_BYTES = 200
const MAX_OPERATION_ID_BYTES = 36
const MAX_ARCHIVE_ID_BYTES = 200
const MAX_PASSPHRASE_BYTES = 1_024
const MAX_MISSION_NAME_BYTES = 1_024
const MAX_MISSION_CONFIRMATION_BYTES = MAX_MISSION_NAME_BYTES
const MAX_CORRECTION_ADMIN_BYTES = 160
const MAX_CORRECTION_REASON_BYTES = 4_000
const MAX_PROGRESS_DETAIL_BYTES = 200
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const RECOVERY_CODE = /^(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/u
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u
const ARCHIVE_OPERATION_KINDS = new Set(['create', 'verify', 'cleanup'])
const ARCHIVE_KINDS = new Set(['direct', 'finalized', 'finalized_recovery'])
const ARCHIVE_STATUSES = new Set(['sealed', 'superseded', 'verified'])
const ARCHIVE_AVAILABILITY = new Set([
  'unknown', 'present', 'missing', 'not_regular', 'mismatched', 'unreadable',
])
const ARCHIVE_SLOT_TYPES = new Set(['machine', 'passphrase', 'recovery'])
const ARCHIVE_ERROR_CODE = /^ARCHIVE_[A-Z0-9_]{1,80}$/u
const ARCHIVE_PROGRESS_PHASES = new Set([
  'preflight', 'snapshot', 'extract', 'attachments', 'digest', 'encrypt', 'sync',
  'keys', 'decrypt', 'entries', 'sqlite', 'inventory', 'gpx', 'replay',
  'plaintext_cleanup', 'staged', 'publish', 'seal', 'proof', 'verified',
  'cleanup',
])
const ARCHIVE_PROGRESS_UNITS = new Set(['bytes', 'files', 'phases', 'rows', 'tables'])
const ARCHIVE_CLEANUP_BLOCKERS = new Set([
  'archive_custody_busy',
  'archive_custody_mismatch',
  'archive_review_active',
  'cleanup_already_completed',
  'cleanup_in_progress',
  'cleanup_journal_invalid',
  'cleanup_membership_changed',
  'current_archive_not_verified',
  'current_finalization_epoch_mismatch',
  'evidence_health_not_clean',
  'finalization_fence_active',
  'fresh_non_machine_unlock_required',
  'mission_not_finalized',
  'operational_state_unsettled',
  'verification_proof_invalid',
])

/** Creates one bounded archive-boundary error without reflecting renderer secrets. */
function archiveIpcError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** Requires an exact record so a direct IPC caller cannot smuggle uncontrolled data. */
function requireExactRecord(input, keys, label) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_INPUT', `${label} is invalid.`)
  }
  const actual = Object.keys(input).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_INPUT', `${label} has missing or unknown fields.`)
  }
}

/** Validates one short UTF-8 identifier without coercion. */
function normalizeIdentifier(value, label, maximumBytes, pattern = null) {
  if (typeof value !== 'string' || value.length < 1
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || CONTROL_CHARACTERS.test(value)
    || (pattern !== null && !pattern.test(value))) {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_INPUT', `${label} is invalid.`)
  }
  return value
}

/** Applies the archive passphrase floor before the secret reaches mission-store code. */
function normalizePassphrase(value) {
  if (typeof value !== 'string' || value.length < 14
    || Buffer.byteLength(value, 'utf8') > MAX_PASSPHRASE_BYTES
    || CONTROL_CHARACTERS.test(value)) {
    throw archiveIpcError(
      'ARCHIVE_IPC_INVALID_INPUT',
      'Archive passphrase must contain at least 14 characters and fit the supported bound.',
    )
  }
  const classes = [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[^A-Za-z0-9]/u]
    .filter((pattern) => pattern.test(value)).length
  if (classes < 3) {
    throw archiveIpcError(
      'ARCHIVE_IPC_INVALID_INPUT',
      'Archive passphrase must combine at least three character classes.',
    )
  }
  return value
}

/** Requires the exact canonical 200-bit per-archive recovery-code rendering. */
function normalizeRecoveryCode(value) {
  if (typeof value !== 'string' || !RECOVERY_CODE.test(value)) {
    throw archiveIpcError(
      'ARCHIVE_IPC_INVALID_INPUT',
      'Archive recovery code must be one exact eight-by-five Crockford code.',
    )
  }
  return value
}

/** Requires one exact bounded mission name for the irreversible operator confirmation. */
function normalizeMissionConfirmation(value) {
  return normalizeIdentifier(
    value,
    'Mission cleanup confirmation',
    MAX_MISSION_CONFIRMATION_BYTES,
  )
}

/** Validates one non-empty correction authority field before it reaches SQLite. */
function normalizeCorrectionAuthority(value, label, maximumBytes) {
  if (typeof value !== 'string'
    || value.trim() === ''
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_INPUT', `${label} is invalid.`)
  }
  return value.trim()
}

/** Hashes a recovery issuance so main retains no plaintext custody secret. */
function hashRecoveryCode(value) {
  return createHash('sha256').update(value, 'utf8').digest()
}

/** Compares one submitted code with the stored issuance digest in constant time. */
function recoveryDigestMatches(expected, value) {
  const actual = hashRecoveryCode(value)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Projects only the terminal mission identity needed by the renderer. */
function projectFinalizedMissionResult(input, expectedMissionId) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || input.id !== expectedMissionId || input.status !== 'finalized') {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_RESULT', 'Mission archive mission result is invalid.')
  }
  return Object.freeze({
    id: expectedMissionId,
    status: 'finalized',
  })
}

/** Projects one successful correction unlock result without exposing extra mission fields. */
function projectUnlockedMissionResult(input, expectedMissionId) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || input.id !== expectedMissionId || input.status !== 'finished') {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_RESULT', 'Mission unlock result is invalid.')
  }
  return Object.freeze({ id: expectedMissionId, status: 'finished' })
}

/** Requires a projected archive to be bound to the exact requesting mission. */
function requireArchiveMissionBinding(archive, expectedMissionId) {
  if (archive.mission_id !== expectedMissionId) {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_RESULT', 'Mission archive result is not request-bound.')
  }
  return archive
}

/** Requires an independently verified archive terminal result. */
function requireVerifiedArchiveBinding(archive, expectedArchiveId, allowSuperseded = false) {
  const statusIsVerified = archive.status === 'verified'
    || (allowSuperseded && archive.status === 'superseded')
  if (archive.id !== expectedArchiveId || !statusIsVerified || archive.verified_at === null) {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_RESULT', 'Mission archive result is not verified.')
  }
  return archive
}

/** Requires the exact encrypted custody semantics promised by operator finalization. */
function requireEncryptedFinalizationArchive(archive) {
  const slotTypes = archive.slots.map((slot) => slot.slotType).toSorted()
  const slotIds = new Set(archive.slots.map((slot) => slot.slotId))
  const finalizationEpochIsCoherent = archive.archive_kind === 'finalized'
    ? archive.protected_finalization_epoch === null
    : archive.archive_kind === 'finalized_recovery'
      && archive.protected_finalization_epoch !== null
  if (archive.container_version !== 2
    || !finalizationEpochIsCoherent
    || !archive.archive_path.endsWith('.sararch')
    || archive.ciphertext_sha256 === null
    || archive.size_bytes === null || archive.size_bytes < 1
    || archive.availability !== 'present'
    || archive.slots.length !== 2 || slotIds.size !== 2
    || slotTypes[0] !== 'passphrase' || slotTypes[1] !== 'recovery') {
    throw archiveIpcError(
      'ARCHIVE_IPC_INVALID_RESULT',
      'Mission archive finalization result is not encrypted and verified.',
    )
  }
  return archive
}

/** Projects one archive row without proof blobs, wrapping material, or unknown fields. */
function projectArchiveResult(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || !ARCHIVE_KINDS.has(input.archive_kind)
    || (input.container_version !== 1 && input.container_version !== 2)
    || !ARCHIVE_STATUSES.has(input.status)
    || !ARCHIVE_AVAILABILITY.has(input.availability)
    || (input.size_bytes !== null
      && (!Number.isSafeInteger(input.size_bytes) || input.size_bytes < 0))
    || (input.protected_finalization_epoch !== null
      && (!Number.isSafeInteger(input.protected_finalization_epoch)
        || input.protected_finalization_epoch < 1))
    || !Array.isArray(input.slots) || input.slots.length > 3
    || !Number.isSafeInteger(input.revision_sequence) || input.revision_sequence < 1
    || !Number.isSafeInteger(input.revision_count)
    || input.revision_count < input.revision_sequence) {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_RESULT', 'Mission archive result is invalid.')
  }
  const sha256 = input.ciphertext_sha256 === null
    ? null
    : normalizeSha256(input.ciphertext_sha256, 'Mission archive ciphertext digest')
  const previousArchiveId = input.previous_archive_id === null
    ? null
    : normalizeIdentifier(
        input.previous_archive_id,
        'Previous mission archive identity',
        MAX_ARCHIVE_ID_BYTES,
      )
  const previousArchiveSha256 = input.previous_archive_sha256 === null
    ? null
    : normalizeSha256(
        input.previous_archive_sha256,
        'Previous mission archive ciphertext digest',
      )
  const supplementAuthority = normalizeNullableText(
    input.supplement_authority,
    'Mission archive supplement authority',
    160,
  )
  const supplementReason = normalizeNullableText(
    input.supplement_reason,
    'Mission archive supplement reason',
    2_000,
    true,
  )
  const supplementCreatedAt = normalizeNullableTimestamp(
    input.supplement_created_at,
    'Mission archive supplement time',
  )
  const isOriginalRevision = input.revision_sequence === 1
  if ((isOriginalRevision && (
    previousArchiveId !== null
    || previousArchiveSha256 !== null
    || supplementAuthority !== null
    || supplementReason !== null
    || supplementCreatedAt !== null
  )) || (!isOriginalRevision && (
    previousArchiveId === null
    || previousArchiveSha256 === null
    || supplementAuthority === null || supplementAuthority.trim() === ''
    || supplementReason === null || supplementReason.trim() === ''
    || supplementCreatedAt === null
  ))) {
    throw archiveIpcError(
      'ARCHIVE_IPC_INVALID_RESULT',
      'Mission archive revision result is invalid.',
    )
  }
  return Object.freeze({
    id: normalizeIdentifier(input.id, 'Mission archive identity', MAX_ARCHIVE_ID_BYTES),
    mission_id: normalizeIdentifier(
      input.mission_id,
      'Mission archive mission identity',
      MAX_MISSION_ID_BYTES,
    ),
    protected_finalization_epoch: input.protected_finalization_epoch,
    archive_kind: input.archive_kind,
    container_version: input.container_version,
    archive_path: normalizeIdentifier(input.archive_path, 'Mission archive path', 4_096),
    ciphertext_sha256: sha256,
    size_bytes: input.size_bytes,
    created_at: normalizeTimestamp(input.created_at, 'Mission archive creation time'),
    verified_at: normalizeNullableTimestamp(input.verified_at, 'Mission archive verification time'),
    previous_archive_id: previousArchiveId,
    previous_archive_sha256: previousArchiveSha256,
    revision_sequence: input.revision_sequence,
    revision_count: input.revision_count,
    supplement_authority: supplementAuthority,
    supplement_reason: supplementReason,
    supplement_created_at: supplementCreatedAt,
    status: input.status,
    availability: input.availability,
    availability_reason: normalizeNullableText(
      input.availability_reason,
      'Mission archive availability reason',
      500,
    ),
    slots: Object.freeze(input.slots.map((slot) => projectArchiveSlot(slot))),
    last_non_machine_unwrap_at: normalizeNullableTimestamp(
      input.last_non_machine_unwrap_at,
      'Mission archive custody access time',
    ),
  })
}

/** Projects one public slot label without returning wrapped-key material. */
function projectArchiveSlot(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || !ARCHIVE_SLOT_TYPES.has(input.slotType)) {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_RESULT', 'Mission archive slot result is invalid.')
  }
  return Object.freeze({
    slotId: normalizeIdentifier(input.slotId, 'Mission archive slot identity', 100),
    slotType: input.slotType,
  })
}

/** Requires a canonical UTC timestamp from trusted archive/store output. */
function normalizeTimestamp(value, label) {
  if (typeof value !== 'string' || value.length > 40
    || new Date(value).toISOString() !== value) {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_RESULT', `${label} is invalid.`)
  }
  return value
}

/** Projects a nullable timestamp without coercion. */
function normalizeNullableTimestamp(value, label) {
  return value === null ? null : normalizeTimestamp(value, label)
}

/** Projects one bounded nullable result string. */
function normalizeNullableText(value, label, maximumBytes, allowLineFormatting = false) {
  if (value === null) return null
  const forbiddenCharacters = allowLineFormatting
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u
    : CONTROL_CHARACTERS
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximumBytes
    || forbiddenCharacters.test(value)) {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_RESULT', `${label} is invalid.`)
  }
  return value
}

/** Requires one lower-case SHA-256 renderer result. */
function normalizeSha256(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_RESULT', `${label} is invalid.`)
  }
  return value
}

/** Replaces store/worker text with one stable non-secret terminal failure. */
function closeArchiveFailure(error, fallbackCode) {
  const code = error?.code === 'EVIDENCE_HEALTH_BLOCKED'
    ? 'ARCHIVE_EVIDENCE_HEALTH_BLOCKED'
    : typeof error?.code === 'string' && ARCHIVE_ERROR_CODE.test(error.code)
      ? error.code
      : fallbackCode
  return archiveIpcError(code, `Mission archive operation failed safely (${code}).`)
}

/** Projects one trusted worker progress update onto the closed renderer surface. */
function normalizeProgress(progress, identity) {
  if (progress === null || typeof progress !== 'object' || Array.isArray(progress)
    || !ARCHIVE_OPERATION_KINDS.has(identity.kind)
    || !ARCHIVE_PROGRESS_PHASES.has(progress.phase)
    || !ARCHIVE_PROGRESS_UNITS.has(progress.unit)
    || !Number.isSafeInteger(progress.sequence) || progress.sequence < 1
    || !Number.isSafeInteger(progress.completed) || progress.completed < 0
    || (progress.total !== null && (!Number.isSafeInteger(progress.total)
      || progress.total < progress.completed))
    || typeof progress.detail !== 'string'
    || Buffer.byteLength(progress.detail, 'utf8') > MAX_PROGRESS_DETAIL_BYTES
    || CONTROL_CHARACTERS.test(progress.detail)) {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_PROGRESS', 'Mission archive progress is invalid.')
  }
  return Object.freeze({
    operationId: identity.operationId,
    missionId: identity.missionId,
    kind: identity.kind,
    sequence: progress.sequence,
    phase: progress.phase,
    unit: progress.unit,
    completed: progress.completed,
    total: progress.total,
    detail: progress.detail,
  })
}

/** Delivers non-authoritative progress without letting renderer teardown change durable work. */
function sendArchiveProgressBestEffort(sender, projectProgress) {
  try {
    if (sender?.isDestroyed?.() === true) return
    sender.send(MISSION_ARCHIVE_PROGRESS_CHANNEL, projectProgress())
  } catch {}
}

/** Projects the current fail-closed cleanup checklist without trusting unknown store fields. */
function projectCleanupEligibility(input) {
  const blockers = Array.isArray(input?.blockers) ? input.blockers : []
  const cleanupInProgress = blockers.includes('cleanup_in_progress')
  const cleanupJournalInvalid = blockers.includes('cleanup_journal_invalid')
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || typeof input.eligible !== 'boolean'
    || !['live', 'cleanup_in_progress', 'archived'].includes(input.storageState)
    || !Array.isArray(input.blockers)
    || input.blockers.length > ARCHIVE_CLEANUP_BLOCKERS.size
    || input.blockers.some((blocker) => !ARCHIVE_CLEANUP_BLOCKERS.has(blocker))
    || new Set(input.blockers).size !== input.blockers.length
    || (input.eligible && input.blockers.length !== 0)
    || (!input.eligible && input.blockers.length === 0)
    || (input.storageState === 'archived'
      && (input.eligible || !input.blockers.includes('cleanup_already_completed')))
    || (input.storageState === 'cleanup_in_progress'
      && (input.eligible || cleanupInProgress === cleanupJournalInvalid))
    || (input.storageState !== 'cleanup_in_progress'
      && (cleanupInProgress || cleanupJournalInvalid))
    || (input.eligible && input.storageState !== 'live')) {
    throw archiveIpcError(
      'ARCHIVE_IPC_INVALID_RESULT',
      'Mission cleanup eligibility result is invalid.',
    )
  }
  const startableWithCredential = input.storageState === 'live'
    && input.eligible === false
    && input.blockers.length === 1
    && input.blockers[0] === 'fresh_non_machine_unlock_required'
  return Object.freeze({
    eligible: input.eligible,
    startableWithCredential,
    blockers: Object.freeze([...input.blockers]),
    storageState: input.storageState,
  })
}

/** Requires the selected mission's exact persisted name without exposing other mission data. */
function requireCleanupMissionConfirmation(input, expectedMissionId, confirmation) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || input.id !== expectedMissionId) {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_RESULT', 'Mission cleanup mission result is invalid.')
  }
  const missionName = normalizeMissionConfirmation(input.name)
  if (missionName !== confirmation) {
    throw archiveIpcError(
      'ARCHIVE_CLEANUP_CONFIRMATION_MISMATCH',
      'Mission cleanup confirmation did not match the selected mission name.',
    )
  }
}

/** Converts one internal bounded-delete update into the common renderer progress envelope. */
function normalizeCleanupProgress(progress, identity, sequence) {
  if (progress === null || typeof progress !== 'object' || Array.isArray(progress)
    || progress.kind !== 'cleanup' || progress.phase !== 'cleanup'
    || progress.missionId !== identity.missionId
    || progress.archiveId !== identity.archiveId
    || typeof progress.tableName !== 'string'
    || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(progress.tableName)
    || Buffer.byteLength(progress.tableName, 'utf8') > 100
    || !Number.isSafeInteger(progress.deletedRows) || progress.deletedRows < 1
    || !Number.isSafeInteger(progress.totalDeletedRows)
    || progress.totalDeletedRows < progress.deletedRows
    || !Number.isSafeInteger(progress.tableIndex) || progress.tableIndex < 0
    || !Number.isSafeInteger(progress.tableCount) || progress.tableCount < 1
    || progress.tableIndex > progress.tableCount) {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_PROGRESS', 'Mission cleanup progress is invalid.')
  }
  return normalizeProgress({
    sequence,
    phase: 'cleanup',
    unit: 'rows',
    completed: progress.totalDeletedRows,
    total: null,
    detail: `Moved live rows: ${progress.tableName}`,
  }, {
    operationId: identity.operationId,
    missionId: identity.missionId,
    kind: 'cleanup',
  })
}

/** Projects only the terminal archived-state acknowledgement needed by the renderer. */
function projectCleanupResult(input, identity) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || input.missionId !== identity.missionId
    || input.archiveId !== identity.archiveId
    || input.state !== 'completed'
    || input.storageState !== 'archived'
    || !Number.isSafeInteger(input.deletedRows) || input.deletedRows < 0) {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_RESULT', 'Mission cleanup result is invalid.')
  }
  return Object.freeze({
    missionId: identity.missionId,
    archiveId: identity.archiveId,
    state: 'completed',
    storageState: 'archived',
    movedRows: input.deletedRows,
  })
}

/**
 * Registers explicit sender-owned archive IPC. No secret-bearing operation is
 * exposed through the mission store's generic variadic handler.
 */
function registerMissionArchiveIpcHandlers(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || typeof input.ipcMain?.handle !== 'function'
    || typeof input.validateIpcSender !== 'function'
    || typeof input.archiveReviewSessionManager?.hasReviewActivity !== 'function'
    || typeof input.archiveReviewSessionManager?.acquireCleanupLease !== 'function'
    || (input.removeCorrectionSnapshot !== undefined
      && typeof input.removeCorrectionSnapshot !== 'function')) {
    throw new TypeError('Mission archive IPC registration is invalid.')
  }
  const channels = input.channels
  const missionStore = input.missionStore
  const generateRecoveryCode = input.generateRecoveryCode ?? generateArchiveRecoveryCode
  const randomUUID = input.randomUUID ?? cryptoRandomUUID
  const nowMs = input.nowMs ?? Date.now
  const removeCorrectionSnapshot = input.removeCorrectionSnapshot ?? (
    (directory) => fs.rm(directory, { recursive: true, force: true })
  )
  const issuances = input.issuanceLedger ?? new Map()
  if (!(issuances instanceof Map)) {
    throw new TypeError('Mission archive recovery issuance ledger is invalid.')
  }
  const activeOperations = new Map()
  const observedSenders = new Set()

  /** Drops expired issuances without retaining their digests past the UI flow. */
  const sweepExpiredIssuances = () => {
    const observedAt = nowMs()
    for (const [operationId, issuance] of issuances) {
      if (issuance.expiresAtMs <= observedAt) issuances.delete(operationId)
    }
  }

  /** Binds cleanup/cancellation to one renderer process lifetime. */
  const observeSender = (sender) => {
    const senderId = senderIdentity(sender)
    if (observedSenders.has(senderId) || typeof sender.once !== 'function') return senderId
    observedSenders.add(senderId)
    sender.once('destroyed', () => {
      observedSenders.delete(senderId)
      for (const [operationId, issuance] of issuances) {
        if (issuance.senderId === senderId) issuances.delete(operationId)
      }
      for (const [operationId, operation] of activeOperations) {
        if (operation.senderId !== senderId) continue
        activeOperations.delete(operationId)
        try { operation.cancel?.() } catch {}
        void Promise.resolve(missionStore.cancelMissionArchiveOperation(operationId))
          .catch(() => undefined)
      }
    })
    return senderId
  }

  input.ipcMain.handle(channels.issueMissionArchiveRecoveryCode, (event, missionId) => {
    input.validateIpcSender(event)
    const senderId = observeSender(event.sender)
    const normalizedMissionId = normalizeIdentifier(
      missionId,
      'Mission archive mission identity',
      MAX_MISSION_ID_BYTES,
    )
    sweepExpiredIssuances()
    let operationId
    do {
      operationId = normalizeIdentifier(
        randomUUID(),
        'Mission archive operation identity',
        MAX_OPERATION_ID_BYTES,
        UUID_V4,
      )
    } while (issuances.has(operationId) || activeOperations.has(operationId))
    const recoveryCode = normalizeRecoveryCode(generateRecoveryCode())
    const expiresAtMs = nowMs() + RECOVERY_ISSUANCE_LIFETIME_MS
    for (const [priorOperationId, prior] of issuances) {
      if (prior.senderId === senderId && prior.missionId === normalizedMissionId) {
        issuances.delete(priorOperationId)
      }
    }
    issuances.set(operationId, Object.freeze({
      senderId,
      missionId: normalizedMissionId,
      recoveryCodeDigest: hashRecoveryCode(recoveryCode),
      expiresAtMs,
    }))
    return Object.freeze({
      operationId,
      recoveryCode,
      expiresAt: new Date(expiresAtMs).toISOString(),
    })
  })

  input.ipcMain.handle(channels.finalizeMission, async (event, request) => {
    input.validateIpcSender(event)
    const senderId = observeSender(event.sender)
    requireExactRecord(
      request,
      ['missionId', 'operationId', 'passphrase', 'recoveryCode'],
      'Mission archive finalization request',
    )
    const operationId = normalizeIdentifier(
      request.operationId,
      'Mission archive operation identity',
      MAX_OPERATION_ID_BYTES,
      UUID_V4,
    )
    sweepExpiredIssuances()
    const issuance = issuances.get(operationId)
    if (issuance === undefined || issuance.senderId !== senderId) {
      throw archiveIpcError(
        'ARCHIVE_RECOVERY_ISSUANCE_INVALID',
        'The per-archive recovery-code confirmation is no longer valid. Generate and confirm a new code.',
      )
    }
    // A renderer that owns an issuance gets one confirmation attempt. Cross-renderer
    // probes cannot consume it, but a wrong mission/code can never be retried as an oracle.
    issuances.delete(operationId)
    const missionId = normalizeIdentifier(
      request.missionId,
      'Mission archive mission identity',
      MAX_MISSION_ID_BYTES,
    )
    const passphrase = normalizePassphrase(request.passphrase)
    const recoveryCode = normalizeRecoveryCode(request.recoveryCode)
    if (issuance.missionId !== missionId
      || issuance.expiresAtMs <= nowMs()
      || !recoveryDigestMatches(issuance.recoveryCodeDigest, recoveryCode)) {
      throw archiveIpcError(
        'ARCHIVE_RECOVERY_ISSUANCE_INVALID',
        'The per-archive recovery-code confirmation is no longer valid. Generate and confirm a new code.',
      )
    }
    if (activeOperations.has(operationId)) {
      throw archiveIpcError('ARCHIVE_OPERATION_ACTIVE', 'Mission archive operation is already active.')
    }
    activeOperations.set(operationId, Object.freeze({ senderId, missionId, kind: 'create' }))
    try {
      const result = await missionStore.finalizeMission(
        missionId,
        { passphrase, recoveryCode },
        {
          operationId,
          onProgress: (progress) => {
            sendArchiveProgressBestEffort(event.sender, () => normalizeProgress(progress, {
              operationId,
              missionId,
              kind: progress?.kind,
            }))
          },
        },
      )
      if (result === null || typeof result !== 'object' || Array.isArray(result)) {
        throw archiveIpcError('ARCHIVE_IPC_INVALID_RESULT', 'Mission archive result is invalid.')
      }
      const archive = requireEncryptedFinalizationArchive(
        requireArchiveMissionBinding(projectArchiveResult(result.archive), missionId),
      )
      requireVerifiedArchiveBinding(archive, archive.id)
      return Object.freeze({
        mission: projectFinalizedMissionResult(result.mission, missionId),
        archive,
      })
    } catch (error) {
      throw closeArchiveFailure(error, 'ARCHIVE_CREATE_FAILED')
    } finally {
      activeOperations.delete(operationId)
    }
  })

  input.ipcMain.handle(channels.unlockFinalizedMission, async (event, request) => {
    input.validateIpcSender(event)
    requireExactRecord(
      request,
      ['mission_id', 'admin_name', 'reason'],
      'Mission correction unlock request',
    )
    const missionId = normalizeIdentifier(
      request.mission_id,
      'Mission correction mission identity',
      MAX_MISSION_ID_BYTES,
    )
    const adminName = normalizeCorrectionAuthority(
      request.admin_name,
      'Mission correction authority',
      MAX_CORRECTION_ADMIN_BYTES,
    )
    const reason = normalizeCorrectionAuthority(
      request.reason,
      'Mission correction reason',
      MAX_CORRECTION_REASON_BYTES,
    )
    try {
      const result = await missionStore.unlockFinalizedMission({
        mission_id: missionId,
        admin_name: adminName,
        reason,
      })
      return projectUnlockedMissionResult(result, missionId)
    } catch (error) {
      throw closeArchiveFailure(error, 'ARCHIVE_UNLOCK_FAILED')
    }
  })

  input.ipcMain.handle(channels.restoreMissionForCorrection, async (event, request) => {
    input.validateIpcSender(event)
    const senderId = observeSender(event.sender)
    requireExactRecord(
      request,
      ['admin_name', 'archiveId', 'mission_id', 'operationId', 'reason', 'sessionId'],
      'Mission archive correction restore request',
    )
    const missionId = normalizeIdentifier(
      request.mission_id,
      'Mission correction mission identity',
      MAX_MISSION_ID_BYTES,
    )
    const archiveId = normalizeIdentifier(
      request.archiveId,
      'Mission correction archive identity',
      MAX_ARCHIVE_ID_BYTES,
    )
    const operationId = normalizeIdentifier(
      request.operationId,
      'Mission correction operation identity',
      MAX_OPERATION_ID_BYTES,
      UUID_V4,
    )
    const sessionId = normalizeIdentifier(
      request.sessionId,
      'Mission correction session identity',
      MAX_OPERATION_ID_BYTES,
      UUID_V4,
    )
    const adminName = normalizeCorrectionAuthority(
      request.admin_name,
      'Mission correction authority',
      MAX_CORRECTION_ADMIN_BYTES,
    )
    const reason = normalizeCorrectionAuthority(
      request.reason,
      'Mission correction reason',
      MAX_CORRECTION_REASON_BYTES,
    )
    if (issuances.has(operationId) || activeOperations.has(operationId)) {
      throw archiveIpcError(
        'ARCHIVE_OPERATION_ID_CONFLICT',
        'Mission archive correction operation identity is already in use.',
      )
    }
    const controller = new AbortController()
    activeOperations.set(operationId, Object.freeze({
      senderId,
      missionId,
      kind: 'correction',
      cancel: () => controller.abort(),
    }))
    let snapshot = null
    let result = null
    let operationFailure = null
    try {
      if (typeof input.archiveReviewSessionManager.snapshotForCorrection !== 'function') {
        throw archiveIpcError(
          'ARCHIVE_REHYDRATE_UNAVAILABLE',
          'Archive correction restore is unavailable in this runtime.',
        )
      }
      snapshot = await input.archiveReviewSessionManager.snapshotForCorrection({
        senderId,
        sessionId,
        operationId,
        archiveId,
        signal: controller.signal,
      })
      result = await missionStore.unlockFinalizedMission({
        mission_id: missionId,
        archive_id: snapshot.archiveId,
        operation_id: operationId,
        snapshot_path: snapshot.snapshotPath,
        snapshot_database_identity: snapshot.databaseIdentity,
        snapshot_database_sha256: snapshot.databaseSha256,
        ...(snapshot.attachmentDirectory === undefined
          ? {}
          : { attachment_directory: snapshot.attachmentDirectory }),
        ...(snapshot.attachmentMappings === undefined
          ? {}
          : { attachment_mappings: snapshot.attachmentMappings }),
        signal: controller.signal,
        admin_name: adminName,
        reason,
      })
    } catch (error) {
      operationFailure = error
    }
    activeOperations.delete(operationId)
    let committedCorrectionFailure = false
    if (operationFailure !== null) {
      try {
        const committedMission = await missionStore.getMission(missionId)
        committedCorrectionFailure = committedMission?.status === 'finished'
          && ['live', 'recovery_required'].includes(committedMission?.storage_state)
        if (committedCorrectionFailure) result = committedMission
      } catch {
        committedCorrectionFailure = false
      }
      if (!committedCorrectionFailure) throw operationFailure
    }
    if (snapshot !== null) {
      try {
        if (typeof input.archiveReviewSessionManager.completeCorrectionSnapshot === 'function') {
          await input.archiveReviewSessionManager.completeCorrectionSnapshot({
            senderId,
            sessionId,
            operationId,
            archiveId,
          })
        } else {
          await removeCorrectionSnapshot(path.dirname(snapshot.snapshotPath))
        }
      } catch (error) {
        const failure = archiveIpcError(
          'ARCHIVE_REHYDRATE_CLEANUP_FAILED',
          'Mission archive correction restore completed with unresolved plaintext cleanup.',
        )
        // Electron serializes thrown errors without custom properties. Return
        // a shape-closed status envelope so the renderer can distinguish a
        // committed correction from a pre-commit failure across the real IPC
        // boundary and retain the correct recovery path.
        if (result !== null) {
          return Object.freeze({
            ...projectUnlockedMissionResult(result, missionId),
            correction: Object.freeze({
              committed: true,
              cleanupComplete: false,
              failureCode: committedCorrectionFailure
                ? (operationFailure?.code ?? failure.code)
                : failure.code,
            }),
          })
        }
        failure.cause = error
        throw failure
      }
    }
    if (committedCorrectionFailure) {
      const custodyRecoveryRequired = result?.storage_state === 'recovery_required'
      return Object.freeze({
        ...projectUnlockedMissionResult(result, missionId),
        correction: Object.freeze({
          committed: true,
          // The correction snapshot/session has been swept successfully. The
          // separate failure code records only a durable attachment-custody
          // fence; a clean live result is a successful correction despite the
          // worker's terminal exit status.
          cleanupComplete: true,
          ...(custodyRecoveryRequired
            ? { failureCode: operationFailure?.code ?? 'ARCHIVE_REHYDRATE_FAILED' }
            : {}),
        }),
      })
    }
    return Object.freeze({
      ...projectUnlockedMissionResult(result, missionId),
      correction: Object.freeze({
        committed: true,
        cleanupComplete: true,
      }),
    })
  })

  input.ipcMain.handle(channels.listMissionArchives, async (event, missionId) => {
    input.validateIpcSender(event)
    try {
      const normalizedMissionId = normalizeIdentifier(
        missionId,
        'Mission archive mission identity',
        MAX_MISSION_ID_BYTES,
      )
      const result = await missionStore.listMissionArchives(normalizedMissionId)
      if (!Array.isArray(result) || result.length > 10_000) {
        throw archiveIpcError('ARCHIVE_IPC_INVALID_RESULT', 'Mission archive list result is invalid.')
      }
      return Object.freeze(result.map((archive) => requireArchiveMissionBinding(
        projectArchiveResult(archive),
        normalizedMissionId,
      )))
    } catch (error) {
      throw closeArchiveFailure(error, 'ARCHIVE_LIST_FAILED')
    }
  })

  input.ipcMain.handle(channels.verifyMissionArchive, async (event, request) => {
    input.validateIpcSender(event)
    const senderId = observeSender(event.sender)
    requireExactRecord(
      request,
      ['archiveId', 'operationId', 'passphrase', 'recoveryCode'],
      'Mission archive verification request',
    )
    const archiveId = normalizeIdentifier(
      request.archiveId,
      'Mission archive identity',
      MAX_ARCHIVE_ID_BYTES,
    )
    const operationId = normalizeIdentifier(
      request.operationId,
      'Mission archive operation identity',
      MAX_OPERATION_ID_BYTES,
      UUID_V4,
    )
    const passphrase = normalizePassphrase(request.passphrase)
    const recoveryCode = normalizeRecoveryCode(request.recoveryCode)
    sweepExpiredIssuances()
    if (issuances.has(operationId)) {
      throw archiveIpcError(
        'ARCHIVE_OPERATION_ID_CONFLICT',
        'Mission archive operation identity conflicts with an issued custody code.',
      )
    }
    if (activeOperations.has(operationId)) {
      throw archiveIpcError('ARCHIVE_OPERATION_ACTIVE', 'Mission archive operation is already active.')
    }
    activeOperations.set(operationId, Object.freeze({
      senderId, missionId: '', kind: 'verify',
    }))
    try {
      const result = await missionStore.verifyMissionArchive(
        { archiveId, passphrase, recoveryCode },
        {
          operationId,
          onProgress: (progress) => {
            sendArchiveProgressBestEffort(event.sender, () => normalizeProgress(
              progress,
              { operationId, missionId: '', kind: 'verify' },
            ))
          },
        },
      )
      return requireVerifiedArchiveBinding(
        projectArchiveResult(result),
        archiveId,
        true,
      )
    } catch (error) {
      throw closeArchiveFailure(error, 'ARCHIVE_VERIFY_FAILED')
    } finally {
      activeOperations.delete(operationId)
    }
  })

  input.ipcMain.handle(channels.getMissionCleanupEligibility, async (event, request) => {
    input.validateIpcSender(event)
    requireExactRecord(
      request,
      ['archiveId', 'missionId'],
      'Mission cleanup eligibility request',
    )
    const missionId = normalizeIdentifier(
      request.missionId,
      'Mission cleanup mission identity',
      MAX_MISSION_ID_BYTES,
    )
    const archiveId = normalizeIdentifier(
      request.archiveId,
      'Mission cleanup archive identity',
      MAX_ARCHIVE_ID_BYTES,
    )
    try {
      const result = await missionStore.getMissionCleanupEligibility(
        { missionId, archiveId },
        { reviewActivity: input.archiveReviewSessionManager.hasReviewActivity() },
      )
      return projectCleanupEligibility(result)
    } catch (error) {
      throw closeArchiveFailure(error, 'ARCHIVE_CLEANUP_ELIGIBILITY_FAILED')
    }
  })

  input.ipcMain.handle(channels.startMissionCleanup, async (event, request) => {
    input.validateIpcSender(event)
    const senderId = observeSender(event.sender)
    requireExactRecord(
      request,
      ['archiveId', 'confirmation', 'missionId', 'operationId', 'secret', 'slotType'],
      'Mission cleanup request',
    )
    const missionId = normalizeIdentifier(
      request.missionId,
      'Mission cleanup mission identity',
      MAX_MISSION_ID_BYTES,
    )
    const archiveId = normalizeIdentifier(
      request.archiveId,
      'Mission cleanup archive identity',
      MAX_ARCHIVE_ID_BYTES,
    )
    const operationId = normalizeIdentifier(
      request.operationId,
      'Mission cleanup operation identity',
      MAX_OPERATION_ID_BYTES,
      UUID_V4,
    )
    const confirmation = normalizeMissionConfirmation(request.confirmation)
    if (!['passphrase', 'recovery'].includes(request.slotType)) {
      throw archiveIpcError('ARCHIVE_IPC_INVALID_INPUT', 'Mission cleanup credential type is invalid.')
    }
    let secret = request.slotType === 'passphrase'
      ? normalizePassphrase(request.secret)
      : normalizeRecoveryCode(request.secret)
    try { request.secret = '' } catch {}
    sweepExpiredIssuances()
    if (issuances.has(operationId)) {
      throw archiveIpcError(
        'ARCHIVE_OPERATION_ID_CONFLICT',
        'Mission cleanup operation identity conflicts with an issued custody code.',
      )
    }
    if (activeOperations.has(operationId)) {
      throw archiveIpcError('ARCHIVE_OPERATION_ACTIVE', 'Mission archive operation is already active.')
    }
    let cleanupLease = null
    try {
      const mission = await missionStore.getMission(missionId)
      requireCleanupMissionConfirmation(mission, missionId, confirmation)
      if (event.sender?.isDestroyed?.() === true) {
        throw archiveIpcError(
          'ARCHIVE_CLEANUP_RENDERER_CLOSED',
          'Mission cleanup was not started because its renderer closed.',
        )
      }
      cleanupLease = input.archiveReviewSessionManager.acquireCleanupLease(missionId)
      activeOperations.set(operationId, Object.freeze({ senderId, missionId, kind: 'cleanup' }))
      let cleanupSequence = 0
      let cleanupOperation
      try {
        cleanupOperation = missionStore.startMissionCleanup(
          { missionId, archiveId, slotType: request.slotType, secret },
          {
            operationId,
            reviewActivity: false,
            onProgress: (progress) => {
              cleanupSequence += 1
              sendArchiveProgressBestEffort(event.sender, () => normalizeCleanupProgress(
                progress,
                { operationId, missionId, archiveId },
                cleanupSequence,
              ))
            },
          },
        )
      } finally {
        secret = ''
        try { request.secret = '' } catch {}
      }
      const result = await cleanupOperation
      return projectCleanupResult(result, { missionId, archiveId })
    } catch (error) {
      throw closeArchiveFailure(error, 'ARCHIVE_CLEANUP_FAILED')
    } finally {
      secret = ''
      try { request.secret = '' } catch {}
      activeOperations.delete(operationId)
      cleanupLease?.release()
    }
  })

  input.ipcMain.handle(channels.resumeMissionCleanup, async (event, request) => {
    input.validateIpcSender(event)
    const senderId = observeSender(event.sender)
    requireExactRecord(
      request,
      ['archiveId', 'missionId', 'operationId'],
      'Mission cleanup resume request',
    )
    const missionId = normalizeIdentifier(
      request.missionId,
      'Mission cleanup mission identity',
      MAX_MISSION_ID_BYTES,
    )
    const archiveId = normalizeIdentifier(
      request.archiveId,
      'Mission cleanup archive identity',
      MAX_ARCHIVE_ID_BYTES,
    )
    const operationId = normalizeIdentifier(
      request.operationId,
      'Mission cleanup operation identity',
      MAX_OPERATION_ID_BYTES,
      UUID_V4,
    )
    sweepExpiredIssuances()
    if (issuances.has(operationId) || activeOperations.has(operationId)) {
      throw archiveIpcError(
        'ARCHIVE_OPERATION_ID_CONFLICT',
        'Mission cleanup recovery operation identity is already in use.',
      )
    }
    let cleanupLease = null
    try {
      const mission = await missionStore.getMission(missionId)
      if (event.sender?.isDestroyed?.() === true) {
        throw archiveIpcError(
          'ARCHIVE_CLEANUP_RENDERER_CLOSED',
          'Mission cleanup recovery was not started because its renderer closed.',
        )
      }
      cleanupLease = input.archiveReviewSessionManager.acquireCleanupLease(missionId)
      activeOperations.set(operationId, Object.freeze({ senderId, missionId, kind: 'cleanup' }))
      let cleanupSequence = 0
      const cleanupOperation = missionStore.resumeMissionCleanup(
        { missionId, archiveId },
        {
          operationId,
          reviewActivity: false,
          onProgress: (progress) => {
            cleanupSequence += 1
            sendArchiveProgressBestEffort(event.sender, () => normalizeCleanupProgress(
              progress,
              { operationId, missionId, archiveId },
              cleanupSequence,
            ))
          },
        },
      )
      const result = await cleanupOperation
      return projectCleanupResult(result, { missionId, archiveId })
    } catch (error) {
      throw closeArchiveFailure(error, 'ARCHIVE_CLEANUP_FAILED')
    } finally {
      activeOperations.delete(operationId)
      cleanupLease?.release()
    }
  })

  input.ipcMain.handle(channels.cancelMissionArchiveOperation, async (event, operationId) => {
    input.validateIpcSender(event)
    const senderId = observeSender(event.sender)
    const normalizedOperationId = normalizeIdentifier(
      operationId,
      'Mission archive operation identity',
      MAX_OPERATION_ID_BYTES,
      UUID_V4,
    )
    sweepExpiredIssuances()
    const issuance = issuances.get(normalizedOperationId)
    let invalidatedIssuance = false
    if (issuance?.senderId === senderId) {
      issuances.delete(normalizedOperationId)
      invalidatedIssuance = true
    }
    const active = activeOperations.get(normalizedOperationId)
    if (active?.senderId !== senderId) return invalidatedIssuance
    try {
      try { active.cancel?.() } catch {}
      const cancelledActive = await missionStore.cancelMissionArchiveOperation(
        normalizedOperationId,
      ) === true
      return invalidatedIssuance || cancelledActive || typeof active.cancel === 'function'
    } catch (error) {
      throw closeArchiveFailure(error, 'ARCHIVE_CANCEL_FAILED')
    }
  })
}

/** Reads an Electron sender identity without accepting a renderer-controlled fallback. */
function senderIdentity(sender) {
  if (sender === null || typeof sender !== 'object'
    || !Number.isSafeInteger(sender.id) || sender.id < 0
    || typeof sender.send !== 'function') {
    throw archiveIpcError('ARCHIVE_IPC_INVALID_SENDER', 'Mission archive renderer identity is invalid.')
  }
  return sender.id
}

module.exports = {
  MISSION_ARCHIVE_PROGRESS_CHANNEL,
  projectArchiveResult,
  registerMissionArchiveIpcHandlers,
}
