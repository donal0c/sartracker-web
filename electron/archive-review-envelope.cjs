'use strict'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const RECOVERY_CODE = /^(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/u
const ARCHIVE_REVIEW_READ_METHODS = Object.freeze(new Set([
  'info',
  'listMissions',
  'readMissionReview',
  'cancelMissionReviewRead',
  'readMissionReplay',
  'readMissionReplayTrackChunk',
  'readMissionReplayObjectChunk',
  'readMissionReplayFilterPage',
  'cancelMissionReplay',
  'listMarkers',
  'listDevices',
  'listDrawings',
  'listHelicopters',
  'listGpxImports',
  'listGpxImportPage',
  'listSearchOperationPage',
  'listOutings',
  'listLayerCatalogMetadata',
  'listArchiveAttachmentPage',
  'openAttachment',
]))

/** Stable closed-boundary archive review error. */
class ArchiveReviewEnvelopeError extends Error {
  /** Creates a non-reflective envelope failure. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveReviewEnvelopeError'
    this.code = code
  }
}

/** Requires one plain object with exactly the declared keys. */
function requireExactRecord(value, keys, label, code = 'ARCHIVE_REVIEW_INPUT_INVALID') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArchiveReviewEnvelopeError(
      code,
      `${label} must be an object.`,
    )
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    throw new ArchiveReviewEnvelopeError(
      code,
      `${label} has missing or unsupported fields.`,
    )
  }
}

/** Requires a v4 UUID identity. */
function normalizeUuid(value, label) {
  if (typeof value !== 'string' || !UUID_V4.test(value)) {
    throw new ArchiveReviewEnvelopeError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      `${label} must be a version-four UUID.`,
    )
  }
  return value
}

/** Requires one bounded safe internal identity. */
function normalizeId(value, label) {
  if (typeof value !== 'string'
    || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 200
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ArchiveReviewEnvelopeError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      `${label} is invalid.`,
    )
  }
  return value
}

/** Requires a canonical application timestamp. */
function normalizeTimestamp(value, label) {
  if (typeof value !== 'string'
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new ArchiveReviewEnvelopeError(
      'ARCHIVE_REVIEW_RESULT_INVALID',
      `${label} is invalid.`,
    )
  }
  return value
}

/** Validates one renderer-originated archive review open request. */
function normalizeArchiveReviewOpenInput(input) {
  if (input?.containerVersion === 1) {
    requireExactRecord(
      input,
      ['operationId', 'archiveId', 'containerVersion'],
      'Archive review open input',
    )
    return Object.freeze({
      operationId: normalizeUuid(input.operationId, 'Archive review operation identity'),
      archiveId: normalizeId(input.archiveId, 'Archive identity'),
      containerVersion: 1,
    })
  }
  requireExactRecord(input, [
    'operationId',
    'archiveId',
    'containerVersion',
    'slotType',
    'secret',
  ], 'Archive review open input')
  if (input.containerVersion !== 2) {
    throw new ArchiveReviewEnvelopeError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      'Archive review container version is unsupported.',
    )
  }
  if (!['passphrase', 'recovery'].includes(input.slotType)) {
    throw new ArchiveReviewEnvelopeError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      'Archive review credential must use a passphrase or recovery slot.',
    )
  }
  const secretBytes = typeof input.secret === 'string'
    ? Buffer.byteLength(input.secret, 'utf8')
    : 0
  const passphraseClasses = typeof input.secret === 'string'
    ? [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[^A-Za-z0-9]/u]
        .filter((pattern) => pattern.test(input.secret)).length
    : 0
  if (typeof input.secret !== 'string'
    || secretBytes < 1
    || secretBytes > 1_024
    || /[\u0000-\u001f\u007f]/u.test(input.secret)
    || (input.slotType === 'passphrase'
      && (input.secret.length < 14 || passphraseClasses < 3))
    || (input.slotType === 'recovery' && !RECOVERY_CODE.test(input.secret))) {
    throw new ArchiveReviewEnvelopeError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      'Archive review credential is invalid.',
    )
  }
  return Object.freeze({
    operationId: normalizeUuid(input.operationId, 'Archive review operation identity'),
    archiveId: normalizeId(input.archiveId, 'Archive identity'),
    containerVersion: 2,
    slotType: input.slotType,
    secret: input.secret,
  })
}

/** Validates one sender-owned archive review close input. */
function normalizeArchiveReviewCloseInput(input) {
  requireExactRecord(input, ['sessionId'], 'Archive review close input')
  return Object.freeze({
    sessionId: normalizeUuid(input.sessionId, 'Archive review session identity'),
  })
}

/** Validates one closed read-only session dispatch without interpreting its method payload. */
function normalizeArchiveReviewReadInput(input) {
  requireExactRecord(
    input,
    ['sessionId', 'requestId', 'method', 'input'],
    'Archive review read input',
  )
  if (typeof input.method !== 'string' || !ARCHIVE_REVIEW_READ_METHODS.has(input.method)) {
    throw new ArchiveReviewEnvelopeError(
      'ARCHIVE_REVIEW_READ_ONLY',
      'Archive review accepts only declared read-only operations.',
    )
  }
  if (input.input === null || typeof input.input !== 'object' || Array.isArray(input.input)) {
    throw new ArchiveReviewEnvelopeError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      'Archive review read method input must be an object.',
    )
  }
  if (Buffer.byteLength(JSON.stringify(input.input), 'utf8') > 256 * 1_024) {
    throw new ArchiveReviewEnvelopeError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      'Archive review read method input exceeds its byte budget.',
    )
  }
  return Object.freeze({
    sessionId: normalizeUuid(input.sessionId, 'Archive review session identity'),
    requestId: normalizeUuid(input.requestId, 'Archive review request identity'),
    method: input.method,
    input: Object.freeze({ ...input.input }),
  })
}

/** Shape-closes one worker/main session result before it can cross IPC. */
function normalizeArchiveReviewPublicSession(input, expected) {
  requireExactRecord(input, [
    'sessionId',
    'archiveId',
    'missionId',
    'containerVersion',
    'encrypted',
    'verified',
    'immutable',
    'ciphertextSha256',
    'previousArchiveId',
    'openedAt',
    'plaintextResidual',
  ], 'Archive review session result', 'ARCHIVE_REVIEW_RESULT_INVALID')
  if (input.archiveId !== expected.archiveId
    || input.missionId !== expected.missionId
    || ![1, 2].includes(input.containerVersion)
    || typeof input.encrypted !== 'boolean'
    || typeof input.verified !== 'boolean'
    || input.immutable !== true
    || (input.ciphertextSha256 !== null && !SHA256.test(input.ciphertextSha256))
    || (input.previousArchiveId !== null
      && (typeof input.previousArchiveId !== 'string'
        || Buffer.byteLength(input.previousArchiveId, 'utf8') > 200))
    || input.plaintextResidual !== 'permission_restricted_session_open') {
    throw new ArchiveReviewEnvelopeError(
      'ARCHIVE_REVIEW_RESULT_INVALID',
      'Archive review session result is invalid or request-mismatched.',
    )
  }
  if ((input.containerVersion === 2 && (!input.encrypted || !input.verified))
    || (input.containerVersion === 2 && input.ciphertextSha256 === null)
    || (input.containerVersion === 1
      && (input.encrypted || input.verified || input.ciphertextSha256 !== null))) {
    throw new ArchiveReviewEnvelopeError(
      'ARCHIVE_REVIEW_RESULT_INVALID',
      'Archive review session security classification is invalid.',
    )
  }
  return Object.freeze({
    sessionId: normalizeUuid(input.sessionId, 'Archive review session identity'),
    archiveId: input.archiveId,
    missionId: input.missionId,
    containerVersion: input.containerVersion,
    encrypted: input.encrypted,
    verified: input.verified,
    immutable: true,
    ciphertextSha256: input.ciphertextSha256,
    previousArchiveId: input.previousArchiveId,
    openedAt: normalizeTimestamp(input.openedAt, 'Archive review open time'),
    plaintextResidual: input.plaintextResidual,
  })
}

module.exports = {
  ARCHIVE_REVIEW_READ_METHODS,
  ArchiveReviewEnvelopeError,
  normalizeArchiveReviewCloseInput,
  normalizeArchiveReviewOpenInput,
  normalizeArchiveReviewPublicSession,
  normalizeArchiveReviewReadInput,
}
