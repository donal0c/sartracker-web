'use strict'

const fs = require('node:fs')
const { parentPort, workerData } = require('node:worker_threads')

if (parentPort === null) {
  throw new Error('Mission Review post-message probe requires a parent message port.')
}

const MAX_RESULT_BYTES = 8 * 1024 * 1024
const sentinelPath = `${workerData.databasePath}.oversized-post-message`
const postMessage = parentPort.postMessage.bind(parentPort)

/** Records any oversized successful payload that reaches structured-clone dispatch. */
parentPort.postMessage = (message, transferList) => {
  if (message?.type === 'complete') {
    const resultBytes = Buffer.byteLength(JSON.stringify(message), 'utf8')
    if (resultBytes > MAX_RESULT_BYTES) {
      fs.writeFileSync(sentinelPath, String(resultBytes), { flag: 'wx', mode: 0o600 })
    }
  }
  return postMessage(message, transferList)
}

require('../../electron/mission-review-read-query-worker.cjs')
