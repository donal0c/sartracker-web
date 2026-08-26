const { parentPort } = require('node:worker_threads')

parentPort.postMessage({
  type: 'complete',
  result: {
    changeSeq: 1,
    enumerated: true,
    pendingInvalidation: false,
    backfillIncomplete: false,
    diagnostics: {
      queueDepth: 0,
      oldestQueuedAt: null,
      pendingChunkCount: 0,
      staleChunkCount: 0,
      freshChunkCount: 0,
      pendingInvalidationCount: 0,
    },
    outings: [{
      id: 'outing-1',
      label: 'Outing 1',
      started_at: '2026-08-24T10:00:00.000Z',
      ended_at: '2026-08-24T11:00:00.000Z',
    }],
    chunks: [],
  },
})
parentPort.close()
