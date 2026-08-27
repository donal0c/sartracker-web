import type { TrackingConnectionStatus, TrackingSnapshot } from './tracking-types'
import {
  EMPTY_CURRENT_POSITION_INGEST_HEALTH,
  formatCurrentPositionRejectionReason,
  type CurrentPositionIngestHealthSummary,
} from './ingest-health'
import type { DeviceStationaryAttention } from './stationary-attention-store'
import { formatOperatorLocalTimestamp } from './operator-time'

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
  readonly fixTimeDisplay: string
  readonly sourceDisplay: string
  readonly fixTimeUnverified: boolean
  readonly ingestWarning: string | null
  readonly stale: boolean
  readonly accuracyDisplay: string
  readonly batteryDisplay: string
  readonly speedDisplay: string
  readonly stationaryAttention: boolean
  readonly stationaryAttentionUnavailable: boolean
  readonly stationaryAttentionUnreliable: boolean
  readonly attentionAcknowledged: boolean
  readonly attentionElapsedDisplay: string
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

export type DeviceWorkspaceFilter = 'all' | 'active' | 'hidden' | 'online' | 'nofix' | 'stale'

/**
 * Builds the operator-facing device roster rows from the current tracking snapshot.
 */
export function buildDeviceWorkspaceRows(
  snapshot: TrackingSnapshot,
  hiddenDeviceIds: readonly string[],
  activeDeviceIds: readonly string[] = [],
  ingestHealth: CurrentPositionIngestHealthSummary = EMPTY_CURRENT_POSITION_INGEST_HEALTH,
  attentionByDevice: Readonly<Record<string, Pick<DeviceStationaryAttention, 'state' | 'acknowledged' | 'elapsedMs' | 'latestFixUnreliable'>>> = {},
): readonly DeviceWorkspaceRow[] {
  const latestPositionByDevice = new Map(
    snapshot.positions.map((position) => [position.device_id, position] as const),
  )
  const activeDeviceIdSet = new Set(activeDeviceIds)

  return [...snapshot.devices]
    .map((device) => {
      const position = latestPositionByDevice.get(device.device_id) ?? null
      const rejected = ingestHealth.byDevice[device.device_id]
      const attention = attentionByDevice[device.device_id]
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
        fixTimeDisplay: formatOperatorLocalTimestamp(position?.timestamp ?? null),
        sourceDisplay:
          position === null
            ? 'No fix'
            : position.fix_time_unverified === true
              ? 'Fix time unverified'
            : position.device_cache_stale
              ? 'Stale'
              : position.data_origin === 'cache'
                ? 'Cache'
                : 'Live',
        fixTimeUnverified: position?.fix_time_unverified === true,
        ingestWarning: rejected === undefined
          ? null
          : `${rejected.count} position ${rejected.count === 1 ? 'row' : 'rows'} rejected — ${formatCurrentPositionRejectionReason(rejected.lastReason)}.`,
        stale: position?.device_cache_stale ?? false,
        accuracyDisplay:
          typeof position?.accuracy === 'number'
            ? `${position.accuracy.toFixed(1)} m`
            : '—',
        batteryDisplay:
          typeof position?.battery === 'number' ? `${Math.round(position.battery)}%` : '—',
        speedDisplay:
          typeof position?.speed === 'number' ? `${position.speed.toFixed(1)} km/h` : '—',
        stationaryAttention: attention?.state === 'attention',
        stationaryAttentionUnavailable: attention?.state === 'insufficient-data',
        stationaryAttentionUnreliable: attention?.latestFixUnreliable === true,
        attentionAcknowledged: attention?.acknowledged === true,
        attentionElapsedDisplay: formatAttentionElapsed(attention?.elapsedMs),
      } satisfies DeviceWorkspaceRow
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

function formatAttentionElapsed(elapsedMs: number | undefined): string {
  if (elapsedMs === undefined || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return 'duration unavailable'
  }
  return `${Math.floor(elapsedMs / 60_000)} min without meaningful movement`
}

/**
 * Applies the active list tab before search so queries cannot escape the selected context.
 */
export function filterDeviceWorkspaceRows(
  rows: readonly DeviceWorkspaceRow[],
  filter: DeviceWorkspaceFilter,
  query: string,
): readonly DeviceWorkspaceRow[] {
  const filteredRows = applyDeviceWorkspaceFilter(rows, filter)
  const normalizedQuery = query.trim().toLowerCase()

  if (normalizedQuery === '') {
    return filteredRows
  }

  return filteredRows.filter((row) =>
    [row.deviceId, row.name, row.status, row.sourceDisplay, row.lastSeenDisplay]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery),
  )
}

/**
 * Keeps selection inside the visible list, falling back to the first visible device.
 */
export function resolveVisibleDeviceSelection(
  visibleRows: readonly DeviceWorkspaceRow[],
  selectedDeviceId: string | null,
): string | null {
  if (
    selectedDeviceId !== null &&
    visibleRows.some((row) => row.deviceId === selectedDeviceId)
  ) {
    return selectedDeviceId
  }

  return visibleRows[0]?.deviceId ?? null
}

/**
 * Summarizes the current workspace rows and tracking status for the Devices workspace header.
 */
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

function applyDeviceWorkspaceFilter(
  rows: readonly DeviceWorkspaceRow[],
  filter: DeviceWorkspaceFilter,
): readonly DeviceWorkspaceRow[] {
  switch (filter) {
    case 'all':
      return rows
    case 'active':
      return rows.filter((row) => row.active)
    case 'hidden':
      return rows.filter((row) => row.hidden)
    case 'online':
      return rows.filter((row) => row.status === 'online')
    case 'nofix':
      return rows.filter((row) => !row.hasFix)
    case 'stale':
      return rows.filter((row) => row.stale)
  }
}

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return 'N/A'
  }

  return new Date(value).toLocaleTimeString()
}
