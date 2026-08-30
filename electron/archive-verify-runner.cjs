'use strict'

const path = require('node:path')
const { Worker } = require('node:worker_threads')

const {
  normalizeArchiveVerifyProgress,
  normalizeArchiveVerifyRequest,
  normalizeArchiveVerifyResult,
} = require('./archive-envelope.cjs')
const { deriveArchiveWorkloadWatchdogMs } = require('./archive-workload-watchdog.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'archive-verify-worker.cjs')
const DEFAULT_WATCHDOG_MS = 60_000
const DEFAULT_CANCEL_GRACE_MS = 500
const PROGRESS_PHASE_ORDER = Object.freeze([
  'preflight',
  'keys',
  'decrypt',
  'entries',
  'sqlite',
  'inventory',
  'gpx',
  'attachments',
  'replay',
  'plaintext_cleanup',
  'complete',
])
const WORKER_FAILURE_CODES = new Set([
  'ARCHIVE_CANCELLED',
  'ARCHIVE_VERIFY_ARCHIVE_CHANGED',
  'ARCHIVE_VERIFY_ARCHIVE_UNAVAILABLE',
  'ARCHIVE_VERIFY_ATTACHMENT_MISMATCH',
  'ARCHIVE_VERIFY_AUTHENTICATION_FAILED',
  'ARCHIVE_VERIFY_CIPHERTEXT_MISMATCH',
  'ARCHIVE_VERIFY_DISK_FULL',
  'ARCHIVE_VERIFY_ENTRY_MISMATCH',
  'ARCHIVE_VERIFY_FAILED',
  'ARCHIVE_VERIFY_FORMAT_INVALID',
  'ARCHIVE_VERIFY_GPX_MISMATCH',
  'ARCHIVE_VERIFY_IDENTITY_MISMATCH',
  'ARCHIVE_VERIFY_INVENTORY_MISMATCH',
  'ARCHIVE_VERIFY_LIVE_STORE_UNAVAILABLE',
  'ARCHIVE_VERIFY_MANIFEST_INVALID',
  'ARCHIVE_VERIFY_PLAINTEXT_CLEANUP_FAILED',
  'ARCHIVE_VERIFY_REPLAY_MISMATCH',
  'ARCHIVE_VERIFY_SCHEMA_MISMATCH',
  'ARCHIVE_VERIFY_SCOPE_MISMATCH',
  'ARCHIVE_VERIFY_SLOT_MISMATCH',
  'ARCHIVE_VERIFY_SQLITE_INVALID',
  'ARCHIVE_VERIFY_TABLE_MISMATCH',
  'ARCHIVE_VERIFY_UNSUPPORTED_FORMAT',
  'ARCHIVE_VERIFY_WRONG_KEY',
])

/** Creates an owned, unpooled UTF-8 buffer suitable for exact transfer and zeroing. */
function createOwnedSecretBuffer(value) {
  const byteLength = Buffer.byteLength(value, 'utf8')
  const buffer = Buffer.allocUnsafeSlow(byteLength)
  buffer.write(value, 'utf8')
  return buffer
}

/** Best-effort zeroes a buffer that was not detached by successful transfer. */
function zeroIfAttached(buffer) {
  if (buffer.buffer.byteLength > 0) buffer.fill(0)
}

/** Returns a closed non-secret request projection for workerData. */
function projectNonSecretRequest(request) {
  const { passphrase: _passphrase, recoveryCode: _recoveryCode, ...nonSecret } = request
  return Object.freeze(nonSecret)
}

/** Starts independent archive verification without placing credentials in workerData. */
function startArchiveVerifyWorker(input) {
  const request = normalizeArchiveVerifyRequest(input?.request)
  const workerExited = createDeferred()
  if (input.signal?.aborted === true) {
    const rejected = Promise.reject(createAbortError())
    workerExited.resolve()
    return decorateOperation(rejected, workerExited.promise, () => undefined)
  }
  const watchdogMs = normalizeDuration(
    input.watchdogMs,
    DEFAULT_WATCHDOG_MS,
    1,
    30 * 60_000,
    'Mission archive verify watchdog',
  )
  const cancelGraceMs = normalizeDuration(
    input.cancelGraceMs,
    DEFAULT_CANCEL_GRACE_MS,
    0,
    30_000,
    'Mission archive verify cancellation grace period',
  )
  const cancellationBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const cancellationFlag = new Int32Array(cancellationBuffer)
  let worker
  let cancel = () => undefined

  const completion = new Promise((resolve, reject) => {
    try {
      const workerInput = {
        workerData: Object.freeze({
          request: projectNonSecretRequest(request),
          cancellationBuffer,
        }),
        workerPath: input.workerPath ?? DEFAULT_WORKER_PATH,
      }
      worker = input.createWorker?.(workerInput) ?? new Worker(workerInput.workerPath, {
        workerData: workerInput.workerData,
      })
    } catch (error) {
      workerExited.resolve()
      reject(error)
      return
    }
    let settled = false
    let terminalResult = null
    let terminalMessageSeen = false
    let watchdogTimer = null
    let terminationTimer = null
    let lastProgress = null

    /** Clears lifecycle resources after physical worker termination. */
    const cleanup = () => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      if (terminationTimer !== null) clearTimeout(terminationTimer)
      input.signal?.removeEventListener('abort', handleAbort)
    }

    /** Rejects the public operation once without claiming physical exit. */
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      input.signal?.removeEventListener('abort', handleAbort)
      reject(error)
    }

    /** Requests cooperative cancellation, then forces termination after the bounded grace. */
    const cancelAndReject = (error) => {
      if (Atomics.compareExchange(cancellationFlag, 0, 0, 1) === 0) {
        try {
          worker.postMessage({ type: 'cancel', operationId: request.operationId })
        } catch {
          // The shared flag remains authoritative if the port is already closed.
        }
      }
      rejectOnce(error)
      if (terminationTimer === null) {
        terminationTimer = setTimeout(() => {
          void Promise.resolve(worker.terminate()).catch(() => undefined)
        }, cancelGraceMs)
      }
    }

    cancel = () => cancelAndReject(createAbortError())
    const handleAbort = () => cancel()

    /** Starts a fresh lack-of-progress deadline. */
    const resetWatchdog = (deadlineMs = watchdogMs) => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      watchdogTimer = setTimeout(() => {
        cancelAndReject(new Error('Mission archive verify worker stopped making bounded progress.'))
      }, deadlineMs)
    }

    input.signal?.addEventListener('abort', handleAbort, { once: true })
    resetWatchdog()

    worker.on('message', (message) => {
      if (settled) return
      if (message?.type === 'progress') {
        if (terminalMessageSeen) {
          cancelAndReject(new Error('Mission archive verify worker emitted data after completion.'))
          return
        }
        let progress
        try {
          progress = normalizeArchiveVerifyProgress(message, request.operationId)
          assertProgressAdvance(progress, lastProgress)
        } catch {
          cancelAndReject(new Error('Mission archive verify worker emitted invalid progress.'))
          return
        }
        if (isMeaningfulProgress(progress, lastProgress)) {
          resetWatchdog(deriveArchiveWorkloadWatchdogMs(progress, watchdogMs))
        }
        lastProgress = progress
        try {
          input.onProgress?.(progress)
        } catch {
          cancelAndReject(new Error('Mission archive verify progress observer failed safely.'))
        }
        return
      }
      if (message?.type === 'complete') {
        if (terminalMessageSeen) {
          cancelAndReject(new Error('Mission archive verify worker emitted duplicate terminal data.'))
          return
        }
        terminalMessageSeen = true
        try {
          terminalResult = normalizeArchiveVerifyResult(message, request)
        } catch {
          cancelAndReject(new Error('Mission archive verify worker returned a substituted result.'))
        }
        return
      }
      if (message?.type === 'error') {
        terminalMessageSeen = true
        cancelAndReject(createClosedWorkerFailure(message, request.operationId))
        return
      }
      cancelAndReject(new Error('Mission archive verify worker emitted an unsupported message.'))
    })

    worker.once('error', () => {
      cancelAndReject(new Error('Mission archive verify worker failed unexpectedly.'))
    })

    worker.once('exit', (code) => {
      workerExited.resolve()
      cleanup()
      if (settled) return
      settled = true
      if (code === 0 && terminalResult !== null) {
        resolve(terminalResult)
        return
      }
      reject(new Error(
        `Mission archive verify worker exited without a valid completion (code ${code}).`,
      ))
    })

    if (input.signal?.aborted === true) {
      handleAbort()
      return
    }
    const passphraseBytes = createOwnedSecretBuffer(request.passphrase)
    const recoveryCodeBytes = createOwnedSecretBuffer(request.recoveryCode)
    try {
      worker.postMessage({
        type: 'credentials',
        operationId: request.operationId,
        passphraseBytes: passphraseBytes.buffer,
        recoveryCodeBytes: recoveryCodeBytes.buffer,
      }, [passphraseBytes.buffer, recoveryCodeBytes.buffer])
    } catch {
      zeroIfAttached(passphraseBytes)
      zeroIfAttached(recoveryCodeBytes)
      cancelAndReject(new Error('Mission archive verify credentials could not be transferred safely.'))
      return
    }
    zeroIfAttached(passphraseBytes)
    zeroIfAttached(recoveryCodeBytes)
  })
  return decorateOperation(completion, workerExited.promise, () => cancel())
}

/** Validates strict progress sequence, phase and counter monotonicity. */
function assertProgressAdvance(progress, previous) {
  if (previous === null) return
  if (progress.sequence <= previous.sequence) throw new Error('Verify progress sequence regressed.')
  const previousPhase = PROGRESS_PHASE_ORDER.indexOf(previous.phase)
  const currentPhase = PROGRESS_PHASE_ORDER.indexOf(progress.phase)
  if (currentPhase < previousPhase) throw new Error('Verify progress phase regressed.')
  if (currentPhase === previousPhase && (
    progress.unit !== previous.unit
    || progress.total !== previous.total
    || progress.completed < previous.completed
  )) throw new Error('Verify progress counter changed shape.')
}

/** Returns true only when a valid message proves actual forward work. */
function isMeaningfulProgress(progress, previous) {
  if (previous === null) return true
  const previousPhase = PROGRESS_PHASE_ORDER.indexOf(previous.phase)
  const currentPhase = PROGRESS_PHASE_ORDER.indexOf(progress.phase)
  return currentPhase > previousPhase || progress.completed > previous.completed
}

/** Creates a bounded typed failure without reflecting worker-controlled text. */
function createClosedWorkerFailure(message, operationId) {
  const code = message?.operationId === operationId && WORKER_FAILURE_CODES.has(message?.code)
    ? message.code
    : 'ARCHIVE_VERIFY_FAILED'
  const error = new Error(`Mission archive verify worker failed safely (${code}).`)
  error.code = code
  return error
}

/** Creates a stable cancellation error for caller fencing. */
function createAbortError() {
  const error = new Error('Mission archive verify worker was cancelled.')
  error.name = 'AbortError'
  error.code = 'ARCHIVE_CANCELLED'
  return error
}

/** Normalizes one bounded runner-only duration. */
function normalizeDuration(value, fallback, minimum, maximum, label) {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum} ms.`)
  }
  return Math.floor(value)
}

/** Decorates one promise with physical-exit ownership and explicit cancellation. */
function decorateOperation(completion, workerExited, cancel) {
  Object.defineProperties(completion, {
    workerExited: { configurable: false, enumerable: false, value: workerExited },
    cancel: { configurable: false, enumerable: false, value: cancel },
  })
  return completion
}

/** Creates a tiny single-settlement deferred. */
function createDeferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

module.exports = { startArchiveVerifyWorker }
