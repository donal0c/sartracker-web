'use strict'

const {
  ARCHIVE_REVIEW_READ_METHODS,
  normalizeArchiveReviewCloseInput,
  normalizeArchiveReviewOpenInput,
  normalizeArchiveReviewPublicSession,
  normalizeArchiveReviewReadInput,
} = require('./archive-review-envelope.cjs')

const ARCHIVE_REVIEW_PROGRESS_CHANNEL = 'sartracker:archive-review:progress'
const MAX_RESULT_BYTES = 8 * 1024 * 1024
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PROGRESS_PHASES = new Set([
  'preflight', 'keys', 'ciphertext', 'decrypt', 'extract', 'migrate',
  'metadata', 'database', 'validate', 'attachments', 'ready',
])
const PROGRESS_UNITS = new Set(['bytes', 'files', 'phases', 'rows', 'tables'])
const FORBIDDEN_RESULT_KEYS = new Set([
  'databasePath',
  'sessionDirectory',
  'scratchPath',
  'secret',
  'secretBytes',
  'passphrase',
  'recoveryCode',
  'workerData',
])
const NO_ARGUMENT_METHODS = new Set(['info', 'listMissions'])
const MISSION_ID_METHODS = new Set([
  'listMarkers',
  'listDevices',
  'listDrawings',
  'listHelicopters',
  'listGpxImports',
  'listOutings',
  'listLayerCatalogMetadata',
])
const REQUEST_OWNED_METHODS = new Set([
  'readMissionReview',
  'readMissionReplay',
  'readMissionReplayTrackChunk',
  'readMissionReplayObjectChunk',
  'readMissionReplayFilterPage',
])
const CANCELLATION_METHODS = new Set(['cancelMissionReviewRead', 'cancelMissionReplay'])

/** Stable closed IPC error without renderer or worker content reflection. */
class ArchiveReviewIpcError extends Error {
  /** Creates one bounded archive-review IPC failure. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveReviewIpcError'
    this.code = code
  }
}

/** Requires one exact plain object. */
function requireExactRecord(value, keys, code = 'ARCHIVE_REVIEW_INPUT_INVALID') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArchiveReviewIpcError(code, 'Archive review request is invalid.')
  }
  const actual = Object.keys(value).sort().join(',')
  if (actual !== [...keys].sort().join(',')) {
    throw new ArchiveReviewIpcError(code, 'Archive review request is invalid.')
  }
}

/** Converts a downstream failure into one stable non-reflective IPC failure. */
function closeFailure(error, fallback = 'ARCHIVE_REVIEW_OPERATION_FAILED') {
  const code = typeof error?.code === 'string'
    && /^ARCHIVE_[A-Z0-9_]{1,96}$/u.test(error.code)
    ? error.code
    : fallback
  return new ArchiveReviewIpcError(
    code,
    `Archive review operation failed safely (${code}).`,
  )
}

/** Rejects hidden paths or secrets anywhere in a main-to-renderer result. */
function assertNoForbiddenResultFields(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) {
    throw new ArchiveReviewIpcError(
      'ARCHIVE_REVIEW_RESULT_INVALID',
      'Archive review result is invalid.',
    )
  }
  seen.add(value)
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_RESULT_KEYS.has(key)) {
      throw new ArchiveReviewIpcError(
        'ARCHIVE_REVIEW_RESULT_INVALID',
        'Archive review result is invalid.',
      )
    }
    assertNoForbiddenResultFields(child, seen)
  }
  seen.delete(value)
}

/** Bounds and screens one read result before Electron clones it to the renderer. */
function normalizeReadResult(result) {
  assertNoForbiddenResultFields(result)
  let serialized
  try {
    serialized = JSON.stringify(result)
  } catch {
    throw new ArchiveReviewIpcError(
      'ARCHIVE_REVIEW_RESULT_INVALID',
      'Archive review result is invalid.',
    )
  }
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_RESULT_BYTES) {
    throw new ArchiveReviewIpcError(
      'ARCHIVE_REVIEW_RESULT_INVALID',
      'Archive review result exceeds its safe renderer boundary.',
    )
  }
  return result
}

/** Converts a closed read request into the exact source call arguments. */
function readArguments(request) {
  if (!ARCHIVE_REVIEW_READ_METHODS.has(request.method)) {
    throw new ArchiveReviewIpcError(
      'ARCHIVE_REVIEW_READ_ONLY',
      'Archive review accepts only declared read-only operations.',
    )
  }
  if (NO_ARGUMENT_METHODS.has(request.method)) {
    requireExactRecord(request.input, [])
    return []
  }
  if (MISSION_ID_METHODS.has(request.method)) {
    requireExactRecord(request.input, ['missionId'])
    return [request.input.missionId]
  }
  if (CANCELLATION_METHODS.has(request.method)) {
    requireExactRecord(request.input, ['requestId'])
    return [request.input.requestId]
  }
  if (REQUEST_OWNED_METHODS.has(request.method)) {
    return [request.input, request.requestId]
  }
  return [request.input]
}

/** Projects one restore update before it can reach a renderer listener. */
function normalizeProgress(progress, request) {
  if (progress === null || typeof progress !== 'object' || Array.isArray(progress)
    || !Number.isSafeInteger(progress.sequence) || progress.sequence < 1
    || !PROGRESS_PHASES.has(progress.phase)
    || !PROGRESS_UNITS.has(progress.unit)
    || !Number.isSafeInteger(progress.completed) || progress.completed < 0
    || (progress.total !== null && (!Number.isSafeInteger(progress.total)
      || progress.total < progress.completed))
    || typeof progress.detail !== 'string'
    || Buffer.byteLength(progress.detail, 'utf8') > 200) {
    throw new ArchiveReviewIpcError(
      'ARCHIVE_REVIEW_PROGRESS_INVALID',
      'Archive review progress is invalid.',
    )
  }
  return Object.freeze({
    operationId: request.operationId,
    archiveId: request.archiveId,
    containerVersion: request.containerVersion,
    sequence: progress.sequence,
    phase: progress.phase,
    unit: progress.unit,
    completed: progress.completed,
    total: progress.total,
    detail: progress.detail,
  })
}

/** Registers the explicit sender-owned archive-review IPC surface. */
function registerArchiveReviewIpcHandlers(options) {
  const { ipcMain, channels, sessionManager, validateIpcSender } = options ?? {}
  if (typeof ipcMain?.handle !== 'function'
    || typeof ipcMain?.on !== 'function'
    || channels === null || typeof channels !== 'object'
    || Object.keys(channels).sort().join(',') !== 'cancel,close,mutationDenied,open,read'
    || typeof sessionManager?.open !== 'function'
    || typeof sessionManager?.close !== 'function'
    || typeof sessionManager?.cancel !== 'function'
    || typeof sessionManager?.read !== 'function'
    || typeof sessionManager?.closeForSender !== 'function'
    || typeof sessionManager?.recordMutationDenied !== 'function'
    || typeof validateIpcSender !== 'function') {
    throw new ArchiveReviewIpcError(
      'ARCHIVE_REVIEW_INPUT_INVALID',
      'Archive review IPC adapters are invalid.',
    )
  }

  ipcMain.on(channels.mutationDenied, (event, input) => {
    try {
      const sender = senderFor(event)
      requireExactRecord(input, ['attemptedMethod', 'requestId', 'sessionId'])
      if (!UUID_V4.test(input.sessionId)
        || !UUID_V4.test(input.requestId)
        || typeof input.attemptedMethod !== 'string'
        || Buffer.byteLength(input.attemptedMethod, 'utf8') < 1
        || Buffer.byteLength(input.attemptedMethod, 'utf8') > 100
        || /[\u0000-\u001f\u007f]/u.test(input.attemptedMethod)
        || sessionManager.recordMutationDenied({
          senderId: sender.id,
          sessionId: input.sessionId,
          attemptedMethod: input.attemptedMethod,
          boundary: 'facade',
        }) !== true) {
        throw new ArchiveReviewIpcError(
          'ARCHIVE_REVIEW_MUTATION_AUDIT_FAILED',
          'Archive review mutation denial audit failed safely.',
        )
      }
      event.returnValue = Object.freeze({ ok: true })
    } catch (error) {
      const failure = closeFailure(error, 'ARCHIVE_REVIEW_MUTATION_AUDIT_FAILED')
      event.returnValue = Object.freeze({ ok: false, code: failure.code })
    }
  })
  const liveSenders = new Set()

  /** Validates one Electron sender and installs its one destruction sweep. */
  function senderFor(event) {
    validateIpcSender(event)
    const sender = event?.sender
    if (!Number.isSafeInteger(sender?.id) || sender.id < 1
      || typeof sender?.once !== 'function'
      || typeof sender?.isDestroyed !== 'function'
      || typeof sender?.send !== 'function') {
      throw new ArchiveReviewIpcError(
        'ARCHIVE_REVIEW_INPUT_INVALID',
        'Archive review sender is invalid.',
      )
    }
    if (!liveSenders.has(sender.id)) {
      liveSenders.add(sender.id)
      sender.once('destroyed', () => {
        liveSenders.delete(sender.id)
        void sessionManager.closeForSender(sender.id).catch(() => undefined)
      })
    }
    return sender
  }

  ipcMain.handle(channels.open, async (event, input) => {
    const sender = senderFor(event)
    let request
    let sessionEstablished = false
    try {
      request = normalizeArchiveReviewOpenInput(input)
      const managerInput = {
        senderId: sender.id,
        request: request.containerVersion === 1
          ? {
              operationId: request.operationId,
              archiveId: request.archiveId,
              containerVersion: 1,
            }
          : {
              operationId: request.operationId,
              archiveId: request.archiveId,
              containerVersion: 2,
              slotType: request.slotType,
            },
        ...(request.containerVersion === 2 ? { secret: request.secret } : {}),
        onProgress: (progress) => {
          if (!liveSenders.has(sender.id) || sender.isDestroyed()) return
          sender.send(
            ARCHIVE_REVIEW_PROGRESS_CHANNEL,
            normalizeProgress(progress, request),
          )
        },
      }
      const result = await sessionManager.open(managerInput)
      sessionEstablished = true
      if (!liveSenders.has(sender.id) || sender.isDestroyed()) {
        throw new ArchiveReviewIpcError(
          'ARCHIVE_REVIEW_SENDER_UNAVAILABLE',
          'Archive review renderer is no longer available.',
        )
      }
      if (result?.containerVersion !== request.containerVersion) {
        throw new ArchiveReviewIpcError(
          'ARCHIVE_REVIEW_RESULT_INVALID',
          'Archive review result is invalid or request-mismatched.',
        )
      }
      const session = normalizeArchiveReviewPublicSession(result, {
        operationId: request.operationId,
        archiveId: request.archiveId,
        missionId: result?.missionId,
        slotType: request.slotType,
      })
      return Object.freeze({ operationId: request.operationId, ...session })
    } catch (error) {
      if (sessionEstablished) {
        try {
          await sessionManager.closeForSender(sender.id)
          sessionEstablished = false
        } catch (cleanupError) {
          throw closeFailure(
            cleanupError,
            'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
          )
        }
      }
      throw error instanceof ArchiveReviewIpcError ? error : closeFailure(error)
    }
  })

  ipcMain.handle(channels.close, async (event, input) => {
    const sender = senderFor(event)
    try {
      const request = normalizeArchiveReviewCloseInput(input)
      await sessionManager.close({ senderId: sender.id, sessionId: request.sessionId })
      return true
    } catch (error) {
      throw closeFailure(error)
    }
  })

  ipcMain.handle(channels.cancel, async (event, input) => {
    const sender = senderFor(event)
    try {
      requireExactRecord(input, ['operationId'])
      if (!UUID_V4.test(input.operationId)) {
        throw new ArchiveReviewIpcError(
          'ARCHIVE_REVIEW_INPUT_INVALID',
          'Archive review cancellation request is invalid.',
        )
      }
      const cancelled = await sessionManager.cancel({
        senderId: sender.id,
        operationId: input.operationId,
      })
      if (typeof cancelled !== 'boolean') {
        throw new ArchiveReviewIpcError(
          'ARCHIVE_REVIEW_OPERATION_FAILED',
          'Archive review cancellation result is invalid.',
        )
      }
      return cancelled
    } catch (error) {
      throw error instanceof ArchiveReviewIpcError ? error : closeFailure(error)
    }
  })

  ipcMain.handle(channels.read, async (event, input) => {
    const sender = senderFor(event)
    try {
      const request = normalizeArchiveReviewReadInput(input)
      const result = await sessionManager.read({
        senderId: sender.id,
        sessionId: request.sessionId,
        method: request.method,
        args: readArguments(request),
      })
      return normalizeReadResult(result)
    } catch (error) {
      if (error?.code === 'ARCHIVE_REVIEW_READ_ONLY'
        && error?.denialAudited !== true
        && typeof input?.method === 'string'
        && UUID_V4.test(input?.sessionId ?? '')
        && Buffer.byteLength(input.method, 'utf8') <= 100
        && !/[\u0000-\u001f\u007f]/u.test(input.method)) {
        await sessionManager.recordMutationDenied({
          senderId: sender.id,
          sessionId: input.sessionId,
          attemptedMethod: input.method,
          boundary: 'ipc',
        })
      }
      if (error instanceof ArchiveReviewIpcError) throw error
      if (error?.code === 'ARCHIVE_REVIEW_READ_ONLY'
        || error?.code === 'ARCHIVE_REVIEW_INPUT_INVALID') throw error
      throw closeFailure(error)
    }
  })
}

module.exports = {
  ARCHIVE_REVIEW_PROGRESS_CHANNEL,
  ArchiveReviewIpcError,
  registerArchiveReviewIpcHandlers,
}
