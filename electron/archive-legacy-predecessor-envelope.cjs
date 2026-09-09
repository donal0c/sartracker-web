'use strict'

const path = require('node:path')

const {
  normalizeCustodyFileIdentity,
} = require('./archive-custody-file.cjs')

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const LEGACY_ARCHIVE_ID = /^legacy-v1-[0-9a-f]{64}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u
const TICKET_KEYS = Object.freeze([
  'archiveDirectory',
  'archiveId',
  'archiveRelativePath',
  'expectedFileIdentity',
  'missionId',
  'operationId',
])
const RESULT_KEYS = Object.freeze([
  'archiveId',
  'archiveRelativePath',
  'fileIdentity',
  'missionId',
  'operationId',
  'sha256',
  'sizeBytes',
  'type',
])

/** Signals one closed legacy-predecessor worker envelope failure. */
class ArchiveLegacyPredecessorEnvelopeError extends Error {
  /** Creates one stable boundary failure. */
  constructor(message) {
    super(message)
    this.name = 'ArchiveLegacyPredecessorEnvelopeError'
    this.code = 'ARCHIVE_LEGACY_PREDECESSOR_ENVELOPE_INVALID'
  }
}

/** Requires one plain record with exactly the expected key set. */
function requireExactRecord(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArchiveLegacyPredecessorEnvelopeError(`${label} must be an object.`)
  }
  const actual = Object.keys(value).sort()
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new ArchiveLegacyPredecessorEnvelopeError(
      `${label} has missing or unsupported fields.`,
    )
  }
}

/** Requires one bounded internal identity. */
function normalizeId(value, label, pattern = null) {
  if (typeof value !== 'string' || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 200
    || CONTROL_CHARACTERS.test(value)
    || (pattern !== null && !pattern.test(value))) {
    throw new ArchiveLegacyPredecessorEnvelopeError(`${label} is invalid.`)
  }
  return value
}

/** Requires one canonical relative path inside archive custody. */
function normalizeRelativePath(value) {
  if (typeof value !== 'string' || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 4_096 || CONTROL_CHARACTERS.test(value)
    || path.isAbsolute(value) || value.includes('\\')
    || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ArchiveLegacyPredecessorEnvelopeError(
      'Legacy archive predecessor custody path is invalid.',
    )
  }
  return value
}

/** Validates one exact registry-derived legacy predecessor hash ticket. */
function normalizeArchiveLegacyPredecessorTicket(input) {
  requireExactRecord(input, TICKET_KEYS, 'Legacy archive predecessor ticket')
  if (typeof input.archiveDirectory !== 'string'
    || !path.isAbsolute(input.archiveDirectory)
    || path.resolve(input.archiveDirectory) !== input.archiveDirectory
    || Buffer.byteLength(input.archiveDirectory, 'utf8') > 8_192
    || CONTROL_CHARACTERS.test(input.archiveDirectory)) {
    throw new ArchiveLegacyPredecessorEnvelopeError(
      'Legacy archive predecessor directory is invalid.',
    )
  }
  let expectedFileIdentity
  try {
    expectedFileIdentity = normalizeCustodyFileIdentity(input.expectedFileIdentity)
  } catch {
    throw new ArchiveLegacyPredecessorEnvelopeError(
      'Legacy archive predecessor file identity is invalid.',
    )
  }
  return Object.freeze({
    operationId: normalizeId(
      input.operationId,
      'Legacy archive predecessor operation ID',
      UUID_V4,
    ),
    archiveId: normalizeId(
      input.archiveId,
      'Legacy archive predecessor archive ID',
      LEGACY_ARCHIVE_ID,
    ),
    missionId: normalizeId(input.missionId, 'Legacy archive predecessor mission ID'),
    archiveDirectory: input.archiveDirectory,
    archiveRelativePath: normalizeRelativePath(input.archiveRelativePath),
    expectedFileIdentity,
  })
}

/** Validates one worker result against every issued predecessor field. */
function normalizeArchiveLegacyPredecessorResult(input, expectedInput) {
  const expected = normalizeArchiveLegacyPredecessorTicket(expectedInput)
  requireExactRecord(input, RESULT_KEYS, 'Legacy archive predecessor result')
  let fileIdentity
  try {
    fileIdentity = normalizeCustodyFileIdentity(input.fileIdentity)
  } catch {
    throw new ArchiveLegacyPredecessorEnvelopeError(
      'Legacy archive predecessor result file identity is invalid.',
    )
  }
  const identityKeys = Object.keys(expected.expectedFileIdentity)
  if (input.type !== 'complete'
    || input.operationId !== expected.operationId
    || input.archiveId !== expected.archiveId
    || input.missionId !== expected.missionId
    || input.archiveRelativePath !== expected.archiveRelativePath
    || typeof input.sha256 !== 'string' || !SHA256.test(input.sha256)
    || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1
    || input.sizeBytes !== fileIdentity.sizeBytes
    || identityKeys.some((key) => fileIdentity[key] !== expected.expectedFileIdentity[key])) {
    throw new ArchiveLegacyPredecessorEnvelopeError(
      'Legacy archive predecessor result identity was substituted or changed.',
    )
  }
  return Object.freeze({ ...input, fileIdentity })
}

module.exports = {
  ArchiveLegacyPredecessorEnvelopeError,
  normalizeArchiveLegacyPredecessorResult,
  normalizeArchiveLegacyPredecessorTicket,
}
