const path = require('node:path')
const { Worker } = require('node:worker_threads')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'breadcrumb-dot-query-worker.cjs')
const DEFAULT_WORKER_TIMEOUT_MS = 30_000

/** Runs an exact breadcrumb-dot page query outside the Electron main isolate. */
function runBreadcrumbDotQueryInWorker(input) {
  if (input.signal?.aborted === true) {
    return Promise.reject(createAbortError())
  }
  return new Promise((resolve, reject) => {
    const timeoutMs = normalizeWorkerTimeoutMs(input.timeoutMs)
    const createWorker = input.createWorker ?? ((workerPath, workerOptions) =>
      new Worker(workerPath, workerOptions))
    const worker = createWorker(input.workerPath ?? DEFAULT_WORKER_PATH, {
      workerData: {
        databasePath: input.databasePath,
        query: input.query,
      },
    })
    let settled = false
    let completedResult = null
    const handleAbort = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      void worker.terminate().then(
        () => reject(createAbortError()),
        () => reject(createAbortError()),
      )
    }
    input.signal?.addEventListener('abort', handleAbort, { once: true })
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      input.signal?.removeEventListener('abort', handleAbort)
      terminateThenReject(worker, reject, new Error(
        `Exact breadcrumb-dot query worker timed out after ${timeoutMs} ms.`,
      ))
    }, timeoutMs)

    worker.once('message', (message) => {
      if (settled) return
      if (isCompleteMessage(message)) {
        completedResult = {
          positions: message.positions,
          totalPositionCount: message.totalPositionCount,
          pagePositionCount: message.pagePositionCount,
          fromTimestamp: message.fromTimestamp,
          toTimestamp: message.toTimestamp,
          hasEarlier: message.hasEarlier,
          hasLater: message.hasLater,
          earlierCursor: message.earlierCursor,
          laterCursor: message.laterCursor,
          workerThreadId: message.workerThreadId,
        }
        return
      }
      settled = true
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', handleAbort)
      terminateThenReject(worker, reject, createWorkerError(message))
    })
    worker.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', handleAbort)
      terminateThenReject(worker, reject, new Error(
        `Exact breadcrumb-dot query worker failed: ${safeWorkerErrorMessage(error.message)}`,
      ))
    })
    worker.once('exit', (exitCode) => {
      if (settled) return
      if (exitCode === 0 && completedResult !== null) {
        settled = true
        clearTimeout(timeout)
        input.signal?.removeEventListener('abort', handleAbort)
        resolve(completedResult)
        return
      }
      settled = true
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', handleAbort)
      reject(new Error(
        `Exact breadcrumb-dot query worker failed: exited with code ${exitCode}.`,
      ))
    })
  })
}

function terminateThenReject(worker, reject, error) {
  let termination
  try {
    termination = worker.terminate()
  } catch {
    reject(error)
    return
  }
  void Promise.resolve(termination).then(
    () => reject(error),
    () => reject(error),
  )
}

function isCompleteMessage(message) {
  return (
    message?.type === 'complete' &&
    Number.isInteger(message.workerThreadId) &&
    Array.isArray(message.positions) &&
    Number.isInteger(message.totalPositionCount) &&
    message.totalPositionCount >= 0 &&
    Number.isInteger(message.pagePositionCount) &&
    message.pagePositionCount === message.positions.length &&
    (message.fromTimestamp === null || typeof message.fromTimestamp === 'string') &&
    (message.toTimestamp === null || typeof message.toTimestamp === 'string') &&
    typeof message.hasEarlier === 'boolean' &&
    typeof message.hasLater === 'boolean' &&
    (message.earlierCursor === null || typeof message.earlierCursor === 'string') &&
    (message.laterCursor === null || typeof message.laterCursor === 'string')
  )
}

function createAbortError() {
  const error = new Error('Exact breadcrumb-dot query worker was cancelled.')
  error.name = 'AbortError'
  return error
}

function normalizeWorkerTimeoutMs(value) {
  if (value === undefined) {
    return DEFAULT_WORKER_TIMEOUT_MS
  }
  if (!Number.isFinite(value) || value < 1 || value > 300_000) {
    throw new Error('Exact breadcrumb-dot worker timeout must be between 1 and 300000 ms.')
  }
  return Math.floor(value)
}

function createWorkerError(message) {
  const error = new Error(
    `Exact breadcrumb-dot query worker failed: ${safeWorkerErrorMessage(message?.message)}`,
  )
  error.name = safeWorkerErrorName(message?.name)
  return error
}

function safeWorkerErrorMessage(input) {
  const value = String(input ?? 'unknown error').replace(/[\r\n]+/gu, ' ').trim()
  return value.slice(0, 500) || 'unknown error'
}

function safeWorkerErrorName(input) {
  const value = String(input ?? '')
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(value) ? value : 'Error'
}

module.exports = {
  runBreadcrumbDotQueryInWorker,
}
