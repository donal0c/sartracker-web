'use strict'

/**
 * Completes the legacy backfill's WAL checkpoint before the worker releases its
 * SQLite handle, retaining FULL durability for the checkpoint itself.
 */
function checkpointLegacyEvidenceWal(database) {
  if (database === null || typeof database !== 'object' || typeof database.pragma !== 'function') {
    throw new TypeError('Legacy evidence WAL checkpoint requires a SQLite database.')
  }

  database.pragma('synchronous = FULL')
  const result = database.pragma('wal_checkpoint(TRUNCATE)')
  const row = Array.isArray(result) ? result[0] : result
  const busy = Number(row?.busy)
  const log = Number(row?.log)
  const checkpointed = Number(row?.checkpointed)
  if (![busy, log, checkpointed].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error('Legacy evidence WAL checkpoint returned an invalid SQLite status.')
  }
  if (busy !== 0 || checkpointed < log) {
    throw new Error(
      `Legacy evidence WAL checkpoint was busy or incomplete (busy=${busy}, log=${log}, checkpointed=${checkpointed}).`,
    )
  }
  return Object.freeze({ busy, log, checkpointed })
}

module.exports = { checkpointLegacyEvidenceWal }
