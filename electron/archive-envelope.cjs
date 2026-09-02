const path = require('node:path')
const { createHash } = require('node:crypto')

const { normalizeRecoveryCode } = require('./archive-crypto.cjs')
const { normalizeCustodyFileIdentity } = require('./archive-custody-file.cjs')
const { listArchiveInventoryForSchema } = require('./archive-inventory.cjs')
const { canonicalJson } = require('./archive-container.cjs')

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u
const ARCHIVE_KINDS = new Set(['finalized', 'direct', 'finalized_recovery'])
const ARCHIVE_SCHEMA_VERSION = 13
const ARCHIVE_INVENTORY_VERSION = 1
const PROGRESS_PHASES = new Set([
  'preflight',
  'snapshot',
  'extract',
  'sqlite',
  'proof',
  'attachments',
  'digest',
  'encrypt',
  'sync',
  'plaintext_cleanup',
  'complete',
])
const PROGRESS_UNITS = new Set(['phases', 'tables', 'rows', 'files', 'bytes'])
const CREATE_REQUEST_KEYS = Object.freeze([
  'archiveDirectory',
  'archiveId',
  'archiveKind',
  'createdAt',
  'databasePath',
  'fenceRequestedAt',
  'inventoryVersion',
  'missionId',
  'operationId',
  'passphrase',
  'previousArchiveSha256',
  'protectedFinalizationEpoch',
  'recoveryCode',
  'requestEventId',
  'requestEventRowid',
  'schemaVersion',
])
const OPTIONAL_CREATE_REQUEST_KEYS = Object.freeze([
  'finalizationProjection',
  'previousArchiveId',
])
const CREATE_RESULT_KEYS = Object.freeze([
  'archiveId',
  'archiveKind',
  'ciphertextSha256',
  'containerVersion',
  'finalRelativePath',
  'frameCount',
  'headerSha256',
  'inventoryVersion',
  'kdfDurationMs',
  'manifestSummary',
  'missionId',
  'operationId',
  'plaintextSweepConfirmed',
  'protectedFinalizationEpoch',
  'requestEventId',
  'requestEventRowid',
  'schemaVersion',
  'sizeBytes',
  'slots',
  'temporaryFileIdentity',
  'temporaryRelativePath',
  'type',
])
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
  'passphrase',
  'previousArchiveSha256',
  'protectedFinalizationEpoch',
  'recoveryCode',
  'requestEventId',
  'requestEventRowid',
  'schemaVersion',
  'sizeBytes',
  'tableCount',
])
const VERIFY_PROOF_KEYS = Object.freeze([
  'archiveId',
  'archiveKind',
  'archiveRelativePath',
  'ciphertextSha256',
  'containerVersion',
  'createdAt',
  'creationOperationId',
  'custodyFileIdentity',
  'durationMs',
  'exhaustive',
  'frameCount',
  'headerSha256',
  'inventoryVersion',
  'layers',
  'manifestSha256',
  'missionId',
  'plaintextSweepConfirmed',
  'previousArchiveSha256',
  'proofVersion',
  'protectedFinalizationEpoch',
  'replaySemantic',
  'requestEventId',
  'requestEventRowid',
  'schemaVersion',
  'sizeBytes',
  'tableLedgerSha256',
  'tables',
])
const VERIFY_IDENTITY_KEYS = Object.freeze([
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
const REQUIRED_ARCHIVE_TABLE_COUNT = listArchiveInventoryForSchema(
  ARCHIVE_SCHEMA_VERSION,
).length
const VERIFY_PROGRESS_PHASES = new Set([
  'preflight',
  'keys',
  'decrypt',
  'entries',
  'sqlite',
  'inventory',
  'gpx',
  'attachments',
  'replay',
  'plaintext_cleanup',
  'complete',
])

/** Signals a malformed or substituted archive worker boundary value. */
class ArchiveEnvelopeError extends Error {
  /** Creates a stable closed-envelope failure. */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ArchiveEnvelopeError'
    this.code = code
    this.details = deepFreeze({ ...details })
  }
}

/** Recursively freezes the bounded plain values returned across the worker boundary. */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** Requires a plain record with exactly the declared keys. */
function requireExactRecord(value, keys, code, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArchiveEnvelopeError(code, `${label} must be an object.`)
  }
  const actual = Object.keys(value).sort()
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new ArchiveEnvelopeError(code, `${label} has missing or unsupported fields.`)
  }
}

/** Requires one RFC-4122 version-four internal identity. */
function normalizeUuid(value, label, code) {
  if (typeof value !== 'string' || value.length !== 36 || !UUID_V4.test(value)) {
    throw new ArchiveEnvelopeError(code, `${label} is invalid.`)
  }
  return value
}

/** Requires one bounded non-control mission identity. */
function normalizeMissionId(value, code) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 200
    || Buffer.byteLength(value, 'utf8') > 200
    || CONTROL_CHARACTERS.test(value)
  ) {
    throw new ArchiveEnvelopeError(code, 'Archive mission identity is invalid.')
  }
  return value
}

/** Requires an exact absolute filesystem path. */
function normalizeAbsolutePath(value, label, code) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 8_192
    || Buffer.byteLength(value, 'utf8') > 8_192
    || CONTROL_CHARACTERS.test(value)
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) {
    throw new ArchiveEnvelopeError(code, `${label} must be a canonical absolute path.`)
  }
  return value
}

/** Requires one canonical timestamp. */
function normalizeTimestamp(value, label, code) {
  if (
    typeof value !== 'string'
    || value.length > 64
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new ArchiveEnvelopeError(code, `${label} must be a canonical ISO-8601 timestamp.`)
  }
  return value
}

/** Requires the bounded team passphrase before it reaches a worker. */
function normalizePassphrase(value) {
  const code = 'ARCHIVE_ENVELOPE_INVALID_REQUEST'
  if (
    typeof value !== 'string'
    || value.length < 14
    || value.length > 1_024
    || Buffer.byteLength(value, 'utf8') > 1_024
    || CONTROL_CHARACTERS.test(value)
  ) {
    throw new ArchiveEnvelopeError(
      code,
      'Archive passphrase must contain at least 14 characters and fit the supported bound.',
    )
  }
  const classes = [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[^A-Za-z0-9]/u]
    .filter((pattern) => pattern.test(value)).length
  if (classes < 3) {
    throw new ArchiveEnvelopeError(
      code,
      'Archive passphrase must combine at least three character classes.',
    )
  }
  return value
}

/** Validates the optional PR5 mission-finalized event row bound to recovery archives. */
function normalizeProtectedFinalizationEpoch(value, archiveKind, code) {
  if (value === null) {
    if (archiveKind === 'finalized_recovery') {
      throw new ArchiveEnvelopeError(
        code,
        'A finalized recovery archive requires its protected finalization epoch.',
      )
    }
    return null
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ArchiveEnvelopeError(code, 'Protected finalization epoch is invalid.')
  }
  return value
}

/** Validates the exact serializable request sent to the create worker. */
function normalizeArchiveCreateRequest(input) {
  const code = 'ARCHIVE_ENVELOPE_INVALID_REQUEST'
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ArchiveEnvelopeError(code, 'Archive create request must be an object.')
  }
  const actualKeys = Object.keys(input).sort()
  const requiredKeys = [...CREATE_REQUEST_KEYS].sort()
  const allowedKeys = new Set([...requiredKeys, ...OPTIONAL_CREATE_REQUEST_KEYS])
  if (requiredKeys.some((key) => !actualKeys.includes(key))
    || actualKeys.some((key) => !allowedKeys.has(key))) {
    throw new ArchiveEnvelopeError(code, 'Archive create request has missing or unsupported fields.')
  }
  const requestEventRowid = input.requestEventRowid
  if (!Number.isSafeInteger(requestEventRowid) || requestEventRowid < 1) {
    throw new ArchiveEnvelopeError(code, 'Archive request event row identity is invalid.')
  }
  if (!ARCHIVE_KINDS.has(input.archiveKind)) {
    throw new ArchiveEnvelopeError(code, 'Archive kind is unsupported.')
  }
  if (
    input.schemaVersion !== ARCHIVE_SCHEMA_VERSION
    || input.inventoryVersion !== ARCHIVE_INVENTORY_VERSION
  ) {
    throw new ArchiveEnvelopeError(code, 'Archive schema or inventory version is unsupported.')
  }
  if (input.previousArchiveId !== undefined
    && input.previousArchiveId !== null
    && (typeof input.previousArchiveId !== 'string' || input.previousArchiveId.length < 1
      || input.previousArchiveId.length > 200 || CONTROL_CHARACTERS.test(input.previousArchiveId))) {
    throw new ArchiveEnvelopeError(code, 'Previous archive identity is invalid.')
  }
  if (
    input.previousArchiveSha256 !== null
    && (typeof input.previousArchiveSha256 !== 'string'
      || !SHA256.test(input.previousArchiveSha256))
  ) {
    throw new ArchiveEnvelopeError(code, 'Previous archive identity is invalid.')
  }
  return deepFreeze({
    operationId: normalizeUuid(input.operationId, 'Archive operation identity', code),
    archiveId: normalizeUuid(input.archiveId, 'Archive identity', code),
    databasePath: normalizeAbsolutePath(input.databasePath, 'Archive database path', code),
    archiveDirectory: normalizeAbsolutePath(
      input.archiveDirectory,
      'Archive custody directory',
      code,
    ),
    missionId: normalizeMissionId(input.missionId, code),
    requestEventRowid,
    fenceRequestedAt: normalizeTimestamp(
      input.fenceRequestedAt,
      'Archive fence request time',
      code,
    ),
    requestEventId: normalizeUuid(input.requestEventId, 'Archive request event identity', code),
    archiveKind: input.archiveKind,
    createdAt: normalizeTimestamp(input.createdAt, 'Archive creation time', code),
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    inventoryVersion: ARCHIVE_INVENTORY_VERSION,
    previousArchiveSha256: input.previousArchiveSha256,
    ...(input.previousArchiveId === undefined
      ? {}
      : { previousArchiveId: input.previousArchiveId }),
    ...(input.finalizationProjection === undefined
      ? {}
      : { finalizationProjection: input.finalizationProjection }),
    protectedFinalizationEpoch: normalizeProtectedFinalizationEpoch(
      input.protectedFinalizationEpoch,
      input.archiveKind,
      code,
    ),
    passphrase: normalizePassphrase(input.passphrase),
    recoveryCode: (() => {
      if (typeof input.recoveryCode !== 'string' || input.recoveryCode.length > 64) {
        throw new ArchiveEnvelopeError(
          code,
          'Archive recovery code must be one exact eight-by-five Crockford code.',
        )
      }
      try {
        return normalizeRecoveryCode(input.recoveryCode)
      } catch (error) {
        throw new ArchiveEnvelopeError(
          code,
          'Archive recovery code must be one exact eight-by-five Crockford code.',
          { cause: error instanceof Error ? error.name : 'Error' },
        )
      }
    })(),
  })
}

/** Requires a canonical relative worker-owned path with no traversal. */
function normalizeRelativePath(value, label, code) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 4_096
    || Buffer.byteLength(value, 'utf8') > 4_096
    || CONTROL_CHARACTERS.test(value)
    || value.includes('\\')
    || path.isAbsolute(value)
    || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new ArchiveEnvelopeError(code, `${label} is invalid.`)
  }
  return value
}

/** Validates the secret-bearing completion once, before main commits custody. */
function normalizeArchiveCreateResult(input, expectedInput) {
  const code = 'ARCHIVE_ENVELOPE_INVALID_RESULT'
  const expected = normalizeArchiveCreateRequest(expectedInput)
  requireExactRecord(input, CREATE_RESULT_KEYS, code, 'Archive create result')
  if (
    input.type !== 'complete'
    || input.operationId !== expected.operationId
    || input.archiveId !== expected.archiveId
    || input.missionId !== expected.missionId
    || input.requestEventRowid !== expected.requestEventRowid
    || input.requestEventId !== expected.requestEventId
    || input.protectedFinalizationEpoch !== expected.protectedFinalizationEpoch
    || input.archiveKind !== expected.archiveKind
    || input.containerVersion !== 2
    || input.schemaVersion !== expected.schemaVersion
    || input.inventoryVersion !== expected.inventoryVersion
  ) {
    throw new ArchiveEnvelopeError(code, 'Archive worker result identity was substituted.')
  }
  const expectedTemporaryPath = `.staging/${expected.operationId}/${expected.archiveId}.sararch.tmp`
  const expectedFinalPath = `${expected.archiveId}.sararch`
  const temporaryRelativePath = normalizeRelativePath(
    input.temporaryRelativePath,
    'Archive staging path',
    code,
  )
  const finalRelativePath = normalizeRelativePath(
    input.finalRelativePath,
    'Archive final path',
    code,
  )
  if (temporaryRelativePath !== expectedTemporaryPath || finalRelativePath !== expectedFinalPath) {
    throw new ArchiveEnvelopeError(code, 'Archive worker returned an unexpected custody path.')
  }
  if (typeof input.ciphertextSha256 !== 'string' || !SHA256.test(input.ciphertextSha256)) {
    throw new ArchiveEnvelopeError(code, 'Archive worker returned an invalid ciphertext identity.')
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) {
    throw new ArchiveEnvelopeError(code, 'Archive worker returned an invalid exact byte count.')
  }
  let temporaryFileIdentity
  try {
    temporaryFileIdentity = normalizeCustodyFileIdentity(input.temporaryFileIdentity)
  } catch {
    throw new ArchiveEnvelopeError(code, 'Archive worker returned an invalid staging identity.')
  }
  if (temporaryFileIdentity.sizeBytes !== input.sizeBytes) {
    throw new ArchiveEnvelopeError(code, 'Archive worker staging identity has the wrong size.')
  }
  if (!Number.isSafeInteger(input.frameCount) || input.frameCount < 2
    || input.sizeBytes < 37 + 29 * input.frameCount) {
    throw new ArchiveEnvelopeError(code, 'Archive worker returned an invalid frame count.')
  }
  if (typeof input.headerSha256 !== 'string' || !SHA256.test(input.headerSha256)) {
    throw new ArchiveEnvelopeError(code, 'Archive worker returned an invalid header identity.')
  }
  if (input.plaintextSweepConfirmed !== true) {
    throw new ArchiveEnvelopeError(code, 'Archive worker did not confirm plaintext cleanup.')
  }
  if (!Array.isArray(input.slots) || input.slots.length !== 2) {
    throw new ArchiveEnvelopeError(code, 'Archive worker must return two mandatory slot identities.')
  }
  const slots = input.slots.map((slot) => {
    requireExactRecord(slot, ['slotId', 'slotType'], code, 'Archive slot identity')
    if (!['passphrase', 'recovery'].includes(slot.slotType)) {
      throw new ArchiveEnvelopeError(code, 'Archive worker returned an unsupported slot identity.')
    }
    if (
      typeof slot.slotId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(slot.slotId)
    ) {
      throw new ArchiveEnvelopeError(code, 'Archive worker returned an invalid slot ID.')
    }
    return { slotType: slot.slotType, slotId: slot.slotId }
  })
  if (new Set(slots.map((slot) => slot.slotType)).size !== 2) {
    throw new ArchiveEnvelopeError(code, 'Archive worker omitted a mandatory non-machine slot.')
  }
  requireExactRecord(
    input.manifestSummary,
    ['entryCount', 'inventorySha256', 'manifestSha256', 'tableCount'],
    code,
    'Archive manifest summary',
  )
  if (
    !Number.isSafeInteger(input.manifestSummary.entryCount)
    || input.manifestSummary.entryCount < 4
    || !Number.isSafeInteger(input.manifestSummary.tableCount)
    || input.manifestSummary.tableCount !== REQUIRED_ARCHIVE_TABLE_COUNT
    || typeof input.manifestSummary.inventorySha256 !== 'string'
    || !SHA256.test(input.manifestSummary.inventorySha256)
    || typeof input.manifestSummary.manifestSha256 !== 'string'
    || !SHA256.test(input.manifestSummary.manifestSha256)
  ) {
    throw new ArchiveEnvelopeError(code, 'Archive worker returned an invalid manifest summary.')
  }
  if (
    typeof input.kdfDurationMs !== 'number'
    || !Number.isFinite(input.kdfDurationMs)
    || input.kdfDurationMs < 0
    || input.kdfDurationMs > 60 * 60 * 1_000
  ) {
    throw new ArchiveEnvelopeError(code, 'Archive worker returned an invalid KDF measurement.')
  }
  return deepFreeze({
    type: 'complete',
    operationId: expected.operationId,
    archiveId: expected.archiveId,
    missionId: expected.missionId,
    requestEventRowid: expected.requestEventRowid,
    requestEventId: expected.requestEventId,
    protectedFinalizationEpoch: expected.protectedFinalizationEpoch,
    archiveKind: expected.archiveKind,
    containerVersion: 2,
    schemaVersion: expected.schemaVersion,
    inventoryVersion: expected.inventoryVersion,
    temporaryRelativePath,
    finalRelativePath,
    ciphertextSha256: input.ciphertextSha256,
    sizeBytes: input.sizeBytes,
    temporaryFileIdentity,
    frameCount: input.frameCount,
    headerSha256: input.headerSha256,
    plaintextSweepConfirmed: true,
    slots,
    manifestSummary: {
      entryCount: input.manifestSummary.entryCount,
      tableCount: input.manifestSummary.tableCount,
      inventorySha256: input.manifestSummary.inventorySha256,
      manifestSha256: input.manifestSummary.manifestSha256,
    },
    kdfDurationMs: input.kdfDurationMs,
  })
}

/** Validates one exact secret-bearing independent verification request. */
function normalizeArchiveVerifyRequest(input) {
  const code = 'ARCHIVE_VERIFY_ENVELOPE_INVALID_REQUEST'
  requireExactRecord(input, VERIFY_REQUEST_KEYS, code, 'Archive verify request')
  let identity
  try {
    identity = normalizeArchiveVerificationIdentity({
      archiveId: input.archiveId,
      archiveKind: input.archiveKind,
      archiveRelativePath: input.archiveRelativePath,
      missionId: input.missionId,
      requestEventRowid: input.requestEventRowid,
      requestEventId: input.requestEventId,
      creationOperationId: input.creationOperationId,
      protectedFinalizationEpoch: input.protectedFinalizationEpoch,
      createdAt: input.createdAt,
      previousArchiveSha256: input.previousArchiveSha256,
      containerVersion: input.containerVersion,
      schemaVersion: input.schemaVersion,
      inventoryVersion: input.inventoryVersion,
      ciphertextSha256: input.ciphertextSha256,
      sizeBytes: input.sizeBytes,
      frameCount: input.frameCount,
      headerSha256: input.headerSha256,
      manifestSha256: input.manifestSha256,
      entryCount: input.entryCount,
      tableCount: input.tableCount,
    })
  } catch {
    throw new ArchiveEnvelopeError(code, 'Archive verify registry identity is invalid.')
  }
  return deepFreeze({
    operationId: normalizeUuid(input.operationId, 'Archive verify operation identity', code),
    archiveId: identity.archiveId,
    archiveKind: identity.archiveKind,
    archiveDirectory: normalizeAbsolutePath(
      input.archiveDirectory,
      'Archive custody directory',
      code,
    ),
    archiveRelativePath: identity.archiveRelativePath,
    databasePath: normalizeAbsolutePath(input.databasePath, 'Archive database path', code),
    missionId: identity.missionId,
    requestEventRowid: identity.requestEventRowid,
    requestEventId: identity.requestEventId,
    creationOperationId: identity.creationOperationId,
    protectedFinalizationEpoch: identity.protectedFinalizationEpoch,
    createdAt: identity.createdAt,
    containerVersion: identity.containerVersion,
    schemaVersion: identity.schemaVersion,
    inventoryVersion: identity.inventoryVersion,
    ciphertextSha256: identity.ciphertextSha256,
    previousArchiveSha256: identity.previousArchiveSha256,
    sizeBytes: identity.sizeBytes,
    frameCount: identity.frameCount,
    headerSha256: identity.headerSha256,
    manifestSha256: identity.manifestSha256,
    entryCount: identity.entryCount,
    tableCount: identity.tableCount,
    passphrase: normalizePassphrase(input.passphrase),
    recoveryCode: (() => {
      if (typeof input.recoveryCode !== 'string' || input.recoveryCode.length > 64) {
        throw new ArchiveEnvelopeError(
          code,
          'Archive recovery code must be one exact eight-by-five Crockford code.',
        )
      }
      try {
        return normalizeRecoveryCode(input.recoveryCode)
      } catch {
        throw new ArchiveEnvelopeError(
          code,
          'Archive recovery code must be one exact eight-by-five Crockford code.',
        )
      }
    })(),
  })
}

/** Requires a closed boolean proof layer and returns its immutable projection. */
function normalizeMatchedLayer(value, keys, label, code) {
  requireExactRecord(value, keys, code, label)
  if (value.exhaustive !== true || value.matched !== true) {
    throw new ArchiveEnvelopeError(code, `${label} did not prove an exhaustive match.`)
  }
  return { ...value }
}

/** Requires one safe non-negative proof counter. */
function normalizeProofCount(value, label, code) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ArchiveEnvelopeError(code, `${label} is invalid.`)
  }
  return value
}

/** Validates and freezes the exact non-secret identity issued by the registry. */
function normalizeArchiveVerificationIdentity(input) {
  const code = 'ARCHIVE_VERIFY_ENVELOPE_INVALID_IDENTITY'
  requireExactRecord(input, VERIFY_IDENTITY_KEYS, code, 'Archive verification identity')
  if (!ARCHIVE_KINDS.has(input.archiveKind)
    || input.containerVersion !== 2
    || input.schemaVersion !== ARCHIVE_SCHEMA_VERSION
    || input.inventoryVersion !== ARCHIVE_INVENTORY_VERSION
    || !Number.isSafeInteger(input.requestEventRowid) || input.requestEventRowid < 1
    || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1
    || !Number.isSafeInteger(input.frameCount) || input.frameCount < 2
    || input.sizeBytes < 37 + 29 * input.frameCount
    || typeof input.headerSha256 !== 'string' || !SHA256.test(input.headerSha256)
    || typeof input.manifestSha256 !== 'string' || !SHA256.test(input.manifestSha256)
    || !Number.isSafeInteger(input.entryCount) || input.entryCount < 4
    || !Number.isSafeInteger(input.tableCount)
    || input.tableCount !== REQUIRED_ARCHIVE_TABLE_COUNT
    || typeof input.ciphertextSha256 !== 'string' || !SHA256.test(input.ciphertextSha256)
    || (input.previousArchiveSha256 !== null
      && (typeof input.previousArchiveSha256 !== 'string'
        || !SHA256.test(input.previousArchiveSha256)))) {
    throw new ArchiveEnvelopeError(
      code,
      'Archive verification identity, version, size, or ciphertext digest is invalid.',
    )
  }
  const archiveId = normalizeUuid(input.archiveId, 'Archive identity', code)
  const archiveRelativePath = normalizeRelativePath(
    input.archiveRelativePath,
    'Archive custody path',
    code,
  )
  if (archiveRelativePath !== `${archiveId}.sararch`) {
    throw new ArchiveEnvelopeError(
      code,
      'Version-two archive custody identity must name its exact flat final file.',
    )
  }
  return deepFreeze({
    archiveId,
    archiveKind: input.archiveKind,
    archiveRelativePath,
    missionId: normalizeMissionId(input.missionId, code),
    requestEventRowid: input.requestEventRowid,
    requestEventId: normalizeUuid(input.requestEventId, 'Archive request event identity', code),
    creationOperationId: normalizeUuid(
      input.creationOperationId,
      'Archive creation operation identity',
      code,
    ),
    protectedFinalizationEpoch: normalizeProtectedFinalizationEpoch(
      input.protectedFinalizationEpoch,
      input.archiveKind,
      code,
    ),
    createdAt: normalizeTimestamp(input.createdAt, 'Archive creation time', code),
    previousArchiveSha256: input.previousArchiveSha256,
    containerVersion: 2,
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    inventoryVersion: ARCHIVE_INVENTORY_VERSION,
    ciphertextSha256: input.ciphertextSha256,
    sizeBytes: input.sizeBytes,
    frameCount: input.frameCount,
    headerSha256: input.headerSha256,
    manifestSha256: input.manifestSha256,
    entryCount: input.entryCount,
    tableCount: input.tableCount,
  })
}

/** Projects the exact non-secret registry identity from a normalized verify request. */
function projectArchiveVerificationIdentity(request) {
  return normalizeArchiveVerificationIdentity({
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
    frameCount: request.frameCount,
    headerSha256: request.headerSha256,
    manifestSha256: request.manifestSha256,
    entryCount: request.entryCount,
    tableCount: request.tableCount,
  })
}

/** Validates the exact independent verification proof against a non-secret identity. */
function normalizeArchiveVerificationProofForIdentity(input, expectedInput) {
  const code = 'ARCHIVE_VERIFY_ENVELOPE_INVALID_RESULT'
  let expected
  try {
    expected = normalizeArchiveVerificationIdentity(expectedInput)
  } catch {
    throw new ArchiveEnvelopeError(code, 'Archive verification identity is invalid.')
  }
  requireExactRecord(input, VERIFY_PROOF_KEYS, code, 'Archive verification proof')
  let custodyFileIdentity
  try {
    custodyFileIdentity = normalizeCustodyFileIdentity(input.custodyFileIdentity)
  } catch {
    throw new ArchiveEnvelopeError(code, 'Archive verification custody identity is invalid.')
  }
  if (input.proofVersion !== 1 || input.exhaustive !== true
    || input.archiveId !== expected.archiveId || input.archiveKind !== expected.archiveKind
    || input.archiveRelativePath !== expected.archiveRelativePath
    || input.missionId !== expected.missionId
    || input.requestEventRowid !== expected.requestEventRowid
    || input.requestEventId !== expected.requestEventId || input.createdAt !== expected.createdAt
    || input.creationOperationId !== expected.creationOperationId
    || input.protectedFinalizationEpoch !== expected.protectedFinalizationEpoch
    || input.previousArchiveSha256 !== expected.previousArchiveSha256
    || input.containerVersion !== expected.containerVersion
    || input.schemaVersion !== expected.schemaVersion
    || input.inventoryVersion !== expected.inventoryVersion
    || input.ciphertextSha256 !== expected.ciphertextSha256
    || input.sizeBytes !== expected.sizeBytes || input.frameCount !== expected.frameCount
    || input.headerSha256 !== expected.headerSha256
    || input.manifestSha256 !== expected.manifestSha256
    || custodyFileIdentity.sizeBytes !== expected.sizeBytes
    || input.plaintextSweepConfirmed !== true
    || !Number.isFinite(input.durationMs) || input.durationMs < 0
    || input.durationMs > 24 * 60 * 60 * 1_000
    || !Number.isSafeInteger(input.frameCount) || input.frameCount < 2
    || typeof input.headerSha256 !== 'string' || !SHA256.test(input.headerSha256)
    || typeof input.manifestSha256 !== 'string' || !SHA256.test(input.manifestSha256)) {
    throw new ArchiveEnvelopeError(code, 'Archive verification proof identity was substituted.')
  }
  requireExactRecord(
    input.layers,
    ['attachments', 'authenticatedFrames', 'ciphertext', 'entries', 'gpxSourceBytes', 'inventory'],
    code,
    'Archive verification layers',
  )
  const ciphertext = normalizeMatchedLayer(
    input.layers.ciphertext,
    ['exhaustive', 'matched'],
    'Archive ciphertext layer',
    code,
  )
  const authenticatedFrames = normalizeMatchedLayer(
    input.layers.authenticatedFrames,
    ['exhaustive', 'matched'],
    'Archive authenticated-frame layer',
    code,
  )
  const entries = normalizeMatchedLayer(
    input.layers.entries,
    ['count', 'exhaustive', 'matched'],
    'Archive entry layer',
    code,
  )
  normalizeProofCount(entries.count, 'Archive entry count', code)
  if (entries.count < 4) {
    throw new ArchiveEnvelopeError(code, 'Archive entry proof omits a mandatory core entry.')
  }
  if (entries.count !== expected.entryCount) {
    throw new ArchiveEnvelopeError(code, 'Archive entry proof differs from its seal receipt.')
  }
  const inventory = normalizeMatchedLayer(
    input.layers.inventory,
    ['exhaustive', 'matched', 'tableCount'],
    'Archive inventory layer',
    code,
  )
  normalizeProofCount(inventory.tableCount, 'Archive table count', code)
  if (inventory.tableCount !== REQUIRED_ARCHIVE_TABLE_COUNT) {
    throw new ArchiveEnvelopeError(code, 'Archive inventory proof has an incomplete table set.')
  }
  if (inventory.tableCount !== expected.tableCount) {
    throw new ArchiveEnvelopeError(code, 'Archive inventory proof differs from its seal receipt.')
  }
  const attachments = normalizeMatchedLayer(
    input.layers.attachments,
    ['count', 'exhaustive', 'matched'],
    'Archive attachment layer',
    code,
  )
  normalizeProofCount(attachments.count, 'Archive attachment count', code)
  if (attachments.count !== entries.count - 4) {
    throw new ArchiveEnvelopeError(code, 'Archive attachment and entry proofs are inconsistent.')
  }
  const gpxSourceBytes = normalizeMatchedLayer(
    input.layers.gpxSourceBytes,
    [
      'exactBytesCount',
      'exactSourceCustodyComplete',
      'exhaustive',
      'failureUnavailableCount',
      'legacyHashOnlyCount',
      'legacyUnavailableCount',
      'matched',
      'recordCount',
    ],
    'Archive GPX source-byte layer',
    code,
  )
  for (const [label, value] of [
    ['Archive GPX record count', gpxSourceBytes.recordCount],
    ['Archive exact GPX byte count', gpxSourceBytes.exactBytesCount],
    ['Archive legacy GPX hash-only count', gpxSourceBytes.legacyHashOnlyCount],
    ['Archive legacy GPX unavailable count', gpxSourceBytes.legacyUnavailableCount],
    ['Archive failed GPX unavailable count', gpxSourceBytes.failureUnavailableCount],
  ]) normalizeProofCount(value, label, code)
  if (typeof gpxSourceBytes.exactSourceCustodyComplete !== 'boolean') {
    throw new ArchiveEnvelopeError(code, 'Archive GPX custody-completeness flag is invalid.')
  }
  const gpxRecordCount = gpxSourceBytes.exactBytesCount
    + gpxSourceBytes.legacyHashOnlyCount
    + gpxSourceBytes.legacyUnavailableCount
    + gpxSourceBytes.failureUnavailableCount
  const exactSourceCustodyComplete = gpxSourceBytes.legacyHashOnlyCount === 0
    && gpxSourceBytes.legacyUnavailableCount === 0
    && gpxSourceBytes.failureUnavailableCount === 0
  if (gpxSourceBytes.recordCount > 20_000
    || gpxSourceBytes.recordCount !== gpxRecordCount
    || gpxSourceBytes.exactSourceCustodyComplete !== exactSourceCustodyComplete) {
    throw new ArchiveEnvelopeError(code, 'Archive GPX custody proof is internally inconsistent.')
  }
  if (!Array.isArray(input.tables) || input.tables.length !== REQUIRED_ARCHIVE_TABLE_COUNT) {
    throw new ArchiveEnvelopeError(code, 'Archive table ledger is incomplete.')
  }
  const declarations = listArchiveInventoryForSchema(ARCHIVE_SCHEMA_VERSION)
  const tables = input.tables.map((table, index) => {
    requireExactRecord(
      table,
      ['contentSha256', 'rowCount', 'tableName'],
      code,
      `Archive table ledger entry ${index}`,
    )
    if (table.tableName !== declarations[index].tableName
      || !Number.isSafeInteger(table.rowCount) || table.rowCount < 0
      || typeof table.contentSha256 !== 'string' || !SHA256.test(table.contentSha256)) {
      throw new ArchiveEnvelopeError(code, 'Archive table ledger is invalid.')
    }
    return { ...table }
  })
  const tableLedgerSha256 = createHash('sha256')
    .update(canonicalJson(tables), 'utf8').digest('hex')
  if (input.tableLedgerSha256 !== tableLedgerSha256) {
    throw new ArchiveEnvelopeError(code, 'Archive table ledger digest does not match its entries.')
  }
  requireExactRecord(
    input.replaySemantic,
    ['baselineSha256', 'matched', 'sampleCount', 'sampleStrategy', 'sampled', 'samples'],
    code,
    'Archive replay-semantic layer',
  )
  if (input.replaySemantic.sampled !== true || input.replaySemantic.matched !== true
    || !Number.isSafeInteger(input.replaySemantic.sampleCount)
    || input.replaySemantic.sampleCount < 1 || input.replaySemantic.sampleCount > 5
    || input.replaySemantic.sampleStrategy
      !== 'mission-start-finish-fence-midpoints-exhaustive-pages-and-outing-filters-v3'
    || typeof input.replaySemantic.baselineSha256 !== 'string'
    || !SHA256.test(input.replaySemantic.baselineSha256)
    || !Array.isArray(input.replaySemantic.samples)
    || input.replaySemantic.samples.length !== input.replaySemantic.sampleCount) {
    throw new ArchiveEnvelopeError(code, 'Archive replay-semantic proof is invalid.')
  }
  const replaySamples = input.replaySemantic.samples.map((sample, index) => {
    requireExactRecord(sample, [
      'sampledObjectCount',
      'sampledOutingFilterCount',
      'sampledTrackCount',
      'selectedTime',
      'semanticSha256',
      'totalObjectCount',
      'totalOutingFilterCount',
      'totalTrackCount',
    ], code, `Archive replay-semantic sample ${index}`)
    const counts = [
      sample.sampledObjectCount,
      sample.sampledOutingFilterCount,
      sample.sampledTrackCount,
      sample.totalObjectCount,
      sample.totalOutingFilterCount,
      sample.totalTrackCount,
    ]
    if (normalizeTimestamp(sample.selectedTime, 'Archive replay sample time', code)
        !== sample.selectedTime
      || typeof sample.semanticSha256 !== 'string' || !SHA256.test(sample.semanticSha256)
      || counts.some((value) => !Number.isSafeInteger(value) || value < 0)
      || sample.sampledObjectCount !== sample.totalObjectCount
      || sample.sampledOutingFilterCount !== sample.totalOutingFilterCount
      || sample.sampledTrackCount !== sample.totalTrackCount
      || (index > 0
        && input.replaySemantic.samples[index - 1].selectedTime >= sample.selectedTime)) {
      throw new ArchiveEnvelopeError(code, 'Archive replay-semantic sample is invalid or incomplete.')
    }
    return { ...sample }
  })
  const replayProof = {
    proof_version: 3,
    sample_count: input.replaySemantic.sampleCount,
    sample_strategy: input.replaySemantic.sampleStrategy,
    samples: replaySamples.map((sample) => ({
      selected_time: sample.selectedTime,
      semantic_sha256: sample.semanticSha256,
      sampled_outing_filter_count: sample.sampledOutingFilterCount,
      sampled_object_count: sample.sampledObjectCount,
      sampled_track_count: sample.sampledTrackCount,
      total_outing_filter_count: sample.totalOutingFilterCount,
      total_object_count: sample.totalObjectCount,
      total_track_count: sample.totalTrackCount,
    })),
  }
  if (createHash('sha256').update(canonicalJson(replayProof), 'utf8').digest('hex')
      !== input.replaySemantic.baselineSha256) {
    throw new ArchiveEnvelopeError(code, 'Archive replay-semantic digest does not match its samples.')
  }
  return deepFreeze({
    ...input,
    custodyFileIdentity,
    layers: {
      ciphertext,
      authenticatedFrames,
      entries,
      inventory,
      gpxSourceBytes,
      attachments,
    },
    tableLedgerSha256,
    tables,
    replaySemantic: { ...input.replaySemantic, samples: replaySamples },
  })
}

/** Validates the exact independent verification proof against its secret-bearing request. */
function normalizeArchiveVerificationProof(input, expectedInput) {
  const expected = normalizeArchiveVerifyRequest(expectedInput)
  return normalizeArchiveVerificationProofForIdentity(
    input,
    projectArchiveVerificationIdentity(expected),
  )
}

/** Validates the wrapped terminal message and returns only its proof payload. */
function normalizeArchiveVerifyResult(input, expectedInput) {
  const code = 'ARCHIVE_VERIFY_ENVELOPE_INVALID_RESULT'
  const expected = normalizeArchiveVerifyRequest(expectedInput)
  requireExactRecord(input, ['operationId', 'proof', 'type'], code, 'Archive verify result')
  if (input.type !== 'complete' || input.operationId !== expected.operationId) {
    throw new ArchiveEnvelopeError(code, 'Archive verify result operation identity was substituted.')
  }
  return normalizeArchiveVerificationProof(input.proof, expected)
}

/** Validates one bounded verify progress message for its exact operation. */
function normalizeArchiveVerifyProgress(input, operationId) {
  const code = 'ARCHIVE_VERIFY_ENVELOPE_INVALID_PROGRESS'
  requireExactRecord(
    input,
    ['completed', 'detail', 'operationId', 'phase', 'sequence', 'total', 'type', 'unit'],
    code,
    'Archive verify progress',
  )
  normalizeUuid(operationId, 'Expected archive verify operation identity', code)
  if (input.type !== 'progress' || input.operationId !== operationId
    || !VERIFY_PROGRESS_PHASES.has(input.phase) || !PROGRESS_UNITS.has(input.unit)
    || !Number.isSafeInteger(input.sequence) || input.sequence < 1
    || !Number.isSafeInteger(input.completed) || input.completed < 0
    || (input.total !== null && (!Number.isSafeInteger(input.total)
      || input.total < input.completed))
    || typeof input.detail !== 'string' || Buffer.byteLength(input.detail, 'utf8') > 200
    || CONTROL_CHARACTERS.test(input.detail)) {
    throw new ArchiveEnvelopeError(code, 'Archive verify progress is invalid.')
  }
  return deepFreeze({
    sequence: input.sequence,
    phase: input.phase,
    unit: input.unit,
    completed: input.completed,
    total: input.total,
    detail: input.detail,
  })
}

/** Validates one bounded progress message for the exact running operation. */
function normalizeArchiveProgress(input, operationId) {
  const code = 'ARCHIVE_ENVELOPE_INVALID_PROGRESS'
  requireExactRecord(
    input,
    ['completed', 'detail', 'operationId', 'phase', 'sequence', 'total', 'type', 'unit'],
    code,
    'Archive progress message',
  )
  normalizeUuid(operationId, 'Expected archive operation identity', code)
  if (input.type !== 'progress' || input.operationId !== operationId) {
    throw new ArchiveEnvelopeError(code, 'Archive progress operation identity was substituted.')
  }
  if (!PROGRESS_PHASES.has(input.phase)) {
    throw new ArchiveEnvelopeError(code, 'Archive progress phase is unsupported.')
  }
  if (!PROGRESS_UNITS.has(input.unit)) {
    throw new ArchiveEnvelopeError(code, 'Archive progress unit is unsupported.')
  }
  if (
    !Number.isSafeInteger(input.sequence)
    || input.sequence < 1
    || !Number.isSafeInteger(input.completed)
    || (input.total !== null && !Number.isSafeInteger(input.total))
    || input.completed < 0
    || (input.total !== null && (input.total < 0 || input.completed > input.total))
  ) {
    throw new ArchiveEnvelopeError(code, 'Archive progress counters are invalid.')
  }
  if (
    typeof input.detail !== 'string'
    || Buffer.byteLength(input.detail, 'utf8') > 200
    || CONTROL_CHARACTERS.test(input.detail)
  ) {
    throw new ArchiveEnvelopeError(code, 'Archive progress detail is invalid.')
  }
  return deepFreeze({
    sequence: input.sequence,
    phase: input.phase,
    unit: input.unit,
    completed: input.completed,
    total: input.total,
    detail: input.detail,
  })
}

module.exports = {
  ArchiveEnvelopeError,
  normalizeArchiveCreateRequest,
  normalizeArchiveCreateResult,
  normalizeArchiveProgress,
  normalizeArchiveVerificationIdentity,
  normalizeArchiveVerificationProof,
  normalizeArchiveVerificationProofForIdentity,
  normalizeArchiveVerifyProgress,
  normalizeArchiveVerifyRequest,
  normalizeArchiveVerifyResult,
}
