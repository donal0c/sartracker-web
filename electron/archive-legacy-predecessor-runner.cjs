'use strict'

const path = require('node:path')
const { Worker } = require('node:worker_threads')

const {
  normalizeArchiveLegacyPredecessorResult,
  normalizeArchiveLegacyPredecessorTicket,
} = require('./archive-legacy-predecessor-envelope.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'archive-legacy-predecessor-worker.cjs')
const DEFAULT_WATCHDOG_MS = 60_000
const DEFAULT_CANCEL_GRACE_MS = 500
const FAILURE_CODES = new Set([
  'ARCHIVE_LEGACY_PREDECESSOR_CHANGED',
  'ARCHIVE_LEGACY_PREDECESSOR_FAILED',
  'ARCHIVE_LEGACY_PREDECESSOR_MISSING',
  'ARCHIVE_LEGACY_PREDECESSOR_UNSAFE',
])

/** Starts one complete legacy-predecessor hash outside the Electron isolate. */
function startArchiveLegacyPredecessorHash(input) {
  const ticket = normalizeArchiveLegacyPredecessorTicket(input?.ticket)
  const workerExited = createDeferred()
  if (input.signal?.aborted === true) {
    const rejected = Promise.reject(createAbortError())
    workerExited.resolve()
    return decorateOperation(rejected, workerExited.promise, () => undefined)
  }
  const watchdogMs = normalizeDuration(
    input.watchdogMs,
    DEFAULT_WATCHDOG_MS,
    1,
    30 * 60_000,
    'Legacy archive predecessor watchdog',
  )
  const cancelGraceMs = normalizeDuration(
    input.cancelGraceMs,
    DEFAULT_CANCEL_GRACE_MS,
    0,
    30_000,
    'Legacy archive predecessor cancellation grace period',
  )
  const cancellationBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const cancellationFlag = new Int32Array(cancellationBuffer)
  let worker
  let cancel = () => undefined

  const completion = new Promise((resolve, reject) => {
    try {
      const workerInput = Object.freeze({
        workerData: Object.freeze({ ticket, cancellationBuffer }),
        workerPath: input.workerPath ?? DEFAULT_WORKER_PATH,
      })
      worker = input.createWorker?.(workerInput) ?? new Worker(workerInput.workerPath, {
        workerData: workerInput.workerData,
      })
    } catch {
      workerExited.resolve()
      reject(createFailure('ARCHIVE_LEGACY_PREDECESSOR_FAILED'))
      return
    }

    let settled = false
    let terminalResult = null
    let terminalMessageSeen = false
    let watchdogTimer = null
    let terminationTimer = null
    let lastCompletedBytes = 0
    let totalBytes = null

    /** Releases lifecycle resources only after physical worker exit. */
    const cleanup = () => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      if (terminationTimer !== null) clearTimeout(terminationTimer)
      input.signal?.removeEventListener('abort', handleAbort)
    }

    /** Rejects the public operation once without claiming physical exit. */
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      input.signal?.removeEventListener('abort', handleAbort)
      reject(error)
    }

    /** Requests cooperative cancellation and bounds physical termination. */
    const cancelAndReject = (error) => {
      if (settled) return
      if (Atomics.compareExchange(cancellationFlag, 0, 0, 1) === 0) {
        try {
          worker.postMessage({ type: 'cancel', operationId: ticket.operationId })
        } catch {
          // The shared flag remains authoritative after message-port closure.
        }
      }
      rejectOnce(error)
      if (terminationTimer === null) {
        terminationTimer = setTimeout(() => {
          try {
            void Promise.resolve(worker.terminate()).catch(() => undefined)
          } catch {
            // The exit event remains the sole physical-exit authority.
          }
        }, cancelGraceMs)
      }
    }

    cancel = () => cancelAndReject(createAbortError())
    const handleAbort = () => cancel()

    /** Starts a fresh lack-of-progress deadline. */
    const resetWatchdog = () => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      watchdogTimer = setTimeout(() => {
        cancelAndReject(createFailure('ARCHIVE_LEGACY_PREDECESSOR_FAILED'))
      }, watchdogMs)
    }

    input.signal?.addEventListener('abort', handleAbort, { once: true })
    resetWatchdog()

    worker.on('message', (message) => {
      if (settled) return
      if (message?.type === 'progress') {
        if (terminalMessageSeen || !isValidProgress(
          message,
          ticket.operationId,
          lastCompletedBytes,
          totalBytes,
        )) {
          cancelAndReject(createFailure('ARCHIVE_LEGACY_PREDECESSOR_FAILED'))
          return
        }
        lastCompletedBytes = message.completedBytes
        totalBytes = message.totalBytes
        resetWatchdog()
        return
      }
      if (message?.type === 'complete') {
        if (terminalMessageSeen) {
          cancelAndReject(createFailure('ARCHIVE_LEGACY_PREDECESSOR_FAILED'))
          return
        }
        terminalMessageSeen = true
        try {
          terminalResult = normalizeArchiveLegacyPredecessorResult(message, ticket)
          if (totalBytes === null
            || lastCompletedBytes !== totalBytes
            || terminalResult.sizeBytes !== totalBytes) {
            throw new Error('Legacy archive predecessor progress did not complete.')
          }
        } catch {
          cancelAndReject(createFailure('ARCHIVE_LEGACY_PREDECESSOR_FAILED'))
        }
        return
      }
      if (message?.type === 'error') {
        terminalMessageSeen = true
        if (isValidError(message, ticket.operationId)
          && message.code === 'ARCHIVE_CANCELLED') {
          cancelAndReject(createAbortError())
          return
        }
        cancelAndReject(createFailure(
          isValidError(message, ticket.operationId)
            ? message.code
            : 'ARCHIVE_LEGACY_PREDECESSOR_FAILED',
        ))
        return
      }
      cancelAndReject(createFailure('ARCHIVE_LEGACY_PREDECESSOR_FAILED'))
    })

    worker.once('error', () => {
      cancelAndReject(createFailure('ARCHIVE_LEGACY_PREDECESSOR_FAILED'))
    })

    worker.once('exit', (code) => {
      workerExited.resolve()
      cleanup()
      if (settled) return
      settled = true
      if (code === 0 && terminalResult !== null) {
        resolve(terminalResult)
        return
      }
      reject(createFailure('ARCHIVE_LEGACY_PREDECESSOR_FAILED'))
    })

    if (input.signal?.aborted === true) handleAbort()
  })

  return decorateOperation(completion, workerExited.promise, () => cancel())
}

/** Accepts only exact monotonic byte-progress envelopes. */
function isValidProgress(message, operationId, lastCompletedBytes, totalBytes) {
  return message !== null
    && typeof message === 'object'
    && !Array.isArray(message)
    && Object.keys(message).sort().join(',')
      === 'completedBytes,operationId,totalBytes,type'
    && message.operationId === operationId
    && Number.isSafeInteger(message.completedBytes)
    && message.completedBytes > lastCompletedBytes
    && Number.isSafeInteger(message.totalBytes)
    && message.totalBytes > 0
    && message.completedBytes <= message.totalBytes
    && (totalBytes === null || message.totalBytes === totalBytes)
}

/** Accepts one exact closed worker failure envelope for this operation. */
function isValidError(message, operationId) {
  return message !== null
    && typeof message === 'object'
    && !Array.isArray(message)
    && Object.keys(message).sort().join(',') === 'code,operationId,type'
    && message.operationId === operationId
    && (message.code === 'ARCHIVE_CANCELLED' || FAILURE_CODES.has(message.code))
}

/** Creates one closed non-reflective hash failure. */
function createFailure(code) {
  const normalizedCode = FAILURE_CODES.has(code)
    ? code
    : 'ARCHIVE_LEGACY_PREDECESSOR_FAILED'
  const error = new Error(`Legacy archive predecessor hash failed safely (${normalizedCode}).`)
  error.code = normalizedCode
  return error
}

/** Creates the stable cancellation error used by archive-family ownership. */
function createAbortError() {
  const error = new Error('Legacy archive predecessor hash was cancelled.')
  error.name = 'AbortError'
  error.code = 'ARCHIVE_CANCELLED'
  return error
}

/** Normalizes one bounded runner-only duration. */
function normalizeDuration(value, fallback, minimum, maximum, label) {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum} ms.`)
  }
  return Math.floor(value)
}

/** Decorates one promise with physical-exit ownership and explicit cancellation. */
function decorateOperation(completion, workerExited, cancel) {
  Object.defineProperties(completion, {
    workerExited: { configurable: false, enumerable: false, value: workerExited },
    cancel: { configurable: false, enumerable: false, value: cancel },
  })
  return completion
}

/** Creates one tiny single-settlement deferred. */
function createDeferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

module.exports = { startArchiveLegacyPredecessorHash }
