'use strict'

const CHECKPOINT_RETRY_LIMIT = 8
const CHECKPOINT_RETRY_DELAY_MS = 4

/**
 * Completes a non-blocking legacy backfill WAL checkpoint before the worker
 * releases its SQLite handle, retaining FULL durability for the checkpoint
 * itself without taking a truncation lock that can stall foreground writes.
 */
async function checkpointLegacyEvidenceWal(database) {
  if (database === null || typeof database !== 'object' || typeof database.pragma !== 'function') {
    throw new TypeError('Legacy evidence WAL checkpoint requires a SQLite database.')
  }

  const previousBusyTimeout = Number(database.pragma('busy_timeout', { simple: true }))
  if (!Number.isSafeInteger(previousBusyTimeout) || previousBusyTimeout < 0) {
    throw new Error('Legacy evidence WAL checkpoint found an invalid SQLite busy timeout.')
  }
  database.pragma('busy_timeout = 0')
  try {
    database.pragma('synchronous = FULL')
    let lastStatus
    for (let attempt = 0; attempt <= CHECKPOINT_RETRY_LIMIT; attempt += 1) {
      const result = database.pragma('wal_checkpoint(PASSIVE)')
      const row = Array.isArray(result) ? result[0] : result
      const busy = Number(row?.busy)
      const log = Number(row?.log)
      const checkpointed = Number(row?.checkpointed)
      if (![busy, log, checkpointed].every((value) => Number.isSafeInteger(value) && value >= 0)) {
        throw new Error('Legacy evidence WAL checkpoint returned an invalid SQLite status.')
      }
      lastStatus = { busy, log, checkpointed }
      if (busy === 0 && checkpointed >= log) return Object.freeze(lastStatus)
      if (attempt < CHECKPOINT_RETRY_LIMIT) {
        await new Promise((resolve) => setTimeout(resolve, CHECKPOINT_RETRY_DELAY_MS))
      }
    }
    throw new Error(
      `Legacy evidence WAL checkpoint was busy or incomplete (busy=${lastStatus.busy}, log=${lastStatus.log}, checkpointed=${lastStatus.checkpointed}).`,
    )
  } finally {
    database.pragma(`busy_timeout = ${previousBusyTimeout}`)
  }
}

module.exports = { checkpointLegacyEvidenceWal }
