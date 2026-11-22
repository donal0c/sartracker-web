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

/** Most quick_check problem lines reported; the first few name the damage. */
const MAX_INTEGRITY_PROBLEMS = 5

/** Opens an independent WAL reader and completes the online backup in this worker isolate. */
async function backup() {
  let database
  try {
    database = new Database(workerData.sourcePath, {
      readonly: true,
      fileMustExist: true,
    })
    await database.backup(workerData.targetPath, { progress: () => ALL_REMAINING_PAGES })
  } finally {
    database?.close()
  }
  parentPort.postMessage({ type: 'complete', workerThreadId: threadId })
}

/**
 * Runs SQLite's b-tree structure check on a finished copy, in this worker so the
 * page scan never blocks the main process [M-44]. A copy that fails is reported,
 * never repaired.
 */
function quickCheck() {
  let database
  let problems
  try {
    // Read-write on purpose: the copy is in WAL mode, and only a writable last
    // connection removes the -wal and -shm files it creates on close, so no
    // sidecar is left behind when the copy is renamed into place.
    database = new Database(workerData.targetPath, { fileMustExist: true })
    problems = database
      .pragma(`quick_check(${MAX_INTEGRITY_PROBLEMS})`)
      .map((row) => String(row.quick_check))
  } catch (error) {
    // Damage bad enough that SQLite cannot even walk the copy is the same
    // finding as a failed check, not a worker fault.
    if (!isSqliteCorruption(error)) throw error
    problems = [error.message]
  } finally {
    database?.close()
  }
  if (problems.length === 1 && problems[0] === 'ok') {
    parentPort.postMessage({ type: 'complete', workerThreadId: threadId })
    return
  }
  parentPort.postMessage({ type: 'integrity_failed', problems })
}

/** Returns whether an error is SQLite reporting a damaged or non-database file. */
function isSqliteCorruption(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  return code.startsWith('SQLITE_CORRUPT') || code === 'SQLITE_NOTADB'
}

async function run() {
  try {
    if (workerData.mode === 'quick_check') {
      quickCheck()
    } else {
      await backup()
    }
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    parentPort.close()
  }
}

void run()
