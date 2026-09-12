'use strict'

const path = require('node:path')
const { Worker } = require('./mission-worker.cjs')
const { BREADCRUMB_QUERY_TRANSPORT_VERSION, MAX_BREADCRUMB_FRAME_CODE_UNITS } = require('./breadcrumb-query-transport.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'breadcrumb-query-worker.cjs')
const DEFAULT_SESSION_TIMEOUT_MS = 30_000

/** Starts a pull-driven result session without assembling selected rows in main. */
async function startBreadcrumbQuerySession(input) {
  if (input.signal?.aborted) throw createAbortError()
  const timeoutMs = input.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new Error('Breadcrumb query session timeout must be between 1 and 300000 ms.')
  }
  const worker = new Worker(input.workerPath ?? DEFAULT_WORKER_PATH, {
    workerData: { databasePath: input.databasePath, missionId: input.missionId,
      perDeviceLimit: input.perDeviceLimit, transport: 'frames-v1' },
  })
  let exited = false
  let failure = null
  let ready = false
  let pendingRead = null
  let nextSequence = 0
  let finalFrameRead = false
  let finishRequested = false
  let finishAcknowledged = false
  let resolveStarted
  let rejectStarted
  const started = new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject })
  let resolveCompletion
  let rejectCompletion
  const completion = new Promise((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject })
  // A caller can be awaiting a read or startup instead of observing completion yet.
  void completion.catch(() => undefined)
  let resolveExited
  const workerExited = new Promise((resolve) => { resolveExited = resolve })

  /** Preserves the first failure and keeps termination joined through the exit event. */
  function fail(error) {
    if (exited || failure !== null) return
    failure = error
    void worker.terminate().catch(() => undefined)
  }
  /** Sends only protocol controls, never an accumulated result. */
  function send(message) {
    try { worker.postMessage(message) } catch (error) { fail(error) }
  }
  /** Rejects invalid receiver progress and prevents further worker publication. */
  function rejectProgress(message) {
    const error = new Error(message)
    fail(error)
    return completion
  }
  const abort = () => fail(createAbortError())
  const timeout = setTimeout(() => fail(new Error(
    `Breadcrumb query session timed out after ${Math.floor(timeoutMs)} ms.`,
  )), Math.floor(timeoutMs))
  input.signal?.addEventListener('abort', abort, { once: true })
  if (input.signal?.aborted) abort()

  worker.on('message', (message) => {
    if (exited || failure !== null) return
    if (message?.type === 'error') {
      fail(createWorkerError(message))
      return
    }
    if (!ready && message?.type === 'ready' && Number.isSafeInteger(message.workerThreadId)
      && message.workerThreadId > 0 && isManifest(message.manifest)) {
      timeout.refresh()
      ready = true
      resolveStarted({
        workerThreadId: message.workerThreadId,
        manifest: Object.freeze({ ...message.manifest }),
        completion,
        /** Requests exactly one next frame; no second pull may be outstanding. */
        read(sequence) {
          if (failure !== null) return Promise.reject(failure)
          if (exited) return Promise.reject(new Error('Breadcrumb query session has no further frames.'))
          if (finishRequested || finalFrameRead) return rejectProgress('Breadcrumb query session has no further frames.')
          if (pendingRead !== null) return rejectProgress('Breadcrumb query session already has an outstanding read.')
          if (!Number.isSafeInteger(sequence) || sequence !== nextSequence) return rejectProgress('Breadcrumb query frame sequence is invalid.')
          return new Promise((resolve, reject) => {
            pendingRead = { resolve, reject }
            send({ type: 'read', sequence })
          })
        },
        /** Requires the final frame, explicit worker acknowledgement, and clean exit. */
        finish() {
          if (failure !== null) return completion
          if (!finalFrameRead || pendingRead !== null) return rejectProgress('Breadcrumb query session cannot finish before its final frame.')
          if (!finishRequested) {
            finishRequested = true
            send({ type: 'finish' })
          }
          return completion
        },
        /** Cancels both parked workers and pending reads, waiting for actual termination. */
        async cancel() {
          if (!exited) fail(createAbortError())
          await workerExited
        },
      })
      return
    }
    if (ready && message?.type === 'frame' && pendingRead !== null && !finishRequested
      && message.sequence === nextSequence && typeof message.payload === 'string'
      && message.payload.length <= MAX_BREADCRUMB_FRAME_CODE_UNITS && typeof message.done === 'boolean'
      && (message.payload.length > 0 || message.done)) {
      timeout.refresh()
      const read = pendingRead
      pendingRead = null
      nextSequence += 1
      finalFrameRead = message.done
      read.resolve({ sequence: message.sequence, payload: message.payload, done: message.done })
      return
    }
    if (ready && message?.type === 'finished' && finishRequested && !finishAcknowledged) {
      finishAcknowledged = true
      return
    }
    fail(new Error('Breadcrumb query worker returned an invalid frame or session message.'))
  })
  worker.once('error', (error) => fail(createWorkerError(error)))
  worker.once('exit', (code) => {
    exited = true
    clearTimeout(timeout)
    input.signal?.removeEventListener('abort', abort)
    const error = failure ?? (code === 0 && finishRequested && finishAcknowledged
      ? null : new Error(`Breadcrumb query worker exited without acknowledged completion (code ${code}).`))
    if (error === null) resolveCompletion()
    else {
      failure = error
      rejectStarted(error)
      pendingRead?.reject(error)
      pendingRead = null
      rejectCompletion(error)
    }
    resolveExited()
  })
  return started
}

/** Accepts only the bounded scalar manifest understood by both consumers. */
function isManifest(value) {
  const counts = ['positionCount', 'deviceTotalCount', 'deviceSelectionCount', 'droppedPositionCount']
  return value !== null && typeof value === 'object'
    && value.version === BREADCRUMB_QUERY_TRANSPORT_VERSION
    && Object.keys(value).length === counts.length + 1
    && counts.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)
}

/** Keeps arbitrary worker failures bounded before they reach renderer-facing logs. */
function createWorkerError(message) {
  const detail = String(message?.message ?? 'unknown error').replace(/[\r\n]+/gu, ' ').trim().slice(0, 500)
  const error = new Error(`Breadcrumb query worker failed: ${detail}`)
  const name = String(message?.name ?? '')
  if (/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(name)) error.name = name
  return error
}

/** Identifies lifecycle cancellation without disguising it as query success. */
function createAbortError() {
  const error = new Error('Breadcrumb query session was cancelled.')
  error.name = 'AbortError'
  return error
}

module.exports = { startBreadcrumbQuerySession }
