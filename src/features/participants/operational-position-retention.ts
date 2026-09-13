import {
  annotateTrackingSnapshotHealth,
  DEFAULT_DEVICE_STALE_THRESHOLD_MS,
} from '../tracking/tracking-snapshot-health'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from '../tracking/tracking-types'
import type { ParticipationScope } from './participation-scope'

export type OperationalPositionRetention = {
  readonly apply: (
    snapshot: TrackingSnapshot,
    scope: ParticipationScope,
    observedAt: Date,
    contextKey: string,
  ) => TrackingSnapshot
  readonly reset: () => void
}

/**
 * Retains the last accepted current marker across incomplete later polls.
 * Historical evidence stays outside this boundary and must use the unmodified
 * incoming snapshot with the participation evidence filter.
 */
export function createOperationalPositionRetention(): OperationalPositionRetention {
  const positionsByDevice = new Map<string, NormalizedTrackingPosition>()
  const devicesById = new Map<string, NormalizedTrackingDevice>()
  const cacheWrittenAtByDevice = new Map<string, number>()
  let activeContextKey: string | null = null

  /** Clears all current-position state at a mission/runtime boundary. */
  function reset(): void {
    positionsByDevice.clear()
    devicesById.clear()
    cacheWrittenAtByDevice.clear()
    activeContextKey = null
  }

  return {
    apply: (snapshot, scope, observedAt, contextKey) => {
      if (activeContextKey !== contextKey) {
        positionsByDevice.clear()
        devicesById.clear()
        cacheWrittenAtByDevice.clear()
        activeContextKey = contextKey
      }

      const filtered = scope.filterSnapshot(snapshot, observedAt.toISOString())
      for (const device of filtered.devices) {
        devicesById.set(device.device_id, device)
      }
      for (const position of filtered.positions) {
        positionsByDevice.set(position.device_id, position)
        if (position.data_origin === 'cache' && position.cache_age_seconds !== null) {
          cacheWrittenAtByDevice.set(position.device_id,
            observedAt.getTime() - position.cache_age_seconds * 1000)
        } else {
          cacheWrittenAtByDevice.delete(position.device_id)
        }
      }

      const refreshedPositions = [...positionsByDevice.values()].map((position) => annotateTrackingSnapshotHealth({
        devices: [],
        positions: [position],
        breadcrumbs: [],
      }, {
        now: observedAt,
        deviceStaleThresholdMs: DEFAULT_DEVICE_STALE_THRESHOLD_MS,
        // Per-device provenance survives omitted rows; it must not be reset to
        // unknown age merely because a later provider poll is partial.
        cacheAgeMs: cacheWrittenAtByDevice.has(position.device_id)
          ? Math.max(0, observedAt.getTime() - cacheWrittenAtByDevice.get(position.device_id)!) : null,
      }).positions[0]!)
      const incomingDeviceIds = new Set(
        filtered.positions.map((position) => position.device_id),
      )
      const operationalDeviceIds = new Set(
        typeof scope.operationalDeviceIdsAt === 'function'
          ? scope.operationalDeviceIdsAt(observedAt.toISOString())
          : filtered.devices.map((device) => device.device_id),
      )
      const retainedPositions: NormalizedTrackingPosition[] = []
      for (const position of refreshedPositions) {
        if (position.device_cache_stale) {
          positionsByDevice.delete(position.device_id)
          devicesById.delete(position.device_id)
          cacheWrittenAtByDevice.delete(position.device_id)
          continue
        }
        positionsByDevice.set(position.device_id, position)
        if (
          !incomingDeviceIds.has(position.device_id) &&
          (operationalDeviceIds.has(position.device_id) ||
            scope.includesAt(position.device_id, position.timestamp))
        ) {
          retainedPositions.push(position)
        }
      }
      if (retainedPositions.length === 0) return filtered

      const visibleDeviceIds = new Set([
        ...filtered.devices.map((device) => device.device_id),
        ...retainedPositions.map((position) => position.device_id),
      ])
      return {
        ...filtered,
        devices: [...new Map([
          ...filtered.devices.map((device) => [device.device_id, device] as const),
          ...[...devicesById.values()]
            .filter((device) => visibleDeviceIds.has(device.device_id))
            .map((device) => [device.device_id, device] as const),
        ]).values()],
        positions: [...filtered.positions, ...retainedPositions],
      }
    },
    reset,
  }
}
