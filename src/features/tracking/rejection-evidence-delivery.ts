import type { CurrentPositionRejection } from './ingest-health'
import type {
  IngestEvidenceHealth,
  IngestRejectionEnvelope,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { createRejectedPositionDeliveryId } from './rejected-position-evidence'
import type { IngestEvidenceLossReason } from '../../domain/tracking-ingest-evidence'

export const REJECTION_EVIDENCE_DELIVERY_BATCH_HYPOTHESIS = 256
export const REJECTION_EVIDENCE_PENDING_MEMORY_CAP_HYPOTHESIS = 4_096

type RejectionEvidenceMissionStore = {
  readonly recordIngestRejections: (input: {
    readonly mission_id: string
    readonly rejections: readonly IngestRejectionEnvelope[]
  }) => Promise<{
    readonly acknowledgedDeliveryIds: readonly string[]
    readonly health: IngestEvidenceHealth
  }>
  readonly recordIngestEvidenceLoss?: (input: {
    readonly mission_id: string
    readonly reason: IngestEvidenceLossReason
  }) => Promise<IngestEvidenceHealth>
}

type RejectionEvidenceDeliveryDependencies = {
  readonly missionStore: RejectionEvidenceMissionStore
  readonly applyRejections: (rejections: readonly CurrentPositionRejection[]) => void
  readonly applyEvidenceHealth: (health: IngestEvidenceHealth) => void
  readonly readEvidenceHealth?: () => IngestEvidenceHealth
  readonly createDeliveryId?: (
    missionId: string,
    anomalyKey: string,
    sequence: number,
  ) => string
  readonly setTimeout?: typeof globalThis.setTimeout
  readonly clearTimeout?: typeof globalThis.clearTimeout
  readonly retryDelayMs?: number
}

export type RejectionEvidenceObservationContext = {
  readonly missionId: string | null
  readonly observedAt: string
}

export type MissionEvidenceObservation = {
  readonly missionId: string | null
  readonly complete: () => void
}

export type RejectionEvidenceDelivery = {
  readonly beginMissionObservation: (missionId: string | null) => MissionEvidenceObservation
  readonly recordMissionEvidenceLoss: (
    missionId: string,
    reason: IngestEvidenceLossReason,
  ) => Promise<void>
  readonly record: (
    rejections: readonly CurrentPositionRejection[],
    context: RejectionEvidenceObservationContext,
  ) => void
  readonly recordEvidence: (
    rejections: readonly CurrentPositionRejection[],
    context: RejectionEvidenceObservationContext,
  ) => void
  readonly recordEvidenceAndFlush: (
    rejections: readonly CurrentPositionRejection[],
    context: RejectionEvidenceObservationContext,
  ) => Promise<void>
  readonly flushMission: (missionId: string) => Promise<void>
  readonly applyMissionHealth: (missionId: string, health: IngestEvidenceHealth) => void
  readonly runWithMissionFinishFence: <Result>(
    missionId: string,
    operation: () => Promise<Result>,
  ) => Promise<Result>
  readonly runWithMissionFinalizationFence: <Result>(
    missionId: string,
    operation: () => Promise<Result>,
  ) => Promise<Result>
  readonly reopenMissionEvidenceAfterUnlock: (missionId: string) => void
  readonly registerMissionObservationSettler: (
    settler: (missionId: string) => Promise<void>,
  ) => () => void
  readonly dispose: () => Promise<void>
}

type PendingRejectionEnvelope = IngestRejectionEnvelope & {
  readonly missionId: string
}

/**
 * Keeps operator rejection visibility synchronous while delivering only unique
 * canonical evidence through the durable main-process outbox.
 */
export function createRejectionEvidenceDelivery(
  dependencies: RejectionEvidenceDeliveryDependencies,
): RejectionEvidenceDelivery {
  const pendingByMissionAndAnomaly = new Map<string, PendingRejectionEnvelope>()
  const acknowledgedMissionAnomalies = new Set<string>()
  const createDeliveryId = dependencies.createDeliveryId ?? createRejectedPositionDeliveryId
  const setTimeoutFn = dependencies.setTimeout ?? globalThis.setTimeout
  const clearTimeoutFn = dependencies.clearTimeout ?? globalThis.clearTimeout
  const retryDelayMs = dependencies.retryDelayMs ?? 1_000
  let nextDeliverySequence = 0
  let flushInFlight: Promise<boolean> | null = null
  let flushScheduled = false
  let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  let disposed = false
  let disposing = false
  let accepting = true
  let disposalPromise: Promise<void> | null = null
  const evidenceLossMissionIds = new Set<string>()
  const evidenceLossReasonByMission = new Map<string, IngestEvidenceLossReason>()
  const durableEvidenceLossMissionIds = new Set<string>()
  const evidenceLossWriteByMission = new Map<string, Promise<void>>()
  const durableHealthByMission = new Map<string, IngestEvidenceHealth>()
  const finalizedHealthByMission = new Map<string, IngestEvidenceHealth>()
  const finalizedEvidenceLossMissionIds = new Set<string>()
  const finalizationPhaseByMission = new Map<
    string,
    'finishing' | 'finished' | 'draining' | 'sealed' | 'finalized'
  >()
  const finalizationEpochByMission = new Map<string, number>()
  const observationScopeClosedMissionIds = new Set<string>()
  const activeObservationCountByMission = new Map<string, number>()
  const observationWaitersByMission = new Map<string, Set<() => void>>()
  let missionObservationSettler: ((missionId: string) => Promise<void>) | null = null

  /** Tracks one current-position observation until its mission evidence is staged. */
  function beginMissionObservation(missionId: string | null): MissionEvidenceObservation {
    if (missionId === null || observationScopeClosedMissionIds.has(missionId)) {
      return { missionId: null, complete: () => undefined }
    }
    activeObservationCountByMission.set(
      missionId,
      (activeObservationCountByMission.get(missionId) ?? 0) + 1,
    )
    let completed = false
    return {
      missionId,
      complete: () => {
        if (completed) return
        completed = true
        const remaining = (activeObservationCountByMission.get(missionId) ?? 1) - 1
        if (remaining > 0) {
          activeObservationCountByMission.set(missionId, remaining)
          return
        }
        activeObservationCountByMission.delete(missionId)
        const waiters = observationWaitersByMission.get(missionId)
        observationWaitersByMission.delete(missionId)
        for (const resolve of waiters ?? []) resolve()
      },
    }
  }

  /** Publishes current warnings immediately and schedules non-blocking delivery. */
  function record(
    rejections: readonly CurrentPositionRejection[],
    context: RejectionEvidenceObservationContext,
  ): void {
    if (!accepting) return
    dependencies.applyRejections(rejections)
    recordEvidence(rejections, context)
  }

  /** Schedules durable anomaly evidence without replacing current-position UI health. */
  function recordEvidence(
    rejections: readonly CurrentPositionRejection[],
    context: RejectionEvidenceObservationContext,
  ): void {
    if (!accepting) return
    const finalizationPhase = context.missionId === null
      ? undefined
      : finalizationPhaseByMission.get(context.missionId)
    if (finalizationPhase === 'sealed' || finalizationPhase === 'finalized') {
      throw new Error(
        'Rejected-position evidence acceptance is sealed for mission finalization.',
      )
    }
    if (rejections.length > 0 && context.missionId === null) {
      return
    }
    for (const rejection of rejections) {
      if (
        context.missionId === null ||
        rejection.anomalyKey === undefined ||
        rejection.canonicalEvidence === undefined
      ) {
        continue
      }
      const pendingKey = createPendingKey(context.missionId, rejection.anomalyKey)
      if (
        pendingByMissionAndAnomaly.has(pendingKey) ||
        acknowledgedMissionAnomalies.has(pendingKey)
      ) {
        continue
      }
      if (
        pendingByMissionAndAnomaly.size >=
        REJECTION_EVIDENCE_PENDING_MEMORY_CAP_HYPOTHESIS
      ) {
        markEvidenceLoss(context.missionId, 'renderer_pending_capacity_exhausted')
        continue
      }
      nextDeliverySequence += 1
      pendingByMissionAndAnomaly.set(pendingKey, {
        missionId: context.missionId,
        deliveryId: createDeliveryId(
          context.missionId,
          rejection.anomalyKey,
          nextDeliverySequence,
        ),
        anomalyKey: rejection.anomalyKey,
        deviceId: rejection.deviceId,
        sourcePositionId: rejection.sourcePositionId ?? null,
        reasonClass: rejection.reason,
        receivedAt: context.observedAt,
        canonicalEvidence: rejection.canonicalEvidence,
      })
    }
    if (context.missionId !== null && hasPendingMission(context.missionId)) {
      publishRendererPendingHealth()
    }
    scheduleFlush()
  }

  /** Stages one response and waits until its mission evidence is durable. */
  async function recordEvidenceAndFlush(
    rejections: readonly CurrentPositionRejection[],
    context: RejectionEvidenceObservationContext,
  ): Promise<void> {
    recordEvidence(rejections, context)
    if (context.missionId !== null) {
      await flushMission(context.missionId)
    }
  }

  /** Prevents a superseded runtime from publishing later health. */
  function dispose(): Promise<void> {
    disposalPromise ??= runDisposal()
    return disposalPromise
  }

  /** Drains all volatile evidence or replaces it with one durable loss marker per mission. */
  async function runDisposal(): Promise<void> {
    accepting = false
    disposing = true
    if (retryTimer !== null) {
      clearTimeoutFn(retryTimer)
      retryTimer = null
    }
    if (flushInFlight !== null) {
      await flushInFlight
    }
    while (pendingByMissionAndAnomaly.size > 0) {
      const madeProgress = await runTrackedFlush()
      if (!madeProgress) {
        await persistPendingEvidenceLoss()
        pendingByMissionAndAnomaly.clear()
        publishAggregateHealth()
      }
    }
    await ensureAllEvidenceLossMarkersDurable()
    if (retryTimer !== null) {
      clearTimeoutFn(retryTimer)
      retryTimer = null
    }
    disposed = true
    disposing = false
  }

  /** Flushes all renderer-held evidence for one mission before completeness is claimed. */
  async function flushMission(missionId: string): Promise<void> {
    await drainMissionEvidence(missionId)
  }

  /** Drains one mission and optionally seals the current finalization epoch. */
  async function drainMissionEvidence(
    missionId: string,
    sealAfterDrainEpoch?: number,
  ): Promise<void> {
    if (flushInFlight !== null) {
      await flushInFlight
    }
    while (hasPendingMission(missionId)) {
      const madeProgress = await runTrackedFlush(missionId)
      if (!madeProgress) {
        throw new Error(
          'Pending rejected-position evidence could not be persisted; finalization remains blocked.',
        )
      }
    }
    await ensureMissionEvidenceLossDurable(missionId)
    if (
      sealAfterDrainEpoch !== undefined &&
      finalizationEpochByMission.get(missionId) === sealAfterDrainEpoch
    ) {
      finalizationPhaseByMission.set(missionId, 'sealed')
    }
  }

  /**
   * Drains accepted evidence, then seals mission observation acceptance across
   * the main-process finalization call so no renderer delivery can land later.
   */
  async function runWithMissionFinalizationFence<Result>(
    missionId: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const existingPhase = finalizationPhaseByMission.get(missionId)
    if (existingPhase === 'sealed') {
      const finalizationEpoch = finalizationEpochByMission.get(missionId)
      // If the durable call rejects, this successfully finished mission remains
      // sealed. Retry may finalize it; evidence acceptance must not reopen.
      const result = await operation()
      if (finalizationEpochByMission.get(missionId) === finalizationEpoch) {
        finalizationPhaseByMission.set(missionId, 'finalized')
        retireFinalizedMissionHealth(missionId)
      }
      return result
    }
    if (
      existingPhase !== undefined &&
      existingPhase !== 'finished'
    ) {
      throw new Error('Mission evidence finalization is already in progress or complete.')
    }
    const finalizationEpoch = advanceMissionFinalizationEpoch(missionId)
    finalizationPhaseByMission.set(missionId, 'draining')
    closeMissionObservationScope(missionId)
    try {
      await missionObservationSettler?.(missionId)
      await waitForMissionObservations(missionId)
      await drainMissionEvidence(missionId, finalizationEpoch)
      if (finalizationEpochByMission.get(missionId) !== finalizationEpoch) {
        throw new Error(
          'Mission evidence finalization was superseded by administrative unlock.',
        )
      }
      const result = await operation()
      if (finalizationEpochByMission.get(missionId) === finalizationEpoch) {
        finalizationPhaseByMission.set(missionId, 'finalized')
        retireFinalizedMissionHealth(missionId)
      }
      return result
    } catch (error) {
      if (finalizationEpochByMission.get(missionId) === finalizationEpoch) {
        if (finalizationPhaseByMission.get(missionId) !== 'sealed') {
          finalizationPhaseByMission.set(missionId, 'finished')
        }
      }
      scheduleFlush()
      throw error
    }
  }

  /** Drains and seals evidence before the durable mission Finish transition. */
  async function runWithMissionFinishFence<Result>(
    missionId: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    if (finalizationPhaseByMission.has(missionId)) {
      throw new Error('Mission evidence closure is already in progress or complete.')
    }
    const finalizationEpoch = advanceMissionFinalizationEpoch(missionId)
    finalizationPhaseByMission.set(missionId, 'finishing')
    closeMissionObservationScope(missionId)
    try {
      await missionObservationSettler?.(missionId)
      await waitForMissionObservations(missionId)
      await drainMissionEvidence(missionId)
      if (finalizationEpochByMission.get(missionId) !== finalizationEpoch) {
        throw new Error('Mission evidence Finish was superseded by administrative unlock.')
      }
      const result = await operation()
      if (finalizationEpochByMission.get(missionId) === finalizationEpoch) {
        finalizationPhaseByMission.set(missionId, 'finished')
      }
      return result
    } catch (error) {
      if (finalizationEpochByMission.get(missionId) === finalizationEpoch) {
        finalizationPhaseByMission.delete(missionId)
        observationScopeClosedMissionIds.delete(missionId)
      }
      scheduleFlush()
      throw error
    }
  }

  /** Reopens renderer acceptance only after the durable store confirms admin unlock. */
  function reopenMissionEvidenceAfterUnlock(missionId: string): void {
    advanceMissionFinalizationEpoch(missionId)
    finalizationPhaseByMission.delete(missionId)
    observationScopeClosedMissionIds.delete(missionId)
    const finalizedHealth = finalizedHealthByMission.get(missionId)
    if (finalizedHealth !== undefined) {
      durableHealthByMission.set(missionId, finalizedHealth)
      finalizedHealthByMission.delete(missionId)
    }
    if (finalizedEvidenceLossMissionIds.delete(missionId)) {
      evidenceLossMissionIds.add(missionId)
    }
    publishAggregateHealth()
  }

  /** Registers the one tracking-runtime owner that can settle deferred observations. */
  function registerMissionObservationSettler(
    settler: (missionId: string) => Promise<void>,
  ): () => void {
    if (missionObservationSettler !== null) {
      throw new Error('A mission evidence observation settler is already registered.')
    }
    missionObservationSettler = settler
    return () => {
      if (missionObservationSettler === settler) missionObservationSettler = null
    }
  }

  /** Removes a completed mission from live health without losing unlock state. */
  function retireFinalizedMissionHealth(missionId: string): void {
    const durableHealth = durableHealthByMission.get(missionId)
    if (durableHealth !== undefined) {
      finalizedHealthByMission.set(missionId, durableHealth)
      durableHealthByMission.delete(missionId)
    }
    if (evidenceLossMissionIds.delete(missionId)) {
      finalizedEvidenceLossMissionIds.add(missionId)
    }
    publishAggregateHealth()
  }

  /** Invalidates stale async finalization continuations for one mission. */
  function advanceMissionFinalizationEpoch(missionId: string): number {
    const nextEpoch = (finalizationEpochByMission.get(missionId) ?? 0) + 1
    finalizationEpochByMission.set(missionId, nextEpoch)
    return nextEpoch
  }

  /** Starts at most one delivery batch without making the poller await it. */
  function scheduleFlush(): void {
    if (
      disposed ||
      disposing ||
      flushScheduled ||
      flushInFlight !== null ||
      pendingByMissionAndAnomaly.size === 0
    ) {
      return
    }
    flushScheduled = true
    queueMicrotask(() => {
      flushScheduled = false
      if (disposed || flushInFlight !== null || pendingByMissionAndAnomaly.size === 0) return
      const operation = flushPending()
      flushInFlight = operation
      void operation.then((madeProgress) => {
        if (flushInFlight !== operation) return
        flushInFlight = null
        if (madeProgress && pendingByMissionAndAnomaly.size > 0) scheduleFlush()
      })
    })
  }

  /** Delivers the current bounded pending set and removes only acknowledged IDs. */
  async function flushPending(missionId?: string): Promise<boolean> {
    if (disposed) {
      return false
    }
    const first = [...pendingByMissionAndAnomaly.values()].find(
      (entry) => missionId === undefined || entry.missionId === missionId,
    ) as
      | PendingRejectionEnvelope
      | undefined
    if (first === undefined) return false
    const pending = [...pendingByMissionAndAnomaly.values()]
      .filter((entry) => entry.missionId === first.missionId)
      .slice(0, REJECTION_EVIDENCE_DELIVERY_BATCH_HYPOTHESIS)
    try {
      const result = await dependencies.missionStore.recordIngestRejections({
        mission_id: first.missionId,
        rejections: pending.map(toTransportEnvelope),
      })
      const acknowledged = new Set(result.acknowledgedDeliveryIds)
      let removedCount = 0
      for (const [pendingKey, envelope] of pendingByMissionAndAnomaly) {
        if (acknowledged.has(envelope.deliveryId)) {
          pendingByMissionAndAnomaly.delete(pendingKey)
          acknowledgedMissionAnomalies.add(pendingKey)
          removedCount += 1
        }
      }
      if (!disposed) {
        publishEvidenceHealth(first.missionId, result.health)
        if (removedCount === 0 && pendingByMissionAndAnomaly.size > 0) {
          scheduleRetry()
        }
      }
      return removedCount > 0
    } catch {
      if (!disposed) {
        publishEvidenceHealth(first.missionId, {
          state: 'critical',
          reason: 'evidence_delivery_unavailable',
          pendingCount: pendingByMissionAndAnomaly.size,
          corruptCount: 0,
          conflictCount: 0,
          rejectedCount: 0,
          affectedDeviceCount: 0,
          conflictDeviceIds: [],
        })
        scheduleRetry()
      }
      return false
    }
  }

  /** Runs one explicitly requested flush through the same single-flight fence. */
  async function runTrackedFlush(missionId?: string): Promise<boolean> {
    if (flushInFlight !== null) return flushInFlight
    const operation = flushPending(missionId)
    flushInFlight = operation
    try {
      return await operation
    } finally {
      if (flushInFlight === operation) flushInFlight = null
    }
  }

  /** Retries unacknowledged evidence without requiring another provider poll. */
  function scheduleRetry(): void {
    if (
      disposed ||
      disposing ||
      retryTimer !== null ||
      pendingByMissionAndAnomaly.size === 0
    ) return
    retryTimer = setTimeoutFn(() => {
      retryTimer = null
      scheduleFlush()
    }, retryDelayMs)
  }

  /** Persists one sticky completeness block without retaining further unique payloads. */
  function markEvidenceLoss(missionId: string, reason: IngestEvidenceLossReason): void {
    rememberEvidenceLoss(missionId, reason)
    void ensureMissionEvidenceLossDurable(missionId).catch(() => {
      if (!disposed) applyMissionHealth(missionId, createEvidenceLossHealth(reason))
    })
  }

  /** Makes one accepted mission-persistence failure durable before its observation settles. */
  async function recordMissionEvidenceLoss(
    missionId: string,
    reason: IngestEvidenceLossReason,
  ): Promise<void> {
    rememberEvidenceLoss(missionId, reason)
    await ensureMissionEvidenceLossDurable(missionId)
  }

  /** Persists a sticky blocker before renderer-only payloads are released at teardown. */
  async function persistPendingEvidenceLoss(): Promise<void> {
    const recordEvidenceLoss = dependencies.missionStore.recordIngestEvidenceLoss
    if (recordEvidenceLoss === undefined) {
      throw new Error(
        'Pending rejected-position evidence could not be persisted or durably marked as lost; runtime disposal remains blocked.',
      )
    }
    const missionIds = [...new Set(
      [...pendingByMissionAndAnomaly.values()].map((entry) => entry.missionId),
    )].sort()
    for (const missionId of missionIds) {
      rememberEvidenceLoss(missionId, 'renderer_pending_evidence_lost')
      await ensureMissionEvidenceLossDurable(missionId)
    }
  }

  /** Retains an unresolved loss locally until its durable marker succeeds. */
  function rememberEvidenceLoss(missionId: string, reason: IngestEvidenceLossReason): void {
    if (!evidenceLossReasonByMission.has(missionId)) {
      evidenceLossReasonByMission.set(missionId, reason)
    }
    evidenceLossMissionIds.add(missionId)
    publishEvidenceHealth(missionId, createEvidenceLossHealth(
      evidenceLossReasonByMission.get(missionId) ?? reason,
    ))
  }

  /** Retries one marker and resolves only after the main process confirms durability. */
  async function ensureMissionEvidenceLossDurable(missionId: string): Promise<void> {
    if (durableEvidenceLossMissionIds.has(missionId)) return
    const reason = evidenceLossReasonByMission.get(missionId)
    if (reason === undefined) return
    const existingWrite = evidenceLossWriteByMission.get(missionId)
    if (existingWrite !== undefined) return existingWrite
    const recordEvidenceLoss = dependencies.missionStore.recordIngestEvidenceLoss
    if (recordEvidenceLoss === undefined) {
      throw new Error(
        'Rejected-position evidence loss could not be durably marked; mission closure remains blocked.',
      )
    }
    const write = recordEvidenceLoss({ mission_id: missionId, reason })
      .then((health) => {
        durableEvidenceLossMissionIds.add(missionId)
        if (!disposed) applyMissionHealth(missionId, health)
      })
      .finally(() => {
        if (evidenceLossWriteByMission.get(missionId) === write) {
          evidenceLossWriteByMission.delete(missionId)
        }
      })
    evidenceLossWriteByMission.set(missionId, write)
    return write
  }

  /** Makes renderer teardown fail closed until every discarded payload has a marker. */
  async function ensureAllEvidenceLossMarkersDurable(): Promise<void> {
    for (const missionId of [...evidenceLossReasonByMission.keys()].sort()) {
      await ensureMissionEvidenceLossDurable(missionId)
    }
  }

  /** Prevents later polls from extending mission evidence beyond a durable close boundary. */
  function closeMissionObservationScope(missionId: string): void {
    observationScopeClosedMissionIds.add(missionId)
  }

  /** Waits for every current-position observation already scoped to this mission. */
  async function waitForMissionObservations(missionId: string): Promise<void> {
    while ((activeObservationCountByMission.get(missionId) ?? 0) > 0) {
      await new Promise<void>((resolve) => {
        const waiters = observationWaitersByMission.get(missionId) ?? new Set<() => void>()
        waiters.add(resolve)
        observationWaitersByMission.set(missionId, waiters)
      })
    }
  }

  /** Stores one mission's durable health and publishes the cross-mission aggregate. */
  function publishEvidenceHealth(missionId: string, health: IngestEvidenceHealth): void {
    durableHealthByMission.set(missionId, health)
    publishAggregateHealth()
  }

  /** Keeps renderer-held evidence and durable mission failures independently visible. */
  function publishAggregateHealth(existing?: IngestEvidenceHealth): void {
    const rendererPendingCount = pendingByMissionAndAnomaly.size
    const durable = [...durableHealthByMission.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, health]) => health)
    if (existing !== undefined && durable.length === 0) durable.push(existing)
    const rendererPendingDeviceCount = new Set(
      [...pendingByMissionAndAnomaly.values()].map((entry) => entry.deviceId),
    ).size
    const critical = durable.find((health) => health.state === 'critical')
    const degraded = durable.find((health) => health.state === 'degraded')
    const conflictDeviceIds = [...new Set(durable.flatMap((health) =>
      health.conflictDeviceIds))].sort()
    const summed = durable.reduce((total, health) => ({
      pendingCount: total.pendingCount + health.pendingCount,
      corruptCount: total.corruptCount + health.corruptCount,
      conflictCount: total.conflictCount + health.conflictCount,
      rejectedCount: total.rejectedCount + health.rejectedCount,
      affectedDeviceCount: total.affectedDeviceCount + health.affectedDeviceCount,
    }), {
      pendingCount: 0,
      corruptCount: 0,
      conflictCount: 0,
      rejectedCount: 0,
      affectedDeviceCount: 0,
    })
    let state: IngestEvidenceHealth['state'] = critical !== undefined
      ? 'critical'
      : degraded !== undefined || rendererPendingCount > 0
        ? 'degraded'
        : 'healthy'
    let reason = critical?.reason ?? degraded?.reason ??
      (rendererPendingCount > 0 ? 'renderer_evidence_pending' : null)
    if (evidenceLossMissionIds.size > 0) {
      state = 'critical'
      const missionId = [...evidenceLossMissionIds].sort()[0]
      reason = missionId === undefined
        ? 'renderer_pending_capacity_exhausted'
        : evidenceLossReasonByMission.get(missionId) ?? 'renderer_pending_capacity_exhausted'
    }
    dependencies.applyEvidenceHealth({
      state,
      reason,
      pendingCount: Math.max(summed.pendingCount, rendererPendingCount),
      corruptCount: summed.corruptCount,
      conflictCount: summed.conflictCount,
      rejectedCount: Math.max(summed.rejectedCount, rendererPendingCount),
      affectedDeviceCount: Math.max(summed.affectedDeviceCount, rendererPendingDeviceCount),
      conflictDeviceIds,
    })
  }

  /** Revokes completeness in the same turn that evidence enters renderer memory. */
  function publishRendererPendingHealth(): void {
    const existing = dependencies.readEvidenceHealth?.()
    publishAggregateHealth(existing?.state === 'healthy' ? undefined : existing)
  }

  /** Keeps delayed hydration for a finalized mission outside the live aggregate. */
  function applyMissionHealth(missionId: string, health: IngestEvidenceHealth): void {
    if (finalizationPhaseByMission.get(missionId) === 'finalized') {
      finalizedHealthByMission.set(missionId, health)
      publishAggregateHealth()
      return
    }
    publishEvidenceHealth(missionId, health)
  }

  /** Returns whether the renderer still owns evidence for one mission. */
  function hasPendingMission(missionId: string): boolean {
    return [...pendingByMissionAndAnomaly.values()].some(
      (entry) => entry.missionId === missionId,
    )
  }

  return {
    applyMissionHealth,
    beginMissionObservation,
    dispose,
    flushMission,
    record,
    recordEvidence,
    recordEvidenceAndFlush,
    recordMissionEvidenceLoss,
    registerMissionObservationSettler,
    reopenMissionEvidenceAfterUnlock,
    runWithMissionFinishFence,
    runWithMissionFinalizationFence,
  }
}

/** Creates the renderer-side critical state for one unrepresented observation. */
function createEvidenceLossHealth(reason: IngestEvidenceLossReason): IngestEvidenceHealth {
  return {
    state: 'critical',
    reason,
    pendingCount: REJECTION_EVIDENCE_PENDING_MEMORY_CAP_HYPOTHESIS,
    corruptCount: 0,
    conflictCount: 0,
    rejectedCount: 0,
    affectedDeviceCount: 0,
    conflictDeviceIds: [],
  }
}

/** Creates a collision-free in-memory identity without placing evidence in logs. */
function createPendingKey(missionId: string, anomalyKey: string): string {
  return `${missionId.length}:${missionId}${anomalyKey}`
}

/** Removes renderer-only mission grouping from one IPC transport envelope. */
function toTransportEnvelope(
  pending: PendingRejectionEnvelope,
): IngestRejectionEnvelope {
  return {
    deliveryId: pending.deliveryId,
    anomalyKey: pending.anomalyKey,
    deviceId: pending.deviceId,
    sourcePositionId: pending.sourcePositionId,
    reasonClass: pending.reasonClass,
    receivedAt: pending.receivedAt,
    canonicalEvidence: pending.canonicalEvidence,
  }
}
