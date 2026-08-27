const { parentPort, threadId, workerData } = require('node:worker_threads')

const Database = require('better-sqlite3')
const { assertReplayResultBounded } = require('./mission-replay-message-policy.cjs')
const {
  readMissionReplayObjectChunk,
  readMissionReplayState,
  readMissionReplayTrackChunk,
} = require('./mission-replay-query.cjs')

if (parentPort === null) throw new Error('Mission replay worker requires a parent message port.')

/** Runs one read-only replay snapshot outside the Electron main isolate. */
function run() {
  let database
  try {
    database = new Database(workerData.databasePath, { readonly: true, fileMustExist: true })
    database.pragma('query_only = ON')
    const result = workerData.kind === 'chunk'
      ? readMissionReplayTrackChunk(database, workerData.query)
      : workerData.kind === 'objects'
        ? readMissionReplayObjectChunk(database, workerData.query)
        : readMissionReplayState(database, workerData.query)
    assertReplayResultBounded(result, workerData.query.trackLimit)
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
