const path = require('node:path')
const { Worker } = require('node:worker_threads')
const { normalizeMissionReviewReadInput } = require('./mission-review-read-query.cjs')

const DEFAULT_WORKER_PATH = path.join(
  __dirname,
  'mission-review-read-query-worker.cjs',
)
const DEFAULT_WORKER_TIMEOUT_MS = 30_000

/** Runs one bounded Mission Review read without blocking Electron's main isolate. */
function runMissionReviewReadQueryInWorker(input) {
  normalizeMissionReviewReadInput(input.query)
  if (input.signal?.aborted === true) {
    return Promise.reject(createAbortError())
  }
  let resolveWorkerExit
  const workerExited = new Promise((resolve) => {
    resolveWorkerExit = resolve
  })
  const result = new Promise((resolve, reject) => {
    const timeoutMs = normalizeWorkerTimeoutMs(input.timeoutMs)
    let worker
    try {
      worker = input.createWorker?.() ?? new Worker(
        input.workerPath ?? DEFAULT_WORKER_PATH,
        {
          workerData: {
            databasePath: input.databasePath,
            query: input.query,
          },
        },
      )
    } catch (error) {
      resolveWorkerExit()
      reject(error)
      return
    }
    let settled = false
    let completedResult = null

    /** Removes shared lifecycle listeners once the worker has reached a terminal state. */
    const cleanup = () => {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', handleAbort)
    }

    /** Exposes cancellation immediately and terminates the obsolete worker in background. */
    const rejectAndTerminate = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
      void worker.terminate().catch(() => undefined)
    }

    const handleAbort = () => rejectAndTerminate(createAbortError())
    input.signal?.addEventListener('abort', handleAbort, { once: true })
    const timeout = setTimeout(() => {
      rejectAndTerminate(
        new Error(`Mission Review read worker timed out after ${timeoutMs} ms.`),
      )
    }, timeoutMs)

    worker.once('message', (message) => {
      if (settled) return
      if (isCompleteMessage(message, input.query.auditLimit)) {
        completedResult = {
          auditEvents: message.auditEvents,
          breadcrumbCount: message.breadcrumbCount,
          correctionAuthorized: message.correctionAuthorized,
          workerThreadId: message.workerThreadId,
        }
        return
      }
      rejectAndTerminate(createWorkerError(message))
    })
    worker.once('error', (error) => {
      rejectAndTerminate(
        new Error(
          `Mission Review read worker failed: ${safeWorkerErrorMessage(error.message)}`,
        ),
      )
    })
    worker.once('exit', (exitCode) => {
      resolveWorkerExit()
      if (settled) return
      settled = true
      cleanup()
      if (exitCode === 0 && completedResult !== null) {
        resolve(completedResult)
        return
      }
      reject(
        new Error(`Mission Review read worker failed: exited with code ${exitCode}.`),
      )
    })
  })
  Object.defineProperty(result, 'workerExited', {
    configurable: false,
    enumerable: false,
    value: workerExited,
    writable: false,
  })
  return result
}

/** Validates that a worker cannot return an unbounded or malformed IPC payload. */
function isCompleteMessage(message, auditLimit) {
  return (
    message?.type === 'complete' &&
    Number.isInteger(message.workerThreadId) &&
    message.workerThreadId > 0 &&
    Array.isArray(message.auditEvents) &&
    message.auditEvents.length <= auditLimit &&
    Number.isSafeInteger(message.breadcrumbCount) &&
    message.breadcrumbCount >= 0 &&
    typeof message.correctionAuthorized === 'boolean'
  )
}

/** Creates the stable cancellation error exposed to renderer generation fencing. */
function createAbortError() {
  const error = new Error('Mission Review read worker was cancelled.')
  error.name = 'AbortError'
  return error
}

/** Normalizes the bounded worker timeout used by packaged and fault-injection tests. */
function normalizeWorkerTimeoutMs(value) {
  if (value === undefined) return DEFAULT_WORKER_TIMEOUT_MS
  if (!Number.isFinite(value) || value < 1 || value > 300_000) {
    throw new Error(
      'Mission Review read worker timeout must be between 1 and 300000 ms.',
    )
  }
  return Math.floor(value)
}

/** Converts a worker error message without leaking multiline or unbounded content. */
function createWorkerError(message) {
  const error = new Error(
    `Mission Review read worker failed: ${safeWorkerErrorMessage(message?.message)}`,
  )
  error.name = safeWorkerErrorName(message?.name)
  return error
}

/** Bounds one worker error string for operator-safe propagation. */
function safeWorkerErrorMessage(input) {
  const value = String(input ?? 'unknown error').replace(/[\r\n]+/gu, ' ').trim()
  return value.slice(0, 500) || 'unknown error'
}

/** Allows only a conventional JavaScript error name across the worker boundary. */
function safeWorkerErrorName(input) {
  const value = String(input ?? '')
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(value) ? value : 'Error'
}

module.exports = {
  runMissionReviewReadQueryInWorker,
}
