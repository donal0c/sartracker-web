import type { CurrentPositionRejection } from './ingest-health'
import type {
  IngestEvidenceHealth,
  IngestRejectionEnvelope,
} from '../../infrastructure/mission-store/tauri-mission-store'

export const REJECTION_EVIDENCE_PENDING_MEMORY_CAP_HYPOTHESIS = 256

type RejectionEvidenceMissionStore = {
  readonly getActiveMission: () => Promise<{ readonly id: string } | null>
  readonly recordIngestRejections: (input: {
    readonly mission_id: string
    readonly rejections: readonly IngestRejectionEnvelope[]
  }) => Promise<{
    readonly acknowledgedDeliveryIds: readonly string[]
    readonly health: IngestEvidenceHealth
  }>
}

type RejectionEvidenceDeliveryDependencies = {
  readonly missionStore: RejectionEvidenceMissionStore
  readonly applyRejections: (rejections: readonly CurrentPositionRejection[]) => void
  readonly applyEvidenceHealth: (health: IngestEvidenceHealth) => void
  readonly createDeliveryId?: (sequence: number) => string
}

export type RejectionEvidenceDelivery = {
  readonly record: (rejections: readonly CurrentPositionRejection[]) => void
  readonly dispose: () => void
}

/**
 * Keeps operator rejection visibility synchronous while delivering only unique
 * canonical evidence through the durable main-process outbox.
 */
export function createRejectionEvidenceDelivery(
  dependencies: RejectionEvidenceDeliveryDependencies,
): RejectionEvidenceDelivery {
  const pendingByAnomalyKey = new Map<string, IngestRejectionEnvelope>()
  const createDeliveryId = dependencies.createDeliveryId ?? (() => crypto.randomUUID())
  let nextDeliverySequence = 0
  let flushInFlight: Promise<void> | null = null
  let disposed = false
  let unsavedEvidenceCount = 0

  /** Publishes current warnings immediately and schedules non-blocking delivery. */
  function record(rejections: readonly CurrentPositionRejection[]): void {
    dependencies.applyRejections(rejections)
    for (const rejection of rejections) {
      if (
        rejection.anomalyKey === undefined ||
        rejection.canonicalEvidence === undefined ||
        pendingByAnomalyKey.has(rejection.anomalyKey)
      ) {
        continue
      }
      if (
        pendingByAnomalyKey.size >=
        REJECTION_EVIDENCE_PENDING_MEMORY_CAP_HYPOTHESIS
      ) {
        unsavedEvidenceCount += 1
        dependencies.applyEvidenceHealth(createCapacityFailureHealth(unsavedEvidenceCount))
        continue
      }
      nextDeliverySequence += 1
      pendingByAnomalyKey.set(rejection.anomalyKey, {
        deliveryId: createDeliveryId(nextDeliverySequence),
        anomalyKey: rejection.anomalyKey,
        deviceId: rejection.deviceId,
        sourcePositionId: rejection.sourcePositionId ?? null,
        reasonClass: rejection.reason,
        canonicalEvidence: rejection.canonicalEvidence,
      })
    }
    scheduleFlush()
  }

  /** Prevents a superseded runtime from publishing later health. */
  function dispose(): void {
    disposed = true
  }

  /** Starts at most one delivery batch without making the poller await it. */
  function scheduleFlush(): void {
    if (disposed || flushInFlight !== null || pendingByAnomalyKey.size === 0) {
      return
    }
    flushInFlight = flushPending().finally(() => {
      flushInFlight = null
    })
  }

  /** Delivers the current bounded pending set and removes only acknowledged IDs. */
  async function flushPending(): Promise<void> {
    const activeMission = await dependencies.missionStore.getActiveMission()
    if (activeMission === null || disposed) {
      return
    }
    const pending = [...pendingByAnomalyKey.values()]
    try {
      const result = await dependencies.missionStore.recordIngestRejections({
        mission_id: activeMission.id,
        rejections: pending,
      })
      const acknowledged = new Set(result.acknowledgedDeliveryIds)
      for (const [anomalyKey, envelope] of pendingByAnomalyKey) {
        if (acknowledged.has(envelope.deliveryId)) {
          pendingByAnomalyKey.delete(anomalyKey)
        }
      }
      if (!disposed) {
        dependencies.applyEvidenceHealth(
          unsavedEvidenceCount > 0
            ? createCapacityFailureHealth(unsavedEvidenceCount)
            : result.health,
        )
      }
    } catch {
      if (!disposed) {
        dependencies.applyEvidenceHealth({
          state: 'critical',
          reason: 'evidence_delivery_unavailable',
          pendingCount: pendingByAnomalyKey.size,
          corruptCount: 0,
          conflictCount: 0,
          rejectedCount: 0,
          affectedDeviceCount: 0,
          conflictDeviceIds: [],
        })
      }
    }
  }

  return { dispose, record }
}

/** Describes the honest boundary after the renderer's bounded retry set fills. */
function createCapacityFailureHealth(unsavedEvidenceCount: number): IngestEvidenceHealth {
  return {
    state: 'critical',
    reason: 'renderer_pending_capacity_exhausted',
    pendingCount: REJECTION_EVIDENCE_PENDING_MEMORY_CAP_HYPOTHESIS,
    corruptCount: 0,
    conflictCount: 0,
    rejectedCount: unsavedEvidenceCount,
    affectedDeviceCount: 0,
    conflictDeviceIds: [],
  }
}
