const path = require('node:path')
const { Worker } = require('node:worker_threads')
const { normalizeReplayWorkerQuery } = require('./mission-replay-query.cjs')
const { assertReplayResultBounded } = require('./mission-replay-message-policy.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'mission-replay-worker.cjs')

/** Runs one cancellable replay read and terminates obsolete work promptly. */
function runMissionReplayInWorker(input) {
  const normalizedQuery = normalizeReplayWorkerQuery(input.query, input.kind)
  if (input.signal?.aborted === true) return Promise.reject(createAbortError())
  let resolveWorkerExit
  const workerExited = new Promise((resolve) => { resolveWorkerExit = resolve })
  const result = new Promise((resolve, reject) => {
    let worker
    try {
      const workerOptions = {
        workerData: { databasePath: input.databasePath, query: normalizedQuery, kind: input.kind },
      }
      worker = input.createWorker?.(workerOptions)
        ?? new Worker(input.workerPath ?? DEFAULT_WORKER_PATH, workerOptions)
    } catch (error) {
      resolveWorkerExit()
      reject(error)
      return
    }
    let settled = false
    let completed = null
    const timeout = setTimeout(() => rejectAndTerminate(new Error('Mission replay worker timed out.')), 30_000)
    const cleanup = () => {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', handleAbort)
    }
    const rejectAndTerminate = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
      void worker.terminate().catch(() => undefined)
    }
    const handleAbort = () => rejectAndTerminate(createAbortError())
    input.signal?.addEventListener('abort', handleAbort, { once: true })
    worker.once('message', (message) => {
      if (settled) return
      const validationError = validateBoundedReplayMessage(message, normalizedQuery.trackLimit)
      if (validationError === null) {
        completed = message.result
      } else {
        rejectAndTerminate(new Error(`Mission replay worker failed: ${safeMessage(validationError)}`))
      }
    })
    worker.once('error', (error) => rejectAndTerminate(
      new Error(`Mission replay worker failed: ${safeMessage(error.message)}`),
    ))
    worker.once('exit', (code) => {
      resolveWorkerExit()
      if (settled) return
      settled = true
      cleanup()
      if (code === 0 && completed !== null) resolve(completed)
      else reject(new Error(`Mission replay worker failed: exited with code ${code}.`))
    })
  })
  Object.defineProperty(result, 'workerExited', { value: workerExited })
  return result
}

function validateBoundedReplayMessage(message, trackLimit) {
  if (message?.type !== 'complete' || !Number.isInteger(message.workerThreadId)) {
    return message?.message ?? 'invalid worker response'
  }
  try {
    assertReplayResultBounded(message.result, trackLimit)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'invalid bounded worker result'
  }
}

function createAbortError() {
  const error = new Error('Mission replay worker was cancelled.')
  error.name = 'AbortError'
  return error
}

function safeMessage(value) {
  return String(value ?? 'unknown error').replace(/[\r\n]+/gu, ' ').trim().slice(0, 500)
}

module.exports = { runMissionReplayInWorker }
