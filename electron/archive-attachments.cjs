'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_REFERENCE_JSON_BYTES = 2 * 1024 * 1024
const READ_CHUNK_BYTES = 64 * 1024
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u
const ATTACHMENT_EVENT_TYPES = Object.freeze([
  'marker_attachment_ingested',
  'marker_created',
  'marker_updated',
  'marker_deleted',
])

/** Stable attachment-custody failure without reflecting filesystem content. */
class ArchiveAttachmentError extends Error {
  /** Creates a typed attachment failure. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveAttachmentError'
    this.code = code
  }
}

/** Requires one bounded plain JSON object. */
function parseReferenceJson(value, label) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_REFERENCE_JSON_BYTES) {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_INVALID',
      `Mission archive ${label} is missing or exceeds the safe bound.`,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_INVALID',
      `Mission archive ${label} is corrupt.`,
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_INVALID',
      `Mission archive ${label} must be a plain object.`,
    )
  }
  return parsed
}

/** Returns the only trusted Electron attachment directory for one mission. */
function trustedAttachmentRoot(databasePath, missionId) {
  if (
    typeof databasePath !== 'string'
    || !path.isAbsolute(databasePath)
    || typeof missionId !== 'string'
    || !/^[A-Za-z0-9_-]{1,200}$/u.test(missionId)
  ) {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_INVALID',
      'Mission archive attachment root identity is invalid.',
    )
  }
  return path.join(path.dirname(databasePath), 'missions', missionId, 'attachments')
}

/** Validates one app-owned direct-child path before it is opened. */
function normalizeAttachmentPath(value, attachmentRoot) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 8_192
    || CONTROL_CHARACTERS.test(value)
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
    || path.dirname(value) !== attachmentRoot
  ) {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_INVALID',
      'Mission archive attachment is outside its app-owned mission directory.',
    )
  }
  return value
}

/** Returns one filename from an archived native path without touching its original host. */
function portableBasename(value) {
  const segments = value.replaceAll('\\', '/').split('/')
  return segments.at(-1)
}

/** Validates the archived path shape while deliberately not reopening original-host storage. */
function normalizeRestoredAttachmentPath(value, missionId) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 8_192
    || CONTROL_CHARACTERS.test(value)
  ) {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_INVALID',
      'Mission archive archived mission attachment path is invalid.',
    )
  }
  const portable = value.replaceAll('\\', '/')
  const absolute = portable.startsWith('/') || /^[A-Za-z]:\//u.test(portable)
  const segments = portable.split('/').filter((segment, index) => index !== 0 || segment !== '')
  const suffix = segments.slice(-4)
  if (!absolute || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    || suffix.length !== 4 || suffix[0] !== 'missions' || suffix[1] !== missionId
    || suffix[2] !== 'attachments' || suffix[3].length < 1) {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_INVALID',
      'Mission archive archived mission attachment path is invalid.',
    )
  }
  return value
}

/** Adds one evidence reference while retaining its independent provenance. */
function addReference(records, input) {
  if (input.path === null || input.path === undefined || input.path === '') return
  if (typeof input.path !== 'string') {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_INVALID',
      'Mission archive attachment reference has an invalid path.',
    )
  }
  const record = records.get(input.path) ?? { path: input.path, references: [], custody: [] }
  record.references.push(Object.freeze({
    referenceId: input.referenceId,
    referenceKind: input.referenceKind,
  }))
  if (input.custody !== undefined) record.custody.push(input.custody)
  records.set(input.path, record)
}

/** Parses and validates the backward-compatible v2 ingest-custody projection. */
function readCustodyV2(details, missionId, attachmentPath) {
  if (details.custody_version === undefined) return undefined
  if (
    details.custody_version !== 2
    || typeof details.attachment_id !== 'string'
    || !UUID_V4.test(details.attachment_id)
    || !Number.isSafeInteger(details.size_bytes)
    || details.size_bytes < 1
    || details.size_bytes > MAX_ATTACHMENT_BYTES
    || typeof details.sha256 !== 'string'
    || !SHA256.test(details.sha256)
    || details.relative_path !== `missions/${missionId}/attachments/${portableBasename(attachmentPath)}`
    || typeof details.display_name !== 'string'
    || details.display_name.length < 1
    || Buffer.byteLength(details.display_name, 'utf8') > 255
  ) {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_INVALID',
      'Mission archive v2 attachment custody record is invalid.',
    )
  }
  return Object.freeze({
    attachmentId: details.attachment_id,
    sizeBytes: details.size_bytes,
    sha256: details.sha256,
  })
}

/** Enumerates every current, immutable-version and audit attachment reference. */
function enumerateReferences(db, missionId) {
  const records = new Map()
  const markers = db.prepare(`SELECT id, attachment_path FROM markers
    WHERE mission_id = ? AND attachment_path IS NOT NULL AND attachment_path != ''
    ORDER BY id`).all(missionId)
  for (const marker of markers) {
    addReference(records, {
      path: marker.attachment_path,
      referenceKind: 'marker',
      referenceId: marker.id,
    })
  }
  const versions = db.prepare(`SELECT id, state_json FROM mission_object_versions
    WHERE mission_id = ? AND object_type = 'marker'
    ORDER BY object_id, version_sequence, id`).all(missionId)
  for (const version of versions) {
    const state = parseReferenceJson(version.state_json, 'marker-version evidence')
    addReference(records, {
      path: state.attachment_path,
      referenceKind: 'marker_version',
      referenceId: version.id,
    })
  }
  const events = db.prepare(`SELECT id, event_type, details_json FROM mission_events
    WHERE mission_id = ? AND event_type IN (?, ?, ?, ?)
    ORDER BY timestamp, rowid`).all(missionId, ...ATTACHMENT_EVENT_TYPES)
  for (const event of events) {
    const details = parseReferenceJson(event.details_json, 'attachment audit evidence')
    if (event.event_type === 'marker_attachment_ingested'
      && typeof details.attachment_path !== 'string') {
      throw new ArchiveAttachmentError(
        'ARCHIVE_ATTACHMENT_INVALID',
        'Mission archive attachment custody event has no path.',
      )
    }
    const custody = event.event_type === 'marker_attachment_ingested'
      && typeof details.attachment_path === 'string'
      ? readCustodyV2(details, missionId, details.attachment_path)
      : undefined
    addReference(records, {
      path: details.attachment_path,
      referenceKind: event.event_type,
      referenceId: event.id,
      custody,
    })
  }
  return records
}

/** Reads the exhaustive database-only attachment reference ledger without opening files. */
function readArchiveAttachmentReferenceLedger(input) {
  if (!input?.db || typeof input.db.prepare !== 'function') {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_INVALID',
      'Mission archive attachment ledger requires a pinned database.',
    )
  }
  const attachmentRoot = input.restored === true
    ? null
    : trustedAttachmentRoot(input.databasePath, input.missionId)
  const records = enumerateReferences(input.db, input.missionId)
  const ledger = []
  for (const record of records.values()) {
    const attachmentPath = input.restored === true
      ? normalizeRestoredAttachmentPath(record.path, input.missionId)
      : normalizeAttachmentPath(record.path, attachmentRoot)
    let custody = null
    for (const candidate of record.custody) {
      if (custody !== null && (
        candidate.attachmentId !== custody.attachmentId
        || candidate.sizeBytes !== custody.sizeBytes
        || candidate.sha256 !== custody.sha256
      )) {
        throw new ArchiveAttachmentError(
          'ARCHIVE_ATTACHMENT_INVALID',
          'Mission archive attachment has conflicting custody records.',
        )
      }
      custody = candidate
    }
    const references = record.references.slice().sort((left, right) => {
      const leftKey = `${left.referenceKind}\u0000${left.referenceId}`
      const rightKey = `${right.referenceKind}\u0000${right.referenceId}`
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    })
    ledger.push(Object.freeze({
      sourcePath: attachmentPath,
      sourceRelativePath: portableBasename(attachmentPath),
      references: Object.freeze(references),
      custody,
    }))
  }
  ledger.sort((left, right) => left.sourceRelativePath < right.sourceRelativePath
    ? -1
    : left.sourceRelativePath > right.sourceRelativePath ? 1 : 0)
  return Object.freeze(ledger)
}

/** Requires every attachment manifest digest and size to equal its encrypted entry proof. */
function verifyArchiveAttachmentEntryProofs(input) {
  if (!Array.isArray(input?.attachments) || !Array.isArray(input?.entries)
    || input.attachments.length !== input.entries.length) {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_INVALID',
      'Mission archive attachment and encrypted entry proofs do not match.',
    )
  }
  input.attachments.forEach((attachment, index) => {
    const entry = input.entries[index]
    if (attachment === null || typeof attachment !== 'object'
      || entry === null || typeof entry !== 'object'
      || attachment.entry_name !== entry.name
      || attachment.size_bytes !== entry.size_bytes
      || attachment.sha256 !== entry.sha256) {
      throw new ArchiveAttachmentError(
        'ARCHIVE_ATTACHMENT_INVALID',
        'Mission archive attachment and encrypted entry proofs do not match.',
      )
    }
  })
}

/** Ensures a file and trusted root are regular, direct, non-linked custody paths. */
function openValidatedAttachment(attachmentPath, attachmentRoot) {
  let rootStat
  let fileStat
  try {
    rootStat = fs.lstatSync(attachmentRoot)
    fileStat = fs.lstatSync(attachmentPath)
  } catch {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_MISSING',
      'Mission archive attachment is missing.',
    )
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()
    || !fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.nlink !== 1) {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_INVALID',
      'Mission archive attachment is not a regular owner-contained file.',
    )
  }
  if (fileStat.size < 1 || fileStat.size > MAX_ATTACHMENT_BYTES) {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_INVALID',
      'Mission archive attachment size is outside the supported custody bound.',
    )
  }
  let rootRealPath
  let fileRealPath
  try {
    rootRealPath = fs.realpathSync(attachmentRoot)
    fileRealPath = fs.realpathSync(attachmentPath)
  } catch {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_MISSING',
      'Mission archive attachment path changed before it could be opened.',
    )
  }
  if (path.dirname(fileRealPath) !== rootRealPath) {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_INVALID',
      'Mission archive attachment escapes its trusted directory.',
    )
  }
  let descriptor
  try {
    descriptor = fs.openSync(
      attachmentPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    )
  } catch {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_MISSING',
      'Mission archive attachment could not be opened safely.',
    )
  }
  const openedStat = fs.fstatSync(descriptor)
  if (
    !openedStat.isFile()
    || openedStat.dev !== fileStat.dev
    || openedStat.ino !== fileStat.ino
    || openedStat.size !== fileStat.size
  ) {
    fs.closeSync(descriptor)
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_CHANGED',
      'Mission archive attachment changed while it was opened.',
    )
  }
  return { descriptor, stat: openedStat }
}

/** Reads and hashes one open descriptor without loading the whole file. */
function hashOpenAttachment(descriptor, expectedSize) {
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES)
  let total = 0
  while (total < expectedSize) {
    const bytesRead = fs.readSync(
      descriptor,
      buffer,
      0,
      Math.min(buffer.length, expectedSize - total),
      null,
    )
    if (bytesRead === 0) break
    hash.update(buffer.subarray(0, bytesRead))
    total += bytesRead
  }
  buffer.fill(0)
  return { sizeBytes: total, sha256: hash.digest('hex') }
}

/** Rechecks an opened file and its current path after one complete read. */
function assertAttachmentUnchanged(attachmentPath, descriptor, before, measured) {
  const after = fs.fstatSync(descriptor)
  let pathAfter
  try {
    pathAfter = fs.lstatSync(attachmentPath)
  } catch {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_CHANGED',
      'Mission archive attachment path changed during reading.',
    )
  }
  if (
    measured.sizeBytes !== before.size
    || after.dev !== before.dev
    || after.ino !== before.ino
    || after.size !== before.size
    || after.mtimeMs !== before.mtimeMs
    || pathAfter.dev !== before.dev
    || pathAfter.ino !== before.ino
    || pathAfter.size !== before.size
    || pathAfter.mtimeMs !== before.mtimeMs
  ) {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_CHANGED',
      'Mission archive attachment changed during reading.',
    )
  }
}

/** Prehashes one validated file and closes its descriptor on every path. */
function prehashAttachment(attachmentPath, attachmentRoot) {
  const opened = openValidatedAttachment(attachmentPath, attachmentRoot)
  try {
    const measured = hashOpenAttachment(opened.descriptor, opened.stat.size)
    assertAttachmentUnchanged(attachmentPath, opened.descriptor, opened.stat, measured)
    return measured
  } finally {
    fs.closeSync(opened.descriptor)
  }
}

/** Creates immutable, deterministic descriptors for every referenced attachment. */
function enumerateArchiveAttachments(input) {
  if ((input?.isCancelled !== undefined && typeof input.isCancelled !== 'function')
    || (input?.onProgress !== undefined && typeof input.onProgress !== 'function')) {
    throw new ArchiveAttachmentError(
      'ARCHIVE_ATTACHMENT_INVALID',
      'Mission archive attachment progress controls are invalid.',
    )
  }
  const attachmentRoot = trustedAttachmentRoot(input.databasePath, input.missionId)
  const ledger = readArchiveAttachmentReferenceLedger(input)
  if (ledger.length === 0) return Object.freeze([])
  const candidates = []
  for (const [index, record] of ledger.entries()) {
    if (input.isCancelled?.()) {
      throw new ArchiveAttachmentError(
        'ARCHIVE_CANCELLED',
        'Mission archive attachment proof was cancelled.',
      )
    }
    const measured = prehashAttachment(record.sourcePath, attachmentRoot)
    const custody = record.custody
    if (custody !== null && (
      custody.sizeBytes !== measured.sizeBytes || custody.sha256 !== measured.sha256
    )) {
      throw new ArchiveAttachmentError(
        'ARCHIVE_ATTACHMENT_CHANGED',
        'Mission archive attachment does not match its recorded custody digest.',
      )
    }
    candidates.push({
      attachmentId: custody?.attachmentId
        ?? `legacy-${createHash('sha256').update(record.sourceRelativePath, 'utf8').digest('hex').slice(0, 32)}`,
      sourcePath: record.sourcePath,
      sourceRelativePath: record.sourceRelativePath,
      sizeBytes: measured.sizeBytes,
      sha256: measured.sha256,
      custodyClass: custody === null ? 'legacy_path_only' : 'v2_digest',
      references: record.references,
    })
    input.onProgress?.(Object.freeze({ completed: index + 1, total: ledger.length }))
  }
  candidates.sort((left, right) => left.sourceRelativePath < right.sourceRelativePath
    ? -1
    : left.sourceRelativePath > right.sourceRelativePath ? 1 : 0)
  return Object.freeze(candidates.map((candidate, index) => Object.freeze({
    ...candidate,
    entryName: `attachments/${String(index + 1).padStart(8, '0')}-${candidate.sourceRelativePath}`,
  })))
}

/** Streams one prehashed attachment and rejects any byte/path mutation before completion. */
async function* streamArchiveAttachment(descriptor) {
  const attachmentRoot = path.dirname(descriptor.sourcePath)
  const opened = openValidatedAttachment(descriptor.sourcePath, attachmentRoot)
  const hash = createHash('sha256')
  let total = 0
  try {
    while (total < opened.stat.size) {
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, opened.stat.size - total))
      const bytesRead = fs.readSync(opened.descriptor, chunk, 0, chunk.length, null)
      if (bytesRead === 0) break
      const output = bytesRead === chunk.length ? chunk : Buffer.from(chunk.subarray(0, bytesRead))
      if (output !== chunk) chunk.fill(0)
      hash.update(output)
      total += bytesRead
      yield output
    }
    const measured = { sizeBytes: total, sha256: hash.digest('hex') }
    assertAttachmentUnchanged(descriptor.sourcePath, opened.descriptor, opened.stat, measured)
    if (measured.sizeBytes !== descriptor.sizeBytes || measured.sha256 !== descriptor.sha256) {
      throw new ArchiveAttachmentError(
        'ARCHIVE_ATTACHMENT_CHANGED',
        'Mission archive attachment changed between inventory and encryption.',
      )
    }
  } finally {
    fs.closeSync(opened.descriptor)
  }
}

module.exports = {
  ArchiveAttachmentError,
  enumerateArchiveAttachments,
  readArchiveAttachmentReferenceLedger,
  streamArchiveAttachment,
  verifyArchiveAttachmentEntryProofs,
}
