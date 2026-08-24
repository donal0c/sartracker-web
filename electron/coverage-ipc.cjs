/** Registers sender-scoped coverage read and cancellation handlers. */
function registerCoverageIpcHandlers(input) {
  registerCoverageReadHandler(
    input,
    input.readChannels.manifest,
    (missionStore, payload, requestId) => missionStore.readCoverageManifest(payload, requestId),
  )
  registerCoverageReadHandler(
    input,
    input.readChannels.chunk,
    (missionStore, payload, requestId) => missionStore.readCoverageChunk(payload, requestId),
  )
  registerCoverageReadHandler(
    input,
    input.readChannels.claim,
    (missionStore, payload, requestId) => missionStore.readCoverageClaim(payload, requestId),
  )
  registerCoverageReadHandler(
    input,
    input.readChannels.catalog,
    (missionStore, payload, requestId) =>
      missionStore.syncCoverageTileCatalog(payload, requestId),
  )
  input.ipcMain.handle(input.cancelChannel, (event, requestId) => {
    input.validateIpcSender(event)
    return input.missionStore.cancelCoverageQuery(
      scopeCoverageRequestId(event, requestId),
    )
  })
}

/** Registers one named read while sharing renderer lifecycle cancellation. */
function registerCoverageReadHandler(input, channel, read) {
  input.ipcMain.handle(channel, async (event, payload, requestId) => {
    input.validateIpcSender(event)
    const scopedRequestId = scopeCoverageRequestId(event, requestId)
    const cancelDestroyedSender = () => {
      void input.missionStore.cancelCoverageQuery(scopedRequestId).catch(() => undefined)
    }
    event.sender.once('destroyed', cancelDestroyedSender)
    event.sender.once('render-process-gone', cancelDestroyedSender)
    try {
      return await read(input.missionStore, payload, scopedRequestId)
    } finally {
      event.sender.removeListener('destroyed', cancelDestroyedSender)
      event.sender.removeListener('render-process-gone', cancelDestroyedSender)
    }
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
