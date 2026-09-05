'use strict'

const { ARCHIVE_TABLE_INVENTORY } = require('./archive-inventory.cjs')

const SAFE_TABLE = /^[A-Za-z_][A-Za-z0-9_]*$/u
const MAX_SAFE_TABLE_BYTES = 100
const SAFE_CLEANUP_TABLES = new Set(ARCHIVE_TABLE_INVENTORY.map((entry) => entry.tableName))
const CLEANUP_DIAGNOSTIC_TOKEN_PREFIX = 'SARCD1.'
const MAX_CLEANUP_DIAGNOSTIC_TOKEN_BYTES = 384
const CLEANUP_DIAGNOSTIC_MESSAGE = /\[(SARCD1\.[A-Za-z0-9_-]+)\]\s+\(ARCHIVE_[A-Z0-9_]{1,80}\)\.?$/u

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
  const tableName = typeof input?.tableName === 'string'
    && Buffer.byteLength(input.tableName, 'utf8') <= MAX_SAFE_TABLE_BYTES
    && SAFE_TABLE.test(input.tableName)
    && SAFE_CLEANUP_TABLES.has(input.tableName)
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
  if (typeof code === 'string' && /^SQLITE_BUSY(?:_|$)/u.test(code)) return 'sqlite_busy'
  if (code === 'ARCHIVE_CLEANUP_FAILED') return 'internal_failure'
  return 'internal_failure'
}

/** Maps a bounded synchronous cause chain without retaining error text or paths. */
function cleanupCauseClassForError(error) {
  const seen = new Set()
  let candidate = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (candidate === null || typeof candidate !== 'object' || seen.has(candidate)) break
    seen.add(candidate)
    let code
    try {
      code = Reflect.get(candidate, 'code')
    } catch {
      return 'internal_failure'
    }
    const causeClass = cleanupCauseClassForCode(code)
    if (causeClass !== 'internal_failure') return causeClass
    try {
      candidate = Reflect.get(candidate, 'cause')
    } catch {
      return 'internal_failure'
    }
  }
  return 'internal_failure'
}

/** Encodes one normalized diagnostic as a compact canonical non-secret token. */
function encodeCleanupFailureDiagnosticToken(input) {
  let diagnostic
  try {
    diagnostic = normalizeCleanupFailureDiagnostic(input)
  } catch {
    diagnostic = normalizeCleanupFailureDiagnostic()
  }
  const wire = cleanupDiagnosticWireValue(diagnostic)
  const token = `${CLEANUP_DIAGNOSTIC_TOKEN_PREFIX}${Buffer.from(
    JSON.stringify(wire),
    'utf8',
  ).toString('base64url')}`
  if (Buffer.byteLength(token, 'utf8') > MAX_CLEANUP_DIAGNOSTIC_TOKEN_BYTES) {
    return encodeCleanupFailureDiagnosticToken({
      ...diagnostic,
      tableName: null,
    })
  }
  return token
}

/** Decodes only an exact canonical v1 diagnostic token. */
function decodeCleanupFailureDiagnosticToken(token) {
  if (typeof token !== 'string'
    || Buffer.byteLength(token, 'utf8') > MAX_CLEANUP_DIAGNOSTIC_TOKEN_BYTES
    || !token.startsWith(CLEANUP_DIAGNOSTIC_TOKEN_PREFIX)) return null
  const payload = token.slice(CLEANUP_DIAGNOSTIC_TOKEN_PREFIX.length)
  if (!/^[A-Za-z0-9_-]+$/u.test(payload)) return null
  let serialized
  try {
    const bytes = Buffer.from(payload, 'base64url')
    if (bytes.toString('base64url') !== payload) return null
    serialized = bytes.toString('utf8')
  } catch {
    return null
  }
  let wire
  try {
    wire = JSON.parse(serialized)
  } catch {
    return null
  }
  if (!Array.isArray(wire) || wire.length !== 5
    || (wire[3] !== null && (!Array.isArray(wire[3]) || wire[3].length !== 5))
    || !Array.isArray(wire[4]) || wire[4].length !== 3) return null
  const candidate = {
    substage: wire[0],
    causeClass: wire[1],
    tableName: wire[2],
    cursor: wire[3] === null ? null : {
      tableIndex: wire[3][0],
      tableCount: wire[3][1],
      tableBatch: wire[3][2],
      deletedRows: wire[3][3],
      totalDeletedRows: wire[3][4],
    },
    workerExit: {
      observed: wire[4][0],
      event: wire[4][1],
      code: wire[4][2],
    },
  }
  let diagnostic
  try {
    diagnostic = normalizeCleanupFailureDiagnostic(candidate)
  } catch {
    return null
  }
  if (JSON.stringify(cleanupDiagnosticWireValue(diagnostic)) !== serialized) return null
  return diagnostic
}

/** Reads a cleanup diagnostic only when it immediately precedes the closed code suffix. */
function readCleanupFailureDiagnosticFromMessage(message) {
  if (typeof message !== 'string' || message.length > 4_096) return null
  const lineBreakIndex = message.search(/[\r\n]/u)
  const firstLine = lineBreakIndex === -1 ? message : message.slice(0, lineBreakIndex)
  const token = CLEANUP_DIAGNOSTIC_MESSAGE.exec(firstLine)?.[1]
  return token === undefined ? null : decodeCleanupFailureDiagnosticToken(token)
}

/** Projects one normalized diagnostic into the fixed compact v1 wire tuple. */
function cleanupDiagnosticWireValue(diagnostic) {
  return [
    diagnostic.substage,
    diagnostic.causeClass,
    diagnostic.tableName,
    diagnostic.cursor === null ? null : [
      diagnostic.cursor.tableIndex,
      diagnostic.cursor.tableCount,
      diagnostic.cursor.tableBatch,
      diagnostic.cursor.deletedRows,
      diagnostic.cursor.totalDeletedRows,
    ],
    [
      diagnostic.workerExit.observed,
      diagnostic.workerExit.event,
      diagnostic.workerExit.code,
    ],
  ]
}

module.exports = {
  cleanupCauseClassForCode,
  cleanupCauseClassForError,
  decodeCleanupFailureDiagnosticToken,
  encodeCleanupFailureDiagnosticToken,
  normalizeCleanupFailureDiagnostic,
  readCleanupFailureDiagnosticFromMessage,
}
