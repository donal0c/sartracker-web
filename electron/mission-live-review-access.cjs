'use strict'

const {
  readArchiveCleanupGuard,
  readCompletedArchiveCleanupJournalProof,
  readCurrentCompletedArchiveCleanupProof,
} = require('./archive-cleanup.cjs')
const {
  deriveArchiveLifecycleEventId,
  readCurrentMissionFinalizationBoundary,
  readMissionFinalizationBoundaryByEpoch,
  readV2MissionFinalizationBoundaryByArchiveId,
} = require('./mission-finalization-boundary.cjs')

const MAX_ARCHIVE_CORRECTION_LINEAGE_DEPTH = 1_024
const SHA256 = /^[0-9a-f]{64}$/u

/** Projects one bounded, canonical mission event without reflecting corrupt content. */
function projectMissionEvent(row, missionId, expectedEventType) {
  const eventRowid = Number(row?.event_rowid)
  if (!Number.isSafeInteger(eventRowid) || eventRowid < 1
    || row?.mission_id !== missionId || row?.event_type !== expectedEventType
    || typeof row.id !== 'string' || row.id.length < 1 || row.id.length > 200
    || typeof row.timestamp !== 'string'
    || row.timestamp.length < 1 || row.timestamp.length > 100
    || Number.isNaN(Date.parse(row.timestamp))
    || new Date(row.timestamp).toISOString() !== row.timestamp) return null
  let details
  try {
    if (typeof row.details_json !== 'string'
      || Buffer.byteLength(row.details_json, 'utf8') > 64 * 1024) return null
    details = JSON.parse(row.details_json)
  } catch {
    return null
  }
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return null
  return Object.freeze({
    eventRowid,
    id: row.id,
    timestamp: row.timestamp,
    details: Object.freeze(details),
  })
}

/** Reads one exact event by rowid and immutable identity. */
function readMissionEventByRowid(database, missionId, eventRowid, eventId, eventType) {
  if (!Number.isSafeInteger(eventRowid) || eventRowid < 1
    || typeof eventId !== 'string' || eventId.length < 1 || eventId.length > 200) return null
  const row = database.prepare(`SELECT rowid AS event_rowid, id, mission_id,
      event_type, timestamp, details_json
    FROM mission_events WHERE rowid = ?`).get(eventRowid)
  if (row?.id !== eventId) return null
  return projectMissionEvent(row, missionId, eventType)
}

/** Reads one exact event by immutable identity. */
function readMissionEventById(database, missionId, eventId, eventType) {
  if (typeof eventId !== 'string' || eventId.length < 1 || eventId.length > 200) return null
  const row = database.prepare(`SELECT rowid AS event_rowid, id, mission_id,
      event_type, timestamp, details_json
    FROM mission_events WHERE id = ?`).get(eventId)
  return projectMissionEvent(row, missionId, eventType)
}

/** Reads the one deterministic unlock event owned by an archive head. */
function readArchiveUnlockById(database, missionId, archiveId) {
  let eventId
  try {
    eventId = deriveArchiveLifecycleEventId(archiveId, 'mission-unlocked')
  } catch {
    return null
  }
  return readMissionEventById(database, missionId, eventId, 'mission_unlocked')
}

/** Reads the exact rowid/id/time unlock proof carried by one supplement event. */
function readLinkedArchiveUnlock(database, missionId, archiveId, details, beforeEventRowid) {
  let expectedEventId
  try {
    expectedEventId = deriveArchiveLifecycleEventId(archiveId, 'mission-unlocked')
  } catch {
    return null
  }
  const eventRowid = details?.unlock_event_rowid
  const eventId = details?.unlock_event_id
  const unlockedAt = details?.unlocked_at
  if (!Number.isSafeInteger(eventRowid) || eventRowid < 1
    || eventId !== expectedEventId
    || typeof unlockedAt !== 'string' || unlockedAt.length < 1 || unlockedAt.length > 100
    || !Number.isSafeInteger(beforeEventRowid) || beforeEventRowid <= eventRowid) return null
  const event = readMissionEventByRowid(
    database,
    missionId,
    eventRowid,
    eventId,
    'mission_unlocked',
  )
  return event !== null && event.timestamp === unlockedAt ? event : null
}

/** Reads one valid authority and reason pair from an unlock audit event. */
function readUnlockAuthority(event) {
  if (event === null) return null
  const authority = typeof event.details.admin_name === 'string'
    ? event.details.admin_name.trim()
    : ''
  const reason = typeof event.details.reason === 'string' ? event.details.reason.trim() : ''
  if (authority.length < 1 || Buffer.byteLength(authority, 'utf8') > 200
    || reason.length < 1 || Buffer.byteLength(reason, 'utf8') > 4_000) return null
  return Object.freeze({ authority, reason })
}

/** Reads an exact post-cleanup archive correction restore inside an optional epoch bound. */
function readCompletedArchiveCorrectionRestore(
  database,
  missionId,
  terminal,
  beforeEventRowid = null,
) {
  const completion = database.prepare(`SELECT rowid AS event_rowid
    FROM mission_events
    WHERE id = ? AND mission_id = ? AND event_type = 'mission_cleanup_completed'`)
    .get(terminal.completionEventId, missionId)
  const completionEventRowid = Number(completion?.event_rowid)
  if (!Number.isSafeInteger(completionEventRowid)
    || completionEventRowid <= terminal.finalizationEpoch
    || (beforeEventRowid !== null && (
      !Number.isSafeInteger(beforeEventRowid) || beforeEventRowid <= completionEventRowid
    ))) return null
  const event = readArchiveUnlockById(database, missionId, terminal.archiveId)
  if (event === null || event.eventRowid <= completionEventRowid
    || (beforeEventRowid !== null && event.eventRowid >= beforeEventRowid)) return null
  const { details } = event
  const authorization = readUnlockAuthority(event)
  const operationId = details.archive_correction_operation_id
  if (details.restored_from_archive_id !== terminal.archiveId
    || details.resulting_status !== 'finished'
    || details.storage_state !== 'live'
    || authorization === null
    || typeof operationId !== 'string'
    || !/^[A-Za-z0-9_-]{1,200}$/u.test(operationId)) return null
  return Object.freeze({
    ...authorization,
    eventId: event.id,
    eventRowid: event.eventRowid,
    timestamp: event.timestamp,
    operationId,
  })
}

/** Validates one ordinary post-finalization unlock within an exact epoch interval. */
function projectOrdinaryMissionUnlock(event, afterEventRowid, beforeEventRowid = null) {
  const authorization = readUnlockAuthority(event)
  if (event === null || authorization === null
    || !Number.isSafeInteger(afterEventRowid) || event.eventRowid <= afterEventRowid
    || (beforeEventRowid !== null && (
      !Number.isSafeInteger(beforeEventRowid) || event.eventRowid >= beforeEventRowid
    ))
    || event.details.resulting_status !== 'finished'
    || event.details.storage_state !== undefined
    || event.details.restored_from_archive_id !== undefined
    || event.details.archive_correction_operation_id !== undefined) return null
  return Object.freeze({
    ...authorization,
    eventId: event.id,
    eventRowid: event.eventRowid,
    timestamp: event.timestamp,
  })
}

/** Reads one deterministic ordinary unlock owned by the supplied archive head. */
function readOrdinaryMissionUnlock(
  database,
  missionId,
  archiveId,
  afterEventRowid,
  beforeEventRowid = null,
) {
  return projectOrdinaryMissionUnlock(
    readArchiveUnlockById(database, missionId, archiveId),
    afterEventRowid,
    beforeEventRowid,
  )
}

/** Reads one exact supplement registry row and its matching immutable audit event. */
function readArchiveSupplementProof(
  database,
  missionId,
  archiveId,
  previousArchiveId,
  createdAt,
  requestEventRowid,
  finalizationEventRowid,
) {
  const supplement = database.prepare(`SELECT mission_id, archive_id,
      previous_archive_id, supplement_sequence, authority, reason, created_at,
      audit_event_id
    FROM mission_archive_supplements WHERE archive_id = ?`).get(archiveId)
  const sequence = Number(supplement?.supplement_sequence)
  const authority = typeof supplement?.authority === 'string' ? supplement.authority.trim() : ''
  const reason = typeof supplement?.reason === 'string' ? supplement.reason.trim() : ''
  if (supplement?.mission_id !== missionId || supplement.archive_id !== archiveId
    || supplement.previous_archive_id !== previousArchiveId
    || !Number.isSafeInteger(sequence) || sequence < 1
    || authority.length < 1 || Buffer.byteLength(authority, 'utf8') > 200
    || reason.length < 1 || Buffer.byteLength(reason, 'utf8') > 4_000
    || !Number.isSafeInteger(requestEventRowid) || requestEventRowid < 1
    || !Number.isSafeInteger(finalizationEventRowid)
    || finalizationEventRowid <= requestEventRowid
    || supplement.authority !== authority || supplement.reason !== reason
    || supplement.created_at !== createdAt) return null
  const event = readMissionEventById(
    database,
    missionId,
    supplement.audit_event_id,
    'mission_archive_supplement_recorded',
  )
  const details = event?.details
  const unlockEvent = readLinkedArchiveUnlock(
    database,
    missionId,
    previousArchiveId,
    details,
    requestEventRowid,
  )
  const unlockAuthorization = readUnlockAuthority(unlockEvent)
  if (event === null || event.eventRowid <= requestEventRowid
    || event.eventRowid >= finalizationEventRowid
    || event.timestamp !== supplement.created_at
    || details?.archive_id !== archiveId || details.previous_archive_id !== previousArchiveId
    || details.supplement_sequence !== sequence || details.authority !== authority
    || details.reason !== reason || details.resulting_status !== 'finalized'
    || unlockEvent === null || unlockAuthorization === null
    || unlockEvent.details.resulting_status !== 'finished'
    || unlockAuthorization.authority !== authority
    || unlockAuthorization.reason !== reason) return null
  return Object.freeze({
    authority,
    reason,
    sequence,
    unlockEvent,
  })
}

/** Reads and verifies one correction supplement archive edge. */
function readArchiveCorrectionLineageLink(database, missionId, boundary, requiresActiveStatus) {
  const archiveId = boundary.finalizationArchiveId ?? boundary.archiveId
  const archive = database.prepare(`SELECT id, mission_id, request_event_rowid,
      request_event_id, creation_operation_id, archive_kind, container_version,
      created_at, previous_archive_id, status
    FROM mission_archives WHERE id = ? AND mission_id = ?`).get(archiveId, missionId)
  const requestEventRowid = Number(archive?.request_event_rowid)
  const validHeadStatus = archive?.status === 'sealed' || archive?.status === 'verified'
  if (archive?.id !== archiveId || archive.mission_id !== missionId
    || archive.archive_kind !== 'finalized' || Number(archive.container_version) !== 2
    || (requiresActiveStatus ? !validHeadStatus : archive.status !== 'superseded')
    || typeof archive.previous_archive_id !== 'string'
    || archive.previous_archive_id.length < 1 || archive.previous_archive_id.length > 200
    || archive.previous_archive_id === archiveId
    || !Number.isSafeInteger(requestEventRowid) || requestEventRowid < 1
    || requestEventRowid >= boundary.eventRowid) return null

  const predecessor = database.prepare(`SELECT id, mission_id, archive_kind,
      container_version, ciphertext_sha256, protected_finalization_epoch, status,
      request_event_rowid, request_event_id, creation_operation_id, created_at,
      previous_archive_id
    FROM mission_archives WHERE id = ?`).get(archive.previous_archive_id)
  if (predecessor?.id !== archive.previous_archive_id
    || predecessor.mission_id !== missionId || predecessor.status !== 'superseded'
    || !['finalized', 'finalized_recovery'].includes(predecessor.archive_kind)
    || ![1, 2].includes(Number(predecessor.container_version))) return null

  const requestEvent = readMissionEventByRowid(
    database,
    missionId,
    requestEventRowid,
    archive.request_event_id,
    'mission_finalize_requested',
  )
  const request = requestEvent?.details
  const previousShaMatches = Number(predecessor.container_version) === 2
    ? typeof predecessor.ciphertext_sha256 === 'string'
      && SHA256.test(predecessor.ciphertext_sha256)
      && request?.previous_archive_sha256 === predecessor.ciphertext_sha256
    : typeof request?.previous_archive_sha256 === 'string'
      && SHA256.test(request.previous_archive_sha256)
  if (requestEvent === null || requestEvent.timestamp !== archive.created_at
    || request?.resulting_status !== 'finished' || request.archive_id !== archiveId
    || request.operation_id !== archive.creation_operation_id
    || request.archive_kind !== 'finalized'
    || request.archive_relative_path !== `${archiveId}.sararch`
    || request.protected_finalization_epoch !== null
    || request.previous_archive_id !== predecessor.id
    || !previousShaMatches
    || !Number.isSafeInteger(request.cleanup_membership_generation)
    || request.cleanup_membership_generation < 0
    || request.cleanup_membership_generation !== boundary.cleanupMembershipGeneration) return null

  const supplement = readArchiveSupplementProof(
    database,
    missionId,
    archiveId,
    predecessor.id,
    requestEvent.timestamp,
    requestEventRowid,
    boundary.eventRowid,
  )
  if (supplement === null) return null
  return Object.freeze({
    authority: supplement.authority,
    boundary,
    predecessor: Object.freeze(predecessor),
    reason: supplement.reason,
    requestEventRowid,
    sequence: supplement.sequence,
    unlockEvent: supplement.unlockEvent,
  })
}

/** Resolves a v2 finalized or recovery predecessor to its protected finalization boundary. */
function readArchivePredecessorBoundary(database, missionId, predecessor) {
  try {
    if (predecessor.archive_kind === 'finalized'
      && Number(predecessor.container_version) === 2) {
      return readV2MissionFinalizationBoundaryByArchiveId(database, {
        missionId,
        archiveId: predecessor.id,
      })
    }
    if (predecessor.archive_kind !== 'finalized_recovery'
      || Number(predecessor.container_version) !== 2) return null
    const protectedEpoch = Number(predecessor.protected_finalization_epoch)
    if (!Number.isSafeInteger(protectedEpoch) || protectedEpoch < 1) return null
    const request = readMissionEventByRowid(
      database,
      missionId,
      Number(predecessor.request_event_rowid),
      predecessor.request_event_id,
      'mission_archive_requested',
    )
    if (request === null || request.timestamp !== predecessor.created_at
      || request.details.archive_id !== predecessor.id
      || request.details.operation_id !== predecessor.creation_operation_id
      || request.details.archive_kind !== 'finalized_recovery'
      || request.details.archive_relative_path !== `${predecessor.id}.sararch`
      || request.details.protected_finalization_epoch !== protectedEpoch
      || request.details.resulting_status !== 'finalized') return null
    return readMissionFinalizationBoundaryByEpoch(database, {
      missionId,
      eventRowid: protectedEpoch,
    })
  } catch {
    return null
  }
}

/** Resolves a recovery head to the v2 finalization archive whose event it protects. */
function readCorrectionLineageHeadBoundary(database, missionId, currentBoundary) {
  if (currentBoundary.archiveKind !== 'finalized_recovery') return currentBoundary
  const archive = database.prepare(`SELECT id, mission_id, archive_kind,
      container_version, protected_finalization_epoch, status, request_event_rowid,
      request_event_id, creation_operation_id, created_at
    FROM mission_archives WHERE id = ? AND mission_id = ?`).get(
    currentBoundary.archiveId,
    missionId,
  )
  if (archive?.id !== currentBoundary.archiveId || archive.mission_id !== missionId
    || archive.archive_kind !== 'finalized_recovery'
    || Number(archive.container_version) !== 2
    || !['sealed', 'verified'].includes(archive.status)
    || Number(archive.protected_finalization_epoch) !== currentBoundary.eventRowid) return null
  return readArchivePredecessorBoundary(database, missionId, archive)
}

/** Reads the validated supplement sequence already owned by the cleanup terminal archive. */
function readTerminalArchiveSupplementSequence(database, missionId, terminal, terminalArchive) {
  let boundary
  if (Number(terminalArchive.container_version) === 2) {
    boundary = terminalArchive.archive_kind === 'finalized_recovery'
      ? readArchivePredecessorBoundary(database, missionId, terminalArchive)
      : readV2MissionFinalizationBoundaryByArchiveId(database, {
          missionId,
          archiveId: terminalArchive.id,
        })
  } else if (Number(terminalArchive.container_version) === 1) {
    boundary = readMissionFinalizationBoundaryByEpoch(database, {
      missionId,
      eventRowid: terminal.finalizationEpoch,
    })
  } else {
    return null
  }
  if (boundary === null || boundary.eventRowid !== terminal.finalizationEpoch) return null
  if (boundary.containerVersion === 1) {
    return terminalArchive.previous_archive_id === null
      && database.prepare(`SELECT 1 FROM mission_archive_supplements
        WHERE archive_id = ?`).get(terminalArchive.id) === undefined
      ? 0
      : null
  }

  const revisionArchiveId = boundary.finalizationArchiveId ?? boundary.archiveId
  const revisionArchive = database.prepare(`SELECT id, mission_id, archive_kind,
      container_version, created_at, previous_archive_id, request_event_rowid
    FROM mission_archives WHERE id = ?`).get(revisionArchiveId)
  if (revisionArchive?.id !== revisionArchiveId || revisionArchive.mission_id !== missionId
    || revisionArchive.archive_kind !== 'finalized'
    || Number(revisionArchive.container_version) !== 2) return null
  if (revisionArchive.previous_archive_id === null) {
    return database.prepare(`SELECT 1 FROM mission_archive_supplements
      WHERE archive_id = ?`).get(revisionArchiveId) === undefined ? 0 : null
  }
  if (typeof revisionArchive.previous_archive_id !== 'string'
    || revisionArchive.previous_archive_id.length < 1
    || revisionArchive.previous_archive_id.length > 200) return null
  return readArchiveSupplementProof(
    database,
    missionId,
    revisionArchiveId,
    revisionArchive.previous_archive_id,
    revisionArchive.created_at,
    Number(revisionArchive.request_event_rowid),
    boundary.eventRowid,
  )?.sequence ?? null
}

/** Validates the complete correction archive chain and its per-epoch unlock transitions. */
function hasRefinalizedCorrectionUnlockLineage(
  database,
  missionId,
  terminal,
  requireCurrentUnlock,
) {
  try {
    const currentBoundary = readCurrentMissionFinalizationBoundary(database, { missionId })
    if (currentBoundary === null || currentBoundary.eventRowid <= terminal.finalizationEpoch) {
      return false
    }
    const headBoundary = readCorrectionLineageHeadBoundary(database, missionId, currentBoundary)
    if (headBoundary === null || headBoundary.eventRowid !== currentBoundary.eventRowid) return false
    if (requireCurrentUnlock
      && readOrdinaryMissionUnlock(
        database,
        missionId,
        currentBoundary.archiveId,
        currentBoundary.eventRowid,
      ) === null) {
      return false
    }

    const visitedArchiveIds = new Set()
    let boundary = headBoundary
    let newerSequence = null
    let requiresActiveStatus = true
    for (let depth = 0; depth < MAX_ARCHIVE_CORRECTION_LINEAGE_DEPTH; depth += 1) {
      const archiveId = boundary.finalizationArchiveId ?? boundary.archiveId
      if (visitedArchiveIds.has(archiveId)) return false
      visitedArchiveIds.add(archiveId)
      const link = readArchiveCorrectionLineageLink(
        database,
        missionId,
        boundary,
        requiresActiveStatus,
      )
      if (link === null
        || (newerSequence !== null && link.sequence !== newerSequence - 1)) return false
      if (link.predecessor.id === terminal.archiveId) {
        const correction = readCompletedArchiveCorrectionRestore(
          database,
          missionId,
          terminal,
          link.requestEventRowid,
        )
        const terminalSequence = readTerminalArchiveSupplementSequence(
          database,
          missionId,
          terminal,
          link.predecessor,
        )
        return terminalSequence !== null && link.sequence === terminalSequence + 1
          && correction !== null
          && link.unlockEvent.id === correction.eventId
          && link.unlockEvent.eventRowid === correction.eventRowid
          && link.unlockEvent.timestamp === correction.timestamp
          && link.authority === correction.authority
          && link.reason === correction.reason
      }
      if (visitedArchiveIds.has(link.predecessor.id)) return false
      const predecessorBoundary = readArchivePredecessorBoundary(
        database,
        missionId,
        link.predecessor,
      )
      if (predecessorBoundary === null
        || predecessorBoundary.eventRowid <= terminal.finalizationEpoch
        || predecessorBoundary.eventRowid >= boundary.eventRowid) return false
      const ordinaryUnlock = projectOrdinaryMissionUnlock(
        link.unlockEvent,
        predecessorBoundary.eventRowid,
        link.requestEventRowid,
      )
      if (ordinaryUnlock === null || ordinaryUnlock.authority !== link.authority
        || ordinaryUnlock.reason !== link.reason) return false
      newerSequence = link.sequence
      boundary = predecessorBoundary
      // A recovery registry row is superseded by the next supplement, while the
      // finalized archive whose epoch it protects remains sealed or verified.
      requiresActiveStatus = link.predecessor.archive_kind === 'finalized_recovery'
    }
    return false
  } catch {
    return false
  }
}

/** Reads the conservative live/archive source state from one SQLite snapshot. */
function readMissionLiveReviewStorageState(database, missionId) {
  if (typeof missionId !== 'string' || missionId.trim() === '' || missionId.length > 200) {
    throw createAccessError(
      'MISSION_REVIEW_ID_INVALID',
      'Mission live-store Review identity is invalid.',
    )
  }
  if (database.prepare('SELECT 1 FROM missions WHERE id = ?').get(missionId) === undefined) {
    throw createAccessError(
      'MISSION_REVIEW_MISSION_NOT_FOUND',
      `Mission not found: ${missionId}`,
    )
  }
  const journal = database.prepare(`SELECT * FROM mission_cleanup_journal
    WHERE mission_id = ?`).get(missionId)
  // Older or corrupt snapshots without the complete v2 custody boundary fail
  // closed as cleanup-in-progress; only a known correction restore is live.
  const hasMissionStatus = database.prepare('PRAGMA table_info(missions)').all()
    .some((column) => column?.name === 'status')
  const mission = hasMissionStatus
    ? database.prepare('SELECT status FROM missions WHERE id = ?').get(missionId)
    : null
  let correctionRecovery
  try {
    correctionRecovery = database.prepare(`SELECT value FROM metadata
      WHERE key = 'archive_correction_attachment_recovery_failure'`).get()
  } catch {
    correctionRecovery = undefined
  }
  if (correctionRecovery !== undefined
    && (mission?.status === 'finished' || mission?.status === 'finalized')) {
    return 'recovery_required'
  }
  let cleanupGuard
  try {
    cleanupGuard = readArchiveCleanupGuard(database, missionId)
  } catch {
    return 'cleanup_in_progress'
  }
  if (journal === undefined || journal.state === 'eligible') {
    return cleanupGuard === null ? 'live' : 'cleanup_in_progress'
  }
  if (journal.state === 'in_progress') return 'cleanup_in_progress'
  // A completed cleanup journal remains as durable history after an explicit
  // archive-backed correction restore. The mission is live again while the
  // retained journal still records the prior cleanup epoch.
  if (journal.state === 'completed') {
    let terminal
    try {
      terminal = readCompletedArchiveCleanupJournalProof(database, {
        missionId,
        archiveId: journal.archive_id,
      })
    } catch {
      return 'cleanup_in_progress'
    }
    if (mission?.status === 'finished') {
      let currentBoundary
      try {
        currentBoundary = readCurrentMissionFinalizationBoundary(database, { missionId })
      } catch {
        return 'cleanup_in_progress'
      }
      const directRestore = currentBoundary?.archiveId === terminal.archiveId
        && currentBoundary.eventRowid === terminal.finalizationEpoch
        && readCompletedArchiveCorrectionRestore(database, missionId, terminal) !== null
      return (directRestore
        || hasRefinalizedCorrectionUnlockLineage(database, missionId, terminal, true))
        ? 'live'
        : 'cleanup_in_progress'
    }
    try {
      const schemaVersion = Number(database.prepare(`SELECT value FROM metadata
        WHERE key = 'schema_version'`).get()?.value)
      readCurrentCompletedArchiveCleanupProof(database, {
        missionId,
        archiveId: journal.archive_id,
        schemaVersion,
      })
      return 'archived'
    } catch {
      return hasRefinalizedCorrectionUnlockLineage(
        database,
        missionId,
        terminal,
        false,
      ) ? 'live' : 'cleanup_in_progress'
    }
  }
  throw createAccessError(
    'MISSION_REVIEW_STORAGE_STATE_INVALID',
    'Mission cleanup journal state is invalid; ordinary live Review is unavailable.',
  )
}

/** Fails closed unless every row still belongs to the ordinary live-store namespace. */
function assertMissionLiveReviewAvailable(database, missionId) {
  const storageState = readMissionLiveReviewStorageState(database, missionId)
  if (storageState === 'live') return
  if (storageState === 'archived') {
    throw createAccessError(
      'MISSION_REVIEW_ARCHIVE_REQUIRED',
      'Mission live-store Review is unavailable; open its verified archive from Saved Mission Archives.',
    )
  }
  if (storageState === 'recovery_required') {
    throw createAccessError(
      'MISSION_REVIEW_CORRECTION_RECOVERY_REQUIRED',
      'Archive correction attachment custody recovery requires operator review before opening Review.',
    )
  }
  throw createAccessError(
    'MISSION_REVIEW_CLEANUP_IN_PROGRESS',
    'Mission live-store cleanup state blocks ordinary Review. Open Review Archive Cleanup and resolve its checked state before opening ordinary Review.',
  )
}

/** Creates one stable access error shared by main and read-only workers. */
function createAccessError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

module.exports = {
  assertMissionLiveReviewAvailable,
  readMissionLiveReviewStorageState,
}
