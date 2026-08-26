const { parentPort, workerData } = require('node:worker_threads')

const invalidationId = workerData.query.invalidationId
const result = invalidationId === 'missing-keys'
  ? { invalidationId }
  : { invalidationId: 'different-invalidation', affectedKeys: [] }

parentPort.postMessage({
  type: 'complete',
  result,
})
