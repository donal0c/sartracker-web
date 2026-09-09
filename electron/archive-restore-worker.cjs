'use strict'

const { isMainThread, parentPort, workerData } = require('node:worker_threads')

const { zeroBuffer } = require('./archive-crypto.cjs')
const {
  normalizeRestoreRequest,
  restoreMissionArchiveForReview,
} = require('./archive-restore.cjs')

const DIRECT_FAILURE_CODES = new Set([
  'ARCHIVE_CANCELLED',
  'ARCHIVE_RESTORE_AUTHENTICATION_FAILED',
  'ARCHIVE_RESTORE_CIPHERTEXT_MISMATCH',
  'ARCHIVE_RESTORE_CLEANUP_FAILED',
  'ARCHIVE_RESTORE_DISK_FULL',
  'ARCHIVE_RESTORE_REQUEST_INVALID',
  'ARCHIVE_RESTORE_SCOPE_INVALID',
  'ARCHIVE_RESTORE_SQLITE_INVALID',
  'ARCHIVE_RESTORE_WRONG_KEY',
])

/** Waits for the one transferred credential while honoring shared cancellation. */
function waitForSecret(port, request, cancellationFlag) {
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message?.type === 'cancel' && message.operationId === request.operationId) {
        Atomics.store(cancellationFlag, 0, 1)
        return
      }
      if (message?.type !== 'credential'
        || message.operationId !== request.operationId
        || !(message.secretBytes instanceof ArrayBuffer)
        || message.secretBytes.byteLength < 1
        || message.secretBytes.byteLength > 1_024) {
        port.off('message', onMessage)
        reject(new Error('Archive restore worker received an invalid credential.'))
        return
      }
      port.off('message', onMessage)
      resolve(Buffer.from(message.secretBytes))
    }
    port.on('message', onMessage)
  })
}

/** Maps all worker failures into one bounded stable vocabulary. */
function mapFailureCode(error) {
  if (DIRECT_FAILURE_CODES.has(error?.code)) return error.code
  if (error?.code === 'ARCHIVE_AUTHENTICATION_FAILED') {
    return 'ARCHIVE_RESTORE_AUTHENTICATION_FAILED'
  }
  if (['SARARCH2_FORMAT_INVALID', 'SARARCH2_TRUNCATED'].includes(error?.code)) {
    return /unsupported/iu.test(error?.message ?? '')
      ? 'ARCHIVE_RESTORE_UNSUPPORTED_FORMAT'
      : 'ARCHIVE_RESTORE_CIPHERTEXT_MISMATCH'
  }
  return 'ARCHIVE_RESTORE_FAILED'
}

/** Runs one restore operation and keeps credential bytes outside workerData. */
async function runWorker() {
  const cancellationFlag = new Int32Array(workerData.cancellationBuffer)
  let secretBytes
  let databaseFileHandle
  try {
    const request = normalizeRestoreRequest(workerData.request)
    secretBytes = await waitForSecret(parentPort, request, cancellationFlag)
    const result = await restoreMissionArchiveForReview({
      request,
      secretBytes,
      cancellationFlag,
      onProgress: (progress) => parentPort.postMessage(progress),
    })
    databaseFileHandle = result.databaseFileHandle
    parentPort.postMessage({ type: 'complete', ...result }, [databaseFileHandle])
    databaseFileHandle = undefined
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      operationId: workerData.request?.operationId,
      code: mapFailureCode(error),
    })
  } finally {
    if (databaseFileHandle !== undefined) {
      try { await databaseFileHandle.close() } catch {}
    }
    if (secretBytes !== undefined) zeroBuffer(secretBytes)
    parentPort.close()
  }
}

if (!isMainThread) void runWorker()

module.exports = { mapFailureCode }
