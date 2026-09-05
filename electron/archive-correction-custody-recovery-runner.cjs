'use strict'

const path = require('node:path')
const { Worker } = require('node:worker_threads')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'archive-correction-custody-recovery-worker.cjs')
const CANCEL_GRACE_MS = 2_000

/** Starts worker-owned startup recovery for correction attachment custody. */
function startArchiveCorrectionAttachmentRecovery(input) {
  const request = normalizeRequest(input)
  const workerExited = createDeferred()
  let worker
  let terminal = null
  let settled = false
  let cancelOperation = () => undefined
  let terminationTimer = null
  const cancellationBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const cancellationFlag = new Int32Array(cancellationBuffer)
  const completion = new Promise((resolve, reject) => {
    try {
      const workerInput = {
        workerPath: request.workerPath,
        workerData: { databasePath: request.databasePath, cancellationBuffer },
      }
      worker = request.createWorker?.(workerInput)
        ?? new Worker(workerInput.workerPath, { workerData: workerInput.workerData })
    } catch {
      workerExited.resolve()
      reject(createFailure())
      return
    }

    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const cancel = () => {
      if (settled || terminal !== null) return
      Atomics.store(cancellationFlag, 0, 1)
      try { worker.postMessage({ type: 'cancel' }) } catch {}
      rejectOnce(createFailure('ARCHIVE_CANCELLED'))
      if (terminationTimer === null) {
        terminationTimer = setTimeout(() => {
          try { void Promise.resolve(worker.terminate()).catch(() => undefined) } catch {}
        }, CANCEL_GRACE_MS)
      }
    }
    cancelOperation = cancel
    worker.on('message', (message) => {
      if (settled || terminal !== null) return
      if (message?.type === 'complete' && isComplete(message)) {
        terminal = Object.freeze({ recovered: message.recovered })
        return
      }
      if (message?.type === 'error'
        && message.code === 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED') {
        rejectOnce(createFailure())
        return
      }
      rejectOnce(createFailure())
    })
    worker.once('error', () => {
      if (terminal === null) rejectOnce(createFailure())
    })
    worker.once('exit', (code) => {
      if (terminationTimer !== null) clearTimeout(terminationTimer)
      workerExited.resolve()
      if (settled) return
      settled = true
      if (terminal !== null && code === 0) resolve(terminal)
      else reject(createFailure())
    })
  })
  Object.defineProperty(completion, 'workerExited', { value: workerExited.promise })
  Object.defineProperty(completion, 'cancel', { value: () => cancelOperation() })
  return completion
}

/** Validates the bounded startup recovery request. */
function normalizeRequest(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || typeof input.databasePath !== 'string'
    || !path.isAbsolute(input.databasePath)
    || path.resolve(input.databasePath) !== input.databasePath
    || Buffer.byteLength(input.databasePath, 'utf8') > 8_192
    || (input.workerPath !== undefined && (
      typeof input.workerPath !== 'string'
      || !path.isAbsolute(input.workerPath)
      || path.resolve(input.workerPath) !== input.workerPath
      || Buffer.byteLength(input.workerPath, 'utf8') > 8_192
    ))
    || (input.createWorker !== undefined && typeof input.createWorker !== 'function')) {
    throw createFailure()
  }
  return Object.freeze({
    databasePath: input.databasePath,
    workerPath: input.workerPath ?? DEFAULT_WORKER_PATH,
    createWorker: input.createWorker,
  })
}

/** Returns one closed recovery failure. */
function createFailure(code = 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED') {
  const error = new Error(
    code === 'ARCHIVE_CANCELLED'
      ? 'Archive correction attachment custody recovery was cancelled.'
      : 'Archive correction attachment custody recovery requires operator review before retry.',
  )
  error.code = code
  return error
}

/** Validates the closed worker completion envelope. */
function isComplete(message) {
  return Object.keys(message).sort().join(',') === 'recovered,type'
    && Number.isSafeInteger(message.recovered) && message.recovered >= 0
}

/** Creates one externally-resolvable worker-exit promise. */
function createDeferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

module.exports = { startArchiveCorrectionAttachmentRecovery }
