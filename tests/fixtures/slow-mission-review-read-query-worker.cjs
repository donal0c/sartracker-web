const { parentPort, threadId } = require('node:worker_threads')

setTimeout(() => {
  parentPort?.postMessage({
    type: 'complete',
    workerThreadId: threadId,
    auditEvents: [],
    breadcrumbCount: 0,
    correctionAuthorized: false,
  })
  parentPort?.close()
}, 300)
