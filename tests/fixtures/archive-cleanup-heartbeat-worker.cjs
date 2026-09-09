'use strict'

const { parentPort, workerData } = require('node:worker_threads')

setTimeout(() => {
  parentPort.postMessage({
    type: 'complete',
    operationId: workerData?.request?.operationId,
    result: {
      state: 'completed',
      storageState: 'archived',
    },
  })
  parentPort.close()
}, 260)
