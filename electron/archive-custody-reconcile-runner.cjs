'use strict'

const path = require('node:path')
const { Worker } = require('node:worker_threads')

const {
  normalizeArchiveCustodyReconcileResult,
  normalizeArchiveCustodyReconcileTicket,
} = require('./archive-custody-reconcile-envelope.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'archive-custody-reconcile-worker.cjs')
const DEFAULT_WATCHDOG_MS = 60_000
const DEFAULT_CANCEL_GRACE_MS = 500

/** Runs one registry-issued full-file inspection outside the caller isolate. */
function startArchiveCustodyReconciliation(input) {
  const ticket = normalizeArchiveCustodyReconcileTicket(input?.ticket)
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
    'Archive custody reconciliation watchdog',
  )
  const cancelGraceMs = normalizeDuration(
    input.cancelGraceMs,
    DEFAULT_CANCEL_GRACE_MS,
    0,
    30_000,
    'Archive custody reconciliation cancellation grace period',
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
    } catch (error) {
      workerExited.resolve()
      reject(error)
      return
    }

    let settled = false
    let terminal = null
    let terminalMessageSeen = false
    let watchdogTimer = null
    let terminationTimer = null
    let lastProgress = null

    /** Clears lifecycle resources only after physical worker termination. */
    const cleanup = () => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      if (terminationTimer !== null) clearTimeout(terminationTimer)
      input.signal?.removeEventListener('abort', handleAbort)
    }

    /** Rejects the public operation once without claiming physical worker exit. */
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      input.signal?.removeEventListener('abort', handleAbort)
      reject(error)
    }

    /** Requests cooperative cancellation and forces termination after a bounded grace. */
    const cancelAndReject = (error) => {
      if (settled) return
      if (Atomics.compareExchange(cancellationFlag, 0, 0, 1) === 0) {
        try {
          worker.postMessage({ type: 'cancel', operationId: ticket.operationId })
        } catch {
          // The shared flag remains authoritative if the message port has closed.
        }
      }
      rejectOnce(error)
      if (terminationTimer === null) {
        terminationTimer = setTimeout(() => {
          try {
            void Promise.resolve(worker.terminate()).catch(() => undefined)
          } catch {
            // The physical exit event remains the sole workerExited authority.
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
        cancelAndReject(new Error(
          'Archive custody reconciliation worker stopped making bounded progress.',
        ))
      }, watchdogMs)
    }

    input.signal?.addEventListener('abort', handleAbort, { once: true })
    resetWatchdog()

    worker.on('message', (message) => {
      if (settled) return
      if (message?.type === 'progress') {
        if (terminalMessageSeen) {
          cancelAndReject(new Error(
            'Archive custody reconciliation worker emitted data after completion.',
          ))
          return
        }
        let progress
        try {
          progress = normalizeProgress(message, ticket.operationId)
          assertProgressAdvance(progress, lastProgress)
        } catch {
          cancelAndReject(new Error(
            'Archive custody reconciliation worker emitted invalid progress.',
          ))
          return
        }
        try {
          if (isMeaningfulProgress(progress, lastProgress)) resetWatchdog()
          lastProgress = progress
          input.onProgress?.(progress)
        } catch {
          cancelAndReject(new Error(
            'Archive custody reconciliation progress observer failed safely.',
          ))
        }
        return
      }
      if (message?.type === 'complete') {
        if (terminalMessageSeen) {
          cancelAndReject(new Error(
            'Archive custody reconciliation worker emitted duplicate terminal output.',
          ))
          return
        }
        terminalMessageSeen = true
        try {
          terminal = normalizeArchiveCustodyReconcileResult(message, ticket)
        } catch {
          cancelAndReject(new Error(
            'Archive custody reconciliation worker returned an invalid or substituted result.',
          ))
        }
        return
      }
      if (message?.type === 'error') {
        terminalMessageSeen = true
        if (message.operationId === ticket.operationId
          && message.code === 'ARCHIVE_CANCELLED') {
          cancelAndReject(createAbortError())
          return
        }
        cancelAndReject(new Error('Archive custody reconciliation worker failed safely.'))
        return
      }
      cancelAndReject(new Error(
        'Archive custody reconciliation worker emitted an unsupported message.',
      ))
    })

    worker.once('error', () => {
      cancelAndReject(new Error('Archive custody reconciliation worker failed unexpectedly.'))
    })

    worker.once('exit', (code) => {
      workerExited.resolve()
      cleanup()
      if (settled) return
      settled = true
      if (code === 0 && terminal !== null) {
        resolve(terminal)
        return
      }
      reject(new Error(
        `Archive custody reconciliation worker exited without valid completion (code ${code}).`,
      ))
    })

    if (input.signal?.aborted === true) {
      handleAbort()
    }
  })
  return decorateOperation(completion, workerExited.promise, () => cancel())
}

/** Validates and closes one worker byte-progress message. */
function normalizeProgress(message, operationId) {
  if (message === null || typeof message !== 'object' || Array.isArray(message)
    || Object.keys(message).sort().join(',')
      !== 'completedBytes,operationId,totalBytes,type'
    || message.type !== 'progress' || message.operationId !== operationId
    || !Number.isSafeInteger(message.completedBytes) || message.completedBytes < 0
    || !Number.isSafeInteger(message.totalBytes) || message.totalBytes < 1
    || message.completedBytes > message.totalBytes) {
    throw new Error('Archive custody reconciliation progress is invalid.')
  }
  return Object.freeze({
    type: 'progress',
    operationId,
    completedBytes: message.completedBytes,
    totalBytes: message.totalBytes,
  })
}

/** Prevents byte-progress regression and total substitution. */
function assertProgressAdvance(progress, previous) {
  if (previous === null) return
  if (progress.totalBytes !== previous.totalBytes
    || progress.completedBytes < previous.completedBytes) {
    throw new Error('Archive custody reconciliation progress regressed.')
  }
}

/** Returns true only when a progress message proves new bytes were inspected. */
function isMeaningfulProgress(progress, previous) {
  if (previous === null) return progress.completedBytes > 0
  return progress.completedBytes > previous.completedBytes
}

/** Creates a stable cancellation error for caller fencing. */
function createAbortError() {
  const error = new Error('Archive custody reconciliation was cancelled.')
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

/** Decorates one promise with physical-exit and explicit-cancel controls. */
function decorateOperation(completion, workerExited, cancel) {
  /** Cancels cooperatively and waits for the owned worker's physical exit. */
  const prepareClose = () => {
    cancel()
    return workerExited
  }
  Object.defineProperties(completion, {
    workerExited: { configurable: false, enumerable: false, value: workerExited },
    cancel: { configurable: false, enumerable: false, value: cancel },
    prepareClose: { configurable: false, enumerable: false, value: prepareClose },
  })
  return completion
}

/** Creates a tiny single-settlement deferred. */
function createDeferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

module.exports = { startArchiveCustodyReconciliation }
