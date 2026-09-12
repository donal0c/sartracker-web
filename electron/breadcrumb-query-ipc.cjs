/**
 * Registers sender-owned breadcrumb query IPC handlers.
 *
 * Renderer request IDs are scoped by webContents ID in main so one renderer
 * can neither collide with nor cancel another renderer's worker.
 */
function registerBreadcrumbQueryIpcHandlers(input) {
  const sessions = new Map()
  input.ipcMain.handle(
    input.startChannel,
    async (event, query) => {
      input.validateIpcSender(event)
      const scopedRequestId = scopeBreadcrumbQueryRequestId(event, query?.requestId)
      if (sessions.has(scopedRequestId)) throw new Error('Breadcrumb query request ID is already active.')
      const snapshotId = require('node:crypto').randomUUID()
      sessions.set(scopedRequestId, snapshotId)
      let cleanupRequested = false
      const cancelDestroyedSenderQuery = () => {
        if (cleanupRequested) {
          return
        }
        cleanupRequested = true
        void input.missionStore.cancelBreadcrumbQuery(scopedRequestId).catch(
          () => undefined,
        )
      }
      event.sender.once('destroyed', cancelDestroyedSenderQuery)
      event.sender.once('render-process-gone', cancelDestroyedSenderQuery)
      const cleanup = () => {
        if (sessions.get(scopedRequestId) === snapshotId) sessions.delete(scopedRequestId)
        event.sender.removeListener('destroyed', cancelDestroyedSenderQuery)
        event.sender.removeListener('render-process-gone', cancelDestroyedSenderQuery)
      }
      try {
        const started = input.missionStore.startBreadcrumbQuery(
          query.missionId,
          query.perDeviceLimit,
          scopedRequestId,
        )
        void started.catch(() => undefined)
        void input.missionStore.breadcrumbQueryCompletion(scopedRequestId).then(cleanup, cleanup)
        const manifest = await started
        return { ...manifest, snapshotId, missionId: query.missionId }
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
    if (typeof query.snapshotId !== 'string' || sessions.get(id) !== query.snapshotId) {
      throw new Error('Breadcrumb query snapshot is not active for this sender.')
    }
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
    if (!sessions.has(id)) return false
    if (query?.snapshotId !== undefined) scopedSession(event, query)
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
        void input.missionStore.cancelExactBreadcrumbDotQuery(scopedRequestId).catch(
          () => undefined,
        )
      }
      event.sender.once('destroyed', cancelDestroyedSenderQuery)
      event.sender.once('render-process-gone', cancelDestroyedSenderQuery)
      try {
        return await input.missionStore.listExactBreadcrumbDotPage(
          query,
          scopedRequestId,
        )
      } finally {
        event.sender.removeListener('destroyed', cancelDestroyedSenderQuery)
        event.sender.removeListener('render-process-gone', cancelDestroyedSenderQuery)
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
