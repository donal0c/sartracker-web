/**
 * Registers sender-owned breadcrumb query IPC handlers.
 *
 * Renderer request IDs are scoped by webContents ID in main so one renderer
 * can neither collide with nor cancel another renderer's worker.
 */
const { sanitizeBreadcrumbQueryFailure } = require('./breadcrumb-query-failure.cjs')

const MAX_RETAINED_BREADCRUMB_QUERY_FAILURES = 32

function registerBreadcrumbQueryIpcHandlers(input) {
  const sessions = new Map()
  const retainedFailures = new Map()
  input.ipcMain.handle(
    input.startChannel,
    async (event, query) => {
      input.validateIpcSender(event)
      const scopedRequestId = scopeBreadcrumbQueryRequestId(event, query?.requestId)
      const existing = sessions.get(scopedRequestId)
      if (existing !== undefined && existing.failure === null) {
        throw new Error('Breadcrumb query request ID is already active.')
      }
      if (existing !== undefined) {
        sessions.delete(scopedRequestId)
        retainedFailures.delete(scopedRequestId)
      }
      const snapshotId = require('node:crypto').randomUUID()
      const session = { snapshotId, failure: null, cancelRequested: false }
      sessions.set(scopedRequestId, session)
      let cleanupRequested = false
      const cancelDestroyedSenderQuery = () => {
        if (cleanupRequested) {
          return
        }
        cleanupRequested = true
        session.cancelRequested = true
        void Promise.resolve()
          .then(() => input.missionStore.cancelBreadcrumbQuery(scopedRequestId))
          .catch(() => undefined)
      }
      const cleanupListeners = () => {
        event.sender.removeListener('destroyed', cancelDestroyedSenderQuery)
        event.sender.removeListener('render-process-gone', cancelDestroyedSenderQuery)
        event.sender.removeListener('did-start-navigation', cancelOnMainFrameNavigation)
      }
      const cleanup = () => {
        if (sessions.get(scopedRequestId) === session) sessions.delete(scopedRequestId)
        retainedFailures.delete(scopedRequestId)
        cleanupListeners()
      }
      const cancelOnMainFrameNavigation = (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame === true && isInPlace !== true) {
          cancelDestroyedSenderQuery()
          cleanup()
        }
      }
      event.sender.once('destroyed', cancelDestroyedSenderQuery)
      event.sender.once('render-process-gone', cancelDestroyedSenderQuery)
      event.sender.on('did-start-navigation', cancelOnMainFrameNavigation)
      const retainFailure = (error) => {
        if (sessions.get(scopedRequestId) !== session) {
          cleanupListeners()
          return
        }
        if (session.cancelRequested) {
          cleanup()
          return
        }
        session.failure = sanitizeBreadcrumbQueryFailure(error)
        retainedFailures.delete(scopedRequestId)
        retainedFailures.set(scopedRequestId, session)
        cleanupListeners()
        while (retainedFailures.size > MAX_RETAINED_BREADCRUMB_QUERY_FAILURES) {
          const oldestRequestId = retainedFailures.keys().next().value
          retainedFailures.delete(oldestRequestId)
          if (sessions.get(oldestRequestId)?.failure !== null) sessions.delete(oldestRequestId)
        }
      }
      try {
        const started = input.missionStore.startBreadcrumbQuery(
          query.missionId,
          query.perDeviceLimit,
          scopedRequestId,
        )
        void Promise.resolve(started).catch(() => undefined)
        let completion
        let completionCaptured = false
        try {
          completion = input.missionStore.breadcrumbQueryCompletion(scopedRequestId)
          completionCaptured = true
        } catch {
          // Rejected admissions have no registry entry. Let the original start
          // error reach the renderer while cleanup follows its settlement.
        }
        if (completionCaptured) void Promise.resolve(completion).then(cleanup, retainFailure)
        else void Promise.resolve(started).then(cleanup, cleanup)
        const manifest = await started
        return Object.freeze({ ...manifest, snapshotId })
      } catch (error) {
        cleanup()
        throw error
      }
    },
  )
  /** Fences late frame/finish controls from an earlier request with the same name. */
  function scopedSession(event, query) {
    input.validateIpcSender(event)
    const id = scopeBreadcrumbQueryRequestId(event, query?.requestId)
    const session = sessions.get(id)
    if (typeof query.snapshotId !== 'string' || session?.snapshotId !== query.snapshotId) {
      throw new Error('Breadcrumb query snapshot is not active for this sender.')
    }
    if (session.failure !== null) throw session.failure
    return id
  }
  input.ipcMain.handle(input.readChannel, async (event, query) => {
    const id = scopedSession(event, query)
    const frame = await input.missionStore.readBreadcrumbQueryFrame(id, query.sequence)
    return { ...frame, snapshotId: query.snapshotId }
  })
  input.ipcMain.handle(input.finishChannel, (event, query) =>
    input.missionStore.finishBreadcrumbQuery(scopedSession(event, query)))
  input.ipcMain.handle(input.cancelChannel, (event, query) => {
    input.validateIpcSender(event)
    const id = scopeBreadcrumbQueryRequestId(event, query?.requestId)
    const session = sessions.get(id)
    if (session === undefined) return false
    if (query?.snapshotId !== undefined) scopedSession(event, query)
    session.cancelRequested = true
    return input.missionStore.cancelBreadcrumbQuery(
      id,
    )
  })
}

/** Registers sender-owned exact breadcrumb-dot page query IPC handlers. */
function registerExactBreadcrumbDotQueryIpcHandlers(input) {
  input.ipcMain.handle(
    input.listChannel,
    async (event, query, requestId) => {
      input.validateIpcSender(event)
      const scopedRequestId = scopeBreadcrumbQueryRequestId(
        event,
        requestId,
        'exact-dot',
      )
      let cleanupRequested = false
      const cancelDestroyedSenderQuery = () => {
        if (cleanupRequested) return
        cleanupRequested = true
        void Promise.resolve()
          .then(() => input.missionStore.cancelExactBreadcrumbDotQuery(scopedRequestId))
          .catch(() => undefined)
      }
      const cleanupListeners = () => {
        event.sender.removeListener('destroyed', cancelDestroyedSenderQuery)
        event.sender.removeListener('render-process-gone', cancelDestroyedSenderQuery)
        event.sender.removeListener('did-start-navigation', cancelOnMainFrameNavigation)
      }
      const cancelOnMainFrameNavigation = (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame === true && isInPlace !== true) {
          cancelDestroyedSenderQuery()
          cleanupListeners()
        }
      }
      event.sender.once('destroyed', cancelDestroyedSenderQuery)
      event.sender.once('render-process-gone', cancelDestroyedSenderQuery)
      event.sender.on('did-start-navigation', cancelOnMainFrameNavigation)
      try {
        return await input.missionStore.listExactBreadcrumbDotPage(
          query,
          scopedRequestId,
        )
      } finally {
        cleanupListeners()
      }
    },
  )
  input.ipcMain.handle(input.cancelChannel, (event, requestId) => {
    input.validateIpcSender(event)
    return input.missionStore.cancelExactBreadcrumbDotQuery(
      scopeBreadcrumbQueryRequestId(event, requestId, 'exact-dot'),
    )
  })
}

function scopeBreadcrumbQueryRequestId(event, requestId, namespace = null) {
  if (!Number.isSafeInteger(event?.sender?.id) || event.sender.id < 0) {
    throw new Error('Breadcrumb query IPC sender ID is invalid.')
  }
  if (
    typeof requestId !== 'string' ||
    requestId.length < 1 ||
    requestId.length > 100 ||
    !/^[A-Za-z0-9._:-]+$/u.test(requestId)
  ) {
    throw new Error('Breadcrumb query request ID is invalid.')
  }
  return namespace === null
    ? `${event.sender.id}:${requestId}`
    : `${event.sender.id}:${namespace}:${requestId}`
}

module.exports = {
  registerBreadcrumbQueryIpcHandlers,
  registerExactBreadcrumbDotQueryIpcHandlers,
}
