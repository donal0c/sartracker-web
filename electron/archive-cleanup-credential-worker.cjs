'use strict'

const { isMainThread, parentPort, workerData } = require('node:worker_threads')

const { zeroBuffer } = require('./archive-crypto.cjs')
const {
  authenticateArchiveCleanupCredential,
  normalizeArchiveCleanupCredentialRequest,
} = require('./archive-cleanup-credential.cjs')

const DIRECT_FAILURE_CODES = new Set([
  'ARCHIVE_CLEANUP_CANCELLED',
  'ARCHIVE_CLEANUP_CREDENTIAL_FAILED',
  'ARCHIVE_CLEANUP_CREDENTIAL_INVALID',
  'ARCHIVE_CLEANUP_CUSTODY_MISMATCH',
  'ARCHIVE_CLEANUP_WRONG_KEY',
])

/** Receives exactly one transferred credential while retaining shared cancellation. */
function waitForCredential(port, request, cancellationFlag) {
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
        reject(new Error('Archive cleanup worker received an invalid credential.'))
        return
      }
      port.off('message', onMessage)
      resolve(Buffer.from(message.secretBytes))
    }
    port.on('message', onMessage)
  })
}

/** Runs one secret-transfer-only credential and whole-ciphertext proof. */
async function runWorker() {
  const cancellationFlag = new Int32Array(workerData.cancellationBuffer)
  let secretBytes
  try {
    const request = normalizeArchiveCleanupCredentialRequest(workerData.request)
    secretBytes = await waitForCredential(parentPort, request, cancellationFlag)
    const result = await authenticateArchiveCleanupCredential({
      request,
      secretBytes,
      cancellationFlag,
      onProgress: (progress) => parentPort.postMessage({
        type: 'progress',
        operationId: request.operationId,
        ...progress,
      }),
    })
    parentPort.postMessage({ type: 'complete', ...result })
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      operationId: workerData.request?.operationId,
      code: DIRECT_FAILURE_CODES.has(error?.code)
        ? error.code
        : 'ARCHIVE_CLEANUP_CREDENTIAL_FAILED',
    })
  } finally {
    if (secretBytes !== undefined) zeroBuffer(secretBytes)
    parentPort.close()
  }
}

if (!isMainThread) void runWorker()

module.exports = { runWorker }
