const { parentPort, threadId } = require('node:worker_threads')

setTimeout(() => {
  parentPort?.postMessage({
    type: 'complete',
    workerThreadId: threadId,
    auditEvents: [],
    breadcrumbCount: 0,
  })
  parentPort?.close()
}, 300)
