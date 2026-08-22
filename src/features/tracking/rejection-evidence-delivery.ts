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
  readonly dispose: () => void
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
  const evidenceLossMissionIds = new Set<string>()

  /** Publishes current warnings immediately and schedules non-blocking delivery. */
  function record(
    rejections: readonly CurrentPositionRejection[],
    context: RejectionEvidenceObservationContext,
  ): void {
    dependencies.applyRejections(rejections)
    if (rejections.length > 0 && context.missionId === null) {
      dependencies.applyEvidenceHealth(createMissionIdentityFailureHealth())
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
    scheduleFlush()
  }

  /** Prevents a superseded runtime from publishing later health. */
  function dispose(): void {
    disposed = true
    if (retryTimer !== null) {
      clearTimeoutFn(retryTimer)
      retryTimer = null
    }
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
  async function flushPending(): Promise<boolean> {
    if (disposed) {
      return false
    }
    const first = pendingByMissionAndAnomaly.values().next().value as
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
        publishEvidenceHealth(first.missionId, result.health)
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
    publishEvidenceHealth(missionId, createCapacityFailureHealth())
    void dependencies.missionStore.recordIngestEvidenceLoss?.({
      mission_id: missionId,
      reason: 'renderer_pending_capacity_exhausted',
    }).then((health) => {
      if (!disposed) publishEvidenceHealth(missionId, health)
    }).catch(() => {
      if (!disposed) publishEvidenceHealth(missionId, createCapacityFailureHealth())
    })
  }

  /** Keeps a local capacity failure sticky while merging real durable counters. */
  function publishEvidenceHealth(missionId: string, health: IngestEvidenceHealth): void {
    dependencies.applyEvidenceHealth(
      evidenceLossMissionIds.has(missionId)
        ? {
            ...health,
            state: 'critical',
            reason: 'renderer_pending_capacity_exhausted',
            pendingCount: pendingByMissionAndAnomaly.size,
          }
        : health,
    )
  }

  return { dispose, record }
}

/** Describes the impossible attribution boundary when no mission generation exists. */
function createMissionIdentityFailureHealth(): IngestEvidenceHealth {
  return {
    state: 'critical',
    reason: 'rejection_mission_identity_unavailable',
    pendingCount: 0,
    corruptCount: 0,
    conflictCount: 0,
    rejectedCount: 0,
    affectedDeviceCount: 0,
    conflictDeviceIds: [],
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
