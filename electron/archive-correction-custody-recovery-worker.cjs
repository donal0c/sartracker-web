'use strict'

const { isMainThread, parentPort, workerData } = require('node:worker_threads')
const Database = require('better-sqlite3')
const { recoverCorrectionAttachmentJournals } = require('./archive-correction-custody.cjs')

if (isMainThread || parentPort === null) {
  throw new Error('Archive correction custody recovery must run outside the Electron main isolate.')
}

const cancellationFlag = new Int32Array(workerData.cancellationBuffer)
parentPort.on('message', (message) => {
  if (message?.type === 'cancel') Atomics.store(cancellationFlag, 0, 1)
})

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
      isCancelled: () => Atomics.load(cancellationFlag, 0) !== 0,
      beforeDirectoryRemoval: () => {
        database.prepare(`INSERT INTO metadata (key, value) VALUES (
          'archive_correction_attachment_recovery_failure', 'completed'
        ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run()
      },
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
