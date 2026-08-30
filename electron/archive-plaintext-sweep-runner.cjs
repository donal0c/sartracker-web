'use strict'

const path = require('node:path')
const { Worker } = require('node:worker_threads')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'archive-plaintext-sweep-worker.cjs')
const WATCHDOG_MS = 60_000
const CANCEL_GRACE_MS = 500
const FAILURE_CODES = new Set([
  'ARCHIVE_PLAINTEXT_SWEEP_FAILED',
  'ARCHIVE_PLAINTEXT_SWEEP_ROOT_UNSAFE',
  'ARCHIVE_PLAINTEXT_SWEEP_SCOPE_INVALID',
])

/** Requires a bounded, already-resolved absolute archive directory. */
function normalizeArchiveDirectory(value) {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 4_096
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.resolve(value) !== value) {
    throw new Error('Archive plaintext sweep archive directory must be a resolved absolute path.')
  }
  return value
}

/** Starts one independent fixed-root startup plaintext sweep. */
function startArchivePlaintextSweep(input) {
  const archiveDirectory = normalizeArchiveDirectory(input?.archiveDirectory)
  const workerExited = createDeferred()
  if (input.signal?.aborted === true) {
    const rejected = Promise.reject(createAbortError())
    workerExited.resolve()
    return decorateOperation(rejected, workerExited.promise, () => undefined)
  }
  const cancellationBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const cancellationFlag = new Int32Array(cancellationBuffer)
  let worker
  let cancel = () => undefined

  const completion = new Promise((resolve, reject) => {
    try {
      const workerInput = Object.freeze({
        workerData: Object.freeze({ archiveDirectory, cancellationBuffer }),
        workerPath: input.workerPath ?? DEFAULT_WORKER_PATH,
      })
      worker = input.createWorker?.(workerInput) ?? new Worker(workerInput.workerPath, {
        workerData: workerInput.workerData,
      })
    } catch {
      workerExited.resolve()
      const error = new Error('Archive plaintext sweep worker could not start safely.')
      error.code = 'ARCHIVE_PLAINTEXT_SWEEP_FAILED'
      reject(error)
      return
    }

    let settled = false
    let terminalResult = null
    let terminalMessageSeen = false
    let watchdogTimer = null
    let terminationTimer = null
    let lastSequence = 0
    let lastRemovedEntryCount = 0

    /** Clears lifecycle resources only after physical worker termination. */
    const cleanup = () => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      if (terminationTimer !== null) clearTimeout(terminationTimer)
      input.signal?.removeEventListener('abort', handleAbort)
    }

    /** Rejects the public operation without claiming physical worker exit. */
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      input.signal?.removeEventListener('abort', handleAbort)
      reject(error)
    }

    /** Requests cooperative cancellation, then bounds physical termination. */
    const cancelAndReject = (error) => {
      if (settled) return
      if (Atomics.compareExchange(cancellationFlag, 0, 0, 1) === 0) {
        try {
          worker.postMessage({ type: 'cancel' })
        } catch {
          // The shared flag remains authoritative after port closure.
        }
      }
      rejectOnce(error)
      if (terminationTimer === null) {
        terminationTimer = setTimeout(() => {
          try {
            void Promise.resolve(worker.terminate()).catch(() => undefined)
          } catch {
            // workerExited remains governed only by the physical exit event.
          }
        }, CANCEL_GRACE_MS)
      }
    }

    cancel = () => cancelAndReject(createAbortError())
    const handleAbort = () => cancel()

    /** Starts a fresh fixed lack-of-progress deadline. */
    const resetWatchdog = () => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      watchdogTimer = setTimeout(() => {
        cancelAndReject(new Error(
          'Archive plaintext sweep worker stopped making bounded progress.',
        ))
      }, WATCHDOG_MS)
    }

    input.signal?.addEventListener('abort', handleAbort, { once: true })
    resetWatchdog()

    worker.on('message', (message) => {
      if (settled) return
      if (message?.type === 'progress') {
        if (terminalMessageSeen || !isValidProgress(
          message,
          lastSequence,
          lastRemovedEntryCount,
        )) {
          cancelAndReject(new Error(
            'Archive plaintext sweep worker emitted invalid progress.',
          ))
          return
        }
        lastSequence = message.sequence
        lastRemovedEntryCount = message.removedEntryCount
        resetWatchdog()
        return
      }
      if (message?.type === 'complete') {
        if (terminalMessageSeen) {
          cancelAndReject(new Error(
            'Archive plaintext sweep worker emitted duplicate terminal output.',
          ))
          return
        }
        terminalMessageSeen = true
        try {
          terminalResult = normalizeResult(message, lastRemovedEntryCount)
        } catch {
          cancelAndReject(new Error(
            'Archive plaintext sweep worker returned invalid terminal output.',
          ))
        }
        return
      }
      if (message?.type === 'error') {
        terminalMessageSeen = true
        cancelAndReject(createClosedWorkerFailure(message))
        return
      }
      cancelAndReject(new Error(
        'Archive plaintext sweep worker emitted unsupported output.',
      ))
    })

    worker.once('error', () => {
      cancelAndReject(new Error('Archive plaintext sweep worker failed unexpectedly.'))
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
        'Archive plaintext sweep worker exited without valid completion.',
      ))
    })

    if (input.signal?.aborted === true) handleAbort()
  })

  return decorateOperation(completion, workerExited.promise, () => cancel())
}

/** Accepts only exact strictly advancing closed progress envelopes. */
function isValidProgress(message, lastSequence, lastRemovedEntryCount) {
  return message !== null
    && typeof message === 'object'
    && !Array.isArray(message)
    && Object.keys(message).sort().join(',') === 'removedEntryCount,sequence,type'
    && Number.isSafeInteger(message.sequence)
    && message.sequence === lastSequence + 1
    && Number.isSafeInteger(message.removedEntryCount)
    && message.removedEntryCount === lastRemovedEntryCount + 1
}

/** Accepts one exact non-reflective successful result. */
function normalizeResult(message, lastRemovedEntryCount) {
  if (message === null
    || typeof message !== 'object'
    || Array.isArray(message)
    || Object.keys(message).sort().join(',') !== 'removedEntryCount,status,type'
    || message.status !== 'clean'
    || !Number.isSafeInteger(message.removedEntryCount)
    || message.removedEntryCount < 0
    || message.removedEntryCount !== lastRemovedEntryCount) {
    throw new Error('Archive plaintext sweep result is invalid.')
  }
  return Object.freeze({
    status: 'clean',
    removedEntryCount: message.removedEntryCount,
  })
}

/** Creates a stable typed failure without reflecting worker-controlled data. */
function createClosedWorkerFailure(message) {
  if (message?.code === 'ARCHIVE_CANCELLED') return createAbortError()
  const code = FAILURE_CODES.has(message?.code)
    ? message.code
    : 'ARCHIVE_PLAINTEXT_SWEEP_FAILED'
  const error = new Error(`Archive plaintext sweep worker failed safely (${code}).`)
  error.code = code
  return error
}

/** Creates a stable cancellation error for caller lifecycle fencing. */
function createAbortError() {
  const error = new Error('Archive plaintext sweep worker was cancelled.')
  error.name = 'AbortError'
  error.code = 'ARCHIVE_CANCELLED'
  return error
}

/** Decorates one promise with physical-exit ownership and explicit cancellation. */
function decorateOperation(completion, workerExited, cancel) {
  Object.defineProperties(completion, {
    workerExited: { configurable: false, enumerable: false, value: workerExited },
    cancel: { configurable: false, enumerable: false, value: cancel },
  })
  return completion
}

/** Creates a tiny single-settlement deferred. */
function createDeferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

module.exports = { startArchivePlaintextSweep }
