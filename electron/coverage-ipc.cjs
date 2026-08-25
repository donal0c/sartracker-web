/** Registers sender-scoped coverage read and cancellation handlers. */
function registerCoverageIpcHandlers(input) {
  const ownedStages = new Map()
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
  registerCoverageCatalogHandler(input, ownedStages)
  registerCoverageActivationHandlers(input, ownedStages)
  registerCoverageTileHandlers(input)
  input.ipcMain.handle(input.cancelChannel, (event, requestId) => {
    input.validateIpcSender(event)
    return input.missionStore.cancelCoverageQuery(
      scopeCoverageRequestId(event, requestId),
    )
  })
}

/** Owns tile reads and their cooperative cancellation by renderer process. */
function registerCoverageTileHandlers(input) {
  if (input.tileChannels === undefined) return
  input.ipcMain.handle(input.tileChannels.read, async (event, payload, requestId) => {
    input.validateIpcSender(event)
    const scopedRequestId = scopeCoverageRequestId(event, requestId)
    const cancelDestroyedSender = () => {
      void input.missionStore.cancelCoverageTileRead(scopedRequestId).catch(() => undefined)
    }
    event.sender.once('destroyed', cancelDestroyedSender)
    event.sender.once('render-process-gone', cancelDestroyedSender)
    try {
      return await input.missionStore.readCoverageTile(payload, scopedRequestId)
    } finally {
      event.sender.removeListener('destroyed', cancelDestroyedSender)
      event.sender.removeListener('render-process-gone', cancelDestroyedSender)
    }
  })
  input.ipcMain.handle(input.tileChannels.cancel, (event, requestId) => {
    input.validateIpcSender(event)
    return input.missionStore.cancelCoverageTileRead(
      scopeCoverageRequestId(event, requestId),
    )
  })
}

/** Retains sender ownership after a staged catalog response until settlement. */
function registerCoverageCatalogHandler(input, ownedStages) {
  input.ipcMain.handle(input.readChannels.catalog, async (event, payload, requestId) => {
    input.validateIpcSender(event)
    const scopedRequestId = scopeCoverageRequestId(event, requestId)
    const senderId = event.sender.id
    let destroyed = false
    let ownedActivationId = null
    const releaseListeners = () => {
      event.sender.removeListener('destroyed', senderGone)
      event.sender.removeListener('render-process-gone', senderGone)
    }
    const senderGone = () => {
      if (destroyed) return
      destroyed = true
      void input.missionStore.cancelCoverageQuery(scopedRequestId).catch(() => undefined)
      for (const [activationId, owner] of ownedStages.entries()) {
        if (owner.senderId !== senderId) continue
        ownedStages.delete(activationId)
        void input.missionStore.discardCoverageTileCatalog({ activationId })
          .catch(() => undefined)
      }
      releaseListeners()
    }
    event.sender.once('destroyed', senderGone)
    event.sender.once('render-process-gone', senderGone)
    try {
      const result = await input.missionStore.syncCoverageTileCatalog(payload, scopedRequestId)
      const activationId = readActivationId(result)
      if (activationId === null) return result
      if (destroyed) {
        await input.missionStore.discardCoverageTileCatalog({ activationId })
          .catch(() => undefined)
        throw createDestroyedRendererError()
      }
      ownedStages.set(activationId, { senderId, releaseListeners })
      ownedActivationId = activationId
      return result
    } finally {
      if (ownedActivationId === null) releaseListeners()
    }
  })
}

/** Restricts stage activation/discard to the renderer that created the stage. */
function registerCoverageActivationHandlers(input, ownedStages) {
  if (input.activationChannels === undefined) return
  const register = (channel, settle, terminal) => {
    input.ipcMain.handle(channel, async (event, payload) => {
      input.validateIpcSender(event)
      const activationId = readActivationId(payload)
      const owner = activationId === null ? undefined : ownedStages.get(activationId)
      if (activationId === null || owner?.senderId !== event.sender.id) {
        throw new Error('Coverage tile catalog stage is not owned by this renderer.')
      }
      let settled = false
      try {
        const result = await settle(input.missionStore, { activationId })
        settled = true
        return result
      } finally {
        if (terminal && settled) {
          ownedStages.delete(activationId)
          owner.releaseListeners()
        }
      }
    })
  }
  register(
    input.activationChannels.activate,
    (missionStore, payload) => missionStore.activateCoverageTileCatalog(payload),
    false,
  )
  register(
    input.activationChannels.finalize,
    (missionStore, payload) => missionStore.finalizeCoverageTileCatalog(payload),
    true,
  )
  register(
    input.activationChannels.discard,
    (missionStore, payload) => missionStore.discardCoverageTileCatalog(payload),
    true,
  )
}

/** Reads only one bounded opaque activation token from an IPC result or request. */
function readActivationId(value) {
  const activationId = value?.activationId
  return typeof activationId === 'string' && activationId.length > 0
    ? activationId
    : null
}

/** Creates the fail-closed error for a renderer lost during catalog staging. */
function createDestroyedRendererError() {
  const error = new Error('Coverage renderer was destroyed during catalog staging.')
  error.name = 'AbortError'
  return error
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
