import type { TrackingConnectionStatus, TrackingSnapshot } from './tracking-types'
import {
  EMPTY_CURRENT_POSITION_INGEST_HEALTH,
  formatCurrentPositionRejectionReason,
  type CurrentPositionIngestHealthSummary,
} from './ingest-health'
import type { DeviceStationaryAttention } from './stationary-attention-store'
import { selectNewestKnownFixes } from './newest-known-fix'
import { formatOperatorLocalTimestamp } from './operator-time'
import { describeTrackingFeed, type TrackingFeedTone } from './persistent-tracking-health'

export type DeviceWorkspaceRow = {
  readonly deviceId: string
  readonly name: string
  readonly status: 'online' | 'offline' | 'unknown'
  readonly hidden: boolean
  readonly hasFix: boolean
  readonly latitude: number | null
  readonly longitude: number | null
  readonly dataOrigin: 'live' | 'cache' | null
  readonly lastSeen: string | null
  readonly lastSeenDisplay: string
  readonly fixTimeDisplay: string
  /** Raw time of the position being shown, which can be older than last contact. */
  readonly fixTime: string | null
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
  /**
   * The device status Traccar last reported, kept even while positions are not
   * updating, so a person's own problem survives a pause [DON-356].
   */
  readonly reportedStatus: 'online' | 'offline' | 'unknown'
  /** True when this person's current fix was never confirmed in the mission store. */
  readonly currentUnconfirmed: boolean
}

export type DeviceWorkspaceSummary = {
  readonly totalDevices: number
  readonly onlineDevices: number
  readonly hiddenDevices: number
  readonly staleDevices: number
  readonly cachedDevices: number
  readonly lastSuccessAtDisplay: string
  readonly warning: string | null
  readonly mode: TrackingConnectionStatus['mode']
  /** The header sentence: healthy only when the feed is online, unwarned and every position fresh [M-20]. */
  readonly headline: string
  readonly tone: TrackingFeedTone
}

export type DeviceWorkspaceFilter = 'all' | 'hidden' | 'online' | 'nofix' | 'stale'

/**
 * Builds the operator-facing device roster rows from the current tracking snapshot.
 */
export function buildDeviceWorkspaceRows(
  snapshot: TrackingSnapshot,
  hiddenDeviceIds: readonly string[],
  ingestHealth: CurrentPositionIngestHealthSummary = EMPTY_CURRENT_POSITION_INGEST_HEALTH,
  attentionByDevice: Readonly<Record<string, Pick<DeviceStationaryAttention, 'state' | 'acknowledged' | 'elapsedMs' | 'latestFixUnreliable'>>> = {},
  connectionMode: TrackingConnectionStatus['mode'] = 'online',
): readonly DeviceWorkspaceRow[] {
  const latestPositionByDevice = new Map(
    // Same newest-known-fix choice as the map marker, so list and marker never disagree.
    selectNewestKnownFixes(snapshot.positions, snapshot.breadcrumbs).map(
      (position) => [position.device_id, position] as const,
    ),
  )
  const unconfirmedCurrentDeviceIds = new Set(snapshot.unconfirmedCurrentDeviceIds)

  return [...snapshot.devices]
    .map((device) => {
      const position = latestPositionByDevice.get(device.device_id) ?? null
      const rejected = ingestHealth.byDevice[device.device_id]
      const attention = attentionByDevice[device.device_id]
      return {
        deviceId: device.device_id,
        name: device.name,
        status: connectionMode === 'online' && !unconfirmedCurrentDeviceIds.has(device.device_id)
          ? device.status : 'unknown' as const,
        hidden: hiddenDeviceIds.includes(device.device_id),
        hasFix: position !== null,
        latitude: position?.lat ?? null,
        longitude: position?.lon ?? null,
        dataOrigin: position?.data_origin ?? null,
        lastSeen: device.last_seen,
        lastSeenDisplay: formatOperatorLocalTimestamp(device.last_seen),
        fixTimeDisplay: formatOperatorLocalTimestamp(position?.timestamp ?? null),
        fixTime: position?.timestamp ?? null,
        sourceDisplay: describeSource(
          position,
          connectionMode !== 'online' || unconfirmedCurrentDeviceIds.has(device.device_id),
        ),
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
        reportedStatus: device.status,
        currentUnconfirmed: position !== null && unconfirmedCurrentDeviceIds.has(device.device_id),
      } satisfies DeviceWorkspaceRow
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

const STALE_SOURCE_PREFIX = 'Stale · '

/**
 * Labels where a row's position came from. Staleness is never one option in
 * that list: a stale position always says Stale, alongside its provenance, so
 * an unverified fix time or a lost connection cannot hide it [M-21].
 *
 * @param position the newest known fix, or null
 * @param notLive tracking is not online, or this device is not confirmed current
 * @returns the label shown in the row's Source column and the inspector
 */
function describeSource(
  position: TrackingSnapshot['positions'][number] | null,
  notLive: boolean,
): string {
  if (position === null) return 'No fix'
  const provenance = position.fix_time_ahead_of_clock === true
    ? 'Fix time ahead of laptop clock'
    : position.fix_time_unverified === true
      ? 'Fix time unverified'
      : notLive && position.data_origin === 'live'
        ? 'Last known'
        : null
  if (!position.device_cache_stale) return provenance ?? (position.data_origin === 'cache' ? 'Cache' : 'Live')
  return provenance === null ? 'Stale' : `${STALE_SOURCE_PREFIX}${provenance}`
}

/**
 * The provenance part of a row's Source label, without the Stale marker.
 *
 * @param row the device row
 * @returns for example 'Last known' for both 'Last known' and 'Stale · Last known'
 */
export function sourceProvenance(row: Pick<DeviceWorkspaceRow, 'sourceDisplay'>): string {
  return row.sourceDisplay.startsWith(STALE_SOURCE_PREFIX)
    ? row.sourceDisplay.slice(STALE_SOURCE_PREFIX.length)
    : row.sourceDisplay
}

function formatAttentionElapsed(elapsedMs: number | undefined): string {
  if (elapsedMs === undefined || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return 'duration unavailable'
  }
  return `${Math.floor(elapsedMs / 60_000)} min without meaningful movement`
}

/**
 * Applies the selected filter tab before search so queries cannot escape the selected context.
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
    onlineDevices: rows.filter((row) => row.status === 'online').length,
    hiddenDevices: rows.filter((row) => row.hidden).length,
    staleDevices: rows.filter((row) => row.stale).length,
    cachedDevices: rows.filter((row) => row.dataOrigin === 'cache').length,
    lastSuccessAtDisplay: formatOperatorLocalTimestamp(status.lastSuccessAt),
    warning: status.warning,
    mode: status.mode,
    ...describeTrackingFeed(
      status,
      rows.filter((row) => row.stale).length,
      rows.filter((row) => row.fixTimeUnverified).length,
      'Tracking feed healthy.',
    ),
  }
}

function applyDeviceWorkspaceFilter(
  rows: readonly DeviceWorkspaceRow[],
  filter: DeviceWorkspaceFilter,
): readonly DeviceWorkspaceRow[] {
  switch (filter) {
    case 'all':
      return rows
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
