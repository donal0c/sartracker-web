'use strict'

const { parentPort, threadId, workerData } = require('node:worker_threads')
const Database = require('better-sqlite3')

if (parentPort === null) {
  throw new Error('Legacy object inspection worker requires a parent port.')
}

/** Converts an unknown worker failure into a bounded message for the test harness. */
function messageOf(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n]+/gu, ' ').trim().slice(0, 500)
}

let database
try {
  if (typeof workerData?.databasePath !== 'string' || workerData.databasePath.length === 0) {
    throw new TypeError('Legacy object inspection worker requires a database path.')
  }
  database = new Database(workerData.databasePath, { readonly: true, fileMustExist: true })
  parentPort.postMessage({ type: 'ready', threadId })
} catch (error) {
  parentPort.postMessage({ type: 'error', message: messageOf(error) })
  parentPort.close()
}

parentPort.on('message', (message) => {
  if (message?.type === 'count') {
    try {
      const started = performance.now()
      const row = database.prepare(
        'SELECT COUNT(*) AS count FROM mission_object_versions',
      ).get()
      parentPort.postMessage({
        type: 'count',
        requestId: message.requestId,
        count: Number(row?.count ?? 0),
        queryMs: performance.now() - started,
        threadId,
      })
    } catch (error) {
      parentPort.postMessage({ type: 'error', message: messageOf(error) })
    }
    return
  }

  if (message?.type === 'close') {
    try {
      database?.close()
      parentPort.close()
    } catch (error) {
      parentPort.postMessage({ type: 'error', message: messageOf(error) })
      parentPort.close()
    }
  }
})
