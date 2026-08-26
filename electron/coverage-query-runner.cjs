const path = require('node:path')
const { Worker } = require('node:worker_threads')
const {
  normalizeCoverageMissionId,
  normalizeCoverageSelectedKeys,
} = require('./coverage-worker-envelope.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'coverage-query-worker.cjs')
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_INVALIDATION_RESULT_KEYS = 100_000

/** Runs one read-only coverage query outside the Electron main isolate. */
function runCoverageQueryInWorker(input) {
  const query = validateCoverageWorkerQuery(input.query)
  if (input.signal?.aborted === true) return Promise.reject(createAbortError())
  const timeoutMs = normalizeTimeout(input.timeoutMs)
  let resolveWorkerExit
  const workerExited = new Promise((resolve) => { resolveWorkerExit = resolve })
  const result = new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(input.workerPath ?? DEFAULT_WORKER_PATH, {
        workerData: { databasePath: input.databasePath, query },
      })
    } catch (error) {
      resolveWorkerExit()
      reject(new Error(`Coverage query worker failed to start: ${safeMessage(error?.message)}`))
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
    const timeout = setTimeout(() => rejectAndTerminate(
      new Error(`Coverage query worker timed out after ${timeoutMs} ms.`),
    ), timeoutMs)
    worker.once('message', (message) => {
      if (settled) return
      if (message?.type === 'complete' && isPlainRecord(message.result)) {
        try {
          completedResult = normalizeCoverageWorkerResult(query, message.result)
        } catch (error) {
          rejectAndTerminate(error)
        }
        return
      }
      const error = new Error(
        `Coverage query worker failed: ${safeMessage(message?.message)}`,
      )
      if (typeof message?.code === 'string') error.code = message.code
      rejectAndTerminate(error)
    })
    worker.once('error', (error) => rejectAndTerminate(
      new Error(`Coverage query worker failed: ${safeMessage(error.message)}`),
    ))
    worker.once('exit', (exitCode) => {
      resolveWorkerExit()
      if (settled) return
      settled = true
      cleanup()
      if (exitCode === 0 && completedResult !== null) return resolve(completedResult)
      reject(new Error(`Coverage query worker failed: exited with code ${exitCode}.`))
    })
  })
  Object.defineProperty(result, 'workerExited', { value: workerExited })
  return result
}

/** Validates and copies the result envelope for the requested query kind. */
function normalizeCoverageWorkerResult(query, result) {
  if (query.kind !== 'invalidation-analysis') return result
  if (result.invalidationId !== query.invalidationId) {
    throw new Error('Coverage invalidation result identity does not match its request.')
  }
  if (
    !Array.isArray(result.affectedKeys) ||
    result.affectedKeys.length > MAX_INVALIDATION_RESULT_KEYS
  ) {
    throw new Error('Coverage invalidation result key list is invalid.')
  }
  const seen = new Set()
  const affectedKeys = result.affectedKeys.map((key) => {
    if (!isPlainRecord(key) || !isBoundedIdentifier(key.mission_id, 200)) {
      throw new Error('Coverage invalidation result key identity is invalid.')
    }
    if (!isBoundedIdentifier(key.device_id, 200)) {
      throw new Error('Coverage invalidation result device identity is invalid.')
    }
    const outing = key.period_kind === 'outing' &&
      isBoundedIdentifier(key.period_id, 200)
    const unassigned = key.period_kind === 'unassigned' && key.period_id === ''
    if (!outing && !unassigned) {
      throw new Error('Coverage invalidation result period identity is invalid.')
    }
    const normalized = {
      mission_id: key.mission_id,
      device_id: key.device_id,
      period_kind: key.period_kind,
      period_id: key.period_id,
    }
    const identity = [
      normalized.mission_id,
      normalized.device_id,
      normalized.period_kind,
      normalized.period_id,
    ].join('\u0000')
    if (seen.has(identity)) {
      throw new Error('Coverage invalidation result contains duplicate keys.')
    }
    seen.add(identity)
    return normalized
  })
  return { invalidationId: query.invalidationId, affectedKeys }
}

/** Validates the bounded outer query envelope before a worker starts. */
function validateCoverageWorkerQuery(query) {
  if (![
    'enumerate',
    'manifest',
    'claim',
    'chunk-page',
    'chunk-summary',
    'invalidation-analysis',
  ].includes(query?.kind)) {
    throw new Error('Coverage query kind is invalid.')
  }
  if (query.kind !== 'invalidation-analysis' && !isBoundedIdentifier(query.missionId, 200)) {
    throw new Error('Coverage query mission ID is invalid.')
  }
  if (query.kind === 'invalidation-analysis' && !isBoundedIdentifier(query.invalidationId, 200)) {
    throw new Error('Coverage invalidation ID is invalid.')
  }
  if (query.kind === 'claim') {
    return {
      kind: 'claim',
      missionId: normalizeCoverageMissionId(query.missionId),
      selectedKeys: normalizeCoverageSelectedKeys(query.selectedKeys),
    }
  }
  return query
}

/** Normalizes the deterministic timeout seam used by tests and production. */
function normalizeTimeout(value) {
  if (value === undefined) return DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(value) || value < 1 || value > 120_000) {
    throw new Error('Coverage query timeout is invalid.')
  }
  return value
}

/** Creates the stable renderer-facing cancellation error. */
function createAbortError() {
  const error = new Error('Coverage query worker was cancelled.')
  error.name = 'AbortError'
  return error
}

/** Bounds worker error text before surfacing it to an operator path. */
function safeMessage(value) {
  return String(value ?? 'unknown error').replace(/[\r\n]+/gu, ' ').trim().slice(0, 500)
}

/** Returns whether a worker result is one structured-clone record. */
function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Validates one opaque database identity without interpreting it. */
function isBoundedIdentifier(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

module.exports = {
  runCoverageQueryInWorker,
}
