const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')

const {
  syncDirectoryDurably,
  writeFileDurably,
} = require('./durable-file.cjs')

const INGEST_ANOMALY_OUTBOX_MAX_ENVELOPE_BYTES_HYPOTHESIS = 16 * 1024
const INGEST_ANOMALY_OUTBOX_MAX_PENDING_FILES_HYPOTHESIS = 4_096
const INGEST_ANOMALY_OUTBOX_MAX_PENDING_BYTES_HYPOTHESIS = 64 * 1024 * 1024
const INGEST_ANOMALY_OUTBOX_REPLAY_BATCH_HYPOTHESIS = 8
const DEGRADED_HEALTH_MARKER_NAME = 'degraded-health.json.marker'
const RENDERER_EVIDENCE_INCIDENT_PREFIX = 'renderer-evidence-incident-'
const RENDERER_EVIDENCE_INCIDENT_SUFFIX = '.json.marker'
const ACKNOWLEDGEABLE_EVIDENCE_LOSS_REASONS = new Set([
  'mission_persistence_failed',
  'renderer_pending_evidence_lost',
  'renderer_pending_capacity_exhausted',
])
const RENDERER_EVIDENCE_PENDING_REASON = 'renderer_evidence_pending'
const RENDERER_EVIDENCE_SCOPE_REASONS = new Set([
  'active_mission',
  'paused_recoverable_mission',
  'finished_unfinalized_mission',
])
const FAILURE_PRIORITY = [
  'outbox_health_marker_corrupt',
  'mission_persistence_failed',
  'renderer_pending_evidence_lost',
  'renderer_pending_capacity_exhausted',
  RENDERER_EVIDENCE_PENDING_REASON,
  'outbox_invalid_envelope',
  'late_evidence_after_finalization',
  'outbox_storage_unavailable',
  'outbox_capacity_exhausted',
  'outbox_corrupt_record',
  'outbox_removal_failed',
  'ledger_projection_failed',
]

/**
 * Creates a file-per-envelope durable outbox. Atomic rename and directory fsync
 * make the acknowledgement boundary explicit without retaining raw payloads.
 */
function createIngestAnomalyOutbox(options) {
  const failuresByScope = new Map()
  const recoveryKeysByScope = new Map()
  const rendererEvidenceContextsByScope = new Map()
  const rendererEvidenceIncidentsByKey = new Map()
  const lossGenerationByScope = new Map()
  let failureStateInitialized = false
  let operationTail = Promise.resolve()
  let replayRetryTimer = null
  let replayCursorName = null
  let disposed = false
  const platform = options.platform ?? process.platform
  const maxPendingFiles = options.maxPendingFiles ??
    INGEST_ANOMALY_OUTBOX_MAX_PENDING_FILES_HYPOTHESIS
  const maxPendingBytes = options.maxPendingBytes ??
    INGEST_ANOMALY_OUTBOX_MAX_PENDING_BYTES_HYPOTHESIS
  const replayBatchSize = options.replayBatchSize ??
    INGEST_ANOMALY_OUTBOX_REPLAY_BATCH_HYPOTHESIS
  const retryDelayMs = options.retryDelayMs ?? 1_000
  const assertMissionMutationAllowed = options.assertMissionMutationAllowed
    ?? (() => undefined)
  const addFailure = (scope, reason) =>
    addFailureToMap(failuresByScope, scope, reason)

  /** Serializes filesystem mutation and replay so concurrent deliveries cannot race. */
  function enqueue(operation) {
    const result = operationTail.then(operation)
    operationTail = result.catch(() => undefined)
    return result
  }

  /** Initializes and replays durable records; later calls retry in the same process. */
  function initialize() {
    if (disposed) return Promise.resolve()
    return enqueue(initializeAndReplay)
  }

  /** Stops background replay before the owning mission store closes. */
  function dispose() {
    disposed = true
    if (replayRetryTimer !== null) {
      clearTimeout(replayRetryTimer)
      replayRetryTimer = null
    }
    return operationTail
  }

  /** Writes, projects, and only then removes one canonical envelope. */
  function deliver(envelope) {
    return enqueue(async () => {
      await assertMissionMutationAllowed(envelope?.missionId)
      await fs.mkdir(options.directoryPath, { recursive: true })
      await initializeDirectoryAndFailureState()
      let serialized
      try {
        serialized = serializeEnvelope(envelope)
      } catch (error) {
        await persistFailure(envelope?.missionId, 'outbox_invalid_envelope')
        throw error
      }
      if (options.faultInjection?.failStage === true) {
        await persistFailure(
          envelope.missionId,
          'outbox_storage_unavailable',
          createDeliveryRecoveryKey(envelope.deliveryId),
        )
        throw new Error('Durable outbox write failed: storage is unavailable.')
      }
      const filePath = path.join(
        options.directoryPath,
        `${createSafeEnvelopeBasename(envelope.missionId, envelope.deliveryId)}.json`,
      )
      if (!(await fileExists(filePath))) {
        const capacity = await readPendingCapacity()
        if (
          capacity.fileCount >= maxPendingFiles ||
          capacity.totalBytes + serialized.byteLength > maxPendingBytes
        ) {
          await persistFailure(envelope.missionId, 'outbox_capacity_exhausted')
          throw new Error('Durable outbox capacity is exhausted; evidence was not acknowledged.')
        }
        await assertMissionMutationAllowed(envelope.missionId)
        try {
          await writeFileDurably(filePath, serialized.text, { platform })
        } catch (error) {
          await persistFailure(
            envelope.missionId,
            'outbox_storage_unavailable',
            createDeliveryRecoveryKey(envelope.deliveryId),
          )
          throw new Error(
            `Durable outbox write failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      await clearMatchedStorageFailure(envelope.missionId, envelope.deliveryId)
      await replayPending()
      await clearRecoveredFailures(envelope.missionId)
      return { persisted: true }
    })
  }

  /** Reports only bounded state and failure class, never anomaly content. */
  function health(missionId) {
    return enqueue(async () => {
      await initializeDirectoryAndFailureState()
      await replayPending()
      const names = await fs.readdir(options.directoryPath)
      const pendingCount = names.filter((name) =>
        name.endsWith('.json') && fileBelongsToMission(name, missionId),
      ).length
      const corruptCount = names.filter((name) =>
        name.endsWith('.corrupt') && fileBelongsToMission(name, missionId),
      ).length
      return {
        pendingCount,
        corruptCount,
        lastFailure: selectFailure(missionId, corruptCount),
      }
    })
  }

  /** Persists the honest completeness block when volatile evidence cannot be retained. */
  function markEvidenceLoss(missionId, reason) {
    return enqueue(async () => {
      await assertMissionMutationAllowed(missionId)
      await initializeDirectoryAndFailureState()
      if (![
        'mission_persistence_failed',
        'renderer_pending_capacity_exhausted',
        'renderer_pending_evidence_lost',
      ].includes(reason)) {
        throw new Error('Ingest evidence-loss reason is invalid.')
      }
      validateMissionScope(missionId)
      await assertMissionMutationAllowed(missionId)
      const scope = failureScope(missionId)
      await sealEvidenceLoss(scope, missionId, reason)
    })
  }

  /** Stages one durable incident before projecting any per-mission health markers. */
  function stageRendererEvidenceIncident(scopes, incidentId, validateScopes) {
    return enqueue(async () => {
      validateRendererEvidenceIncidentId(incidentId)
      const normalizedScopes = normalizeRendererEvidenceIncidentScopes(scopes)
      await initializeDirectoryAndFailureState()
      for (const scopeEntry of normalizedScopes) {
        await assertMissionMutationAllowed(scopeEntry.missionId)
      }
      await validateScopes?.(normalizedScopes)
      const incidentKey = createDeliveryRecoveryKey(incidentId)
      const previous = rendererEvidenceIncidentsByKey.get(incidentKey)
      const combinedScopes = mergeRendererIncidentScopes(
        previous?.scopes ?? [],
        normalizedScopes,
      )
      for (const scopeEntry of combinedScopes) {
        const existing = rendererEvidenceContextsByScope.get(scopeEntry.scope)
        if (existing !== undefined && existing.incidentKey !== incidentKey) {
          throw new Error('Another renderer evidence-drain uncertainty is already pending.')
        }
      }
      await fs.mkdir(options.directoryPath, { recursive: true })
      const incident = { incidentKey, scopes: combinedScopes }
      for (const scopeEntry of combinedScopes) {
        await assertMissionMutationAllowed(scopeEntry.missionId)
      }
      await persistRendererEvidenceIncident(incident)
      rendererEvidenceIncidentsByKey.set(incidentKey, incident)
      let stagedCount = 0
      for (const scopeEntry of combinedScopes) {
        addFailure(scopeEntry.scope, RENDERER_EVIDENCE_PENDING_REASON)
        recoveryKeysByScope.set(scopeEntry.scope, new Map([
          ...(recoveryKeysByScope.get(scopeEntry.scope) ?? []),
          [RENDERER_EVIDENCE_PENDING_REASON, incidentKey],
        ]))
        rendererEvidenceContextsByScope.set(scopeEntry.scope, {
          incidentKey,
          scopeReason: scopeEntry.scopeReason,
        })
        await assertMissionMutationAllowed(scopeEntry.missionId)
        await persistFailureScope(scopeEntry.scope)
        stagedCount += 1
        if (
          Number.isFinite(options.faultInjection?.failRendererStageAfterScopeCount) &&
          stagedCount >= options.faultInjection.failRendererStageAfterScopeCount
        ) {
          throw new Error('Injected renderer incident stage failure.')
        }
      }
    })
  }

  /** Preserves the earlier single-scope API on top of the durable incident unit. */
  function stageRendererEvidenceUncertainty(
    missionId,
    incidentId,
    scopeReason,
    validateScopes,
  ) {
    validateMissionScope(missionId)
    validateRendererEvidenceScopeReason(scopeReason)
    return stageRendererEvidenceIncident(
      [{ missionId, scopeReason }],
      incidentId,
      validateScopes,
    )
  }

  /** Retracts a clean late drain or seals an actual renderer-loss occurrence exactly once. */
  function resolveRendererEvidenceUncertainty(missionId, incidentId, outcome) {
    return enqueue(async () => {
      validateMissionScope(missionId)
      validateRendererEvidenceIncidentId(incidentId)
      if (!['drained', 'lost'].includes(outcome)) {
        throw new Error('Renderer evidence-drain outcome is invalid.')
      }
      await assertMissionMutationAllowed(missionId)
      await initializeDirectoryAndFailureState()
      const scope = failureScope(missionId)
      const incidentKey = createDeliveryRecoveryKey(incidentId)
      const context = rendererEvidenceContextsByScope.get(scope)
      if (context === undefined || context.incidentKey !== incidentKey) {
        throw new Error('Renderer evidence-drain uncertainty does not match the pending incident.')
      }
      await assertMissionMutationAllowed(missionId)
      await resolveRendererEvidenceIncidentScopes(incidentKey, [scope], outcome)
    })
  }

  /** Resolves one exact incident or sweeps every earlier incident after a clean drain. */
  function resolveRendererEvidenceIncidents(incidentId, outcome) {
    return enqueue(async () => {
      if (incidentId !== null) validateRendererEvidenceIncidentId(incidentId)
      if (!['drained', 'lost'].includes(outcome)) {
        throw new Error('Renderer evidence-drain outcome is invalid.')
      }
      await initializeDirectoryAndFailureState()
      const incidentKeys = incidentId === null
        ? [...rendererEvidenceIncidentsByKey.keys()].sort()
        : [createDeliveryRecoveryKey(incidentId)]
      const resolvedScopes = []
      for (const incidentKey of incidentKeys) {
        const incident = rendererEvidenceIncidentsByKey.get(incidentKey)
        if (incident === undefined) continue
        for (const scopeEntry of incident.scopes) {
          await assertMissionMutationAllowed(scopeEntry.missionId)
        }
        resolvedScopes.push(...await resolveRendererEvidenceIncidentScopes(
          incidentKey,
          incident.scopes.map((scopeEntry) => scopeEntry.scope),
          outcome,
        ))
      }
      if (outcome === 'drained') await retractOrphanRendererEvidencePending()
      return resolvedScopes
    })
  }

  /** Returns the exact durable loss occurrence an admin may acknowledge. */
  function readEvidenceLossAcknowledgementCandidate(missionId) {
    return enqueue(async () => {
      validateMissionScope(missionId)
      await initializeDirectoryAndFailureState()
      const names = await fs.readdir(options.directoryPath)
      if (names.some((name) =>
        (name.endsWith('.json') || name.endsWith('.corrupt')) &&
        fileBelongsToMission(name, missionId),
      )) {
        throw new Error('No isolated mission evidence loss is available to acknowledge.')
      }
      return createEvidenceLossAcknowledgementCandidate(missionId)
    })
  }

  /**
   * Holds the durable-delivery queue while one completeness operation runs.
   * Earlier deliveries drain first; later deliveries observe finalized state.
   */
  function runWithHealthyEvidenceFence(missionId, operationName, operation, fenceOptions = {}) {
    return enqueue(async () => {
      validateMissionScope(missionId)
      await initializeDirectoryAndFailureState()
      await replayPending()
      const names = await fs.readdir(options.directoryPath)
      const pendingCount = names.filter((name) =>
        name.endsWith('.json') && fileBelongsToMission(name, missionId),
      ).length
      const corruptCount = names.filter((name) =>
        name.endsWith('.corrupt') && fileBelongsToMission(name, missionId),
      ).length
      const failure = selectFailure(missionId, corruptCount)
      const acknowledgedLossMatches =
        typeof fenceOptions.acknowledgedLossToken === 'string' &&
        evidenceLossAcknowledgementMatches(missionId, fenceOptions.acknowledgedLossToken)
      if (
        pendingCount > 0 ||
        corruptCount > 0 ||
        (failure !== null && !acknowledgedLossMatches)
      ) {
        const error = new Error(
          `Degraded evidence health blocks ${operationName}; resolve durable ingest evidence before continuing.`,
        )
        error.code = 'EVIDENCE_HEALTH_BLOCKED'
        throw error
      }
      return operation()
    })
  }

  /** Replays committed files in deterministic order and quarantines corruption. */
  async function initializeAndReplay() {
    // initialize() may already be queued when the owning mission store closes.
    // Once disposal wins that race, startup must not recreate app-addressable
    // outbox state after the store has released its filesystem ownership.
    if (disposed) return
    await initializeDirectoryAndFailureState()
    if (disposed) return
    await replayPending()
  }

  /** Replays every currently staged envelope until projection becomes unavailable. */
  async function replayPending() {
    const pendingNames = (await fs.readdir(options.directoryPath))
      .filter((name) => name.endsWith('.json'))
      .sort()
    const names = selectReplayBatch(pendingNames, replayCursorName, replayBatchSize)
    if (names.length > 0) replayCursorName = names.at(-1)
    let projectedCount = 0
    for (const name of names) {
      const filePath = path.join(options.directoryPath, name)
      let envelope
      try {
        envelope = parseEnvelope(await fs.readFile(filePath, 'utf8'))
      } catch {
        await fs.rename(filePath, `${filePath}.corrupt`)
        await syncDirectoryDurably(options.directoryPath, { platform })
        await persistFailureForFile(name, 'outbox_corrupt_record')
        continue
      }
      try {
        await options.projectEnvelope(envelope)
      } catch (error) {
        await persistFailure(
          envelope.missionId,
          error?.code === 'LATE_EVIDENCE_AFTER_FINALIZATION'
            ? 'late_evidence_after_finalization'
            : 'ledger_projection_failed',
        )
        continue
      }
      if (options.faultInjection?.failRemovalAfterProjection === true) {
        await persistFailure(envelope.missionId, 'outbox_removal_failed')
        throw new Error('Injected outbox removal after projection failure.')
      }
      await fs.unlink(filePath)
      await syncDirectoryDurably(options.directoryPath, { platform })
      projectedCount += 1
      await clearRecoveredFailures(envelope.missionId)
      await yieldToMainEventLoop()
    }
    const remainingPendingCount = (await fs.readdir(options.directoryPath))
      .filter((name) => name.endsWith('.json')).length
    scheduleReplayRetry(remainingPendingCount, projectedCount)
  }

  /** Retries bounded replay in background, draining quickly only after progress. */
  function scheduleReplayRetry(pendingCount, projectedCount) {
    if (disposed || pendingCount === 0 || replayRetryTimer !== null) return
    const delayMs = projectedCount > 0 ? 0 : retryDelayMs
    replayRetryTimer = setTimeout(() => {
      replayRetryTimer = null
      void initialize().catch(() => undefined)
    }, delayMs)
    replayRetryTimer.unref?.()
  }

  /** Creates the directory and reloads a durable degraded marker after restart. */
  async function initializeDirectoryAndFailureState() {
    await fs.mkdir(options.directoryPath, { recursive: true })
    if (failureStateInitialized) return
    const names = await fs.readdir(options.directoryPath)
    const incidentNames = names.filter(isRendererEvidenceIncidentFileName)
    let corruptIncidentDetected = false
    for (const incidentName of incidentNames) {
      try {
        const incident = parseRendererEvidenceIncident(
          incidentName,
          await fs.readFile(path.join(options.directoryPath, incidentName), 'utf8'),
        )
        rendererEvidenceIncidentsByKey.set(incident.incidentKey, incident)
      } catch {
        addFailure('global', 'outbox_health_marker_corrupt')
        corruptIncidentDetected = true
      }
    }
    const markerNames = names.filter((name) =>
      name === DEGRADED_HEALTH_MARKER_NAME ||
      /^degraded-health-(?:global|[a-f0-9]{16})\.json\.marker$/u.test(name),
    )
    for (const markerName of markerNames) {
      const scope = markerScopeFromName(markerName)
      try {
        const marker = JSON.parse(
          await fs.readFile(path.join(options.directoryPath, markerName), 'utf8'),
        )
        const reasons = Array.isArray(marker?.reasons)
          ? marker.reasons.filter(isFailureReason)
          : isFailureReason(marker?.reason)
            ? [marker.reason]
            : []
        if (reasons.length === 0) {
          addFailure(scope, 'outbox_health_marker_corrupt')
        } else {
          failuresByScope.set(scope, new Set(reasons))
          const lossGeneration = marker?.lossGeneration
          if (Number.isSafeInteger(lossGeneration) && lossGeneration >= 0) {
            lossGenerationByScope.set(scope, lossGeneration)
          }
          const recoveryKeys = marker?.recoveryKeys
          if (recoveryKeys !== null && typeof recoveryKeys === 'object') {
            recoveryKeysByScope.set(scope, new Map(
              Object.entries(recoveryKeys).filter(
                ([reason, key]) => isFailureReason(reason) &&
                  typeof key === 'string' && /^[a-f0-9]{64}$/u.test(key),
              ),
            ))
          }
          const rendererContext = marker?.rendererEvidenceContexts?.renderer_evidence_pending
          if (
            rendererContext !== null &&
            typeof rendererContext === 'object' &&
            typeof rendererContext.incidentKey === 'string' &&
            /^[a-f0-9]{64}$/u.test(rendererContext.incidentKey) &&
            RENDERER_EVIDENCE_SCOPE_REASONS.has(rendererContext.scopeReason)
          ) {
            rendererEvidenceContextsByScope.set(scope, {
              incidentKey: rendererContext.incidentKey,
              scopeReason: rendererContext.scopeReason,
            })
          }
        }
      } catch {
        addFailure(scope, 'outbox_health_marker_corrupt')
      }
    }
    for (const incident of [...rendererEvidenceIncidentsByKey.values()]) {
      for (const scopeEntry of incident.scopes) {
        removeRendererEvidencePendingInMemory(scopeEntry.scope)
        if (!failuresByScope.get(scopeEntry.scope)?.has('renderer_pending_evidence_lost')) {
          addFailure(scopeEntry.scope, 'renderer_pending_evidence_lost')
          lossGenerationByScope.set(
            scopeEntry.scope,
            (lossGenerationByScope.get(scopeEntry.scope) ?? 0) + 1,
          )
        }
        await persistFailureScope(scopeEntry.scope)
      }
      await removeRendererEvidenceIncident(incident.incidentKey)
    }
    if (corruptIncidentDetected) await persistFailureScope('global')
    await retractOrphanRendererEvidencePending()
    failureStateInitialized = true
  }

  /** Resolves selected scopes while preserving crash-safe drained/lost ordering. */
  async function resolveRendererEvidenceIncidentScopes(incidentKey, scopes, outcome) {
    const incident = rendererEvidenceIncidentsByKey.get(incidentKey)
    if (incident === undefined) {
      throw new Error('Renderer evidence-drain uncertainty does not match the pending incident.')
    }
    const selected = new Set(scopes)
    const resolving = incident.scopes.filter((entry) => selected.has(entry.scope))
    const remaining = incident.scopes.filter((entry) => !selected.has(entry.scope))
    if (outcome === 'drained') {
      for (const scopeEntry of resolving) {
        await assertMissionMutationAllowed(scopeEntry.missionId)
      }
      await replaceRendererEvidenceIncident(incidentKey, remaining)
    }
    for (const scopeEntry of resolving) {
      await assertMissionMutationAllowed(scopeEntry.missionId)
      removeRendererEvidencePendingInMemory(scopeEntry.scope)
      if (outcome === 'lost') {
        if (!failuresByScope.get(scopeEntry.scope)?.has('renderer_pending_evidence_lost')) {
          addFailure(scopeEntry.scope, 'renderer_pending_evidence_lost')
          lossGenerationByScope.set(
            scopeEntry.scope,
            (lossGenerationByScope.get(scopeEntry.scope) ?? 0) + 1,
          )
        }
      }
      await assertMissionMutationAllowed(scopeEntry.missionId)
      await persistFailureScope(scopeEntry.scope)
    }
    if (outcome === 'lost') {
      for (const scopeEntry of resolving) {
        await assertMissionMutationAllowed(scopeEntry.missionId)
      }
      await replaceRendererEvidenceIncident(incidentKey, remaining)
    }
    return resolving
  }

  /** Removes pending marker projections that have no surviving incident owner. */
  async function retractOrphanRendererEvidencePending() {
    const owned = new Set([...rendererEvidenceIncidentsByKey.values()].flatMap((incident) =>
      incident.scopes.map((scopeEntry) => `${scopeEntry.scope}:${incident.incidentKey}`)))
    for (const [scope, context] of [...rendererEvidenceContextsByScope]) {
      if (owned.has(`${scope}:${context.incidentKey}`)) continue
      removeRendererEvidencePendingInMemory(scope)
      await persistFailureScope(scope)
    }
  }

  /** Rewrites or removes the one durable incident truth record. */
  async function replaceRendererEvidenceIncident(incidentKey, scopes) {
    if (scopes.length === 0) {
      await removeRendererEvidenceIncident(incidentKey)
      return
    }
    const incident = { incidentKey, scopes }
    await persistRendererEvidenceIncident(incident)
    rendererEvidenceIncidentsByKey.set(incidentKey, incident)
  }

  /** Persists one bounded opaque incident before per-scope health projection. */
  async function persistRendererEvidenceIncident(incident) {
    await writeFileDurably(
      path.join(options.directoryPath, rendererEvidenceIncidentFileName(incident.incidentKey)),
      JSON.stringify({ version: 1, ...incident }),
      { platform },
    )
  }

  /** Removes one incident durably before drained marker cleanup can be interrupted. */
  async function removeRendererEvidenceIncident(incidentKey) {
    await fs.rm(
      path.join(options.directoryPath, rendererEvidenceIncidentFileName(incidentKey)),
      { force: true },
    )
    await syncDirectoryDurably(options.directoryPath, { platform })
    rendererEvidenceIncidentsByKey.delete(incidentKey)
  }

  /** Persists only a bounded failure class; anomaly content never enters the marker. */
  async function persistFailure(missionId, reason, recoveryKey, requireDurable = false) {
    const scope = failureScope(missionId)
    if (
      !requireDurable &&
      failuresByScope.get(scope)?.has(reason) === true &&
      (recoveryKey === undefined || recoveryKeysByScope.get(scope)?.get(reason) === recoveryKey)
    ) return
    addFailure(scope, reason)
    if (recoveryKey !== undefined) {
      const recoveryKeys = recoveryKeysByScope.get(scope) ?? new Map()
      recoveryKeys.set(reason, recoveryKey)
      recoveryKeysByScope.set(scope, recoveryKeys)
    }
    try {
      await fs.mkdir(options.directoryPath, { recursive: true })
      await persistFailureScope(scope)
    } catch (error) {
      // No writable local storage is the explicit impossibility boundary. The
      // in-process state remains critical and no evidence is acknowledged.
      if (requireDurable) throw error
    }
  }

  /** Clears only failure classes whose underlying durable state is now healthy. */
  async function clearRecoveredFailures(missionId) {
    const names = await fs.readdir(options.directoryPath)
    const hasPending = names.some((name) =>
      name.endsWith('.json') && fileBelongsToMission(name, missionId),
    )
    const hasCorrupt = names.some((name) =>
      name.endsWith('.corrupt') && fileBelongsToMission(name, missionId),
    )
    if (hasPending || hasCorrupt) return
    const capacity = await readPendingCapacity()
    const recoverable = [
      'ledger_projection_failed',
      'outbox_removal_failed',
      ...(capacity.fileCount < maxPendingFiles && capacity.totalBytes < maxPendingBytes
        ? ['outbox_capacity_exhausted']
        : []),
    ]
    await removeFailures(failureScope(missionId), recoverable)
  }

  /** Clears storage degradation only when the exact failed delivery is staged. */
  async function clearMatchedStorageFailure(missionId, deliveryId) {
    const scope = failureScope(missionId)
    const expected = recoveryKeysByScope.get(scope)?.get('outbox_storage_unavailable')
    if (expected !== createDeliveryRecoveryKey(deliveryId)) return
    await removeFailures(scope, ['outbox_storage_unavailable'])
  }

  /** Returns bounded aggregate pending capacity without reading evidence content. */
  async function readPendingCapacity() {
    const names = (await fs.readdir(options.directoryPath))
      .filter((name) => name.endsWith('.json') || name.endsWith('.corrupt'))
    let totalBytes = 0
    for (const name of names) {
      totalBytes += (await fs.stat(path.join(options.directoryPath, name))).size
    }
    return { fileCount: names.length, totalBytes }
  }

  /** Persists one scope's bounded set of failure classes. */
  async function persistFailureScope(scope) {
    const reasons = [...(failuresByScope.get(scope) ?? [])].sort()
    const recoveryKeys = Object.fromEntries(recoveryKeysByScope.get(scope) ?? [])
    const lossGeneration = lossGenerationByScope.get(scope) ?? 0
    const rendererContext = rendererEvidenceContextsByScope.get(scope)
    const rendererEvidenceContexts = rendererContext === undefined
      ? {}
      : { renderer_evidence_pending: rendererContext }
    const markerPath = path.join(options.directoryPath, markerNameForScope(scope))
    if (reasons.length === 0) {
      await fs.rm(markerPath, { force: true })
      await syncDirectoryDurably(options.directoryPath, { platform })
      return
    }
    await writeFileDurably(
      markerPath,
      JSON.stringify({ reasons, recoveryKeys, lossGeneration, rendererEvidenceContexts }),
      { platform },
    )
  }

  /** Removes selected recoverable reasons without erasing sticky evidence loss. */
  async function removeFailures(scope, reasons) {
    const current = failuresByScope.get(scope)
    if (current === undefined) return
    for (const reason of reasons) {
      current.delete(reason)
      recoveryKeysByScope.get(scope)?.delete(reason)
      if (reason === RENDERER_EVIDENCE_PENDING_REASON) {
        rendererEvidenceContextsByScope.delete(scope)
      }
    }
    if (current.size === 0) {
      failuresByScope.delete(scope)
      recoveryKeysByScope.delete(scope)
      rendererEvidenceContextsByScope.delete(scope)
    }
    await persistFailureScope(scope)
  }

  /** Records corruption against the filename's durable mission hash. */
  async function persistFailureForFile(fileName, reason) {
    const match = /^([a-f0-9]{16})-[a-f0-9]{64}\.json$/u.exec(fileName)
    if (match === null) {
      await persistFailure(undefined, reason)
      return
    }
    const scope = match[1]
    addFailure(scope, reason)
    try {
      await persistFailureScope(scope)
    } catch {
      // In-memory health remains fail-closed when the marker itself cannot write.
    }
  }

  /** Chooses the most severe visible failure for one mission without leaking content. */
  function selectFailure(missionId, corruptCount) {
    const reasons = new Set([
      ...(failuresByScope.get('global') ?? []),
      ...(missionId === undefined
        ? [...failuresByScope.values()].flatMap((entries) => [...entries])
        : [...(failuresByScope.get(failureScope(missionId)) ?? [])]),
    ])
    if (corruptCount > 0) reasons.add('outbox_corrupt_record')
    return FAILURE_PRIORITY.find((reason) => reasons.has(reason)) ?? null
  }

  return {
    deliver,
    dispose,
    health,
    initialize,
    markEvidenceLoss,
    resolveRendererEvidenceIncidents,
    resolveRendererEvidenceUncertainty,
    stageRendererEvidenceIncident,
    stageRendererEvidenceUncertainty,
    readEvidenceLossAcknowledgementCandidate,
    runWithHealthyEvidenceFence,
  }

  /** Builds a non-secret token for the exact sticky loss state of one mission. */
  function createEvidenceLossAcknowledgementCandidate(missionId) {
    const scope = failureScope(missionId)
    const globalFailures = failuresByScope.get('global') ?? new Set()
    const scopedFailures = failuresByScope.get(scope) ?? new Set()
    const reasons = [...scopedFailures].sort()
    if (
      globalFailures.size > 0 ||
      reasons.length === 0 ||
      reasons.some((reason) => !ACKNOWLEDGEABLE_EVIDENCE_LOSS_REASONS.has(reason))
    ) {
      throw new Error('No isolated mission evidence loss is available to acknowledge.')
    }
    const lossGeneration = lossGenerationByScope.get(scope) ?? 0
    return {
      token: createHash('sha256')
        .update(JSON.stringify({ scope, reasons, lossGeneration }), 'utf8')
        .digest('hex'),
      reasons,
    }
  }

  /** Accepts only a token for the current isolated sticky loss occurrence. */
  function evidenceLossAcknowledgementMatches(missionId, token) {
    try {
      return createEvidenceLossAcknowledgementCandidate(missionId).token === token
    } catch {
      return false
    }
  }

  /** Converts one confirmed renderer incident into a sticky loss generation. */
  async function sealEvidenceLoss(scope, missionId, reason) {
    await assertMissionMutationAllowed(missionId)
    lossGenerationByScope.set(scope, (lossGenerationByScope.get(scope) ?? 0) + 1)
    addFailure(scope, reason)
    await fs.mkdir(options.directoryPath, { recursive: true })
    await persistFailureScope(scope)
  }

  /** Removes only the exact provisional renderer state from one mission scope. */
  function removeRendererEvidencePendingInMemory(scope) {
    failuresByScope.get(scope)?.delete(RENDERER_EVIDENCE_PENDING_REASON)
    recoveryKeysByScope.get(scope)?.delete(RENDERER_EVIDENCE_PENDING_REASON)
    rendererEvidenceContextsByScope.delete(scope)
    if (failuresByScope.get(scope)?.size === 0) failuresByScope.delete(scope)
    if (recoveryKeysByScope.get(scope)?.size === 0) recoveryKeysByScope.delete(scope)
  }
}

/** Selects a bounded circular slice so terminal records cannot starve later evidence. */
function selectReplayBatch(names, cursorName, batchSize) {
  if (names.length <= batchSize) return names
  const firstAfterCursor = cursorName === null
    ? 0
    : names.findIndex((name) => name > cursorName)
  const start = firstAfterCursor < 0 ? 0 : firstAfterCursor
  return Array.from(
    { length: Math.min(batchSize, names.length) },
    (_, index) => names[(start + index) % names.length],
  )
}

/** Validates and serializes the allow-listed envelope shape. */
function serializeEnvelope(envelope) {
  validateEnvelope(envelope)
  const text = JSON.stringify(envelope)
  const byteLength = Buffer.byteLength(text, 'utf8')
  if (byteLength > INGEST_ANOMALY_OUTBOX_MAX_ENVELOPE_BYTES_HYPOTHESIS) {
    throw new Error('Canonical rejection envelope exceeds the bounded evidence hypothesis.')
  }
  return { text, byteLength }
}

/** Parses one staged canonical envelope without accepting arbitrary shapes. */
function parseEnvelope(contents) {
  const envelope = JSON.parse(contents)
  validateEnvelope(envelope)
  return envelope
}

/** Checks the narrow renderer-to-main rejection contract. */
function validateEnvelope(envelope) {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Rejected-position envelope is invalid.')
  }
  for (const key of ['deliveryId', 'missionId', 'anomalyKey', 'reasonClass', 'receivedAt']) {
    if (typeof envelope[key] !== 'string' || envelope[key].trim() === '') {
      throw new Error(`Rejected-position envelope ${key} is invalid.`)
    }
  }
  if (!/^[A-Za-z0-9._:-]{1,160}$/u.test(envelope.deliveryId)) {
    throw new Error('Rejected-position delivery identity is invalid.')
  }
  if (
    envelope.canonicalEvidence === null ||
    typeof envelope.canonicalEvidence !== 'object' ||
    Array.isArray(envelope.canonicalEvidence)
  ) {
    throw new Error('Rejected-position canonical evidence is invalid.')
  }
}

/** Maps an arbitrary delivery identity to a portable opaque filename. */
function createSafeEnvelopeBasename(missionId, deliveryId) {
  return `${createMissionFilePrefix(missionId)}-${createHash('sha256')
    .update(deliveryId, 'utf8')
    .digest('hex')}`
}

/** Creates an opaque key proving the same failed delivery was later staged. */
function createDeliveryRecoveryKey(deliveryId) {
  return createHash('sha256').update(deliveryId, 'utf8').digest('hex')
}

/** Creates a non-reversible mission scope retained even if envelope JSON corrupts. */
function createMissionFilePrefix(missionId) {
  return createHash('sha256').update(missionId, 'utf8').digest('hex').slice(0, 16)
}

/** Scopes new outbox files while treating legacy opaque names conservatively. */
function fileBelongsToMission(fileName, missionId) {
  if (missionId === undefined) return true
  const scopedPattern = /^[a-f0-9]{16}-[a-f0-9]{64}\.json(?:\.corrupt)?$/u
  return !scopedPattern.test(fileName) || fileName.startsWith(`${createMissionFilePrefix(missionId)}-`)
}

/** Returns the opaque marker scope for a mission, or the conservative global scope. */
function failureScope(missionId) {
  return typeof missionId === 'string' && missionId.trim() !== ''
    ? createMissionFilePrefix(missionId)
    : 'global'
}

/** Rejects evidence-loss requests that cannot be attributed to a mission. */
function validateMissionScope(missionId) {
  if (typeof missionId !== 'string' || missionId.trim() === '') {
    throw new Error('Ingest evidence loss requires a mission identity.')
  }
}

/** Rejects an unbounded renderer teardown incident identity. */
function validateRendererEvidenceIncidentId(incidentId) {
  if (typeof incidentId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/u.test(incidentId)) {
    throw new Error('Renderer evidence-drain incident identity is invalid.')
  }
}

/** Rejects renderer uncertainty that is not attributed to a bounded mission state. */
function validateRendererEvidenceScopeReason(scopeReason) {
  if (!RENDERER_EVIDENCE_SCOPE_REASONS.has(scopeReason)) {
    throw new Error('Renderer evidence-drain mission scope reason is invalid.')
  }
}

/** Maps a bounded opaque scope to its durable marker filename. */
function markerNameForScope(scope) {
  return scope === 'global'
    ? DEGRADED_HEALTH_MARKER_NAME
    : `degraded-health-${scope}.json.marker`
}

/** Recovers marker scope from current and legacy filenames. */
function markerScopeFromName(fileName) {
  if (fileName === DEGRADED_HEALTH_MARKER_NAME) return 'global'
  return fileName.slice('degraded-health-'.length, -'.json.marker'.length)
}

/** Converts validated mission inputs into bounded opaque incident scopes. */
function normalizeRendererEvidenceIncidentScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0 || scopes.length > 256) {
    throw new Error('Renderer evidence incident scopes are invalid.')
  }
  const normalized = scopes.map((entry) => {
    validateMissionScope(entry?.missionId)
    validateRendererEvidenceScopeReason(entry?.scopeReason)
    return {
      missionId: entry.missionId,
      scope: failureScope(entry.missionId),
      scopeReason: entry.scopeReason,
    }
  })
  return mergeRendererIncidentScopes([], normalized)
}

/** Merges incident scopes deterministically and rejects conflicting mission state. */
function mergeRendererIncidentScopes(left, right) {
  const byScope = new Map()
  for (const entry of [...left, ...right]) {
    const previous = byScope.get(entry.scope)
    if (
      previous !== undefined &&
      (previous.scopeReason !== entry.scopeReason || previous.missionId !== entry.missionId)
    ) {
      throw new Error('Renderer evidence incident scope reason changed while staging.')
    }
    byScope.set(entry.scope, entry)
  }
  return [...byScope.values()].sort((a, b) => a.scope.localeCompare(b.scope))
}

/** Parses one durable incident without trusting its filename or payload shape. */
function parseRendererEvidenceIncident(fileName, contents) {
  if (!isRendererEvidenceIncidentFileName(fileName)) {
    throw new Error('Renderer evidence incident filename is invalid.')
  }
  const incident = JSON.parse(contents)
  const incidentKey = fileName.slice(
    RENDERER_EVIDENCE_INCIDENT_PREFIX.length,
    -RENDERER_EVIDENCE_INCIDENT_SUFFIX.length,
  )
  if (
    incident?.version !== 1 ||
    incident?.incidentKey !== incidentKey ||
    !/^[a-f0-9]{64}$/u.test(incidentKey) ||
    !Array.isArray(incident?.scopes) ||
    incident.scopes.length === 0 ||
    incident.scopes.length > 256
  ) {
    throw new Error('Renderer evidence incident record is invalid.')
  }
  const scopes = incident.scopes.map((entry) => {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      typeof entry.missionId !== 'string' ||
      entry.missionId.trim() === '' ||
      typeof entry.scope !== 'string' ||
      !/^[a-f0-9]{16}$/u.test(entry.scope) ||
      entry.scope !== failureScope(entry.missionId) ||
      !RENDERER_EVIDENCE_SCOPE_REASONS.has(entry.scopeReason)
    ) {
      throw new Error('Renderer evidence incident scope is invalid.')
    }
    return {
      missionId: entry.missionId,
      scope: entry.scope,
      scopeReason: entry.scopeReason,
    }
  })
  return { incidentKey, scopes: mergeRendererIncidentScopes([], scopes) }
}

/** Creates the allow-listed opaque incident marker filename. */
function rendererEvidenceIncidentFileName(incidentKey) {
  if (typeof incidentKey !== 'string' || !/^[a-f0-9]{64}$/u.test(incidentKey)) {
    throw new Error('Renderer evidence incident key is invalid.')
  }
  return `${RENDERER_EVIDENCE_INCIDENT_PREFIX}${incidentKey}${RENDERER_EVIDENCE_INCIDENT_SUFFIX}`
}

/** Recognizes only current opaque renderer incident marker files. */
function isRendererEvidenceIncidentFileName(fileName) {
  return /^renderer-evidence-incident-[a-f0-9]{64}\.json\.marker$/u.test(fileName)
}

/** Adds one bounded failure class to in-memory health. */
function addFailureToMap(failuresByScope, scope, reason) {
  const reasons = failuresByScope.get(scope) ?? new Set()
  reasons.add(reason)
  failuresByScope.set(scope, reasons)
}

/** Accepts only bounded failure class tokens from a durable marker. */
function isFailureReason(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,79}$/u.test(value)
}

/** Gives Electron's main event loop a turn between synchronous projections. */
function yieldToMainEventLoop() {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Returns whether a staged filename already exists without exposing its content. */
async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

module.exports = {
  createIngestAnomalyOutbox,
}
