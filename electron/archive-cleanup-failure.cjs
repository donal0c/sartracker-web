'use strict'

const SAFE_TABLE = /^[A-Za-z_][A-Za-z0-9_]*$/u

const CLEANUP_SUBSTAGES = new Set([
  'input_validation',
  'inventory_reconcile',
  'journal_initialize',
  'select_page',
  'delete_page',
  'journal_update',
  'completion',
  'custody_commit',
  'record_failure',
  'worker_open',
  'worker_execute',
  'worker_close',
  'worker_protocol',
  'worker_exit',
])

const CLEANUP_CAUSE_CLASSES = new Set([
  'cancelled',
  'custody_mismatch',
  'input_invalid',
  'journal_mismatch',
  'sqlite_busy',
  'simulated_kill',
  'worker_error',
  'worker_exit',
  'protocol_invalid',
  'internal_failure',
])

const CLEANUP_WORKER_EVENTS = new Set([
  'none',
  'message',
  'error',
  'exit',
])

/** Returns a finite, bounded cursor suitable for diagnostics. */
function normalizeCleanupCursor(cursor) {
  if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) return null
  const fields = ['tableIndex', 'tableCount', 'tableBatch', 'deletedRows', 'totalDeletedRows']
  if (fields.some((field) => !Number.isSafeInteger(cursor[field]) || cursor[field] < 0)
    || cursor.tableIndex > cursor.tableCount
    || cursor.deletedRows > cursor.totalDeletedRows) return null
  return Object.freeze({
    tableIndex: cursor.tableIndex,
    tableCount: cursor.tableCount,
    tableBatch: cursor.tableBatch,
    deletedRows: cursor.deletedRows,
    totalDeletedRows: cursor.totalDeletedRows,
  })
}

/** Projects a worker exit observation into a fixed non-secret shape. */
function normalizeCleanupWorkerExit(workerExit) {
  if (workerExit === null || typeof workerExit !== 'object' || Array.isArray(workerExit)) {
    return Object.freeze({ observed: false, event: 'none', code: null })
  }
  const code = workerExit.code === null
    ? null
    : Number.isSafeInteger(workerExit.code) && workerExit.code >= 0
      ? workerExit.code
      : null
  const event = CLEANUP_WORKER_EVENTS.has(workerExit.event) ? workerExit.event : 'none'
  return Object.freeze({ observed: workerExit.observed === true, event, code })
}

/** Normalizes one bounded cleanup failure diagnostic across coordinator boundaries. */
function normalizeCleanupFailureDiagnostic(input = {}) {
  const substage = CLEANUP_SUBSTAGES.has(input?.substage) ? input.substage : 'worker_protocol'
  const causeClass = CLEANUP_CAUSE_CLASSES.has(input?.causeClass)
    ? input.causeClass
    : 'internal_failure'
  const tableName = typeof input?.tableName === 'string' && SAFE_TABLE.test(input.tableName)
    ? input.tableName
    : null
  return Object.freeze({
    substage,
    causeClass,
    tableName,
    cursor: normalizeCleanupCursor(input?.cursor),
    workerExit: normalizeCleanupWorkerExit(input?.workerExit),
  })
}

/** Maps an internal error code to the stable cleanup cause vocabulary. */
function cleanupCauseClassForCode(code) {
  if (code === 'ARCHIVE_CLEANUP_CANCELLED') return 'cancelled'
  if (code === 'ARCHIVE_CLEANUP_INPUT_INVALID') return 'input_invalid'
  if (code === 'ARCHIVE_CLEANUP_JOURNAL_MISMATCH') return 'journal_mismatch'
  if (code === 'ARCHIVE_CLEANUP_SIMULATED_KILL') return 'simulated_kill'
  if (code === 'ARCHIVE_CUSTODY_IDENTITY_CHANGED'
    || code === 'ARCHIVE_CLEANUP_CUSTODY_MISMATCH') return 'custody_mismatch'
  if (code === 'SQLITE_BUSY') return 'sqlite_busy'
  if (code === 'ARCHIVE_CLEANUP_FAILED') return 'internal_failure'
  return 'internal_failure'
}

module.exports = {
  cleanupCauseClassForCode,
  normalizeCleanupFailureDiagnostic,
}
