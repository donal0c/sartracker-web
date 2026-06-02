import type { TrackingConnectionStatus, TrackingSnapshot } from './tracking-types'

export type DeviceWorkspaceRow = {
  readonly deviceId: string
  readonly name: string
  readonly status: 'online' | 'offline' | 'unknown'
  readonly active: boolean
  readonly hidden: boolean
  readonly hasFix: boolean
  readonly latitude: number | null
  readonly longitude: number | null
  readonly dataOrigin: 'live' | 'cache' | null
  readonly lastSeen: string | null
  readonly lastSeenDisplay: string
  readonly sourceDisplay: string
  readonly stale: boolean
  readonly batteryDisplay: string
  readonly speedDisplay: string
}

export type DeviceWorkspaceSummary = {
  readonly totalDevices: number
  readonly activeDevices: number
  readonly onlineDevices: number
  readonly hiddenDevices: number
  readonly staleDevices: number
  readonly cachedDevices: number
  readonly lastSuccessAtDisplay: string
  readonly warning: string | null
  readonly mode: TrackingConnectionStatus['mode']
}

export function buildDeviceWorkspaceRows(
  snapshot: TrackingSnapshot,
  hiddenDeviceIds: readonly string[],
  activeDeviceIds: readonly string[] = [],
): readonly DeviceWorkspaceRow[] {
  const latestPositionByDevice = new Map(
    snapshot.positions.map((position) => [position.device_id, position] as const),
  )
  const activeDeviceIdSet = new Set(activeDeviceIds)

  return [...snapshot.devices]
    .map((device) => {
      const position = latestPositionByDevice.get(device.device_id) ?? null
      return {
        deviceId: device.device_id,
        name: device.name,
        status: device.status,
        active: activeDeviceIdSet.has(device.device_id),
        hidden: hiddenDeviceIds.includes(device.device_id),
        hasFix: position !== null,
        latitude: position?.lat ?? null,
        longitude: position?.lon ?? null,
        dataOrigin: position?.data_origin ?? null,
        lastSeen: device.last_seen,
        lastSeenDisplay: formatTimestamp(device.last_seen),
        sourceDisplay:
          position === null
            ? 'No fix'
            : position.device_cache_stale
              ? 'Stale'
              : position.data_origin === 'cache'
                ? 'Cache'
                : 'Live',
        stale: position?.device_cache_stale ?? false,
        batteryDisplay:
          typeof position?.battery === 'number' ? `${Math.round(position.battery)}%` : '—',
        speedDisplay:
          typeof position?.speed === 'number' ? `${position.speed.toFixed(1)} km/h` : '—',
      } satisfies DeviceWorkspaceRow
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function buildDeviceWorkspaceSummary(
  rows: readonly DeviceWorkspaceRow[],
  status: TrackingConnectionStatus,
): DeviceWorkspaceSummary {
  return {
    totalDevices: rows.length,
    activeDevices: rows.filter((row) => row.active).length,
    onlineDevices: rows.filter((row) => row.status === 'online').length,
    hiddenDevices: rows.filter((row) => row.hidden).length,
    staleDevices: rows.filter((row) => row.stale).length,
    cachedDevices: rows.filter((row) => row.dataOrigin === 'cache').length,
    lastSuccessAtDisplay: formatTimestamp(status.lastSuccessAt),
    warning: status.warning,
    mode: status.mode,
  }
}

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return 'N/A'
  }

  return new Date(value).toLocaleTimeString()
}
