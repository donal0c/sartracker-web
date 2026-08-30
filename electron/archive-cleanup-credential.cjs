'use strict'

const fs = require('node:fs')
const path = require('node:path')

const {
  normalizeArchiveVerificationIdentity,
} = require('./archive-envelope.cjs')
const {
  normalizeRecoveryCode,
  unwrapMissionArchiveKey,
  zeroBuffer,
} = require('./archive-crypto.cjs')
const {
  assertPinnedCustodyFileUnchanged,
} = require('./archive-custody-file.cjs')
const {
  digestPinnedArchive,
  openPinnedArchive,
  readPinnedPreamble,
  validateBoundHeader,
} = require('./archive-verify.cjs')

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const IDENTITY_KEYS = Object.freeze([
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
  'previousArchiveSha256',
  'protectedFinalizationEpoch',
  'requestEventId',
  'requestEventRowid',
  'schemaVersion',
  'sizeBytes',
  'tableCount',
])

/** Stable non-reflective cleanup credential failure. */
class ArchiveCleanupCredentialError extends Error {
  /** Creates one credential failure. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveCleanupCredentialError'
    this.code = code
  }
}

/** Validates one registry-issued identity plus one requested non-machine slot. */
function normalizeArchiveCleanupCredentialRequest(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidRequest()
  }
  const expectedKeys = [...IDENTITY_KEYS, 'archiveDirectory', 'operationId', 'slotType'].sort()
  const actualKeys = Object.keys(input).sort()
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw invalidRequest()
  }
  let identity
  try {
    identity = normalizeArchiveVerificationIdentity(Object.fromEntries(
      IDENTITY_KEYS.map((key) => [key, input[key]]),
    ))
  } catch {
    throw invalidRequest()
  }
  if (typeof input.archiveDirectory !== 'string'
    || input.archiveDirectory.length < 1
    || Buffer.byteLength(input.archiveDirectory, 'utf8') > 8_192
    || input.archiveDirectory.includes('\0')
    || !path.isAbsolute(input.archiveDirectory)
    || path.resolve(input.archiveDirectory) !== input.archiveDirectory
    || typeof input.operationId !== 'string'
    || !UUID_V4.test(input.operationId)
    || !['passphrase', 'recovery'].includes(input.slotType)) {
    throw invalidRequest()
  }
  return Object.freeze({
    ...identity,
    archiveDirectory: input.archiveDirectory,
    operationId: input.operationId,
    slotType: input.slotType,
  })
}

/** Authenticates one passphrase/recovery slot and hashes every exact pinned ciphertext byte. */
async function authenticateArchiveCleanupCredential(input) {
  const request = normalizeArchiveCleanupCredentialRequest(input?.request)
  const secretBytes = input?.secretBytes
  const cancellationFlag = input?.cancellationFlag
  if (!Buffer.isBuffer(secretBytes) || secretBytes.byteLength < 1 || secretBytes.byteLength > 1_024
    || !(cancellationFlag instanceof Int32Array) || cancellationFlag.length !== 1
    || (input.onProgress !== undefined && typeof input.onProgress !== 'function')) {
    throw invalidRequest()
  }
  let archive
  let missionArchiveKey
  let wrongKey = false
  try {
    assertNotCancelled(cancellationFlag)
    archive = openPinnedArchive(request)
    if (archive.sizeBytes !== request.sizeBytes) throw custodyMismatch()
    const preamble = await readPinnedPreamble(request, archive)
    const slots = validateBoundHeader(preamble, request)
    const slot = request.slotType === 'passphrase'
      ? slots.passphraseSlot
      : slots.recoverySlot
    try {
      missionArchiveKey = await unwrapMissionArchiveKey({
        slot,
        secret: request.slotType === 'recovery'
          ? normalizeRecoveryCode(secretBytes.toString('utf8'))
          : secretBytes,
        headerDigest: preamble.headerDigest,
      })
    } catch (error) {
      if (error?.code !== 'ARCHIVE_WRONG_KEY') throw error
      wrongKey = true
    } finally {
      zeroBuffer(secretBytes)
    }
    assertNotCancelled(cancellationFlag)
    if (missionArchiveKey !== undefined) {
      zeroBuffer(missionArchiveKey)
      missionArchiveKey = undefined
    }
    const digest = digestPinnedArchive(
      archive,
      cancellationFlag,
      (completed, total) => input.onProgress?.(Object.freeze({
        phase: 'ciphertext',
        unit: 'bytes',
        completed,
        total,
      })),
    )
    assertPinnedCustodyFileUnchanged(archive)
    if (digest.sizeBytes !== request.sizeBytes || digest.sha256 !== request.ciphertextSha256) {
      throw custodyMismatch()
    }
    if (wrongKey) {
      throw new ArchiveCleanupCredentialError(
        'ARCHIVE_CLEANUP_WRONG_KEY',
        'Mission cleanup credential is incorrect.',
      )
    }
    assertPinnedCustodyFileUnchanged(archive)
    return Object.freeze({
      operationId: request.operationId,
      archiveId: request.archiveId,
      missionId: request.missionId,
      slotType: request.slotType,
      ciphertextSha256: request.ciphertextSha256,
      sizeBytes: request.sizeBytes,
      fileIdentity: archive.fileIdentity,
      custodyReconciled: true,
    })
  } catch (error) {
    if (error instanceof ArchiveCleanupCredentialError) throw error
    if (error?.code === 'ARCHIVE_CANCELLED') {
      throw new ArchiveCleanupCredentialError(
        'ARCHIVE_CLEANUP_CANCELLED',
        'Mission cleanup credential check was cancelled.',
      )
    }
    if (typeof error?.code === 'string' && (
      error.code.startsWith('ARCHIVE_VERIFY_')
      || error.code.startsWith('ARCHIVE_CUSTODY_')
      || error.code.startsWith('SARARCH2_')
    )) throw custodyMismatch()
    throw new ArchiveCleanupCredentialError(
      'ARCHIVE_CLEANUP_CREDENTIAL_FAILED',
      'Mission cleanup credential check failed safely.',
    )
  } finally {
    if (archive !== undefined) {
      try { fs.closeSync(archive.descriptor) } catch {}
    }
    if (missionArchiveKey !== undefined) zeroBuffer(missionArchiveKey)
    zeroBuffer(secretBytes)
  }
}

/** Throws at every bounded I/O/KDF boundary. */
function assertNotCancelled(cancellationFlag) {
  if (Atomics.load(cancellationFlag, 0) === 0) return
  throw new ArchiveCleanupCredentialError(
    'ARCHIVE_CLEANUP_CANCELLED',
    'Mission cleanup credential check was cancelled.',
  )
}

/** Creates one stable malformed-request error. */
function invalidRequest() {
  return new ArchiveCleanupCredentialError(
    'ARCHIVE_CLEANUP_CREDENTIAL_INVALID',
    'Mission cleanup credential request is invalid.',
  )
}

/** Creates one stable whole-file custody mismatch. */
function custodyMismatch() {
  return new ArchiveCleanupCredentialError(
    'ARCHIVE_CLEANUP_CUSTODY_MISMATCH',
    'Mission cleanup requires the exact registered archive ciphertext.',
  )
}

module.exports = {
  ArchiveCleanupCredentialError,
  authenticateArchiveCleanupCredential,
  normalizeArchiveCleanupCredentialRequest,
}
