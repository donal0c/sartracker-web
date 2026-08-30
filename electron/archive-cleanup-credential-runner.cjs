'use strict'

const path = require('node:path')
const { Worker } = require('node:worker_threads')

const { normalizeCustodyFileIdentity } = require('./archive-custody-file.cjs')
const {
  normalizeArchiveCleanupCredentialRequest,
} = require('./archive-cleanup-credential.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'archive-cleanup-credential-worker.cjs')
const WATCHDOG_MS = 60_000
const CANCEL_GRACE_MS = 500
const FAILURE_CODES = new Set([
  'ARCHIVE_CLEANUP_CANCELLED',
  'ARCHIVE_CLEANUP_CREDENTIAL_FAILED',
  'ARCHIVE_CLEANUP_CREDENTIAL_INVALID',
  'ARCHIVE_CLEANUP_CUSTODY_MISMATCH',
  'ARCHIVE_CLEANUP_WRONG_KEY',
])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u
const RECOVERY_CODE = /^(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/u

/** Starts one independently owned non-machine cleanup credential proof. */
function startArchiveCleanupCredentialCheck(input) {
  const owned = takeArchiveCleanupCredentialOwnership(input)
  const { request, secret, signal, workerPath, createWorker } = owned
  const workerExited = createDeferred()
  if (signal?.aborted === true) {
    zeroIfAttached(secret)
    const rejected = Promise.reject(createFailure('ARCHIVE_CLEANUP_CANCELLED'))
    workerExited.resolve()
    return decorate(rejected, workerExited.promise, () => undefined)
  }
  const cancellationBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const cancellationFlag = new Int32Array(cancellationBuffer)
  let worker
  let cancel = () => undefined

  const completion = new Promise((resolve, reject) => {
    try {
      const workerInput = Object.freeze({
        workerPath,
        workerData: Object.freeze({ request, cancellationBuffer }),
      })
      worker = createWorker?.(workerInput)
        ?? new Worker(workerInput.workerPath, { workerData: workerInput.workerData })
    } catch {
      zeroIfAttached(secret)
      workerExited.resolve()
      reject(createFailure('ARCHIVE_CLEANUP_CREDENTIAL_FAILED'))
      return
    }
    let settled = false
    let terminal = null
    let terminalSeen = false
    let lastProgress = -1
    let watchdogTimer = null
    let terminationTimer = null

    /** Clears lifecycle resources only after physical worker exit. */
    const cleanup = () => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      if (terminationTimer !== null) clearTimeout(terminationTimer)
      signal?.removeEventListener('abort', handleAbort)
    }

    /** Rejects public completion while preserving worker-exit ownership. */
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      signal?.removeEventListener('abort', handleAbort)
      reject(error)
    }

    /** Requests cooperative cancellation and bounds forced termination. */
    const cancelAndReject = (error) => {
      if (settled) return
      if (Atomics.compareExchange(cancellationFlag, 0, 0, 1) === 0) {
        try { worker.postMessage({ type: 'cancel', operationId: request.operationId }) } catch {}
      }
      rejectOnce(error)
      if (terminationTimer === null) {
        terminationTimer = setTimeout(() => {
          try { void Promise.resolve(worker.terminate()).catch(() => undefined) } catch {}
        }, CANCEL_GRACE_MS)
      }
    }

    cancel = () => cancelAndReject(createFailure('ARCHIVE_CLEANUP_CANCELLED'))
    const handleAbort = () => cancel()
    const resetWatchdog = () => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      watchdogTimer = setTimeout(() => {
        cancelAndReject(createFailure('ARCHIVE_CLEANUP_CREDENTIAL_FAILED'))
      }, WATCHDOG_MS)
    }
    signal?.addEventListener('abort', handleAbort, { once: true })
    resetWatchdog()

    worker.on('message', (message) => {
      if (settled) return
      if (message?.type === 'progress') {
        if (terminalSeen || !isValidProgress(message, request, lastProgress)) {
          cancelAndReject(createFailure('ARCHIVE_CLEANUP_CREDENTIAL_FAILED'))
          return
        }
        lastProgress = message.completed
        resetWatchdog()
        return
      }
      if (message?.type === 'complete') {
        if (terminalSeen || lastProgress !== request.sizeBytes) {
          cancelAndReject(createFailure('ARCHIVE_CLEANUP_CREDENTIAL_FAILED'))
          return
        }
        terminalSeen = true
        try { terminal = normalizeResult(message, request) } catch {
          cancelAndReject(createFailure('ARCHIVE_CLEANUP_CREDENTIAL_FAILED'))
        }
        return
      }
      if (message?.type === 'error') {
        terminalSeen = true
        cancelAndReject(normalizeWorkerFailure(message, request))
        return
      }
      cancelAndReject(createFailure('ARCHIVE_CLEANUP_CREDENTIAL_FAILED'))
    })
    worker.once('error', () => cancelAndReject(
      createFailure('ARCHIVE_CLEANUP_CREDENTIAL_FAILED'),
    ))
    worker.once('exit', (code) => {
      workerExited.resolve()
      cleanup()
      if (settled) return
      settled = true
      if (code === 0 && terminal !== null) {
        resolve(terminal)
      } else {
        reject(createFailure('ARCHIVE_CLEANUP_CREDENTIAL_FAILED'))
      }
    })

    try {
      worker.postMessage({
        type: 'credential',
        operationId: request.operationId,
        secretBytes: secret.buffer,
      }, [secret.buffer])
    } catch {
      zeroIfAttached(secret)
      cancelAndReject(createFailure('ARCHIVE_CLEANUP_CREDENTIAL_FAILED'))
      return
    }
    zeroIfAttached(secret)
    if (signal?.aborted === true) handleAbort()
  })

  return decorate(completion, workerExited.promise, () => cancel())
}

/** Copies the secret once and retains no caller-owned request object across worker lifetime. */
function takeArchiveCleanupCredentialOwnership(input) {
  const request = normalizeArchiveCleanupCredentialRequest(input?.request)
  const secret = createOwnedSecretBuffer(input?.secret, request.slotType)
  return Object.freeze({
    request,
    secret,
    signal: input?.signal,
    workerPath: input?.workerPath ?? DEFAULT_WORKER_PATH,
    createWorker: input?.createWorker,
  })
}

/** Creates an unpooled secret buffer with the same frozen UI credential bounds. */
function createOwnedSecretBuffer(value, slotType) {
  if (typeof value !== 'string' || CONTROL_CHARACTERS.test(value)
    || Buffer.byteLength(value, 'utf8') < 1 || Buffer.byteLength(value, 'utf8') > 1_024
    || (slotType === 'recovery' && !RECOVERY_CODE.test(value))
    || (slotType === 'passphrase' && (value.length < 14
      || [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[^A-Za-z0-9]/u]
        .filter((pattern) => pattern.test(value)).length < 3))) {
    throw createFailure('ARCHIVE_CLEANUP_CREDENTIAL_INVALID')
  }
  const buffer = Buffer.allocUnsafeSlow(Buffer.byteLength(value, 'utf8'))
  buffer.write(value, 'utf8')
  return buffer
}

/** Accepts only monotonic exact ciphertext progress. */
function isValidProgress(message, request, previousCompleted) {
  return Object.keys(message).sort().join(',')
      === 'completed,operationId,phase,total,type,unit'
    && message.operationId === request.operationId
    && message.phase === 'ciphertext'
    && message.unit === 'bytes'
    && Number.isSafeInteger(message.completed) && message.completed >= 0
    && message.completed > previousCompleted
    && message.total === request.sizeBytes
    && message.completed <= message.total
}

/** Accepts one exact identity-bound worker result. */
function normalizeResult(message, request) {
  const expectedKeys = [
    'archiveId', 'ciphertextSha256', 'custodyReconciled', 'fileIdentity',
    'missionId', 'operationId', 'sizeBytes', 'slotType', 'type',
  ].sort().join(',')
  if (Object.keys(message).sort().join(',') !== expectedKeys
    || message.operationId !== request.operationId
    || message.archiveId !== request.archiveId
    || message.missionId !== request.missionId
    || message.slotType !== request.slotType
    || message.ciphertextSha256 !== request.ciphertextSha256
    || message.sizeBytes !== request.sizeBytes
    || message.custodyReconciled !== true) {
    throw createFailure('ARCHIVE_CLEANUP_CREDENTIAL_FAILED')
  }
  const fileIdentity = normalizeCustodyFileIdentity(message.fileIdentity)
  if (fileIdentity.sizeBytes !== request.sizeBytes) {
    throw createFailure('ARCHIVE_CLEANUP_CREDENTIAL_FAILED')
  }
  return Object.freeze({
    operationId: request.operationId,
    archiveId: request.archiveId,
    missionId: request.missionId,
    slotType: request.slotType,
    ciphertextSha256: request.ciphertextSha256,
    sizeBytes: request.sizeBytes,
    fileIdentity,
    custodyReconciled: true,
  })
}

/** Accepts only an exact stable worker error envelope. */
function normalizeWorkerFailure(message, request) {
  if (Object.keys(message).sort().join(',') !== 'code,operationId,type'
    || message.operationId !== request.operationId
    || !FAILURE_CODES.has(message.code)) {
    return createFailure('ARCHIVE_CLEANUP_CREDENTIAL_FAILED')
  }
  return createFailure(message.code)
}

/** Creates one stable failure without worker or secret-controlled text. */
function createFailure(code) {
  const error = new Error(`Mission cleanup credential operation failed safely (${code}).`)
  error.name = code === 'ARCHIVE_CLEANUP_CANCELLED' ? 'AbortError' : 'Error'
  error.code = code
  return error
}

/** Zeroes a secret only while its ArrayBuffer remains locally attached. */
function zeroIfAttached(buffer) {
  if (buffer.buffer.byteLength > 0) buffer.fill(0)
}

/** Adds explicit cancellation and physical-exit ownership to one promise. */
function decorate(completion, workerExited, cancel) {
  Object.defineProperties(completion, {
    workerExited: { configurable: false, enumerable: false, value: workerExited },
    cancel: { configurable: false, enumerable: false, value: cancel },
  })
  return completion
}

/** Creates a one-shot deferred. */
function createDeferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

module.exports = { startArchiveCleanupCredentialCheck }
