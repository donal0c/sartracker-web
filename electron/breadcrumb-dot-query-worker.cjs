const { parentPort, threadId, workerData } = require('node:worker_threads')

const Database = require('better-sqlite3')
const { listExactBreadcrumbDotPage } = require('./breadcrumb-dot-query.cjs')

if (parentPort === null) {
  throw new Error('Exact breadcrumb-dot query worker requires a parent message port.')
}

function run() {
  let database
  try {
    database = new Database(workerData.databasePath, {
      readonly: true,
      fileMustExist: true,
    })
    database.pragma('query_only = ON')
    const result = listExactBreadcrumbDotPage(database, workerData.query)
    parentPort.postMessage({
      type: 'complete',
      workerThreadId: threadId,
      ...result,
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
