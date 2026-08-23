/**
 * Registers sender-owned Mission Review read-query IPC handlers.
 *
 * Renderer request IDs are scoped by webContents ID so one renderer cannot
 * cancel or collide with another renderer's read-only worker.
 */
function registerMissionReviewReadQueryIpcHandlers(input) {
  input.ipcMain.handle(
    input.readChannel,
    async (event, query, requestId) => {
      input.validateIpcSender(event)
      const scopedRequestId = scopeMissionReviewRequestId(event, requestId)
      let cleanupRequested = false
      const cancelDestroyedSenderQuery = () => {
        if (cleanupRequested) return
        cleanupRequested = true
        void input.missionStore
          .cancelMissionReviewRead(scopedRequestId)
          .catch(() => undefined)
      }
      event.sender.once('destroyed', cancelDestroyedSenderQuery)
      event.sender.once('render-process-gone', cancelDestroyedSenderQuery)
      try {
        return await input.missionStore.readMissionReview(query, scopedRequestId)
      } finally {
        event.sender.removeListener('destroyed', cancelDestroyedSenderQuery)
        event.sender.removeListener('render-process-gone', cancelDestroyedSenderQuery)
      }
    },
  )
  input.ipcMain.handle(input.cancelChannel, (event, requestId) => {
    input.validateIpcSender(event)
    return input.missionStore.cancelMissionReviewRead(
      scopeMissionReviewRequestId(event, requestId),
    )
  })
}

/** Validates and scopes a renderer-owned request identifier. */
function scopeMissionReviewRequestId(event, requestId) {
  if (!Number.isSafeInteger(event?.sender?.id) || event.sender.id < 0) {
    throw new Error('Mission Review IPC sender ID is invalid.')
  }
  if (
    typeof requestId !== 'string' ||
    requestId.length < 1 ||
    requestId.length > 100 ||
    !/^[A-Za-z0-9._:-]+$/u.test(requestId)
  ) {
    throw new Error('Mission Review request ID is invalid.')
  }
  return `${event.sender.id}:mission-review:${requestId}`
}

module.exports = { registerMissionReviewReadQueryIpcHandlers }
