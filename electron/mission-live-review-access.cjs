'use strict'

const {
  readArchiveCleanupGuard,
  readCompletedArchiveCleanupJournalProof,
  readCurrentCompletedArchiveCleanupProof,
} = require('./archive-cleanup.cjs')
const {
  readCurrentMissionFinalizationBoundary,
} = require('./mission-finalization-boundary.cjs')

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
  const event = beforeEventRowid === null
    ? database.prepare(`SELECT rowid AS event_rowid, id, timestamp, details_json
      FROM mission_events
      WHERE mission_id = ? AND event_type = 'mission_unlocked' AND rowid > ?
      ORDER BY rowid DESC LIMIT 1`).get(missionId, completionEventRowid)
    : database.prepare(`SELECT rowid AS event_rowid, id, timestamp, details_json
      FROM mission_events
      WHERE mission_id = ? AND event_type = 'mission_unlocked'
        AND rowid > ? AND rowid < ?
      ORDER BY rowid DESC LIMIT 1`).get(missionId, completionEventRowid, beforeEventRowid)
  const eventRowid = Number(event?.event_rowid)
  if (!Number.isSafeInteger(eventRowid) || eventRowid <= completionEventRowid
    || (beforeEventRowid !== null && eventRowid >= beforeEventRowid)
    || typeof event.id !== 'string' || event.id.length < 1 || event.id.length > 200
    || typeof event.timestamp !== 'string'
    || event.timestamp.length < 1 || event.timestamp.length > 100
    || Number.isNaN(Date.parse(event.timestamp))
    || new Date(event.timestamp).toISOString() !== event.timestamp) return null
  let details
  try {
    if (typeof event.details_json !== 'string'
      || Buffer.byteLength(event.details_json, 'utf8') > 64 * 1024) return null
    details = JSON.parse(event.details_json)
  } catch {
    return null
  }
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return null
  const authority = typeof details.admin_name === 'string' ? details.admin_name.trim() : ''
  const reason = typeof details.reason === 'string' ? details.reason.trim() : ''
  const operationId = details.archive_correction_operation_id
  if (details.restored_from_archive_id !== terminal.archiveId
    || details.resulting_status !== 'finished'
    || details.storage_state !== 'live'
    || authority.length < 1 || Buffer.byteLength(authority, 'utf8') > 200
    || reason.length < 1 || Buffer.byteLength(reason, 'utf8') > 4_000
    || typeof operationId !== 'string'
    || !/^[A-Za-z0-9_-]{1,200}$/u.test(operationId)) return null
  return Object.freeze({ eventRowid, operationId })
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
      return readCompletedArchiveCorrectionRestore(database, missionId, terminal) !== null
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
      let currentBoundary
      try {
        currentBoundary = readCurrentMissionFinalizationBoundary(database, { missionId })
      } catch {
        return 'cleanup_in_progress'
      }
      if (currentBoundary === null
        || currentBoundary.archiveId === terminal.archiveId
        || currentBoundary.eventRowid <= terminal.finalizationEpoch) {
        return 'cleanup_in_progress'
      }
      return readCompletedArchiveCorrectionRestore(
        database,
        missionId,
        terminal,
        currentBoundary.eventRowid,
      ) === null ? 'cleanup_in_progress' : 'live'
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
