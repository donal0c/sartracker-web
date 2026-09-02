'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash, timingSafeEqual } = require('node:crypto')

const Database = require('better-sqlite3')
const {
  canonicalJson,
  parseCanonicalJson,
  readArchiveContainer,
  readArchivePreamble,
} = require('./archive-container.cjs')
const {
  normalizeRecoveryCode,
  unwrapMissionArchiveKey,
  zeroBuffer,
} = require('./archive-crypto.cjs')
const {
  computeArchivedTableContentDigest,
  createArchiveInventoryDocument,
  digestArchiveInventoryDocument,
  listArchiveInventoryForSchema,
  reconcileArchiveInventory,
} = require('./archive-inventory.cjs')
const {
  readArchiveAttachmentReferenceLedger,
  verifyArchiveAttachmentEntryProofs,
} = require('./archive-attachments.cjs')
const { computeArchiveGpxContentProof } = require('./archive-gpx-proof.cjs')
const { computeMissionReplaySemanticProof } = require('./archive-replay-proof.cjs')
const {
  assertPinnedCustodyFileUnchanged,
  digestPinnedCustodyFile,
  openPinnedCustodyFile,
} = require('./archive-custody-file.cjs')

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
const MAX_METADATA_ENTRY_BYTES = 2 * 1024 * 1024
const READ_CHUNK_BYTES = 64 * 1024
const CIPHERTEXT_DIGEST_PROGRESS_BYTES = 8 * 1024 * 1024
const SHA256 = /^[0-9a-f]{64}$/u
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const VERIFY_REQUEST_KEYS = Object.freeze([
  'archiveDirectory',
  'archiveId',
  'archiveKind',
  'archiveRelativePath',
  'ciphertextSha256',
  'containerVersion',
  'createdAt',
  'creationOperationId',
  'databasePath',
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
  'schemaVersion',
  'sizeBytes',
  'tableCount',
])
const MANIFEST_KEYS = Object.freeze([
  'archive_id',
  'archive_kind',
  'attachments',
  'creation_operation_id',
  'created_at',
  'entries',
  'gpx_content',
  'inventory_sha256',
  'inventory_version',
  'manifest_version',
  'mission_id',
  'previous_archive_sha256',
  'protected_finalization_epoch',
  'replay_semantic_proof',
  'request_event_id',
  'request_event_rowid',
  'schema_ledger',
  'schema_version',
  'tables',
])

/** Signals a closed, operator-safe independent archive verification failure. */
class ArchiveVerifyError extends Error {
  /** Creates a stable verification failure without reflecting archive content. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveVerifyError'
    this.code = code
  }
}

/** Returns true only for a plain JSON record. */
function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Requires one record to use exactly a closed set of keys. */
function requireExactKeys(record, keys, label) {
  if (!isPlainRecord(record)) {
    throw new ArchiveVerifyError('ARCHIVE_VERIFY_MANIFEST_INVALID', `${label} must be an object.`)
  }
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_MANIFEST_INVALID',
      `${label} contains missing or unsupported fields.`,
    )
  }
}

/** Requires one bounded, non-control internal identity. */
function normalizeId(value, label, uuid = false) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 200
    || /[\u0000-\u001f\u007f]/u.test(value)
    || (uuid && !UUID_V4.test(value))
  ) {
    throw new ArchiveVerifyError('ARCHIVE_VERIFY_REQUEST_INVALID', `${label} is invalid.`)
  }
  return value
}

/** Resolves one canonical relative path beneath an archive custody directory. */
function resolveArchivePath(archiveDirectory, relativePath) {
  if (
    typeof relativePath !== 'string'
    || relativePath.length < 1
    || Buffer.byteLength(relativePath, 'utf8') > 4_096
    || path.isAbsolute(relativePath)
    || relativePath.includes('\\')
    || relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_REQUEST_INVALID',
      'Archive verification custody path is invalid.',
    )
  }
  const resolved = path.resolve(archiveDirectory, relativePath)
  if (!resolved.startsWith(`${archiveDirectory}${path.sep}`)) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_REQUEST_INVALID',
      'Archive verification custody path escapes its archive directory.',
    )
  }
  return resolved
}

/** Validates the complete non-secret verifier request before touching archive bytes. */
function normalizeVerifyRequest(input) {
  requireExactKeys(input, VERIFY_REQUEST_KEYS, 'Archive verification request')
  if (
    typeof input.archiveDirectory !== 'string'
    || !path.isAbsolute(input.archiveDirectory)
    || path.resolve(input.archiveDirectory) !== input.archiveDirectory
    || typeof input.databasePath !== 'string'
    || !path.isAbsolute(input.databasePath)
    || path.resolve(input.databasePath) !== input.databasePath
  ) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_REQUEST_INVALID',
      'Archive verification paths must be canonical absolute paths.',
    )
  }
  normalizeId(input.operationId, 'Archive verification operation ID', true)
  normalizeId(input.archiveId, 'Archive ID', true)
  normalizeId(input.requestEventId, 'Archive request event ID', true)
  normalizeId(input.creationOperationId, 'Archive creation operation ID', true)
  normalizeId(input.missionId, 'Archive mission ID')
  if (!Number.isSafeInteger(input.requestEventRowid) || input.requestEventRowid < 1
    || input.containerVersion !== 2 || input.schemaVersion !== 13
    || input.inventoryVersion !== 1 || !Number.isSafeInteger(input.sizeBytes)
    || input.sizeBytes < 1 || typeof input.ciphertextSha256 !== 'string'
    || !SHA256.test(input.ciphertextSha256)
    || !Number.isSafeInteger(input.frameCount) || input.frameCount < 2
    || input.sizeBytes < 37 + 29 * input.frameCount
    || typeof input.headerSha256 !== 'string' || !SHA256.test(input.headerSha256)
    || typeof input.manifestSha256 !== 'string' || !SHA256.test(input.manifestSha256)
    || !Number.isSafeInteger(input.entryCount) || input.entryCount < 4
    || !Number.isSafeInteger(input.tableCount)
    || input.tableCount !== listArchiveInventoryForSchema(13).length) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_REQUEST_INVALID',
      'Archive verification version, epoch, size, or ciphertext identity is invalid.',
    )
  }
  if ((input.protectedFinalizationEpoch !== null
      && (!Number.isSafeInteger(input.protectedFinalizationEpoch)
        || input.protectedFinalizationEpoch < 1))
    || (input.archiveKind === 'finalized_recovery'
      && input.protectedFinalizationEpoch === null)) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_REQUEST_INVALID',
      'Archive verification protected finalization epoch is invalid.',
    )
  }
  if (input.archiveRelativePath !== `${input.archiveId}.sararch`) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_REQUEST_INVALID',
      'Archive verification must read the exact flat final custody path.',
    )
  }
  if (!['finalized', 'direct', 'finalized_recovery'].includes(input.archiveKind)
    || typeof input.createdAt !== 'string' || Number.isNaN(Date.parse(input.createdAt))
    || new Date(input.createdAt).toISOString() !== input.createdAt
    || (input.previousArchiveSha256 !== null
      && (typeof input.previousArchiveSha256 !== 'string'
        || !SHA256.test(input.previousArchiveSha256)))) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_REQUEST_INVALID',
      'Archive verification kind, creation time, or predecessor identity is invalid.',
    )
  }
  return Object.freeze({
    ...input,
    archivePath: resolveArchivePath(input.archiveDirectory, input.archiveRelativePath),
  })
}

/** Throws cancellation at bounded verification checkpoints. */
function assertNotCancelled(cancellationFlag) {
  if (!(cancellationFlag instanceof Int32Array) || cancellationFlag.length !== 1) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_REQUEST_INVALID',
      'Archive verification cancellation state is invalid.',
    )
  }
  if (Atomics.load(cancellationFlag, 0) !== 0) {
    throw new ArchiveVerifyError('ARCHIVE_CANCELLED', 'Mission archive verification was cancelled.')
  }
}

/** Opens and pins one regular archive file without following a final symlink. */
function openPinnedArchive(request) {
  try {
    return openPinnedCustodyFile({
      archiveDirectory: request.archiveDirectory,
      archiveRelativePath: request.archiveRelativePath,
    })
  } catch (error) {
    throw new ArchiveVerifyError(
      error?.code === 'ARCHIVE_CUSTODY_IDENTITY_CHANGED'
        ? 'ARCHIVE_VERIFY_ARCHIVE_CHANGED'
        : 'ARCHIVE_VERIFY_ARCHIVE_UNAVAILABLE',
      'Registered mission archive is unavailable or unsafe to open.',
    )
  }
}

/** Hashes every byte from one pinned descriptor with exact size accounting. */
function digestPinnedArchive(archive, cancellationFlag, onChunk) {
  try {
    return {
      sizeBytes: archive.sizeBytes,
      sha256: digestPinnedCustodyFile(archive, { cancellationFlag, onChunk }),
    }
  } catch (error) {
    if (error?.code === 'ARCHIVE_CUSTODY_CANCELLED') {
      throw new ArchiveVerifyError('ARCHIVE_CANCELLED', 'Mission archive verification was cancelled.')
    }
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_ARCHIVE_CHANGED',
      'Registered mission archive changed during its ciphertext proof.',
    )
  }
}

/** Creates a bounded positional byte iterator without transferring descriptor ownership. */
async function* streamPinnedArchive(descriptor) {
  let offset = 0
  while (true) {
    const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES)
    const bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, offset)
    if (bytesRead === 0) {
      chunk.fill(0)
      return
    }
    offset += bytesRead
    if (bytesRead === chunk.length) {
      yield chunk
    } else {
      const finalChunk = Buffer.from(chunk.subarray(0, bytesRead))
      chunk.fill(0)
      yield finalChunk
    }
  }
}

/** Reads one exact positional range without allowing a preamble read to cross into frame zero. */
function readPinnedRangeExactly(descriptor, position, length) {
  const bytes = Buffer.alloc(length)
  let completed = 0
  while (completed < length) {
    const bytesRead = fs.readSync(
      descriptor,
      bytes,
      completed,
      length - completed,
      position + completed,
    )
    if (bytesRead === 0) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_ARCHIVE_CHANGED',
        'Registered mission archive preamble is truncated.',
      )
    }
    completed += bytesRead
  }
  return bytes
}

/**
 * Yields only the exact length-prefixed preamble fields. The container parser validates
 * each declared bound before it asks this iterator for the following field.
 */
async function* streamPinnedPreamble(descriptor) {
  let position = 0
  const fixedPrefix = readPinnedRangeExactly(descriptor, position, 12)
  position += fixedPrefix.length
  yield fixedPrefix

  const headerLength = fixedPrefix.readUInt32BE(8)
  const header = readPinnedRangeExactly(descriptor, position, headerLength)
  position += header.length
  yield header

  const slotLengthBytes = readPinnedRangeExactly(descriptor, position, 4)
  position += slotLengthBytes.length
  yield slotLengthBytes

  const slotLength = slotLengthBytes.readUInt32BE(0)
  yield readPinnedRangeExactly(descriptor, position, slotLength)
}

/** Reads the exact bounded preamble from a second descriptor pinned to the same inode. */
async function readPinnedPreamble(request, archive) {
  let second
  try {
    second = openPinnedCustodyFile({
      archiveDirectory: request.archiveDirectory,
      archiveRelativePath: request.archiveRelativePath,
    })
    if (JSON.stringify(second.fileIdentity) !== JSON.stringify(archive.fileIdentity)) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_ARCHIVE_CHANGED',
        'Registered mission archive changed before its key slots were read.',
      )
    }
    return await readArchivePreamble(streamPinnedPreamble(second.descriptor))
  } finally {
    if (second !== null && second !== undefined) fs.closeSync(second.descriptor)
  }
}

/** Validates the public header against the registry-bound verification request. */
function validateBoundHeader(preamble, request) {
  const header = preamble.header
  if (
    header.container_version !== request.containerVersion
    || header.schema_version !== request.schemaVersion
    || header.inventory_version !== request.inventoryVersion
    || header.mission_id !== request.missionId
    || header.request_event_rowid !== request.requestEventRowid
    || header.request_event_id !== request.requestEventId
    || header.creation_operation_id !== request.creationOperationId
    || header.protected_finalization_epoch !== request.protectedFinalizationEpoch
    || header.created_at !== request.createdAt
    || header.previous_archive_sha256 !== request.previousArchiveSha256
    || preamble.headerDigest.toString('hex') !== request.headerSha256
  ) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_IDENTITY_MISMATCH',
      'Mission archive header does not match its registered identity.',
    )
  }
  const passphraseSlots = preamble.keySlots.filter((slot) => slot.slotType === 'passphrase')
  const recoverySlots = preamble.keySlots.filter((slot) => slot.slotType === 'recovery')
  if (preamble.keySlots.length !== 2 || passphraseSlots.length !== 1 || recoverySlots.length !== 1) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_SLOT_MISMATCH',
      'Mission archive does not contain exactly one passphrase and one recovery slot.',
    )
  }
  return { passphraseSlot: passphraseSlots[0], recoverySlot: recoverySlots[0] }
}

/** Unwraps both mandatory slots and requires one identical archive key before payload I/O. */
async function unwrapBothSlots(preamble, request, passphraseBytes, recoveryCodeBytes) {
  const { passphraseSlot, recoverySlot } = validateBoundHeader(preamble, request)
  let passphraseKey
  let recoveryKey
  try {
    try {
      try {
        passphraseKey = await unwrapMissionArchiveKey({
          slot: passphraseSlot,
          secret: passphraseBytes,
          headerDigest: preamble.headerDigest,
        })
      } finally {
        zeroBuffer(passphraseBytes)
      }
      let recoveryCode = ''
      try {
        recoveryCode = normalizeRecoveryCode(recoveryCodeBytes.toString('utf8'))
        recoveryKey = await unwrapMissionArchiveKey({
          slot: recoverySlot,
          secret: recoveryCode,
          headerDigest: preamble.headerDigest,
        })
      } finally {
        recoveryCode = ''
        zeroBuffer(recoveryCodeBytes)
      }
    } catch {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_WRONG_KEY',
        'Mission archive passphrase or recovery code is incorrect.',
      )
    }
    if (!timingSafeEqual(passphraseKey, recoveryKey)) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_SLOT_MISMATCH',
        'Mission archive key slots do not unwrap to the same archive key.',
      )
    }
    return Buffer.from(passphraseKey)
  } finally {
    if (passphraseKey !== undefined) zeroBuffer(passphraseKey)
    if (recoveryKey !== undefined) zeroBuffer(recoveryKey)
  }
}

/** Requires conservative scratch capacity before writing any decrypted payload. */
function assertVerificationDiskPreflight(request) {
  const requiredBytes = Math.max(
    64 * 1024 * 1024,
    Math.ceil(request.sizeBytes * 1.2) + 16 * 1024 * 1024,
  )
  const capacity = fs.statfsSync(request.archiveDirectory)
  const availableBytes = Number(BigInt(capacity.bavail) * BigInt(capacity.bsize))
  if (!Number.isSafeInteger(availableBytes) || availableBytes < requiredBytes) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_DISK_FULL',
      'Mission archive verification storage has insufficient free space.',
    )
  }
}

/** Creates one owner-only verification operation directory after both slots pass. */
function createVerificationDirectory(request) {
  const root = path.join(request.archiveDirectory, '.verification')
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const rootStat = fs.lstatSync(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_SCOPE_INVALID',
      'Mission archive verification directory is unsafe.',
    )
  }
  fs.chmodSync(root, 0o700)
  const operationDirectory = path.join(root, request.operationId)
  fs.mkdirSync(operationDirectory, { recursive: false, mode: 0o700 })
  fs.chmodSync(operationDirectory, 0o700)
  return operationDirectory
}

/** Durably removes only the current verification operation scratch directory. */
function removeVerificationDirectory(operationDirectory) {
  if (operationDirectory === null) return
  const root = path.dirname(operationDirectory)
  fs.rmSync(operationDirectory, { recursive: true, force: true })
  if (fs.existsSync(operationDirectory)) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_PLAINTEXT_CLEANUP_FAILED',
      'Mission archive verification plaintext cleanup did not complete.',
    )
  }
  if (fs.existsSync(root)) {
    const descriptor = fs.openSync(root, fs.constants.O_RDONLY)
    try {
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
  }
}

/** Validates one manifest entry proof and returns its closed projection. */
function validateEntryProof(value, label) {
  requireExactKeys(value, ['name', 'sha256', 'size_bytes'], label)
  if (
    typeof value.name !== 'string'
    || value.name.length < 1
    || path.isAbsolute(value.name)
    || value.name.includes('\\')
    || value.name.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    || !Number.isSafeInteger(value.size_bytes)
    || value.size_bytes < 1
    || typeof value.sha256 !== 'string'
    || !SHA256.test(value.sha256)
  ) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_MANIFEST_INVALID',
      `${label} has an invalid name, size, or digest.`,
    )
  }
  return value
}

/** Validates the encrypted manifest's closed identity and exhaustive collections. */
function validateManifest(manifest, request, header) {
  requireExactKeys(manifest, MANIFEST_KEYS, 'Mission archive manifest')
  if (
    manifest.manifest_version !== 1
    || manifest.archive_id !== request.archiveId
    || manifest.archive_kind !== request.archiveKind
    || manifest.mission_id !== request.missionId
    || manifest.request_event_rowid !== request.requestEventRowid
    || manifest.request_event_id !== request.requestEventId
    || manifest.creation_operation_id !== request.creationOperationId
    || manifest.protected_finalization_epoch !== request.protectedFinalizationEpoch
    || manifest.schema_version !== request.schemaVersion
    || manifest.inventory_version !== request.inventoryVersion
    || manifest.created_at !== request.createdAt
    || manifest.previous_archive_sha256 !== request.previousArchiveSha256
    || typeof manifest.inventory_sha256 !== 'string'
    || !SHA256.test(manifest.inventory_sha256)
  ) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_IDENTITY_MISMATCH',
      'Mission archive manifest does not match its registered identity.',
    )
  }
  if (!Array.isArray(manifest.entries) || !Array.isArray(manifest.tables)
    || !Array.isArray(manifest.attachments) || !isPlainRecord(manifest.gpx_content)) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_MANIFEST_INVALID',
      'Mission archive manifest collections are invalid.',
    )
  }
  requireExactKeys(
    manifest.gpx_content,
    [
      'exact_bytes_count',
      'failure_unavailable_count',
      'legacy_hash_only_count',
      'legacy_unavailable_count',
      'proof_version',
      'record_count',
      'records',
      'records_sha256',
    ],
    'Mission archive GPX proof',
  )
  if (manifest.gpx_content.proof_version !== 1
    || !Array.isArray(manifest.gpx_content.records)
    || !Number.isSafeInteger(manifest.gpx_content.record_count)
    || manifest.gpx_content.record_count !== manifest.gpx_content.records.length
    || typeof manifest.gpx_content.records_sha256 !== 'string'
    || !SHA256.test(manifest.gpx_content.records_sha256)) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_MANIFEST_INVALID',
      'Mission archive GPX proof is invalid.',
    )
  }
  const entries = manifest.entries.map((entry, index) =>
    validateEntryProof(entry, `Mission archive entry proof ${index}`))
  const entryNames = entries.map((entry) => entry.name)
  if (new Set(entryNames).size !== entryNames.length
    || entryNames[0] !== 'mission.json'
    || entryNames[1] !== 'inventory.json'
    || entryNames[2] !== 'mission-store.sqlite') {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_MANIFEST_INVALID',
      'Mission archive entry proof order or fixed entries are invalid.',
    )
  }
  const declarations = listArchiveInventoryForSchema(request.schemaVersion)
  if (manifest.tables.length !== declarations.length) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_MANIFEST_INVALID',
      'Mission archive table proof count does not match the schema inventory.',
    )
  }
  manifest.tables.forEach((proof, index) => {
    requireExactKeys(
      proof,
      ['content_sha256', 'decision', 'row_count', 'table_name'],
      `Mission archive table proof ${index}`,
    )
    const declaration = declarations[index]
    if (proof.table_name !== declaration.tableName || proof.decision !== declaration.decision
      || !Number.isSafeInteger(proof.row_count) || proof.row_count < 0
      || typeof proof.content_sha256 !== 'string' || !SHA256.test(proof.content_sha256)) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_MANIFEST_INVALID',
        'Mission archive table proof does not match the authoritative inventory.',
      )
    }
  })
  manifest.attachments.forEach((attachment, index) => {
    requireExactKeys(
      attachment,
      ['attachment_id', 'custody_class', 'entry_name', 'references', 'sha256', 'size_bytes', 'source_relative_path'],
      `Mission archive attachment proof ${index}`,
    )
    if (!['v2_digest', 'legacy_path_only'].includes(attachment.custody_class)
      || typeof attachment.entry_name !== 'string' || !attachment.entry_name.startsWith('attachments/')
      || typeof attachment.source_relative_path !== 'string'
      || path.basename(attachment.source_relative_path) !== attachment.source_relative_path
      || !Number.isSafeInteger(attachment.size_bytes) || attachment.size_bytes < 1
      || typeof attachment.sha256 !== 'string' || !SHA256.test(attachment.sha256)
      || !Array.isArray(attachment.references)) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_MANIFEST_INVALID',
        'Mission archive attachment proof is invalid.',
      )
    }
    for (const reference of attachment.references) {
      requireExactKeys(reference, ['reference_id', 'reference_kind'], 'Mission archive attachment reference')
      normalizeId(reference.reference_id, 'Mission archive attachment reference ID')
      normalizeId(reference.reference_kind, 'Mission archive attachment reference kind')
    }
  })
  const attachmentEntryNames = manifest.attachments.map((attachment) => attachment.entry_name)
  if (canonicalJson(entryNames.slice(3)) !== canonicalJson(attachmentEntryNames)) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_MANIFEST_INVALID',
      'Mission archive attachment entries do not match the entry inventory.',
    )
  }
  verifyArchiveAttachmentEntryProofs({
    attachments: manifest.attachments,
    entries: entries.slice(3),
  })
  requireExactKeys(
    manifest.schema_ledger,
    ['indexCount', 'sha256', 'tableCount', 'triggerCount'],
    'Mission archive schema ledger',
  )
  if (!Number.isSafeInteger(manifest.schema_ledger.tableCount)
    || !Number.isSafeInteger(manifest.schema_ledger.indexCount)
    || !Number.isSafeInteger(manifest.schema_ledger.triggerCount)
    || typeof manifest.schema_ledger.sha256 !== 'string'
    || !SHA256.test(manifest.schema_ledger.sha256)) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_MANIFEST_INVALID',
      'Mission archive schema ledger is invalid.',
    )
  }
  requireExactKeys(
    manifest.replay_semantic_proof,
    ['proof_version', 'sample_count', 'sample_strategy', 'samples'],
    'Mission archive replay semantic proof',
  )
  if (manifest.replay_semantic_proof.proof_version !== 3
    || manifest.replay_semantic_proof.sample_strategy
      !== 'mission-start-finish-fence-midpoints-exhaustive-pages-and-outing-filters-v3'
    || !Number.isSafeInteger(manifest.replay_semantic_proof.sample_count)
    || manifest.replay_semantic_proof.sample_count < 1
    || !Array.isArray(manifest.replay_semantic_proof.samples)
    || manifest.replay_semantic_proof.samples.length !== manifest.replay_semantic_proof.sample_count) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_MANIFEST_INVALID',
      'Mission archive replay semantic proof is invalid.',
    )
  }
  return Object.freeze({ ...manifest, entries: Object.freeze(entries) })
}

/** Pins one plain directory identity without following a leaf symlink. */
function pinOutputDirectory(directory) {
  const stat = fs.lstatSync(directory)
  const realPath = fs.realpathSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_SCRATCH_REBOUND',
      'Mission archive verification scratch changed identity.',
    )
  }
  return Object.freeze({ dev: stat.dev, ino: stat.ino, realPath })
}

/** Requires one directory path to retain its already-pinned identity. */
function assertOutputDirectory(directory, identity) {
  let observed
  let realPath
  try {
    observed = fs.lstatSync(directory)
    realPath = fs.realpathSync(directory)
  } catch (error) {
    const failure = new ArchiveVerifyError(
      'ARCHIVE_VERIFY_SCRATCH_REBOUND',
      'Mission archive verification scratch changed identity.',
    )
    failure.cause = error
    throw failure
  }
  if (!observed.isDirectory() || observed.isSymbolicLink()
    || observed.dev !== identity.dev || observed.ino !== identity.ino
    || realPath !== identity.realPath) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_SCRATCH_REBOUND',
      'Mission archive verification scratch changed identity.',
    )
  }
}

/** Requires one opened output descriptor and path to retain the same inode. */
function assertOutputFile(output, operationDirectory, operationIdentity) {
  assertOutputDirectory(operationDirectory, operationIdentity)
  assertOutputDirectory(output.directoryPath, output.directoryIdentity)
  let descriptorStat
  let pathStat
  try {
    descriptorStat = fs.fstatSync(output.descriptor)
    pathStat = fs.lstatSync(output.path)
  } catch (error) {
    const failure = new ArchiveVerifyError(
      'ARCHIVE_VERIFY_SCRATCH_REBOUND',
      'Mission archive verification output changed identity.',
    )
    failure.cause = error
    throw failure
  }
  if (!descriptorStat.isFile() || !pathStat.isFile() || pathStat.isSymbolicLink()
    || descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_SCRATCH_REBOUND',
      'Mission archive verification output changed identity.',
    )
  }
}

/** Opens one safe output file inside the owned verification directory. */
function openOutputFile(operationDirectory, operationIdentity, entryName) {
  const outputPath = path.resolve(operationDirectory, entryName)
  if (!outputPath.startsWith(`${operationDirectory}${path.sep}`)) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_ENTRY_MISMATCH',
      'Mission archive entry escapes verification scratch.',
    )
  }
  assertOutputDirectory(operationDirectory, operationIdentity)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 })
  assertOutputDirectory(operationDirectory, operationIdentity)
  const directoryPath = path.dirname(outputPath)
  const directoryIdentity = directoryPath === operationDirectory
    ? operationIdentity
    : pinOutputDirectory(directoryPath)
  const descriptor = fs.openSync(
    outputPath,
    fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL
      | (fs.constants.O_NOFOLLOW ?? 0),
    0o600,
  )
  const output = {
    path: outputPath,
    descriptor,
    directoryPath,
    directoryIdentity,
  }
  assertOutputFile(output, operationDirectory, operationIdentity)
  return output
}

/** Decrypts every authenticated entry into bounded metadata or owned scratch files. */
async function extractAndProveEntries(input) {
  let manifest = null
  let current = null
  let completed = false
  let decryptedBytes = 0
  const metadata = new Map()
  const operationIdentity = pinOutputDirectory(input.operationDirectory)
  const outputs = []
  const onEntryStart = (entry) => {
    assertNotCancelled(input.cancellationFlag)
    if (current !== null) {
      throw new ArchiveVerifyError('ARCHIVE_VERIFY_ENTRY_MISMATCH', 'Mission archive entries overlap.')
    }
    if (entry.index === 0) {
      if (entry.name !== 'manifest.json' || entry.size > BigInt(MAX_MANIFEST_BYTES)) {
        throw new ArchiveVerifyError(
          'ARCHIVE_VERIFY_MANIFEST_INVALID',
          'Mission archive manifest is missing or exceeds its safe bound.',
        )
      }
      current = { entry, hash: createHash('sha256'), observed: 0, chunks: [] }
      return
    }
    if (manifest === null || entry.index - 1 >= manifest.entries.length) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_ENTRY_MISMATCH',
        'Mission archive contains an undeclared entry.',
      )
    }
    const expected = manifest.entries[entry.index - 1]
    if (entry.name !== expected.name || entry.size !== BigInt(expected.size_bytes)) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_ENTRY_MISMATCH',
        'Mission archive entry name, order, or size differs from its manifest.',
      )
    }
    if (['mission.json', 'inventory.json'].includes(entry.name)) {
      if (entry.size > BigInt(MAX_METADATA_ENTRY_BYTES)) {
        throw new ArchiveVerifyError(
          'ARCHIVE_VERIFY_ENTRY_MISMATCH',
          'Mission archive metadata entry exceeds its safe bound.',
        )
      }
      current = { entry, expected, hash: createHash('sha256'), observed: 0, chunks: [] }
      return
    }
    const output = openOutputFile(input.operationDirectory, operationIdentity, entry.name)
    outputs.push(output)
    current = {
      entry,
      expected,
      hash: createHash('sha256'),
      observed: 0,
      output,
    }
  }
  const onEntryChunk = (_entry, chunk) => {
    assertNotCancelled(input.cancellationFlag)
    if (current === null) {
      throw new ArchiveVerifyError('ARCHIVE_VERIFY_ENTRY_MISMATCH', 'Mission archive entry state is invalid.')
    }
    current.hash.update(chunk)
    current.observed += chunk.length
    decryptedBytes += chunk.length
    input.onDecryptProgress?.(decryptedBytes)
    if (!Number.isSafeInteger(current.observed)) {
      throw new ArchiveVerifyError('ARCHIVE_VERIFY_ENTRY_MISMATCH', 'Mission archive entry is too large.')
    }
    if (current.chunks !== undefined) current.chunks.push(Buffer.from(chunk))
    else {
      assertOutputFile(current.output, input.operationDirectory, operationIdentity)
      fs.writeSync(current.output.descriptor, chunk)
      assertOutputFile(current.output, input.operationDirectory, operationIdentity)
    }
  }
  const onEntryEnd = (entry) => {
    if (current === null || current.entry.index !== entry.index) {
      throw new ArchiveVerifyError('ARCHIVE_VERIFY_ENTRY_MISMATCH', 'Mission archive entry state is invalid.')
    }
    const observedSha256 = current.hash.digest('hex')
    if (entry.index === 0) {
      const manifestBytes = Buffer.concat(current.chunks)
      try {
        manifest = validateManifest(
          parseCanonicalJson(manifestBytes, 'Mission archive manifest'),
          input.request,
          input.header,
        )
      } finally {
        manifestBytes.fill(0)
        current.chunks.forEach((chunk) => chunk.fill(0))
      }
    } else {
      if (current.observed !== current.expected.size_bytes
        || observedSha256 !== current.expected.sha256) {
        throw new ArchiveVerifyError(
          'ARCHIVE_VERIFY_ENTRY_MISMATCH',
          'Mission archive entry bytes do not match their encrypted manifest.',
        )
      }
      if (current.output !== undefined) {
        fs.fsyncSync(current.output.descriptor)
        assertOutputFile(current.output, input.operationDirectory, operationIdentity)
      } else {
        metadata.set(entry.name, Buffer.concat(current.chunks))
        current.chunks.forEach((chunk) => chunk.fill(0))
      }
    }
    current = null
  }
  try {
    const result = await readArchiveContainer({
      readable: input.readable,
      missionArchiveKey: input.missionArchiveKey,
      onEntryStart,
      onEntryChunk,
      onEntryEnd,
    })
    if (manifest === null || result.entryCount !== manifest.entries.length + 1) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_ENTRY_MISMATCH',
        'Mission archive entry count differs from its encrypted manifest.',
      )
    }
    assertOutputDirectory(input.operationDirectory, operationIdentity)
    for (const output of outputs) {
      assertOutputFile(output, input.operationDirectory, operationIdentity)
    }
    completed = true
    return {
      result,
      manifest,
      metadata,
      outputOwnership: {
        operationDirectory: input.operationDirectory,
        operationIdentity,
        outputs,
        settled: false,
      },
    }
  } finally {
    if (!completed) {
      for (const output of outputs) {
        if (output.descriptor === null) continue
        try { fs.ftruncateSync(output.descriptor, 0) } catch {}
        try { fs.fsyncSync(output.descriptor) } catch {}
        try { fs.closeSync(output.descriptor) } catch {}
        output.descriptor = null
      }
    }
    if (current?.chunks !== undefined) current.chunks.forEach((chunk) => chunk.fill(0))
    if (!completed) metadata.forEach((buffer) => buffer.fill(0))
  }
}

/** Settles retained verification outputs, zeroing exact opened inodes unless preserved. */
function settleExtractedOutputs(extracted, preservePlaintext) {
  const ownership = extracted?.outputOwnership
  if (ownership === undefined || ownership.settled) return
  if (!preservePlaintext) {
    for (const output of ownership.outputs) {
      if (output.descriptor === null) continue
      try { fs.ftruncateSync(output.descriptor, 0) } catch {}
      try { fs.fsyncSync(output.descriptor) } catch {}
    }
  }
  for (const output of ownership.outputs) {
    if (output.descriptor === null) continue
    try { fs.closeSync(output.descriptor) } catch {}
    output.descriptor = null
  }
  ownership.settled = true
}

/** Returns the final worker-pinned restored database identity after a full path recheck. */
function getRestoredDatabaseIdentity(extracted) {
  const ownership = extracted?.outputOwnership
  const databaseOutput = ownership?.outputs.find(
    (output) => path.basename(output.path) === 'mission-store.sqlite',
  )
  if (databaseOutput === undefined || databaseOutput.descriptor === null) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_SCRATCH_REBOUND',
      'Mission archive restored database identity is unavailable.',
    )
  }
  assertOutputFile(
    databaseOutput,
    ownership.operationDirectory,
    ownership.operationIdentity,
  )
  const observed = fs.fstatSync(databaseOutput.descriptor)
  if (!observed.isFile() || !Number.isSafeInteger(observed.dev)
    || !Number.isSafeInteger(observed.ino) || !Number.isSafeInteger(observed.size)
    || observed.dev < 0 || observed.ino < 1 || observed.size < 1) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_SCRATCH_REBOUND',
      'Mission archive restored database identity is invalid.',
    )
  }
  return Object.freeze({ dev: observed.dev, ino: observed.ino, sizeBytes: observed.size })
}

/** Recomputes the restored SQLite schema ledger used by the creator. */
function computeSchemaLedger(db) {
  const rows = db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE type IN ('table', 'index', 'trigger')
      AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
    ORDER BY type, name`).all()
  const canonicalRows = rows.map((row) => ({
    name: row.name,
    sql: row.sql,
    tableName: row.tbl_name,
    type: row.type,
  }))
  return {
    tableCount: canonicalRows.filter((row) => row.type === 'table').length,
    indexCount: canonicalRows.filter((row) => row.type === 'index').length,
    triggerCount: canonicalRows.filter((row) => row.type === 'trigger').length,
    sha256: createHash('sha256').update(JSON.stringify(canonicalRows), 'utf8').digest('hex'),
  }
}

/** Compares the database-only attachment ledger with manifest and extracted files. */
function verifyAttachmentLedger(db, request, manifest) {
  const ledger = readArchiveAttachmentReferenceLedger({
    db,
    databasePath: request.databasePath,
    missionId: request.missionId,
    restored: true,
  })
  if (ledger.length !== manifest.attachments.length) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_ATTACHMENT_MISMATCH',
      'Mission archive attachment reference count differs from its manifest.',
    )
  }
  ledger.forEach((record, index) => {
    const proof = manifest.attachments[index]
    const expectedId = record.custody?.attachmentId
      ?? `legacy-${createHash('sha256').update(record.sourceRelativePath, 'utf8').digest('hex').slice(0, 32)}`
    const references = record.references.map((reference) => ({
      reference_id: reference.referenceId,
      reference_kind: reference.referenceKind,
    }))
    if (
      proof.attachment_id !== expectedId
      || proof.source_relative_path !== record.sourceRelativePath
      || proof.custody_class !== (record.custody === null ? 'legacy_path_only' : 'v2_digest')
      || canonicalJson(proof.references) !== canonicalJson(references)
      || (record.custody !== null && (
        proof.size_bytes !== record.custody.sizeBytes || proof.sha256 !== record.custody.sha256
      ))
    ) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_ATTACHMENT_MISMATCH',
        'Mission archive attachment custody differs from restored evidence.',
      )
    }
  })
  return ledger.length
}

/** Requires one database snapshot to retain the archive's exact request identity. */
function assertReplayRequestIdentity(db, request) {
  const requestEvent = db.prepare(`SELECT rowid AS event_rowid, id, mission_id,
      event_type, details_json
    FROM mission_events
    WHERE id = ?`).get(request.requestEventId)
  const expectedRequestEventType = request.archiveKind === 'finalized'
    ? 'mission_finalize_requested'
    : 'mission_archive_requested'
  if (requestEvent?.id !== request.requestEventId
    || Number(requestEvent.event_rowid) !== request.requestEventRowid
    || requestEvent.mission_id !== request.missionId
    || requestEvent.event_type !== expectedRequestEventType) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_SCOPE_MISMATCH',
      'Mission archive request epoch does not match its bound database snapshot.',
    )
  }
  let requestDetails
  try {
    requestDetails = JSON.parse(requestEvent.details_json)
  } catch {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_SCOPE_MISMATCH',
      'Mission archive request event details are invalid.',
    )
  }
  if (requestDetails?.archive_id !== request.archiveId
    || requestDetails?.archive_kind !== request.archiveKind
    || requestDetails?.archive_relative_path !== request.archiveRelativePath
    || requestDetails?.operation_id !== request.creationOperationId
    || requestDetails?.protected_finalization_epoch !== request.protectedFinalizationEpoch) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_SCOPE_MISMATCH',
      'Mission archive request event does not bind its complete identity.',
    )
  }
  if (request.protectedFinalizationEpoch !== null) {
    const protectedEvent = db.prepare(`SELECT rowid AS event_rowid, mission_id, event_type
      FROM mission_events WHERE rowid = ?`).get(request.protectedFinalizationEpoch)
    const latestFinalized = db.prepare(`SELECT rowid AS event_rowid
      FROM mission_events
      WHERE mission_id = ? AND event_type = 'mission_finalized'
      ORDER BY rowid DESC LIMIT 1`).get(request.missionId)
    if (protectedEvent?.mission_id !== request.missionId
      || protectedEvent?.event_type !== 'mission_finalized'
      || Number(protectedEvent.event_rowid) !== request.protectedFinalizationEpoch
      || Number(latestFinalized?.event_rowid) !== request.protectedFinalizationEpoch) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_SCOPE_MISMATCH',
        'Mission archive protected finalization epoch is not current.',
      )
    }
  }
}

/** Computes Replay semantics from one independently opened pinned live-store snapshot. */
function computePinnedLiveReplayProof(input) {
  let live
  try {
    live = new Database(input.request.databasePath, { readonly: true, fileMustExist: true })
    live.pragma('query_only = ON')
  } catch {
    try { live?.close() } catch {}
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_LIVE_STORE_UNAVAILABLE',
      'Mission archive verification could not open the live evidence store safely.',
    )
  }
  try {
    const calculate = live.transaction(() => {
      assertNotCancelled(input.cancellationFlag)
      assertReplayRequestIdentity(live, input.request)
      return computeMissionReplaySemanticProof(live, {
        missionId: input.request.missionId,
        requestEventId: input.request.requestEventId,
        archiveKind: input.request.archiveKind,
        isCancelled: () => Atomics.load(input.cancellationFlag, 0) !== 0,
        onSample: input.onSample,
        onProgress: input.onProgress,
      })
    })
    return calculate()
  } catch (error) {
    if (error instanceof ArchiveVerifyError || error?.code === 'ARCHIVE_CANCELLED'
      || (typeof error?.code === 'string' && error.code.startsWith('ARCHIVE_REPLAY_'))) {
      throw error
    }
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_LIVE_STORE_UNAVAILABLE',
      'Mission archive verification could not read the live evidence store safely.',
    )
  } finally {
    live.close()
  }
}

/** Converts one local row counter into a monotonic verification-phase counter. */
function createVerifyRowProgressForwarder(input, phase) {
  let phaseRows = 0
  return (detail) => {
    let localRows = 0
    return (progress) => {
      if (!Number.isSafeInteger(progress?.rowsProcessed)
        || progress.rowsProcessed < 1 || progress.rowsProcessed <= localRows
        || phaseRows > Number.MAX_SAFE_INTEGER - (progress.rowsProcessed - localRows)) {
        throw new ArchiveVerifyError(
          'ARCHIVE_VERIFY_FAILED',
          'Mission archive verification row progress is invalid.',
        )
      }
      phaseRows += progress.rowsProcessed - localRows
      localRows = progress.rowsProcessed
      input.emitProgress(phase, 'rows', phaseRows, null, detail)
    }
  }
}

/** Exhaustively proves restored SQLite, inventory, content and sampled replay semantics. */
function verifyRestoredEvidence(input) {
  const restoredPath = path.join(input.operationDirectory, 'mission-store.sqlite')
  const restored = new Database(restoredPath, { readonly: true, fileMustExist: true })
  try {
    restored.pragma('query_only = ON')
    const restoredSizeBytes = Math.max(1, fs.statSync(restoredPath).size)
    input.emitProgress('sqlite', 'bytes', 0, restoredSizeBytes, 'restored-integrity')
    const integrity = restored.prepare('PRAGMA integrity_check').get()
    if (integrity?.integrity_check !== 'ok') {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_SQLITE_INVALID',
        'Mission archive restored database failed SQLite integrity verification.',
      )
    }
    reconcileArchiveInventory(restored, { schemaVersion: input.request.schemaVersion })
    input.emitProgress(
      'sqlite', 'bytes', restoredSizeBytes, restoredSizeBytes, 'restored-integrity',
    )
    const inventoryBytes = input.metadata.get('inventory.json')
    const missionBytes = input.metadata.get('mission.json')
    if (inventoryBytes === undefined || missionBytes === undefined) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_ENTRY_MISMATCH',
        'Mission archive is missing required metadata entries.',
      )
    }
    const inventoryDocument = parseCanonicalJson(inventoryBytes, 'Mission archive inventory')
    const expectedInventory = createArchiveInventoryDocument({
      schemaVersion: input.request.schemaVersion,
    })
    if (canonicalJson(inventoryDocument) !== canonicalJson(expectedInventory)
      || digestArchiveInventoryDocument(inventoryDocument) !== input.manifest.inventory_sha256) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_INVENTORY_MISMATCH',
        'Mission archive inventory document differs from the authoritative inventory.',
      )
    }
    const missions = restored.prepare('SELECT * FROM missions ORDER BY id').all()
    if (missions.length !== 1 || missions[0].id !== input.request.missionId
      || canonicalJson(missions[0]) !== canonicalJson(
        parseCanonicalJson(missionBytes, 'Mission archive mission identity'),
      )) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_SCOPE_MISMATCH',
        'Mission archive restored database contains the wrong mission scope.',
      )
    }
    assertReplayRequestIdentity(restored, input.request)
    if (canonicalJson(computeSchemaLedger(restored)) !== canonicalJson(input.manifest.schema_ledger)) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_SCHEMA_MISMATCH',
        'Mission archive restored schema differs from its authenticated ledger.',
      )
    }
    const forwardInventoryRows = createVerifyRowProgressForwarder(input, 'inventory')
    input.emitProgress('inventory', 'rows', 0, null, 'restored-tables')
    const tableProofs = input.manifest.tables.map((expected) => {
      assertNotCancelled(input.cancellationFlag)
      const observed = computeArchivedTableContentDigest(restored, {
        tableName: expected.table_name,
        schemaVersion: input.request.schemaVersion,
        isCancelled: () => Atomics.load(input.cancellationFlag, 0) !== 0,
        onProgress: forwardInventoryRows(expected.table_name),
      })
      if (observed.rowCount !== expected.row_count
        || observed.contentSha256 !== expected.content_sha256) {
        throw new ArchiveVerifyError(
          'ARCHIVE_VERIFY_TABLE_MISMATCH',
          'Mission archive restored table content differs from its authenticated manifest.',
        )
      }
      return Object.freeze({
        tableName: expected.table_name,
        rowCount: observed.rowCount,
        contentSha256: observed.contentSha256,
      })
    })
    const gpxProof = computeArchiveGpxContentProof(restored, {
      missionId: input.request.missionId,
      isCancelled: () => Atomics.load(input.cancellationFlag, 0) !== 0,
    })
    if (canonicalJson(gpxProof) !== canonicalJson(input.manifest.gpx_content)) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_GPX_MISMATCH',
        'Mission archive restored GPX source bytes differ from their authenticated manifest.',
      )
    }
    input.emitProgress('gpx', 'rows', gpxProof.record_count, gpxProof.record_count, 'source-custody')
    const attachmentCount = verifyAttachmentLedger(restored, input.request, input.manifest)
    input.emitProgress(
      'attachments',
      'files',
      attachmentCount,
      attachmentCount,
      'custody-ledger',
    )
    let replaySampleCount = 0
    const forwardReplayRows = createVerifyRowProgressForwarder(input, 'replay')
    input.emitProgress('replay', 'rows', 0, null, 'restored-semantic-pages')
    const restoredReplay = computeMissionReplaySemanticProof(restored, {
      missionId: input.request.missionId,
      requestEventId: input.request.requestEventId,
      archiveKind: input.request.archiveKind,
      isCancelled: () => Atomics.load(input.cancellationFlag, 0) !== 0,
      onSample: ({ completed, total }) => {
        void completed
        replaySampleCount = total
      },
      onProgress: forwardReplayRows('restored-semantic-pages'),
    })
    if (canonicalJson(restoredReplay) !== canonicalJson(input.manifest.replay_semantic_proof)) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_REPLAY_MISMATCH',
        'Mission archive restored replay semantics differ from the archived source proof.',
      )
    }
    const liveReplay = computePinnedLiveReplayProof({
      request: input.request,
      cancellationFlag: input.cancellationFlag,
      onSample: ({ completed, total }) => {
        void completed
        if (total !== replaySampleCount) {
          throw new ArchiveVerifyError(
            'ARCHIVE_VERIFY_REPLAY_MISMATCH',
            'Mission archive live and restored Replay sample sets differ.',
          )
        }
      },
      onProgress: forwardReplayRows('live-semantic-pages'),
    })
    if (canonicalJson(liveReplay) !== canonicalJson(restoredReplay)) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_REPLAY_MISMATCH',
        'Mission archive live Replay semantics differ from the restored archive proof.',
      )
    }
    return {
      tableCount: tableProofs.length,
      tables: Object.freeze(tableProofs),
      gpxProof,
      attachmentCount,
      replayProof: restoredReplay,
    }
  } finally {
    restored.close()
  }
}

/** Independently verifies one complete SARARCH2 file and leaves no verification plaintext. */
async function verifyMissionArchiveFile(input) {
  const startedAt = performance.now()
  const request = normalizeVerifyRequest(input?.request)
  const passphraseBytes = input?.passphraseBytes
  const recoveryCodeBytes = input?.recoveryCodeBytes
  const cancellationFlag = input?.cancellationFlag
  if (!Buffer.isBuffer(passphraseBytes) || !Buffer.isBuffer(recoveryCodeBytes)) {
    throw new ArchiveVerifyError(
      'ARCHIVE_VERIFY_REQUEST_INVALID',
      'Archive verification credentials must use mutable byte buffers.',
    )
  }
  let archive
  let missionArchiveKey
  let extracted = null
  let operationDirectory = null
  let cleanupError = null
  let progressSequence = 0
  const emitProgress = (phase, unit, completed, total, detail) => {
    progressSequence += 1
    input.onProgress?.({
      type: 'progress',
      operationId: request.operationId,
      sequence: progressSequence,
      phase,
      unit,
      completed,
      total,
      detail,
    })
  }
  try {
    assertNotCancelled(cancellationFlag)
    assertVerificationDiskPreflight(request)
    archive = openPinnedArchive(request)
    let lastCiphertextProgress = 0
    emitProgress('preflight', 'bytes', 0, request.sizeBytes, 'pinned-ciphertext')
    const pinnedDigest = digestPinnedArchive(
      archive,
      cancellationFlag,
      (completed, total) => {
        if (completed - lastCiphertextProgress >= CIPHERTEXT_DIGEST_PROGRESS_BYTES
          || completed === total) {
          emitProgress('preflight', 'bytes', completed, total, 'pinned-ciphertext')
          lastCiphertextProgress = completed
        }
      },
    )
    if (archive.sizeBytes !== request.sizeBytes || pinnedDigest.sizeBytes !== request.sizeBytes
      || pinnedDigest.sha256 !== request.ciphertextSha256) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_CIPHERTEXT_MISMATCH',
        'Registered mission archive bytes do not match their recorded identity.',
      )
    }
    const preamble = await readPinnedPreamble(request, archive)
    try {
      missionArchiveKey = await unwrapBothSlots(
        preamble,
        request,
        passphraseBytes,
        recoveryCodeBytes,
      )
    } finally {
      zeroBuffer(passphraseBytes)
      zeroBuffer(recoveryCodeBytes)
    }
    emitProgress('keys', 'files', 2, 2, 'mandatory-slots')
    operationDirectory = createVerificationDirectory(request)
    extracted = await extractAndProveEntries({
      readable: streamPinnedArchive(archive.descriptor),
      missionArchiveKey,
      operationDirectory,
      request,
      header: preamble.header,
      cancellationFlag,
      onDecryptProgress: (completed) => emitProgress(
        'decrypt',
        'bytes',
        completed,
        null,
        'authenticated-stream',
      ),
    })
    const manifestSha256 = createHash('sha256')
      .update(canonicalJson(extracted.manifest), 'utf8').digest('hex')
    if (extracted.result.ciphertextSha256 !== request.ciphertextSha256
      || extracted.result.sizeBytes !== request.sizeBytes
      || extracted.result.headerDigest !== request.headerSha256
      || Number(extracted.result.frameCount) !== request.frameCount
      || extracted.result.entryCount !== request.entryCount
      || manifestSha256 !== request.manifestSha256) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_CIPHERTEXT_MISMATCH',
        'Mission archive authenticated stream does not match its pinned identity.',
      )
    }
    emitProgress(
      'entries',
      'files',
      extracted.result.entryCount,
      extracted.result.entryCount,
      'manifest-entry-set',
    )
    const evidence = verifyRestoredEvidence({
      operationDirectory,
      request,
      manifest: extracted.manifest,
      metadata: extracted.metadata,
      cancellationFlag,
      emitProgress,
    })
    if (evidence.tableCount !== request.tableCount) {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_TABLE_MISMATCH',
        'Mission archive table proof differs from its sealed creation receipt.',
      )
    }
    extracted.metadata.forEach((buffer) => buffer.fill(0))
    try {
      assertPinnedCustodyFileUnchanged(archive)
    } catch {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_ARCHIVE_CHANGED',
        'Registered mission archive changed before verification completed.',
      )
    }
    const proof = {
      proofVersion: 1,
      exhaustive: true,
      archiveId: request.archiveId,
      archiveKind: request.archiveKind,
      archiveRelativePath: request.archiveRelativePath,
      missionId: request.missionId,
      requestEventRowid: request.requestEventRowid,
      requestEventId: request.requestEventId,
      creationOperationId: request.creationOperationId,
      protectedFinalizationEpoch: request.protectedFinalizationEpoch,
      createdAt: request.createdAt,
      previousArchiveSha256: request.previousArchiveSha256,
      containerVersion: request.containerVersion,
      schemaVersion: request.schemaVersion,
      inventoryVersion: request.inventoryVersion,
      ciphertextSha256: request.ciphertextSha256,
      sizeBytes: request.sizeBytes,
      frameCount: Number(extracted.result.frameCount),
      headerSha256: extracted.result.headerDigest,
      manifestSha256,
      custodyFileIdentity: archive.fileIdentity,
      layers: {
        ciphertext: { exhaustive: true, matched: true },
        authenticatedFrames: { exhaustive: true, matched: true },
        entries: { exhaustive: true, matched: true, count: extracted.result.entryCount },
        inventory: { exhaustive: true, matched: true, tableCount: evidence.tableCount },
        gpxSourceBytes: {
          exhaustive: true,
          matched: true,
          recordCount: evidence.gpxProof.record_count,
          exactBytesCount: evidence.gpxProof.exact_bytes_count,
          legacyHashOnlyCount: evidence.gpxProof.legacy_hash_only_count,
          legacyUnavailableCount: evidence.gpxProof.legacy_unavailable_count,
          failureUnavailableCount: evidence.gpxProof.failure_unavailable_count,
          exactSourceCustodyComplete: evidence.gpxProof.legacy_hash_only_count === 0
            && evidence.gpxProof.legacy_unavailable_count === 0
            && evidence.gpxProof.failure_unavailable_count === 0,
        },
        attachments: {
          exhaustive: true,
          matched: true,
          count: evidence.attachmentCount,
        },
      },
      replaySemantic: {
        sampled: true,
        matched: true,
        sampleCount: evidence.replayProof.sample_count,
        sampleStrategy: evidence.replayProof.sample_strategy,
        baselineSha256: createHash('sha256')
          .update(canonicalJson(evidence.replayProof), 'utf8').digest('hex'),
        samples: evidence.replayProof.samples.map((sample) => Object.freeze({
          selectedTime: sample.selected_time,
          semanticSha256: sample.semantic_sha256,
          sampledOutingFilterCount: sample.sampled_outing_filter_count,
          totalOutingFilterCount: sample.total_outing_filter_count,
          sampledObjectCount: sample.sampled_object_count,
          totalObjectCount: sample.total_object_count,
          sampledTrackCount: sample.sampled_track_count,
          totalTrackCount: sample.total_track_count,
        })),
      },
      tables: evidence.tables,
      tableLedgerSha256: createHash('sha256')
        .update(canonicalJson(evidence.tables), 'utf8').digest('hex'),
      durationMs: performance.now() - startedAt,
    }
    settleExtractedOutputs(extracted, false)
    removeVerificationDirectory(operationDirectory)
    operationDirectory = null
    emitProgress('plaintext_cleanup', 'files', 1, 1, 'verification-scratch')
    emitProgress('complete', 'phases', 1, 1, 'verified')
    return Object.freeze({ ...proof, plaintextSweepConfirmed: true })
  } catch (error) {
    if (error?.code === 'ENOSPC' || error?.code === 'SQLITE_FULL') {
      throw new ArchiveVerifyError(
        'ARCHIVE_VERIFY_DISK_FULL',
        'Mission archive verification storage ran out of space.',
      )
    }
    throw error
  } finally {
    settleExtractedOutputs(extracted, false)
    try {
      removeVerificationDirectory(operationDirectory)
    } catch (error) {
      cleanupError = error
    }
    if (archive !== undefined) {
      try { fs.closeSync(archive.descriptor) } catch {}
    }
    if (missionArchiveKey !== undefined) zeroBuffer(missionArchiveKey)
    if (extracted !== null) extracted.metadata.forEach((buffer) => buffer.fill(0))
    zeroBuffer(passphraseBytes)
    zeroBuffer(recoveryCodeBytes)
    if (cleanupError !== null) throw cleanupError
  }
}

module.exports = {
  ArchiveVerifyError,
  digestPinnedArchive,
  extractAndProveEntries,
  getRestoredDatabaseIdentity,
  openPinnedArchive,
  readPinnedPreamble,
  streamPinnedArchive,
  settleExtractedOutputs,
  validateBoundHeader,
  verifyMissionArchiveFile,
}
