'use strict'

const path = require('node:path')
const { Worker } = require('node:worker_threads')
const {
  closeTransferredFileHandle,
} = require('./transferred-file-handle-cleanup.cjs')
const {
  MAX_LEGACY_VALIDATION_WORK_BYTES,
  deriveArchiveWorkloadWatchdogMs,
} = require('./archive-workload-watchdog.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'legacy-archive-restore-worker.cjs')
const DEFAULT_WATCHDOG_MS = 60_000
const DEFAULT_CANCEL_GRACE_MS = 500
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PHASE_ORDER = Object.freeze([
  'preflight',
  'metadata',
  'database',
  'validate',
  'attachments',
  'ready',
])
const FAILURE_CODES = new Set([
  'ARCHIVE_CANCELLED',
  'LEGACY_ARCHIVE_CORRUPT_ENTRY',
  'LEGACY_ARCHIVE_DISK_FULL',
  'LEGACY_ARCHIVE_RESTORE_FAILED',
  'LEGACY_ARCHIVE_UNSUPPORTED_SCHEMA',
])
const ATTACHMENT_REFERENCE_KINDS = new Set([
  'marker',
  'marker_version',
  'marker_attachment_ingested',
  'marker_created',
  'marker_updated',
  'marker_deleted',
])
const MAX_ATTACHMENT_MAPPING_BYTES = 4 * 1024 * 1024

/** Creates a stable non-reflective legacy restore failure. */
function createFailure(code) {
  const normalized = FAILURE_CODES.has(code) ? code : 'LEGACY_ARCHIVE_RESTORE_FAILED'
  const error = new Error(`Legacy archive review restore failed safely (${normalized}).`)
  error.code = normalized
  return error
}

/** Creates a stable caller-input failure without reflecting rejected values. */
function createRequestFailure() {
  const error = new Error('Legacy archive restore request is invalid.')
  error.code = 'LEGACY_ARCHIVE_RESTORE_FAILED'
  return error
}

/** Creates the shared archive cancellation failure. */
function createAbortError() {
  const error = new Error('Archive review restore was cancelled.')
  error.name = 'AbortError'
  error.code = 'ARCHIVE_CANCELLED'
  return error
}

/** Requires an exact immutable request before any worker or filesystem action. */
function normalizeLegacyRestoreRequest(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',')
      !== 'archivePath,expectedMissionId,operationId,sessionDirectory,sessionId'
    || !UUID_V4.test(input.operationId)
    || !UUID_V4.test(input.sessionId)
    || typeof input.archivePath !== 'string'
    || !path.isAbsolute(input.archivePath)
    || path.resolve(input.archivePath) !== input.archivePath
    || path.extname(input.archivePath).toLowerCase() !== '.zip'
    || Buffer.byteLength(input.archivePath, 'utf8') > 8_192
    || typeof input.sessionDirectory !== 'string'
    || !path.isAbsolute(input.sessionDirectory)
    || path.resolve(input.sessionDirectory) !== input.sessionDirectory
    || path.basename(input.sessionDirectory) !== input.sessionId
    || Buffer.byteLength(input.sessionDirectory, 'utf8') > 8_192
    || input.sessionDirectory === path.parse(input.sessionDirectory).root
    || input.archivePath === input.sessionDirectory
    || input.archivePath.startsWith(`${input.sessionDirectory}${path.sep}`)
    || typeof input.expectedMissionId !== 'string'
    || input.expectedMissionId.length < 1
    || Buffer.byteLength(input.expectedMissionId, 'utf8') > 200
    || /[\u0000-\u001f\u007f]/u.test(input.expectedMissionId)) {
    throw createRequestFailure()
  }
  return Object.freeze({
    operationId: input.operationId,
    sessionId: input.sessionId,
    archivePath: input.archivePath,
    sessionDirectory: input.sessionDirectory,
    expectedMissionId: input.expectedMissionId,
  })
}

/** Applies one bounded duration override. */
function normalizeDuration(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw createFailure('LEGACY_ARCHIVE_RESTORE_FAILED')
  }
  return Math.floor(value)
}

/** Returns true only when a valid update proves forward work. */
function isMeaningfulProgress(message, previous) {
  if (previous === null) return true
  return PHASE_ORDER.indexOf(message.phase) > PHASE_ORDER.indexOf(previous.phase)
    || message.completed > previous.completed
}

/** Accepts only monotonic, path-free legacy restore progress. */
function isValidProgress(message, request, previous) {
  if (Object.keys(message ?? {}).sort().join(',')
      !== 'completed,detail,operationId,phase,sequence,total,type,unit'
    || message.operationId !== request.operationId
    || !PHASE_ORDER.includes(message.phase)
    || !['bytes', 'files'].includes(message.unit)
    || !Number.isSafeInteger(message.sequence) || message.sequence < 1
    || !Number.isSafeInteger(message.completed) || message.completed < 0
    || (message.total !== null && (!Number.isSafeInteger(message.total)
      || message.total < message.completed))
    || typeof message.detail !== 'string'
    || !/^[a-z0-9-]{1,80}$/u.test(message.detail)
    || message.detail.includes(request.archivePath)
    || message.detail.includes(request.sessionDirectory)
    || (message.phase === 'validate'
      && (message.unit !== 'bytes' || message.total === null
        || message.total < 1 || message.total > MAX_LEGACY_VALIDATION_WORK_BYTES))) return false
  if (previous === null) return true
  const priorPhase = PHASE_ORDER.indexOf(previous.phase)
  const nextPhase = PHASE_ORDER.indexOf(message.phase)
  return message.sequence > previous.sequence
    && nextPhase >= priorPhase
    && (nextPhase > priorPhase || message.completed >= previous.completed)
}

/** Removes internal routing identity before notifying renderer-facing code. */
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

/** Requires one bounded portable attachment filename with no host path. */
function normalizePortableAttachmentName(value, label) {
  if (typeof value !== 'string'
    || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 1_024
    || value !== value.normalize('NFC')
    || value.includes('/')
    || value.includes('\\')
    || /[\u0000-\u001f\u007f]/u.test(value)
    || value === '.'
    || value === '..') {
    throw createFailure('LEGACY_ARCHIVE_RESTORE_FAILED')
  }
  return value
}

/** Shape-closes every worker-provided legacy attachment authorization. */
function normalizeAttachmentMappings(input, attachmentCount) {
  let serializedBytes
  try {
    serializedBytes = Buffer.byteLength(JSON.stringify(input), 'utf8')
  } catch {
    throw createFailure('LEGACY_ARCHIVE_RESTORE_FAILED')
  }
  if (!Array.isArray(input)
    || input.length !== attachmentCount
    || input.length > 10_000
    || serializedBytes > MAX_ATTACHMENT_MAPPING_BYTES) {
    throw createFailure('LEGACY_ARCHIVE_RESTORE_FAILED')
  }
  const entryNames = new Set()
  const normalized = input.map((mapping) => {
    if (mapping === null || typeof mapping !== 'object' || Array.isArray(mapping)
      || Object.keys(mapping).sort().join(',')
        !== 'entryName,references,sha256,sizeBytes,sourceRelativePath') {
      throw createFailure('LEGACY_ARCHIVE_RESTORE_FAILED')
    }
    const sourceRelativePath = normalizePortableAttachmentName(
      mapping.sourceRelativePath,
      'source attachment',
    )
    if (typeof mapping.entryName !== 'string'
      || !mapping.entryName.startsWith('attachments/')
      || mapping.entryName.includes('\\')
      || mapping.entryName !== mapping.entryName.normalize('NFC')
      || path.posix.dirname(mapping.entryName) !== 'attachments'
      || path.posix.normalize(mapping.entryName) !== mapping.entryName) {
      throw createFailure('LEGACY_ARCHIVE_RESTORE_FAILED')
    }
    const archivedName = normalizePortableAttachmentName(
      mapping.entryName.slice('attachments/'.length),
      'archive attachment',
    )
    if (archivedName !== sourceRelativePath
      && !new RegExp(`^[0-9a-f]{12}-${sourceRelativePath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u')
        .test(archivedName)) {
      throw createFailure('LEGACY_ARCHIVE_RESTORE_FAILED')
    }
    if (entryNames.has(mapping.entryName)
      || typeof mapping.sha256 !== 'string'
      || !/^[0-9a-f]{64}$/u.test(mapping.sha256)
      || !Number.isSafeInteger(mapping.sizeBytes)
      || mapping.sizeBytes < 1
      || mapping.sizeBytes > 8 * 1024 * 1024 * 1024
      || !Array.isArray(mapping.references)
      || mapping.references.length < 1
      || mapping.references.length > 10_000) {
      throw createFailure('LEGACY_ARCHIVE_RESTORE_FAILED')
    }
    entryNames.add(mapping.entryName)
    const referenceKeys = new Set()
    const references = Object.freeze(mapping.references.map((reference) => {
      if (reference === null || typeof reference !== 'object' || Array.isArray(reference)
        || Object.keys(reference).sort().join(',') !== 'referenceId,referenceKind'
        || !ATTACHMENT_REFERENCE_KINDS.has(reference.referenceKind)
        || typeof reference.referenceId !== 'string'
        || reference.referenceId.length < 1
        || Buffer.byteLength(reference.referenceId, 'utf8') > 200
        || /[\u0000-\u001f\u007f]/u.test(reference.referenceId)) {
        throw createFailure('LEGACY_ARCHIVE_RESTORE_FAILED')
      }
      const key = `${reference.referenceKind}\0${reference.referenceId}`
      if (referenceKeys.has(key)) throw createFailure('LEGACY_ARCHIVE_RESTORE_FAILED')
      referenceKeys.add(key)
      return Object.freeze({
        referenceKind: reference.referenceKind,
        referenceId: reference.referenceId,
      })
    }))
    return Object.freeze({
      entryName: mapping.entryName,
      sourceRelativePath,
      sha256: mapping.sha256,
      sizeBytes: mapping.sizeBytes,
      references,
    })
  })
  return Object.freeze(normalized)
}

/** Shape-closes a successful worker result and derives its trusted internal paths. */
function normalizeResult(message, request) {
  if (Object.keys(message ?? {}).sort().join(',')
      !== 'archiveKind,attachmentCount,attachmentMappings,containerVersion,databaseFileHandle,databaseFileName,databaseIdentity,encrypted,entryCount,immutable,missionId,operationId,schemaVersion,sessionId,type'
    || message.type !== 'complete'
    || message.operationId !== request.operationId
    || message.sessionId !== request.sessionId
    || message.archiveKind !== 'legacy_unencrypted'
    || message.containerVersion !== 1
    || message.encrypted !== false
    || message.immutable !== true
    || message.missionId !== request.expectedMissionId
    || message.databaseFileName !== 'mission-store.sqlite'
    || message.databaseIdentity === null
    || typeof message.databaseIdentity !== 'object'
    || Array.isArray(message.databaseIdentity)
    || Object.keys(message.databaseIdentity).sort().join(',') !== 'dev,ino,sizeBytes'
    || !Number.isSafeInteger(message.databaseIdentity.dev) || message.databaseIdentity.dev < 0
    || !Number.isSafeInteger(message.databaseIdentity.ino) || message.databaseIdentity.ino < 1
    || !Number.isSafeInteger(message.databaseIdentity.sizeBytes)
    || message.databaseIdentity.sizeBytes < 1
    || message.databaseFileHandle === null
    || typeof message.databaseFileHandle !== 'object'
    || !Number.isSafeInteger(message.databaseFileHandle.fd)
    || message.databaseFileHandle.fd < 0
    || typeof message.databaseFileHandle.close !== 'function'
    || message.schemaVersion !== 13
    || !Number.isSafeInteger(message.entryCount)
    || message.entryCount < 3
    || message.entryCount > 10_000
    || !Number.isSafeInteger(message.attachmentCount)
    || message.attachmentCount < 0
    || message.attachmentCount !== message.entryCount - 3) {
    throw createFailure('LEGACY_ARCHIVE_RESTORE_FAILED')
  }
  const attachmentMappings = normalizeAttachmentMappings(
    message.attachmentMappings,
    message.attachmentCount,
  )
  return Object.freeze({
    operationId: request.operationId,
    sessionId: request.sessionId,
    archiveKind: 'legacy_unencrypted',
    containerVersion: 1,
    encrypted: false,
    immutable: true,
    missionId: request.expectedMissionId,
    databaseFileName: 'mission-store.sqlite',
    databaseIdentity: Object.freeze({ ...message.databaseIdentity }),
    databaseFileHandle: message.databaseFileHandle,
    schemaVersion: 13,
    entryCount: message.entryCount,
    attachmentCount: message.attachmentCount,
    attachmentMappings,
    sessionDirectory: request.sessionDirectory,
    databasePath: path.join(request.sessionDirectory, 'mission-store.sqlite'),
  })
}

/** Creates a single-settlement deferred. */
function createDeferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

/** Decorates completion with cancellation, physical-exit, and shutdown ownership. */
function decorate(completion, workerExited, cancel) {
  Object.defineProperties(completion, {
    workerExited: { value: workerExited },
    cancel: { value: cancel },
    prepareClose: {
      value: async () => {
        cancel()
        await workerExited
      },
    },
  })
  return completion
}

/** Starts one unpooled off-main legacy ZIP restore. */
function startLegacyArchiveRestore(input) {
  const request = normalizeLegacyRestoreRequest(input?.request)
  const watchdogMs = normalizeDuration(
    input?.watchdogMs,
    DEFAULT_WATCHDOG_MS,
    1,
    30 * 60_000,
  )
  const cancelGraceMs = normalizeDuration(
    input?.cancelGraceMs,
    DEFAULT_CANCEL_GRACE_MS,
    0,
    30_000,
  )
  if (input?.onProgress !== undefined && typeof input.onProgress !== 'function') {
    throw createFailure('LEGACY_ARCHIVE_RESTORE_FAILED')
  }
  if (input?.signal !== undefined
    && (typeof input.signal?.addEventListener !== 'function'
      || typeof input.signal?.removeEventListener !== 'function')) {
    throw createFailure('LEGACY_ARCHIVE_RESTORE_FAILED')
  }

  const workerExited = createDeferred()
  if (input.signal?.aborted === true) {
    const rejected = Promise.reject(createAbortError())
    void rejected.catch(() => undefined)
    workerExited.resolve()
    return decorate(rejected, workerExited.promise, () => undefined)
  }

  const cancellationBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const cancellationFlag = new Int32Array(cancellationBuffer)
  let worker
  let cancel = () => undefined
  const completion = new Promise((resolve, reject) => {
    try {
      const workerPath = input.workerPath ?? DEFAULT_WORKER_PATH
      const workerData = Object.freeze({ request, cancellationBuffer })
      worker = input.WorkerClass === undefined
        ? new Worker(workerPath, { workerData })
        : new input.WorkerClass(workerPath, { workerData })
    } catch {
      workerExited.resolve()
      reject(createFailure('LEGACY_ARCHIVE_RESTORE_FAILED'))
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

    /** Clears timers and external cancellation only after physical exit. */
    const cleanupLifecycle = () => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      if (terminationTimer !== null) clearTimeout(terminationTimer)
      input.signal?.removeEventListener('abort', handleAbort)
    }

    /** Rejects public completion once without releasing worker ownership. */
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      input.signal?.removeEventListener('abort', handleAbort)
      reject(error)
    }

    /** Requests cooperative cancellation and bounds forced termination. */
    const cancelAndReject = (error) => {
      if (Atomics.compareExchange(cancellationFlag, 0, 0, 1) === 0) {
        try { worker.postMessage({ type: 'cancel', operationId: request.operationId }) } catch {}
      }
      rejectOnce(error)
      closeDatabaseHandle(terminal)
      terminal = null
      if (terminationTimer === null) {
        const terminate = () => {
          try { void Promise.resolve(worker.terminate()).catch(() => undefined) } catch {}
        }
        if (cancelGraceMs === 0) terminate()
        else terminationTimer = setTimeout(terminate, cancelGraceMs)
      }
    }

    cancel = () => cancelAndReject(createAbortError())
    const handleAbort = () => cancel()
    const resetWatchdog = (durationMs = watchdogMs) => {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer)
      watchdogTimer = setTimeout(() => {
        cancelAndReject(createFailure('LEGACY_ARCHIVE_RESTORE_FAILED'))
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
          cancelAndReject(createFailure('LEGACY_ARCHIVE_RESTORE_FAILED'))
          return
        }
        const meaningful = isMeaningfulProgress(message, lastProgress)
        lastProgress = message
        if (meaningful) resetWatchdog(deriveArchiveWorkloadWatchdogMs(message, watchdogMs))
        try { input.onProgress?.(projectProgress(message)) } catch {
          cancelAndReject(createFailure('LEGACY_ARCHIVE_RESTORE_FAILED'))
        }
        return
      }
      if (message?.type === 'complete') {
        if (terminalSeen) {
          closeDatabaseHandle(message)
          cancelAndReject(createFailure('LEGACY_ARCHIVE_RESTORE_FAILED'))
          return
        }
        terminalSeen = true
        try { terminal = normalizeResult(message, request) } catch {
          closeDatabaseHandle(message)
          cancelAndReject(createFailure('LEGACY_ARCHIVE_RESTORE_FAILED'))
        }
        return
      }
      if (message?.type === 'error') {
        terminalSeen = true
        const code = message.operationId === request.operationId && FAILURE_CODES.has(message.code)
          ? message.code
          : 'LEGACY_ARCHIVE_RESTORE_FAILED'
        cancelAndReject(code === 'ARCHIVE_CANCELLED' ? createAbortError() : createFailure(code))
        return
      }
      cancelAndReject(createFailure('LEGACY_ARCHIVE_RESTORE_FAILED'))
    })
    worker.once('error', () => cancelAndReject(createFailure('LEGACY_ARCHIVE_RESTORE_FAILED')))
    worker.once('exit', (code) => {
      void (async () => {
        cleanupLifecycle()
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
        else reject(createFailure('LEGACY_ARCHIVE_RESTORE_FAILED'))
      })()
    })

    if (input.signal?.aborted === true) handleAbort()
  })
  void completion.catch(() => undefined)
  return decorate(completion, workerExited.promise, () => cancel())
}

module.exports = {
  normalizeLegacyRestoreRequest,
  startLegacyArchiveRestore,
}
