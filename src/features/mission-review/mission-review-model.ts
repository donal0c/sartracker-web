import type {
  Device,
  Drawing,
  GpxTrackImport,
  Helicopter,
  Marker,
  Mission,
  MissionEvent,
  MissionStoreInfo,
  Position,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { buildLayerCatalogTree } from '../layers/layer-catalog-builder'
import type {
  LayerCatalogMetadataEntry,
  LayerCatalogRootNode,
} from '../layers/layer-catalog-types'
import type { NormalizedTrackingDevice } from '../tracking/tracking-types'

export type MissionReviewSummary = {
  readonly missionName: string
  readonly missionStatus: Mission['status']
  readonly startedAtDisplay: string
  readonly finishedAtDisplay: string
  readonly pausedDurationDisplay: string
  readonly noteSummary: string
  readonly databasePath: string
  readonly backupPath: string
  readonly layerCount: number
  readonly featureCount: number
  readonly markerCount: number
  readonly drawingCount: number
  readonly trackingDeviceCount: number
  readonly breadcrumbCount: number
  readonly eventCount: number
  readonly gpxImportCount: number
}

export type MissionReviewEventRow = {
  readonly id: string
  readonly timestampDisplay: string
  readonly eventType: string
  readonly title: string
  readonly description: string
  readonly rawDetails: Record<string, unknown> | null
}

export type MissionReviewMarkerRow = {
  readonly id: string
  readonly type: Marker['type']
  readonly name: string
  readonly description: string
  readonly lat: number
  readonly lon: number
  readonly createdAtDisplay: string
  readonly updatedAtDisplay: string
  readonly coordinateDisplay: string
  readonly searchText: string
  readonly detailRows: readonly { readonly label: string; readonly value: string }[]
  readonly historyRows: readonly MissionReviewEventRow[]
  readonly attachmentPath: string | null
}

export type MissionReviewSnapshot = {
  readonly mission: Mission
  readonly summary: MissionReviewSummary
  readonly eventRows: readonly MissionReviewEventRow[]
  readonly markerRows: readonly MissionReviewMarkerRow[]
  readonly layerRoot: LayerCatalogRootNode
}

type BuildMissionReviewSnapshotInput = {
  readonly mission: Mission
  readonly info: MissionStoreInfo
  readonly events: readonly MissionEvent[]
  readonly markers: readonly Marker[]
  readonly devices: readonly Device[]
  readonly positions: readonly Position[]
  readonly drawings: readonly Drawing[]
  readonly helicopters: readonly Helicopter[]
  readonly gpxImports: readonly GpxTrackImport[]
  readonly layerMetadata: readonly LayerCatalogMetadataEntry[]
}

export function buildMissionReviewSnapshot(
  input: BuildMissionReviewSnapshotInput,
): MissionReviewSnapshot {
  const catalogRoot = buildLayerCatalogTree({
    missionId: input.mission.id,
    devices: input.devices.map(normalizeReviewDevice),
    markers: input.markers,
    drawings: input.drawings.filter((drawing) => drawing.temporary_measure !== true),
    helicopters: input.helicopters,
    gpxImports: input.gpxImports,
    measurements: [],
    metadataEntries: input.layerMetadata,
  })
  const layerCount = catalogRoot.children.reduce((count, group) => count + group.children.length, 0)
  const featureCount = catalogRoot.children.reduce(
    (count, group) =>
      count +
      group.children.reduce((layerCount, layer) => layerCount + layer.children.length, 0),
    0,
  )

  const eventsByMarkerId = indexEventsByMarkerId(input.events)

  return {
    mission: input.mission,
    summary: {
      missionName: input.mission.name,
      missionStatus: input.mission.status,
      startedAtDisplay: formatTimestamp(input.mission.start_time),
      finishedAtDisplay: input.mission.finish_time === null ? 'In progress' : formatTimestamp(input.mission.finish_time),
      pausedDurationDisplay: formatDuration(input.mission.paused_seconds),
      noteSummary: input.mission.notes?.trim() || 'No mission notes recorded.',
      databasePath: input.info.database_path,
      backupPath: input.info.backup_path,
      layerCount,
      featureCount,
      markerCount: input.markers.length,
      drawingCount: input.drawings.filter((drawing) => drawing.temporary_measure !== true).length,
      trackingDeviceCount: input.devices.length,
      breadcrumbCount: input.positions.length,
      eventCount: input.events.length,
      gpxImportCount: input.gpxImports.length,
    },
    eventRows: input.events.map(buildEventRow),
    markerRows: input.markers.map((marker) => buildMarkerRow(marker, eventsByMarkerId)),
    layerRoot: catalogRoot,
  }
}

export function filterMissionReviewMarkers(
  markerRows: readonly MissionReviewMarkerRow[],
  options: {
    readonly query: string
    readonly type: Marker['type'] | 'all'
  },
): readonly MissionReviewMarkerRow[] {
  const normalizedQuery = options.query.trim().toLowerCase()

  return markerRows.filter((row) => {
    if (options.type !== 'all' && row.type !== options.type) {
      return false
    }

    if (normalizedQuery === '') {
      return true
    }

    return row.searchText.includes(normalizedQuery)
  })
}

function buildEventRow(event: MissionEvent): MissionReviewEventRow {
  const details = parseEventDetails(event.details_json)
  const eventMeta = EVENT_TITLES[event.event_type] ?? {
    title: humanizeEventType(event.event_type),
    description: null,
  }

  return {
    id: event.id,
    timestampDisplay: formatTimestamp(event.timestamp),
    eventType: event.event_type,
    title: eventMeta.title,
    description: describeMissionEvent(event.event_type, details, eventMeta.description),
    rawDetails: details,
  }
}

function buildMarkerRow(
  marker: Marker,
  eventsByMarkerId: Map<string, readonly MissionEvent[]>,
): MissionReviewMarkerRow {
  const latDisplay = formatCoordinate(marker.lat)
  const lonDisplay = formatCoordinate(marker.lon)
  const detailRows = [
    { label: 'Created', value: formatTimestamp(marker.created_at) },
    { label: 'Updated', value: formatTimestamp(marker.updated_at) },
    { label: 'Latitude', value: latDisplay },
    { label: 'Longitude', value: lonDisplay },
    { label: 'Irish Grid', value: formatIrishGrid(marker.irish_grid_e, marker.irish_grid_n) },
    ...buildMarkerSpecificDetails(marker),
  ]

  const searchText = [
    marker.type,
    marker.name,
    marker.description ?? '',
    marker.subject_category ?? '',
    marker.clue_type ?? '',
    marker.found_by ?? '',
    marker.hazard_type ?? '',
    marker.severity ?? '',
    marker.condition ?? '',
    marker.treatment ?? '',
    marker.evacuation_priority ?? '',
    marker.updated_by ?? '',
    marker.coordinator_ids ?? '',
    marker.attachment_path ?? '',
  ]
    .join(' ')
    .toLowerCase()

  return {
    id: marker.id,
    type: marker.type,
    name: marker.name,
    description: marker.description?.trim() || 'No description recorded.',
    lat: marker.lat,
    lon: marker.lon,
    createdAtDisplay: formatTimestamp(marker.created_at),
    updatedAtDisplay: formatTimestamp(marker.updated_at),
    coordinateDisplay: `${latDisplay}, ${lonDisplay}`,
    searchText,
    detailRows,
    historyRows: (eventsByMarkerId.get(marker.id) ?? []).map(buildEventRow).reverse(),
    attachmentPath: marker.attachment_path,
  }
}

function buildMarkerSpecificDetails(
  marker: Marker,
): readonly { readonly label: string; readonly value: string }[] {
  const rows: { label: string; value: string }[] = []

  if (marker.subject_category !== null) {
    rows.push({ label: 'Subject Category', value: marker.subject_category })
  }
  if (marker.clue_type !== null) {
    rows.push({ label: 'Clue Type', value: marker.clue_type })
  }
  if (marker.confidence !== null) {
    rows.push({ label: 'Confidence', value: marker.confidence.toFixed(2) })
  }
  if (marker.found_by !== null) {
    rows.push({ label: 'Found By', value: marker.found_by })
  }
  if (marker.hazard_type !== null) {
    rows.push({ label: 'Hazard Type', value: marker.hazard_type })
  }
  if (marker.severity !== null) {
    rows.push({ label: 'Severity', value: marker.severity })
  }
  if (marker.condition !== null) {
    rows.push({ label: 'Condition', value: marker.condition })
  }
  if (marker.treatment !== null) {
    rows.push({ label: 'Treatment', value: marker.treatment })
  }
  if (marker.evacuation_priority !== null) {
    rows.push({ label: 'Evac Priority', value: marker.evacuation_priority })
  }
  if (marker.updated_by !== null) {
    rows.push({ label: 'Updated By', value: marker.updated_by })
  }
  if (marker.coordinator_ids !== null) {
    rows.push({ label: 'Coordinator IDs', value: marker.coordinator_ids })
  }
  if (marker.attachment_path !== null) {
    rows.push({ label: 'Attachment Path', value: marker.attachment_path })
  }

  return rows
}

/**
 * Pre-indexes events by marker_id so marker history rows can be built in O(n) instead of O(n*m).
 */
function indexEventsByMarkerId(
  events: readonly MissionEvent[],
): Map<string, readonly MissionEvent[]> {
  const index = new Map<string, MissionEvent[]>()
  for (const event of events) {
    const details = parseEventDetails(event.details_json)
    const markerId = readString(details, 'marker_id')
    if (markerId !== null) {
      const existing = index.get(markerId)
      if (existing !== undefined) {
        existing.push(event)
      } else {
        index.set(markerId, [event])
      }
    }
  }
  return index
}

function normalizeReviewDevice(device: Device): NormalizedTrackingDevice {
  return {
    device_id: device.device_id,
    name: device.name,
    status: device.status,
    last_seen: device.last_seen,
    unique_id: null,
    category: null,
  }
}

function parseEventDetails(detailsJson: string | null): Record<string, unknown> | null {
  if (detailsJson === null) {
    return null
  }

  try {
    const parsed = JSON.parse(detailsJson) as unknown
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function describeMissionEvent(
  eventType: string,
  details: Record<string, unknown> | null,
  fallback: string | null,
): string {
  const name = readString(details, 'name')
  const markerType = readString(details, 'marker_type')
  const drawingType = readString(details, 'drawing_type')
  const deviceId = readString(details, 'device_id')
  const archivePath = readString(details, 'archive_path')
  const updatedBy = readString(details, 'updated_by')
  const attachmentPath = readString(details, 'attachment_path')
  const adminName = readString(details, 'admin_name')
  const reason = readString(details, 'reason')
  const sourcePath = readString(details, 'source_path')
  const fileName = readString(details, 'file_name')
  const displayName = readString(details, 'display_name')

  switch (eventType) {
    case 'mission_created':
      return name === null ? 'Mission created.' : `Mission created as ${name}.`
    case 'device_created':
    case 'device_updated':
      return deviceId === null ? 'Tracking device updated.' : `Tracking device ${deviceId} updated.`
    case 'position_recorded':
      return deviceId === null ? 'Position recorded.' : `Position recorded for ${deviceId}.`
    case 'marker_created':
    case 'marker_updated':
      return [
        name === null ? 'Marker saved.' : `${markerType ?? 'marker'} saved as ${name}.`,
        updatedBy === null ? null : `Updated by ${updatedBy}.`,
        attachmentPath === null ? null : `Attachment: ${attachmentPath}.`,
      ]
        .filter((value): value is string => value !== null)
        .join(' ')
    case 'marker_deleted':
      return name === null ? 'Marker deleted.' : `${markerType ?? 'marker'} ${name} deleted.`
    case 'drawing_created':
    case 'drawing_updated':
      return name === null
        ? 'Drawing saved.'
        : `${drawingType ?? 'drawing'} saved as ${name}.`
    case 'drawing_deleted':
      return name === null ? 'Drawing deleted.' : `${drawingType ?? 'drawing'} ${name} deleted.`
    case 'gpx_import_created':
    case 'gpx_import_updated':
      return [
        displayName === null ? 'GPX import saved.' : `GPX import saved as ${displayName}.`,
        fileName === null ? null : `File: ${fileName}.`,
        sourcePath === null ? null : `Source: ${sourcePath}.`,
      ]
        .filter((value): value is string => value !== null)
        .join(' ')
    case 'gpx_import_deleted':
      return displayName === null ? 'GPX import deleted.' : `GPX import ${displayName} deleted.`
    case 'mission_archived':
    case 'mission_archive_succeeded':
      return archivePath === null ? 'Mission archive created.' : `Archive created at ${archivePath}.`
    case 'mission_archive_failed':
      return `Archive failed${readString(details, 'error') ? `: ${readString(details, 'error')}` : '.'}`
    case 'mission_unlock_requested':
    case 'mission_unlock_denied':
    case 'mission_unlocked':
      return adminName === null
        ? fallback ?? 'Mission governance event recorded.'
        : `${fallback ?? 'Mission governance event recorded.'} Admin: ${adminName}${reason === null ? '' : ` (${reason})`}.`
    default:
      return fallback ?? 'Mission event recorded.'
  }
}

function readString(
  details: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = details?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function humanizeEventType(eventType: string): string {
  return eventType
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Formats a coordinate value with validation. Returns 'Invalid' for NaN/Infinity.
 */
function formatCoordinate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(5) : 'Invalid'
}

/**
 * Formats Irish Grid easting/northing with validation.
 */
function formatIrishGrid(easting: number, northing: number): string {
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
    return 'Invalid'
  }
  return `${easting}, ${northing}`
}

/**
 * Formats an ISO timestamp string for display using explicit en-IE locale and 24-hour time
 * so output is deterministic across machines for after-action report reproducibility.
 */
function formatTimestamp(value: string): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return value
  }

  return new Date(parsed).toLocaleString('en-IE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

const EVENT_TITLES: Record<
  string,
  { readonly title: string; readonly description: string | null }
> = {
  mission_created: { title: 'Mission Created', description: null },
  mission_paused: { title: 'Mission Paused', description: 'Mission paused.' },
  mission_resumed: { title: 'Mission Resumed', description: 'Mission resumed.' },
  mission_finished: { title: 'Mission Finished', description: 'Mission finished.' },
  mission_backup_synced: { title: 'Backup Synced', description: 'Backup snapshot refreshed.' },
  mission_archived: { title: 'Archive Created', description: null },
  mission_finalize_requested: { title: 'Finalize Requested', description: 'Mission finalization requested.' },
  mission_archive_succeeded: { title: 'Archive Succeeded', description: null },
  mission_archive_failed: { title: 'Archive Failed', description: null },
  mission_finalized: { title: 'Mission Finalized', description: 'Mission locked for review.' },
  mission_unlock_requested: { title: 'Unlock Requested', description: 'Unlock requested.' },
  mission_unlock_denied: { title: 'Unlock Denied', description: 'Unlock denied.' },
  mission_unlocked: { title: 'Mission Unlocked', description: 'Mission unlocked for correction.' },
  gpx_import_created: { title: 'GPX Import Created', description: null },
  gpx_import_updated: { title: 'GPX Import Updated', description: null },
  gpx_import_deleted: { title: 'GPX Import Deleted', description: null },
}
