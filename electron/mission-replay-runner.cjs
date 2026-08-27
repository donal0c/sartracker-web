const path = require('node:path')
const { Worker } = require('node:worker_threads')
const { normalizeReplayInput } = require('./mission-replay-query.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'mission-replay-worker.cjs')

/** Runs one cancellable replay read and terminates obsolete work promptly. */
function runMissionReplayInWorker(input) {
  normalizeReplayInput(input.query)
  if (input.signal?.aborted === true) return Promise.reject(createAbortError())
  let resolveWorkerExit
  const workerExited = new Promise((resolve) => { resolveWorkerExit = resolve })
  const result = new Promise((resolve, reject) => {
    const worker = input.createWorker?.() ?? new Worker(input.workerPath ?? DEFAULT_WORKER_PATH, {
      workerData: { databasePath: input.databasePath, query: input.query, kind: input.kind },
    })
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
      if (isBoundedReplayMessage(message, input.query.trackLimit)) {
        completed = message.result
      } else {
        rejectAndTerminate(new Error(`Mission replay worker failed: ${safeMessage(message?.message)}`))
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

function isBoundedReplayMessage(message, trackLimit) {
  return message?.type === 'complete'
    && Number.isInteger(message.workerThreadId)
    && Array.isArray(message.result?.tracks)
    && message.result.tracks.length <= trackLimit
    && (!Array.isArray(message.result.objects) || message.result.objects.length <= 10_000)
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
