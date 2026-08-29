const { parentPort, threadId, workerData } = require('node:worker_threads')

const { assertReplayResultBounded } = require('./mission-replay-message-policy.cjs')
const { openMissionReplayDatabase } = require('./mission-replay-database.cjs')
const {
  readMissionReplayObjectChunk,
  readMissionReplayFilterPage,
  readMissionReplayState,
  readMissionReplayTrackChunk,
} = require('./mission-replay-query.cjs')

if (parentPort === null) throw new Error('Mission replay worker requires a parent message port.')

/** Runs one read-only replay snapshot outside the Electron main isolate. */
function run() {
  let database
  try {
    database = openMissionReplayDatabase(workerData.databasePath)
    const result = workerData.kind === 'chunk'
      ? readMissionReplayTrackChunk(database, workerData.query)
      : workerData.kind === 'objects'
        ? readMissionReplayObjectChunk(database, workerData.query)
        : workerData.kind === 'filters'
          ? readMissionReplayFilterPage(database, workerData.query)
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
