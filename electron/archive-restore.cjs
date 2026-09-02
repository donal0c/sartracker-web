'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const Database = require('better-sqlite3')
const { normalizeArchiveVerificationIdentity } = require('./archive-envelope.cjs')
const {
  normalizeRecoveryCode,
  unwrapMissionArchiveKey,
  zeroBuffer,
} = require('./archive-crypto.cjs')
const { canonicalJson, parseCanonicalJson } = require('./archive-container.cjs')
const { assertPinnedCustodyFileUnchanged } = require('./archive-custody-file.cjs')
const {
  digestPinnedArchive,
  extractAndProveEntries,
  getRestoredDatabaseIdentity,
  openPinnedArchive,
  readPinnedPreamble,
  streamPinnedArchive,
  settleExtractedOutputs,
  validateBoundHeader,
} = require('./archive-verify.cjs')

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PROGRESS_EMIT_BYTES = 16 * 1024 * 1024

/** Stable non-reflective archive restore failure. */
class ArchiveRestoreError extends Error {
  /** Creates a typed restore failure. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveRestoreError'
    this.code = code
  }
}

/** Requires one canonical existing-or-creatable app-owned absolute directory. */
function normalizeAbsoluteDirectory(value, label) {
  if (typeof value !== 'string'
    || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 8_192
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.resolve(value) !== value) {
    throw new ArchiveRestoreError('ARCHIVE_RESTORE_REQUEST_INVALID', `${label} is invalid.`)
  }
  return value
}

/** Validates one trusted non-secret restore request. */
function normalizeRestoreRequest(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ArchiveRestoreError(
      'ARCHIVE_RESTORE_REQUEST_INVALID',
      'Archive restore request is invalid.',
    )
  }
  const keys = Object.keys(input).sort()
  const exact = [
    'archiveDirectory',
    'archiveId',
    'archiveKind',
    'archiveRelativePath',
    'ciphertextSha256',
    'containerVersion',
    'createdAt',
    'creationOperationId',
    'entryCount',
    'frameCount',
    'headerSha256',
    'inventoryVersion',
    'manifestSha256',
    'missionId',
    'operationId',
    'previousArchiveSha256',
    'protectedFinalizationEpoch',
    'requestEventId',
    'requestEventRowid',
    'reviewRoot',
    'schemaVersion',
    'sessionId',
    'sizeBytes',
    'slotType',
    'tableCount',
  ].sort()
  if (keys.length !== exact.length || keys.some((key, index) => key !== exact[index])) {
    throw new ArchiveRestoreError(
      'ARCHIVE_RESTORE_REQUEST_INVALID',
      'Archive restore request has missing or unsupported fields.',
    )
  }
  let identity
  try {
    identity = normalizeArchiveVerificationIdentity({
      archiveId: input.archiveId,
      archiveKind: input.archiveKind,
      archiveRelativePath: input.archiveRelativePath,
      ciphertextSha256: input.ciphertextSha256,
      containerVersion: input.containerVersion,
      createdAt: input.createdAt,
      creationOperationId: input.creationOperationId,
      entryCount: input.entryCount,
      frameCount: input.frameCount,
      headerSha256: input.headerSha256,
      inventoryVersion: input.inventoryVersion,
      manifestSha256: input.manifestSha256,
      missionId: input.missionId,
      previousArchiveSha256: input.previousArchiveSha256,
      protectedFinalizationEpoch: input.protectedFinalizationEpoch,
      requestEventId: input.requestEventId,
      requestEventRowid: input.requestEventRowid,
      schemaVersion: input.schemaVersion,
      sizeBytes: input.sizeBytes,
      tableCount: input.tableCount,
    })
  } catch {
    throw new ArchiveRestoreError(
      'ARCHIVE_RESTORE_REQUEST_INVALID',
      'Archive restore trusted identity is invalid.',
    )
  }
  if (!UUID_V4.test(input.operationId) || !UUID_V4.test(input.sessionId)
    || !['passphrase', 'recovery'].includes(input.slotType)) {
    throw new ArchiveRestoreError(
      'ARCHIVE_RESTORE_REQUEST_INVALID',
      'Archive restore operation, session, or slot identity is invalid.',
    )
  }
  const archiveDirectory = normalizeAbsoluteDirectory(input.archiveDirectory, 'Archive directory')
  const reviewRoot = normalizeAbsoluteDirectory(input.reviewRoot, 'Archive review root')
  if (reviewRoot === archiveDirectory || reviewRoot.startsWith(`${archiveDirectory}${path.sep}`)) {
    throw new ArchiveRestoreError(
      'ARCHIVE_RESTORE_REQUEST_INVALID',
      'Archive review plaintext must use its separate fixed session root.',
    )
  }
  return Object.freeze({
    ...identity,
    archiveDirectory,
    reviewRoot,
    operationId: input.operationId,
    sessionId: input.sessionId,
    slotType: input.slotType,
  })
}

/** Throws at each bounded restore boundary after cancellation. */
function assertNotCancelled(cancellationFlag) {
  if (!(cancellationFlag instanceof Int32Array) || cancellationFlag.length !== 1) {
    throw new ArchiveRestoreError(
      'ARCHIVE_RESTORE_REQUEST_INVALID',
      'Archive restore cancellation state is invalid.',
    )
  }
  if (Atomics.load(cancellationFlag, 0) !== 0) {
    throw new ArchiveRestoreError('ARCHIVE_CANCELLED', 'Archive review restore was cancelled.')
  }
}

/** Opens an owner-only fixed review root without accepting a symlink. */
function ensureReviewRoot(reviewRoot) {
  fs.mkdirSync(reviewRoot, { recursive: true, mode: 0o700 })
  const stat = fs.lstatSync(reviewRoot)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ArchiveRestoreError(
      'ARCHIVE_RESTORE_SCOPE_INVALID',
      'Archive review root is unsafe.',
    )
  }
  fs.chmodSync(reviewRoot, 0o700)
}

/** Creates the exact owner-only session directory after credential authentication. */
function createSessionDirectory(request) {
  ensureReviewRoot(request.reviewRoot)
  const sessionDirectory = path.join(request.reviewRoot, request.sessionId)
  fs.mkdirSync(sessionDirectory, { recursive: false, mode: 0o700 })
  fs.chmodSync(sessionDirectory, 0o700)
  return sessionDirectory
}

/** Requires conservative scratch capacity before writing plaintext. */
function assertRestoreCapacity(request) {
  const requiredBytes = Math.max(
    64 * 1024 * 1024,
    Math.ceil(request.sizeBytes * 1.2) + 16 * 1024 * 1024,
  )
  const capacity = fs.statfsSync(request.reviewRoot)
  const availableBytes = Number(BigInt(capacity.bavail) * BigInt(capacity.bsize))
  if (!Number.isSafeInteger(availableBytes) || availableBytes < requiredBytes) {
    throw new ArchiveRestoreError(
      'ARCHIVE_RESTORE_DISK_FULL',
      'Archive review storage has insufficient free space.',
    )
  }
}

/** Authenticates exactly the requested non-machine slot. */
async function unwrapReviewSlot(preamble, request, secretBytes) {
  const slots = validateBoundHeader(preamble, request)
  const slot = request.slotType === 'passphrase'
    ? slots.passphraseSlot
    : slots.recoverySlot
  try {
    const secret = request.slotType === 'recovery'
      ? normalizeRecoveryCode(secretBytes.toString('utf8'))
      : secretBytes
    return await unwrapMissionArchiveKey({
      slot,
      secret,
      headerDigest: preamble.headerDigest,
    })
  } catch {
    throw new ArchiveRestoreError(
      'ARCHIVE_RESTORE_WRONG_KEY',
      'Archive review credential is incorrect.',
    )
  }
}

/** Checks restored SQLite scope and returns bounded internal attachment mappings. */
function inspectRestoredSession(request, sessionDirectory, extracted, databaseSizeBytes, emit) {
  const databasePath = path.join(sessionDirectory, 'mission-store.sqlite')
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    database.pragma('query_only = ON')
    emit('validate', 0, databaseSizeBytes, 'sqlite-integrity')
    const integrity = database.prepare('PRAGMA integrity_check').get()
    emit('validate', databaseSizeBytes, databaseSizeBytes, 'sqlite-validated')
    const schema = Number(database.prepare(
      "SELECT value FROM metadata WHERE key = 'schema_version'",
    ).get()?.value)
    const missions = database.prepare('SELECT id FROM missions ORDER BY id').all()
    if (integrity?.integrity_check !== 'ok'
      || schema !== request.schemaVersion
      || missions.length !== 1
      || missions[0].id !== request.missionId) {
      throw new ArchiveRestoreError(
        'ARCHIVE_RESTORE_SQLITE_INVALID',
        'Archive review restored database is invalid or contains the wrong mission.',
      )
    }
    const missionBytes = extracted.metadata.get('mission.json')
    const inventoryBytes = extracted.metadata.get('inventory.json')
    if (missionBytes === undefined || inventoryBytes === undefined
      || parseCanonicalJson(missionBytes, 'Archive review mission').id !== request.missionId
      || parseCanonicalJson(inventoryBytes, 'Archive review inventory').schemaVersion
        !== request.schemaVersion) {
      throw new ArchiveRestoreError(
        'ARCHIVE_RESTORE_SCOPE_INVALID',
        'Archive review metadata does not match the restored mission.',
      )
    }
    return Object.freeze({
      databasePath,
      attachmentMappings: Object.freeze(extracted.manifest.attachments.map((attachment) =>
        Object.freeze({
          entryName: attachment.entry_name,
          sourceRelativePath: attachment.source_relative_path,
          sha256: attachment.sha256,
          sizeBytes: attachment.size_bytes,
          references: Object.freeze(attachment.references.map((reference) => Object.freeze({
            referenceId: reference.reference_id,
            referenceKind: reference.reference_kind,
          }))),
        }))),
    })
  } finally {
    database.close()
  }
}

/**
 * Authenticates and restores one exact verified SARARCH2 archive for a live review session.
 * The successful session directory intentionally remains until its main-isolate owner closes it.
 */
async function restoreMissionArchiveForReview(input) {
  const request = normalizeRestoreRequest(input?.request)
  const secretBytes = input?.secretBytes
  const cancellationFlag = input?.cancellationFlag
  if (!Buffer.isBuffer(secretBytes)) {
    throw new ArchiveRestoreError(
      'ARCHIVE_RESTORE_REQUEST_INVALID',
      'Archive review credential must use mutable bytes.',
    )
  }
  let archive
  let archiveKey
  let extracted = null
  let preserveExtractedOutputs = false
  let databaseFileHandle = null
  let transferDatabaseFileHandle = false
  let sessionDirectory = null
  let sequence = 0
  const emit = (phase, completed, total, detail) => {
    sequence += 1
    input.onProgress?.({
      type: 'progress',
      operationId: request.operationId,
      sequence,
      phase,
      unit: ['ciphertext', 'decrypt', 'validate'].includes(phase) ? 'bytes' : 'files',
      completed,
      total,
      detail,
    })
  }
  try {
    assertNotCancelled(cancellationFlag)
    ensureReviewRoot(request.reviewRoot)
    assertRestoreCapacity(request)
    archive = openPinnedArchive(request)
    const preamble = await readPinnedPreamble(request, archive)
    emit('preflight', 1, 1, 'pinned-header')
    try {
      archiveKey = await unwrapReviewSlot(preamble, request, secretBytes)
    } finally {
      zeroBuffer(secretBytes)
    }
    emit('keys', 1, 1, request.slotType)
    assertNotCancelled(cancellationFlag)
    emit('ciphertext', 0, request.sizeBytes, 'ciphertext-hashing')
    let lastCiphertextProgress = 0
    const digest = digestPinnedArchive(archive, cancellationFlag, (completed, total) => {
      if (completed !== total && completed - lastCiphertextProgress < PROGRESS_EMIT_BYTES) return
      lastCiphertextProgress = completed
      emit('ciphertext', completed, total, 'ciphertext-hashing')
    })
    if (digest.sizeBytes !== request.sizeBytes || digest.sha256 !== request.ciphertextSha256) {
      throw new ArchiveRestoreError(
        'ARCHIVE_RESTORE_CIPHERTEXT_MISMATCH',
        'Registered archive bytes do not match their verified identity.',
      )
    }
    assertNotCancelled(cancellationFlag)
    sessionDirectory = createSessionDirectory(request)
    extracted = await extractAndProveEntries({
      readable: streamPinnedArchive(archive.descriptor),
      missionArchiveKey: archiveKey,
      operationDirectory: sessionDirectory,
      request,
      header: preamble.header,
      cancellationFlag,
      onDecryptProgress: (completed) => emit('decrypt', completed, null, 'authenticated-stream'),
    })
    const manifestSha256 = createHash('sha256')
      .update(canonicalJson(extracted.manifest), 'utf8').digest('hex')
    if (extracted.result.ciphertextSha256 !== request.ciphertextSha256
      || extracted.result.sizeBytes !== request.sizeBytes
      || extracted.result.headerDigest !== request.headerSha256
      || Number(extracted.result.frameCount) !== request.frameCount
      || extracted.result.entryCount !== request.entryCount
      || manifestSha256 !== request.manifestSha256) {
      throw new ArchiveRestoreError(
        'ARCHIVE_RESTORE_CIPHERTEXT_MISMATCH',
        'Archive review authenticated stream differs from its verified identity.',
      )
    }
    const databaseIdentity = getRestoredDatabaseIdentity(extracted)
    const inspected = inspectRestoredSession(
      request,
      sessionDirectory,
      extracted,
      databaseIdentity.sizeBytes,
      emit,
    )
    assertPinnedCustodyFileUnchanged(archive)
    const validatedDatabaseIdentity = getRestoredDatabaseIdentity(extracted)
    if (validatedDatabaseIdentity.dev !== databaseIdentity.dev
      || validatedDatabaseIdentity.ino !== databaseIdentity.ino
      || validatedDatabaseIdentity.sizeBytes !== databaseIdentity.sizeBytes) {
      throw new ArchiveRestoreError(
        'ARCHIVE_RESTORE_SCOPE_INVALID',
        'Archive review restored database changed during validation.',
      )
    }
    databaseFileHandle = await fs.promises.open(
      inspected.databasePath,
      fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0),
    )
    const transferredIdentity = await databaseFileHandle.stat()
    if (!transferredIdentity.isFile() || transferredIdentity.nlink !== 1
      || transferredIdentity.dev !== databaseIdentity.dev
      || transferredIdentity.ino !== databaseIdentity.ino
      || transferredIdentity.size !== databaseIdentity.sizeBytes) {
      throw new ArchiveRestoreError(
        'ARCHIVE_RESTORE_SCOPE_INVALID',
        'Archive review restored database changed before handle transfer.',
      )
    }
    getRestoredDatabaseIdentity(extracted)
    emit('ready', 1, 1, 'read-only-session')
    preserveExtractedOutputs = true
    transferDatabaseFileHandle = true
    return Object.freeze({
      operationId: request.operationId,
      sessionId: request.sessionId,
      archiveId: request.archiveId,
      missionId: request.missionId,
      databasePath: inspected.databasePath,
      databaseIdentity,
      databaseFileHandle,
      sessionDirectory,
      attachmentMappings: inspected.attachmentMappings,
    })
  } catch (error) {
    if (error?.code === 'ENOSPC' || error?.code === 'SQLITE_FULL') {
      throw new ArchiveRestoreError(
        'ARCHIVE_RESTORE_DISK_FULL',
        'Archive review storage ran out of space.',
      )
    }
    if (error instanceof ArchiveRestoreError || error?.code === 'ARCHIVE_CANCELLED') throw error
    if (error?.code === 'ARCHIVE_AUTHENTICATION_FAILED') {
      throw new ArchiveRestoreError(
        'ARCHIVE_RESTORE_AUTHENTICATION_FAILED',
        'Archive review ciphertext authentication failed.',
      )
    }
    throw new ArchiveRestoreError(
      'ARCHIVE_RESTORE_FAILED',
      'Archive review restore failed safely.',
    )
  } finally {
    settleExtractedOutputs(extracted, preserveExtractedOutputs)
    if (databaseFileHandle !== null && !transferDatabaseFileHandle) {
      try { await databaseFileHandle.close() } catch {}
    }
    if (archive !== undefined) {
      try { fs.closeSync(archive.descriptor) } catch {}
    }
    if (archiveKey !== undefined) zeroBuffer(archiveKey)
    if (extracted !== null) extracted.metadata.forEach((buffer) => buffer.fill(0))
    zeroBuffer(secretBytes)
  }
}

module.exports = {
  ArchiveRestoreError,
  normalizeRestoreRequest,
  restoreMissionArchiveForReview,
}
