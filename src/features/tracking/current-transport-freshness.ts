import type { TrackingSnapshot } from './tracking-types'

/** Tracks presentation freshness across replacements without modifying source fixes. */
export function createCurrentTransportFreshness(): {
  readonly reset: () => void
  readonly observeCurrent: (snapshot: TrackingSnapshot) => void
  readonly decorate: (snapshot: TrackingSnapshot) => TrackingSnapshot
} {
  let confirmedDeviceIds: Set<string> | null = null
  return {
    reset: () => { confirmedDeviceIds = new Set() },
    observeCurrent: (snapshot) => {
      for (const position of snapshot.positions) confirmedDeviceIds?.add(position.device_id)
    },
    decorate: (snapshot) => {
      const confirmed = confirmedDeviceIds
      if (confirmed === null) return snapshot
      const unconfirmedCurrentDeviceIds = snapshot.positions
        .filter((position) => position.data_origin === 'live' && !confirmed.has(position.device_id))
        .map((position) => position.device_id)
      const unconfirmed = new Set(unconfirmedCurrentDeviceIds)
      return {
        ...snapshot,
        unconfirmedCurrentDeviceIds,
        devices: snapshot.devices.map((device) => unconfirmed.has(device.device_id)
          ? { ...device, status: 'unknown' as const } : device),
      }
    },
  }
}
