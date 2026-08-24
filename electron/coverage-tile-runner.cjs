const path = require('node:path')
const { Worker } = require('node:worker_threads')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'coverage-tile-worker.cjs')
const DEFAULT_TIMEOUT_MS = 30_000

/** Owns the single long-lived Candidate-B worker and its bounded request map. */
function createCoverageTileRunner(input) {
  let worker = null
  let nextRequestId = 0
  const pending = new Map()
  let closing = false

  const ensureWorker = () => {
    if (worker !== null) return worker
    if (closing) throw new Error('Coverage tile runner is closed.')
    const created = new Worker(input.workerPath ?? DEFAULT_WORKER_PATH, {
      workerData: {
        databasePath: input.databasePath,
        cacheDirectory: input.cacheDirectory,
      },
    })
    created.on('message', (message) => settleRequest(message))
    created.on('error', (error) => failWorker(
      new Error(`Coverage tile worker failed: ${safeMessage(error.message)}`),
    ))
    created.on('exit', (exitCode) => {
      if (worker === created) worker = null
      if (!closing && exitCode !== 0) {
        failPending(new Error(`Coverage tile worker exited with code ${exitCode}.`))
      }
    })
    worker = created
    return created
  }

  const request = (type, payload, options = {}) => {
    const activeWorker = ensureWorker()
    const requestId = ++nextRequestId
    const timeoutMs = options.timeoutMs ?? input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`Coverage tile worker timed out after ${timeoutMs} ms.`))
        void terminateWorker()
      }, timeoutMs)
      const abort = () => {
        pending.delete(requestId)
        clearTimeout(timeout)
        const error = new Error('Coverage tile request was cancelled.')
        error.name = 'AbortError'
        reject(error)
        void terminateWorker()
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      pending.set(requestId, {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timeout)
          options.signal?.removeEventListener('abort', abort)
        },
      })
      activeWorker.postMessage({ requestId, type, ...payload })
    })
  }

  const settleRequest = (message) => {
    const active = pending.get(message?.requestId)
    if (active === undefined) return
    pending.delete(message.requestId)
    active.cleanup()
    if (typeof message.error === 'string') {
      const error = new Error(`Coverage tile worker failed: ${safeMessage(message.error)}`)
      if (typeof message.code === 'string') error.code = message.code
      active.reject(error)
    } else {
      active.resolve(message.result)
    }
  }

  const failPending = (error) => {
    for (const active of pending.values()) {
      active.cleanup()
      active.reject(error)
    }
    pending.clear()
  }

  const failWorker = (error) => {
    failPending(error)
    void terminateWorker()
  }

  const terminateWorker = async () => {
    const active = worker
    worker = null
    if (active !== null) await active.terminate().catch(() => undefined)
  }

  return {
    syncCatalog: (payload, options) => request('sync-catalog', payload, options),
    readTile: (payload, options) => request('read-tile', payload, options),
    close: async () => {
      closing = true
      failPending(new Error('Coverage tile runner closed.'))
      await terminateWorker()
    },
  }
}

function safeMessage(value) {
  return String(value ?? 'unknown error').replace(/[\r\n]+/gu, ' ').trim().slice(0, 500)
}

module.exports = { createCoverageTileRunner }
