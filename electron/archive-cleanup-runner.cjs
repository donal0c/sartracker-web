'use strict'

const path = require('node:path')
const { Worker } = require('node:worker_threads')
const {
  cleanupCauseClassForCode,
  normalizeCleanupFailureDiagnostic,
} = require('./archive-cleanup-failure.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'archive-cleanup-worker.cjs')
const CANCEL_GRACE_MS = 500
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/** Starts one archive cleanup operation on a worker-owned SQLite connection. */
function startArchiveCleanupWorker(input) {
  const request = normalizeRequest(input)
  const workerExited = createDeferred()
  if (input.signal?.aborted === true) {
    const rejected = Promise.reject(createFailure('ARCHIVE_CLEANUP_CANCELLED'))
    workerExited.resolve()
    return decorate(rejected, workerExited.promise, () => undefined)
  }
  const cancellationBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const cancellationFlag = new Int32Array(cancellationBuffer)
  let worker
  let settled = false
  let terminalResult = null
  let terminationTimer = null
  let cancel = () => undefined
  let failureError = null

  const completion = new Promise((resolve, reject) => {
    try {
      worker = input.createWorker?.({
        workerPath: input.workerPath ?? DEFAULT_WORKER_PATH,
        workerData: Object.freeze({ request, cancellationBuffer }),
      }) ?? new Worker(input.workerPath ?? DEFAULT_WORKER_PATH, {
        workerData: Object.freeze({ request, cancellationBuffer }),
      })
    } catch {
      workerExited.resolve()
      reject(createFailure('ARCHIVE_CLEANUP_FAILED'))
      return
    }

    const cleanup = () => {
      if (terminationTimer !== null) clearTimeout(terminationTimer)
      input.signal?.removeEventListener('abort', handleAbort)
    }
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      failureError = error
      reject(error)
    }
    const cancelAndReject = (error) => {
      Atomics.store(cancellationFlag, 0, 1)
      try { worker.postMessage({ type: 'cancel', operationId: request.operationId }) } catch {}
      rejectOnce(error)
      if (terminationTimer === null) {
        terminationTimer = setTimeout(() => {
          void Promise.resolve(worker.terminate()).catch(() => undefined)
        }, CANCEL_GRACE_MS)
      }
    }
    cancel = () => cancelAndReject(createFailure('ARCHIVE_CLEANUP_CANCELLED'))
    const handleAbort = () => cancel()
    input.signal?.addEventListener('abort', handleAbort, { once: true })

    worker.on('message', (message) => {
      if (settled) return
      if (message?.operationId !== request.operationId) {
        cancelAndReject(createFailure('ARCHIVE_CLEANUP_FAILED'))
        return
      }
      if (message.type === 'progress') {
        try { input.onProgress?.(message.progress) } catch {
          cancelAndReject(createFailure('ARCHIVE_CLEANUP_FAILED'))
        }
        return
      }
      if (message.type === 'complete') {
        if (message.result === null || typeof message.result !== 'object'
          || Array.isArray(message.result)) {
          cancelAndReject(createFailure('ARCHIVE_CLEANUP_FAILED'))
          return
        }
        terminalResult = message.result
        return
      }
      if (message.type === 'error') {
        cancelAndReject(createFailure(message.code, message.diagnostic))
        return
      }
      cancelAndReject(createFailure('ARCHIVE_CLEANUP_FAILED', {
        substage: 'worker_protocol',
        causeClass: 'protocol_invalid',
      }))
    })
    worker.once('error', () => cancelAndReject(createFailure('ARCHIVE_CLEANUP_FAILED', {
      substage: 'worker_exit',
      causeClass: 'worker_error',
      workerExit: { observed: false, event: 'error', code: null },
    })))
    worker.once('exit', (code) => {
      if (failureError !== null) {
        const current = failureError.cleanupDiagnostic ?? {}
        attachCleanupFailureDiagnostic(failureError, {
          ...current,
          workerExit: {
            observed: true,
            event: current.workerExit?.event ?? 'exit',
            code: Number.isSafeInteger(code) && code >= 0 ? code : null,
          },
        })
      }
      workerExited.resolve()
      cleanup()
      if (settled) return
      settled = true
      if (code === 0 && terminalResult !== null) {
        resolve(Object.freeze({ ...terminalResult }))
      } else {
        reject(createFailure('ARCHIVE_CLEANUP_FAILED', {
          substage: 'worker_exit',
          causeClass: 'worker_exit',
          workerExit: { observed: true, event: 'exit', code },
        }))
      }
    })
    if (input.signal?.aborted === true) handleAbort()
  })

  return decorate(completion, workerExited.promise, () => cancel())
}

/** Validates and projects the non-secret worker request. */
function normalizeRequest(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || typeof input.databasePath !== 'string' || !path.isAbsolute(input.databasePath)
    || typeof input.archiveDirectory !== 'string' || !path.isAbsolute(input.archiveDirectory)
    || typeof input.archiveRelativePath !== 'string'
    || path.isAbsolute(input.archiveRelativePath)
    || input.archiveRelativePath.includes('\\')
    || input.archiveRelativePath.split('/').includes('..')
    || typeof input.operationId !== 'string' || !OPERATION_ID.test(input.operationId)
    || !['start', 'resume'].includes(input.mode)
    || input.evidence === null || typeof input.evidence !== 'object'
    || Array.isArray(input.evidence)) {
    throw createFailure('ARCHIVE_CLEANUP_INPUT_INVALID')
  }
  return Object.freeze({
    databasePath: path.resolve(input.databasePath),
    archiveDirectory: path.resolve(input.archiveDirectory),
    archiveRelativePath: input.archiveRelativePath,
    expectedFileIdentity: input.expectedFileIdentity,
    evidence: Object.freeze({ ...input.evidence }),
    mode: input.mode,
    operationId: input.operationId,
    ...(input.batchLimits === undefined ? {} : { batchLimits: input.batchLimits }),
    ...(input.faultInjection === undefined ? {} : { faultInjection: input.faultInjection }),
  })
}

/** Returns a stable failure without reflecting worker internals across IPC. */
function createFailure(code, diagnostic = {}) {
  const error = new Error('Mission archive cleanup failed safely.')
  error.code = typeof code === 'string' ? code : 'ARCHIVE_CLEANUP_FAILED'
  attachCleanupFailureDiagnostic(error, {
    ...diagnostic,
    causeClass: diagnostic.causeClass ?? cleanupCauseClassForCode(error.code),
  })
  return error
}

/** Attaches one normalized, non-secret cleanup diagnostic to an error. */
function attachCleanupFailureDiagnostic(error, diagnostic) {
  Object.defineProperty(error, 'cleanupDiagnostic', {
    value: normalizeCleanupFailureDiagnostic(diagnostic),
    enumerable: false,
    configurable: true,
    writable: false,
  })
  return error
}

/** Creates one deferred completion for physical worker exit. */
function createDeferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

/** Attaches lifecycle controls without retaining worker secrets in the result. */
function decorate(promise, workerExited, cancel) {
  promise.workerExited = workerExited
  promise.cancel = cancel
  return promise
}

module.exports = { startArchiveCleanupWorker }
