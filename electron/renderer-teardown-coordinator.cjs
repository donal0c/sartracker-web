const { randomUUID } = require('node:crypto')

const RENDERER_TEARDOWN_REQUEST_CHANNEL = 'sartracker:app-runtime-teardown-requested'
const RENDERER_TEARDOWN_READY_CHANNEL = 'sartracker:app-runtime-teardown-ready'
const RENDERER_TEARDOWN_TIMEOUT_MS = 5_000
const RENDERER_EVIDENCE_LOSS_REASON = 'renderer_pending_evidence_lost'

/**
 * Coordinates one bounded main-to-renderer evidence drain before renderer loss.
 */
function createRendererTeardownCoordinator(dependencies) {
  const ipcMain = dependencies.ipcMain
  const missionStore = dependencies.missionStore
  const createRequestId = dependencies.createRequestId ?? randomUUID
  const setTimeoutFn = dependencies.setTimeout ?? globalThis.setTimeout
  const clearTimeoutFn = dependencies.clearTimeout ?? globalThis.clearTimeout
  const timeoutMs = dependencies.timeoutMs ?? RENDERER_TEARDOWN_TIMEOUT_MS
  const pendingByRequestId = new Map()
  const preparationByWebContents = new WeakMap()

  /** Accepts only the exact pending request from the renderer that owns it. */
  function handleRendererReady(event, input) {
    if (!isRendererTeardownResult(input)) return
    const pending = pendingByRequestId.get(input.requestId)
    if (pending === undefined || pending.webContents !== event.sender) return
    pending.settle(input.ok)
  }

  ipcMain.on(RENDERER_TEARDOWN_READY_CHANNEL, handleRendererReady)

  /**
   * Coalesces concurrent quit/close/navigation requests for one renderer.
   */
  function prepare(window, reason) {
    const webContents = window.webContents
    const existing = preparationByWebContents.get(webContents)
    if (existing !== undefined) return existing
    const preparation = runPreparation(webContents, reason).finally(() => {
      if (preparationByWebContents.get(webContents) === preparation) {
        preparationByWebContents.delete(webContents)
      }
    })
    preparationByWebContents.set(webContents, preparation)
    return preparation
  }

  /** Drains through the renderer or replaces uncertainty with durable mission state. */
  async function runPreparation(webContents, reason) {
    const rendererDrained = await requestRendererDrain(webContents, reason)
    if (rendererDrained) return { mode: 'renderer_drained' }
    return persistActiveMissionEvidenceLoss()
  }

  /** Waits for one sender-owned acknowledgement within the fixed timeout. */
  function requestRendererDrain(webContents, reason) {
    if (webContents.isDestroyed()) return Promise.resolve(false)
    const requestId = createRequestId()
    return new Promise((resolve) => {
      let settled = false
      let timer
      const settle = (result) => {
        if (settled) return
        settled = true
        pendingByRequestId.delete(requestId)
        if (timer !== undefined) clearTimeoutFn(timer)
        resolve(result)
      }
      pendingByRequestId.set(requestId, { webContents, settle })
      timer = setTimeoutFn(() => settle(false), timeoutMs)
      try {
        webContents.send(RENDERER_TEARDOWN_REQUEST_CHANNEL, { requestId, reason })
      } catch {
        settle(false)
      }
    })
  }

  /** Writes the sticky blocker before main permits an unacknowledged teardown. */
  async function persistActiveMissionEvidenceLoss() {
    const activeMission = await missionStore.getActiveMission()
    if (activeMission === null) return { mode: 'no_active_mission' }
    await missionStore.recordIngestEvidenceLoss({
      mission_id: activeMission.id,
      reason: RENDERER_EVIDENCE_LOSS_REASON,
    })
    return { mode: 'durable_loss_marker', missionId: activeMission.id }
  }

  /** Immediately fences the active mission after an unexpected renderer loss. */
  function markRendererUnavailable() {
    return persistActiveMissionEvidenceLoss()
  }

  /** Removes the IPC listener and fails any still-waiting renderer request closed. */
  function dispose() {
    ipcMain.removeListener(RENDERER_TEARDOWN_READY_CHANNEL, handleRendererReady)
    for (const pending of pendingByRequestId.values()) pending.settle(false)
    pendingByRequestId.clear()
  }

  return { prepare, markRendererUnavailable, dispose }
}

/** Validates the narrow renderer acknowledgement envelope. */
function isRendererTeardownResult(input) {
  return input !== null &&
    typeof input === 'object' &&
    typeof input.requestId === 'string' &&
    input.requestId.length > 0 &&
    input.requestId.length <= 128 &&
    typeof input.ok === 'boolean'
}

module.exports = {
  RENDERER_TEARDOWN_READY_CHANNEL,
  RENDERER_TEARDOWN_REQUEST_CHANNEL,
  RENDERER_TEARDOWN_TIMEOUT_MS,
  createRendererTeardownCoordinator,
  isRendererTeardownResult,
}
