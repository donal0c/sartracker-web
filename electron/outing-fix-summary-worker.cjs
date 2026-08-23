const { parentPort, threadId, workerData } = require('node:worker_threads')

const Database = require('better-sqlite3')
const { readOutingFixSummary } = require('./outing-fix-summary-query.cjs')

if (parentPort === null) throw new Error('Outing fix-summary worker requires a parent port.')

/** Opens one read-only snapshot and returns only exact scalar completeness counts. */
function run() {
  let database
  try {
    database = new Database(workerData.databasePath, { readonly: true, fileMustExist: true })
    database.pragma('query_only = ON')
    parentPort.postMessage({
      type: 'complete',
      workerThreadId: threadId,
      ...readOutingFixSummary(database, workerData.query),
    })
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    database?.close()
    parentPort.close()
  }
}

run()
