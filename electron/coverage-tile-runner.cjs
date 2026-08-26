const path = require('node:path')
const { Worker } = require('node:worker_threads')
const {
  normalizeCoverageCatalogInput,
  normalizeCoverageCatalogWorkerResult,
} = require('./coverage-worker-envelope.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'coverage-tile-worker.cjs')
const DEFAULT_TIMEOUT_MS = 30_000

/** Owns the single long-lived Candidate-B worker and its bounded request map. */
function createCoverageTileRunner(input) {
  let worker = null
  let nextRequestId = 0
  const pending = new Map()
  const expectedTerminations = new WeakSet()
  let closing = false

  const ensureWorker = () => {
    if (worker !== null) return worker
    if (closing) throw new Error('Coverage tile runner is closed.')
    const workerOptions = {
      workerData: {
        databasePath: input.databasePath,
        cacheDirectory: input.cacheDirectory,
        faultInjection: input.faultInjection ?? null,
      },
    }
    const created = input.createWorker?.(
      input.workerPath ?? DEFAULT_WORKER_PATH,
      workerOptions,
    ) ?? new Worker(input.workerPath ?? DEFAULT_WORKER_PATH, workerOptions)
    created.on('message', (message) => settleRequest(created, message))
    created.on('error', (error) => {
      const failure = new Error(`Coverage tile worker failed: ${safeMessage(error.message)}`)
      const expected = expectedTerminations.has(created)
      failWorker(created, failure)
      if (!expected) input.onFailure?.(failure)
    })
    created.on('exit', (exitCode) => {
      if (worker === created) worker = null
      const expected = expectedTerminations.has(created)
      expectedTerminations.delete(created)
      if (!closing && !expected) {
        const failure = exitCode === 0
          ? new Error('Coverage tile worker exited unexpectedly.')
          : new Error(`Coverage tile worker exited with code ${exitCode}.`)
        failPending(failure, created)
        input.onFailure?.(failure)
      }
    })
    worker = created
    return created
  }

  const request = (type, payload, options = {}) => {
    const normalizedPayload = type === 'sync-catalog'
      ? normalizeCoverageCatalogInput(payload)
      : payload
    const activeWorker = ensureWorker()
    const requestId = ++nextRequestId
    const timeoutMs = options.timeoutMs ?? input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const failure = new Error(`Coverage tile worker timed out after ${timeoutMs} ms.`)
        pending.delete(requestId)
        reject(failure)
        failPending(failure, activeWorker)
        input.onFailure?.(failure)
        void terminateWorker(activeWorker)
      }, timeoutMs)
      const abort = () => {
        pending.delete(requestId)
        clearTimeout(timeout)
        const error = new Error('Coverage tile request was cancelled.')
        error.name = 'AbortError'
        reject(error)
        activeWorker.postMessage({
          type: 'cancel-request',
          targetRequestId: requestId,
        })
      }
      pending.set(requestId, {
        resolve,
        reject,
        worker: activeWorker,
        cleanup: () => {
          clearTimeout(timeout)
          options.signal?.removeEventListener('abort', abort)
        },
        normalizeResult: type === 'sync-catalog'
          ? (result) => normalizeCoverageCatalogWorkerResult(normalizedPayload, result)
          : (result) => result,
      })
      if (options.signal?.aborted === true) {
        abort()
        return
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      activeWorker.postMessage({ ...normalizedPayload, requestId, type })
    })
  }

  const settleRequest = (owningWorker, message) => {
    const active = pending.get(message?.requestId)
    if (active === undefined || active.worker !== owningWorker) return
    pending.delete(message.requestId)
    active.cleanup()
    if (typeof message.error === 'string') {
      const error = new Error(`Coverage tile worker failed: ${safeMessage(message.error)}`)
      if (typeof message.code === 'string') error.code = message.code
      active.reject(error)
    } else {
      try {
        active.resolve(active.normalizeResult(message.result))
      } catch (error) {
        active.reject(error)
        failWorker(owningWorker, error)
        input.onFailure?.(error)
      }
    }
  }

  const failPending = (error, owningWorker = null) => {
    for (const [requestId, active] of pending.entries()) {
      if (owningWorker !== null && active.worker !== owningWorker) continue
      active.cleanup()
      active.reject(error)
      pending.delete(requestId)
    }
  }

  const failWorker = (owningWorker, error) => {
    failPending(error, owningWorker)
    void terminateWorker(owningWorker)
  }

  const terminateWorker = async (target = worker) => {
    const active = target
    if (worker === active) worker = null
    if (active !== null) {
      expectedTerminations.add(active)
      await active.terminate().catch(() => undefined)
    }
  }

  return {
    syncCatalog: (payload, options) => request('sync-catalog', payload, options),
    commitCatalog: (payload, options) => request('commit-catalog', payload, options),
    finalizeCatalog: (payload, options) => request('finalize-catalog', payload, options),
    discardCatalog: (payload, options) => request('discard-catalog', payload, options),
    readTile: (payload, options) => request('read-tile', payload, options),
    invalidateWorker: async (error) => {
      const activeWorker = worker
      if (activeWorker === null) return
      failPending(error, activeWorker)
      input.onFailure?.(error)
      await terminateWorker(activeWorker)
    },
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
