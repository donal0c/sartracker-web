const { normalizeReplayWorkerQuery } = require('./mission-replay-query.cjs')

/**
 * Registers sender-owned Mission Replay worker-query IPC handlers.
 *
 * Renderer request IDs are scoped by webContents ID so one renderer cannot
 * collide with or cancel another renderer's serialized replay work.
 */
function registerMissionReplayQueryIpcHandlers(input) {
  const readMethods = {
    state: 'readMissionReplay',
    trackChunk: 'readMissionReplayTrackChunk',
    objectChunk: 'readMissionReplayObjectChunk',
  }

  for (const [kind, channel] of Object.entries(input.readChannels)) {
    const methodName = readMethods[kind]
    if (methodName === undefined) {
      throw new Error(`Mission Replay IPC read kind is invalid: ${kind}.`)
    }
    input.ipcMain.handle(channel, async (event, query, requestId) => {
      input.validateIpcSender(event)
      const scopedRequestId = scopeMissionReplayRequestId(event, requestId)
      const workerKind = kind === 'trackChunk' ? 'chunk' : kind === 'objectChunk' ? 'objects' : 'state'
      const normalizedQuery = normalizeReplayWorkerQuery(query, workerKind)
      let cleanupRequested = false
      const cancelDestroyedSenderQuery = () => {
        if (cleanupRequested) return
        cleanupRequested = true
        void input.missionStore.cancelMissionReplay(scopedRequestId).catch(() => undefined)
      }
      event.sender.once('destroyed', cancelDestroyedSenderQuery)
      event.sender.once('render-process-gone', cancelDestroyedSenderQuery)
      try {
        return await input.missionStore[methodName](normalizedQuery, scopedRequestId)
      } finally {
        event.sender.removeListener('destroyed', cancelDestroyedSenderQuery)
        event.sender.removeListener('render-process-gone', cancelDestroyedSenderQuery)
      }
    })
  }

  input.ipcMain.handle(input.cancelChannel, (event, requestId) => {
    input.validateIpcSender(event)
    return input.missionStore.cancelMissionReplay(
      scopeMissionReplayRequestId(event, requestId),
    )
  })
}

/** Validates and scopes a renderer-owned Replay request identifier. */
function scopeMissionReplayRequestId(event, requestId) {
  if (!Number.isSafeInteger(event?.sender?.id) || event.sender.id < 0) {
    throw new Error('Mission Replay IPC sender ID is invalid.')
  }
  if (
    typeof requestId !== 'string' ||
    requestId.length < 1 ||
    requestId.length > 100 ||
    !/^[A-Za-z0-9._:-]+$/u.test(requestId)
  ) {
    throw new Error('Mission Replay request ID is invalid.')
  }
  return `${event.sender.id}:mission-replay:${requestId}`
}

module.exports = { registerMissionReplayQueryIpcHandlers }
