'use strict'

const { isMainThread, parentPort, workerData } = require('node:worker_threads')
const { Worker } = require('./mission-worker.cjs')
const Database = require('better-sqlite3')
const { buildArchiveCleanupPlan, createCleanupSelection, CLEANABLE_MISSION_EVENT_TYPES } = require('./archive-cleanup.cjs')
const { listArchiveInventoryForSchema } = require('./archive-inventory.cjs')

/** Creates a non-reflective preview failure; no cleanup authorization is issued here. */
function previewFailure() { return new Error('Live-row preview is unavailable. Refresh before confirming cleanup.') }

/** Closes the small preview envelope and checks its sum independently of worker output. */
function normalizeCleanupPreview(value, missionId) {
  const allowed = new Set(listArchiveInventoryForSchema(13).map((entry) => entry.tableName))
  if (value === null || typeof value !== 'object' || value.missionId !== missionId
    || !Number.isSafeInteger(value.totalRows) || value.totalRows < 0
    || !Array.isArray(value.tables) || value.tables.length > allowed.size) throw previewFailure()
  let totalRows = 0
  const seen = new Set()
  const tables = value.tables.map((entry) => {
    if (entry === null || !allowed.has(entry.tableName) || seen.has(entry.tableName)
      || !Number.isSafeInteger(entry.rowCount) || entry.rowCount < 0) throw previewFailure()
    seen.add(entry.tableName)
    totalRows += entry.rowCount
    if (!Number.isSafeInteger(totalRows)) throw previewFailure()
    return Object.freeze({ tableName: entry.tableName, rowCount: entry.rowCount })
  })
  if (totalRows !== value.totalRows) throw previewFailure()
  return Object.freeze({ missionId, totalRows, tables: Object.freeze(tables) })
}

/** Counts the exact deletion predicates in one read snapshot, away from the main event loop. */
function readCleanupPreview(db, missionId) {
  return db.transaction(() => {
    const tables = buildArchiveCleanupPlan(db, 13).map((tableName) => {
      const selection = tableName === 'mission_events'
        ? { whereSql: `archive_row.mission_id = ? AND archive_row.event_type IN (${CLEANABLE_MISSION_EVENT_TYPES.map(() => '?').join(',')})`,
            parameters: [missionId, ...CLEANABLE_MISSION_EVENT_TYPES] }
        : createCleanupSelection(db, tableName, missionId, 13)
      const rowCount = db.prepare(`SELECT COUNT(*) AS total FROM "${tableName}" AS archive_row WHERE ${selection.whereSql}`)
        .get(...selection.parameters).total
      return { tableName, rowCount }
    })
    return normalizeCleanupPreview({ missionId, tables,
      totalRows: tables.reduce((total, entry) => total + entry.rowCount, 0) }, missionId)
  })()
}

/** Joins the preview reader's physical exit so store shutdown cannot abandon its connection. */
function startCleanupPreview({ databasePath, missionId, signal }) {
  if (signal?.aborted) return Promise.reject(previewFailure())
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { kind: 'archive-cleanup-preview', databasePath, missionId } })
    let result = null
    let failed = false
    /** Requests termination while preserving ownership until the native reader exits. */
    const cancel = () => { failed = true; void worker.terminate().catch(() => undefined) }
    const timer = setTimeout(cancel, 60_000)
    signal?.addEventListener('abort', cancel, { once: true })
    worker.on('message', (value) => {
      if (result !== null) { cancel(); return }
      try { result = normalizeCleanupPreview(value, missionId) } catch { cancel() }
    })
    worker.once('error', () => { failed = true })
    worker.once('exit', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      if (failed || code !== 0 || result === null) reject(previewFailure())
      else resolve(result)
    })
    if (signal?.aborted) cancel()
  })
}

if (!isMainThread && workerData?.kind === 'archive-cleanup-preview') {
  const db = new Database(workerData.databasePath, { readonly: true, fileMustExist: true })
  try { parentPort.postMessage(readCleanupPreview(db, workerData.missionId)) }
  finally { db.close(); parentPort.close() }
}

module.exports = { normalizeCleanupPreview, readCleanupPreview, startCleanupPreview }
