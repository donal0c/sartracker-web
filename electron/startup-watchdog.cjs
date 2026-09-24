const { performance } = require('node:perf_hooks')

/** A pre-window startup step exceeded the shared response deadline. */
class StartupTimeoutError extends Error {
  /** Creates a timeout with the pending startup stage and its measured budget. */
  constructor(stage, timeoutMs, elapsedMs) {
    super(`Startup step "${stage}" did not finish within ${timeoutMs} ms after Electron was ready.`)
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
  let activeStage = 'startup initialization'
  let timeoutHandle
  let disposed = false
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(createTimeoutError(activeStage))
    }, options.timeoutMs)
  })
  // Each active stage attaches the deadline to a race. This handler also keeps
  // the single deadline rejection handled if startup fails before its first wait.
  void timeoutPromise.catch(() => undefined)

  return Object.freeze({
    run,
    dispose,
  })

  /** Runs one stage against the shared deadline without resetting its clock. */
  function run(stage, operation) {
    if (disposed) return Promise.reject(new Error('Startup watchdog is already complete.'))
    if (typeof stage !== 'string' || stage.trim() === '' || typeof operation !== 'function') {
      return Promise.reject(new Error('Startup watchdog requires a named stage and operation.'))
    }
    activeStage = stage
    const elapsedMs = Math.max(0, now() - startedAt)
    if (elapsedMs >= options.timeoutMs) {
      return Promise.reject(createTimeoutError(stage))
    }
    const task = Promise.resolve().then(operation).then(
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
    )
    return Promise.race([task, timeoutPromise])
  }

  /** Releases the one pending timer after the shell is available or startup fails. */
  function dispose() {
    if (disposed) return
    disposed = true
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
  }

  /** Creates a timeout carrying the current named stage and monotonic elapsed time. */
  function createTimeoutError(stage) {
    const elapsedMs = Math.max(0, Math.round(now() - startedAt))
    return new StartupTimeoutError(stage, options.timeoutMs, elapsedMs)
  }
}

module.exports = {
  StartupTimeoutError,
  createStartupWatchdog,
}
