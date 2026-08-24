/** Registers sender-scoped outing fix-summary read and cancellation handlers. */
function registerOutingFixSummaryIpcHandlers(input) {
  input.ipcMain.handle(input.readChannel, async (event, query, requestId) => {
    input.validateIpcSender(event)
    const scopedRequestId = scopeRequestId(event, requestId)
    const cancelDestroyedSender = () => {
      void input.missionStore.cancelOutingFixSummary(scopedRequestId).catch(() => undefined)
    }
    event.sender.once('destroyed', cancelDestroyedSender)
    event.sender.once('render-process-gone', cancelDestroyedSender)
    try {
      return await input.missionStore.readOutingFixSummary(query, scopedRequestId)
    } finally {
      event.sender.removeListener('destroyed', cancelDestroyedSender)
      event.sender.removeListener('render-process-gone', cancelDestroyedSender)
    }
  })
  input.ipcMain.handle(input.cancelChannel, (event, requestId) => {
    input.validateIpcSender(event)
    return input.missionStore.cancelOutingFixSummary(scopeRequestId(event, requestId))
  })
}

/** Validates and scopes a renderer-owned request identifier. */
function scopeRequestId(event, requestId) {
  if (!Number.isSafeInteger(event?.sender?.id) || event.sender.id < 0) {
    throw new Error('Outing fix-summary IPC sender ID is invalid.')
  }
  if (
    typeof requestId !== 'string' ||
    requestId.length < 1 ||
    requestId.length > 100 ||
    !/^[A-Za-z0-9._:-]+$/u.test(requestId)
  ) {
    throw new Error('Outing fix-summary request ID is invalid.')
  }
  return `${event.sender.id}:outing-fix-summary:${requestId}`
}

module.exports = { registerOutingFixSummaryIpcHandlers }
