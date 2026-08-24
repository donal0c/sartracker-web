/** Registers sender-scoped coverage read and cancellation handlers. */
function registerCoverageIpcHandlers(input) {
  input.ipcMain.handle(input.readChannel, async (event, query, requestId) => {
    input.validateIpcSender(event)
    const scopedRequestId = scopeCoverageRequestId(event, requestId)
    const cancelDestroyedSender = () => {
      void input.missionStore.cancelCoverageQuery(scopedRequestId).catch(() => undefined)
    }
    event.sender.once('destroyed', cancelDestroyedSender)
    event.sender.once('render-process-gone', cancelDestroyedSender)
    try {
      return await input.missionStore.readCoverage(query, scopedRequestId)
    } finally {
      event.sender.removeListener('destroyed', cancelDestroyedSender)
      event.sender.removeListener('render-process-gone', cancelDestroyedSender)
    }
  })
  input.ipcMain.handle(input.cancelChannel, (event, requestId) => {
    input.validateIpcSender(event)
    return input.missionStore.cancelCoverageQuery(
      scopeCoverageRequestId(event, requestId),
    )
  })
}

/** Validates and scopes one renderer-owned coverage request identifier. */
function scopeCoverageRequestId(event, requestId) {
  if (!Number.isSafeInteger(event?.sender?.id) || event.sender.id < 0) {
    throw new Error('Coverage IPC sender ID is invalid.')
  }
  if (
    typeof requestId !== 'string' ||
    requestId.length < 1 ||
    requestId.length > 100 ||
    !/^[A-Za-z0-9._:-]+$/u.test(requestId)
  ) {
    throw new Error('Coverage request ID is invalid.')
  }
  return `${event.sender.id}:coverage:${requestId}`
}

module.exports = {
  registerCoverageIpcHandlers,
  scopeCoverageRequestId,
}
