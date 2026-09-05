'use strict'

const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { Worker } = require('node:worker_threads')

const {
  normalizeTicket,
} = require('./archive-review-sweep-worker.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'archive-review-sweep-worker.cjs')
const DEFAULT_WATCHDOG_MS = 60_000
const DEFAULT_CANCEL_GRACE_MS = 500
const FAILURE_CODES = new Set([
  'ARCHIVE_REVIEW_SWEEP_CIPHERTEXT_BOUNDARY',
  'ARCHIVE_REVIEW_SWEEP_ENTRY_UNSAFE',
  'ARCHIVE_REVIEW_SWEEP_FAILED',
  'ARCHIVE_REVIEW_SWEEP_INPUT_INVALID',
  'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED',
  'ARCHIVE_REVIEW_SWEEP_SCOPE_INVALID',
])

/** Starts one owned review-session plaintext sweep outside the Electron isolate. */
function startArchiveReviewSweep(input) {
  const ticket = normalizeTicket({
    operationId: input?.operationId ?? randomUUID(),
    reviewRoot: input?.reviewRoot,
    rootIdentity: input?.rootIdentity,
    quarantineDirectory: input?.quarantineDirectory,
    quarantineIdentity: input?.quarantineIdentity,
    archiveDirectory: input?.archiveDirectory,
    archiveDirectoryIdentity: input?.archiveDirectoryIdentity,
  })
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
    'Archive review sweep watchdog',
  )
  const cancelGraceMs = normalizeDuration(
    input.cancelGraceMs,
    DEFAULT_CANCEL_GRACE_MS,
    0,
    30_000,
    'Archive review sweep cancellation grace period',
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
      reject(createFailure('ARCHIVE_REVIEW_SWEEP_FAILED'))
      return
    }

    let settled = false
    let terminalResult = null
    let terminalMessageSeen = false
    let watchdogTimer = null
    let terminationTimer = null
    let lastSequence = 0
    let lastRemovedEntryCount = 0

    /** Releases lifecycle resources only after physical worker termination. */
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
            // The exit event remains the only physical-exit authority.
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
        cancelAndReject(createFailure('ARCHIVE_REVIEW_SWEEP_FAILED'))
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
          lastSequence,
          lastRemovedEntryCount,
        )) {
          cancelAndReject(createFailure('ARCHIVE_REVIEW_SWEEP_FAILED'))
          return
        }
        lastSequence = message.sequence
        lastRemovedEntryCount = message.removedEntryCount
        resetWatchdog()
        return
      }
      if (message?.type === 'complete') {
        if (terminalMessageSeen) {
          cancelAndReject(createFailure('ARCHIVE_REVIEW_SWEEP_FAILED'))
          return
        }
        terminalMessageSeen = true
        try {
          terminalResult = normalizeResult(
            message,
            ticket.operationId,
            lastRemovedEntryCount,
          )
        } catch {
          cancelAndReject(createFailure('ARCHIVE_REVIEW_SWEEP_FAILED'))
        }
        return
      }
      if (message?.type === 'error') {
        if (terminalMessageSeen || !isValidError(message, ticket.operationId)) {
          terminalMessageSeen = true
          cancelAndReject(createFailure('ARCHIVE_REVIEW_SWEEP_FAILED'))
          return
        }
        terminalMessageSeen = true
        if (message.code === 'ARCHIVE_CANCELLED') {
          cancelAndReject(createAbortError())
          return
        }
        cancelAndReject(createFailure(message.code))
        return
      }
      cancelAndReject(createFailure('ARCHIVE_REVIEW_SWEEP_FAILED'))
    })

    worker.once('error', () => {
      cancelAndReject(createFailure('ARCHIVE_REVIEW_SWEEP_FAILED'))
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
      reject(createFailure('ARCHIVE_REVIEW_SWEEP_FAILED'))
    })

    if (input.signal?.aborted === true) handleAbort()
  })

  return decorateOperation(completion, workerExited.promise, () => cancel())
}

/** Accepts one exact non-reflective worker failure envelope. */
function isValidError(message, operationId) {
  return message !== null
    && typeof message === 'object'
    && !Array.isArray(message)
    && Object.keys(message).sort().join(',') === 'code,operationId,type'
    && message.operationId === operationId
    && (message.code === 'ARCHIVE_CANCELLED' || FAILURE_CODES.has(message.code))
}

/** Accepts only exact, strictly advancing progress envelopes. */
function isValidProgress(message, operationId, lastSequence, lastRemovedEntryCount) {
  return message !== null
    && typeof message === 'object'
    && !Array.isArray(message)
    && Object.keys(message).sort().join(',')
      === 'operationId,removedEntryCount,sequence,type'
    && message.operationId === operationId
    && Number.isSafeInteger(message.sequence)
    && message.sequence === lastSequence + 1
    && Number.isSafeInteger(message.removedEntryCount)
    && message.removedEntryCount > lastRemovedEntryCount
}

/** Accepts one exact non-reflective successful result. */
function normalizeResult(message, operationId, lastRemovedEntryCount) {
  if (message === null || typeof message !== 'object' || Array.isArray(message)
    || Object.keys(message).sort().join(',')
      !== 'operationId,removedEntryCount,status,type'
    || message.operationId !== operationId
    || message.status !== 'clean'
    || !Number.isSafeInteger(message.removedEntryCount)
    || message.removedEntryCount < 1
    || message.removedEntryCount !== lastRemovedEntryCount) {
    throw createFailure('ARCHIVE_REVIEW_SWEEP_FAILED')
  }
  return Object.freeze({ status: 'clean', removedEntryCount: message.removedEntryCount })
}

/** Creates one stable non-reflective sweep failure. */
function createFailure(code) {
  const normalizedCode = FAILURE_CODES.has(code) ? code : 'ARCHIVE_REVIEW_SWEEP_FAILED'
  const error = new Error(`Archive review plaintext sweep failed safely (${normalizedCode}).`)
  error.code = normalizedCode
  return error
}

/** Creates the stable cancellation error used by owned lifecycle joins. */
function createAbortError() {
  const error = new Error('Archive review plaintext sweep was cancelled.')
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

module.exports = { startArchiveReviewSweep }
