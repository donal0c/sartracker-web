'use strict'

const path = require('node:path')
const { Worker } = require('node:worker_threads')

const {
  PROGRESS_PHASE_ORDER,
  normalizeArchiveCustodyOperationProgress,
  normalizeArchiveCustodyOperationResult,
  normalizeArchiveCustodyOperationTicket,
} = require('./archive-custody-operation-envelope.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'archive-custody-operation-worker.cjs')
const DEFAULT_WATCHDOG_MS = 60_000
const DEFAULT_CANCEL_GRACE_MS = 500

/** Starts one journal-issued custody filesystem operation outside the main isolate. */
function startArchiveCustodyOperation(input) {
  const ticket = normalizeArchiveCustodyOperationTicket(input?.ticket)
  const workerExited = createDeferred()
  if (input.signal?.aborted === true) {
    const rejected = Promise.reject(createAbortError())
    workerExited.resolve()
    return decorateOperation(
      rejected,
      workerExited.promise,
      () => undefined,
      async () => workerExited.promise,
    )
  }
  const watchdogMs = normalizeDuration(
    input.watchdogMs,
    DEFAULT_WATCHDOG_MS,
    1,
    30 * 60_000,
    'Archive custody operation watchdog',
  )
  const cancelGraceMs = normalizeDuration(
    input.cancelGraceMs,
    DEFAULT_CANCEL_GRACE_MS,
    0,
    30_000,
    'Archive custody operation cancellation grace period',
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
    let terminalResult = null
    let terminalMessageSeen = false
    let watchdogTimer = null
    let terminationTimer = null
    let lastProgress = null

    /** Clears runner resources after the physical worker exit. */
    const cleanup = () => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      if (terminationTimer !== null) clearTimeout(terminationTimer)
      input.signal?.removeEventListener('abort', handleAbort)
    }

    /** Rejects the caller-visible operation once without claiming physical exit. */
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      input.signal?.removeEventListener('abort', handleAbort)
      reject(error)
    }

    /** Requests cooperative stop, then forces termination after the bounded grace. */
    const cancelAndReject = (error) => {
      if (settled) return
      if (Atomics.compareExchange(cancellationFlag, 0, 0, 1) === 0) {
        try {
          worker.postMessage({
            type: 'cancel',
            maintenanceOperationId: ticket.maintenanceOperationId,
          })
        } catch {
          // The shared flag remains authoritative after a closed message port.
        }
      }
      rejectOnce(error)
      if (terminationTimer === null) {
        terminationTimer = setTimeout(() => {
          try {
            void Promise.resolve(worker.terminate()).catch(() => undefined)
          } catch {
            // The exit event remains the sole physical-lifecycle authority.
          }
        }, cancelGraceMs)
      }
    }

    cancel = () => cancelAndReject(createAbortError())
    const handleAbort = () => cancel()

    /** Starts a fresh lack-of-forward-progress deadline. */
    const resetWatchdog = () => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      watchdogTimer = setTimeout(() => {
        cancelAndReject(new Error(
          'Archive custody operation worker stopped making bounded progress.',
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
            'Archive custody operation worker emitted data after completion.',
          ))
          return
        }
        let progress
        try {
          progress = normalizeArchiveCustodyOperationProgress(
            message,
            ticket.maintenanceOperationId,
          )
          assertProgressAdvance(progress, lastProgress)
        } catch {
          cancelAndReject(new Error(
            'Archive custody operation worker emitted invalid progress.',
          ))
          return
        }
        if (isMeaningfulProgress(progress, lastProgress)) resetWatchdog()
        lastProgress = progress
        try {
          input.onProgress?.(progress)
        } catch {
          cancelAndReject(new Error(
            'Archive custody operation progress observer failed safely.',
          ))
        }
        return
      }
      if (message?.type === 'complete') {
        if (terminalMessageSeen) {
          cancelAndReject(new Error(
            'Archive custody operation worker emitted duplicate terminal output.',
          ))
          return
        }
        terminalMessageSeen = true
        try {
          terminalResult = normalizeArchiveCustodyOperationResult(message, ticket)
        } catch {
          cancelAndReject(new Error(
            'Archive custody operation worker returned an invalid or substituted result.',
          ))
        }
        return
      }
      if (message?.type === 'error') {
        terminalMessageSeen = true
        if (message.maintenanceOperationId === ticket.maintenanceOperationId
          && message.code === 'ARCHIVE_CANCELLED') {
          cancelAndReject(createAbortError())
          return
        }
        cancelAndReject(new Error('Archive custody operation worker failed safely.'))
        return
      }
      cancelAndReject(new Error(
        'Archive custody operation worker emitted an unsupported message.',
      ))
    })

    worker.once('error', () => {
      cancelAndReject(new Error('Archive custody operation worker failed unexpectedly.'))
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
      reject(new Error(
        `Archive custody operation worker exited without valid completion (code ${code}).`,
      ))
    })

    if (input.signal?.aborted === true) handleAbort()
  })

  /** Cancels any active operation and waits for its physical worker exit. */
  const prepareClose = async () => {
    cancel()
    await workerExited.promise
  }
  return decorateOperation(
    completion,
    workerExited.promise,
    () => cancel(),
    prepareClose,
  )
}

/** Prevents progress sequence, phase, unit, total, or counter regression. */
function assertProgressAdvance(progress, previous) {
  if (previous === null) return
  if (progress.sequence <= previous.sequence) {
    throw new Error('Archive custody operation progress sequence regressed.')
  }
  const previousPhase = PROGRESS_PHASE_ORDER.indexOf(previous.phase)
  const currentPhase = PROGRESS_PHASE_ORDER.indexOf(progress.phase)
  if (currentPhase < previousPhase) {
    throw new Error('Archive custody operation progress phase regressed.')
  }
  if (currentPhase === previousPhase && (
    progress.unit !== previous.unit || progress.total !== previous.total
    || progress.completed < previous.completed
  )) {
    throw new Error('Archive custody operation progress counter changed shape.')
  }
}

/** Returns whether valid progress proves forward work for watchdog renewal. */
function isMeaningfulProgress(progress, previous) {
  if (previous === null) return true
  return PROGRESS_PHASE_ORDER.indexOf(progress.phase)
      > PROGRESS_PHASE_ORDER.indexOf(previous.phase)
    || progress.completed > previous.completed
}

/** Creates one stable cancellation error for explicit caller fencing. */
function createAbortError() {
  const error = new Error('Archive custody operation was cancelled.')
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

/** Decorates one promise with physical-exit, cancel, and close controls. */
function decorateOperation(completion, workerExited, cancel, prepareClose) {
  Object.defineProperties(completion, {
    workerExited: { configurable: false, enumerable: false, value: workerExited },
    cancel: { configurable: false, enumerable: false, value: cancel },
    prepareClose: { configurable: false, enumerable: false, value: prepareClose },
  })
  return completion
}

/** Creates one tiny single-settlement deferred. */
function createDeferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

module.exports = { startArchiveCustodyOperation }
