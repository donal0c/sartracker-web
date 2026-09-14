'use strict'

const { parentPort, threadId, workerData } = require('node:worker_threads')

const { inspectOfficialMapPackage } = require('./official-map-package.cjs')

if (parentPort === null) {
  throw new Error('Official map package worker requires a parent message port.')
}

let nextTileRequestId = 0
let pendingTileDecode = null

/** Requests exactly one bounded tile decode from the Electron parent. */
function decodeTileInParent(bytes, format) {
  if (pendingTileDecode !== null) {
    return Promise.reject(new Error('Official map package worker decode protocol failed.'))
  }
  const requestId = ++nextTileRequestId
  return new Promise((resolve, reject) => {
    pendingTileDecode = { requestId, resolve, reject }
    try {
      parentPort.postMessage({
        type: 'tile',
        requestId,
        format,
        bytes: Buffer.from(bytes),
      })
    } catch {
      pendingTileDecode = null
      reject(new Error('Official map package worker could not deliver tile data.'))
    }
  })
}

/** Accepts only the response for the one tile currently awaiting native decode. */
parentPort.on('message', (message) => {
  if (pendingTileDecode === null || message?.type !== 'tile-decode-result') return
  if (message.requestId !== pendingTileDecode.requestId || typeof message.accepted !== 'boolean') {
    const pending = pendingTileDecode
    pendingTileDecode = null
    pending.reject(new Error('Official map package worker decode protocol failed.'))
    return
  }
  const pending = pendingTileDecode
  pendingTileDecode = null
  pending.resolve(message.accepted)
})

/** Runs one package inspection and returns only its bounded result envelope. */
async function run() {
  try {
    parentPort.postMessage({ type: 'ready', workerThreadId: threadId })
    const result = await inspectOfficialMapPackage(workerData.packagePath, {
      decodeTile: decodeTileInParent,
      now: workerData.now === undefined ? undefined : new Date(workerData.now),
    })
    parentPort.postMessage({ type: 'result', result })
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      message: sanitizeErrorMessage(error),
    })
  } finally {
    if (pendingTileDecode !== null) {
      pendingTileDecode.reject(new Error('Official map package worker closed during tile decode.'))
      pendingTileDecode = null
    }
    parentPort.close()
  }
}

/** Keeps worker failures path-free while retaining known package validation messages. */
function sanitizeErrorMessage(error) {
  const message = error instanceof Error ? error.message : ''
  if (
    error?.name === 'OfficialMapPackageError'
    && message.startsWith('Official map package ')
    && message.length <= 256
    && !/[\\/\0\r\n]/u.test(message)
  ) {
    return message
  }
  return 'Official map package verification failed.'
}

run()
