import type { CurrentPositionRejection } from './ingest-health'
import type {
  IngestEvidenceHealth,
  IngestRejectionEnvelope,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { createRejectedPositionDeliveryId } from './rejected-position-evidence'

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
    readonly reason: 'renderer_pending_capacity_exhausted'
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

export type RejectionEvidenceDelivery = {
  readonly record: (
    rejections: readonly CurrentPositionRejection[],
    context: RejectionEvidenceObservationContext,
  ) => void
  readonly flushMission: (missionId: string) => Promise<void>
  readonly runWithMissionFinalizationFence: <Result>(
    missionId: string,
    operation: () => Promise<Result>,
  ) => Promise<Result>
  readonly reopenMissionEvidenceAfterUnlock: (missionId: string) => void
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
  const createDeliveryId = dependencies.createDeliveryId ?? createRejectedPositionDeliveryId
  const setTimeoutFn = dependencies.setTimeout ?? globalThis.setTimeout
  const clearTimeoutFn = dependencies.clearTimeout ?? globalThis.clearTimeout
  const retryDelayMs = dependencies.retryDelayMs ?? 1_000
  let nextDeliverySequence = 0
  let flushInFlight: Promise<boolean> | null = null
  let flushScheduled = false
  let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  let disposed = false
  let accepting = true
  const evidenceLossMissionIds = new Set<string>()
  const finalizationPhaseByMission = new Map<string, 'draining' | 'sealed' | 'finalized'>()
  const finalizationEpochByMission = new Map<string, number>()

  /** Publishes current warnings immediately and schedules non-blocking delivery. */
  function record(
    rejections: readonly CurrentPositionRejection[],
    context: RejectionEvidenceObservationContext,
  ): void {
    if (!accepting) return
    dependencies.applyRejections(rejections)
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
      if (pendingByMissionAndAnomaly.has(pendingKey)) {
        continue
      }
      if (
        pendingByMissionAndAnomaly.size >=
        REJECTION_EVIDENCE_PENDING_MEMORY_CAP_HYPOTHESIS
      ) {
        markEvidenceLoss(context.missionId)
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

  /** Prevents a superseded runtime from publishing later health. */
  async function dispose(): Promise<void> {
    accepting = false
    if (retryTimer !== null) {
      clearTimeoutFn(retryTimer)
      retryTimer = null
    }
    if (flushInFlight !== null) {
      await flushInFlight
    }
    if (pendingByMissionAndAnomaly.size > 0) {
      await runTrackedFlush()
    }
    if (pendingByMissionAndAnomaly.size === 0) {
      disposed = true
    } else {
      scheduleRetry()
    }
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
    if (finalizationPhaseByMission.has(missionId)) {
      throw new Error('Mission evidence finalization is already in progress or complete.')
    }
    const finalizationEpoch = advanceMissionFinalizationEpoch(missionId)
    finalizationPhaseByMission.set(missionId, 'draining')
    try {
      await drainMissionEvidence(missionId, finalizationEpoch)
      if (finalizationEpochByMission.get(missionId) !== finalizationEpoch) {
        throw new Error(
          'Mission evidence finalization was superseded by administrative unlock.',
        )
      }
      const result = await operation()
      if (finalizationEpochByMission.get(missionId) === finalizationEpoch) {
        finalizationPhaseByMission.set(missionId, 'finalized')
      }
      return result
    } catch (error) {
      if (finalizationEpochByMission.get(missionId) === finalizationEpoch) {
        finalizationPhaseByMission.delete(missionId)
      }
      scheduleFlush()
      throw error
    }
  }

  /** Reopens renderer acceptance only after the durable store confirms admin unlock. */
  function reopenMissionEvidenceAfterUnlock(missionId: string): void {
    advanceMissionFinalizationEpoch(missionId)
    finalizationPhaseByMission.delete(missionId)
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
          removedCount += 1
        }
      }
      if (!disposed) {
        publishEvidenceHealth(result.health)
        if (removedCount === 0 && pendingByMissionAndAnomaly.size > 0) {
          scheduleRetry()
        }
      }
      return removedCount > 0
    } catch {
      if (!disposed) {
        dependencies.applyEvidenceHealth({
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
    if (disposed || retryTimer !== null || pendingByMissionAndAnomaly.size === 0) return
    retryTimer = setTimeoutFn(() => {
      retryTimer = null
      scheduleFlush()
    }, retryDelayMs)
  }

  /** Persists one sticky completeness block without retaining further unique payloads. */
  function markEvidenceLoss(missionId: string): void {
    if (evidenceLossMissionIds.has(missionId)) return
    evidenceLossMissionIds.add(missionId)
    publishEvidenceHealth(createCapacityFailureHealth())
    void dependencies.missionStore.recordIngestEvidenceLoss?.({
      mission_id: missionId,
      reason: 'renderer_pending_capacity_exhausted',
    }).then((health) => {
      if (!disposed) publishEvidenceHealth(health)
    }).catch(() => {
      if (!disposed) publishEvidenceHealth(createCapacityFailureHealth())
    })
  }

  /** Keeps a local capacity failure sticky while merging real durable counters. */
  function publishEvidenceHealth(health: IngestEvidenceHealth): void {
    const rendererPendingCount = pendingByMissionAndAnomaly.size
    if (evidenceLossMissionIds.size > 0) {
      dependencies.applyEvidenceHealth({
        ...health,
        state: 'critical',
        reason: 'renderer_pending_capacity_exhausted',
        pendingCount: Math.max(health.pendingCount, rendererPendingCount),
      })
      return
    }
    if (rendererPendingCount > 0) {
      dependencies.applyEvidenceHealth({
        ...health,
        state: health.state === 'critical' ? 'critical' : 'degraded',
        reason: health.state === 'critical' ? health.reason : 'renderer_evidence_pending',
        pendingCount: Math.max(health.pendingCount, rendererPendingCount),
      })
      return
    }
    dependencies.applyEvidenceHealth(health)
  }

  /** Revokes completeness in the same turn that evidence enters renderer memory. */
  function publishRendererPendingHealth(): void {
    const pending = [...pendingByMissionAndAnomaly.values()]
    const existing = dependencies.readEvidenceHealth?.()
    dependencies.applyEvidenceHealth({
      state: existing?.state === undefined || existing.state === 'healthy'
        ? 'degraded'
        : existing.state,
      reason: existing?.state === undefined || existing.state === 'healthy'
        ? 'renderer_evidence_pending'
        : existing.reason,
      pendingCount: Math.max(existing?.pendingCount ?? 0, pending.length),
      corruptCount: existing?.corruptCount ?? 0,
      conflictCount: existing?.conflictCount ?? 0,
      rejectedCount: Math.max(existing?.rejectedCount ?? 0, pending.length),
      affectedDeviceCount: Math.max(
        existing?.affectedDeviceCount ?? 0,
        new Set(pending.map((entry) => entry.deviceId)).size,
      ),
      conflictDeviceIds: existing?.conflictDeviceIds ?? [],
    })
  }

  /** Returns whether the renderer still owns evidence for one mission. */
  function hasPendingMission(missionId: string): boolean {
    return [...pendingByMissionAndAnomaly.values()].some(
      (entry) => entry.missionId === missionId,
    )
  }

  return {
    dispose,
    flushMission,
    record,
    reopenMissionEvidenceAfterUnlock,
    runWithMissionFinalizationFence,
  }
}

/** Describes the explicit bounded-memory impossibility boundary. */
function createCapacityFailureHealth(): IngestEvidenceHealth {
  return {
    state: 'critical',
    reason: 'renderer_pending_capacity_exhausted',
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
