const { parentPort, threadId, workerData } = require('node:worker_threads')

const Database = require('better-sqlite3')

if (parentPort === null) {
  throw new Error('SQLite backup worker requires a parent message port.')
}

/**
 * Pages requested for every backup step after the first: effectively "all remaining".
 *
 * SQLite restarts a stepped online backup from the first page whenever another
 * connection writes to the source between steps. Live tracking commits every poll,
 * so the default 100-page steps restarted indefinitely: a ~1 s copy of a 595 MB
 * mission ran for minutes while re-reading the whole file, starving main-thread
 * commits of disk [DON-313] [DON-240]. One step copies from a single consistent
 * read snapshot instead. It holds that WAL read transaction only for the copy and
 * blocks only this worker thread.
 */
const ALL_REMAINING_PAGES = 2_147_483_647

/** Opens an independent WAL reader and completes the online backup in this worker isolate. */
async function run() {
  let database
  try {
    database = new Database(workerData.sourcePath, {
      readonly: true,
      fileMustExist: true,
    })
    await database.backup(workerData.targetPath, { progress: () => ALL_REMAINING_PAGES })
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
