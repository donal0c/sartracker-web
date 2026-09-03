'use strict'

const { isMainThread, parentPort, workerData } = require('node:worker_threads')
const Database = require('better-sqlite3')
const { recoverCorrectionAttachmentJournals } = require('./archive-correction-custody.cjs')

if (isMainThread || parentPort === null) {
  throw new Error('Archive correction custody recovery must run outside the Electron main isolate.')
}

/** Runs synchronous custody recovery against a worker-owned SQLite connection. */
function run() {
  let database
  try {
    database = new Database(workerData.databasePath)
    database.pragma('journal_mode = WAL')
    database.pragma('synchronous = FULL')
    database.pragma('foreign_keys = ON')
    const result = recoverCorrectionAttachmentJournals({
      databasePath: workerData.databasePath,
      db: database,
    })
    parentPort.postMessage({ type: 'complete', recovered: result.recovered })
  } catch {
    parentPort.postMessage({
      type: 'error',
      code: 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED',
    })
  } finally {
    database?.close()
    parentPort.close()
  }
}

run()
