'use strict'

const CHECKPOINT_RETRY_LIMIT = 8
const CHECKPOINT_RETRY_DELAY_MS = 4

/**
 * Completes a best-effort legacy backfill WAL checkpoint before the worker
 * releases its SQLite handle. Contention is reported as telemetry because the
 * backfill transaction has already committed and the checkpoint only changes
 * when SQLite copies committed frames into the database file.
 */
async function checkpointLegacyEvidenceWal(database) {
  if (database === null || typeof database !== 'object' || typeof database.pragma !== 'function') {
    throw new TypeError('Legacy evidence WAL checkpoint requires a SQLite database.')
  }

  const previousBusyTimeout = database.pragma('busy_timeout', { simple: true })
  if (!isNonnegativeSafeInteger(previousBusyTimeout)) {
    throw new Error('Legacy evidence WAL checkpoint found an invalid SQLite busy timeout.')
  }
  const previousSynchronous = database.pragma('synchronous', { simple: true })
  if (!isNonnegativeSafeInteger(previousSynchronous)) {
    throw new Error('Legacy evidence WAL checkpoint found an invalid SQLite synchronous mode.')
  }

  database.pragma('busy_timeout = 0')
  try {
    const journalMode = String(database.pragma('journal_mode', { simple: true }) ?? '').toLowerCase()
    if (journalMode !== 'wal') {
      return Object.freeze({
        busy: 0,
        log: -1,
        checkpointed: -1,
        completed: false,
        warning: `Legacy evidence WAL checkpoint was not applicable because SQLite journal_mode is ${journalMode || 'unknown'}.`,
      })
    }

    database.pragma('synchronous = FULL')
    let lastStatus = null
    for (let attempt = 0; attempt <= CHECKPOINT_RETRY_LIMIT; attempt += 1) {
      const result = database.pragma('wal_checkpoint(PASSIVE)')
      const row = Array.isArray(result) ? result[0] : result
      const status = readCheckpointStatus(row)
      lastStatus = status

      if (status.busy === 0 && status.checkpointed >= status.log) {
        return Object.freeze({ ...status, completed: true })
      }

      // A reader mark is a durable snapshot boundary. Waiting for it to leave
      // would make a performance optimisation compete with operator activity.
      if (status.busy === 0 && status.checkpointed < status.log) {
        return Object.freeze({
          ...status,
          completed: false,
          warning: `Legacy evidence WAL checkpoint deferred because a reader snapshot retains ${status.log - status.checkpointed} frame(s).`,
        })
      }

      if (attempt < CHECKPOINT_RETRY_LIMIT) {
        await new Promise((resolve) => setTimeout(resolve, CHECKPOINT_RETRY_DELAY_MS))
      }
    }

    return Object.freeze({
      ...lastStatus,
      completed: false,
      warning: `Legacy evidence WAL checkpoint remained busy after ${CHECKPOINT_RETRY_LIMIT + 1} bounded attempts (busy=${lastStatus.busy}, log=${lastStatus.log}, checkpointed=${lastStatus.checkpointed}).`,
    })
  } finally {
    database.pragma(`synchronous = ${previousSynchronous}`)
    database.pragma(`busy_timeout = ${previousBusyTimeout}`)
  }
}

/** Reads and validates the three counters returned by SQLite. */
function readCheckpointStatus(row) {
  const busy = row?.busy
  const log = row?.log
  const checkpointed = row?.checkpointed
  const busyWithoutCounters = busy === 1 && log === -1 && checkpointed === -1
  const validCounters = [busy, log, checkpointed].every((value) => isNonnegativeSafeInteger(value))
  if (!busyWithoutCounters && !validCounters) {
    throw new Error('Legacy evidence WAL checkpoint returned an invalid SQLite status.')
  }
  return { busy, log, checkpointed }
}

/** Validates a worker checkpoint receipt and its parent-observed WAL evidence. */
function validateLegacyEvidenceBackfillCheckpoint(value, walSidecarBytes, options = {}) {
  const requireComplete = options.requireComplete === true
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'Legacy evidence recovery did not report a checkpoint receipt.'
  }
  if (!Number.isSafeInteger(walSidecarBytes) || walSidecarBytes < 0) {
    return 'Legacy evidence recovery did not include a valid parent-observed WAL sidecar size.'
  }
  if (typeof value.completed !== 'boolean') {
    return 'Legacy evidence recovery checkpoint receipt is missing its completion status.'
  }
  if (value.completed === true) {
    if (value.busy !== 0 || !isNonnegativeSafeInteger(value.log)
      || !isNonnegativeSafeInteger(value.checkpointed)
      || value.checkpointed < value.log) {
      return 'Legacy evidence recovery reported an incomplete WAL checkpoint.'
    }
    if (walSidecarBytes > 0 && value.log === 0) {
      return 'Legacy evidence recovery receipt reports zero WAL frames while the parent observed a non-empty WAL sidecar; completion is not independently corroborated.'
    }
    return null
  }
  if (requireComplete) return 'Legacy evidence recovery did not complete its WAL checkpoint.'
  if (typeof value.warning !== 'string' || value.warning.trim() === '') {
    return 'Legacy evidence recovery reported an incomplete checkpoint without telemetry.'
  }
  if (!isCheckpointCounter(value.busy)
    || !isCheckpointCounter(value.log)
    || !isCheckpointCounter(value.checkpointed)) {
    return 'Legacy evidence recovery reported malformed checkpoint telemetry.'
  }
  return null
}

/** Accepts a non-negative SQLite counter, its busy-lock sentinel, or null telemetry. */
function isCheckpointCounter(value) {
  return value === null || (Number.isSafeInteger(value) && (value >= 0 || value === -1))
}

/** Checks one non-negative SQLite counter. */
function isNonnegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

module.exports = {
  checkpointLegacyEvidenceWal,
  validateLegacyEvidenceBackfillCheckpoint,
}
