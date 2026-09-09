const { parentPort, workerData } = require('node:worker_threads')
const { waitForForegroundWrites } = require('../../electron/foreground-write-priority.cjs')

/** Exercises the real shared admission boundary without opening a mission database. */
async function run() {
  const operationId = workerData.request.operationId
  parentPort.postMessage({ type: 'progress', operationId, progress: { waiting: true } })
  await waitForForegroundWrites(workerData.foregroundWriterBuffer)
  parentPort.postMessage({ type: 'complete', operationId, result: { state: 'completed' } })
  parentPort.close()
}
void run()
