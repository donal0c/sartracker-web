const { parentPort, threadId, workerData } = require('node:worker_threads')

const Database = require('better-sqlite3')

if (parentPort === null) {
  throw new Error('SQLite backup worker requires a parent message port.')
}

/** Opens an independent WAL reader and completes the online backup in this worker isolate. */
async function run() {
  let database
  try {
    database = new Database(workerData.sourcePath, {
      readonly: true,
      fileMustExist: true,
    })
    await database.backup(workerData.targetPath)
    parentPort.postMessage({ type: 'complete', workerThreadId: threadId })
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

void run()
