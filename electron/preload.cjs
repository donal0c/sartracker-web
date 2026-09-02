const { contextBridge, ipcRenderer } = require('electron')

const TRACCAR_REQUEST_CHANNEL = 'sartracker:traccar-http-request'
const LOAD_SETTINGS_CHANNEL = 'sartracker:load-app-settings'
const SAVE_SETTINGS_CHANNEL = 'sartracker:save-app-settings'
const TEST_TRACKING_CONNECTION_CHANNEL = 'sartracker:test-tracking-connection'
const LOAD_RUNTIME_BOOTSTRAP_CHANNEL = 'sartracker:load-runtime-bootstrap-settings'
const READ_TRACKING_CACHE_CHANNEL = 'sartracker:read-tracking-cache'
const WRITE_TRACKING_CACHE_CHANNEL = 'sartracker:write-tracking-cache'
const EXPORT_DIAGNOSTICS_REPORT_CHANNEL = 'sartracker:export-diagnostics-report'
const EXPORT_SUPPORT_BUNDLE_CHANNEL = 'sartracker:export-support-bundle'
const READ_CRASH_RECOVERY_STATE_CHANNEL = 'sartracker:read-crash-recovery-state'
const RECORD_DIAGNOSTIC_EVENT_CHANNEL = 'sartracker:record-diagnostic-event'
const CHOOSE_GPX_FILE_PATHS_CHANNEL = 'sartracker:choose-gpx-file-paths'
const CHOOSE_GPX_DIRECTORY_PATH_CHANNEL = 'sartracker:choose-gpx-directory-path'
const CHOOSE_OFFICIAL_MAP_SOURCE_FILE_PATH_CHANNEL = 'sartracker:choose-official-map-source-file-path'
const CHOOSE_OFFICIAL_MAP_PACKAGE_PATH_CHANNEL = 'sartracker:choose-official-map-package-path'
const IMPORT_OFFICIAL_MAP_PACKAGE_CHANNEL = 'sartracker:import-official-map-package'
const LIST_GPX_DIRECTORY_PATHS_CHANNEL = 'sartracker:list-gpx-directory-paths'
const INGEST_MARKER_ATTACHMENT_CHANNEL = 'sartracker:ingest-marker-attachment'
const OPEN_EXTERNAL_PATH_CHANNEL = 'sartracker:open-external-path'
const OPEN_EXTERNAL_URL_CHANNEL = 'sartracker:open-external-url'
const FETCH_OFFICIAL_MAP_TILE_CHANNEL = 'sartracker:fetch-official-map-tile'
const COVERAGE_CHANGED_CHANNEL = 'sartracker:coverage-changed'
const COVERAGE_RENDERER_FAILED_CHANNEL = 'sartracker:coverage-renderer-failed'
const RENDERER_TEARDOWN_REQUEST_CHANNEL = 'sartracker:app-runtime-teardown-requested'
const RENDERER_TEARDOWN_READY_CHANNEL = 'sartracker:app-runtime-teardown-ready'
const MISSION_ARCHIVE_PROGRESS_CHANNEL = 'sartracker:mission-archive:progress'
const ARCHIVE_REVIEW_PROGRESS_CHANNEL = 'sartracker:archive-review:progress'
const ARCHIVE_REVIEW_CHANNELS = Object.freeze({
  open: 'sartracker:archive-review:open',
  close: 'sartracker:archive-review:close',
  cancel: 'sartracker:archive-review:cancel',
  read: 'sartracker:archive-review:read',
  mutationDenied: 'sartracker:archive-review:mutation-denied',
})

const MISSION_STORE_CHANNELS = {
  info: 'sartracker:mission-store:info',
  syncBackup: 'sartracker:mission-store:sync-backup',
  issueMissionArchiveRecoveryCode: 'sartracker:mission-store:issue-archive-recovery-code',
  listMissionArchives: 'sartracker:mission-store:list-mission-archives',
  verifyMissionArchive: 'sartracker:mission-store:verify-mission-archive',
  getMissionCleanupEligibility: 'sartracker:mission-store:get-mission-cleanup-eligibility',
  startMissionCleanup: 'sartracker:mission-store:start-mission-cleanup',
  resumeMissionCleanup: 'sartracker:mission-store:resume-mission-cleanup',
  cancelMissionArchiveOperation: 'sartracker:mission-store:cancel-mission-archive-operation',
  createMission: 'sartracker:mission-store:create-mission',
  createOuting: 'sartracker:mission-store:create-outing',
  endOuting: 'sartracker:mission-store:end-outing',
  renameOuting: 'sartracker:mission-store:rename-outing',
  editOutingBoundaries: 'sartracker:mission-store:edit-outing-boundaries',
  listOutings: 'sartracker:mission-store:list-outings',
  readOutingFixSummary: 'sartracker:mission-store:read-outing-fix-summary',
  cancelOutingFixSummary: 'sartracker:mission-store:cancel-outing-fix-summary',
  selectMissionParticipants: 'sartracker:mission-store:select-mission-participants',
  addMissionParticipant: 'sartracker:mission-store:add-mission-participant',
  removeMissionParticipant: 'sartracker:mission-store:remove-mission-participant',
  listMissionParticipants: 'sartracker:mission-store:list-mission-participants',
  recordGroupMembershipEvents: 'sartracker:mission-store:record-group-membership-events',
  listGroupMembershipEvents: 'sartracker:mission-store:list-group-membership-events',
  upsertParticipantBackfillCheckpoint: 'sartracker:mission-store:upsert-participant-backfill-checkpoint',
  listParticipantBackfillCheckpoints: 'sartracker:mission-store:list-participant-backfill-checkpoints',
  upsertDevice: 'sartracker:mission-store:upsert-device',
  upsertDevicesBulk: 'sartracker:mission-store:upsert-devices-bulk',
  getDevice: 'sartracker:mission-store:get-device',
  listDevices: 'sartracker:mission-store:list-devices',
  addPosition: 'sartracker:mission-store:add-position',
  addPositionsBulk: 'sartracker:mission-store:add-positions-bulk',
  persistTrackingPositionsBulk: 'sartracker:mission-store:persist-tracking-positions-bulk',
  persistTrackingHistoryBatch: 'sartracker:mission-store:persist-tracking-history-batch',
  listPositions: 'sartracker:mission-store:list-positions',
  listRecentPositions: 'sartracker:mission-store:list-recent-positions',
  listBreadcrumbPositions: 'sartracker:mission-store:list-breadcrumb-positions',
  cancelBreadcrumbQuery: 'sartracker:mission-store:cancel-breadcrumb-query',
  listExactBreadcrumbDotPage: 'sartracker:mission-store:list-exact-breadcrumb-dot-page',
  cancelExactBreadcrumbDotQuery: 'sartracker:mission-store:cancel-exact-breadcrumb-dot-query',
  readCoverageManifest: 'sartracker:mission-store:read-coverage-manifest',
  readCoverageChunk: 'sartracker:mission-store:read-coverage-chunk',
  readCoverageClaim: 'sartracker:mission-store:read-coverage-claim',
  syncCoverageTileCatalog: 'sartracker:mission-store:sync-coverage-tile-catalog',
  activateCoverageTileCatalog: 'sartracker:mission-store:activate-coverage-tile-catalog',
  finalizeCoverageTileCatalog: 'sartracker:mission-store:finalize-coverage-tile-catalog',
  discardCoverageTileCatalog: 'sartracker:mission-store:discard-coverage-tile-catalog',
  readCoverageTile: 'sartracker:mission-store:read-coverage-tile',
  cancelCoverageTileRead: 'sartracker:mission-store:cancel-coverage-tile-read',
  cancelCoverageQuery: 'sartracker:mission-store:cancel-coverage-query',
  listTrackingHistoryCheckpoints: 'sartracker:mission-store:list-tracking-history-checkpoints',
  countPositions: 'sartracker:mission-store:count-positions',
  latestPositions: 'sartracker:mission-store:latest-positions',
  listMissionEvents: 'sartracker:mission-store:list-mission-events',
  listAuditEvents: 'sartracker:mission-store:list-audit-events',
  readMissionReview: 'sartracker:mission-store:read-mission-review',
  cancelMissionReviewRead: 'sartracker:mission-store:cancel-mission-review-read',
  readMissionReplay: 'sartracker:mission-store:read-mission-replay',
  readMissionReplayTrackChunk: 'sartracker:mission-store:read-mission-replay-track-chunk',
  readMissionReplayObjectChunk: 'sartracker:mission-store:read-mission-replay-object-chunk',
  readMissionReplayFilterPage: 'sartracker:mission-store:read-mission-replay-filter-page',
  assignGpxImportToOuting: 'sartracker:mission-store:assign-gpx-import-to-outing',
  cancelMissionReplay: 'sartracker:mission-store:cancel-mission-replay',
  listIngestAnomalies: 'sartracker:mission-store:list-ingest-anomalies',
  recordIngestRejections: 'sartracker:mission-store:record-ingest-rejections',
  recordIngestEvidenceLoss: 'sartracker:mission-store:record-ingest-evidence-loss',
  acknowledgeIngestEvidenceLoss: 'sartracker:mission-store:acknowledge-ingest-evidence-loss',
  getIngestEvidenceHealth: 'sartracker:mission-store:get-ingest-evidence-health',
  upsertMarker: 'sartracker:mission-store:upsert-marker',
  getMarker: 'sartracker:mission-store:get-marker',
  listMarkers: 'sartracker:mission-store:list-markers',
  deleteMarker: 'sartracker:mission-store:delete-marker',
  upsertDrawing: 'sartracker:mission-store:upsert-drawing',
  getDrawing: 'sartracker:mission-store:get-drawing',
  listDrawings: 'sartracker:mission-store:list-drawings',
  deleteDrawing: 'sartracker:mission-store:delete-drawing',
  upsertHelicopter: 'sartracker:mission-store:upsert-helicopter',
  listHelicopters: 'sartracker:mission-store:list-helicopters',
  deleteHelicopter: 'sartracker:mission-store:delete-helicopter',
  listGpxImportPage: 'sartracker:mission-store:list-gpx-import-page',
  listGpxImportIssues: 'sartracker:mission-store:list-gpx-import-issues',
  deleteGpxImport: 'sartracker:mission-store:delete-gpx-import',
  listGpxImportRevisionPage: 'sartracker:mission-store:list-gpx-import-revision-page',
  importGpxEvidencePaths: 'sartracker:mission-store:import-gpx-evidence-paths',
  updateGpxImportPresentation: 'sartracker:mission-store:update-gpx-import-presentation',
  upsertSearchArea: 'sartracker:mission-store:upsert-search-area',
  listSearchAreas: 'sartracker:mission-store:list-search-areas',
  retireSearchArea: 'sartracker:mission-store:retire-search-area',
  upsertSearchAssignment: 'sartracker:mission-store:upsert-search-assignment',
  listSearchAssignments: 'sartracker:mission-store:list-search-assignments',
  upsertSearchPass: 'sartracker:mission-store:upsert-search-pass',
  listSearchPasses: 'sartracker:mission-store:list-search-passes',
  listSearchOperationPage: 'sartracker:mission-store:list-search-operation-page',
  getMission: 'sartracker:mission-store:get-mission',
  listMissions: 'sartracker:mission-store:list-missions',
  getActiveMission: 'sartracker:mission-store:get-active-mission',
  getRecoverableMission: 'sartracker:mission-store:get-recoverable-mission',
  pauseMission: 'sartracker:mission-store:pause-mission',
  resumeMission: 'sartracker:mission-store:resume-mission',
  finishMission: 'sartracker:mission-store:finish-mission',
  finalizeMission: 'sartracker:mission-store:finalize-mission',
  unlockFinalizedMission: 'sartracker:mission-store:unlock-finalized-mission',
}

const LAYER_CATALOG_STORE_CHANNELS = {
  listMetadata: 'sartracker:layer-catalog-store:list-metadata',
  upsertMetadata: 'sartracker:layer-catalog-store:upsert-metadata',
  clearMetadata: 'sartracker:layer-catalog-store:clear-metadata',
}

const REPLAY_STORE_METHODS = new Set([
  'readMissionReplay',
  'readMissionReplayTrackChunk',
  'readMissionReplayObjectChunk',
  'readMissionReplayFilterPage',
  'cancelMissionReplay',
])
const BOUNDED_EVIDENCE_STORE_METHODS = new Set([
  'upsertMarker',
  'upsertDrawing',
  'deleteMarker',
  'deleteDrawing',
  'assignGpxImportToOuting',
  'listGpxImportPage',
  'listGpxImportIssues',
  'deleteGpxImport',
  'listGpxImportRevisionPage',
  'importGpxEvidencePaths',
  'updateGpxImportPresentation',
  'upsertSearchArea',
  'listSearchAreas',
  'retireSearchArea',
  'upsertSearchAssignment',
  'listSearchAssignments',
  'upsertSearchPass',
  'listSearchPasses',
  'listSearchOperationPage',
])
const ARCHIVE_STORE_METHODS = new Set([
  'issueMissionArchiveRecoveryCode',
  'listMissionArchives',
  'verifyMissionArchive',
  'getMissionCleanupEligibility',
  'startMissionCleanup',
  'resumeMissionCleanup',
  'cancelMissionArchiveOperation',
  'finalizeMission',
  'unlockFinalizedMission',
])

const ARCHIVE_IPC_LIMITS = Object.freeze({
  missionId: 200,
  archiveId: 200,
  operationId: 36,
  passphrase: 1_024,
  recoveryCode: 64,
  credential: 1_024,
  confirmation: 1_024,
  correctionAdmin: 160,
  correctionReason: 4_000,
  detail: 200,
})
const ARCHIVE_OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const ARCHIVE_RECOVERY_CODE_PATTERN = /^(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/u
const ARCHIVE_PROGRESS_KINDS = new Set(['create', 'verify', 'cleanup'])
const ARCHIVE_PROGRESS_PHASES = new Set([
  'preflight', 'snapshot', 'extract', 'attachments', 'digest', 'encrypt', 'sync',
  'keys', 'decrypt', 'entries', 'sqlite', 'inventory', 'gpx', 'replay',
  'plaintext_cleanup', 'staged', 'publish', 'seal', 'proof', 'verified',
  'cleanup',
])
const ARCHIVE_PROGRESS_UNITS = new Set(['bytes', 'files', 'phases', 'rows', 'tables'])

const REPLAY_IPC_STRING_LIMITS = Object.freeze({
  missionId: 200,
  selectedTime: 64,
  timezone: 64,
  cursor: 2_000,
  objectCursor: 2_000,
})
const REPLAY_IPC_FILTER_LIMIT = 200
const REPLAY_IPC_FILTER_ID_LENGTH = 200
const MUTABLE_EVIDENCE_IPC_STRING_LIMITS = Object.freeze({
  id: 200,
  mission_id: 200,
  type: 120,
  name: 120,
  description: 2_000,
  subject_category: 120,
  clue_type: 120,
  found_by: 120,
  hazard_type: 120,
  severity: 120,
  condition: 120,
  treatment: 512 * 1_024,
  evacuation_priority: 120,
  updated_by: 120,
  coordinator_ids: 2_000,
  attachment_path: 4_096,
  color: 120,
  label: 120,
  geometry_json: 512 * 1_024,
  metadata_json: 512 * 1_024,
})
const MARKER_IPC_STRING_KEYS = Object.freeze([
  'id', 'mission_id', 'type', 'name', 'description', 'subject_category',
  'clue_type', 'found_by', 'hazard_type', 'severity', 'condition', 'treatment',
  'evacuation_priority', 'updated_by', 'coordinator_ids', 'attachment_path',
])
const MARKER_IPC_NUMBER_KEYS = Object.freeze([
  'lat', 'lon', 'irish_grid_e', 'irish_grid_n', 'display_order', 'confidence', 'label_size',
])
const DRAWING_IPC_STRING_KEYS = Object.freeze([
  'id', 'mission_id', 'type', 'name', 'description', 'color', 'label',
  'geometry_json', 'metadata_json',
])
const DRAWING_IPC_NUMBER_KEYS = Object.freeze(['width', 'distance_m', 'display_order'])
const PR5_IPC_STRING_LIMITS = Object.freeze({
  id: 1_000,
  missionId: 1_000,
  importId: 1_000,
  cursor: 2_000,
  mission_id: 200,
  import_id: 1_000,
  outing_id: 200,
  search_area_id: 200,
  assignment_id: 200,
  legacy_drawing_id: 200,
  display_name: 500,
  metadata_json: 512 * 1_024,
  assigned_by: 120,
  name: 120,
  status: 120,
  geometry_json: 512 * 1_024,
  effective_at: 64,
  updated_by: 120,
  team_id: 120,
  notes: 2_000,
  started_at: 64,
  ended_at: 64,
  outcome: 120,
  coordinator_name: 120,
  advisory_coverage_json: 512 * 1_024,
  actor: 120,
  kind: 20,
  search: 120,
})
const PR5_IPC_ID_ARRAY_KEYS = new Set([
  'participant_ids', 'clue_ids', 'track_evidence_ids',
])

/**
 * Copies only the closed, bounded Replay request surface into main-process IPC.
 * Electron sandboxed preloads cannot import local CommonJS modules, so the main
 * process remains the authoritative semantic validator while this boundary
 * prevents unknown or oversized renderer fields from being cloned into main.
 */
function projectReplayQueryForIpc(input, kind) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Mission replay request is invalid.')
  }
  if (!['state', 'chunk', 'objects', 'filters'].includes(kind)) {
    throw new Error('Mission replay request kind is invalid.')
  }

  const projected = {}
  copyReplayString(input, projected, 'missionId')
  copyReplayString(input, projected, 'selectedTime')
  copyReplayString(input, projected, 'timezone')
  copyReplayInteger(input, projected, 'trackLimit')
  copyReplayInteger(input, projected, 'objectLimit')
  copyReplayFilter(input, projected, 'deviceIds')
  copyReplayFilter(input, projected, 'outingIds')

  if (kind === 'chunk') {
    copyReplayString(input, projected, 'cursor')
  } else if (kind === 'objects') {
    copyReplayString(input, projected, 'objectCursor')
    copyReplayInteger(input, projected, 'replayGeneration')
  } else if (kind === 'filters') {
    copyPr5String(input, projected, 'filterKind', 'Replay filter', 20)
    copyPr5String(input, projected, 'filterSearch', 'Replay filter', 120)
    copyPr5String(input, projected, 'filterCursor', 'Replay filter', 2_000)
    copyPr5Integer(input, projected, 'filterLimit', 'Replay filter')
  }
  return projected
}

/** Projects one GPX/Search Operations object through a closed allowlist. */
function projectPr5ObjectForIpc(input, label, stringKeys, integerKeys = [], arrayKeys = []) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${label} input is invalid.`)
  }
  const output = {}
  for (const key of stringKeys) copyPr5String(input, output, key, label)
  for (const key of integerKeys) copyPr5Integer(input, output, key, label)
  for (const key of arrayKeys) copyPr5IdArray(input, output, key, label)
  return output
}

/** Copies one nullable bounded string under its renderer-to-main byte ceiling. */
function copyPr5String(input, output, key, label, explicitLimit) {
  const value = input[key]
  if (value === undefined) return
  if (value === null) {
    output[key] = null
    return
  }
  const maximumLength = explicitLimit ?? PR5_IPC_STRING_LIMITS[key]
  if (!Number.isSafeInteger(maximumLength) || typeof value !== 'string'
    || value.length > maximumLength || mutableEvidenceUtf8Length(value) > maximumLength) {
    throw new Error(`${label} ${evidenceFieldLabel(key)} is invalid.`)
  }
  output[key] = value
}

/** Copies one optional safe integer without renderer coercion. */
function copyPr5Integer(input, output, key, label) {
  const value = input[key]
  if (value === undefined) return
  if (!Number.isSafeInteger(value)) throw new Error(`${label} ${evidenceFieldLabel(key)} is invalid.`)
  output[key] = value
}

/** Copies one bounded identifier list as a fresh small array. */
function copyPr5IdArray(input, output, key, label) {
  const value = input[key]
  if (value === undefined) return
  if (!PR5_IPC_ID_ARRAY_KEYS.has(key) || !Array.isArray(value) || value.length > 200) {
    throw new Error(`${label} ${evidenceFieldLabel(key)} is invalid.`)
  }
  output[key] = value.map((item) => {
    if (typeof item !== 'string' || item.length < 1 || item.length > 200
      || mutableEvidenceUtf8Length(item) > 200) {
      throw new Error(`${label} ${evidenceFieldLabel(key)} is invalid.`)
    }
    return item
  })
}

/** Projects a bounded GPX file import envelope before Electron cloning. */
function projectGpxEvidencePathsForIpc(input) {
  const output = projectPr5ObjectForIpc(input, 'GPX evidence paths', ['missionId'])
  if (!Array.isArray(input.paths) || input.paths.length < 1 || input.paths.length > 100) {
    throw new Error('GPX evidence paths are invalid.')
  }
  output.paths = input.paths.map((entry) => {
    if (typeof entry !== 'string' || entry.length < 1 || entry.length > 4_096
      || mutableEvidenceUtf8Length(entry) > 4_096) {
      throw new Error('GPX evidence paths are invalid.')
    }
    return entry
  })
  return output
}

/** Bounds one standalone renderer-owned identity or path before cloning. */
function projectPr5ScalarForIpc(value, label, maximumLength) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximumLength
    || mutableEvidenceUtf8Length(value) > maximumLength) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

/** Mirrors the main Replay request-ID contract before Electron serializes IPC. */
function projectReplayRequestIdForIpc(value) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 100 ||
    !/^[A-Za-z0-9._:-]+$/u.test(value)
  ) {
    throw new Error('Replay request ID is invalid.')
  }
  return value
}

/** Invokes one Replay read only after projecting every renderer-owned argument. */
function invokeReplayReadForIpc(channel, query, requestId, kind) {
  const projectedRequestId = projectReplayRequestIdForIpc(requestId)
  const projectedQuery = projectReplayQueryForIpc(query, kind)
  return ipcRenderer.invoke(channel, projectedQuery, projectedRequestId)
}

/** Copies one optional Replay string after enforcing its IPC byte-amplification bound. */
function copyReplayString(input, output, key) {
  const value = input[key]
  if (value === undefined) return
  const maximumLength = REPLAY_IPC_STRING_LIMITS[key]
  if (typeof value !== 'string' || value.length > maximumLength
    || mutableEvidenceUtf8Length(value) > maximumLength) {
    throw new Error(`Mission replay ${key} is invalid.`)
  }
  output[key] = value
}

/** Copies one optional Replay integer without accepting coercible renderer values. */
function copyReplayInteger(input, output, key) {
  const value = input[key]
  if (value === undefined) return
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Mission replay ${key} is invalid.`)
  }
  output[key] = value
}

/** Copies one bounded Replay filter as a fresh small array for IPC ownership. */
function copyReplayFilter(input, output, key) {
  const value = input[key]
  if (value === undefined) return
  if (value === null) {
    output[key] = null
    return
  }
  if (!Array.isArray(value) || value.length > REPLAY_IPC_FILTER_LIMIT) {
    throw new Error(`Mission replay ${key} is invalid.`)
  }
  output[key] = value.map((item) => {
    if (typeof item !== 'string' || item.length > REPLAY_IPC_FILTER_ID_LENGTH
      || mutableEvidenceUtf8Length(item) > REPLAY_IPC_FILTER_ID_LENGTH) {
      throw new Error(`Mission replay ${key} is invalid.`)
    }
    return item
  })
}

/** Copies only bounded marker or drawing fields before Electron structured cloning. */
function projectMutableEvidenceForIpc(input, kind) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${kind === 'marker' ? 'Marker' : 'Drawing'} evidence input is invalid.`)
  }
  const output = {}
  const stringKeys = kind === 'marker' ? MARKER_IPC_STRING_KEYS : DRAWING_IPC_STRING_KEYS
  const numberKeys = kind === 'marker' ? MARKER_IPC_NUMBER_KEYS : DRAWING_IPC_NUMBER_KEYS
  for (const key of stringKeys) copyMutableEvidenceString(input, output, key, kind)
  for (const key of numberKeys) copyMutableEvidenceNumber(input, output, key, kind)
  if (kind === 'drawing') {
    const temporaryMeasure = input.temporary_measure
    if (temporaryMeasure !== undefined) {
      if (temporaryMeasure !== null && typeof temporaryMeasure !== 'boolean') {
        throw new Error('Drawing temporary_measure is invalid.')
      }
      output.temporary_measure = temporaryMeasure
    }
  }
  return output
}

/** Bounds one renderer-owned mutable-evidence identity before structured cloning. */
function projectMutableEvidenceIdentityForIpc(value, kind) {
  if (typeof value !== 'string' || value.trim() === ''
    || value.length > MUTABLE_EVIDENCE_IPC_STRING_LIMITS.id
    || mutableEvidenceUtf8Length(value.trim()) > MUTABLE_EVIDENCE_IPC_STRING_LIMITS.id) {
    throw new Error(`${kind === 'marker' ? 'Marker' : 'Drawing'} identity is invalid.`)
  }
  return value.trim()
}

/** Copies one allowlisted evidence string under its renderer-to-main size cap. */
function copyMutableEvidenceString(input, output, key, kind) {
  const value = input[key]
  if (value === undefined) return
  if (value === null) {
    output[key] = null
    return
  }
  const maximumLength = MUTABLE_EVIDENCE_IPC_STRING_LIMITS[key]
  if (typeof value !== 'string' || value.length > maximumLength
    || mutableEvidenceUtf8Length(value.trim()) > maximumLength) {
    throw new Error(`${kind === 'marker' ? 'Marker' : 'Drawing'} ${evidenceFieldLabel(key)} is invalid.`)
  }
  output[key] = value
}

/** Measures renderer evidence bytes without importing Node APIs into the sandboxed preload. */
function mutableEvidenceUtf8Length(value) {
  return new TextEncoder().encode(value).byteLength
}

/** Copies one allowlisted evidence number without renderer coercion. */
function copyMutableEvidenceNumber(input, output, key, kind) {
  const value = input[key]
  if (value === undefined) return
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${kind === 'marker' ? 'Marker' : 'Drawing'} ${evidenceFieldLabel(key)} is invalid.`)
  }
  output[key] = value
}

/** Produces an operator-readable field label without widening the IPC contract. */
function evidenceFieldLabel(key) {
  return key.replaceAll('_', ' ')
}

/** Requires one small archive-boundary string before Electron structured cloning. */
function projectArchiveString(value, label, maximumBytes, options = {}) {
  if (typeof value !== 'string'
    || (!options.allowEmpty && value.length < 1)
    || value.length > maximumBytes
    || mutableEvidenceUtf8Length(value) > maximumBytes
    || /[\u0000-\u001f\u007f]/u.test(value)
    || (options.pattern !== undefined && !options.pattern.test(value))) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

/** Mirrors the main-process passphrase floor without reflecting the secret. */
function projectArchivePassphrase(value) {
  const passphrase = projectArchiveString(
    value,
    'Archive passphrase',
    ARCHIVE_IPC_LIMITS.passphrase,
  )
  const classes = [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[^A-Za-z0-9]/u]
    .filter((pattern) => pattern.test(passphrase)).length
  if (passphrase.length < 14 || classes < 3) {
    throw new Error('Archive passphrase does not meet the required strength floor.')
  }
  return passphrase
}

/** Projects one exact per-archive recovery code before IPC. */
function projectArchiveRecoveryCode(value) {
  return projectArchiveString(
    value,
    'Archive recovery code',
    ARCHIVE_IPC_LIMITS.recoveryCode,
    { pattern: ARCHIVE_RECOVERY_CODE_PATTERN },
  )
}

/** Projects the closed finalization/create request and drops all unknown renderer fields. */
function projectArchiveCreateForIpc(missionId, custody) {
  if (custody === null || typeof custody !== 'object' || Array.isArray(custody)) {
    throw new Error('Mission archive custody input is invalid.')
  }
  return {
    missionId: projectArchiveString(
      missionId,
      'Mission archive mission identity',
      ARCHIVE_IPC_LIMITS.missionId,
    ),
    operationId: projectArchiveString(
      custody.operationId,
      'Mission archive operation identity',
      ARCHIVE_IPC_LIMITS.operationId,
      { pattern: ARCHIVE_OPERATION_ID_PATTERN },
    ),
    passphrase: projectArchivePassphrase(custody.passphrase),
    recoveryCode: projectArchiveRecoveryCode(custody.recoveryCode),
  }
}

/** Projects the bounded administrative correction unlock request before IPC. */
function projectArchiveCorrectionUnlockForIpc(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'admin_name,mission_id,reason') {
    throw new Error('Mission correction unlock input is invalid.')
  }
  const reason = input.reason
  if (typeof reason !== 'string'
    || reason.trim() === ''
    || mutableEvidenceUtf8Length(reason) > ARCHIVE_IPC_LIMITS.correctionReason
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(reason)) {
    throw new Error('Mission correction reason is invalid.')
  }
  const adminName = projectArchiveString(
    input.admin_name,
    'Mission correction authority',
    ARCHIVE_IPC_LIMITS.correctionAdmin,
  ).trim()
  if (adminName === '') throw new Error('Mission correction authority is invalid.')
  return {
    mission_id: projectArchiveString(
      input.mission_id,
      'Mission correction mission identity',
      ARCHIVE_IPC_LIMITS.missionId,
    ),
    admin_name: adminName,
    reason: reason.trim(),
  }
}

/** Projects one independent verification request without a generic argument bridge. */
function projectArchiveVerifyForIpc(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Mission archive verification input is invalid.')
  }
  return {
    archiveId: projectArchiveString(
      input.archiveId,
      'Mission archive identity',
      ARCHIVE_IPC_LIMITS.archiveId,
    ),
    operationId: projectArchiveString(
      input.operationId,
      'Mission archive operation identity',
      ARCHIVE_IPC_LIMITS.operationId,
      { pattern: ARCHIVE_OPERATION_ID_PATTERN },
    ),
    passphrase: projectArchivePassphrase(input.passphrase),
    recoveryCode: projectArchiveRecoveryCode(input.recoveryCode),
  }
}

/** Projects the non-secret cleanup checklist request and drops unknown renderer fields. */
function projectArchiveCleanupEligibilityForIpc(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Mission cleanup eligibility input is invalid.')
  }
  return {
    missionId: projectArchiveString(
      input.missionId,
      'Mission cleanup mission identity',
      ARCHIVE_IPC_LIMITS.missionId,
    ),
    archiveId: projectArchiveString(
      input.archiveId,
      'Mission cleanup archive identity',
      ARCHIVE_IPC_LIMITS.archiveId,
    ),
  }
}

/** Projects one bounded operator-confirmed cleanup request before structured cloning. */
function projectArchiveCleanupStartForIpc(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Mission cleanup input is invalid.')
  }
  if (input.slotType !== 'passphrase' && input.slotType !== 'recovery') {
    throw new Error('Mission cleanup credential type is invalid.')
  }
  return {
    missionId: projectArchiveString(
      input.missionId,
      'Mission cleanup mission identity',
      ARCHIVE_IPC_LIMITS.missionId,
    ),
    archiveId: projectArchiveString(
      input.archiveId,
      'Mission cleanup archive identity',
      ARCHIVE_IPC_LIMITS.archiveId,
    ),
    operationId: projectArchiveString(
      input.operationId,
      'Mission cleanup operation identity',
      ARCHIVE_IPC_LIMITS.operationId,
      { pattern: ARCHIVE_OPERATION_ID_PATTERN },
    ),
    slotType: input.slotType,
    secret: input.slotType === 'passphrase'
      ? projectArchivePassphrase(input.secret)
      : projectArchiveRecoveryCode(input.secret),
    confirmation: projectArchiveString(
      input.confirmation,
      'Mission cleanup confirmation',
      ARCHIVE_IPC_LIMITS.confirmation,
    ),
  }
}

/** Projects one bounded durable cleanup-resume request before structured cloning. */
function projectArchiveCleanupResumeForIpc(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Mission cleanup resume input is invalid.')
  }
  return {
    missionId: projectArchiveString(
      input.missionId,
      'Mission cleanup mission identity',
      ARCHIVE_IPC_LIMITS.missionId,
    ),
    archiveId: projectArchiveString(
      input.archiveId,
      'Mission cleanup archive identity',
      ARCHIVE_IPC_LIMITS.archiveId,
    ),
    operationId: projectArchiveString(
      input.operationId,
      'Mission cleanup operation identity',
      ARCHIVE_IPC_LIMITS.operationId,
      { pattern: ARCHIVE_OPERATION_ID_PATTERN },
    ),
  }
}

/** Projects a main-to-renderer archive update before any listener sees it. */
function projectArchiveProgressForRenderer(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || !ARCHIVE_PROGRESS_KINDS.has(input.kind)
    || !ARCHIVE_PROGRESS_PHASES.has(input.phase)
    || !ARCHIVE_PROGRESS_UNITS.has(input.unit)
    || !Number.isSafeInteger(input.sequence) || input.sequence < 1
    || !Number.isSafeInteger(input.completed) || input.completed < 0
    || (input.total !== null && (!Number.isSafeInteger(input.total)
      || input.total < input.completed))) {
    throw new Error('Mission archive progress is invalid.')
  }
  return {
    operationId: projectArchiveString(
      input.operationId,
      'Mission archive progress operation identity',
      ARCHIVE_IPC_LIMITS.operationId,
      { pattern: ARCHIVE_OPERATION_ID_PATTERN },
    ),
    missionId: projectArchiveString(
      input.missionId,
      'Mission archive progress mission identity',
      ARCHIVE_IPC_LIMITS.missionId,
      { allowEmpty: input.kind === 'verify' },
    ),
    kind: input.kind,
    sequence: input.sequence,
    phase: input.phase,
    unit: input.unit,
    completed: input.completed,
    total: input.total,
    detail: projectArchiveString(
      input.detail,
      'Mission archive progress detail',
      ARCHIVE_IPC_LIMITS.detail,
      { allowEmpty: true },
    ),
  }
}

const ARCHIVE_REVIEW_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const ARCHIVE_REVIEW_READ_METHODS = new Set([
  'info',
  'listMissions',
  'readMissionReview',
  'cancelMissionReviewRead',
  'readMissionReplay',
  'readMissionReplayTrackChunk',
  'readMissionReplayObjectChunk',
  'readMissionReplayFilterPage',
  'cancelMissionReplay',
  'listMarkers',
  'listDevices',
  'listDrawings',
  'listHelicopters',
  'listGpxImports',
  'listGpxImportPage',
  'listSearchOperationPage',
  'listOutings',
  'listLayerCatalogMetadata',
  'listArchiveAttachmentPage',
  'openAttachment',
  'recordMutationDenied',
])
const ARCHIVE_REVIEW_PROGRESS_PHASES = new Set([
  'preflight', 'keys', 'ciphertext', 'decrypt', 'extract', 'migrate',
  'metadata', 'database', 'validate', 'attachments', 'ready',
])
const ARCHIVE_REVIEW_PROGRESS_UNITS = new Set(['bytes', 'files', 'phases', 'rows', 'tables'])
const ARCHIVE_REVIEW_FORBIDDEN_RESULT_KEYS = new Set([
  'databasePath', 'sessionDirectory', 'scratchPath', 'secret', 'secretBytes',
  'passphrase', 'recoveryCode', 'workerData',
])

/** Requires one plain renderer-owned object without walking unknown fields. */
function requireArchiveReviewObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Archive review input is invalid.')
  }
  return value
}

/** Bounds one archive-review identity before Electron structured cloning. */
function projectArchiveReviewIdentity(value, label, uuid = false) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200
    || mutableEvidenceUtf8Length(value) > 200
    || /[\u0000-\u001f\u007f]/u.test(value)
    || (uuid && !ARCHIVE_REVIEW_UUID_V4.test(value))) {
    throw new Error(`Archive review ${label} is invalid.`)
  }
  return value
}

/** Projects the exact discriminated legacy-v1 or encrypted-v2 open request. */
function projectArchiveReviewOpenForIpc(value) {
  const input = requireArchiveReviewObject(value)
  const operationId = projectArchiveReviewIdentity(input.operationId, 'operation identity', true)
  const archiveId = projectArchiveReviewIdentity(input.archiveId, 'archive identity')
  if (input.containerVersion === 1) {
    if (Object.prototype.hasOwnProperty.call(input, 'slotType')
      || Object.prototype.hasOwnProperty.call(input, 'secret')) {
      throw new Error('Archive review legacy input cannot contain a credential.')
    }
    return { operationId, archiveId, containerVersion: 1 }
  }
  if (input.containerVersion !== 2
    || !['passphrase', 'recovery'].includes(input.slotType)) {
    throw new Error('Archive review encrypted input is invalid.')
  }
  let secret
  try {
    secret = input.slotType === 'passphrase'
      ? projectArchivePassphrase(input.secret)
      : projectArchiveRecoveryCode(input.secret)
  } catch {
    throw new Error('Archive review encrypted input is invalid.')
  }
  return {
    operationId,
    archiveId,
    containerVersion: 2,
    slotType: input.slotType,
    secret,
  }
}

/** Screens an arbitrary read result for private main-process fields. */
function assertArchiveReviewResultSafe(value, seen = new Set()) {
  if (typeof value === 'string') {
    if (value.length > 8 * 1024 * 1024) {
      throw new Error('Archive review result exceeds its safe boundary.')
    }
    return
  }
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) throw new Error('Archive review result is invalid.')
  seen.add(value)
  for (const [key, child] of Object.entries(value)) {
    if (ARCHIVE_REVIEW_FORBIDDEN_RESULT_KEYS.has(key)) {
      throw new Error('Archive review result contains private runtime state.')
    }
    assertArchiveReviewResultSafe(child, seen)
  }
  seen.delete(value)
}

/** Shape-closes and validates one path-free archive-review open result. */
function projectArchiveReviewSessionForRenderer(value, request) {
  const input = requireArchiveReviewObject(value)
  const result = {
    operationId: projectArchiveReviewIdentity(input.operationId, 'operation result', true),
    sessionId: projectArchiveReviewIdentity(input.sessionId, 'session result', true),
    archiveId: projectArchiveReviewIdentity(input.archiveId, 'archive result'),
    missionId: projectArchiveReviewIdentity(input.missionId, 'mission result'),
    containerVersion: input.containerVersion,
    encrypted: input.encrypted,
    verified: input.verified,
    immutable: input.immutable,
    ciphertextSha256: input.ciphertextSha256,
    previousArchiveId: input.previousArchiveId,
    openedAt: input.openedAt,
    plaintextResidual: input.plaintextResidual,
  }
  if (result.operationId !== request.operationId
    || result.archiveId !== request.archiveId
    || result.containerVersion !== request.containerVersion
    || result.immutable !== true
    || result.plaintextResidual !== 'permission_restricted_session_open'
    || typeof result.openedAt !== 'string'
    || Number.isNaN(Date.parse(result.openedAt))
    || (result.previousArchiveId !== null
      && (typeof result.previousArchiveId !== 'string'
        || result.previousArchiveId.length > 200))
    || (result.ciphertextSha256 !== null
      && (typeof result.ciphertextSha256 !== 'string'
        || !/^[0-9a-f]{64}$/u.test(result.ciphertextSha256)))
    || (result.containerVersion === 2
      && (result.encrypted !== true || result.verified !== true
        || result.ciphertextSha256 === null))
    || (result.containerVersion === 1
      && (result.encrypted !== false || result.verified !== false
        || result.ciphertextSha256 !== null))) {
    throw new Error('Archive review result is invalid or request-mismatched.')
  }
  return result
}

/** Measures a cloned read input with an early limit before IPC. */
function assertArchiveReviewInputBudget(value, budget = { bytes: 0 }, seen = new Set()) {
  if (typeof value === 'string') {
    if (value.length > 256 * 1024) throw new Error('Archive review read input is too large.')
    budget.bytes += mutableEvidenceUtf8Length(value)
  } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    budget.bytes += 16
  } else if (Array.isArray(value)) {
    if (value.length > 10_000) throw new Error('Archive review read input is too large.')
    if (seen.has(value)) throw new Error('Archive review read input is invalid.')
    seen.add(value)
    for (const entry of value) assertArchiveReviewInputBudget(entry, budget, seen)
    seen.delete(value)
  } else if (value !== null && typeof value === 'object') {
    if (seen.has(value)) throw new Error('Archive review read input is invalid.')
    seen.add(value)
    const entries = Object.entries(value)
    if (entries.length > 100) throw new Error('Archive review read input is invalid.')
    for (const [key, child] of entries) {
      budget.bytes += key.length
      assertArchiveReviewInputBudget(child, budget, seen)
    }
    seen.delete(value)
  } else {
    throw new Error('Archive review read input is invalid.')
  }
  if (budget.bytes > 256 * 1024) throw new Error('Archive review read input is too large.')
}

/** Requires one bounded archive-review text field before Electron can clone it. */
function projectArchiveReviewText(value, label, maximumBytes, options = {}) {
  const allowEmpty = options.allowEmpty === true
  if (typeof value !== 'string'
    || (!allowEmpty && value.length < 1)
    || mutableEvidenceUtf8Length(value) > maximumBytes
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`Archive review ${label} is invalid.`)
  }
  return value
}

/** Requires one bounded safe integer field. */
function projectArchiveReviewInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Archive review ${label} is invalid.`)
  }
  return value
}

/** Requires one nullable bounded cursor without accepting binary structured-clone values. */
function projectArchiveReviewCursor(value, label) {
  if (value === undefined) return undefined
  if (value === null) return null
  return projectArchiveReviewText(value, label, 2_048, { allowEmpty: true })
}

/** Requires one bounded array of identifiers rather than a binary view. */
function projectArchiveReviewFilterIds(value, label) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (!Array.isArray(value) || value.length > 200) {
    throw new Error(`Archive review ${label} is invalid.`)
  }
  return value.map((entry) => projectArchiveReviewText(entry, label, 200))
}

/** Adds one optional projected field without reading any undeclared renderer property. */
function addArchiveReviewOptional(result, input, key, project) {
  if (Object.prototype.hasOwnProperty.call(input, key)) result[key] = project(input[key])
}

/** Projects and type-checks every declared field for one closed read method. */
function projectArchiveReviewMethodInput(method, input) {
  const result = {}
  if (method === 'info' || method === 'listMissions') return result
  if (method === 'recordMutationDenied') {
    result.attemptedMethod = projectArchiveReviewText(
      input.attemptedMethod,
      'attempted method',
      100,
    )
    return result
  }
  if (method === 'cancelMissionReviewRead' || method === 'cancelMissionReplay') {
    result.requestId = projectArchiveReviewIdentity(input.requestId, 'request identity', true)
    return result
  }
  if (method === 'readMissionReview') {
    result.missionId = projectArchiveReviewIdentity(input.missionId, 'mission identity')
    if (typeof input.includeTelemetry !== 'boolean') {
      throw new Error('Archive review telemetry selection is invalid.')
    }
    result.includeTelemetry = input.includeTelemetry
    result.auditLimit = projectArchiveReviewInteger(input.auditLimit, 'audit limit', 1, 5_001)
    return result
  }
  if (method.startsWith('readMissionReplay')) {
    result.missionId = projectArchiveReviewIdentity(input.missionId, 'mission identity')
    result.selectedTime = projectArchiveReviewText(input.selectedTime, 'selected time', 64)
    addArchiveReviewOptional(result, input, 'timezone', (value) => {
      if (value !== 'Europe/Dublin') throw new Error('Archive review timezone is invalid.')
      return value
    })
    result.trackLimit = projectArchiveReviewInteger(input.trackLimit, 'track limit', 1, 1_000)
    addArchiveReviewOptional(result, input, 'objectLimit', (value) =>
      projectArchiveReviewInteger(value, 'object limit', 1, 100))
    addArchiveReviewOptional(result, input, 'deviceIds', (value) =>
      projectArchiveReviewFilterIds(value, 'device filters'))
    addArchiveReviewOptional(result, input, 'outingIds', (value) =>
      projectArchiveReviewFilterIds(value, 'outing filters'))
    if (method === 'readMissionReplayTrackChunk') {
      addArchiveReviewOptional(result, input, 'cursor', (value) =>
        projectArchiveReviewCursor(value, 'track cursor'))
    } else if (method === 'readMissionReplayObjectChunk') {
      addArchiveReviewOptional(result, input, 'objectCursor', (value) =>
        projectArchiveReviewCursor(value, 'object cursor'))
      result.replayGeneration = projectArchiveReviewInteger(
        input.replayGeneration,
        'replay generation',
        0,
        Number.MAX_SAFE_INTEGER,
      )
    } else if (method === 'readMissionReplayFilterPage') {
      if (input.filterKind !== 'outing') throw new Error('Archive review filter kind is invalid.')
      result.filterKind = 'outing'
      addArchiveReviewOptional(result, input, 'filterSearch', (value) => {
        if (value === null) return null
        return projectArchiveReviewText(value, 'filter search', 120, { allowEmpty: true })
      })
      addArchiveReviewOptional(result, input, 'filterCursor', (value) =>
        projectArchiveReviewCursor(value, 'filter cursor'))
      addArchiveReviewOptional(result, input, 'filterLimit', (value) =>
        projectArchiveReviewInteger(value, 'filter limit', 1, 100))
    }
    return result
  }
  if (['listMarkers', 'listDevices', 'listDrawings', 'listHelicopters',
    'listGpxImports', 'listOutings', 'listLayerCatalogMetadata'].includes(method)) {
    result.missionId = projectArchiveReviewIdentity(input.missionId, 'mission identity')
    return result
  }
  if (method === 'listGpxImportPage') {
    result.missionId = projectArchiveReviewIdentity(input.missionId, 'mission identity')
    addArchiveReviewOptional(result, input, 'cursor', (value) =>
      projectArchiveReviewCursor(value, 'GPX cursor'))
    result.limit = projectArchiveReviewInteger(input.limit, 'GPX limit', 1, 100)
    return result
  }
  if (method === 'listSearchOperationPage') {
    result.missionId = projectArchiveReviewIdentity(input.missionId, 'mission identity')
    if (!['areas', 'assignments', 'outings', 'passes'].includes(input.kind)) {
      throw new Error('Archive review search kind is invalid.')
    }
    result.kind = input.kind
    addArchiveReviewOptional(result, input, 'search', (value) => {
      if (value === null) return null
      return projectArchiveReviewText(value, 'search text', 120, { allowEmpty: true })
    })
    addArchiveReviewOptional(result, input, 'cursor', (value) =>
      projectArchiveReviewCursor(value, 'search cursor'))
    addArchiveReviewOptional(result, input, 'limit', (value) =>
      projectArchiveReviewInteger(value, 'search limit', 1, 50))
    return result
  }
  if (method === 'listArchiveAttachmentPage') {
    result.missionId = projectArchiveReviewIdentity(input.missionId, 'mission identity')
    result.cursor = projectArchiveReviewCursor(input.cursor, 'attachment cursor')
    result.limit = projectArchiveReviewInteger(input.limit, 'attachment limit', 1, 100)
    return result
  }
  if (method === 'openAttachment') {
    result.missionId = projectArchiveReviewIdentity(input.missionId, 'mission identity')
    result.attachmentPath = projectArchiveReviewText(
      input.attachmentPath,
      'attachment identity',
      4_096,
    )
    result.referenceKind = projectArchiveReviewText(
      input.referenceKind,
      'attachment reference kind',
      100,
    )
    result.referenceId = projectArchiveReviewIdentity(
      input.referenceId,
      'attachment reference identity',
    )
    return result
  }
  throw new Error('Archive review is read-only and the requested method is unavailable.')
}

/** Copies only declared keys for one fixed read method. */
function projectArchiveReviewReadForIpc(value) {
  const input = requireArchiveReviewObject(value)
  const sessionId = projectArchiveReviewIdentity(input.sessionId, 'session identity', true)
  const requestId = projectArchiveReviewIdentity(input.requestId, 'request identity', true)
  if (typeof input.method !== 'string' || input.method.length > 100
    || !ARCHIVE_REVIEW_READ_METHODS.has(input.method)) {
    throw new Error('Archive review is read-only and the requested method is unavailable.')
  }
  const methodInput = requireArchiveReviewObject(input.input)
  const projectedInput = projectArchiveReviewMethodInput(input.method, methodInput)
  assertArchiveReviewInputBudget(projectedInput)
  return { sessionId, requestId, method: input.method, input: projectedInput }
}

/** Bounds one arbitrary read result after main returns. */
function projectArchiveReviewReadResultForRenderer(value) {
  assertArchiveReviewResultSafe(value)
  let serialized
  try { serialized = JSON.stringify(value) } catch {
    throw new Error('Archive review result is invalid.')
  }
  if (serialized === undefined || serialized.length > 8 * 1024 * 1024
    || mutableEvidenceUtf8Length(serialized) > 8 * 1024 * 1024) {
    throw new Error('Archive review result exceeds its safe boundary.')
  }
  return value
}

/** Projects one main-to-renderer archive-review restore update. */
function projectArchiveReviewProgressForRenderer(value) {
  const input = requireArchiveReviewObject(value)
  if (![1, 2].includes(input.containerVersion)
    || !Number.isSafeInteger(input.sequence) || input.sequence < 1
    || !ARCHIVE_REVIEW_PROGRESS_PHASES.has(input.phase)
    || !ARCHIVE_REVIEW_PROGRESS_UNITS.has(input.unit)
    || !Number.isSafeInteger(input.completed) || input.completed < 0
    || (input.total !== null && (!Number.isSafeInteger(input.total)
      || input.total < input.completed))
    || typeof input.detail !== 'string'
    || input.detail.length > 200
    || mutableEvidenceUtf8Length(input.detail) > 200) {
    throw new Error('Archive review progress is invalid.')
  }
  return {
    operationId: projectArchiveReviewIdentity(input.operationId, 'progress operation', true),
    archiveId: projectArchiveReviewIdentity(input.archiveId, 'progress archive'),
    containerVersion: input.containerVersion,
    sequence: input.sequence,
    phase: input.phase,
    unit: input.unit,
    completed: input.completed,
    total: input.total,
    detail: input.detail,
  }
}

// Electron main owns every unload. This synchronous fence converts direct
// reload/menu/close attempts into `will-prevent-unload`, where main can wait for
// rejected-position evidence to drain before explicitly allowing the unload.
window.addEventListener('beforeunload', (event) => {
  event.preventDefault()
  event.returnValue = false
})

contextBridge.exposeInMainWorld('sartrackerElectron', {
  loadAppSettings() {
    return ipcRenderer.invoke(LOAD_SETTINGS_CHANNEL)
  },
  saveAppSettings(input) {
    return ipcRenderer.invoke(SAVE_SETTINGS_CHANNEL, input)
  },
  testTrackingConnection(input) {
    return ipcRenderer.invoke(TEST_TRACKING_CONNECTION_CHANNEL, input)
  },
  loadRuntimeBootstrapSettings(forceConnect) {
    return ipcRenderer.invoke(LOAD_RUNTIME_BOOTSTRAP_CHANNEL, forceConnect)
  },
  readTrackingCache() {
    return ipcRenderer.invoke(READ_TRACKING_CACHE_CHANNEL)
  },
  writeTrackingCache(contents) {
    return ipcRenderer.invoke(WRITE_TRACKING_CACHE_CHANNEL, contents)
  },
  exportDiagnosticsReport(input) {
    return ipcRenderer.invoke(EXPORT_DIAGNOSTICS_REPORT_CHANNEL, input)
  },
  exportSupportBundle(input) {
    return ipcRenderer.invoke(EXPORT_SUPPORT_BUNDLE_CHANNEL, input)
  },
  readCrashRecoveryState() {
    return ipcRenderer.invoke(READ_CRASH_RECOVERY_STATE_CHANNEL)
  },
  recordDiagnosticEvent(input) {
    return ipcRenderer.invoke(RECORD_DIAGNOSTIC_EVENT_CHANNEL, input)
  },
  chooseGpxFilePaths() {
    return ipcRenderer.invoke(CHOOSE_GPX_FILE_PATHS_CHANNEL)
  },
  chooseGpxDirectoryPath() {
    return ipcRenderer.invoke(CHOOSE_GPX_DIRECTORY_PATH_CHANNEL)
  },
  chooseOfficialMapSourceFilePath() {
    return ipcRenderer.invoke(CHOOSE_OFFICIAL_MAP_SOURCE_FILE_PATH_CHANNEL)
  },
  chooseOfficialMapPackagePath() {
    return ipcRenderer.invoke(CHOOSE_OFFICIAL_MAP_PACKAGE_PATH_CHANNEL)
  },
  importOfficialMapPackage(input) {
    return ipcRenderer.invoke(IMPORT_OFFICIAL_MAP_PACKAGE_CHANNEL, input)
  },
  listGpxDirectoryPaths(directoryPath) {
    return ipcRenderer.invoke(
      LIST_GPX_DIRECTORY_PATHS_CHANNEL,
      projectPr5ScalarForIpc(directoryPath, 'GPX directory path', 4_096),
    )
  },
  ingestMarkerAttachment(input) {
    return ipcRenderer.invoke(INGEST_MARKER_ATTACHMENT_CHANNEL, input)
  },
  openExternalPath(path) {
    return ipcRenderer.invoke(OPEN_EXTERNAL_PATH_CHANNEL, path)
  },
  openExternalUrl(url) {
    return ipcRenderer.invoke(OPEN_EXTERNAL_URL_CHANNEL, url)
  },
  fetchOfficialMapTile(url) {
    return ipcRenderer.invoke(FETCH_OFFICIAL_MAP_TILE_CHANNEL, url)
  },
  onCoverageChanged(listener) {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on(COVERAGE_CHANGED_CHANNEL, handler)
    return () => ipcRenderer.removeListener(COVERAGE_CHANGED_CHANNEL, handler)
  },
  onCoverageRendererFailed(listener) {
    const handler = () => listener()
    ipcRenderer.on(COVERAGE_RENDERER_FAILED_CHANNEL, handler)
    return () => ipcRenderer.removeListener(COVERAGE_RENDERER_FAILED_CHANNEL, handler)
  },
  onMissionArchiveProgress(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Mission archive progress listener is invalid.')
    }
    const handler = (_event, input) => listener(projectArchiveProgressForRenderer(input))
    ipcRenderer.on(MISSION_ARCHIVE_PROGRESS_CHANNEL, handler)
    return () => ipcRenderer.removeListener(MISSION_ARCHIVE_PROGRESS_CHANNEL, handler)
  },
  onAppRuntimeTeardownRequested(listener) {
    const handler = (_event, input) => listener(input)
    ipcRenderer.on(RENDERER_TEARDOWN_REQUEST_CHANNEL, handler)
    return () => ipcRenderer.removeListener(RENDERER_TEARDOWN_REQUEST_CHANNEL, handler)
  },
  acknowledgeAppRuntimeTeardown(input) {
    ipcRenderer.send(RENDERER_TEARDOWN_READY_CHANNEL, input)
  },
  archiveReview: Object.freeze({
    open(input) {
      const request = projectArchiveReviewOpenForIpc(input)
      return ipcRenderer.invoke(ARCHIVE_REVIEW_CHANNELS.open, request)
        .then((result) => projectArchiveReviewSessionForRenderer(result, request))
    },
    close(input) {
      const value = requireArchiveReviewObject(input)
      const request = {
        sessionId: projectArchiveReviewIdentity(value.sessionId, 'session identity', true),
      }
      return ipcRenderer.invoke(ARCHIVE_REVIEW_CHANNELS.close, request)
    },
    cancel(input) {
      const value = requireArchiveReviewObject(input)
      const request = {
        operationId: projectArchiveReviewIdentity(value.operationId, 'operation identity', true),
      }
      return ipcRenderer.invoke(ARCHIVE_REVIEW_CHANNELS.cancel, request)
    },
    read(input) {
      const request = projectArchiveReviewReadForIpc(input)
      if (request.method === 'recordMutationDenied') {
        const result = ipcRenderer.sendSync(ARCHIVE_REVIEW_CHANNELS.mutationDenied, {
          sessionId: request.sessionId,
          requestId: request.requestId,
          attemptedMethod: request.input.attemptedMethod,
        })
        if (result?.ok !== true || Object.keys(result).sort().join(',') !== 'ok') {
          throw new Error('Archive review mutation denial audit failed safely.')
        }
        return Promise.resolve(true)
      }
      return ipcRenderer.invoke(ARCHIVE_REVIEW_CHANNELS.read, request)
        .then(projectArchiveReviewReadResultForRenderer)
    },
    onProgress(listener) {
      if (typeof listener !== 'function') {
        throw new Error('Archive review progress listener is invalid.')
      }
      const handler = (_event, input) => listener(projectArchiveReviewProgressForRenderer(input))
      ipcRenderer.on(ARCHIVE_REVIEW_PROGRESS_CHANNEL, handler)
      return () => ipcRenderer.removeListener(ARCHIVE_REVIEW_PROGRESS_CHANNEL, handler)
    },
  }),
  missionStore: Object.fromEntries(
    [
      ...Object.entries(MISSION_STORE_CHANNELS)
        .filter(([methodName]) => !REPLAY_STORE_METHODS.has(methodName)
          && !BOUNDED_EVIDENCE_STORE_METHODS.has(methodName)
          && !ARCHIVE_STORE_METHODS.has(methodName))
        .map(([methodName, channel]) => [
          methodName,
          (...args) => ipcRenderer.invoke(channel, ...args),
        ]),
      ['readMissionReplay', (query, requestId) => invokeReplayReadForIpc(
        MISSION_STORE_CHANNELS.readMissionReplay,
        query,
        requestId,
        'state',
      )],
      ['readMissionReplayTrackChunk', (query, requestId) => invokeReplayReadForIpc(
        MISSION_STORE_CHANNELS.readMissionReplayTrackChunk,
        query,
        requestId,
        'chunk',
      )],
      ['readMissionReplayObjectChunk', (query, requestId) => invokeReplayReadForIpc(
        MISSION_STORE_CHANNELS.readMissionReplayObjectChunk,
        query,
        requestId,
        'objects',
      )],
      ['readMissionReplayFilterPage', (query, requestId) => invokeReplayReadForIpc(
        MISSION_STORE_CHANNELS.readMissionReplayFilterPage,
        query,
        requestId,
        'filters',
      )],
      ['cancelMissionReplay', (requestId) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.cancelMissionReplay,
        projectReplayRequestIdForIpc(requestId),
      )],
      ['issueMissionArchiveRecoveryCode', (missionId) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.issueMissionArchiveRecoveryCode,
        projectArchiveString(
          missionId,
          'Mission archive mission identity',
          ARCHIVE_IPC_LIMITS.missionId,
        ),
      )],
      ['finalizeMission', (missionId, custody) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.finalizeMission,
        projectArchiveCreateForIpc(missionId, custody),
      )],
      ['unlockFinalizedMission', (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.unlockFinalizedMission,
        projectArchiveCorrectionUnlockForIpc(input),
      )],
      ['listMissionArchives', (missionId) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.listMissionArchives,
        projectArchiveString(
          missionId,
          'Mission archive mission identity',
          ARCHIVE_IPC_LIMITS.missionId,
        ),
      )],
      ['verifyMissionArchive', (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.verifyMissionArchive,
        projectArchiveVerifyForIpc(input),
      )],
      ['getMissionCleanupEligibility', (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.getMissionCleanupEligibility,
        projectArchiveCleanupEligibilityForIpc(input),
      )],
      ['startMissionCleanup', (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.startMissionCleanup,
        projectArchiveCleanupStartForIpc(input),
      )],
      ['resumeMissionCleanup', (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.resumeMissionCleanup,
        projectArchiveCleanupResumeForIpc(input),
      )],
      ['cancelMissionArchiveOperation', (operationId) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.cancelMissionArchiveOperation,
        projectArchiveString(
          operationId,
          'Mission archive operation identity',
          ARCHIVE_IPC_LIMITS.operationId,
          { pattern: ARCHIVE_OPERATION_ID_PATTERN },
        ),
      )],
      ['upsertMarker', async (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.upsertMarker,
        projectMutableEvidenceForIpc(input, 'marker'),
      )],
      ['upsertDrawing', async (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.upsertDrawing,
        projectMutableEvidenceForIpc(input, 'drawing'),
      )],
      ['deleteMarker', async (markerId) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.deleteMarker,
        projectMutableEvidenceIdentityForIpc(markerId, 'marker'),
      )],
      ['deleteDrawing', async (drawingId) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.deleteDrawing,
        projectMutableEvidenceIdentityForIpc(drawingId, 'drawing'),
      )],
      ['assignGpxImportToOuting', async (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.assignGpxImportToOuting,
        projectPr5ObjectForIpc(
          input, 'GPX outing assignment', ['import_id', 'outing_id', 'assigned_by'],
        ),
      )],
      ['listGpxImportPage', async (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.listGpxImportPage,
        projectPr5ObjectForIpc(input, 'GPX import page', ['missionId', 'cursor'], ['limit']),
      )],
      ['listGpxImportIssues', async (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.listGpxImportIssues,
        projectPr5ObjectForIpc(input, 'GPX import issues', ['missionId', 'cursor'], ['limit']),
      )],
      ['deleteGpxImport', async (importId) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.deleteGpxImport,
        projectPr5ScalarForIpc(importId, 'GPX import identity', 1_000),
      )],
      ['listGpxImportRevisionPage', async (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.listGpxImportRevisionPage,
        projectPr5ObjectForIpc(input, 'GPX revision page', ['importId', 'cursor'], ['limit']),
      )],
      ['importGpxEvidencePaths', async (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.importGpxEvidencePaths,
        projectGpxEvidencePathsForIpc(input),
      )],
      ['updateGpxImportPresentation', async (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.updateGpxImportPresentation,
        projectPr5ObjectForIpc(
          input, 'GPX presentation', ['id', 'mission_id', 'display_name', 'metadata_json'],
        ),
      )],
      ['upsertSearchArea', async (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.upsertSearchArea,
        projectPr5ObjectForIpc(input, 'Search area', [
          'id', 'mission_id', 'name', 'status', 'geometry_json',
          'legacy_drawing_id', 'effective_at', 'updated_by',
        ]),
      )],
      ['retireSearchArea', async (areaId, actor) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.retireSearchArea,
        projectPr5ScalarForIpc(areaId, 'Search area identity', 200),
        projectPr5ObjectForIpc({ actor }, 'Search area retirement', ['actor']).actor,
      )],
      ['upsertSearchAssignment', async (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.upsertSearchAssignment,
        projectPr5ObjectForIpc(input, 'Search assignment', [
          'id', 'mission_id', 'search_area_id', 'outing_id', 'team_id',
          'notes', 'effective_at', 'updated_by',
        ], [], ['participant_ids']),
      )],
      ['upsertSearchPass', async (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.upsertSearchPass,
        projectPr5ObjectForIpc(input, 'Search pass', [
          'id', 'mission_id', 'search_area_id', 'assignment_id', 'started_at',
          'ended_at', 'outcome', 'notes', 'coordinator_name', 'advisory_coverage_json',
        ], [], ['participant_ids', 'clue_ids', 'track_evidence_ids']),
      )],
      ['listSearchOperationPage', async (input) => ipcRenderer.invoke(
        MISSION_STORE_CHANNELS.listSearchOperationPage,
        projectPr5ObjectForIpc(
          input, 'Search Operations page', ['missionId', 'kind', 'search', 'cursor'], ['limit'],
        ),
      )],
    ],
  ),
  layerCatalogStore: Object.fromEntries(
    Object.entries(LAYER_CATALOG_STORE_CHANNELS).map(([methodName, channel]) => [
      methodName,
      (...args) => ipcRenderer.invoke(channel, ...args),
    ]),
  ),
  traccarHttpRequest(input) {
    return ipcRenderer.invoke(TRACCAR_REQUEST_CHANNEL, input)
  },
})
