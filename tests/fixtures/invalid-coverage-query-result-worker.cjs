const { parentPort, workerData } = require('node:worker_threads')

const key = { device_id: 'device-other', period_kind: 'unassigned', period_id: '' }
const results = {
  enumerate: { changeSeq: 1, chunks: 'omitted' },
  manifest: { changeSeq: 1, chunks: [] },
  claim: { changeSeq: 1, databaseReady: true, blockers: [], chunkRevisions: [] },
  'chunk-page': { key, contentRev: 6, positions: [], nextCursor: null },
  'chunk-summary': {
    contentRev: 6,
    fix_count: 0,
    fix_digest: '0'.repeat(64),
    min_ts: null,
    max_ts: null,
  },
}

parentPort.postMessage({
  type: 'complete',
  result: results[workerData.query.kind],
})
parentPort.close()
