'use strict'

const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')

const { createArchiveReviewSource } = require('./archive-review-source.cjs')
const { startArchiveRestore } = require('./archive-restore-runner.cjs')
const {
  startLegacyArchiveRestore,
} = require('./legacy-archive-restore-runner.cjs')
const { startArchiveReviewSweep } = require('./archive-review-sweep-runner.cjs')
const {
  startArchiveCorrectionSnapshot,
} = require('./archive-correction-snapshot-runner.cjs')
const {
  ARCHIVE_REVIEW_READ_METHODS,
  normalizeArchiveReviewPublicSession,
} = require('./archive-review-envelope.cjs')

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const RECOVERY_CODE = /^(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/u
const SWEEP_DIRECTORY = /^\.sweep-([0-9a-f-]{36})$/u
const SWEEP_LINK_A = /^\.sweep-link-a-([0-9a-f-]{36})$/u
const SWEEP_LINK_B = /^\.sweep-link-b-([0-9a-f-]{36})$/u
const MAX_PENDING_MUTATION_DENIALS = 128

/** Stable main-isolate archive review session failure. */
class ArchiveReviewSessionError extends Error {
  /** Creates a typed non-reflective session failure. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveReviewSessionError'
    this.code = code
  }
}

/** Requires one canonical absolute fixed directory. */
function normalizeDirectory(value, label) {
  if (typeof value !== 'string'
    || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 8_192
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.resolve(value) !== value) {
    throw new ArchiveReviewSessionError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      `${label} is invalid.`,
    )
  }
  return value
}

/** Resolves symlinked ancestors while preserving any not-yet-created directory suffix. */
function resolvePlannedRealDirectorySync(directory, failureCode) {
  let cursor = directory
  const missingSuffix = []
  while (true) {
    try {
      return path.join(fsSync.realpathSync(cursor), ...missingSuffix)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new ArchiveReviewSessionError(
          failureCode,
          'Archive review and ciphertext custody paths could not be resolved safely.',
        )
      }
      const parent = path.dirname(cursor)
      if (parent === cursor) {
        throw new ArchiveReviewSessionError(
          failureCode,
          'Archive review and ciphertext custody paths could not be resolved safely.',
        )
      }
      missingSuffix.unshift(path.basename(cursor))
      cursor = parent
    }
  }
}

/** Rejects lexical or real-path containment in either destructive-boundary direction. */
function assertArchiveReviewCustodySeparationSync(reviewRoot, archiveDirectory, failureCode) {
  const realReviewRoot = resolvePlannedRealDirectorySync(reviewRoot, failureCode)
  const realArchiveDirectory = resolvePlannedRealDirectorySync(archiveDirectory, failureCode)
  if (realReviewRoot === realArchiveDirectory
    || realReviewRoot.startsWith(`${realArchiveDirectory}${path.sep}`)
    || realArchiveDirectory.startsWith(`${realReviewRoot}${path.sep}`)) {
    throw new ArchiveReviewSessionError(
      failureCode,
      'Archive review root must remain separate from ciphertext custody.',
    )
  }
}

/** Pins ciphertext-custody directory identity so a later rename cannot become sweep scope. */
function assertArchiveDirectoryIdentitySync(
  archiveDirectory,
  expectedIdentity,
  failureCode,
  allowMissing,
) {
  let archiveStat
  try {
    archiveStat = fsSync.lstatSync(archiveDirectory)
  } catch (error) {
    if (allowMissing === true && expectedIdentity === null && error?.code === 'ENOENT') {
      return null
    }
    throw new ArchiveReviewSessionError(
      failureCode,
      'Archive ciphertext custody directory is unavailable or changed.',
    )
  }
  if (!archiveStat.isDirectory() || archiveStat.isSymbolicLink()) {
    throw new ArchiveReviewSessionError(
      failureCode,
      'Archive ciphertext custody directory is unsafe.',
    )
  }
  let realPath
  try {
    realPath = fsSync.realpathSync(archiveDirectory)
  } catch {
    throw new ArchiveReviewSessionError(
      failureCode,
      'Archive ciphertext custody directory is unavailable or changed.',
    )
  }
  const identity = Object.freeze({
    dev: archiveStat.dev,
    ino: archiveStat.ino,
    realPath,
  })
  if (expectedIdentity !== null
    && (identity.dev !== expectedIdentity.dev
      || identity.ino !== expectedIdentity.ino
      || identity.realPath !== expectedIdentity.realPath)) {
    throw new ArchiveReviewSessionError(
      failureCode,
      'Archive ciphertext custody directory identity changed.',
    )
  }
  return identity
}

/** Requires one positive Electron webContents identity. */
function normalizeSenderId(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ArchiveReviewSessionError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      'Archive review sender identity is invalid.',
    )
  }
  return value
}

/** Validates the exact renderer-originated non-secret request. */
function normalizeOpenRequest(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || !UUID_V4.test(input.operationId)
    || typeof input.archiveId !== 'string'
    || input.archiveId.length < 1
    || Buffer.byteLength(input.archiveId, 'utf8') > 200) {
    throw new ArchiveReviewSessionError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      'Archive review open request is invalid.',
    )
  }
  if (input.containerVersion === 1
    && Object.keys(input).sort().join(',') === 'archiveId,containerVersion,operationId') {
    return Object.freeze({
      operationId: input.operationId,
      archiveId: input.archiveId,
      containerVersion: 1,
    })
  }
  if (input.containerVersion !== 2
    || Object.keys(input).sort().join(',') !== 'archiveId,containerVersion,operationId,slotType'
    || !['passphrase', 'recovery'].includes(input.slotType)) {
    throw new ArchiveReviewSessionError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      'Archive review open request is invalid.',
    )
  }
  return Object.freeze({
    operationId: input.operationId,
    archiveId: input.archiveId,
    containerVersion: 2,
    slotType: input.slotType,
  })
}

/** Applies the same frozen non-machine credential floor at the manager boundary. */
function isValidReviewSecret(slotType, secret) {
  if (typeof secret !== 'string'
    || Buffer.byteLength(secret, 'utf8') < 1
    || Buffer.byteLength(secret, 'utf8') > 1_024
    || /[\u0000-\u001f\u007f]/u.test(secret)) return false
  if (slotType === 'recovery') return RECOVERY_CODE.test(secret)
  const classes = [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[^A-Za-z0-9]/u]
    .filter((pattern) => pattern.test(secret)).length
  return secret.length >= 14 && classes >= 3
}

/** Validates one registry-trusted archive before any restore worker starts. */
function normalizeReviewTicket(ticket, request) {
  if (request.containerVersion === 1) {
    if (ticket?.archiveId !== request.archiveId
      || ticket.containerVersion !== 1
      || !['sealed', 'superseded'].includes(ticket.status)
      || ticket.availability !== 'present'
      || typeof ticket.archiveRelativePath !== 'string'
      || path.basename(ticket.archiveRelativePath) !== ticket.archiveRelativePath
      || path.extname(ticket.archiveRelativePath).toLowerCase() !== '.zip'
      || typeof ticket.missionId !== 'string'
      || ticket.missionId.length < 1
      || typeof ticket.createdAt !== 'string'
      || Number.isNaN(Date.parse(ticket.createdAt))
      || ticket.verifiedAt !== null
      || ticket.encrypted !== false
      || ticket.immutable !== true
      || !Array.isArray(ticket.slots)
      || ticket.slots.length !== 0) {
      throw new ArchiveReviewSessionError(
        'ARCHIVE_REVIEW_ARCHIVE_UNAVAILABLE',
        'Archive review requires available supported legacy archive bytes.',
      )
    }
    return Object.freeze({ ...ticket, slots: Object.freeze([]) })
  }
  const slotTypes = Array.isArray(ticket?.slots)
    ? ticket.slots.map((slot) => slot?.slotType)
    : []
  if (ticket?.archiveId !== request.archiveId
    || ticket.containerVersion !== request.containerVersion
    || !['verified', 'superseded'].includes(ticket?.status)
    || typeof ticket?.verifiedAt !== 'string'
    || Number.isNaN(Date.parse(ticket.verifiedAt))
    || ticket.availability !== 'present'
    || ticket.containerVersion !== 2
    || ticket.schemaVersion !== 13
    || ticket.inventoryVersion !== 1
    || typeof ticket.missionId !== 'string'
    || ticket.missionId.length < 1
    || !SHA256.test(ticket.ciphertextSha256)
    || !SHA256.test(ticket.headerSha256)
    || !Number.isSafeInteger(ticket.sizeBytes)
    || ticket.sizeBytes < 1
    || slotTypes.length !== 2
    || new Set(slotTypes).size !== 2
    || !slotTypes.includes('passphrase')
    || !slotTypes.includes('recovery')
    || !slotTypes.includes(request.slotType)
    || !['finalized', 'direct', 'finalized_recovery'].includes(ticket.archiveKind)
    || ticket.archiveRelativePath !== `${ticket.archiveId}.sararch`) {
    throw new ArchiveReviewSessionError(
      'ARCHIVE_REVIEW_ARCHIVE_UNAVAILABLE',
      'Archive review requires an available, verified supported archive.',
    )
  }
  return Object.freeze({ ...ticket, slots: Object.freeze(ticket.slots.map((slot) => ({ ...slot }))) })
}

/** Projects trusted registry state into the exact restore-worker request. */
function createRestoreRequest(ticket, request, sessionId, archiveDirectory, reviewRoot) {
  return Object.freeze({
    operationId: request.operationId,
    sessionId,
    archiveId: ticket.archiveId,
    archiveKind: ticket.archiveKind,
    archiveDirectory,
    archiveRelativePath: ticket.archiveRelativePath,
    reviewRoot,
    missionId: ticket.missionId,
    requestEventRowid: ticket.requestEventRowid,
    requestEventId: ticket.requestEventId,
    creationOperationId: ticket.creationOperationId,
    protectedFinalizationEpoch: ticket.protectedFinalizationEpoch,
    createdAt: ticket.createdAt,
    containerVersion: ticket.containerVersion,
    schemaVersion: ticket.schemaVersion,
    inventoryVersion: ticket.inventoryVersion,
    ciphertextSha256: ticket.ciphertextSha256,
    headerSha256: ticket.headerSha256,
    sizeBytes: ticket.sizeBytes,
    frameCount: ticket.frameCount,
    manifestSha256: ticket.manifestSha256,
    entryCount: ticket.entryCount,
    tableCount: ticket.tableCount,
    slotType: request.slotType,
    previousArchiveSha256: ticket.previousArchiveSha256 ?? null,
  })
}

/** Shape-closes one worker-authenticated restored database inode identity. */
function normalizeDatabaseIdentity(identity) {
  if (identity === null || typeof identity !== 'object' || Array.isArray(identity)
    || Object.keys(identity).sort().join(',') !== 'dev,ino,sizeBytes'
    || !Number.isSafeInteger(identity.dev) || identity.dev < 0
    || !Number.isSafeInteger(identity.ino) || identity.ino < 1
    || !Number.isSafeInteger(identity.sizeBytes) || identity.sizeBytes < 1) {
    throw new ArchiveReviewSessionError(
      'ARCHIVE_REVIEW_RESTORE_SUBSTITUTED',
      'Archive review restore returned an invalid database identity.',
    )
  }
  return Object.freeze({ dev: identity.dev, ino: identity.ino, sizeBytes: identity.sizeBytes })
}

/** Retains the exact transferable restored database handle from the restore worker. */
function normalizeDatabaseFileHandle(fileHandle) {
  if (fileHandle === null || typeof fileHandle !== 'object'
    || !Number.isSafeInteger(fileHandle.fd) || fileHandle.fd < 0
    || typeof fileHandle.close !== 'function') {
    throw new ArchiveReviewSessionError(
      'ARCHIVE_REVIEW_RESTORE_SUBSTITUTED',
      'Archive review restore returned an invalid database handle.',
    )
  }
  return fileHandle
}

/** Requires the restore result to remain inside its exact manager-owned session. */
function normalizeInternalResult(result, ticket, request, sessionId, reviewRoot) {
  const sessionDirectory = path.join(reviewRoot, sessionId)
  if (ticket.containerVersion === 1) {
    if (result === null || typeof result !== 'object' || Array.isArray(result)
      || result.operationId !== request.operationId
      || result.sessionId !== sessionId
      || result.archiveKind !== 'legacy_unencrypted'
      || result.containerVersion !== 1
      || result.encrypted !== false
      || result.immutable !== true
      || result.missionId !== ticket.missionId
      || result.databaseFileName !== 'mission-store.sqlite'
      || result.databaseIdentity === undefined
      || result.databaseFileHandle === undefined
      || result.schemaVersion !== 13
      || result.sessionDirectory !== sessionDirectory
      || result.databasePath !== path.join(sessionDirectory, 'mission-store.sqlite')
      || !Array.isArray(result.attachmentMappings)) {
      throw new ArchiveReviewSessionError(
        'ARCHIVE_REVIEW_RESTORE_SUBSTITUTED',
        'Legacy archive review restore returned a substituted identity or session.',
      )
    }
    return Object.freeze({
      operationId: request.operationId,
      sessionId,
      archiveId: ticket.archiveId,
      missionId: ticket.missionId,
      containerVersion: 1,
      schemaVersion: result.schemaVersion,
      encrypted: false,
      verified: false,
      immutable: true,
      ciphertextSha256: null,
      previousArchiveId: ticket.previousArchiveId ?? null,
      sessionDirectory,
      databasePath: path.join(sessionDirectory, result.databaseFileName),
      databaseIdentity: normalizeDatabaseIdentity(result.databaseIdentity),
      databaseSha256: null,
      databaseFileHandle: normalizeDatabaseFileHandle(result.databaseFileHandle),
      attachmentMappings: Object.freeze(result.attachmentMappings.map((entry) => Object.freeze({
        ...entry,
        references: Object.freeze(entry.references.map((reference) => Object.freeze({
          ...reference,
        }))),
      }))),
    })
  }
  const allowedDatabaseNames = new Set(['mission-store.sqlite', 'mission.sqlite'])
  const invalidFields = result === null || typeof result !== 'object' || Array.isArray(result)
    ? ['shape']
    : [
        result.sessionId !== sessionId && 'session',
        result.archiveId !== ticket.archiveId && 'archive',
        result.missionId !== ticket.missionId && 'mission',
        result.containerVersion !== undefined
          && result.containerVersion !== ticket.containerVersion && 'container',
        result.schemaVersion !== undefined
          && result.schemaVersion !== ticket.schemaVersion && 'schema',
        result.encrypted !== undefined && result.encrypted !== true && 'encryption',
        result.verified !== undefined && result.verified !== true && 'verification',
        result.ciphertextSha256 !== undefined
          && result.ciphertextSha256 !== ticket.ciphertextSha256 && 'ciphertext',
        result.headerSha256 !== undefined
          && result.headerSha256 !== ticket.headerSha256 && 'header',
        result.previousArchiveId !== undefined
          && result.previousArchiveId !== (ticket.previousArchiveId ?? null) && 'predecessor',
        result.sessionDirectory !== sessionDirectory && 'session-path',
        typeof result.databasePath !== 'string' && 'database-path-shape',
        typeof result.databasePath === 'string'
          && path.dirname(result.databasePath) !== sessionDirectory && 'database-path-scope',
        typeof result.databasePath === 'string'
          && !allowedDatabaseNames.has(path.basename(result.databasePath)) && 'database-file',
        result.databaseIdentity === undefined && 'database-identity',
        !SHA256.test(result.databaseSha256 ?? '') && 'database-sha256',
        result.databaseFileHandle === undefined && 'database-handle',
      ].filter(Boolean)
  if (invalidFields.length > 0) {
    throw new ArchiveReviewSessionError(
      'ARCHIVE_REVIEW_RESTORE_SUBSTITUTED',
      `Archive review restore returned a substituted identity, path, or session (${invalidFields.join(',')}).`,
    )
  }
  return Object.freeze({
    operationId: request.operationId,
    sessionId,
    archiveId: ticket.archiveId,
    missionId: ticket.missionId,
    containerVersion: ticket.containerVersion,
    schemaVersion: ticket.schemaVersion,
    encrypted: true,
    verified: true,
    immutable: true,
    ciphertextSha256: ticket.ciphertextSha256,
    headerSha256: ticket.headerSha256,
    previousArchiveId: ticket.previousArchiveId ?? null,
    sessionDirectory,
    databasePath: result.databasePath,
    databaseIdentity: normalizeDatabaseIdentity(result.databaseIdentity),
    databaseSha256: result.databaseSha256,
    databaseFileHandle: normalizeDatabaseFileHandle(result.databaseFileHandle),
    attachmentMappings: Array.isArray(result.attachmentMappings)
      ? Object.freeze(result.attachmentMappings.map((entry) => Object.freeze({ ...entry })))
      : Object.freeze([]),
  })
}

/** Creates the stable cleanup failure without reflecting a filesystem path. */
function createPlaintextCleanupFailure(cause = undefined) {
  const failure = new ArchiveReviewSessionError(
    'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
    'Archive review plaintext cleanup failed and blocks further review.',
  )
  if (cause !== undefined) failure.cause = cause
  return failure
}

/** Requires one path to retain an already pinned inode identity. */
function assertPinnedIdentitySync(targetPath, expectedIdentity) {
  let current
  try {
    current = fsSync.lstatSync(targetPath)
  } catch (error) {
    throw createPlaintextCleanupFailure(error)
  }
  if (current.dev !== expectedIdentity.dev || current.ino !== expectedIdentity.ino) {
    throw createPlaintextCleanupFailure()
  }
  return current
}

/** Atomically quarantines and unlinks one pinned stale symlink without following it. */
function removePinnedStartupSymlinkSync(context, entryPath, entryName, entryIdentity) {
  const linkAMatch = SWEEP_LINK_A.exec(entryName)
  const linkBMatch = SWEEP_LINK_B.exec(entryName)
  const sessionId = linkAMatch?.[1] ?? linkBMatch?.[1] ?? entryName
  if (!UUID_V4.test(sessionId)) throw createPlaintextCleanupFailure()
  const quarantineName = linkAMatch === null
    ? `.sweep-link-a-${sessionId}`
    : `.sweep-link-b-${sessionId}`
  const quarantinePath = path.join(context.reviewRoot, quarantineName)
  if (fsSync.existsSync(quarantinePath)) throw createPlaintextCleanupFailure()
  assertArchiveReviewCustodySeparationSync(
    context.reviewRoot,
    context.archiveDirectory,
    'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
  )
  assertArchiveDirectoryIdentitySync(
    context.archiveDirectory,
    context.archiveDirectoryIdentity,
    'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
    false,
  )
  assertReviewRootSafeSync(context.reviewRoot, context.rootIdentity)
  const current = assertPinnedIdentitySync(entryPath, entryIdentity)
  if (!current.isSymbolicLink()) throw createPlaintextCleanupFailure()
  fsSync.renameSync(entryPath, quarantinePath)
  const quarantined = assertPinnedIdentitySync(quarantinePath, entryIdentity)
  if (!quarantined.isSymbolicLink()) throw createPlaintextCleanupFailure()
  assertArchiveReviewCustodySeparationSync(
    context.reviewRoot,
    context.archiveDirectory,
    'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
  )
  assertArchiveDirectoryIdentitySync(
    context.archiveDirectory,
    context.archiveDirectoryIdentity,
    'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
    false,
  )
  assertReviewRootSafeSync(context.reviewRoot, context.rootIdentity)
  assertPinnedIdentitySync(quarantinePath, entryIdentity)
  fsSync.unlinkSync(quarantinePath)
}

/** Joins one sweep operation and its physical worker exit before releasing ownership. */
async function awaitReviewSweepOperation(operation) {
  try {
    await operation
  } finally {
    await Promise.resolve(operation?.workerExited ?? operation).catch(() => undefined)
  }
}

/** Deletes one already-quarantined, inode-pinned review session tree off the main isolate. */
async function removeQuarantinedSessionDirectory(
  reviewRoot,
  quarantineDirectory,
  rootIdentity,
  archiveDirectory,
  archiveDirectoryIdentity,
  startSweep = startArchiveReviewSweep,
) {
  const quarantineStat = fsSync.lstatSync(quarantineDirectory)
  if (!quarantineStat.isDirectory() || quarantineStat.isSymbolicLink()) {
    throw createPlaintextCleanupFailure()
  }
  const quarantineIdentity = Object.freeze({
    dev: quarantineStat.dev,
    ino: quarantineStat.ino,
  })
  const operation = startSweep({
    reviewRoot,
    rootIdentity,
    archiveDirectory,
    archiveDirectoryIdentity,
    quarantineDirectory,
    quarantineIdentity,
  })
  if (operation === null || (typeof operation !== 'object' && typeof operation !== 'function')
    || typeof operation.then !== 'function') {
    throw createPlaintextCleanupFailure()
  }
  await awaitReviewSweepOperation(operation)
}

/** Safely quarantines and removes one exact app-owned session without following a symlink. */
async function removeOwnedSessionDirectory(
  reviewRoot,
  sessionDirectory,
  rootIdentity,
  archiveDirectory,
  archiveDirectoryIdentity,
  dependencies = {},
) {
  if (path.dirname(sessionDirectory) !== reviewRoot
    || !UUID_V4.test(path.basename(sessionDirectory))
    || dependencies === null
    || typeof dependencies !== 'object'
    || (dependencies.beforeQuarantine !== undefined
      && typeof dependencies.beforeQuarantine !== 'function')
    || (dependencies.startReviewSweep !== undefined
      && typeof dependencies.startReviewSweep !== 'function')) {
    throw new ArchiveReviewSessionError(
      'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
      'Archive review plaintext cleanup scope is invalid.',
    )
  }
  try {
    assertArchiveReviewCustodySeparationSync(
      reviewRoot,
      archiveDirectory,
      'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
    )
    assertArchiveDirectoryIdentitySync(
      archiveDirectory,
      archiveDirectoryIdentity,
      'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
      false,
    )
    assertReviewRootSafeSync(reviewRoot, rootIdentity)
    const quarantineDirectory = path.join(
      reviewRoot,
      `.sweep-${path.basename(sessionDirectory)}`,
    )
    let sessionStat = null
    let quarantineStat = null
    try {
      sessionStat = fsSync.lstatSync(sessionDirectory)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    try {
      quarantineStat = fsSync.lstatSync(quarantineDirectory)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (sessionStat !== null && quarantineStat !== null) {
      throw createPlaintextCleanupFailure()
    }
    if (sessionStat === null && quarantineStat === null) return
    if (sessionStat === null) {
      await removeQuarantinedSessionDirectory(
        reviewRoot,
        quarantineDirectory,
        rootIdentity,
        archiveDirectory,
        archiveDirectoryIdentity,
        dependencies.startReviewSweep ?? startArchiveReviewSweep,
      )
      return
    }
    if (!sessionStat.isDirectory() || sessionStat.isSymbolicLink()) {
      throw createPlaintextCleanupFailure()
    }
    const sessionIdentity = Object.freeze({ dev: sessionStat.dev, ino: sessionStat.ino })
    if (dependencies.beforeQuarantine !== undefined) {
      await dependencies.beforeQuarantine()
    }
    assertArchiveReviewCustodySeparationSync(
      reviewRoot,
      archiveDirectory,
      'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
    )
    assertArchiveDirectoryIdentitySync(
      archiveDirectory,
      archiveDirectoryIdentity,
      'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
      false,
    )
    assertReviewRootSafeSync(reviewRoot, rootIdentity)
    assertPinnedIdentitySync(sessionDirectory, sessionIdentity)
    fsSync.renameSync(sessionDirectory, quarantineDirectory)
    assertPinnedIdentitySync(quarantineDirectory, sessionIdentity)
    await removeQuarantinedSessionDirectory(
      reviewRoot,
      quarantineDirectory,
      rootIdentity,
      archiveDirectory,
      archiveDirectoryIdentity,
      dependencies.startReviewSweep ?? startArchiveReviewSweep,
    )
  } catch (error) {
    if (error instanceof ArchiveReviewSessionError) throw error
    throw createPlaintextCleanupFailure(error)
  }
}

/** Refuses to enumerate or remove through a replaced plaintext-review root. */
async function assertReviewRootSafe(reviewRoot, expectedIdentity = null) {
  let rootStat
  try {
    rootStat = await fs.lstat(reviewRoot)
  } catch {
    throw new ArchiveReviewSessionError(
      'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
      'Archive review plaintext root is unavailable.',
    )
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new ArchiveReviewSessionError(
      'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
      'Archive review plaintext root is unsafe.',
    )
  }
  const identity = Object.freeze({ dev: rootStat.dev, ino: rootStat.ino })
  if (expectedIdentity !== null
    && (identity.dev !== expectedIdentity.dev || identity.ino !== expectedIdentity.ino)) {
    throw new ArchiveReviewSessionError(
      'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
      'Archive review plaintext root identity changed.',
    )
  }
  return identity
}

/** Pins the already-created review root without yielding an open/shutdown race. */
function assertReviewRootSafeSync(reviewRoot, expectedIdentity = null) {
  let rootStat
  try {
    rootStat = fsSync.lstatSync(reviewRoot)
  } catch {
    throw new ArchiveReviewSessionError(
      'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
      'Archive review plaintext root is unavailable.',
    )
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()
    || (expectedIdentity !== null
      && (rootStat.dev !== expectedIdentity.dev || rootStat.ino !== expectedIdentity.ino))) {
    throw new ArchiveReviewSessionError(
      'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
      'Archive review plaintext root is unsafe or changed.',
    )
  }
  return Object.freeze({ dev: rootStat.dev, ino: rootStat.ino })
}

/** Creates the sender-owned one-at-a-time archive review session manager. */
function createArchiveReviewSessionManager(options) {
  const reviewRoot = normalizeDirectory(options?.reviewRoot, 'Archive review root')
  const archiveDirectory = normalizeDirectory(options?.archiveDirectory, 'Archive directory')
  assertArchiveReviewCustodySeparationSync(
    reviewRoot,
    archiveDirectory,
    'ARCHIVE_REVIEW_INPUT_INVALID',
  )
  const initialArchiveDirectoryIdentity = assertArchiveDirectoryIdentitySync(
    archiveDirectory,
    null,
    'ARCHIVE_REVIEW_INPUT_INVALID',
    true,
  )
  const registry = options.registry
  const restore = options.startRestore ?? startArchiveRestore
  const restoreLegacy = options.restoreLegacy ?? startLegacyArchiveRestore
  const createSource = options.createSource ?? createArchiveReviewSource
  const openRestoredAttachment = options.openRestoredAttachment
  const recordMutationDenied = options.recordMutationDenied
  let reviewRootIdentity = null
  let archiveDirectoryIdentity = initialArchiveDirectoryIdentity
  const removeSession = options.removeSessionDirectory
    ?? ((sessionDirectory) => removeOwnedSessionDirectory(
      reviewRoot,
      sessionDirectory,
      reviewRootIdentity,
      archiveDirectory,
      archiveDirectoryIdentity,
    ))
  const startReviewSweep = options.startReviewSweep ?? startArchiveReviewSweep
  const startSnapshot = options.startSnapshot ?? startArchiveCorrectionSnapshot
  const createId = options.randomUUID ?? require('node:crypto').randomUUID
  const now = options.now ?? (() => new Date().toISOString())
  if (typeof registry?.issueReviewTicket !== 'function'
    || typeof registry?.recordReviewOpened !== 'function'
    || typeof registry?.recordReviewClosed !== 'function'
    || (recordMutationDenied === undefined
      && typeof registry?.recordReviewMutationDenied !== 'function')
    || typeof restore !== 'function'
    || typeof restoreLegacy !== 'function'
    || typeof createSource !== 'function'
    || (openRestoredAttachment !== undefined && typeof openRestoredAttachment !== 'function')
    || (recordMutationDenied !== undefined && typeof recordMutationDenied !== 'function')
    || typeof removeSession !== 'function'
    || typeof startReviewSweep !== 'function'
    || typeof startSnapshot !== 'function'
    || typeof createId !== 'function'
    || typeof now !== 'function') {
    throw new ArchiveReviewSessionError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      'Archive review session adapters are invalid.',
    )
  }

  let activeSession = null
  let activeOpening = null
  let activeClose = null
  let activeCleanupLease = null
  let pendingCorrectionSnapshot = null
  let cleanupFailure = null
  let closing = false

  /** Throws while shutdown or a prior plaintext cleanup failure blocks new sessions. */
  function assertOpenAllowed() {
    if (closing) {
      throw new ArchiveReviewSessionError(
        'ARCHIVE_REVIEW_SHUTTING_DOWN',
        'Archive review is shutting down.',
      )
    }
    if (cleanupFailure !== null) {
      throw new ArchiveReviewSessionError(
        'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_BLOCKED',
        'Archive review is blocked by an unresolved plaintext cleanup failure.',
      )
    }
    if (activeCleanupLease !== null) {
      throw new ArchiveReviewSessionError(
        'ARCHIVE_REVIEW_CLEANUP_ACTIVE',
        'Archive review is unavailable while live mission rows are being archived.',
      )
    }
    if (activeSession !== null || activeOpening !== null) {
      throw new ArchiveReviewSessionError(
        'ARCHIVE_REVIEW_SESSION_ACTIVE',
        'One archive review session is already active.',
      )
    }
  }

  /** Sweeps one exact session and turns cleanup failure into a durable in-process blocker. */
  async function sweepSession(sessionDirectory) {
    try {
      await removeSession(sessionDirectory)
      cleanupFailure = null
    } catch (error) {
      cleanupFailure = error
      if (error?.code === 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED') throw error
      const failure = new ArchiveReviewSessionError(
        'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
        'Archive review plaintext cleanup failed and blocks further review.',
      )
      cleanupFailure = failure
      throw failure
    }
  }

  /** Sweeps one correction staging directory while retaining its exact identity for retry. */
  async function sweepCorrectionSnapshot(stagingDirectory) {
    if (path.dirname(stagingDirectory) !== reviewRoot
      || !SWEEP_DIRECTORY.test(path.basename(stagingDirectory))) {
      throw createPlaintextCleanupFailure()
    }
    let stat
    try {
      stat = fsSync.lstatSync(stagingDirectory)
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw createPlaintextCleanupFailure(error)
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw createPlaintextCleanupFailure()
    try {
      await removeQuarantinedSessionDirectory(
        reviewRoot,
        stagingDirectory,
        reviewRootIdentity,
        archiveDirectory,
        archiveDirectoryIdentity,
        startReviewSweep,
      )
    } catch (error) {
      cleanupFailure = error?.code === 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED'
        ? error
        : createPlaintextCleanupFailure(error)
      throw cleanupFailure
    }
  }

  /** Returns one bounded mutation method name without reflecting attacker content. */
  function normalizeAttemptedMethod(value) {
    if (typeof value !== 'string'
      || value.length < 1
      || Buffer.byteLength(value, 'utf8') > 100
      || /[\u0000-\u001f\u007f]/u.test(value)) return 'unsupported_method'
    return value
  }

  /** Persists every already-bounded denial in original order without replacing it on failure. */
  function flushPendingMutationDenials(session) {
    while (session.pendingMutationDenials.length > 0) {
      const denial = session.pendingMutationDenials[0]
      try {
        if (recordMutationDenied !== undefined) {
          const result = recordMutationDenied(denial)
          if (result !== undefined) {
            throw new Error('Archive review mutation audit adapter must be synchronous.')
          }
        } else if (typeof registry.recordReviewMutationDenied === 'function') {
          registry.recordReviewMutationDenied({
            archiveId: session.ticket.archiveId,
            missionId: session.ticket.missionId,
            sessionId: denial.sessionId,
            deniedAt: denial.deniedAt,
            attemptedMethod: denial.attemptedMethod,
            boundary: denial.boundary,
          })
        } else {
          throw new Error('Archive review mutation audit adapter is unavailable.')
        }
        if (session.pendingMutationDenials[0] === denial) {
          session.pendingMutationDenials.shift()
        }
      } catch (error) {
        const failure = new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_MUTATION_AUDIT_FAILED',
          'Archive review mutation denial could not be audited durably.',
        )
        failure.cause = error
        throw failure
      }
    }
  }

  /** Durably audits one denied mutation without losing any earlier unaudited denial. */
  function auditMutationDenied(session, senderId, attemptedMethod, boundary) {
    if (session.pendingMutationDenials.length >= MAX_PENDING_MUTATION_DENIALS) {
      flushPendingMutationDenials(session)
    }
    if (session.pendingMutationDenials.length >= MAX_PENDING_MUTATION_DENIALS) {
      throw new ArchiveReviewSessionError(
        'ARCHIVE_REVIEW_MUTATION_AUDIT_FAILED',
        'Archive review mutation audit backlog is full and blocks further review.',
      )
    }
    session.pendingMutationDenials.push(Object.freeze({
      senderId,
      sessionId: session.internal.sessionId,
      attemptedMethod: normalizeAttemptedMethod(attemptedMethod),
      boundary,
      deniedAt: now(),
    }))
    flushPendingMutationDenials(session)
  }

  /** Shares one opening sweep attempt while permitting a later retry after failure. */
  async function sweepOpening(opening) {
    if (opening.sweepPromise === null) {
      opening.sweepPromise = sweepSession(opening.expectedSessionDirectory)
    }
    const attempt = opening.sweepPromise
    try {
      await attempt
    } finally {
      if (opening.sweepPromise === attempt) opening.sweepPromise = null
    }
  }

  /** Releases every plaintext descriptor owner retained by an unpublished opening. */
  async function releaseOpeningResources(opening) {
    if (opening.cleanupSource !== null) {
      await opening.cleanupSource.close()
      opening.cleanupSource = null
    }
    if (opening.cleanupDatabaseFileHandle !== null) {
      await opening.cleanupDatabaseFileHandle.close()
      opening.cleanupDatabaseFileHandle = null
    }
  }

  /** Releases descriptors before an opening session pathname can be swept. */
  async function cleanupOpening(opening) {
    await releaseOpeningResources(opening)
    await sweepOpening(opening)
    if (activeOpening === opening) activeOpening = null
  }

  /** Cancels once, joins physical exit, and permits a later cleanup-only retry. */
  async function cancelOpening(opening) {
    opening.cancelled = true
    if (opening.cancelPromise !== null) return opening.cancelPromise
    if (!opening.cancelRequested) {
      opening.cancelRequested = true
      opening.operation.cancel()
    }
    const attempt = (async () => {
      await Promise.resolve(opening.operation).catch(() => undefined)
      await Promise.resolve(opening.operation.workerExited ?? opening.operation)
        .catch(() => undefined)
      await cleanupOpening(opening)
    })()
    opening.cancelPromise = attempt
    try {
      await attempt
    } finally {
      if (opening.cancelPromise === attempt) opening.cancelPromise = null
    }
  }

  /** Closes the read source before sweeping plaintext and retains audit retry ownership. */
  async function closeActiveSession(session, reason) {
    if (activeClose === null) {
      activeClose = {
        session,
        reason,
        closedAt: now(),
        sourceClosed: false,
        plaintextSwept: false,
        promise: null,
      }
    }
    if (activeClose.session !== session) {
      throw new ArchiveReviewSessionError(
        'ARCHIVE_REVIEW_SESSION_ACTIVE',
        'Another archive review session is still closing.',
      )
    }
    if (activeClose.promise !== null) return activeClose.promise
    const closeState = activeClose
    const attempt = (async () => {
      if (pendingCorrectionSnapshot?.session === session
        && pendingCorrectionSnapshot.setupPromise !== null
        && pendingCorrectionSnapshot.ready !== true) {
        try { pendingCorrectionSnapshot.snapshotOperation?.cancel?.() } catch {}
        await pendingCorrectionSnapshot.setupPromise.catch(() => undefined)
      }
      if (!closeState.sourceClosed) {
        await session.source.close()
        closeState.sourceClosed = true
      }
      if (!closeState.plaintextSwept) {
        await sweepSession(session.internal.sessionDirectory)
        closeState.plaintextSwept = true
      }
      if (pendingCorrectionSnapshot?.session === session
        && pendingCorrectionSnapshot.swept !== true) {
        await sweepCorrectionSnapshot(pendingCorrectionSnapshot.stagingDirectory)
        pendingCorrectionSnapshot.swept = true
      }
      flushPendingMutationDenials(session)
      registry.recordReviewClosed({
        archiveId: session.ticket.archiveId,
        missionId: session.ticket.missionId,
        sessionId: session.internal.sessionId,
        closedAt: closeState.closedAt,
        reason: closeState.reason,
        plaintextSweepConfirmed: true,
      })
      activeSession = null
      pendingCorrectionSnapshot = null
      cleanupFailure = null
      activeClose = null
    })()
    closeState.promise = attempt
    try {
      await attempt
    } finally {
      if (activeClose === closeState && closeState.promise === attempt) {
        closeState.promise = null
      }
    }
  }

  return Object.freeze({
    /** Reserves the global review/plaintext lane for one exact live-store cleanup. */
    acquireCleanupLease(missionId) {
      if (typeof missionId !== 'string' || missionId.length < 1
        || Buffer.byteLength(missionId, 'utf8') > 200
        || /[\u0000-\u001f\u007f]/u.test(missionId)) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_INPUT_INVALID',
          'Archive cleanup mission identity is invalid.',
        )
      }
      if (closing) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_SHUTTING_DOWN',
          'Archive review is shutting down.',
        )
      }
      if (cleanupFailure !== null || activeSession !== null
        || activeOpening !== null || activeClose !== null) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_SESSION_ACTIVE',
          'Archive cleanup is unavailable while archive review activity remains open.',
        )
      }
      if (activeCleanupLease !== null) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_CLEANUP_ACTIVE',
          'One archive cleanup lease is already active.',
        )
      }
      const lease = { missionId, released: false }
      activeCleanupLease = lease
      return Object.freeze({
        missionId,
        release() {
          if (lease.released || activeCleanupLease !== lease) {
            throw new ArchiveReviewSessionError(
              'ARCHIVE_REVIEW_CLEANUP_LEASE_RELEASED',
              'Archive cleanup lease was already released.',
            )
          }
          lease.released = true
          activeCleanupLease = null
        },
      })
    },

    /** Reports any live review/open/close/residual state without exposing session identity. */
    hasReviewActivity() {
      return cleanupFailure !== null || activeSession !== null
        || activeOpening !== null || activeClose !== null
    },

    /** Authenticates, restores and opens one path-free sender-owned read session. */
    async open(input) {
      assertOpenAllowed()
      assertArchiveReviewCustodySeparationSync(
        reviewRoot,
        archiveDirectory,
        'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
      )
      archiveDirectoryIdentity = assertArchiveDirectoryIdentitySync(
        archiveDirectory,
        archiveDirectoryIdentity,
        'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
        false,
      )
      reviewRootIdentity = assertReviewRootSafeSync(reviewRoot, reviewRootIdentity)
      const senderId = normalizeSenderId(input?.senderId)
      const request = normalizeOpenRequest(input?.request)
      if (input?.onProgress !== undefined && typeof input.onProgress !== 'function') {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_INPUT_INVALID',
          'Archive review progress callback is invalid.',
        )
      }
      const hasSecret = Object.prototype.hasOwnProperty.call(input ?? {}, 'secret')
      if ((request.containerVersion === 1 && hasSecret)
        || (request.containerVersion === 2
          && !isValidReviewSecret(request.slotType, input?.secret))) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_INPUT_INVALID',
          'Archive review credential is invalid.',
        )
      }
      const ticket = normalizeReviewTicket(registry.issueReviewTicket(request.archiveId), request)
      const sessionId = createId()
      if (!UUID_V4.test(sessionId)) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_IDENTITY_INVALID',
          'Archive review session identity generation failed.',
        )
      }
      const expectedSessionDirectory = path.join(reviewRoot, sessionId)
      const restoreRequest = request.containerVersion === 2
        ? createRestoreRequest(ticket, request, sessionId, archiveDirectory, reviewRoot)
        : null
      const operation = request.containerVersion === 2
        ? restore({
            request: restoreRequest,
            secret: input.secret,
            ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
          })
        : restoreLegacy({
            request: {
              operationId: request.operationId,
              sessionId,
              archivePath: path.join(archiveDirectory, ticket.archiveRelativePath),
              sessionDirectory: expectedSessionDirectory,
              expectedMissionId: ticket.missionId,
            },
            ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
          })
      if (typeof operation.cancel !== 'function') {
        Object.defineProperty(operation, 'cancel', { value: () => undefined })
      }
      if (operation.workerExited === undefined) {
        Object.defineProperty(operation, 'workerExited', {
          value: Promise.resolve(operation).then(() => undefined, () => undefined),
        })
      }
      const opening = {
        senderId,
        request,
        ticket,
        sessionId,
        operation,
        expectedSessionDirectory,
        cancelled: false,
        cancelRequested: false,
        cancelPromise: null,
        sweepPromise: null,
        cleanupSource: null,
        cleanupDatabaseFileHandle: null,
      }
      activeOpening = opening
      let clearOpening = false
      try {
        const result = await operation
        if (result?.databaseFileHandle !== undefined) {
          opening.cleanupDatabaseFileHandle = result.databaseFileHandle
        }
        await Promise.resolve(operation.workerExited ?? operation)
        if (opening.cancelled || closing) {
          throw new ArchiveReviewSessionError(
            'ARCHIVE_CANCELLED',
            'Archive review restore was cancelled.',
          )
        }
        const internal = normalizeInternalResult(result, ticket, request, sessionId, reviewRoot)
        const source = createSource({
          databasePath: internal.databasePath,
          expectedDatabaseIdentity: internal.databaseIdentity,
          databaseFileHandle: internal.databaseFileHandle,
          missionId: internal.missionId,
          sessionId,
          attachmentMappings: internal.attachmentMappings,
          ...(openRestoredAttachment === undefined ? {} : { openRestoredAttachment }),
          onMutationDenied: (attemptedMethod) => {
            if (activeSession === null
              || activeSession.senderId !== senderId
              || activeSession.internal.sessionId !== sessionId) {
              throw new ArchiveReviewSessionError(
                'ARCHIVE_REVIEW_SESSION_OWNER_MISMATCH',
                'Archive review mutation denial does not belong to an active session.',
              )
            }
            auditMutationDenied(activeSession, senderId, attemptedMethod, 'facade')
          },
        })
        if (source === null || typeof source !== 'object' || typeof source.close !== 'function') {
          throw new ArchiveReviewSessionError(
            'ARCHIVE_REVIEW_SOURCE_INVALID',
            'Archive review restored source is invalid.',
          )
        }
        opening.cleanupSource = source
        opening.cleanupDatabaseFileHandle = null
        const openedAt = now()
        try {
          registry.recordReviewOpened({
            archiveId: ticket.archiveId,
            missionId: ticket.missionId,
            sessionId,
            openedAt,
            slotType: request.containerVersion === 1
              ? 'legacy_unencrypted'
              : request.slotType,
            plaintextResidual: 'permission_restricted_session_open',
          })
        } catch (error) {
          throw error
        }
        activeSession = {
          senderId,
          request,
          ticket,
          internal,
          source,
          pendingMutationDenials: [],
        }
        opening.cleanupSource = null
        clearOpening = true
        return normalizeArchiveReviewPublicSession({
          sessionId,
          archiveId: ticket.archiveId,
          missionId: ticket.missionId,
          containerVersion: ticket.containerVersion,
          verified: ticket.containerVersion === 2,
          immutable: true,
          encrypted: ticket.containerVersion === 2,
          ciphertextSha256: ticket.containerVersion === 2 ? ticket.ciphertextSha256 : null,
          previousArchiveId: ticket.previousArchiveId ?? null,
          openedAt,
          plaintextResidual: 'permission_restricted_session_open',
        }, {
          operationId: request.operationId,
          archiveId: ticket.archiveId,
          missionId: ticket.missionId,
          slotType: request.slotType,
        })
      } catch (error) {
        if (opening.cancelled || closing) throw error
        await Promise.resolve(operation.workerExited ?? operation).catch(() => undefined)
        await cleanupOpening(opening)
        clearOpening = true
        throw error
      } finally {
        if (clearOpening && activeOpening?.operation === operation) activeOpening = null
      }
    },

    /** Closes one exact owner session and confirms plaintext cleanup. */
    async close(input) {
      const senderId = normalizeSenderId(input?.senderId)
      if (!UUID_V4.test(input?.sessionId ?? '')
        || activeSession === null
        || activeSession.internal.sessionId !== input.sessionId
        || activeSession.senderId !== senderId) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_SESSION_OWNER_MISMATCH',
          'Archive review session does not belong to this sender.',
        )
      }
      await closeActiveSession(activeSession, 'explicit_close')
    },

    /** Copies one authenticated v2 review snapshot into a sweep-owned correction staging area. */
    async snapshotForCorrection(input) {
      const senderId = normalizeSenderId(input?.senderId)
      if (!UUID_V4.test(input?.sessionId ?? '')
        || !UUID_V4.test(input?.operationId ?? '')
        || typeof input?.archiveId !== 'string'
        || input.archiveId.length < 1) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_INPUT_INVALID',
          'Archive correction session identity is invalid.',
        )
      }
      if (input.signal !== undefined && typeof input.signal.addEventListener !== 'function') {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_INPUT_INVALID',
          'Archive correction cancellation signal is invalid.',
        )
      }
      if (input.signal?.aborted === true) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_CANCELLED',
          'Archive correction restore was cancelled.',
        )
      }
      if (activeSession === null
        || activeSession.senderId !== senderId
        || activeSession.internal.sessionId !== input.sessionId
        || activeSession.request.operationId !== input.operationId
        || activeSession.ticket.archiveId !== input.archiveId
        || activeSession.ticket.containerVersion !== 2
        || activeSession.internal.verified !== true) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_SESSION_OWNER_MISMATCH',
          'Archive correction snapshot does not belong to this sender or verified session.',
        )
      }
      const sourcePath = activeSession.internal.databasePath
      const missionId = activeSession.ticket.missionId
      const sourceIdentity = normalizeDatabaseIdentity(activeSession.internal.databaseIdentity)
      if (pendingCorrectionSnapshot !== null) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_SESSION_ACTIVE',
          'An archive correction snapshot is already staged for this review session.',
        )
      }
      const current = fsSync.lstatSync(sourcePath)
      if (!current.isFile() || current.isSymbolicLink()
        || current.dev !== sourceIdentity.dev || current.ino !== sourceIdentity.ino
        || current.size !== sourceIdentity.sizeBytes) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_RESTORE_SUBSTITUTED',
          'Archive correction snapshot changed during review.',
        )
      }
      const stagingId = createId()
      if (!UUID_V4.test(stagingId)) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_IDENTITY_INVALID',
          'Archive correction staging identity generation failed.',
        )
      }
      const stagingDirectory = path.join(reviewRoot, `.sweep-${stagingId}`)
      const snapshotPath = path.join(stagingDirectory, 'mission-store.sqlite')
      const session = activeSession
      const pending = {
        session,
        stagingDirectory,
        swept: false,
        ready: false,
        setupPromise: null,
        snapshotOperation: null,
      }
      pendingCorrectionSnapshot = pending
      const setup = (async () => {
        let snapshotOperation = null
        try {
          if (!SHA256.test(session.internal.databaseSha256 ?? '')) {
            throw new ArchiveReviewSessionError(
              'ARCHIVE_REVIEW_RESTORE_SUBSTITUTED',
              'Archive correction session is missing its authenticated database digest.',
            )
          }
        snapshotOperation = startSnapshot({
          sourcePath,
          sourceIdentity,
          expectedSha256: session.internal.databaseSha256,
          stagingDirectory,
          snapshotPath,
          attachmentDirectory: path.join(stagingDirectory, 'attachments'),
          attachmentMappings: session.internal.attachmentMappings,
          signal: input.signal,
        })
        pending.snapshotOperation = snapshotOperation
        const snapshot = await snapshotOperation
        await Promise.resolve(snapshotOperation?.workerExited ?? snapshotOperation)
        pending.ready = true
        return Object.freeze({
          missionId,
          archiveId: input.archiveId,
          snapshotPath: snapshot.snapshotPath,
          attachmentDirectory: snapshot.attachmentDirectory,
          attachmentMappings: snapshot.attachmentMappings,
          sessionId: input.sessionId,
          operationId: input.operationId,
        })
        } catch (error) {
          await Promise.resolve(snapshotOperation?.workerExited).catch(() => undefined)
          try {
            await fs.rm(stagingDirectory, { recursive: true, force: true })
            if (fsSync.existsSync(stagingDirectory)) {
              throw createPlaintextCleanupFailure()
            }
          } catch (cleanupError) {
            const failure = createPlaintextCleanupFailure(cleanupError)
            cleanupFailure = failure
            pending.cleanupFailure = failure
            throw failure
          }
          if (pendingCorrectionSnapshot === pending) pendingCorrectionSnapshot = null
          throw error
        }
      })()
      pending.setupPromise = setup
      return setup
    },

    /** Commits ownership of a correction staging tree to the close/sweep retry path. */
    async completeCorrectionSnapshot(input) {
      const senderId = normalizeSenderId(input?.senderId)
      if (!UUID_V4.test(input?.sessionId ?? '')
        || !UUID_V4.test(input?.operationId ?? '')
        || typeof input?.archiveId !== 'string'
        || activeSession === null
        || activeSession.senderId !== senderId
        || activeSession.internal.sessionId !== input.sessionId
        || activeSession.request.operationId !== input.operationId
        || activeSession.ticket.archiveId !== input.archiveId
        || pendingCorrectionSnapshot?.session !== activeSession
        || pendingCorrectionSnapshot.ready !== true) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_SESSION_OWNER_MISMATCH',
          'Archive correction completion does not belong to this sender or session.',
        )
      }
      await closeActiveSession(activeSession, 'correction_restore')
    },

    /** Cancels one sender-owned opening restore. */
    cancel(input) {
      const senderId = normalizeSenderId(input?.senderId)
      if (!UUID_V4.test(input?.operationId ?? '')) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_OPERATION_OWNER_MISMATCH',
          'Archive review operation does not belong to this sender.',
        )
      }
      if (activeOpening !== null) {
        if (activeOpening.request.operationId !== input.operationId
          || activeOpening.senderId !== senderId) {
          throw new ArchiveReviewSessionError(
            'ARCHIVE_REVIEW_OPERATION_OWNER_MISMATCH',
            'Archive review operation does not belong to this sender.',
          )
        }
        return cancelOpening(activeOpening).then(() => true)
      }
      if (activeSession !== null) {
        if (activeSession.request.operationId !== input.operationId
          || activeSession.senderId !== senderId) {
          throw new ArchiveReviewSessionError(
            'ARCHIVE_REVIEW_OPERATION_OWNER_MISMATCH',
            'Archive review operation does not belong to this sender.',
          )
        }
        return closeActiveSession(activeSession, 'explicit_close').then(() => true)
      }
      return Promise.resolve(false)
    },

    /** Closes or cancels every session owned by one destroyed renderer. */
    async closeForSender(senderIdInput) {
      const senderId = normalizeSenderId(senderIdInput)
      if (activeOpening?.senderId === senderId) {
        await cancelOpening(activeOpening)
      }
      if (activeSession?.senderId === senderId) {
        await closeActiveSession(activeSession, 'renderer_destroyed')
      }
    },

    /** Sweeps all stale app-owned review session entries before renderer startup. */
    async sweepStartup() {
      if (activeOpening !== null || activeSession !== null) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_SESSION_ACTIVE',
          'Archive review startup sweep cannot run with an active session.',
        )
      }
      assertArchiveReviewCustodySeparationSync(
        reviewRoot,
        archiveDirectory,
        'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
      )
      archiveDirectoryIdentity = assertArchiveDirectoryIdentitySync(
        archiveDirectory,
        archiveDirectoryIdentity,
        'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
        true,
      )
      if (archiveDirectoryIdentity === null) {
        await fs.mkdir(archiveDirectory, { recursive: true, mode: 0o700 })
        archiveDirectoryIdentity = assertArchiveDirectoryIdentitySync(
          archiveDirectory,
          null,
          'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
          false,
        )
      }
      await fs.mkdir(reviewRoot, { recursive: true, mode: 0o700 })
      assertArchiveReviewCustodySeparationSync(
        reviewRoot,
        archiveDirectory,
        'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
      )
      assertArchiveDirectoryIdentitySync(
        archiveDirectory,
        archiveDirectoryIdentity,
        'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
        false,
      )
      reviewRootIdentity = await assertReviewRootSafe(reviewRoot, reviewRootIdentity)
      const entries = await fs.readdir(reviewRoot, { withFileTypes: true })
      for (const entry of entries) {
        assertArchiveReviewCustodySeparationSync(
          reviewRoot,
          archiveDirectory,
          'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
        )
        assertArchiveDirectoryIdentitySync(
          archiveDirectory,
          archiveDirectoryIdentity,
          'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
          false,
        )
        await assertReviewRootSafe(reviewRoot, reviewRootIdentity)
        const entryPath = path.join(reviewRoot, entry.name)
        const sweepMatch = SWEEP_DIRECTORY.exec(entry.name)
        const sweepLinkMatch = SWEEP_LINK_A.exec(entry.name) ?? SWEEP_LINK_B.exec(entry.name)
        const supportedSessionName = UUID_V4.test(entry.name)
        if (!supportedSessionName
          && (sweepMatch === null
            || !UUID_V4.test(sweepMatch[1]))
          && (sweepLinkMatch === null
            || !UUID_V4.test(sweepLinkMatch[1]))) {
          throw createPlaintextCleanupFailure()
        }
        const current = fsSync.lstatSync(entryPath)
        if (current.isSymbolicLink()) {
          removePinnedStartupSymlinkSync({
            reviewRoot,
            rootIdentity: reviewRootIdentity,
            archiveDirectory,
            archiveDirectoryIdentity,
          }, entryPath, entry.name, Object.freeze({ dev: current.dev, ino: current.ino }))
        } else if (sweepLinkMatch !== null) {
          throw createPlaintextCleanupFailure()
        } else if (sweepMatch !== null) {
          await removeQuarantinedSessionDirectory(
            reviewRoot,
            entryPath,
            reviewRootIdentity,
            archiveDirectory,
            archiveDirectoryIdentity,
          )
        } else {
          await removeOwnedSessionDirectory(
            reviewRoot,
            entryPath,
            reviewRootIdentity,
            archiveDirectory,
            archiveDirectoryIdentity,
          )
        }
      }
      assertArchiveReviewCustodySeparationSync(
        reviewRoot,
        archiveDirectory,
        'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
      )
      assertArchiveDirectoryIdentitySync(
        archiveDirectory,
        archiveDirectoryIdentity,
        'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
        false,
      )
      await assertReviewRootSafe(reviewRoot, reviewRootIdentity)
    },

    /** Cancels workers, joins physical exit, closes sources, then sweeps plaintext. */
    async prepareClose() {
      closing = true
      if (activeOpening !== null) {
        const opening = activeOpening
        await cancelOpening(opening)
      }
      if (activeSession !== null) {
        await closeActiveSession(activeSession, 'app_shutdown')
      }
    },

    /** Dispatches one source method only for its exact sender-owned session. */
    async read(input) {
      const senderId = normalizeSenderId(input?.senderId)
      if (activeSession === null
        || activeSession.senderId !== senderId
        || activeSession.internal.sessionId !== input?.sessionId) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_SESSION_OWNER_MISMATCH',
          'Archive review read does not belong to this sender or session.',
        )
      }
      if (typeof input?.method !== 'string'
        || !ARCHIVE_REVIEW_READ_METHODS.has(input.method)
        || typeof activeSession.source[input.method] !== 'function') {
        auditMutationDenied(activeSession, senderId, input?.method, 'ipc')
        const denial = new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_READ_ONLY',
          'Archive review is read-only and does not expose mutation capabilities.',
        )
        denial.denialAudited = true
        throw denial
      }
      return activeSession.source[input.method](...(input.args ?? []))
    },

    /** Audits a bounded IPC denial against the active sender-owned session. */
    recordMutationDenied(input) {
      const senderId = normalizeSenderId(input?.senderId)
      if (activeSession === null
        || activeSession.senderId !== senderId
        || activeSession.internal.sessionId !== input?.sessionId) {
        throw new ArchiveReviewSessionError(
          'ARCHIVE_REVIEW_SESSION_OWNER_MISMATCH',
          'Archive review mutation denial does not belong to this sender or session.',
        )
      }
      auditMutationDenied(
        activeSession,
        senderId,
        input?.attemptedMethod,
        input?.boundary === 'facade' ? 'facade' : 'ipc',
      )
      return true
    },
  })
}

module.exports = {
  ArchiveReviewSessionError,
  createArchiveReviewSessionManager,
  removeOwnedSessionDirectory,
}
