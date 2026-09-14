const { createCoverageOwnerLifecycle } = require('./coverage-owner-lifecycle.cjs')
const { sanitizeDiagnosticText } = require('./diagnostic-sanitizer.cjs')

const MAX_DIAGNOSTIC_TEXT_LENGTH = 500

/** Registers sender-scoped coverage read and cancellation handlers. */
function registerCoverageIpcHandlers(input) {
  input = {
    ...input,
    ownerLifecycle: input.ownerLifecycle ?? createCoverageOwnerLifecycle({
      onFailure: input.onLifecycleFailure,
    }),
  }
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
      requestCoverageCancellation(input, 'cancelCoverageTileRead', scopedRequestId)
    }
    const releaseOwner = createSafeRelease(input, input.ownerLifecycle.subscribe(
      event.sender,
      cancelDestroyedSender,
    ), 'tile read lifecycle subscription')
    try {
      return await input.missionStore.readCoverageTile(payload, scopedRequestId)
    } finally {
      releaseOwner()
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
    let releaseListeners = () => undefined
    const senderGone = () => {
      if (destroyed) return
      destroyed = true
      requestCoverageCancellation(input, 'cancelCoverageQuery', scopedRequestId)
      for (const [activationId, owner] of ownedStages.entries()) {
        if (owner.senderId !== senderId) continue
        owner.abandoned = true
        void settleAbandonedStage(input, ownedStages, activationId, owner)
          .catch(error => reportLifecycleFailure(
            input,
            error,
            'abandoned coverage catalog cleanup after renderer loss',
          ))
      }
      releaseListeners()
    }
    try {
      try {
        releaseListeners = createSafeRelease(input, input.ownerLifecycle.subscribe(
          event.sender,
          senderGone,
        ), 'catalog lifecycle subscription')
      } catch (error) {
        abandonSenderStages(ownedStages, senderId)
        try {
          await settleAbandonedStages(input, ownedStages, senderId)
        } catch (cleanupError) {
          reportLifecycleFailure(
            input,
            cleanupError,
            'abandoned coverage catalog cleanup after subscription failure',
          )
        }
        throw error
      }
      abandonSenderStages(ownedStages, senderId)
      await settleAbandonedStages(input, ownedStages, senderId)
      if (destroyed) throw createDestroyedRendererError()
      const result = await input.missionStore.syncCoverageTileCatalog(payload, scopedRequestId)
      const activationId = readActivationId(result)
      if (activationId === null) return result
      const owner = {
        senderId,
        releaseListeners,
        abandoned: destroyed,
        cleanup: null,
      }
      ownedStages.set(activationId, owner)
      ownedActivationId = activationId
      if (destroyed) {
        await settleAbandonedStage(input, ownedStages, activationId, owner)
          .catch(error => reportLifecycleFailure(
            input,
            error,
            'abandoned coverage catalog cleanup after renderer loss',
          ))
        throw createDestroyedRendererError()
      }
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
      if (
        activationId === null ||
        owner?.senderId !== event.sender.id ||
        owner.abandoned
      ) {
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

/** Marks an earlier unsettled stage as superseded by its renderer's new sync. */
function abandonSenderStages(ownedStages, senderId) {
  for (const owner of ownedStages.values()) {
    if (owner.senderId === senderId) owner.abandoned = true
  }
}

/** Settles every renderer-abandoned stage before allowing another catalog sync. */
async function settleAbandonedStages(input, ownedStages, preferredSenderId) {
  let pending = [...ownedStages.entries()]
    .filter(([, owner]) => owner.abandoned)
    .sort(([, left], [, right]) =>
      Number(right.senderId === preferredSenderId) -
      Number(left.senderId === preferredSenderId),
    )
  let retriedWithoutProgress = false
  let lastError = new Error('Coverage tile catalog cleanup did not settle.')
  while (pending.length > 0) {
    const failed = []
    let madeProgress = false
    for (const [activationId, owner] of pending) {
      if (ownedStages.get(activationId) !== owner || !owner.abandoned) continue
      try {
        await settleAbandonedStage(input, ownedStages, activationId, owner)
        if (ownedStages.get(activationId) !== owner) madeProgress = true
      } catch (error) {
        if (ownedStages.get(activationId) !== owner || !owner.abandoned) {
          madeProgress = true
          continue
        }
        lastError = error instanceof Error ? error : lastError
        failed.push([activationId, owner])
      }
    }
    if (failed.length === 0) return
    if (!madeProgress && retriedWithoutProgress) throw lastError
    retriedWithoutProgress = !madeProgress
    pending = failed
  }
}

/** Coalesces one discard while retaining failed cleanup for the next retry. */
function settleAbandonedStage(input, ownedStages, activationId, owner) {
  if (ownedStages.get(activationId) !== owner) return Promise.resolve()
  if (owner.cleanup !== null) return owner.cleanup
  let cleanup
  cleanup = (async () => {
    try {
      await input.missionStore.discardCoverageTileCatalog({ activationId })
      if (ownedStages.get(activationId) === owner) ownedStages.delete(activationId)
      owner.releaseListeners()
    } finally {
      if (owner.cleanup === cleanup) owner.cleanup = null
    }
  })()
  owner.cleanup = cleanup
  return cleanup
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
  const error = new Error(
    'coverage-cancelled: Coverage renderer was destroyed during catalog staging.',
  )
  error.name = 'AbortError'
  return error
}

/** Requests one optional cooperative cancellation without leaking synchronous or async failures. */
function requestCoverageCancellation(input, methodName, requestId) {
  let cancellation
  try {
    const cancel = input.missionStore?.[methodName]
    if (typeof cancel !== 'function') {
      throw new Error(`Coverage cancellation method ${methodName} is unavailable.`)
    }
    cancellation = cancel.call(input.missionStore, requestId)
  } catch (error) {
    reportLifecycleFailure(input, error, `${methodName} after renderer loss`)
    return
  }
  void Promise.resolve(cancellation).catch(error => {
    reportLifecycleFailure(input, error, `${methodName} after renderer loss`)
  })
}

/** Makes one lifecycle release idempotent and keeps release failures out of IPC finally blocks. */
function createSafeRelease(input, release, phase) {
  if (typeof release !== 'function') {
    const error = new TypeError(`Coverage ${phase} did not return a release function.`)
    reportLifecycleFailure(input, error, phase)
    throw error
  }
  let released = false
  return () => {
    if (released) return
    released = true
    try {
      release()
    } catch (error) {
      reportLifecycleFailure(input, error, phase)
    }
  }
}

/** Reports one lifecycle failure through the optional runtime diagnostic hook. */
function reportLifecycleFailure(input, error, phase) {
  const failure = error instanceof Error ? error : new Error(String(error))
  if (typeof input.onLifecycleFailure !== 'function') {
    try {
      const message = sanitizeDiagnosticText(failure.message)
        .slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH)
      console.error(`Coverage renderer lifecycle failure: ${message}`)
    } catch {
      // A missing diagnostic sink must never rethrow into an IPC or EventEmitter callback.
    }
    return
  }
  try {
    const result = input.onLifecycleFailure(failure, { phase })
    if (result !== undefined) {
      void Promise.resolve(result).catch(reportLifecycleFailureToConsole)
    }
  } catch (reportError) {
    reportLifecycleFailureToConsole(reportError)
  }
}

/** Provides a final process diagnostic when the supplied runtime reporter fails. */
function reportLifecycleFailureToConsole(error) {
  try {
    const message = sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))
      .slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH)
    console.error(`Coverage renderer lifecycle diagnostic failed: ${message}`)
  } catch {
    // Diagnostics are best-effort and cannot be allowed to escape lifecycle cleanup.
  }
}

/** Registers one named read while sharing renderer lifecycle cancellation. */
function registerCoverageReadHandler(input, channel, read) {
  input.ipcMain.handle(channel, async (event, payload, requestId) => {
    input.validateIpcSender(event)
    const scopedRequestId = scopeCoverageRequestId(event, requestId)
    const cancelDestroyedSender = () => {
      requestCoverageCancellation(input, 'cancelCoverageQuery', scopedRequestId)
    }
    const releaseOwner = createSafeRelease(input, input.ownerLifecycle.subscribe(
      event.sender,
      cancelDestroyedSender,
    ), 'coverage read lifecycle subscription')
    try {
      return await read(input.missionStore, payload, scopedRequestId)
    } finally {
      releaseOwner()
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
