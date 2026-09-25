'use strict'

const path = require('node:path')

const DEFAULT_CLOSE_TIMEOUT_MS = 750
const DEFAULT_TERMINATE_GRACE_MS = 500
const DEFAULT_FORCE_EXIT_GRACE_MS = 1_000
const READY_TIMEOUT_MS = 10_000
const WORKER_PATH = path.join(__dirname, 'startup-evidence-worker.cjs')

/**
 * Creates the runtime/crash evidence boundary used by Electron startup.
 *
 * In Electron, filesystem operations run in a utility process so a stalled
 * append cannot keep the main process alive after its startup-fault window is
 * dismissed. Node-based unit tests keep the direct adapters unless they opt in.
 */
function createStartupEvidenceService(options) {
  if (typeof options?.userDataPath !== 'string' || !path.isAbsolute(options.userDataPath)) {
    throw new Error('Startup evidence service requires an absolute user-data path.')
  }

  if (options.enabled !== true) {
    const { createRuntimeLog } = require('./runtime-log.cjs')
    const { createCrashLog } = require('./crash-log.cjs')
    const runtimeLog = createRuntimeLog({ userDataPath: options.userDataPath })
    const crashLog = createCrashLog({ userDataPath: options.userDataPath })
    return Object.freeze({
      runtimeLog,
      crashLog,
      ready: Promise.resolve(),
      close: async () => undefined,
      terminate: async () => undefined,
    })
  }

  if (typeof options.utilityProcess?.fork !== 'function') {
    return createUnavailableService(options.userDataPath)
  }

  let child
  try {
    child = options.utilityProcess.fork(options.workerPath ?? WORKER_PATH, [], {
      serviceName: 'SAR Tracker startup evidence',
      stdio: 'ignore',
      allowLoadingUnsignedLibraries: false,
    })
  } catch {
    return createUnavailableService(options.userDataPath)
  }
  if (child === null || typeof child !== 'object'
    || typeof child.on !== 'function'
    || typeof child.postMessage !== 'function'
    || typeof child.kill !== 'function') {
    try {
      child?.kill?.()
    } catch {
      // A malformed utility-process handle cannot be safely managed further.
    }
    return createUnavailableService(options.userDataPath)
  }

  let state = 'starting'
  let nextRequestId = 1
  let readyTimer
  let terminationPromise = null
  const pending = new Map()
  const readyDeferred = createDeferred()
  const exitedDeferred = createDeferred()
  const ready = readyDeferred.promise
  const exited = exitedDeferred.promise

  readyTimer = setTimeout(() => {
    failWorker(createServiceError('Startup evidence utility process did not become ready.'))
  }, READY_TIMEOUT_MS)
  readyTimer.unref?.()

  try {
    child.on('message', handleMessage)
    child.on('error', () => {
      failWorker(createServiceError('Startup evidence utility process failed.'))
    })
    child.on('exit', (code) => {
      if (state !== 'exited') state = 'exited'
      clearTimeout(readyTimer)
      if (!readyDeferred.settled) {
        readyDeferred.reject(createServiceError('Startup evidence utility process exited before readiness.'))
      }
      for (const request of pending.values()) {
        request.reject(createServiceError('Startup evidence utility process exited before completing a write.'))
      }
      pending.clear()
      exitedDeferred.resolve(code)
    })
    child.postMessage({ id: 0, type: 'initialize', userDataPath: options.userDataPath })
  } catch {
    failWorker(createServiceError('Could not initialize the isolated startup evidence process.'))
  }

  const service = {
    runtimeLog: Object.freeze({
      append: (input) => call('runtime.append', input).catch(() => undefined),
      appendDurable: (input) => call('runtime.appendDurable', input),
      readRecent: (limit) => call('runtime.readRecent', { limit }),
      logFilePath: path.join(options.userDataPath, 'logs', 'runtime.log'),
    }),
    crashLog: Object.freeze({
      // Best effort, matching the in-process crash-log contract: an unavailable
      // helper must not turn a renderer-loss record into a teardown failure.
      // Callers that must know the outcome use recordDurably.
      record: (input) => call('crash.record', input).catch(() => undefined),
      recordDurably: (input) => call('crash.recordDurable', input),
      readRecent: (limit) => call('crash.readRecent', { limit }),
      markSessionStart: () => call('crash.markSessionStart'),
      markCleanExit: () => call('crash.markCleanExit'),
      hadUncleanShutdown: () => call('crash.hadUncleanShutdown'),
      crashLogPath: path.join(options.userDataPath, 'crashes', 'crash-log.json'),
    }),
    ready,
    close,
    terminate,
  }
  return Object.freeze(service)

  /** Sends one operation and settles it only when the helper returns its result. */
  function call(type, input, allowClosing = false) {
    if (state === 'failed' || state === 'exited' || state === 'terminating'
      || (state === 'closing' && !allowClosing)) {
      return Promise.reject(createServiceError('Startup evidence utility process is not available.'))
    }
    const id = nextRequestId
    nextRequestId += 1
    const result = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      void ready.then(() => {
        if (state === 'failed' || state === 'exited' || state === 'terminating') {
          pending.delete(id)
          reject(createServiceError('Startup evidence utility process is not available.'))
          return
        }
        try {
          child.postMessage(input === undefined ? { id, type } : { id, type, input })
        } catch {
          pending.delete(id)
          reject(createServiceError('Could not send a request to the startup evidence utility process.'))
        }
      }, reject)
    })
    return result
  }

  /** Handles readiness and one bounded response from the utility process. */
  function handleMessage(message) {
    if (message?.id === 0 && message.type === 'ready') {
      if (state !== 'starting') return
      state = 'ready'
      clearTimeout(readyTimer)
      readyDeferred.resolve()
      return
    }
    if (message?.id === 0 && message.ok === false && state === 'starting') {
      failWorker(createRemoteError(message.error))
      return
    }
    if (!Number.isSafeInteger(message?.id)) return
    const request = pending.get(message.id)
    if (request === undefined) return
    pending.delete(message.id)
    if (message.ok === true) {
      request.resolve(message.value)
    } else {
      request.reject(createRemoteError(message.error))
    }
  }

  /** Rejects all requests after an initialization or process-level failure. */
  function failWorker(error) {
    if (state === 'exited' || state === 'terminating') return
    state = 'failed'
    clearTimeout(readyTimer)
    if (!readyDeferred.settled) readyDeferred.reject(error)
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }

  /** Drains all helper work, falling back to termination when a write stays pending. */
  async function close(closeOptions = {}) {
    if (state === 'exited') return
    if (state === 'starting' || state === 'failed') {
      await terminate()
      return
    }
    if (state !== 'ready') {
      if (terminationPromise !== null) await terminationPromise
      return
    }
    state = 'closing'
    const timeoutMs = positiveTimeout(closeOptions.timeoutMs, DEFAULT_CLOSE_TIMEOUT_MS)
    const shutdown = call('shutdown', undefined, true)
    const shutdownCompleted = await settlesWithin(shutdown, timeoutMs)
    if (shutdownCompleted) {
      const exitObserved = await waitForExit(timeoutMs)
      if (exitObserved) return
    }
    await terminate()
  }

  /** Terminates the helper and waits for its OS exit event before returning. */
  function terminate() {
    if (terminationPromise !== null) return terminationPromise
    terminationPromise = terminateWorker()
    return terminationPromise
  }

  /** Stops an unresponsive utility process, escalating only if SIGTERM is not reaped. */
  async function terminateWorker() {
    if (state === 'exited') return
    state = 'terminating'
    try {
      child.kill()
    } catch {
      // The PID-based fallback below still attempts to reap this app-owned helper.
    }
    if (await waitForExit(DEFAULT_TERMINATE_GRACE_MS)) return
    const pid = child.pid
    if (Number.isSafeInteger(pid) && pid > 0) {
      try {
        ;(options.killProcess ?? process.kill.bind(process))(pid, 'SIGKILL')
      } catch {
        // The exit wait below distinguishes a failed signal from a reaped helper.
      }
    }
    if (!(await waitForExit(DEFAULT_FORCE_EXIT_GRACE_MS))) {
      // No exit event will settle these; release every waiter explicitly so a
      // failed reap cannot also leave callers pending forever.
      const error = createServiceError('Startup evidence utility process could not be reaped.')
      if (!readyDeferred.settled) readyDeferred.reject(error)
      for (const request of pending.values()) request.reject(error)
      pending.clear()
      throw error
    }
  }

  /** Waits only for the utility process exit event, never by probing its PID. */
  async function waitForExit(timeoutMs) {
    if (state === 'exited') return true
    return settlesWithin(exited, timeoutMs)
  }
}

/** Creates a small deferred value with idempotent resolution state. */
function createDeferred() {
  let resolvePromise
  let rejectPromise
  const deferred = {
    settled: false,
    promise: new Promise((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    }),
    resolve(value) {
      if (deferred.settled) return
      deferred.settled = true
      resolvePromise(value)
    },
    reject(error) {
      if (deferred.settled) return
      deferred.settled = true
      rejectPromise(error)
    },
  }
  return deferred
}

/** Returns true only when a promise settles before its fixed timeout. */
function settlesWithin(promise, timeoutMs) {
  let timeout
  return Promise.race([
    Promise.resolve(promise).then(() => true, () => true),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timeout))
}

/** Creates one controlled service error for a failed helper protocol. */
function createServiceError(message) {
  const error = new Error(message)
  error.code = 'ERR_SARTRACKER_EVIDENCE_WORKER'
  return error
}

/** Reconstructs only the bounded error fields allowed across the helper boundary. */
function createRemoteError(input) {
  const error = new Error(typeof input?.message === 'string'
    ? input.message.slice(0, 1_000)
    : 'Startup evidence operation failed.')
  error.name = typeof input?.name === 'string' ? input.name.slice(0, 100) : 'Error'
  if (typeof input?.code === 'string') error.code = input.code.slice(0, 100)
  return error
}

/** Returns an evidence boundary that fails closed without doing file I/O in Electron main. */
function createUnavailableService(userDataPath) {
  const error = createServiceError('Could not initialize the isolated startup evidence process.')
  const ready = Promise.reject(error)
  // The startup path observes this rejection, while the handler prevents a
  // bootstrap error from becoming an unhandled rejection before that point.
  void ready.catch(() => undefined)
  const reject = () => Promise.reject(error)
  return Object.freeze({
    runtimeLog: Object.freeze({
      append: async () => undefined,
      appendDurable: reject,
      readRecent: reject,
      logFilePath: path.join(userDataPath, 'logs', 'runtime.log'),
    }),
    crashLog: Object.freeze({
      record: async () => undefined,
      recordDurably: reject,
      readRecent: reject,
      markSessionStart: reject,
      markCleanExit: reject,
      hadUncleanShutdown: reject,
      crashLogPath: path.join(userDataPath, 'crashes', 'crash-log.json'),
    }),
    ready,
    close: async () => undefined,
    terminate: async () => undefined,
  })
}

/** Normalizes a positive close timeout before it reaches a timer. */
function positiveTimeout(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 30_000) : fallback
}

module.exports = { createStartupEvidenceService }
