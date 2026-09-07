'use strict'

const { createHash } = require('node:crypto')
const path = require('node:path')

const {
  deriveArchiveLifecycleEventId,
  readCurrentMissionFinalizationBoundary,
} = require('./mission-finalization-boundary.cjs')

const CORRECTION_ATTACHMENT_CUSTODY_KEY = 'archive_correction_attachment_custody_v2'
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_CUSTODY_BYTES = 4 * 1024 * 1024
const MAX_CUSTODY_ENTRIES = 4_096
const IDENTIFIER = /^[A-Za-z0-9_-]{1,200}$/u
const SHA256 = /^[0-9a-f]{64}$/u

/** Builds one bounded SQLite-backed custody plan before any attachment bytes exist. */
function createCorrectionAttachmentCustodyPlan(input) {
  if (!Array.isArray(input?.mappings)
    || input.mappings.length < 1 || input.mappings.length > MAX_CUSTODY_ENTRIES) {
    throw new Error('Correction attachment custody mappings are invalid or unbounded.')
  }
  const operationToken = createHash('sha256').update(String(input.operationId)).digest('hex').slice(0, 16)
  const entries = input.mappings.map((mapping, index) => {
    const extension = boundedPortableExtension(mapping?.sourceRelativePath)
    const displayStem = boundedPortableDisplayStem(mapping?.sourceRelativePath)
    const targetName = `correction-${operationToken}-${index.toString(16).padStart(4, '0')}-${displayStem}-${String(mapping?.sha256).slice(0, 16)}${extension}`
    return Object.freeze({
      entryName: mapping?.entryName,
      sourceRelativePath: mapping?.sourceRelativePath,
      targetName,
      peerName: `.${targetName}.custody`,
      sha256: mapping?.sha256,
      sizeBytes: mapping?.sizeBytes,
    })
  })
  const plan = Object.freeze({
    version: 2,
    missionId: input?.missionId,
    archiveId: input?.archiveId,
    operationId: input?.operationId,
    finalizedEpoch: input?.finalizedEpoch,
    targetIdentity: Object.freeze({ ...input?.targetIdentity }),
    entries: Object.freeze(entries),
  })
  validateCorrectionAttachmentCustodyPlan(plan)
  return plan
}

/** Persists exactly one globally admitted correction attachment plan in SQLite. */
function writeCorrectionAttachmentCustody(db, plan) {
  validateDatabase(db)
  validateCorrectionAttachmentCustodyPlan(plan)
  const document = JSON.stringify(plan)
  const size = Buffer.byteLength(document, 'utf8')
  if (size < 1 || size > MAX_CUSTODY_BYTES) {
    throw new Error('Correction attachment custody record is unbounded.')
  }
  try {
    db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)')
      .run(CORRECTION_ATTACHMENT_CUSTODY_KEY, document)
  } catch (error) {
    const failure = new Error('Another correction attachment custody record is already active.')
    failure.cause = error
    throw failure
  }
}

/** Reads and validates the sole durable correction attachment plan. */
function readCorrectionAttachmentCustody(db) {
  validateDatabase(db)
  const row = db.prepare('SELECT value FROM metadata WHERE key = ?')
    .get(CORRECTION_ATTACHMENT_CUSTODY_KEY)
  if (row === undefined) return null
  if (typeof row.value !== 'string') {
    throw new Error('Correction attachment custody record is invalid.')
  }
  const size = Buffer.byteLength(row.value, 'utf8')
  if (size < 1 || size > MAX_CUSTODY_BYTES) {
    throw new Error('Correction attachment custody record is invalid or unbounded.')
  }
  let plan
  try {
    plan = JSON.parse(row.value)
  } catch (error) {
    const failure = new Error('Correction attachment custody record is invalid.')
    failure.cause = error
    throw failure
  }
  validateCorrectionAttachmentCustodyPlan(plan)
  return deepFreezePlan(plan)
}

/** Clears only the exact active correction record; callers may include this in unlock commit. */
function clearCorrectionAttachmentCustody(db, operationId) {
  validateDatabase(db)
  const plan = readCorrectionAttachmentCustody(db)
  if (plan === null || plan.operationId !== operationId) {
    throw new Error('Correction attachment custody operation identity changed before clear.')
  }
  const result = db.prepare('DELETE FROM metadata WHERE key = ? AND value = ?')
    .run(CORRECTION_ATTACHMENT_CUSTODY_KEY, JSON.stringify(plan))
  if (result?.changes !== 1) {
    throw new Error('Correction attachment custody record changed before clear.')
  }
}

/** Reports whether startup or a failed correction still owns a durable custody record. */
function hasCorrectionAttachmentCustody(db) {
  validateDatabase(db)
  return db.prepare('SELECT 1 FROM metadata WHERE key = ?').get(
    CORRECTION_ATTACHMENT_CUSTODY_KEY,
  ) !== undefined
}

/** Computes full attachment proofs without owning a SQLite writer transaction. */
function prepareCorrectionAttachmentCustodyReconciliation(input) {
  validateDatabase(input?.db)
  validateCorrectionAttachmentCustodyPlan(input?.plan)
  if (typeof input.inspectEntry !== 'function') {
    throw new Error('Correction attachment custody reconciliation requires a safe entry inspector.')
  }
  const plan = readCorrectionAttachmentCustody(input.db)
  if (plan === null || JSON.stringify(plan) !== JSON.stringify(input.plan)) {
    throw new Error('Correction attachment custody record changed before inspection.')
  }
  const entries = plan.entries.map((entry) => {
    if (input.db.inTransaction === true) {
      throw new Error('Correction attachment custody full inspection cannot hold a writer transaction.')
    }
    const observation = input.inspectEntry(entry)
    const state = correctionAttachmentResidueState(observation)
    return Object.freeze({
      targetName: entry.targetName,
      peerName: entry.peerName,
      state,
      observation,
    })
  })
  return Object.freeze({
    version: 1,
    operationId: plan.operationId,
    planDocument: JSON.stringify(plan),
    entries: Object.freeze(entries),
  })
}

/** Revalidates cheap topology and clears an exact proven plan in one short transaction. */
function reconcileCorrectionAttachmentCustody(input) {
  validateDatabase(input?.db)
  const inspection = input?.inspection
  if (inspection === null || typeof inspection !== 'object' || Array.isArray(inspection)
    || Object.keys(inspection).sort().join(',')
      !== 'entries,operationId,planDocument,version'
    || inspection.version !== 1
    || !IDENTIFIER.test(inspection.operationId ?? '')
    || typeof inspection.planDocument !== 'string'
    || Buffer.byteLength(inspection.planDocument, 'utf8') < 1
    || Buffer.byteLength(inspection.planDocument, 'utf8') > MAX_CUSTODY_BYTES
    || !Array.isArray(inspection.entries)
    || typeof input.revalidateEntry !== 'function') {
    throw new Error('Correction attachment custody reconciliation proof is invalid.')
  }
  const plan = readCorrectionAttachmentCustody(input.db)
  if (plan === null || JSON.stringify(plan) !== inspection.planDocument
    || plan.operationId !== inspection.operationId
    || inspection.entries.length !== plan.entries.length) {
    throw new Error('Correction attachment custody record changed before clear.')
  }
  const mission = input.db.prepare('SELECT status FROM missions WHERE id = ?').get(plan.missionId)
  const unlockEventId = deriveArchiveLifecycleEventId(plan.archiveId, 'mission-unlocked')
  const unlockEvent = input.db.prepare(`SELECT id, mission_id, event_type, details_json
    FROM mission_events WHERE id = ?`).get(unlockEventId)
  const correctionOperationId = readCorrectionOperationId(unlockEvent, plan)
  const committed = correctionOperationId === plan.operationId
  if (correctionOperationId !== null && !committed) {
    throw new Error('Correction attachment custody is owned by a different correction.')
  }
  if (mission?.status === 'finished' && !committed) {
    throw new Error('Finished correction custody has no matching durable unlock evidence.')
  }
  if (committed && mission?.status !== 'finished') {
    throw new Error('Correction attachment custody unlock evidence is not reflected by mission state.')
  }
  if (!committed) {
    const boundary = readCurrentMissionFinalizationBoundary(input.db, {
      missionId: plan.missionId,
      archiveId: plan.archiveId,
    })
    if (boundary?.archiveId !== plan.archiveId
      || boundary?.eventRowid !== plan.finalizedEpoch) {
      throw new Error('Correction attachment custody finalization boundary changed before reconciliation.')
    }
  }
  for (const [index, entry] of plan.entries.entries()) {
    const inspected = inspection.entries[index]
    if (inspected === null || typeof inspected !== 'object' || Array.isArray(inspected)
      || Object.keys(inspected).sort().join(',')
        !== 'observation,peerName,state,targetName'
      || inspected.targetName !== entry.targetName
      || inspected.peerName !== entry.peerName
      || correctionAttachmentResidueState(inspected.state) !== inspected.state) {
      throw new Error('Correction attachment custody reconciliation proof changed.')
    }
    const state = correctionAttachmentResidueState(
      input.revalidateEntry(entry, inspected.observation),
    )
    if (state !== inspected.state) {
      throw new Error('Correction attachment custody residue changed before clear.')
    }
    if (committed && state !== 'pair') {
      throw new Error('Committed correction attachment custody is incomplete.')
    }
  }
  clearCorrectionAttachmentCustody(input.db, plan.operationId)
  return Object.freeze({ recovered: 1, committed })
}

/** Extracts the sole valid residue state from an inspector observation. */
function correctionAttachmentResidueState(value) {
  const state = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value.state
    : value
  if (!['absent', 'peer', 'pair'].includes(state)) {
    throw new Error('Correction attachment custody residue is invalid.')
  }
  return state
}

/** Validates one closed custody plan containing no authority-bearing filesystem paths. */
function validateCorrectionAttachmentCustodyPlan(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',')
      !== 'archiveId,entries,finalizedEpoch,missionId,operationId,targetIdentity,version'
    || value.version !== 2
    || !IDENTIFIER.test(value.missionId ?? '')
    || !IDENTIFIER.test(value.archiveId ?? '')
    || !IDENTIFIER.test(value.operationId ?? '')
    || !Number.isSafeInteger(value.finalizedEpoch) || value.finalizedEpoch < 1
    || !validDirectoryIdentity(value.targetIdentity)
    || !Array.isArray(value.entries)
    || value.entries.length < 1 || value.entries.length > MAX_CUSTODY_ENTRIES) {
    throw new Error('Correction attachment custody record is invalid.')
  }
  const operationToken = createHash('sha256').update(value.operationId).digest('hex').slice(0, 16)
  const names = new Set()
  value.entries.forEach((entry, index) => {
    const extension = boundedPortableExtension(entry?.sourceRelativePath)
    const displayStem = boundedPortableDisplayStem(entry?.sourceRelativePath)
    const targetName = `correction-${operationToken}-${index.toString(16).padStart(4, '0')}-${displayStem}-${String(entry?.sha256).slice(0, 16)}${extension}`
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).sort().join(',')
        !== 'entryName,peerName,sha256,sizeBytes,sourceRelativePath,targetName'
      || typeof entry.entryName !== 'string'
      || !entry.entryName.startsWith('attachments/')
      || path.posix.dirname(entry.entryName) !== 'attachments'
      || entry.entryName.split('/').length !== 2
      || typeof entry.sourceRelativePath !== 'string'
      || path.basename(entry.sourceRelativePath) !== entry.sourceRelativePath
      || ['.', '..'].includes(entry.sourceRelativePath)
      || entry.sourceRelativePath.length < 1
      || Buffer.byteLength(entry.sourceRelativePath, 'utf8') > 255
      || /[\\/\u0000-\u001f\u007f:]/u.test(entry.sourceRelativePath)
      || !SHA256.test(entry.sha256 ?? '')
      || !Number.isSafeInteger(entry.sizeBytes)
      || entry.sizeBytes < 1 || entry.sizeBytes > MAX_ATTACHMENT_BYTES
      || entry.targetName !== targetName
      || entry.peerName !== `.${targetName}.custody`
      || !isCorrectionAttachmentTargetName(entry.targetName)
      || !isPortableLeaf(entry.peerName)
      || names.has(entry.targetName) || names.has(entry.peerName)) {
      throw new Error('Correction attachment custody entry is invalid.')
    }
    names.add(entry.targetName)
    names.add(entry.peerName)
  })
  const size = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (size < 1 || size > MAX_CUSTODY_BYTES) {
    throw new Error('Correction attachment custody record is invalid or unbounded.')
  }
  return true
}

/** Recognizes a bounded operation-owned public correction attachment name. */
function isCorrectionAttachmentTargetName(value) {
  return typeof value === 'string'
    && /^correction-[0-9a-f]{16}-[0-9a-f]{4}-[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?-[0-9a-f]{16}(?:\.[a-z0-9]{1,10})?$/u.test(value)
}

/** Returns the exact retained peer for an operation-owned target name. */
function correctionAttachmentPeerName(targetName) {
  if (!isCorrectionAttachmentTargetName(targetName)) {
    throw new Error('Correction attachment target name is invalid.')
  }
  return `.${targetName}.custody`
}

/** Extracts a matching correction operation from the deterministic unlock event. */
function readCorrectionOperationId(event, plan) {
  if (event === undefined) return null
  let details
  try {
    details = JSON.parse(event.details_json)
  } catch {
    throw new Error('Correction attachment custody has invalid durable unlock evidence.')
  }
  if (event.id !== deriveArchiveLifecycleEventId(plan.archiveId, 'mission-unlocked')
    || event.mission_id !== plan.missionId || event.event_type !== 'mission_unlocked'
    || details === null || typeof details !== 'object' || Array.isArray(details)
    || details.restored_from_archive_id !== plan.archiveId
    || details.resulting_status !== 'finished'
    || details.storage_state !== 'live'
    || !IDENTIFIER.test(details.archive_correction_operation_id ?? '')) {
    throw new Error('Correction attachment custody has invalid durable unlock evidence.')
  }
  return details.archive_correction_operation_id
}

/** Reduces a display filename to a bounded, portable extension only. */
function boundedPortableExtension(value) {
  if (typeof value !== 'string') return ''
  const dot = value.lastIndexOf('.')
  const extension = dot > 0 ? value.slice(dot).toLowerCase() : ''
  return /^\.[a-z0-9]{1,10}$/u.test(extension) ? extension : ''
}

/** Retains a recognisable, non-authoritative original stem in generated names. */
function boundedPortableDisplayStem(value) {
  if (typeof value !== 'string') return 'attachment'
  const extension = boundedPortableExtension(value)
  const stem = extension.length > 0 ? value.slice(0, -extension.length) : value
  const portable = stem.normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48)
    .replace(/-+$/gu, '')
  return portable.length > 0 ? portable : 'attachment'
}

/** Rejects separators, dot traversal, Windows streams, and reserved path syntax. */
function isPortableLeaf(value) {
  return typeof value === 'string' && value.length > 0
    && Buffer.byteLength(value, 'utf8') <= 180
    && path.basename(value) === value
    && !['.', '..'].includes(value)
    && !/[\\/:\u0000-\u001f\u007f]/u.test(value)
}

/** Validates a bigint-derived directory identity serialized without precision loss. */
function validDirectoryIdentity(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'dev,ino'
    && /^(?:0|[1-9][0-9]{0,39})$/u.test(value.dev ?? '')
    && /^[1-9][0-9]{0,39}$/u.test(value.ino ?? '')
}

/** Requires the minimal synchronous SQLite interface used by custody. */
function validateDatabase(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('Correction attachment custody requires a pinned database.')
  }
}

/** Freezes a parsed record before it crosses a recovery boundary. */
function deepFreezePlan(value) {
  return Object.freeze({
    ...value,
    targetIdentity: Object.freeze({ ...value.targetIdentity }),
    entries: Object.freeze(value.entries.map((entry) => Object.freeze({ ...entry }))),
  })
}

module.exports = {
  CORRECTION_ATTACHMENT_CUSTODY_KEY,
  clearCorrectionAttachmentCustody,
  correctionAttachmentPeerName,
  createCorrectionAttachmentCustodyPlan,
  hasCorrectionAttachmentCustody,
  isCorrectionAttachmentTargetName,
  prepareCorrectionAttachmentCustodyReconciliation,
  readCorrectionAttachmentCustody,
  reconcileCorrectionAttachmentCustody,
  validateCorrectionAttachmentCustodyPlan,
  writeCorrectionAttachmentCustody,
}
