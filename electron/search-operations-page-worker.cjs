const { parentPort, threadId, workerData } = require('node:worker_threads')

const Database = require('better-sqlite3')
const {
  assertSearchOperationPageResult,
  readSearchOperationPage,
} = require('./search-operations-page-query.cjs')

if (parentPort === null) {
  throw new Error('Search Operations page worker requires a parent message port.')
}

/** Opens a read-only snapshot and returns one bounded Search Operations page. */
function run() {
  let database
  try {
    database = new Database(workerData.databasePath, { readonly: true, fileMustExist: true })
    database.pragma('query_only = ON')
    const result = readSearchOperationPage(database, workerData.query)
    assertSearchOperationPageResult(result, workerData.query.limit)
    parentPort.postMessage({ type: 'complete', workerThreadId: threadId, result })
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
