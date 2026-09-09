'use strict'

const MAX_RUNNING = 2
const MAX_ADMITTED = 16

/** Creates one small promise boundary with explicit completion ownership. */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse })
  return { promise, resolve, reject }
}

/** Produces a closed non-secret admission/cancellation outcome. */
function failure(code) {
  const error = new Error(code === 'ARCHIVE_REVIEW_BUSY'
    ? 'Archive Review is busy. Wait for the current reads before retrying.'
    : 'Archive Review read was closed or cancelled.')
  error.code = code
  if (code === 'ARCHIVE_REVIEW_CANCELLED') error.name = 'AbortError'
  return error
}

/** Bounds Review workers and waiting requests while retaining slots through physical exit. */
function createArchiveReviewWorkQueue() {
  const admitted = new Set()
  const waiting = []
  let running = 0
  let closed = false

  /** Releases exactly one admission after either queued cancellation or physical exit. */
  function release(entry) {
    admitted.delete(entry)
    entry.signal?.removeEventListener('abort', entry.cancel)
    entry.controller.signal.removeEventListener('abort', entry.onAbort)
    entry.exited.resolve()
  }

  /** Settles the public result before waiting separately for the worker to leave. */
  async function execute(entry) {
    let operation
    try {
      operation = entry.factory(entry.controller.signal)
      entry.result.resolve(await operation)
    } catch (error) {
      entry.result.reject(error)
    } finally {
      await Promise.resolve(operation?.workerExited).catch(() => undefined)
      running -= 1
      release(entry)
      pump()
    }
  }

  /** Starts only the oldest waiting requests whose owners have not cancelled. */
  function pump() {
    while (!closed && running < MAX_RUNNING && waiting.length > 0) {
      const entry = waiting.shift()
      entry.started = true
      running += 1
      void execute(entry)
    }
  }

  return Object.freeze({
    /** Admits a bounded request without starting its worker until a physical slot is free. */
    run(factory, signal) {
      const result = deferred()
      const exited = deferred()
      Object.defineProperty(result.promise, 'workerExited', { value: exited.promise })
      if (closed || signal?.aborted || admitted.size >= MAX_ADMITTED) {
        result.reject(failure(closed ? 'ARCHIVE_REVIEW_CLOSED' : signal?.aborted ? 'ARCHIVE_REVIEW_CANCELLED' : 'ARCHIVE_REVIEW_BUSY'))
        exited.resolve()
        return result.promise
      }
      const controller = new AbortController()
      const entry = { factory, signal, result, exited, controller, started: false }
      entry.cancel = () => controller.abort()
      entry.onAbort = () => {
        if (entry.started) return
        const index = waiting.indexOf(entry)
        if (index >= 0) waiting.splice(index, 1)
        result.reject(failure('ARCHIVE_REVIEW_CANCELLED'))
        release(entry)
      }
      signal?.addEventListener('abort', entry.cancel, { once: true })
      controller.signal.addEventListener('abort', entry.onAbort, { once: true })
      admitted.add(entry)
      waiting.push(entry)
      pump()
      return result.promise
    },
    /** Cancels queued and running owners and joins every admitted physical exit. */
    async close() {
      closed = true
      const entries = [...admitted]
      for (const entry of entries) entry.controller.abort()
      await Promise.all(entries.map((entry) => entry.exited.promise))
    },
  })
}

module.exports = { createArchiveReviewWorkQueue }
