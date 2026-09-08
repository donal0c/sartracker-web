'use strict'

const BUSY_RETRY_LIMIT = 240
const BUSY_RETRY_DELAY_MS = 25

/** Creates an ordered owner for short atomic writes that must not sleep inside SQLite. */
function createResponsiveMissionWriter(database) {
  let closing = false
  let tail = Promise.resolve()
  let pendingCount = 0
  let fault = null

  /** Executes only one fully rolled-back synchronous transaction per attempt. */
  async function execute(callback, signal) {
    if (fault !== null) throw fault
    const transaction = database.transaction(() => {
      const result = callback()
      if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
        throw new Error('Mission write callbacks must be synchronous.')
      }
      return result
    })
    for (let attempt = 0; attempt <= BUSY_RETRY_LIMIT; attempt += 1) {
      assertNotCancelled(signal)
      if (database.inTransaction) {
        throw new Error('Responsive mission writer requires its own outer transaction.')
      }
      const previousBusyTimeout = Number(database.pragma('busy_timeout', { simple: true }))
      if (!Number.isSafeInteger(previousBusyTimeout) || previousBusyTimeout < 0) {
        throw new Error('Mission database busy-timeout configuration is invalid.')
      }
      let retryError
      database.pragma('busy_timeout = 0')
      try {
        return transaction.immediate()
      } catch (error) {
        if (database.inTransaction) {
          try {
            database.exec('ROLLBACK')
            if (database.inTransaction) throw new Error('Rollback did not end the transaction.')
          } catch (rollbackError) {
            fault = Object.assign(new Error(
              'Mission database writer could not recover its transaction. Stop editing and restart the application.',
              { cause: new AggregateError([error, rollbackError], 'Mission write and rollback failed.') },
            ), { code: 'MISSION_WRITER_FAULTED' })
            throw fault
          }
        }
        if (!isSqliteBusy(error) || attempt === BUSY_RETRY_LIMIT) throw error
        retryError = error
      } finally {
        database.pragma(`busy_timeout = ${previousBusyTimeout}`)
      }
      // No transaction or changed connection configuration survives this yield.
      if (retryError !== undefined) await waitForRetry(signal)
    }
    throw new Error('Mission write retry budget exhausted.')
  }

  return Object.freeze({
    /** Preserves admission order even when an earlier write must wait for another connection. */
    run(callback, { signal } = {}) {
      if (typeof callback !== 'function' || callback.constructor?.name === 'AsyncFunction') {
        return Promise.reject(new Error('Mission write callbacks must be synchronous functions.'))
      }
      if (closing || signal?.aborted) return Promise.reject(createCancellation())
      if (fault !== null) return Promise.reject(fault)
      pendingCount += 1
      const operation = tail.then(() => execute(callback, signal))
      const completion = operation.finally(() => { pendingCount -= 1 })
      tail = completion.catch(() => undefined)
      return completion
    },
    /** Rejects new work and drains admitted writes, preserving their bounded retry budget. */
    close() {
      closing = true
      return tail
    },
    /** Includes queued work so the database cannot close underneath an admitted write. */
    get pendingCount() { return pendingCount },
  })
}

/** Accepts only SQLite's busy family; constraints and arbitrary failures never retry. */
function isSqliteBusy(error) {
  return typeof error?.code === 'string' && /^SQLITE_BUSY(?:_|$)/u.test(error.code)
}

/** Creates a visible cancellation outcome compatible with mission-store shutdown. */
function createCancellation() {
  const error = new Error('Mission database write was cancelled before it could commit.')
  error.name = 'AbortError'
  return error
}

/** Cancels only work whose requesting owner explicitly withdrew it. */
function assertNotCancelled(signal) {
  if (signal?.aborted) throw createCancellation()
}

/** Waits without blocking the main thread and releases every timer/listener on settlement. */
function waitForRetry(signal) {
  return new Promise((resolve, reject) => {
    let timer
    /** Removes the cancellation listener and bounded retry timer. */
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
    }
    /** Rejects promptly when the requesting owner cancels the pending write. */
    const cancel = () => { cleanup(); reject(createCancellation()) }
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) { cancel(); return }
    timer = setTimeout(() => { cleanup(); resolve() }, BUSY_RETRY_DELAY_MS)
  })
}

module.exports = { createResponsiveMissionWriter }
