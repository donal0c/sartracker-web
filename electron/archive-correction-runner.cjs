'use strict'

const path = require('node:path')
const { randomUUID } = require('node:crypto')

const {
  captureCorrectionDirectoryIdentity,
} = require('./archive-correction-directory-capability.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'archive-correction-worker.cjs')
const CANCEL_GRACE_MS = 2_000
const READY_TIMEOUT_MS = 5_000
const FAILURE_CODES = new Set([
  'ARCHIVE_CANCELLED',
  'ARCHIVE_REHYDRATE_EPOCH_CHANGED',
  'ARCHIVE_REHYDRATE_FAILED',
  'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID',
  'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
  'ARCHIVE_REHYDRATE_LIVE_ACTIVITY',
  'ARCHIVE_REHYDRATE_LIVE_ROWS_PRESENT',
  'ARCHIVE_REHYDRATE_REQUEST_INVALID',
  'ARCHIVE_REHYDRATE_SCHEMA_INVALID',
  'ARCHIVE_REHYDRATE_SCOPE_INVALID',
  'ARCHIVE_REHYDRATE_SNAPSHOT_INVALID',
  'ARCHIVE_REHYDRATE_SNAPSHOT_UNAVAILABLE',
])

/** Starts one correction in an Electron-injected, cwd-confined utility process. */
function startArchiveCorrectionWorker(input) {
  const request = normalizeRequest(input)
  const workerExited = createDeferred()
  let utility
  let settled = false
  let ready = false
  let terminal = null
  let cancellationRequested = false
  let forcedTermination = false
  let completionTerminationRequested = false
  let cancelOperation = () => undefined
  let terminationTimer = null
  let readyTimer = null
  let exitListenerInstalled = false

  const completion = new Promise((resolve, reject) => {
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    try {
      const databaseDirectory = path.dirname(request.databasePath)
      const directoryIdentity = captureCorrectionDirectoryIdentity(databaseDirectory)
      utility = request.createUtilityProcess?.({
        modulePath: request.workerPath,
        cwd: databaseDirectory,
        serviceName: 'SAR Tracker archive correction',
      })
      assertUtilityProcess(utility)

      const kill = () => {
        try { utility.kill() } catch {}
      }
      const cancel = () => {
        if (terminal !== null) {
          completionTerminationRequested = true
          kill()
          return
        }
        if (cancellationRequested) return
        cancellationRequested = true
        try { utility.postMessage({ type: 'cancel' }) } catch {}
        if (terminationTimer === null) {
          terminationTimer = setTimeout(() => {
            forcedTermination = true
            kill()
          }, CANCEL_GRACE_MS)
        }
      }
      cancelOperation = cancel
      if (request.signal !== undefined) {
        request.signal.addEventListener('abort', cancel, { once: true })
      }

      utility.on('message', (message) => {
        if (settled || terminal !== null) return
        if (!ready) {
          if (!isReady(message, directoryIdentity)) {
            rejectOnce(createFailure('ARCHIVE_REHYDRATE_FAILED'))
            kill()
            return
          }
          ready = true
          if (readyTimer !== null) clearTimeout(readyTimer)
          try {
            utility.postMessage({
              type: 'start',
              directoryIdentity,
              request: serializeRequest(request),
            })
          } catch {
            rejectOnce(createFailure('ARCHIVE_REHYDRATE_FAILED'))
            kill()
          }
          return
        }
        if (message?.type === 'complete') {
          if (!isComplete(message, request)) {
            rejectOnce(createFailure('ARCHIVE_REHYDRATE_FAILED'))
            kill()
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
        kill()
      })
      utility.once('error', () => {
        rejectOnce(createFailure('ARCHIVE_REHYDRATE_FAILED'))
      })
      utility.once('exit', (code) => {
        if (terminationTimer !== null) clearTimeout(terminationTimer)
        if (readyTimer !== null) clearTimeout(readyTimer)
        request.signal?.removeEventListener('abort', cancel)
        workerExited.resolve()
        if (settled) return
        settled = true
        if (terminal !== null) {
          if (code === 0 || completionTerminationRequested) resolve(terminal)
          else reject(createFailure('ARCHIVE_REHYDRATE_FAILED'))
        } else if (cancellationRequested && forcedTermination) {
          reject(createFailure('ARCHIVE_REHYDRATE_CLEANUP_REQUIRED'))
        } else {
          reject(createFailure(cancellationRequested
            ? 'ARCHIVE_CANCELLED'
            : 'ARCHIVE_REHYDRATE_FAILED'))
        }
      })
      exitListenerInstalled = true
      readyTimer = setTimeout(() => {
        rejectOnce(createFailure('ARCHIVE_REHYDRATE_FAILED'))
        kill()
      }, READY_TIMEOUT_MS)
      readyTimer.unref?.()
      if (request.signal?.aborted === true) cancel()
    } catch {
      if (readyTimer !== null) clearTimeout(readyTimer)
      if (!exitListenerInstalled) workerExited.resolve()
      else {
        try { utility.kill?.() } catch {}
      }
      rejectOnce(createFailure('ARCHIVE_REHYDRATE_FAILED'))
    }
  })
  Object.defineProperty(completion, 'workerExited', { value: workerExited.promise })
  Object.defineProperty(completion, 'cancel', { value: () => cancelOperation() })
  return completion
}

/** Validates the bounded utility-process request without reflecting authority. */
function normalizeRequest(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw createFailure('ARCHIVE_REHYDRATE_REQUEST_INVALID')
  }
  const fields = ['databasePath', 'snapshotPath', 'missionId', 'archiveId', 'operationId',
    'finalizedEpoch', 'adminName', 'reason', 'attachmentDirectory', 'attachmentMappings',
    'expectedSha256', 'expectedIdentity', 'faultInjection', 'workerPath', 'signal',
    'createUtilityProcess']
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
  if (!/^[0-9a-f]{64}$/u.test(input.expectedSha256 ?? '')
    || input.expectedIdentity === null || typeof input.expectedIdentity !== 'object'
    || Array.isArray(input.expectedIdentity)
    || Object.keys(input.expectedIdentity).sort().join(',') !== 'dev,ino,sizeBytes'
    || !Number.isSafeInteger(input.expectedIdentity.dev) || input.expectedIdentity.dev < 0
    || !Number.isSafeInteger(input.expectedIdentity.ino) || input.expectedIdentity.ino < 1
    || !Number.isSafeInteger(input.expectedIdentity.sizeBytes) || input.expectedIdentity.sizeBytes < 1) {
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
  if (input.createUtilityProcess !== undefined
    && typeof input.createUtilityProcess !== 'function') {
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
    operationId: typeof input.operationId === 'string' ? input.operationId : randomUUID(),
    finalizedEpoch: input.finalizedEpoch,
    adminName: input.adminName,
    reason: input.reason,
    expectedSha256: input.expectedSha256,
    expectedIdentity: Object.freeze({ ...input.expectedIdentity }),
    attachmentDirectory: input.attachmentDirectory,
    attachmentMappings: Object.freeze(input.attachmentMappings.map((entry) => Object.freeze({ ...entry }))),
    faultInjection: input.faultInjection && typeof input.faultInjection === 'object'
      ? Object.freeze({ ...input.faultInjection })
      : Object.freeze({}),
    workerPath,
    signal: input.signal,
    createUtilityProcess: input.createUtilityProcess,
  })
}

/** Removes parent-only values and sends the database as a cwd-relative leaf. */
function serializeRequest(request) {
  return Object.freeze({
    databaseName: path.basename(request.databasePath),
    snapshotPath: request.snapshotPath,
    missionId: request.missionId,
    archiveId: request.archiveId,
    operationId: request.operationId,
    finalizedEpoch: request.finalizedEpoch,
    adminName: request.adminName,
    reason: request.reason,
    expectedSha256: request.expectedSha256,
    expectedIdentity: request.expectedIdentity,
    attachmentDirectory: request.attachmentDirectory,
    attachmentMappings: request.attachmentMappings,
    faultInjection: request.faultInjection,
  })
}

/** Requires the injected process to expose the Electron UtilityProcess contract. */
function assertUtilityProcess(value) {
  if (!value || typeof value.on !== 'function' || typeof value.once !== 'function'
    || typeof value.postMessage !== 'function' || typeof value.kill !== 'function') {
    throw new Error('Archive correction requires an Electron utility process.')
  }
}

/** Validates the utility's cwd identity handshake before giving it a request. */
function isReady(message, expectedIdentity) {
  return message !== null && typeof message === 'object' && !Array.isArray(message)
    && Object.keys(message).sort().join(',') === 'directoryIdentity,type'
    && message.type === 'ready'
    && message.directoryIdentity !== null && typeof message.directoryIdentity === 'object'
    && !Array.isArray(message.directoryIdentity)
    && Object.keys(message.directoryIdentity).sort().join(',') === 'dev,ino'
    && message.directoryIdentity.dev === expectedIdentity.dev
    && message.directoryIdentity.ino === expectedIdentity.ino
}

/** Returns one closed correction failure. */
function createFailure(code) {
  const error = new Error(`Archive correction restore failed safely (${code}).`)
  error.code = code
  return error
}

/** Validates the single closed utility completion envelope. */
function isComplete(message, request) {
  return Object.keys(message).sort().join(',') === 'archiveId,missionId,operationId,type'
    && message.missionId === request.missionId
    && message.archiveId === request.archiveId
    && message.operationId === request.operationId
}

/** Creates one externally-resolvable utility-exit promise. */
function createDeferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

module.exports = { startArchiveCorrectionWorker }
