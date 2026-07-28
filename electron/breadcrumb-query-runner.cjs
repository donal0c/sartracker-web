const path = require('node:path')
const { Worker } = require('node:worker_threads')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'breadcrumb-query-worker.cjs')
const DEFAULT_WORKER_TIMEOUT_MS = 30_000

/** Runs deterministic restart hydration outside the Electron main isolate. */
function runBreadcrumbQueryInWorker(input) {
  return new Promise((resolve, reject) => {
    const timeoutMs = normalizeWorkerTimeoutMs(input.timeoutMs)
    const worker = new Worker(input.workerPath ?? DEFAULT_WORKER_PATH, {
      workerData: {
        databasePath: input.databasePath,
        missionId: input.missionId,
        perDeviceLimit: input.perDeviceLimit,
      },
    })
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate()
      reject(
        new Error(
          `Breadcrumb query worker timed out after ${timeoutMs} ms.`,
        ),
      )
    }, timeoutMs)

    worker.once('message', (message) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (
        message?.type === 'complete' &&
        Number.isInteger(message.workerThreadId) &&
        Array.isArray(message.positions) &&
        Array.isArray(message.deviceTotals) &&
        Number.isInteger(message.droppedPositionCount) &&
        message.droppedPositionCount >= 0
      ) {
        resolve({
          positions: message.positions,
          deviceTotals: message.deviceTotals,
          droppedPositionCount: message.droppedPositionCount,
          workerThreadId: message.workerThreadId,
        })
        return
      }
      reject(createWorkerError(message))
    })
    worker.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(
        new Error(
          `Breadcrumb query worker failed: ${safeWorkerErrorMessage(error.message)}`,
        ),
      )
    })
    worker.once('exit', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(
        new Error(`Breadcrumb query worker failed: exited with code ${exitCode}.`),
      )
    })
  })
}

function normalizeWorkerTimeoutMs(value) {
  if (value === undefined) {
    return DEFAULT_WORKER_TIMEOUT_MS
  }
  if (!Number.isFinite(value) || value < 1 || value > 300_000) {
    throw new Error('Breadcrumb query worker timeout must be between 1 and 300000 ms.')
  }
  return Math.floor(value)
}

function createWorkerError(message) {
  const error = new Error(
    `Breadcrumb query worker failed: ${safeWorkerErrorMessage(message?.message)}`,
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
  runBreadcrumbQueryInWorker,
}
