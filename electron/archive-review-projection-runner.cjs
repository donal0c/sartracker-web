'use strict'

const path = require('node:path')
const { Worker } = require('node:worker_threads')

const {
  normalizeArchiveReviewProjectionRequest,
  normalizeArchiveReviewProjectionResult,
} = require('./archive-review-projection-query.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'archive-review-projection-worker.cjs')
const DEFAULT_TIMEOUT_MS = 30_000

/** Creates one stable non-reflective projection worker failure. */
function createFailure(message = 'Archive review projection worker returned invalid terminal output.') {
  const error = new Error(message)
  error.code = 'ARCHIVE_REVIEW_PROJECTION_FAILED'
  return error
}

/** Creates one stable cancellation result. */
function createAbortError() {
  const error = new Error('Archive review projection worker was cancelled.')
  error.name = 'AbortError'
  error.code = 'ARCHIVE_REVIEW_PROJECTION_CANCELLED'
  return error
}

/** Requires the external runner call to contain only declared control fields. */
function normalizeRunnerInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw createFailure('Archive review projection request is invalid.')
  }
  const logicalKeys = input.method === 'listGpxImportPage'
    ? ['databasePath', 'method', 'query']
    : ['databasePath', 'method', 'missionId']
  const optionalKeys = ['signal', 'workerPath', 'createWorker', 'timeoutMs']
  const allowed = new Set([...logicalKeys, ...optionalKeys])
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw createFailure('Archive review projection request is invalid.')
  }
  const request = normalizeArchiveReviewProjectionRequest(Object.fromEntries(
    logicalKeys.map((key) => [key, input[key]]),
  ))
  if (input.signal !== undefined
    && (typeof input.signal?.addEventListener !== 'function'
      || typeof input.signal?.removeEventListener !== 'function')) {
    throw createFailure('Archive review projection request signal is invalid.')
  }
  if (input.createWorker !== undefined && typeof input.createWorker !== 'function') {
    throw createFailure('Archive review projection request worker factory is invalid.')
  }
  const workerPath = input.workerPath ?? DEFAULT_WORKER_PATH
  if (typeof workerPath !== 'string'
    || !path.isAbsolute(workerPath)
    || path.resolve(workerPath) !== workerPath
    || Buffer.byteLength(workerPath, 'utf8') > 8_192) {
    throw createFailure('Archive review projection worker path is invalid.')
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw createFailure('Archive review projection worker timeout is invalid.')
  }
  return Object.freeze({
    request,
    signal: input.signal,
    createWorker: input.createWorker,
    workerPath,
    timeoutMs: Math.floor(timeoutMs),
  })
}

/** Shape-closes the single successful worker message. */
function normalizeTerminalMessage(message, request) {
  if (message === null || typeof message !== 'object' || Array.isArray(message)
    || Object.keys(message).sort().join(',') !== 'method,result,type'
    || message.type !== 'complete'
    || message.method !== request.method) {
    throw createFailure()
  }
  try {
    return normalizeArchiveReviewProjectionResult(request, message.result)
  } catch {
    throw createFailure()
  }
}

/** Runs one bounded archive-review projection outside Electron's main isolate. */
function runArchiveReviewProjectionInWorker(input) {
  const normalized = normalizeRunnerInput(input)
  const workerExited = createDeferred()
  if (normalized.signal?.aborted === true) {
    const rejected = Promise.reject(createAbortError())
    void rejected.catch(() => undefined)
    workerExited.resolve()
    return decorate(rejected, workerExited.promise)
  }
  let worker
  const completion = new Promise((resolve, reject) => {
    const workerInput = Object.freeze({
      workerPath: normalized.workerPath,
      workerData: normalized.request,
    })
    try {
      worker = normalized.createWorker?.(workerInput)
        ?? new Worker(workerInput.workerPath, { workerData: workerInput.workerData })
    } catch {
      workerExited.resolve()
      reject(createFailure('Archive review projection worker could not start.'))
      return
    }
    let settled = false
    let terminal = null
    let terminalMessageCount = 0
    let timeout

    /** Clears controls only after the worker reaches physical exit. */
    const cleanup = () => {
      if (timeout !== undefined) clearTimeout(timeout)
      normalized.signal?.removeEventListener('abort', handleAbort)
    }

    /** Rejects once and requests physical termination without reflecting worker data. */
    const rejectAndTerminate = (error) => {
      if (settled) return
      settled = true
      if (timeout !== undefined) clearTimeout(timeout)
      normalized.signal?.removeEventListener('abort', handleAbort)
      try { worker.postMessage({ type: 'cancel' }) } catch {}
      try { void Promise.resolve(worker.terminate()).catch(() => undefined) } catch {}
      reject(error)
    }

    const handleAbort = () => rejectAndTerminate(createAbortError())
    normalized.signal?.addEventListener('abort', handleAbort, { once: true })
    timeout = setTimeout(() => rejectAndTerminate(createFailure(
      'Archive review projection worker timed out.',
    )), normalized.timeoutMs)
    if (normalized.signal?.aborted === true) handleAbort()

    worker.on('message', (message) => {
      if (settled) return
      terminalMessageCount += 1
      if (terminalMessageCount !== 1) {
        rejectAndTerminate(createFailure(
          'Archive review projection worker returned duplicate terminal output.',
        ))
        return
      }
      try {
        terminal = normalizeTerminalMessage(message, normalized.request)
      } catch {
        rejectAndTerminate(createFailure())
      }
    })
    worker.once('error', () => rejectAndTerminate(createFailure(
      'Archive review projection worker failed safely.',
    )))
    worker.once('exit', (code) => {
      workerExited.resolve()
      cleanup()
      if (settled) return
      settled = true
      if (code === 0 && terminal !== null) resolve(terminal)
      else reject(createFailure('Archive review projection worker exited without a valid result.'))
    })
  })
  return decorate(completion, workerExited.promise)
}

/** Creates one externally-resolvable lifecycle promise. */
function createDeferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

/** Decorates public completion with physical worker-exit ownership. */
function decorate(completion, workerExited) {
  Object.defineProperty(completion, 'workerExited', { value: workerExited })
  return completion
}

module.exports = {
  runArchiveReviewProjectionInWorker,
}
