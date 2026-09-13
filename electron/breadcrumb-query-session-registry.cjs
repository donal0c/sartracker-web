'use strict'

const { startBreadcrumbQuerySession } = require('./breadcrumb-query-session.cjs')

const MAX_QUEUED_BREADCRUMB_QUERIES = 8
const MAX_BREADCRUMB_POSITIONS_PER_DEVICE = 5_000
const MAX_SCOPED_REQUEST_ID_LENGTH = 220
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u

/**
 * Owns the bounded set of breadcrumb query sessions in the Electron main
 * isolate. At most one session may have a worker in flight at a time.
 */
function createBreadcrumbQuerySessionRegistry(input) {
  if (input === null || typeof input !== 'object'
    || typeof input.databasePath !== 'string' || input.databasePath.length === 0
    || (input.startSession !== undefined && typeof input.startSession !== 'function')) {
    throw new Error('Breadcrumb query session registry configuration is invalid.')
  }

  const entries = new Map()
  const queue = []
  const startSession = input.startSession ?? startBreadcrumbQuerySession
  let running = null
  let shutdownRequested = false
  let shutdownPromise = null
  let resolveShutdown = null

  /** Starts the next queued session when the registry has a free worker slot. */
  function pump() {
    if (shutdownRequested || running !== null) {
      settleShutdownIfIdle()
      return
    }
    const entry = queue.shift()
    if (entry === undefined) {
      settleShutdownIfIdle()
      return
    }
    running = entry
    entry.state = 'starting'
    void launchEntry(entry)
  }

  /** Starts one worker-backed session and owns it through terminal completion. */
  async function launchEntry(entry) {
    let session
    try {
      session = await startSession({
        databasePath: input.databasePath,
        missionId: entry.missionId,
        perDeviceLimit: entry.perDeviceLimit,
        signal: entry.controller.signal,
      })
      assertSession(session)
      entry.session = session
      entry.state = 'running'
      entry.resolveSession(session)
      entry.sessionCompletion = Promise.resolve(session.completion)

      if (entry.cancelRequested) {
        await entry.cancelPromise
        return
      }

      settleStartSuccess(entry, session.manifest)
      let terminalError = null
      try {
        await entry.sessionCompletion
      } catch (error) {
        terminalError = error
      }
      if (!entry.cancelRequested) {
        settleTerminal(entry, terminalError)
      }
    } catch (error) {
      if (!entry.sessionResolved) {
        entry.rejectSession(error)
      }
      const terminalError = entry.cancelRequested ? createAbortError() : error
      settleStartFailure(entry, terminalError)
      settleTerminal(entry, terminalError)
    }
  }

  /** Validates the session methods before any renderer-visible start succeeds. */
  function assertSession(session) {
    if (session === null || typeof session !== 'object'
      || typeof session.read !== 'function'
      || typeof session.finish !== 'function'
      || typeof session.cancel !== 'function'
      || session.completion === null
      || (typeof session.completion !== 'object' && typeof session.completion !== 'function')
      || typeof session.completion.then !== 'function') {
      throw new Error('Breadcrumb query worker session is invalid.')
    }
  }

  /** Resolves the caller-visible start only once the worker has supplied its manifest. */
  function settleStartSuccess(entry, manifest) {
    if (entry.startSettled) return
    entry.startSettled = true
    entry.resolveStart(Object.freeze({ ...manifest, missionId: entry.missionId }))
  }

  /** Rejects a start while retaining the same error for the terminal accessor. */
  function settleStartFailure(entry, error) {
    if (entry.startSettled) return
    entry.startSettled = true
    entry.rejectStart(error)
  }

  /** Finishes a session only after its worker completion promise has settled. */
  function settleTerminal(entry, error) {
    if (entry.terminalSettled) return
    entry.terminalSettled = true
    if (error === null) entry.resolveCompletion()
    else entry.rejectCompletion(error)
    entries.delete(entry.id)
    if (running === entry) running = null
    entry.state = 'settled'
    pump()
  }

  /** Requests cancellation and joins startup, cancellation, and worker completion custody. */
  function requestCancellation(entry) {
    if (entry.cancelPromise !== null) return entry.cancelPromise
    entry.cancelRequested = true
    entry.controller.abort()
    entry.cancelPromise = (async () => {
      let session
      try {
        session = await entry.sessionPromise
      } catch {
        const error = createAbortError()
        settleStartFailure(entry, error)
        settleTerminal(entry, error)
        return
      }

      let cancellationError = null
      try {
        await session.cancel()
      } catch (error) {
        cancellationError = error
      }
      let completionError = null
      try {
        await entry.sessionCompletion
      } catch (error) {
        completionError = error
      }
      const startError = createAbortError()
      settleStartFailure(entry, startError)
      settleTerminal(entry, completionError ?? cancellationError ?? startError)
    })()
    void entry.cancelPromise.catch(() => undefined)
    return entry.cancelPromise
  }

  /** Rejects a queued request immediately and removes its ownership record. */
  function cancelQueuedEntry(entry) {
    const index = queue.indexOf(entry)
    if (index >= 0) queue.splice(index, 1)
    entry.cancelRequested = true
    entry.controller.abort()
    const error = createAbortError()
    entry.rejectSession(error)
    settleStartFailure(entry, error)
    settleTerminal(entry, error)
  }

  /** Resolves shutdown only after all admitted sessions have been removed. */
  function settleShutdownIfIdle() {
    if (shutdownRequested && entries.size === 0 && resolveShutdown !== null) {
      const resolve = resolveShutdown
      resolveShutdown = null
      resolve()
    }
  }

  /** Creates a deferred promise with explicit settlement custody. */
  function deferred() {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    return { promise, resolve, reject }
  }

  /** Admits one request synchronously before starting or queueing its worker. */
  function start(missionId, perDeviceLimit, id) {
    try {
      validateMissionId(missionId)
      validatePerDeviceLimit(perDeviceLimit)
      validateRequestId(id)
    } catch (error) {
      return Promise.reject(error)
    }
    if (shutdownRequested) return Promise.reject(createAbortError())
    if (entries.has(id)) {
      return Promise.reject(new Error('Breadcrumb query request ID is already active.'))
    }
    if (running !== null && queue.length >= MAX_QUEUED_BREADCRUMB_QUERIES) {
      return Promise.reject(new Error('Breadcrumb query session queue is full.'))
    }

    const startDeferred = deferred()
    const sessionDeferred = deferred()
    const completionDeferred = deferred()
    const entry = {
      id,
      missionId,
      perDeviceLimit,
      controller: new AbortController(),
      state: 'queued',
      session: null,
      sessionCompletion: null,
      sessionResolved: false,
      cancelRequested: false,
      cancelPromise: null,
      startSettled: false,
      terminalSettled: false,
      resolveStart: startDeferred.resolve,
      rejectStart: startDeferred.reject,
      resolveSession: (session) => {
        if (entry.sessionResolved) return
        entry.sessionResolved = true
        sessionDeferred.resolve(session)
      },
      rejectSession: (error) => {
        if (entry.sessionResolved) return
        entry.sessionResolved = true
        sessionDeferred.reject(error)
      },
      sessionPromise: sessionDeferred.promise,
      resolveCompletion: completionDeferred.resolve,
      rejectCompletion: completionDeferred.reject,
      completion: completionDeferred.promise,
    }
    // A queued request can be cancelled before any consumer awaits its session.
    void entry.sessionPromise.catch(() => undefined)
    // A caller may capture completion for a request it later cancels without
    // awaiting that promise. Keep the rejection observed until the accessor is used.
    void entry.completion.catch(() => undefined)
    entries.set(id, entry)
    queue.push(entry)
    pump()
    return startDeferred.promise
  }

  /** Reads one frame from an admitted session without assembling it in main. */
  async function read(id, sequence) {
    const entry = requireEntry(id)
    const session = await entry.sessionPromise
    if (entry.cancelRequested) throw createAbortError()
    return session.read(sequence)
  }

  /** Requests clean worker completion for an admitted session. */
  async function finish(id) {
    const entry = requireEntry(id)
    const session = await entry.sessionPromise
    if (entry.cancelRequested) throw createAbortError()
    return session.finish()
  }

  /** Returns the terminal promise while the ownership record still exists. */
  function completion(id) {
    return requireEntry(id).completion
  }

  /** Cancels a queued or running request and waits for actual worker termination. */
  async function cancel(id) {
    validateRequestId(id)
    const entry = entries.get(id)
    if (entry === undefined) return false
    if (entry.state === 'queued') {
      cancelQueuedEntry(entry)
      return true
    }
    await requestCancellation(entry)
    return true
  }

  /** Closes admission and joins every admitted request, including a startup race. */
  function shutdown() {
    if (shutdownPromise !== null) return shutdownPromise
    shutdownRequested = true
    shutdownPromise = new Promise((resolve) => {
      resolveShutdown = resolve
    })
    for (const entry of [...queue]) cancelQueuedEntry(entry)
    if (running !== null) void requestCancellation(running).catch(() => undefined)
    settleShutdownIfIdle()
    return shutdownPromise
  }

  /** Requires a currently owned request and returns its entry. */
  function requireEntry(id) {
    validateRequestId(id)
    const entry = entries.get(id)
    if (entry === undefined) throw new Error('Breadcrumb query request is not active.')
    return entry
  }

  /** Validates the mission identity before admission. */
  function validateMissionId(value) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 200) {
      throw new Error('Breadcrumb query mission ID is invalid.')
    }
  }

  /** Validates the per-device selection bound. */
  function validatePerDeviceLimit(value) {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_BREADCRUMB_POSITIONS_PER_DEVICE) {
      throw new Error('Breadcrumb position limit must be a positive integer no greater than 5000.')
    }
  }

  /** Validates the opaque renderer request identity. */
  function validateRequestId(value) {
    if (typeof value !== 'string' || value.length < 1 || value.length > MAX_SCOPED_REQUEST_ID_LENGTH
      || !REQUEST_ID_PATTERN.test(value)) {
      throw new Error('Breadcrumb query request ID is invalid.')
    }
  }

  /** Identifies lifecycle cancellation without disguising it as query success. */
  function createAbortError() {
    const error = new Error('Breadcrumb query session was cancelled.')
    error.name = 'AbortError'
    return error
  }

  return {
    start,
    read,
    finish,
    cancel,
    completion,
    shutdown,
    get activeCount() {
      return entries.size
    },
  }
}

module.exports = { createBreadcrumbQuerySessionRegistry }
