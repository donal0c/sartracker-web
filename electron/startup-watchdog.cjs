const { performance } = require('node:perf_hooks')

const STARTUP_RESPONSE_TIMEOUT_MS = 10_000

/** A pre-window startup step exceeded the shared response deadline. */
class StartupTimeoutError extends Error {
  /** Creates a timeout with the pending startup stage and its measured budget. */
  constructor(stage, timeoutMs, elapsedMs) {
    super(`The ${timeoutMs} ms startup deadline after Electron readiness expired while "${stage}" was pending.`)
    this.name = 'StartupTimeoutError'
    this.stage = stage
    this.timeoutMs = timeoutMs
    this.elapsedMs = elapsedMs
  }
}

/** Creates one monotonic deadline shared by every awaited pre-window startup step. */
function createStartupWatchdog(options) {
  if (!Number.isFinite(options?.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('Startup watchdog timeout must be a positive number.')
  }
  const now = typeof options.now === 'function' ? options.now : () => performance.now()
  const startedAt = now()
  const activeStages = new Set()
  let timeoutHandle
  let disposed = false
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(createTimeoutError())
    }, options.timeoutMs)
  })
  // Each active stage attaches the deadline to a race. This handler also keeps
  // the single deadline rejection handled if startup fails before its first wait.
  void timeoutPromise.catch(() => undefined)

  return Object.freeze({
    run,
    runParallel,
    dispose,
  })

  /** Runs one stage against the shared deadline without resetting its clock. */
  function run(stage, operation) {
    return runParallel([{ stage, operation }]).then(([value]) => value)
  }

  /** Runs independent startup stages together and reports every stage still pending at expiry. */
  function runParallel(stages) {
    if (disposed) return Promise.reject(new Error('Startup watchdog is already complete.'))
    if (
      !Array.isArray(stages)
      || stages.length === 0
      || stages.some((entry) =>
        typeof entry !== 'object'
        || entry === null
        || typeof entry.stage !== 'string'
        || entry.stage.trim() === ''
        || typeof entry.operation !== 'function')
    ) {
      return Promise.reject(new Error('Startup watchdog requires a named stage and operation.'))
    }
    const elapsedMs = Math.max(0, now() - startedAt)
    if (elapsedMs >= options.timeoutMs) {
      return Promise.reject(createTimeoutError(stages.map(({ stage }) => stage)))
    }
    const tasks = stages.map(({ stage, operation }) => {
      activeStages.add(stage)
      return Promise.resolve().then(operation).then(
        (value) => {
          if (Math.max(0, now() - startedAt) >= options.timeoutMs) {
            throw createTimeoutError(stage)
          }
          return value
        },
        (error) => {
          if (Math.max(0, now() - startedAt) >= options.timeoutMs) {
            throw createTimeoutError(stage)
          }
          throw error
        },
      ).finally(() => activeStages.delete(stage))
    })
    return Promise.race([Promise.all(tasks), timeoutPromise])
  }

  /** Releases the one pending timer after the shell is available or startup fails. */
  function dispose() {
    if (disposed) return
    disposed = true
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
  }

  /** Creates a timeout carrying pending stage names and monotonic elapsed time. */
  function createTimeoutError(stageOverride) {
    const pendingStages = stageOverride ?? Array.from(activeStages)
    const stage = Array.isArray(pendingStages)
      ? pendingStages.join(' and ') || 'startup initialization'
      : pendingStages
    const elapsedMs = Math.max(0, Math.round(now() - startedAt))
    return new StartupTimeoutError(stage, options.timeoutMs, elapsedMs)
  }
}

module.exports = {
  STARTUP_RESPONSE_TIMEOUT_MS,
  StartupTimeoutError,
  createStartupWatchdog,
}
