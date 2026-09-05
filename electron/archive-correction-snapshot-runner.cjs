'use strict'

const path = require('node:path')
const { Worker } = require('node:worker_threads')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'archive-correction-snapshot-worker.cjs')
const FAILURE_CODES = new Set([
  'ARCHIVE_CANCELLED',
  'ARCHIVE_REVIEW_RESTORE_SUBSTITUTED',
])

/** Starts one bounded correction snapshot outside the Electron main isolate. */
function startArchiveCorrectionSnapshot(input) {
  const request = normalizeRequest(input)
  const cancellationBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const cancellationFlag = new Int32Array(cancellationBuffer)
  const workerExited = deferred()
  let worker
  let settled = false
  let completionResult = null
  let cancel = () => undefined
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
      reject(failure())
      return
    }
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    cancel = () => {
      Atomics.store(cancellationFlag, 0, 1)
      try { worker.postMessage({ type: 'cancel' }) } catch {}
      rejectOnce(failure('ARCHIVE_CANCELLED'))
      try { void Promise.resolve(worker.terminate()).catch(() => undefined) } catch {}
    }
    worker.on('message', (message) => {
      if (settled) return
      if (message?.type === 'complete') {
        if (completionResult !== null) {
          rejectOnce(failure())
          return
        }
        if (!isComplete(message, request)) {
          rejectOnce(failure())
          return
        }
        completionResult = Object.freeze({
          snapshotPath: message.snapshotPath,
          attachmentDirectory: message.attachmentDirectory,
          attachmentMappings: Object.freeze(message.attachmentMappings.map((entry) => Object.freeze({ ...entry }))),
          databaseIdentity: Object.freeze({ ...message.databaseIdentity }),
          databaseSha256: message.databaseSha256,
        })
        return
      }
      if (message?.type === 'error') {
        rejectOnce(failure(FAILURE_CODES.has(message.code) ? message.code : undefined))
        return
      }
      rejectOnce(failure())
    })
    worker.once('error', () => rejectOnce(failure()))
    worker.once('exit', (exitCode) => {
      request.signal?.removeEventListener('abort', cancel)
      workerExited.resolve()
      if (settled) return
      settled = true
      if (completionResult !== null && exitCode === 0) {
        resolve(completionResult)
        return
      }
      reject(failure())
    })
    request.signal?.addEventListener('abort', cancel, { once: true })
    if (request.signal?.aborted === true) cancel()
  })
  Object.defineProperty(completion, 'workerExited', { value: workerExited.promise })
  Object.defineProperty(completion, 'cancel', { value: () => cancel() })
  return completion
}

/** Validates the bounded worker request before it reaches a new thread. */
function normalizeRequest(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw failure()
  const fields = [
    'sourcePath', 'sourceIdentity', 'expectedSha256', 'stagingDirectory',
    'snapshotPath', 'attachmentDirectory', 'attachmentMappings', 'workerPath',
    'signal', 'createWorker',
  ]
  if (Object.keys(input).some((key) => !fields.includes(key))) throw failure()
  for (const key of ['sourcePath', 'stagingDirectory', 'snapshotPath', 'attachmentDirectory']) {
    if (typeof input[key] !== 'string' || !path.isAbsolute(input[key])
      || path.resolve(input[key]) !== input[key] || Buffer.byteLength(input[key], 'utf8') > 8_192) {
      throw failure()
    }
  }
  if (input.snapshotPath !== path.join(input.stagingDirectory, 'mission-store.sqlite')
    || input.attachmentDirectory !== path.join(input.stagingDirectory, 'attachments')
    || input.sourceIdentity === null || typeof input.sourceIdentity !== 'object'
    || !Number.isSafeInteger(input.sourceIdentity.dev)
    || !Number.isSafeInteger(input.sourceIdentity.ino)
    || !Number.isSafeInteger(input.sourceIdentity.sizeBytes)
    || input.sourceIdentity.sizeBytes < 1
    || !/^[0-9a-f]{64}$/u.test(input.expectedSha256 ?? '')
    || !Array.isArray(input.attachmentMappings)
    || Buffer.byteLength(JSON.stringify(input.attachmentMappings), 'utf8') > 4 * 1024 * 1024) throw failure()
  const workerPath = input.workerPath ?? DEFAULT_WORKER_PATH
  if (typeof workerPath !== 'string' || !path.isAbsolute(workerPath)
    || path.resolve(workerPath) !== workerPath || Buffer.byteLength(workerPath, 'utf8') > 8_192) {
    throw failure()
  }
  if (input.signal !== undefined && typeof input.signal.addEventListener !== 'function') throw failure()
  if (input.createWorker !== undefined && typeof input.createWorker !== 'function') throw failure()
  return Object.freeze({
    sourcePath: input.sourcePath,
    sourceIdentity: Object.freeze({ ...input.sourceIdentity }),
    expectedSha256: input.expectedSha256,
    stagingDirectory: input.stagingDirectory,
    snapshotPath: input.snapshotPath,
    attachmentDirectory: input.attachmentDirectory,
    attachmentMappings: Object.freeze(input.attachmentMappings.map((entry) => Object.freeze({ ...entry }))),
    workerPath,
    signal: input.signal,
    createWorker: input.createWorker,
  })
}

/** Returns one stable snapshot failure without exposing paths or secrets. */
function failure(code = 'ARCHIVE_REVIEW_RESTORE_SUBSTITUTED') {
  const error = new Error(`Archive correction snapshot failed safely (${code}).`)
  error.code = code
  return error
}

/** Validates one closed worker completion envelope against the manager-owned paths. */
function isComplete(message, request) {
  return message !== null && typeof message === 'object'
    && Object.keys(message).sort().join(',')
      === 'attachmentDirectory,attachmentMappings,databaseIdentity,databaseSha256,snapshotPath,type'
    && message.snapshotPath === request.snapshotPath
    && message.attachmentDirectory === request.attachmentDirectory
    && Array.isArray(message.attachmentMappings)
    && message.databaseIdentity !== null
    && Number.isSafeInteger(message.databaseIdentity.dev)
    && Number.isSafeInteger(message.databaseIdentity.ino)
    && Number.isSafeInteger(message.databaseIdentity.sizeBytes)
    && message.databaseIdentity.sizeBytes === request.sourceIdentity.sizeBytes
    && /^[0-9a-f]{64}$/u.test(message.databaseSha256 ?? '')
    && message.databaseSha256 === request.expectedSha256
}

/** Creates one externally-resolvable worker-exit promise. */
function deferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

module.exports = { startArchiveCorrectionSnapshot }
