const { sanitizeDiagnosticText } = require('./diagnostic-sanitizer.cjs')

const MAX_DIAGNOSTIC_TEXT_LENGTH = 500

/** Shares one pair of renderer lifecycle listeners across its coverage operations. */
function createCoverageOwnerLifecycle(options = {}) {
  options = options ?? {}
  const owners = new WeakMap()
  const retired = new WeakMap()
  const reportFailure = typeof options.onFailure === 'function'
    ? options.onFailure
    : reportDefaultFailure

  return {
    subscribe(sender, onGone) {
      assertSubscriptionInputs(sender, onGone)
      rejectUnavailableSender(sender)

      const processId = readProcessId(sender)
      const previous = retired.get(sender)
      if (previous !== undefined) {
        if (processId !== null && previous.processId !== null && processId !== previous.processId) {
          retired.delete(sender)
        } else {
          throw createAbortError('Coverage renderer process ended before this subscription was registered.')
        }
      }

      let owner = owners.get(sender)
      if (owner === undefined) {
        owner = createOwner(sender, processId)
        owners.set(sender, owner)
        owner.callbacks.add(onGone)
        try {
          sender.once('destroyed', owner.gone)
          if (owner.goneState) throw createAbortError('Coverage renderer was destroyed during subscription.')
          sender.once('render-process-gone', owner.gone)
          if (owner.goneState) throw createAbortError('Coverage renderer process ended during subscription.')
        } catch (error) {
          owner.detach()
          owner.callbacks.clear()
          throw error
        }
      } else {
        if (owner.goneState) {
          throw createAbortError('Coverage renderer process ended before this subscription was registered.')
        }
        if (owner.processId !== processId && owner.processId !== null && processId !== null) {
          throw createAbortError('Coverage renderer process identity changed during subscription.')
        }
        owner.callbacks.add(onGone)
      }

      let released = false
      return () => {
        if (released) return
        released = true
        owner.callbacks.delete(onGone)
        if (owner.callbacks.size === 0) owner.detach()
      }
    },
  }

  /** Creates one sender owner and its idempotent event teardown. */
  function createOwner(sender, processId) {
    const owner = {
      callbacks: new Set(),
      detached: false,
      goneState: false,
      processId,
      detach: () => undefined,
      gone: () => undefined,
    }
    owner.detach = () => {
      if (owner.detached) return
      owner.detached = true
      safelyRemoveListener(sender, 'destroyed', owner.gone)
      safelyRemoveListener(sender, 'render-process-gone', owner.gone)
      if (owners.get(sender) === owner) owners.delete(sender)
    }
    owner.gone = details => {
      if (owner.goneState) return
      owner.goneState = true
      retired.set(sender, {
        processId: owner.processId,
      })
      owner.detach()
      const pending = [...owner.callbacks]
      owner.callbacks.clear()
      for (const callback of pending) {
        try {
          const result = callback(details)
          if (result !== undefined) {
            void Promise.resolve(result).catch(error => {
              reportLifecycleFailure(reportFailure, error, 'coverage renderer lifecycle callback')
            })
          }
        } catch (error) {
          reportLifecycleFailure(reportFailure, error, 'coverage renderer lifecycle callback')
        }
      }
    }
    return owner
  }

  /** Removes one lifecycle listener without allowing cleanup failures to escape. */
  function safelyRemoveListener(sender, eventName, callback) {
    try {
      sender.removeListener(eventName, callback)
    } catch (error) {
      reportLifecycleFailure(reportFailure, error, `coverage renderer ${eventName} listener removal`)
    }
  }
}

/** Validates the narrow sender and callback contract before mutating lifecycle state. */
function assertSubscriptionInputs(sender, onGone) {
  if (sender === null || (typeof sender !== 'object' && typeof sender !== 'function')) {
    throw new TypeError('Coverage renderer lifecycle sender is invalid.')
  }
  if (typeof sender.once !== 'function' || typeof sender.removeListener !== 'function') {
    throw new TypeError('Coverage renderer lifecycle sender does not support listeners.')
  }
  if (typeof onGone !== 'function') {
    throw new TypeError('Coverage renderer lifecycle callback is invalid.')
  }
}

/** Fails closed when Electron reports a sender that can no longer host work. */
function rejectUnavailableSender(sender) {
  if (readBooleanMethod(sender, 'isDestroyed') || readIsCrashed(sender)) {
    throw createAbortError('Coverage renderer is no longer available.')
  }
}

/** Reads one safe renderer process identity, retaining null when Electron cannot provide it. */
function readProcessId(sender) {
  try {
    const method = sender.getProcessId
    if (typeof method !== 'function') return null
    const processId = method.call(sender)
    return Number.isSafeInteger(processId) && processId > 0 ? processId : null
  } catch {
    return null
  }
}

/** Reads one optional Electron boolean method without turning an unavailable method into a throw. */
function readBooleanMethod(sender, methodName) {
  try {
    const method = sender[methodName]
    if (typeof method !== 'function') return false
    return method.call(sender) === true
  } catch {
    return true
  }
}

/** Reads the renderer crash state using the same fail-closed rule as destruction. */
function readIsCrashed(sender) {
  return readBooleanMethod(sender, 'isCrashed')
}

/** Creates the stable cancellation error used at the IPC boundary. */
function createAbortError(message) {
  const error = new Error(`coverage-cancelled: ${message}`)
  error.name = 'AbortError'
  return error
}

/** Reports one lifecycle failure while protecting the event emitter from reporter failures. */
function reportLifecycleFailure(reportFailure, error, phase) {
  const failure = error instanceof Error ? error : new Error(String(error))
  try {
    const result = reportFailure(failure, { phase })
    if (result !== undefined) void Promise.resolve(result).catch(reportDefaultFailure)
  } catch (reportError) {
    reportDefaultFailure(reportError)
  }
}

/** Emits a bounded process diagnostic when no runtime reporter was supplied. */
function reportDefaultFailure(error) {
  try {
    const message = sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))
      .slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH)
    console.error(`Coverage renderer lifecycle failure: ${message}`)
  } catch {
    // A failing diagnostic sink must never rethrow into Electron's EventEmitter.
  }
}

module.exports = { createCoverageOwnerLifecycle }
