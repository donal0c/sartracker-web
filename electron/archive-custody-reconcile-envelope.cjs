'use strict'

const path = require('node:path')

const { normalizeCustodyFileIdentity } = require('./archive-custody-file.cjs')

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u
const TICKET_KEYS = Object.freeze([
  'archiveDirectory',
  'archiveId',
  'archiveRelativePath',
  'containerVersion',
  'expectedCiphertextSha256',
  'expectedSizeBytes',
  'operationId',
  'registryRowid',
])
const RESULT_KEYS = Object.freeze([
  'archiveId',
  'archiveRelativePath',
  'containerVersion',
  'expectedCiphertextSha256',
  'expectedSizeBytes',
  'fileIdentity',
  'observedCiphertextSha256',
  'observedSizeBytes',
  'operationId',
  'outcome',
  'registryRowid',
  'type',
])
const FAILURE_OUTCOMES = new Set(['missing', 'not_regular', 'changed', 'unreadable'])

/** Signals a malformed reconciliation message at the worker boundary. */
class ArchiveCustodyReconcileEnvelopeError extends Error {
  /** Creates one stable boundary failure. */
  constructor(message) {
    super(message)
    this.name = 'ArchiveCustodyReconcileEnvelopeError'
    this.code = 'ARCHIVE_CUSTODY_RECONCILE_ENVELOPE_INVALID'
  }
}

/** Requires a plain record with exactly one closed key set. */
function requireExactRecord(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArchiveCustodyReconcileEnvelopeError(`${label} must be an object.`)
  }
  const actual = Object.keys(value).sort()
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new ArchiveCustodyReconcileEnvelopeError(
      `${label} has missing or unsupported fields.`,
    )
  }
}

/** Requires one bounded internal identifier. */
function normalizeId(value, label, uuid = false) {
  if (typeof value !== 'string' || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 200 || CONTROL_CHARACTERS.test(value)
    || (uuid && !UUID_V4.test(value))) {
    throw new ArchiveCustodyReconcileEnvelopeError(`${label} is invalid.`)
  }
  return value
}

/** Requires one closed path beneath the archive root. */
function normalizeRelativePath(value) {
  if (typeof value !== 'string' || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 4_096 || CONTROL_CHARACTERS.test(value)
    || path.isAbsolute(value) || value.includes('\\')
    || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ArchiveCustodyReconcileEnvelopeError('Archive custody path is invalid.')
  }
  return value
}

/** Validates one registry-issued, non-secret file-inspection ticket. */
function normalizeArchiveCustodyReconcileTicket(input) {
  requireExactRecord(input, TICKET_KEYS, 'Archive reconciliation ticket')
  const operationId = normalizeId(input.operationId, 'Archive reconciliation operation ID', true)
  const archiveId = normalizeId(input.archiveId, 'Archive reconciliation archive ID')
  const archiveRelativePath = normalizeRelativePath(input.archiveRelativePath)
  if (!Number.isSafeInteger(input.registryRowid) || input.registryRowid < 1
    || ![1, 2].includes(input.containerVersion)
    || typeof input.archiveDirectory !== 'string' || !path.isAbsolute(input.archiveDirectory)
    || path.resolve(input.archiveDirectory) !== input.archiveDirectory) {
    throw new ArchiveCustodyReconcileEnvelopeError('Archive reconciliation identity is invalid.')
  }
  if (input.containerVersion === 2 && (
    !UUID_V4.test(archiveId)
    || !Number.isSafeInteger(input.expectedSizeBytes) || input.expectedSizeBytes < 1
    || typeof input.expectedCiphertextSha256 !== 'string'
    || !SHA256.test(input.expectedCiphertextSha256)
  )) {
    throw new ArchiveCustodyReconcileEnvelopeError(
      'Version-two reconciliation requires an exact registered byte identity.',
    )
  }
  if (input.containerVersion === 1 && (
    input.expectedSizeBytes !== null && (
      !Number.isSafeInteger(input.expectedSizeBytes) || input.expectedSizeBytes < 0
    )
    || input.expectedCiphertextSha256 !== null && (
      typeof input.expectedCiphertextSha256 !== 'string'
      || !SHA256.test(input.expectedCiphertextSha256)
    )
  )) {
    throw new ArchiveCustodyReconcileEnvelopeError('Legacy reconciliation identity is invalid.')
  }
  return Object.freeze({
    operationId,
    registryRowid: input.registryRowid,
    archiveId,
    containerVersion: input.containerVersion,
    archiveDirectory: input.archiveDirectory,
    archiveRelativePath,
    expectedSizeBytes: input.expectedSizeBytes,
    expectedCiphertextSha256: input.expectedCiphertextSha256,
  })
}

/** Validates one worker observation against the exact issued ticket. */
function normalizeArchiveCustodyReconcileResult(input, expectedInput) {
  const expected = normalizeArchiveCustodyReconcileTicket(expectedInput)
  requireExactRecord(input, RESULT_KEYS, 'Archive reconciliation result')
  if (input.type !== 'complete' || input.operationId !== expected.operationId
    || input.registryRowid !== expected.registryRowid || input.archiveId !== expected.archiveId
    || input.containerVersion !== expected.containerVersion
    || input.archiveRelativePath !== expected.archiveRelativePath
    || input.expectedSizeBytes !== expected.expectedSizeBytes
    || input.expectedCiphertextSha256 !== expected.expectedCiphertextSha256) {
    throw new ArchiveCustodyReconcileEnvelopeError(
      'Archive reconciliation result identity was substituted.',
    )
  }
  if (input.outcome === 'available') {
    if (!Number.isSafeInteger(input.observedSizeBytes) || input.observedSizeBytes < 1
      || expected.containerVersion === 2 && (
        typeof input.observedCiphertextSha256 !== 'string'
        || !SHA256.test(input.observedCiphertextSha256)
      )
      || expected.containerVersion === 1 && expected.expectedCiphertextSha256 === null
        && input.observedCiphertextSha256 !== null
      || expected.containerVersion === 1 && expected.expectedCiphertextSha256 !== null
        && (typeof input.observedCiphertextSha256 !== 'string'
          || !SHA256.test(input.observedCiphertextSha256))) {
      throw new ArchiveCustodyReconcileEnvelopeError(
        'Archive reconciliation available result is invalid.',
      )
    }
    let fileIdentity
    try {
      fileIdentity = normalizeCustodyFileIdentity(input.fileIdentity)
    } catch {
      throw new ArchiveCustodyReconcileEnvelopeError(
        'Archive reconciliation file identity is invalid.',
      )
    }
    if (fileIdentity.sizeBytes !== input.observedSizeBytes) {
      throw new ArchiveCustodyReconcileEnvelopeError(
        'Archive reconciliation size and file identity disagree.',
      )
    }
    return Object.freeze({ ...input, fileIdentity })
  }
  if (!FAILURE_OUTCOMES.has(input.outcome)
    || input.observedSizeBytes !== null
    || input.observedCiphertextSha256 !== null
    || input.fileIdentity !== null) {
    throw new ArchiveCustodyReconcileEnvelopeError(
      'Archive reconciliation failure result is invalid.',
    )
  }
  return Object.freeze({ ...input })
}

module.exports = {
  ArchiveCustodyReconcileEnvelopeError,
  normalizeArchiveCustodyReconcileResult,
  normalizeArchiveCustodyReconcileTicket,
}
