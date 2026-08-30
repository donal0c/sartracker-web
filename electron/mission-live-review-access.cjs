'use strict'

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
  const journal = database.prepare(`SELECT state FROM mission_cleanup_journal
    WHERE mission_id = ?`).get(missionId)
  if (journal === undefined || journal.state === 'eligible') return 'live'
  if (journal.state === 'in_progress') return 'cleanup_in_progress'
  if (journal.state === 'completed') return 'archived'
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
  throw createAccessError(
    'MISSION_REVIEW_CLEANUP_IN_PROGRESS',
    'Mission live-store cleanup is in progress; resume cleanup before opening ordinary Review.',
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
