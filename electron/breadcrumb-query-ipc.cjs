/**
 * Registers sender-owned breadcrumb query IPC handlers.
 *
 * Renderer request IDs are scoped by webContents ID in main so one renderer
 * can neither collide with nor cancel another renderer's worker.
 */
function registerBreadcrumbQueryIpcHandlers(input) {
  input.ipcMain.handle(
    input.listChannel,
    async (event, missionId, perDeviceLimit, requestId) => {
      input.validateIpcSender(event)
      const scopedRequestId = scopeBreadcrumbQueryRequestId(event, requestId)
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
      try {
        return await input.missionStore.listBreadcrumbPositions(
          missionId,
          perDeviceLimit,
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
    return input.missionStore.cancelBreadcrumbQuery(
      scopeBreadcrumbQueryRequestId(event, requestId),
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
