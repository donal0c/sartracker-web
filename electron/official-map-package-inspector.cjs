'use strict'

const path = require('node:path')
const { Worker } = require('node:worker_threads')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'official-map-package-worker.cjs')
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 300_000
const MAX_TILE_BYTES = 4 * 1024 * 1024
const MAX_WORKER_MESSAGE_LENGTH = 256
const SAFE_WORKER_MESSAGE = /^Official map package [A-Za-z0-9 .,'()\-]+\.$/u
const EXPECTED_RESULT_KEYS = [
  'attestation',
  'bounds',
  'createdAt',
  'maxZoom',
  'minZoom',
  'sizeBytes',
  'tileCount',
  'tileFormat',
  'verifiedAt',
]
const EXPECTED_ATTESTATION_KEYS = ['decoderPolicy', 'identity', 'schemaVersion', 'sha256', 'version']
const DECODER_POLICY = 'native-raster-256-or-512-opaque-v1'
const TILE_FORMATS = new Set(['jpeg', 'jpg', 'png', 'webp'])

/** Runs one official-map package inspection away from Electron's main isolate. */
function inspectOfficialMapPackageInWorker(packagePath, options = {}) {
  if (typeof options.decodeTile !== 'function') {
    return Promise.reject(new Error('Official map package tile decoder is unavailable.'))
  }
  const timeoutMs = normalizeTimeout(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const handshakeTimeoutMs = normalizeTimeout(
    options.handshakeTimeoutMs,
    Math.min(DEFAULT_HANDSHAKE_TIMEOUT_MS, timeoutMs),
  )
  const now = normalizeNow(options.now)
  if (typeof packagePath !== 'string' || packagePath.trim() === '' || packagePath.includes('\0')) {
    return Promise.reject(new Error('Official map package path is invalid.'))
  }

  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(options.workerPath ?? DEFAULT_WORKER_PATH, {
        workerData: { packagePath, now },
      })
    } catch {
      reject(new Error('Official map package verification worker could not start.'))
      return
    }

    let settled = false
    let ready = false
    let tileRequestInFlight = false
    let resultReceived = false
    let validatedResult = null
    let handshakeTimer = null
    let operationTimer = null
    let abortHandler = null

    const cleanup = () => {
      if (handshakeTimer !== null) clearTimeout(handshakeTimer)
      if (operationTimer !== null) clearTimeout(operationTimer)
      if (abortHandler !== null) options.signal?.removeEventListener('abort', abortHandler)
    }

    const terminate = async () => {
      try {
        await worker.terminate()
      } catch {
        // The operation is already failed; worker teardown must remain best effort.
      }
    }

    const rejectAndTerminate = (error) => {
      if (settled) return
      settled = true
      cleanup()
      void terminate().finally(() => reject(error))
    }

    const rejectTimeout = () => {
      rejectAndTerminate(new Error(
        ready
          ? `Official map package verification timed out after ${timeoutMs} ms.`
          : `Official map package verification handshake timed out after ${handshakeTimeoutMs} ms.`,
      ))
    }

    const post = (message) => {
      try {
        worker.postMessage(message)
        return true
      } catch {
        rejectAndTerminate(new Error('Official map package verification worker failed.'))
        return false
      }
    }

    const handleTile = (message) => {
      if (!ready || tileRequestInFlight || resultReceived) {
        rejectAndTerminate(new Error('Official map package verification worker protocol failed.'))
        return
      }
      if (
        !Number.isSafeInteger(message?.requestId)
        || message.requestId < 1
        || typeof message.format !== 'string'
        || Object.prototype.toString.call(message.bytes) !== '[object Uint8Array]'
        || message.bytes.byteLength < 1
        || message.bytes.byteLength > MAX_TILE_BYTES
      ) {
        rejectAndTerminate(new Error('Official map package verification worker protocol failed.'))
        return
      }

      tileRequestInFlight = true
      Promise.resolve()
        .then(() => options.decodeTile(Buffer.from(message.bytes), message.format))
        .then((accepted) => {
          tileRequestInFlight = false
          if (settled) return
          if (accepted !== true) {
            post({ type: 'tile-decode-result', requestId: message.requestId, accepted: false })
            rejectAndTerminate(new Error('Official map package tile decoder rejected a tile.'))
            return
          }
          post({ type: 'tile-decode-result', requestId: message.requestId, accepted: true })
        })
        .catch(() => {
          tileRequestInFlight = false
          rejectAndTerminate(new Error('Official map package tile decoder failed.'))
        })
    }

    worker.on('message', (message) => {
      if (settled) return
      if (message?.type === 'ready') {
        if (ready) {
          rejectAndTerminate(new Error('Official map package verification worker protocol failed.'))
          return
        }
        ready = true
        if (handshakeTimer !== null) clearTimeout(handshakeTimer)
        operationTimer = setTimeout(rejectTimeout, timeoutMs)
        return
      }
      if (message?.type === 'tile') {
        handleTile(message)
        return
      }
      if (message?.type === 'result') {
        if (!ready || tileRequestInFlight || resultReceived || !isAttestationResult(message.result)) {
          rejectAndTerminate(new Error('Official map package verification worker protocol failed.'))
          return
        }
        resultReceived = true
        validatedResult = message.result
        return
      }
      if (message?.type === 'error') {
        rejectAndTerminate(new Error(safeWorkerMessage(message.message)))
        return
      }
      rejectAndTerminate(new Error('Official map package verification worker protocol failed.'))
    })
    worker.once('error', () => {
      rejectAndTerminate(new Error('Official map package verification worker failed.'))
    })
    worker.once('exit', (exitCode) => {
      if (settled) return
      if (validatedResult !== null && exitCode === 0) {
        settled = true
        cleanup()
        resolve(validatedResult)
        return
      }
      rejectAndTerminate(new Error(
        validatedResult !== null || exitCode !== 0
          ? 'Official map package verification worker failed.'
          : 'Official map package verification worker exited before completing.',
      ))
    })

    handshakeTimer = setTimeout(rejectTimeout, handshakeTimeoutMs)
    abortHandler = () => rejectAndTerminate(new Error('Official map package verification was cancelled.'))
    options.signal?.addEventListener('abort', abortHandler, { once: true })
    if (options.signal?.aborted === true) abortHandler()
  })
}

/** Accepts bounded timeout values and rejects unknown values before worker creation. */
function normalizeTimeout(value, fallback) {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new Error('Official map package worker timeout is invalid.')
  }
  return Math.floor(value)
}

/** Serializes a caller clock for the worker without passing functions across threads. */
function normalizeNow(input) {
  if (input === undefined) return undefined
  let value
  try {
    value = typeof input === 'function' ? input() : input
  } catch {
    throw new Error('Official map verification time is invalid.')
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error('Official map verification time is invalid.')
  }
  return value.toISOString()
}

/** Prevents worker/native errors from exposing paths, SQL, or credentials. */
function safeWorkerMessage(value) {
  const message = String(value ?? '')
  return message.length <= MAX_WORKER_MESSAGE_LENGTH && SAFE_WORKER_MESSAGE.test(message)
    ? message
    : 'Official map package verification failed.'
}

/** Validates the path-free result envelope before resolving the caller. */
function isAttestationResult(result) {
  return (
    result !== null
    && typeof result === 'object'
    && hasExactKeys(result, EXPECTED_RESULT_KEYS)
    && Array.isArray(result.bounds)
    && result.bounds.length === 4
    && result.bounds.every((value) => Number.isFinite(value))
    && result.bounds[0] >= -180
    && result.bounds[0] < result.bounds[2]
    && result.bounds[2] <= 180
    && result.bounds[1] >= -90
    && result.bounds[1] < result.bounds[3]
    && result.bounds[3] <= 90
    && Number.isSafeInteger(result.minZoom)
    && Number.isSafeInteger(result.maxZoom)
    && result.minZoom >= 0
    && result.minZoom <= 30
    && result.maxZoom >= result.minZoom
    && result.maxZoom <= 30
    && Number.isSafeInteger(result.tileCount)
    && result.tileCount > 0
    && TILE_FORMATS.has(result.tileFormat)
    && typeof result.sizeBytes === 'number'
    && Number.isSafeInteger(result.sizeBytes)
    && result.sizeBytes > 0
    && isIsoTimestamp(result.createdAt)
    && isIsoTimestamp(result.verifiedAt)
    && result.attestation !== null
    && typeof result.attestation === 'object'
    && hasExactKeys(result.attestation, EXPECTED_ATTESTATION_KEYS)
    && result.attestation.version === 1
    && result.attestation.schemaVersion === 1
    && result.attestation.decoderPolicy === DECODER_POLICY
    && /^[a-f0-9]{64}$/u.test(result.attestation.sha256 ?? '')
    && /^\d+:\d+:\d+:\d+:\d+$/u.test(result.attestation.identity ?? '')
  )
}

/** Requires the worker to send only the documented result fields. */
function hasExactKeys(value, expectedKeys) {
  const actualKeys = Object.keys(value).sort()
  const sortedExpectedKeys = [...expectedKeys].sort()
  return actualKeys.length === sortedExpectedKeys.length
    && actualKeys.every((key, index) => key === sortedExpectedKeys[index])
}

/** Accepts only canonical bounded ISO timestamps from the worker. */
function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length < 20 || value.length > 64) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

module.exports = {
  inspectOfficialMapPackageInWorker,
}
