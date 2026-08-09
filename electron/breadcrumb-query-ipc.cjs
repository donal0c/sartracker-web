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

function scopeBreadcrumbQueryRequestId(event, requestId) {
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
  return `${event.sender.id}:${requestId}`
}

module.exports = {
  registerBreadcrumbQueryIpcHandlers,
}
