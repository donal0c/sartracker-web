const path = require('node:path')
const { Worker } = require('node:worker_threads')
const {
  normalizeCoverageMissionId,
  normalizeCoverageChunkKey,
  normalizeCoverageSelectedKeys,
} = require('./coverage-worker-envelope.cjs')
const {
  normalizeCoverageWorkerResult,
} = require('./coverage-query-result-envelope.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'coverage-query-worker.cjs')
const DEFAULT_TIMEOUT_MS = 30_000

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
        workerData: {
          databasePath: input.databasePath,
          query,
          resultLimits: input.resultLimits,
        },
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
          completedResult = normalizeCoverageWorkerResult(
            query,
            message.result,
            input.resultLimits,
          )
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
  if (query.kind === 'chunk-page' || query.kind === 'chunk-summary') {
    const key = normalizeCoverageChunkKey(query.key)
    if (!Number.isSafeInteger(query.expectedContentRev) || query.expectedContentRev < 1) {
      throw new Error('Coverage chunk revision is invalid.')
    }
    return {
      kind: query.kind,
      missionId: normalizeCoverageMissionId(query.missionId),
      key,
      expectedContentRev: query.expectedContentRev,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    }
  }
  if (query.kind === 'enumerate' || query.kind === 'manifest') {
    return { kind: query.kind, missionId: normalizeCoverageMissionId(query.missionId) }
  }
  return { kind: 'invalidation-analysis', invalidationId: query.invalidationId }
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
