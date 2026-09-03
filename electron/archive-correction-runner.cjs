'use strict'

const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { Worker } = require('node:worker_threads')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'archive-correction-worker.cjs')
const CANCEL_GRACE_MS = 2_000
const FAILURE_CODES = new Set([
  'ARCHIVE_CANCELLED',
  'ARCHIVE_REHYDRATE_EPOCH_CHANGED',
  'ARCHIVE_REHYDRATE_FAILED',
  'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID',
  'ARCHIVE_REHYDRATE_LIVE_ACTIVITY',
  'ARCHIVE_REHYDRATE_LIVE_ROWS_PRESENT',
  'ARCHIVE_REHYDRATE_REQUEST_INVALID',
  'ARCHIVE_REHYDRATE_SCHEMA_INVALID',
  'ARCHIVE_REHYDRATE_SCOPE_INVALID',
  'ARCHIVE_REHYDRATE_SNAPSHOT_INVALID',
  'ARCHIVE_REHYDRATE_SNAPSHOT_UNAVAILABLE',
])

/** Starts one correction restore in a worker-owned SQLite connection. */
function startArchiveCorrectionWorker(input) {
  const request = normalizeRequest(input)
  const cancellationBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const cancellationFlag = new Int32Array(cancellationBuffer)
  const workerExited = createDeferred()
  let worker
  let settled = false
  let terminal = null
  let cancelOperation = () => undefined
  let terminationTimer = null

  const completion = new Promise((resolve, reject) => {
    try {
      const workerInput = {
        workerPath: request.workerPath,
        workerData: { ...request, cancellationBuffer },
      }
      worker = request.createWorker?.(workerInput)
        ?? new Worker(workerInput.workerPath, { workerData: workerInput.workerData })
    } catch {
      workerExited.resolve()
      reject(createFailure('ARCHIVE_REHYDRATE_FAILED'))
      return
    }

    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const cancel = () => {
      if (terminal !== null) {
        try { void Promise.resolve(worker.terminate()).catch(() => undefined) } catch {}
        return
      }
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
    if (request.signal !== undefined) {
      request.signal.addEventListener('abort', cancel, { once: true })
    }
    worker.on('message', (message) => {
      if (settled || terminal !== null) return
      if (message?.type === 'complete') {
        if (terminal !== null || !isComplete(message, request)) {
          rejectOnce(createFailure('ARCHIVE_REHYDRATE_FAILED'))
          return
        }
        terminal = Object.freeze({ missionId: message.missionId, archiveId: message.archiveId })
        return
      }
      if (message?.type === 'error') {
        const code = FAILURE_CODES.has(message.code)
          ? message.code
          : 'ARCHIVE_REHYDRATE_FAILED'
        rejectOnce(createFailure(code))
        return
      }
      rejectOnce(createFailure('ARCHIVE_REHYDRATE_FAILED'))
    })
    worker.once('error', () => {
      if (terminal === null) rejectOnce(createFailure('ARCHIVE_REHYDRATE_FAILED'))
    })
    worker.once('exit', (code) => {
      if (terminationTimer !== null) clearTimeout(terminationTimer)
      request.signal?.removeEventListener('abort', cancel)
      workerExited.resolve()
      if (settled) return
      settled = true
      if (terminal !== null) resolve(terminal)
      else reject(createFailure('ARCHIVE_REHYDRATE_FAILED'))
    })
    if (request.signal?.aborted === true) cancel()
  })
  Object.defineProperty(completion, 'workerExited', { value: workerExited.promise })
  Object.defineProperty(completion, 'cancel', { value: () => cancelOperation() })
  return completion
}

/** Validates the bounded worker request without reflecting paths or authority. */
function normalizeRequest(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw createFailure('ARCHIVE_REHYDRATE_REQUEST_INVALID')
  }
  const fields = ['databasePath', 'snapshotPath', 'missionId', 'archiveId', 'operationId',
    'finalizedEpoch', 'adminName', 'reason', 'attachmentDirectory', 'attachmentMappings',
    'faultInjection', 'workerPath', 'signal', 'createWorker']
  if (Object.keys(input).some((key) => !fields.includes(key))) {
    throw createFailure('ARCHIVE_REHYDRATE_REQUEST_INVALID')
  }
  for (const [key, maximum] of [['databasePath', 8_192], ['snapshotPath', 8_192],
    ['missionId', 200], ['archiveId', 200], ['adminName', 160], ['reason', 4_000]]) {
    const value = input[key]
    if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value, 'utf8') > maximum) {
      throw createFailure('ARCHIVE_REHYDRATE_REQUEST_INVALID')
    }
  }
  if (!path.isAbsolute(input.databasePath) || path.resolve(input.databasePath) !== input.databasePath
    || !path.isAbsolute(input.snapshotPath) || path.resolve(input.snapshotPath) !== input.snapshotPath) {
    throw createFailure('ARCHIVE_REHYDRATE_REQUEST_INVALID')
  }
  if (typeof input.attachmentDirectory !== 'string'
    || !path.isAbsolute(input.attachmentDirectory)
    || path.resolve(input.attachmentDirectory) !== input.attachmentDirectory
    || Buffer.byteLength(input.attachmentDirectory, 'utf8') > 8_192
    || !Array.isArray(input.attachmentMappings)
    || Buffer.byteLength(JSON.stringify(input.attachmentMappings), 'utf8') > 4 * 1024 * 1024) {
    throw createFailure('ARCHIVE_REHYDRATE_REQUEST_INVALID')
  }
  if (input.operationId !== undefined
    && (typeof input.operationId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/u.test(input.operationId))) {
    throw createFailure('ARCHIVE_REHYDRATE_REQUEST_INVALID')
  }
  if (!Number.isSafeInteger(input.finalizedEpoch) || input.finalizedEpoch < 1) {
    throw createFailure('ARCHIVE_REHYDRATE_REQUEST_INVALID')
  }
  const workerPath = input.workerPath ?? DEFAULT_WORKER_PATH
  if (typeof workerPath !== 'string' || !path.isAbsolute(workerPath)
    || path.resolve(workerPath) !== workerPath || Buffer.byteLength(workerPath, 'utf8') > 8_192) {
    throw createFailure('ARCHIVE_REHYDRATE_REQUEST_INVALID')
  }
  if (input.signal !== undefined && typeof input.signal.addEventListener !== 'function') {
    throw createFailure('ARCHIVE_REHYDRATE_REQUEST_INVALID')
  }
  if (input.createWorker !== undefined && typeof input.createWorker !== 'function') {
    throw createFailure('ARCHIVE_REHYDRATE_REQUEST_INVALID')
  }
  if (input.faultInjection !== undefined
    && (input.faultInjection === null || typeof input.faultInjection !== 'object'
      || Array.isArray(input.faultInjection))) {
    throw createFailure('ARCHIVE_REHYDRATE_REQUEST_INVALID')
  }
  return Object.freeze({
    databasePath: input.databasePath,
    snapshotPath: input.snapshotPath,
    missionId: input.missionId,
    archiveId: input.archiveId,
    operationId: typeof input.operationId === 'string' && /^[A-Za-z0-9_-]{1,200}$/u.test(input.operationId)
      ? input.operationId
      : randomUUID(),
    finalizedEpoch: input.finalizedEpoch,
    adminName: input.adminName,
    reason: input.reason,
    attachmentDirectory: input.attachmentDirectory,
    attachmentMappings: Object.freeze(input.attachmentMappings.map((entry) => Object.freeze({ ...entry }))),
    faultInjection: input.faultInjection && typeof input.faultInjection === 'object'
      ? Object.freeze({ ...input.faultInjection })
      : Object.freeze({}),
    workerPath,
    signal: input.signal,
    createWorker: input.createWorker,
  })
}

/** Returns one closed correction failure. */
function createFailure(code) {
  const error = new Error(`Archive correction restore failed safely (${code}).`)
  error.code = code
  return error
}

/** Validates the single closed worker completion envelope. */
function isComplete(message, request) {
  return Object.keys(message).sort().join(',') === 'archiveId,missionId,type'
    && message.missionId === request.missionId
    && message.archiveId === request.archiveId
}

/** Creates one externally-resolvable worker-exit promise. */
function createDeferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

module.exports = { startArchiveCorrectionWorker }
