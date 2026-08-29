const path = require('node:path')
const { Worker } = require('node:worker_threads')
const {
  assertSearchOperationPageResult,
  normalizeSearchOperationPageQuery,
} = require('./search-operations-page-query.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'search-operations-page-worker.cjs')

/** Runs one bounded Search Operations page read outside Electron's main isolate. */
function runSearchOperationPageInWorker(input) {
  const query = normalizeSearchOperationPageQuery(input.query)
  const workerExited = createDeferred()
  const result = new Promise((resolve, reject) => {
    let worker
    try {
      worker = input.createWorker?.({ workerData: { databasePath: input.databasePath, query } })
        ?? new Worker(input.workerPath ?? DEFAULT_WORKER_PATH, {
          workerData: { databasePath: input.databasePath, query },
        })
    } catch (error) {
      workerExited.resolve()
      reject(error)
      return
    }
    let settled = false
    let completed = null
    const timeout = setTimeout(() => rejectAndTerminate(
      new Error('Search Operations page worker timed out.'),
    ), 30_000)
    const cleanup = () => clearTimeout(timeout)
    const rejectAndTerminate = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
      void worker.terminate().catch(() => undefined)
    }
    worker.once('message', (message) => {
      if (message?.type !== 'complete' || !Number.isInteger(message.workerThreadId)) {
        rejectAndTerminate(new Error(
          `Search Operations page worker failed: ${safeMessage(message?.message)}`,
        ))
        return
      }
      try {
        assertSearchOperationPageResult(message.result, query.limit)
        completed = message.result
      } catch (error) {
        rejectAndTerminate(error)
      }
    })
    worker.once('error', (error) => rejectAndTerminate(new Error(
      `Search Operations page worker failed: ${safeMessage(error.message)}`,
    )))
    worker.once('exit', (code) => {
      workerExited.resolve()
      if (settled) return
      settled = true
      cleanup()
      if (code === 0 && completed !== null) resolve(completed)
      else reject(new Error(`Search Operations page worker failed: exited with code ${code}.`))
    })
  })
  Object.defineProperty(result, 'workerExited', { value: workerExited.promise })
  return result
}

/** Creates a small externally-resolvable lifecycle promise. */
function createDeferred() {
  let resolve = () => undefined
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

/** Removes multiline or oversized worker error detail. */
function safeMessage(value) {
  return String(value ?? 'invalid response').replace(/[\r\n]+/gu, ' ').trim().slice(0, 500)
}

module.exports = { runSearchOperationPageInWorker }
