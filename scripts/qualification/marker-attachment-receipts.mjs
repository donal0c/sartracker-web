import { createHash } from 'node:crypto'

const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const MARKER_KINDS = Object.freeze(['ipp_lkp', 'clue', 'hazard', 'casualty'])
const ATTACHMENT_FILE_NAME = 'same-name.txt'
const ORIGINAL_ATTACHMENT_BYTES = Buffer.from('C12 original attachment bytes', 'utf8')
const REPLACEMENT_ATTACHMENT_BYTES = Buffer.from('C12 replacement attachment bytes', 'utf8')
const LIFECYCLE = Object.freeze(['created', 'updated', 'retired'])
const AUDIT_EVENT_TYPES = Object.freeze(['marker_created', 'marker_updated', 'marker_deleted'])
const ATTACHMENT_REFERENCE_KINDS = new Set([
  'marker',
  'marker_version',
  'marker_attachment_ingested',
  'marker_created',
  'marker_updated',
  'marker_deleted',
])
const UUID_ATTACHMENT_BASENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-same-name\.txt$/u
const ARCHIVE_ATTACHMENT_ENTRY = /^attachments\/[0-9]{8}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-same-name\.txt$/u

/** Validate the independent, fixed C12 packaged marker and attachment workload. */
export function validateMarkerAttachmentReceipt(report, expected) {
  const failureReasons = []
  const predicates = {
    identity: false,
    markerLifecycles: false,
    attachmentBytes: false,
    archiveCustody: false,
  }
  try {
    validateExpectedBinding(expected)
    validateReportIdentity(report, expected)
    predicates.identity = true
    validateMarkerLifecycles(report, expected)
    predicates.markerLifecycles = true
    validateAttachmentBytes(report, expected)
    predicates.attachmentBytes = true
    validateArchiveCustody(report, expected)
    predicates.archiveCustody = true
  } catch (error) {
    failureReasons.push(error instanceof Error ? error.message : String(error))
  }
  return Object.freeze({
    status: failureReasons.length === 0 ? 'PASS' : 'INVALID_EVIDENCE',
    passed: failureReasons.length === 0,
    failureReasons: Object.freeze(failureReasons),
    predicates: Object.freeze(predicates),
    scope: 'packaged marker lifecycle and synthetic attachment custody; no field corpus or operator qualification claim',
  })
}

/** Check the controller-owned immutable identity and bounded C12 workload. */
function validateExpectedBinding(expected) {
  if (!isRecord(expected) || expected.proofMode !== 'packaged-electron-marker-attachment') {
    throw new Error('C12 marker receipt proof mode is not bound to the reviewed packaged adapter.')
  }
  if (!isRecord(expected.source)
      || !SHA1.test(expected.source.expectedHead)
      || !SHA1.test(expected.source.tree)) {
    throw new Error('C12 marker receipt source identity is incomplete.')
  }
  if (!isRecord(expected.artifact)
      || !SHA256.test(expected.artifact.packagedExecutableSha256)
      || !SHA256.test(expected.artifact.packagedApplicationArchiveSha256)) {
    throw new Error('C12 marker receipt package identity is incomplete.')
  }
  if (!isRecord(expected.workload)
      || !sameArray(expected.workload.markerKinds, MARKER_KINDS)
      || expected.workload.attachmentFileName !== ATTACHMENT_FILE_NAME) {
    throw new Error('C12 marker receipt workload is not the fixed reviewed synthetic contract.')
  }
}

/** Check report identity without trusting any producer verdict field. */
function validateReportIdentity(report, expected) {
  if (!isRecord(report)
      || report.schemaVersion !== 1
      || report.schema !== 'sartracker-marker-attachment-probe-v1'
      || report.developmentTestHarness === true
      || report.proofTier !== 'packaged-electron'
      || report.proofMode !== expected.proofMode) {
    throw new Error('C12 marker receipt schema or proof mode is missing.')
  }
  if (!isRecord(report.source)
      || report.source.head !== expected.source.expectedHead
      || report.source.tree !== expected.source.tree) {
    throw new Error('C12 marker receipt source identity differs from the immutable binding.')
  }
  if (!isRecord(report.artifact)
      || report.artifact.executableSha256 !== expected.artifact.packagedExecutableSha256
      || report.artifact.archiveSha256 !== expected.artifact.packagedApplicationArchiveSha256) {
    throw new Error('C12 marker receipt package identity differs from the observed runtime.')
  }
  if (!isRecord(report.mission)
      || typeof report.mission.missionId !== 'string'
      || report.mission.missionId.length < 1
      || report.mission.finished !== true
      || report.mission.activeMarkerCountAfterRetire !== 0) {
    throw new Error('C12 marker receipt does not prove a finished mission with retired markers.')
  }
}

/** Check create, edit and append-only retirement for each fixed marker kind. */
function validateMarkerLifecycles(report, expected) {
  if (!Array.isArray(report.markers) || report.markers.length !== MARKER_KINDS.length) {
    throw new Error('C12 marker receipt does not contain exactly one entry per marker kind.')
  }
  const seen = new Set()
  for (const marker of report.markers) {
    if (!isRecord(marker)
        || typeof marker.type !== 'string'
        || seen.has(marker.type)
        || !MARKER_KINDS.includes(marker.type)
        || typeof marker.markerId !== 'string'
        || marker.markerId.length < 1
        || !sameArray(marker.lifecycle, LIFECYCLE)
        || !sameArray(marker.versionOperations, LIFECYCLE)
        || marker.versionCount !== 3
        || !Array.isArray(marker.auditEvents)
        || marker.auditEvents.length !== LIFECYCLE.length
        || marker.activeAfterRetire !== false
        || marker.updatedIdMatches !== true) {
      throw new Error('C12 marker receipt has an incomplete or non-append-only marker lifecycle.')
    }
    const auditOperations = marker.auditEvents.map((event) => {
      if (!isRecord(event) || typeof event.id !== 'string' || event.id.length < 1
          || !AUDIT_EVENT_TYPES.includes(event.eventType)
          || typeof event.timestamp !== 'string' || Number.isNaN(Date.parse(event.timestamp))) {
        throw new Error('C12 marker receipt raw audit lifecycle identity is invalid.')
      }
      return { marker_created: 'created', marker_updated: 'updated', marker_deleted: 'retired' }[event.eventType]
    })
    if (!sameArray(auditOperations, LIFECYCLE)
        || new Set(marker.auditEvents.map((event) => event.id)).size !== marker.auditEvents.length) {
      throw new Error('C12 marker receipt raw audit lifecycle order is not create/update/retire.')
    }
    seen.add(marker.type)
  }
  if (!sameArray([...seen].sort(), [...MARKER_KINDS].sort())) {
    throw new Error('C12 marker receipt marker kinds differ from the fixed workload.')
  }
}

/** Recompute stored, archived, and restored bytes without accepting inline producer bytes. */
function validateAttachmentBytes(report, expected) {
  if (!Array.isArray(report.attachments) || report.attachments.length !== 2) {
    throw new Error('C12 marker receipt must retain exactly the original and replacement attachments.')
  }
  const expectedEntries = new Map([
    ['original', ORIGINAL_ATTACHMENT_BYTES],
    ['replacement', REPLACEMENT_ATTACHMENT_BYTES],
  ])
  const seen = new Set()
  for (const attachment of report.attachments) {
    if (!isRecord(attachment)
        || typeof attachment.version !== 'string'
        || seen.has(attachment.version)
        || !expectedEntries.has(attachment.version)
        || attachment.fileName !== expected.workload.attachmentFileName
        || Object.prototype.hasOwnProperty.call(attachment, 'contentBase64')
        || !isRecord(attachment.stored)
        || !isRecord(attachment.archive)
        || !isRecord(attachment.restored)
        || typeof attachment.storedBasename !== 'string'
        || !UUID_ATTACHMENT_BASENAME.test(attachment.storedBasename)
        || !ARCHIVE_ATTACHMENT_ENTRY.test(attachment.archive.entryName)
        || attachment.archive.sourceBasename !== attachment.storedBasename
        || attachment.restored.sourceBasename !== attachment.storedBasename
        || attachment.restored.entryName !== attachment.archive.entryName
        || attachment.restored.basename !== attachment.archive.entryName.slice('attachments/'.length)) {
      throw new Error('C12 marker receipt attachment identity or bounded bytes are invalid.')
    }
    const expectedBytes = expectedEntries.get(attachment.version)
    const expectedSha256 = sha256(expectedBytes)
    for (const [label, identity] of [['stored', attachment.stored], ['archive', attachment.archive], ['restored', attachment.restored]]) {
      if (!Number.isSafeInteger(identity.bytes) || identity.bytes !== expectedBytes.length
          || identity.sha256 !== expectedSha256) {
        throw new Error(`C12 ${label} attachment bytes differ from the fixed independent oracle.`)
      }
    }
    seen.add(attachment.version)
  }
  if (!sameArray([...seen].sort(), [...expectedEntries.keys()].sort())) {
    throw new Error('C12 marker receipt does not prove an original and replacement attachment.')
  }
}

/** Check encrypted archive finalization and read-only review references for both versions. */
function validateArchiveCustody(report, expected) {
  const archive = report.archive
  const review = archive?.review
  if (!isRecord(archive)
      || archive.finalized !== true
      || archive.containerVersion !== 2
      || archive.immutable !== true
      || archive.verified !== true
      || !isRecord(review)
      || review.opened !== true
      || review.closed !== true
      || review.immutable !== true
      || !Array.isArray(review.attachmentReferences)) {
    throw new Error('C12 marker receipt does not prove encrypted archive and read-only review custody.')
  }
  const attachments = new Set(report.attachments.map((entry) => entry.storedBasename))
  const references = review.attachmentReferences
  if (references.some((entry) => !isRecord(entry)
      || !attachments.has(entry.attachmentPath)
      || typeof entry.referenceId !== 'string' || entry.referenceId.length < 1
      || !ATTACHMENT_REFERENCE_KINDS.has(entry.referenceKind))) {
    throw new Error('C12 marker receipt archive review contains an unbound attachment reference.')
  }
  for (const basename of attachments) {
    const matching = references.filter((entry) => entry.attachmentPath === basename)
    const versionReferences = matching.filter((entry) => entry.referenceKind === 'marker_version')
    const ingestReferences = matching.filter((entry) => entry.referenceKind === 'marker_attachment_ingested')
    if (versionReferences.length < 1 || ingestReferences.length < 1) {
      throw new Error('C12 marker receipt archive review is missing original and replacement custody references.')
    }
  }
}

/** Compare two small arrays by exact ordered value. */
function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => value === right[index])
}

/** Hash exact attachment bytes for the independent oracle. */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Identify a JSON record without accepting arrays. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
