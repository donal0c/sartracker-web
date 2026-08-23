const path = require('node:path')
const { Worker } = require('node:worker_threads')
const { normalizeOutingFixSummaryInput } = require('./outing-fix-summary-query.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'outing-fix-summary-worker.cjs')
const DEFAULT_TIMEOUT_MS = 30_000

/** Runs one exact outing summary outside Electron's main isolate. */
function runOutingFixSummaryInWorker(input) {
  normalizeOutingFixSummaryInput(input.query)
  if (input.signal?.aborted === true) return Promise.reject(createAbortError())
  let resolveWorkerExit
  const workerExited = new Promise((resolve) => { resolveWorkerExit = resolve })
  const result = new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(input.workerPath ?? DEFAULT_WORKER_PATH, {
        workerData: { databasePath: input.databasePath, query: input.query },
      })
    } catch (error) {
      resolveWorkerExit()
      reject(new Error(`Outing fix-summary worker failed to start: ${safeMessage(error?.message)}`))
      return
    }
    let settled = false
    let completedResult = null
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
    const timeout = setTimeout(
      () => rejectAndTerminate(new Error(`Outing fix-summary worker timed out after ${DEFAULT_TIMEOUT_MS} ms.`)),
      DEFAULT_TIMEOUT_MS,
    )
    worker.once('message', (message) => {
      if (settled) return
      if (isCompleteMessage(message)) {
        completedResult = {
          outings: message.outings,
          unassigned_accepted_fix_count: message.unassigned_accepted_fix_count,
          total_accepted_fix_count: message.total_accepted_fix_count,
          workerThreadId: message.workerThreadId,
        }
        return
      }
      rejectAndTerminate(new Error(`Outing fix-summary worker failed: ${safeMessage(message?.message)}`))
    })
    worker.once('error', (error) => rejectAndTerminate(
      new Error(`Outing fix-summary worker failed: ${safeMessage(error.message)}`),
    ))
    worker.once('exit', (exitCode) => {
      resolveWorkerExit()
      if (settled) return
      settled = true
      cleanup()
      if (exitCode === 0 && completedResult !== null) return resolve(completedResult)
      reject(new Error(`Outing fix-summary worker failed: exited with code ${exitCode}.`))
    })
  })
  Object.defineProperty(result, 'workerExited', { value: workerExited })
  return result
}

/** Validates the bounded result payload before it crosses into the renderer. */
function isCompleteMessage(message) {
  return message?.type === 'complete' &&
    Number.isInteger(message.workerThreadId) && message.workerThreadId > 0 &&
    Array.isArray(message.outings) && message.outings.length <= 10_000 &&
    message.outings.every((outing) =>
      typeof outing?.outing_id === 'string' &&
      Number.isSafeInteger(outing.accepted_fix_count) &&
      outing.accepted_fix_count >= 0) &&
    Number.isSafeInteger(message.unassigned_accepted_fix_count) &&
    message.unassigned_accepted_fix_count >= 0 &&
    Number.isSafeInteger(message.total_accepted_fix_count) &&
    message.total_accepted_fix_count >= 0
}

/** Creates the stable renderer-facing cancellation error. */
function createAbortError() {
  const error = new Error('Outing fix-summary worker was cancelled.')
  error.name = 'AbortError'
  return error
}

/** Bounds worker error text before surfacing it. */
function safeMessage(value) {
  return String(value ?? 'unknown error').replace(/[\r\n]+/gu, ' ').trim().slice(0, 500)
}

module.exports = { runOutingFixSummaryInWorker }
