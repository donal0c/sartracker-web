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
  let unexpectedRendererLossDetected = false
  let unexpectedRendererLossFence = null

  /** Accepts only the exact pending request from the renderer that owns it. */
  function handleRendererReady(event, input) {
    if (!isRendererTeardownResult(input)) return
    const pending = pendingByRequestId.get(input.requestId)
    if (pending === undefined || pending.webContents !== event.sender) return
    void pending.settle(input.ok).catch(() => undefined)
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

  /** Drains through the renderer or replaces confirmed loss with durable mission state. */
  async function runPreparation(webContents, reason) {
    const result = await requestRendererDrain(webContents, reason)
    if (result.drained) return { mode: 'renderer_drained' }
    return formatDurableLossResult(result.lossScopes)
  }

  /**
   * Uses the fixed timeout only as a durable soft deadline. The renderer remains
   * alive until it confirms a clean drain or is actually lost.
   */
  function requestRendererDrain(webContents, reason) {
    const requestId = createRequestId()
    if (webContents.isDestroyed()) {
      return persistUnfinalizedMissionEvidenceLoss().then((lossScopes) => ({
        drained: false,
        lossScopes,
      }))
    }
    return new Promise((resolve, reject) => {
      let state = 'pending'
      let timer
      let settlement = null
      let uncertainty = null
      const fail = (error) => {
        if (state === 'settled') return
        state = 'settled'
        pendingByRequestId.delete(requestId)
        if (timer !== undefined) clearTimeoutFn(timer)
        reject(error)
      }
      const settle = (drained) => {
        if (state === 'settled' && settlement === null) {
          return Promise.resolve({ drained: false, lossScopes: [] })
        }
        if (settlement !== null) return settlement
        state = 'settling'
        if (timer !== undefined) clearTimeoutFn(timer)
        settlement = (async () => {
          const provisionalScopes = uncertainty === null ? [] : await uncertainty
          let lossScopes = []
          if (drained) {
            await resolveRendererEvidenceIncidents('drained')
          } else if (!drained) {
            const currentScopes = await listRendererEvidenceScopes()
            const resolvedIncidentScopes = await resolveRendererEvidenceIncidents('lost')
            lossScopes = mergeRendererEvidenceScopes(
              provisionalScopes,
              resolvedIncidentScopes,
              currentScopes,
            )
            const provisionalMissionIds = new Set(
              [...provisionalScopes, ...resolvedIncidentScopes]
                .map((scope) => scope.mission_id),
            )
            await persistEvidenceLossForScopes(currentScopes.filter(
              (scope) => !provisionalMissionIds.has(scope.mission_id),
            ))
          }
          state = 'settled'
          pendingByRequestId.delete(requestId)
          const result = {
            drained,
            lossScopes,
          }
          resolve(result)
          return result
        })().catch((error) => {
          fail(error)
          throw error
        })
        return settlement
      }
      pendingByRequestId.set(requestId, { webContents, settle })
      timer = setTimeoutFn(() => {
        if (state !== 'pending' || uncertainty !== null) return
        uncertainty = stageRendererEvidenceUncertainty(requestId)
        void uncertainty.catch(fail)
      }, timeoutMs)
      try {
        webContents.send(RENDERER_TEARDOWN_REQUEST_CHANNEL, { requestId, reason })
      } catch {
        void settle(false).catch(() => undefined)
      }
    })
  }

  /** Returns every mission plus the bounded reason it could own renderer evidence. */
  async function listRendererEvidenceScopes() {
    if (typeof missionStore.listRendererEvidenceScopesAwaitingClosure === 'function') {
      return missionStore.listRendererEvidenceScopesAwaitingClosure()
    }
    const missionIds = await missionStore.listMissionIdsAwaitingEvidenceClosure()
    return missionIds.map((missionId) => ({
      mission_id: missionId,
      scope_reason: 'active_mission',
    }))
  }

  /** Writes provisional, retractable blockers when the soft deadline expires. */
  async function stageRendererEvidenceUncertainty(incidentId) {
    const scopes = await listRendererEvidenceScopes()
    if (scopes.length === 0) return scopes
    await missionStore.stageRendererEvidenceIncident({
      incident_id: incidentId,
      scopes,
    })
    return scopes
  }

  /** Resolves durable incidents as one outbox-owned unit and returns their mission scopes. */
  async function resolveRendererEvidenceIncidents(outcome, incidentId) {
    const result = await missionStore.resolveRendererEvidenceIncidents({
      ...(incidentId === undefined ? {} : { incident_id: incidentId }),
      outcome,
    })
    return result?.resolved_scopes ?? []
  }

  /** Writes sticky blockers for every named mission after confirmed renderer loss. */
  async function persistUnfinalizedMissionEvidenceLoss() {
    const incidentScopes = await resolveRendererEvidenceIncidents('lost')
    const incidentMissionIds = new Set(incidentScopes.map((scope) => scope.mission_id))
    const currentScopes = await listRendererEvidenceScopes()
    await persistEvidenceLossForScopes(currentScopes.filter(
      (scope) => !incidentMissionIds.has(scope.mission_id),
    ))
    return mergeRendererEvidenceScopes(incidentScopes, currentScopes)
  }

  /** Persists one confirmed loss against the exact named mission scopes. */
  async function persistEvidenceLossForScopes(scopes) {
    for (const scope of scopes) {
      await missionStore.recordIngestEvidenceLoss({
        mission_id: scope.mission_id,
        reason: RENDERER_EVIDENCE_LOSS_REASON,
        scope_reason: scope.scope_reason,
      })
    }
  }

  /** Preserves the established result envelope for lifecycle callers and logs. */
  function formatDurableLossResult(scopes) {
    if (scopes.length === 0) return { mode: 'no_unfinalized_mission' }
    if (scopes.length === 1) {
      return { mode: 'durable_loss_marker', missionId: scopes[0].mission_id }
    }
    return {
      mode: 'durable_loss_markers',
      missionIds: scopes.map((scope) => scope.mission_id),
    }
  }

  /** Immediately fences every unfinalized mission after unexpected renderer loss. */
  function markRendererUnavailable() {
    unexpectedRendererLossDetected = true
    if (unexpectedRendererLossFence !== null) return unexpectedRendererLossFence
    const pendingSettlements = [...pendingByRequestId.values()].map((pending) =>
      pending.settle(false))
    const attempt = (pendingSettlements.length === 0
      ? persistUnfinalizedMissionEvidenceLoss().then(formatDurableLossResult)
      : Promise.all(pendingSettlements).then((results) => formatDurableLossResult(
        results.flatMap((result) => result.lossScopes),
      ))).catch((error) => {
      if (unexpectedRendererLossFence === attempt) {
        unexpectedRendererLossFence = null
      }
      throw error
    })
    unexpectedRendererLossFence = attempt
    return attempt
  }

  /** Opens a fresh incident generation only after a replacement renderer loaded. */
  async function markRendererAvailable() {
    await ensureUnexpectedRendererLossFenced()
    unexpectedRendererLossDetected = false
    unexpectedRendererLossFence = null
  }

  /** Joins or retries the unexpected-loss fence before later lifecycle work. */
  function ensureUnexpectedRendererLossFenced() {
    if (!unexpectedRendererLossDetected) {
      return Promise.resolve({ mode: 'renderer_available' })
    }
    return markRendererUnavailable()
  }

  /** Removes the IPC listener and fails any still-waiting renderer request closed. */
  function dispose() {
    ipcMain.removeListener(RENDERER_TEARDOWN_READY_CHANNEL, handleRendererReady)
    for (const pending of pendingByRequestId.values()) {
      void pending.settle(false).catch(() => undefined)
    }
    pendingByRequestId.clear()
  }

  return {
    prepare,
    markRendererUnavailable,
    markRendererAvailable,
    ensureUnexpectedRendererLossFenced,
    dispose,
  }
}

/** Returns one deterministic mission scope union, preferring the latest state reason. */
function mergeRendererEvidenceScopes(...scopeGroups) {
  const byMissionId = new Map()
  for (const scopes of scopeGroups) {
    for (const scope of scopes) byMissionId.set(scope.mission_id, scope)
  }
  return [...byMissionId.values()].sort((left, right) =>
    left.mission_id.localeCompare(right.mission_id))
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
