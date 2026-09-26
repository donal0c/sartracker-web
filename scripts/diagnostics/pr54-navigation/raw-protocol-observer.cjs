const SAFE_PROTOCOL_MESSAGES = new Set([
  'Promise was collected',
  'Cannot find context with specified id',
  'Cannot find context with specified id.',
  'Execution context was destroyed',
  'Execution context was destroyed.',
  'Could not find object with given id',
  'Could not find object with given id.',
  'Cannot find default execution context',
  'Cannot find default execution context.',
  'Execution was terminated',
  'Execution was terminated.',
  'Inspected target navigated or closed',
  'Inspected target navigated or closed.',
  'Object reference chain is too long',
  "Object couldn't be returned by value",
  'Internal error',
  'Invalid parameters',
])

/** Only exact known protocol text is safe to retain; all unknown content is redacted. */
function sanitizeProtocolMessage(message) {
  return SAFE_PROTOCOL_MESSAGES.has(message) ? message : '[unrecognized protocol message redacted]'
}

/** Observe raw errors without changing the original handler's arguments or result. */
function installRawProtocolObserver(prototype, record) {
  const original = prototype._onMessage
  if (typeof original !== 'function') throw new Error('Unexpected CRSession implementation')
  const observerErrors = []
  /** Preserve original protocol dispatch even if diagnostic recording fails. */
  function observedMessage(message) {
    if (message.error && this._callbacks.get(message.id)?.error.method === 'Runtime.callFunctionOn') {
      try {
        record({
          method: this._callbacks.get(message.id)?.error.method ?? null,
          code: message.error.code,
          message: sanitizeProtocolMessage(message.error.message),
        })
      } catch {
        observerErrors.push('diagnostic recorder failed')
      }
    }
    return Reflect.apply(original, this, [message])
  }
  prototype._onMessage = observedMessage
  return {
    observerErrors,
    /** Restore only the observer installed by this diagnostic. */
    restore() {
      if (prototype._onMessage !== observedMessage) throw new Error('Protocol observer ownership changed')
      prototype._onMessage = original
    },
  }
}

module.exports = { installRawProtocolObserver, sanitizeProtocolMessage }
