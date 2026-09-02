'use strict'

const { parentPort, workerData, isMainThread } = require('node:worker_threads')

const { zeroBuffer } = require('./archive-crypto.cjs')
const { verifyMissionArchiveFile } = require('./archive-verify.cjs')

const DIRECT_FAILURE_CODES = new Set([
  'ARCHIVE_CANCELLED',
  'ARCHIVE_VERIFY_ARCHIVE_CHANGED',
  'ARCHIVE_VERIFY_ARCHIVE_UNAVAILABLE',
  'ARCHIVE_VERIFY_ATTACHMENT_MISMATCH',
  'ARCHIVE_VERIFY_AUTHENTICATION_FAILED',
  'ARCHIVE_VERIFY_CIPHERTEXT_MISMATCH',
  'ARCHIVE_VERIFY_DISK_FULL',
  'ARCHIVE_VERIFY_ENTRY_MISMATCH',
  'ARCHIVE_VERIFY_FORMAT_INVALID',
  'ARCHIVE_VERIFY_GPX_MISMATCH',
  'ARCHIVE_VERIFY_IDENTITY_MISMATCH',
  'ARCHIVE_VERIFY_INVENTORY_MISMATCH',
  'ARCHIVE_VERIFY_LIVE_STORE_UNAVAILABLE',
  'ARCHIVE_VERIFY_MANIFEST_INVALID',
  'ARCHIVE_VERIFY_PLAINTEXT_CLEANUP_FAILED',
  'ARCHIVE_VERIFY_REPLAY_MISMATCH',
  'ARCHIVE_VERIFY_SCHEMA_MISMATCH',
  'ARCHIVE_VERIFY_SCOPE_MISMATCH',
  'ARCHIVE_VERIFY_SLOT_MISMATCH',
  'ARCHIVE_VERIFY_SQLITE_INVALID',
  'ARCHIVE_VERIFY_TABLE_MISMATCH',
  'ARCHIVE_VERIFY_UNSUPPORTED_FORMAT',
  'ARCHIVE_VERIFY_WRONG_KEY',
])

/** Waits for one transferred credential message and applies shared cancellation. */
function waitForCredentials(port, request, cancellationFlag) {
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message?.type === 'cancel' && message.operationId === request.operationId) {
        Atomics.store(cancellationFlag, 0, 1)
        return
      }
      if (message?.type !== 'credentials'
        || message.operationId !== request.operationId
        || !(message.passphraseBytes instanceof ArrayBuffer)
        || !(message.recoveryCodeBytes instanceof ArrayBuffer)
        || message.passphraseBytes.byteLength < 14
        || message.passphraseBytes.byteLength > 1_024
        || message.recoveryCodeBytes.byteLength < 40
        || message.recoveryCodeBytes.byteLength > 64) {
        port.off('message', onMessage)
        reject(new Error('Mission archive verify worker received invalid credentials.'))
        return
      }
      port.off('message', onMessage)
      resolve({
        passphraseBytes: Buffer.from(message.passphraseBytes),
        recoveryCodeBytes: Buffer.from(message.recoveryCodeBytes),
      })
    }
    port.on('message', onMessage)
  })
}

/** Projects the normalized request into the exact non-secret core verifier shape. */
function projectNonSecretRequest(request) {
  const { passphrase: _passphrase, recoveryCode: _recoveryCode, ...nonSecret } = request
  return Object.freeze(nonSecret)
}

/** Maps internal errors into a bounded stable worker failure vocabulary. */
function mapFailureCode(error) {
  if (DIRECT_FAILURE_CODES.has(error?.code)) return error.code
  if (error?.code === 'ARCHIVE_AUTHENTICATION_FAILED') {
    return 'ARCHIVE_VERIFY_AUTHENTICATION_FAILED'
  }
  if (error?.code === 'SARARCH2_FORMAT_INVALID' || error?.code === 'SARARCH2_TRUNCATED') {
    return /Unsupported/u.test(error?.message ?? '')
      ? 'ARCHIVE_VERIFY_UNSUPPORTED_FORMAT'
      : 'ARCHIVE_VERIFY_FORMAT_INVALID'
  }
  if (typeof error?.code === 'string' && error.code.startsWith('ARCHIVE_GPX_')) {
    return 'ARCHIVE_VERIFY_GPX_MISMATCH'
  }
  if (typeof error?.code === 'string' && error.code.startsWith('ARCHIVE_REPLAY_')) {
    return 'ARCHIVE_VERIFY_REPLAY_MISMATCH'
  }
  if (typeof error?.code === 'string' && error.code.startsWith('ARCHIVE_INVENTORY_')) {
    return 'ARCHIVE_VERIFY_INVENTORY_MISMATCH'
  }
  if (typeof error?.code === 'string' && error.code.startsWith('ARCHIVE_ATTACHMENT_')) {
    return 'ARCHIVE_VERIFY_ATTACHMENT_MISMATCH'
  }
  return 'ARCHIVE_VERIFY_FAILED'
}

/** Runs the independent verifier worker with closed messages and secret cleanup. */
async function runWorker() {
  const cancellationFlag = new Int32Array(workerData.cancellationBuffer)
  let credentials
  try {
    credentials = await waitForCredentials(parentPort, workerData.request, cancellationFlag)
    const request = workerData.request
    const proof = await verifyMissionArchiveFile({
      request: projectNonSecretRequest(request),
      ...credentials,
      cancellationFlag,
      onProgress: (message) => parentPort.postMessage(message),
    })
    parentPort.postMessage({ type: 'complete', operationId: request.operationId, proof })
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      operationId: workerData.request?.operationId,
      code: mapFailureCode(error),
      message: 'Mission archive verification failed safely.',
    })
  } finally {
    if (credentials !== undefined) {
      zeroBuffer(credentials.passphraseBytes)
      zeroBuffer(credentials.recoveryCodeBytes)
    }
    parentPort.close()
  }
}

if (!isMainThread) void runWorker()

module.exports = { mapFailureCode }
