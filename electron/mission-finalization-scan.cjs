'use strict'

const { setImmediate: yieldToEventLoop } = require('node:timers/promises')

const PAGE_ROWS = 1_024
const preparedReads = new WeakMap()
const LEGACY_COLUMNS = 'rowid AS event_rowid, id, mission_id, event_type, details_json'

/** Creates a retryable admission failure instead of silently using stale history. */
function changedError() {
  const error = new Error('Mission history changed while finalization was prepared; retry finalization.')
  error.code = 'MISSION_FINALIZATION_READ_CHANGED'
  return error
}

/** Captures both other-connection commits and all writes through this connection. */
function readRevision(database) {
  return {
    dataVersion: Number(database.pragma('data_version', { simple: true })),
    changes: Number(database.prepare('SELECT total_changes() AS changes').get().changes),
  }
}

/** Requires preparation and admission to observe exactly the same SQLite state. */
function sameRevision(left, right) {
  return Number.isSafeInteger(left.dataVersion) && Number.isSafeInteger(left.changes)
    && left.dataVersion === right.dataVersion && left.changes === right.changes
}

/** Uses the store's durable evidence generation so another mission can keep tracking. */
function createHistoryRevisionReader(database, missionId) {
  const hasGenerations = database.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'mission_replay_generations'`).get() !== undefined
  if (!hasGenerations) return () => readRevision(database)
  const statement = database.prepare(`SELECT generation FROM mission_replay_generations
    WHERE mission_id = ?`)
  return () => {
    const generation = Number(statement.get(missionId)?.generation ?? 0)
    if (!Number.isSafeInteger(generation) || generation < 0) throw changedError()
    return { dataVersion: generation, changes: generation }
  }
}

/** Checks cancellation before another bounded page or before publishing its result. */
function assertNotCancelled(signal) {
  if (!signal?.aborted) return
  const error = new Error('Mission finalization preparation was cancelled.')
  error.name = 'AbortError'
  throw error
}

/**
 * Scans legacy rows in bounded rowid pages without holding a transaction across
 * a yield. Target-mission evidence changes invalidate the scan; only one prepared
 * mission is retained per connection, so the cache cannot grow with history.
 */
async function prepareLegacyFinalizationRead(database, missionId, options = {}) {
  if (database.inTransaction) throw new Error('Finalization must be prepared outside a transaction.')
  assertNotCancelled(options.signal)
  preparedReads.delete(database)
  const readHistoryRevision = createHistoryRevisionReader(database, missionId)
  const revision = readHistoryRevision()
  let upper = Number(database.prepare('SELECT rowid FROM mission_events ORDER BY rowid DESC LIMIT 1')
    .get()?.rowid ?? 0)
  if (!Number.isSafeInteger(upper) || upper < 0) {
    throw new Error('Mission finalization history boundary is invalid.')
  }
  let result
  const yieldToMain = options.yieldToMain ?? yieldToEventLoop
  while (upper > 0) {
    assertNotCancelled(options.signal)
    const lower = Number(database.prepare(`SELECT rowid FROM mission_events
      WHERE rowid <= ? ORDER BY rowid DESC LIMIT 1 OFFSET ?`).get(upper, PAGE_ROWS - 1)?.rowid ?? 1)
    result = database.prepare(`SELECT ${LEGACY_COLUMNS} FROM mission_events
      WHERE rowid >= ? AND rowid <= ? AND mission_id = ? AND event_type = 'mission_finalized'
      ORDER BY rowid DESC LIMIT 1`).get(lower, upper, missionId)
    if (!sameRevision(revision, readHistoryRevision())) throw changedError()
    if (result !== undefined) break
    upper = lower - 1
    if (upper > 0) await yieldToMain()
  }
  assertNotCancelled(options.signal)
  // Capture the global revision before checking the mission generation: a
  // commit between these reads must invalidate either this check or admission.
  const admissionRevision = readRevision(database)
  if (!sameRevision(revision, readHistoryRevision())) throw changedError()
  preparedReads.set(database, { missionId, revision: admissionRevision, row: result })
}

/** Reads a fresh prepared row, or retains the legacy synchronous path for other callers. */
function readLegacyFinalizationRow(database, missionId, required = false) {
  const prepared = preparedReads.get(database)
  if (prepared?.missionId === missionId && sameRevision(prepared.revision, readRevision(database))) {
    return prepared.row
  }
  if (required) throw changedError()
  return database.prepare(`SELECT ${LEGACY_COLUMNS} FROM mission_events
    WHERE mission_id = ? AND event_type = 'mission_finalized'
    ORDER BY rowid DESC LIMIT 1`).get(missionId)
}

module.exports = { prepareLegacyFinalizationRead, readLegacyFinalizationRow }
