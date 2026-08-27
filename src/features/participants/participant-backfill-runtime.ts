import type {
  ParticipantBackfillCheckpoint,
  PersistTrackingHistoryBatchInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type {
  BreadcrumbNormalizationResult,
} from '../tracking/traccar-client'
import type { CurrentPositionRejection } from '../tracking/ingest-health'

const BACKFILL_CHUNK_MILLISECONDS = 2 * 60 * 60 * 1_000

type ParticipantBackfillPassDependencies = {
  readonly checkpoint: ParticipantBackfillCheckpoint
  readonly getBreadcrumbsWithReport: (
    deviceId: string,
    from: Date,
    to: Date,
    signal?: AbortSignal,
  ) => Promise<BreadcrumbNormalizationResult>
  readonly recordRejections?: (
    rejections: readonly CurrentPositionRejection[],
    context: { readonly missionId: string; readonly observedAt: string },
  ) => Promise<void>
  readonly persistChunk: (input: PersistTrackingHistoryBatchInput) => Promise<unknown>
  readonly updateCheckpoint: (input: {
    readonly mission_id: string
    readonly traccar_device_id: string
    readonly window_from: string
    readonly window_to: string
    readonly reconciled_until: string
    readonly completed: boolean
  }) => Promise<unknown>
  readonly signal?: AbortSignal
}

/** Runs at most one fixed, resumable two-hour participant-history chunk. */
export async function runParticipantBackfillPass(
  dependencies: ParticipantBackfillPassDependencies,
): Promise<void> {
  const { checkpoint } = dependencies
  if (checkpoint.completed === 1) return
  throwIfAborted(dependencies.signal)

  const from = new Date(checkpoint.reconciled_until)
  const windowTo = new Date(checkpoint.window_to)
  const to = new Date(Math.min(
    from.getTime() + BACKFILL_CHUNK_MILLISECONDS,
    windowTo.getTime(),
  ))
  if (to.getTime() <= from.getTime()) {
    await dependencies.updateCheckpoint(checkpointUpdate(checkpoint, windowTo, true))
    return
  }

  const report = await dependencies.getBreadcrumbsWithReport(
    checkpoint.traccar_device_id,
    from,
    to,
    dependencies.signal,
  )
  throwIfAborted(dependencies.signal)
  if (report.rejected.length > 0) {
    if (dependencies.recordRejections === undefined) {
      throw new Error(
        'Participant history rejected source rows without a durable evidence recorder.',
      )
    }
    await dependencies.recordRejections(report.rejected, {
      missionId: checkpoint.mission_id,
      observedAt: new Date().toISOString(),
    })
    throwIfAborted(dependencies.signal)
  }
  if (report.accepted.some((position) => position.timestamp_source !== 'fix')) {
    throw new Error(
      'Participant history client returned accepted evidence without authoritative fixTime provenance.',
    )
  }
  const boundedPositions = report.accepted.filter((position) => {
    const timestamp = Date.parse(position.timestamp)
    return timestamp >= from.getTime() && timestamp <= to.getTime()
  })
  await dependencies.persistChunk({
    mission_id: checkpoint.mission_id,
    positions: boundedPositions.map((position) => ({
      source_position_id: position.id,
      device_id: position.device_id,
      lat: position.lat,
      lon: position.lon,
      altitude: position.altitude,
      speed: position.speed,
      battery: position.battery,
      accuracy: position.accuracy,
      source: position.source,
      timestamp: position.timestamp,
      timestamp_source: 'fix',
      data_origin: position.data_origin,
    })),
    checkpoints: [],
  })
  throwIfAborted(dependencies.signal)
  await dependencies.updateCheckpoint(
    checkpointUpdate(checkpoint, to, to.getTime() === windowTo.getTime()),
  )
}

function checkpointUpdate(
  checkpoint: ParticipantBackfillCheckpoint,
  reconciledUntil: Date,
  completed: boolean,
) {
  return {
    mission_id: checkpoint.mission_id,
    traccar_device_id: checkpoint.traccar_device_id,
    window_from: checkpoint.window_from,
    window_to: checkpoint.window_to,
    reconciled_until: reconciledUntil.toISOString(),
    completed,
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new DOMException('Participant backfill aborted.', 'AbortError')
}
