import type { TrackingSnapshot } from './tracking-types'

/**
 * Applies mission-active device selection to the live tracking snapshot.
 *
 * An empty active-device list is deliberately treated as "all devices" so a new
 * mission does not unexpectedly hide the whole roster before coordinators have
 * made an explicit selection.
 */
export function selectMissionTrackingSnapshot(
  snapshot: TrackingSnapshot,
  activeDeviceIds: readonly string[],
): TrackingSnapshot {
  if (activeDeviceIds.length === 0) {
    return snapshot
  }

  const activeDeviceIdSet = new Set(activeDeviceIds)

  return {
    devices: snapshot.devices.filter((device) => activeDeviceIdSet.has(device.device_id)),
    positions: snapshot.positions.filter((position) => activeDeviceIdSet.has(position.device_id)),
    breadcrumbs: snapshot.breadcrumbs.filter((position) => activeDeviceIdSet.has(position.device_id)),
  }
}
