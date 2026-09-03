'use strict'

const path = require('node:path')
const { Worker } = require('node:worker_threads')

const { normalizeRestoreRequest } = require('./archive-restore.cjs')
const {
  closeTransferredFileHandle,
} = require('./transferred-file-handle-cleanup.cjs')
const {
  deriveArchiveWorkloadWatchdogMs,
} = require('./archive-workload-watchdog.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'archive-restore-worker.cjs')
const DEFAULT_WATCHDOG_MS = 60_000
const DEFAULT_CANCEL_GRACE_MS = 500
const FAILURE_CODES = new Set([
  'ARCHIVE_CANCELLED',
  'ARCHIVE_RESTORE_AUTHENTICATION_FAILED',
  'ARCHIVE_RESTORE_CIPHERTEXT_MISMATCH',
  'ARCHIVE_RESTORE_CLEANUP_FAILED',
  'ARCHIVE_RESTORE_DISK_FULL',
  'ARCHIVE_RESTORE_FAILED',
  'ARCHIVE_RESTORE_REQUEST_INVALID',
  'ARCHIVE_RESTORE_SCOPE_INVALID',
  'ARCHIVE_RESTORE_SQLITE_INVALID',
  'ARCHIVE_RESTORE_UNSUPPORTED_FORMAT',
  'ARCHIVE_RESTORE_WRONG_KEY',
])
const PHASE_ORDER = Object.freeze([
  'preflight', 'keys', 'ciphertext', 'decrypt', 'validate', 'ready',
])

/** Creates an owned, unpooled UTF-8 buffer for transfer and zeroing. */
function createOwnedSecretBuffer(value) {
  if (typeof value !== 'string'
    || Buffer.byteLength(value, 'utf8') < 1
    || Buffer.byteLength(value, 'utf8') > 1_024) {
    throw createFailure('ARCHIVE_RESTORE_REQUEST_INVALID')
  }
  const buffer = Buffer.allocUnsafeSlow(Buffer.byteLength(value, 'utf8'))
  buffer.write(value, 'utf8')
  return buffer
}

/** Zeroes a credential buffer when transfer did not detach it. */
function zeroIfAttached(buffer) {
  if (buffer.buffer.byteLength > 0) buffer.fill(0)
}

/** Starts one independent v2 archive review restore. */
function startArchiveRestore(input) {
  const request = normalizeRestoreRequest(input?.request)
  const watchdogMs = normalizeDuration(
    input.watchdogMs,
    DEFAULT_WATCHDOG_MS,
    1,
    30 * 60_000,
    'Archive restore watchdog',
  )
  const cancelGraceMs = normalizeDuration(
    input.cancelGraceMs,
    DEFAULT_CANCEL_GRACE_MS,
    0,
    30_000,
    'Archive restore cancellation grace',
  )
  const secret = createOwnedSecretBuffer(input?.secret)
  const workerExited = createDeferred()
  if (input.signal?.aborted === true) {
    zeroIfAttached(secret)
    const rejected = Promise.reject(createAbortError())
    workerExited.resolve()
    return decorate(rejected, workerExited.promise, () => undefined)
  }
  const cancellationBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const cancellationFlag = new Int32Array(cancellationBuffer)
  let worker
  let cancel = () => undefined

  const completion = new Promise((resolve, reject) => {
    try {
      const workerInput = {
        workerPath: input.workerPath ?? DEFAULT_WORKER_PATH,
        workerData: Object.freeze({ request, cancellationBuffer }),
      }
      worker = input.createWorker?.(workerInput)
        ?? (input.WorkerClass === undefined
          ? new Worker(workerInput.workerPath, { workerData: workerInput.workerData })
          : new input.WorkerClass(workerInput.workerPath, { workerData: workerInput.workerData }))
    } catch {
      zeroIfAttached(secret)
      workerExited.resolve()
      reject(createFailure('ARCHIVE_RESTORE_FAILED'))
      return
    }
    let settled = false
    let terminal = null
    let terminalSeen = false
    let lastProgress = null
    let watchdogTimer = null
    let terminationTimer = null
    const handleClosures = new Map()

    /** Closes a transferred database handle that never reached the session source. */
    const closeDatabaseHandle = (candidate) => {
      const handle = candidate?.databaseFileHandle
      if (handle === null || typeof handle !== 'object' || typeof handle.close !== 'function') return
      if (handleClosures.has(handle)) return
      const closing = closeTransferredFileHandle(handle)
      handleClosures.set(handle, closing)
      void closing.finally(() => handleClosures.delete(handle))
    }

    /** Clears lifecycle listeners only after physical worker exit. */
    const cleanup = () => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      if (terminationTimer !== null) clearTimeout(terminationTimer)
      input.signal?.removeEventListener('abort', handleAbort)
    }

    /** Rejects public completion once while preserving physical-exit ownership. */
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      input.signal?.removeEventListener('abort', handleAbort)
      reject(error)
    }

    /** Cooperatively cancels and then bounds forced physical termination. */
    const cancelAndReject = (error) => {
      if (Atomics.compareExchange(cancellationFlag, 0, 0, 1) === 0) {
        try { worker.postMessage({ type: 'cancel', operationId: request.operationId }) } catch {}
      }
      rejectOnce(error)
      closeDatabaseHandle(terminal)
      terminal = null
      if (terminationTimer === null) {
        terminationTimer = setTimeout(() => {
          try { void Promise.resolve(worker.terminate()).catch(() => undefined) } catch {}
        }, cancelGraceMs)
      }
    }

    cancel = () => cancelAndReject(createAbortError())
    const handleAbort = () => cancel()
    const resetWatchdog = (durationMs = watchdogMs) => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      watchdogTimer = setTimeout(() => {
        cancelAndReject(createFailure('ARCHIVE_RESTORE_FAILED'))
      }, durationMs)
    }
    input.signal?.addEventListener('abort', handleAbort, { once: true })
    resetWatchdog()

    worker.on('message', (message) => {
      if (settled) {
        if (message?.type === 'complete') closeDatabaseHandle(message)
        return
      }
      if (message?.type === 'progress') {
        if (terminalSeen || !isValidProgress(message, request, lastProgress)) {
          cancelAndReject(createFailure('ARCHIVE_RESTORE_FAILED'))
          return
        }
        const meaningful = isMeaningfulProgress(message, lastProgress)
        lastProgress = message
        if (meaningful) resetWatchdog(deriveArchiveWorkloadWatchdogMs(message, watchdogMs))
        try { input.onProgress?.(projectProgress(message)) } catch {
          cancelAndReject(createFailure('ARCHIVE_RESTORE_FAILED'))
        }
        return
      }
      if (message?.type === 'complete') {
        if (terminalSeen) {
          closeDatabaseHandle(message)
          cancelAndReject(createFailure('ARCHIVE_RESTORE_FAILED'))
          return
        }
        terminalSeen = true
        try { terminal = normalizeResult(message, request) } catch {
          closeDatabaseHandle(message)
          cancelAndReject(createFailure('ARCHIVE_RESTORE_FAILED'))
        }
        return
      }
      if (message?.type === 'error') {
        terminalSeen = true
        cancelAndReject(message.operationId === request.operationId
          ? (message.code === 'ARCHIVE_CANCELLED'
              ? createAbortError()
              : createFailure(FAILURE_CODES.has(message.code) ? message.code : 'ARCHIVE_RESTORE_FAILED'))
          : createFailure('ARCHIVE_RESTORE_FAILED'))
        return
      }
      cancelAndReject(createFailure('ARCHIVE_RESTORE_FAILED'))
    })
    worker.once('error', () => cancelAndReject(createFailure('ARCHIVE_RESTORE_FAILED')))
    worker.once('exit', (code) => {
      void (async () => {
        cleanup()
        const success = code === 0 && terminal !== null
        if (!success) {
          closeDatabaseHandle(terminal)
          terminal = null
        }
        await Promise.allSettled([...handleClosures.values()])
        workerExited.resolve()
        if (settled) return
        settled = true
        if (success) resolve(terminal)
        else reject(createFailure('ARCHIVE_RESTORE_FAILED'))
      })()
    })

    try {
      worker.postMessage({
        type: 'credential',
        operationId: request.operationId,
        secretBytes: secret.buffer,
      }, [secret.buffer])
    } catch {
      zeroIfAttached(secret)
      cancelAndReject(createFailure('ARCHIVE_RESTORE_FAILED'))
      return
    }
    zeroIfAttached(secret)
    if (input.signal?.aborted === true) handleAbort()
  })
  return decorate(completion, workerExited.promise, () => cancel())
}

/** Returns true only when a valid progress message proves forward work. */
function isMeaningfulProgress(message, previous) {
  if (previous === null) return true
  return PHASE_ORDER.indexOf(message.phase) > PHASE_ORDER.indexOf(previous.phase)
    || message.completed > previous.completed
}

/** Accepts only strictly monotonic closed restore progress. */
function isValidProgress(message, request, previous) {
  const keys = Object.keys(message ?? {}).sort().join(',')
  if (keys !== 'completed,detail,operationId,phase,sequence,total,type,unit'
    || message.operationId !== request.operationId
    || !PHASE_ORDER.includes(message.phase)
    || !['bytes', 'files'].includes(message.unit)
    || !Number.isSafeInteger(message.sequence) || message.sequence < 1
    || !Number.isSafeInteger(message.completed) || message.completed < 0
    || (message.total !== null && (!Number.isSafeInteger(message.total)
      || message.total < message.completed))
    || typeof message.detail !== 'string'
    || Buffer.byteLength(message.detail, 'utf8') > 200
    || (message.phase === 'validate'
      && (message.unit !== 'bytes' || message.total === null
        || message.total < 1 || message.total > request.sizeBytes))) return false
  if (previous === null) return true
  const priorPhase = PHASE_ORDER.indexOf(previous.phase)
  const nextPhase = PHASE_ORDER.indexOf(message.phase)
  return message.sequence > previous.sequence
    && nextPhase >= priorPhase
    && (nextPhase > priorPhase || message.completed >= previous.completed)
}

/** Removes internal routing identity from public progress. */
function projectProgress(message) {
  return Object.freeze({
    sequence: message.sequence,
    phase: message.phase,
    unit: message.unit,
    completed: message.completed,
    total: message.total,
    detail: message.detail,
  })
}

/** Shape-closes a successful worker result for the main-isolate manager. */
function normalizeResult(message, request) {
  const keys = Object.keys(message ?? {}).sort().join(',')
  if (keys !== 'archiveId,attachmentMappings,databaseFileHandle,databaseIdentity,databasePath,databaseSha256,missionId,operationId,sessionDirectory,sessionId,type'
    || message.operationId !== request.operationId
    || message.sessionId !== request.sessionId
    || message.archiveId !== request.archiveId
    || message.missionId !== request.missionId
    || typeof message.databasePath !== 'string'
    || message.databasePath !== path.join(request.reviewRoot, request.sessionId, 'mission-store.sqlite')
    || message.sessionDirectory !== path.join(request.reviewRoot, request.sessionId)
    || message.databaseIdentity === null
    || typeof message.databaseIdentity !== 'object'
    || Array.isArray(message.databaseIdentity)
    || Object.keys(message.databaseIdentity).sort().join(',') !== 'dev,ino,sizeBytes'
    || !Number.isSafeInteger(message.databaseIdentity.dev) || message.databaseIdentity.dev < 0
    || !Number.isSafeInteger(message.databaseIdentity.ino) || message.databaseIdentity.ino < 1
    || !Number.isSafeInteger(message.databaseIdentity.sizeBytes)
    || message.databaseIdentity.sizeBytes < 1
    || typeof message.databaseSha256 !== 'string'
    || !/^[0-9a-f]{64}$/u.test(message.databaseSha256)
    || message.databaseFileHandle === null
    || typeof message.databaseFileHandle !== 'object'
    || !Number.isSafeInteger(message.databaseFileHandle.fd)
    || message.databaseFileHandle.fd < 0
    || typeof message.databaseFileHandle.close !== 'function'
    || !Array.isArray(message.attachmentMappings)
    || Buffer.byteLength(JSON.stringify(message.attachmentMappings), 'utf8') > 4 * 1024 * 1024) {
    throw createFailure('ARCHIVE_RESTORE_FAILED')
  }
  return Object.freeze({
    operationId: request.operationId,
    sessionId: request.sessionId,
    archiveId: request.archiveId,
    missionId: request.missionId,
    databasePath: message.databasePath,
    databaseIdentity: Object.freeze({ ...message.databaseIdentity }),
    databaseSha256: message.databaseSha256,
    databaseFileHandle: message.databaseFileHandle,
    sessionDirectory: message.sessionDirectory,
    attachmentMappings: Object.freeze(message.attachmentMappings.map((entry) => Object.freeze({ ...entry }))),
  })
}

/** Creates one bounded typed failure. */
function createFailure(code) {
  const normalized = FAILURE_CODES.has(code) ? code : 'ARCHIVE_RESTORE_FAILED'
  const error = new Error(`Archive review restore failed safely (${normalized}).`)
  error.code = normalized
  return error
}

/** Creates a stable cancellation failure. */
function createAbortError() {
  const error = new Error('Archive review restore was cancelled.')
  error.name = 'AbortError'
  error.code = 'ARCHIVE_CANCELLED'
  return error
}

/** Applies one bounded duration override. */
function normalizeDuration(value, fallback, minimum, maximum, label) {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is invalid.`)
  }
  return Math.floor(value)
}

/** Decorates public completion with explicit physical-exit and cancellation ownership. */
function decorate(completion, workerExited, cancel) {
  Object.defineProperties(completion, {
    workerExited: { value: workerExited },
    cancel: { value: cancel },
  })
  return completion
}

/** Creates a single-settlement deferred. */
function createDeferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

module.exports = { startArchiveRestore }
