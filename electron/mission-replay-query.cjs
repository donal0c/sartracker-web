const { createHash } = require('node:crypto')

const MAX_REPLAY_TRACK_LIMIT = 1_000
const MAX_REPLAY_OBJECT_LIMIT = 100
const MAX_REPLAY_OBJECT_STATE_BYTES = 4_096
const MAX_REPLAY_CURSOR_OFFSET = 10_000_000

/** Builds the deterministic metadata snapshot and first bounded exact-track page for data known at T. */
function readMissionReplayState(database, input) {
  const normalized = normalizeReplayInput(input)
  const objectResult = readObjectRows(database, normalized, 0)
  const trackResult = readTrackRows(database, normalized, 0)
  const staticGpxEvidence = readStaticGpxEvidence(database, normalized)
  const limitations = readReplayLimitations(
    database,
    normalized,
    trackResult.staticGpxPointCount,
    objectResult.summarizedObjectCount,
    trackResult.positionStats,
  )
  return {
    missionId: normalized.missionId,
    selectedTime: normalized.selectedTime,
    timezone: normalized.timezone,
    objects: objectResult.objects,
    totalObjectCount: objectResult.totalObjectCount,
    objectCursor: '0',
    nextObjectCursor: objectResult.nextObjectCursor,
    missionLifecycle: readMissionLifecycle(database, normalized),
    participants: readMissionParticipants(database, normalized),
    groupMembership: readMissionGroupMembership(database, normalized),
    tracks: trackResult.tracks,
    trackCursor: '0',
    previousCursor: null,
    totalTrackCount: trackResult.totalTrackCount,
    staticGpxPointCount: trackResult.staticGpxPointCount,
    staticGpxEvidence: staticGpxEvidence.rows,
    nextCursor: trackResult.nextCursor,
    progress: trackResult.totalTrackCount === 0
      ? 1
      : trackResult.tracks.length / trackResult.totalTrackCount,
    limitations: staticGpxEvidence.totalCount > staticGpxEvidence.rows.length
      ? [...limitations, {
          code: 'static_gpx_summary_truncated',
          message: 'Additional static GPX imports are retained and available in the GPX evidence panel.',
          count: staticGpxEvidence.totalCount - staticGpxEvidence.rows.length,
        }]
      : limitations,
  }
}

function readMissionLifecycle(database, input) {
  return database.prepare(`SELECT id, event_type, timestamp, details_json, recorded_at,
      recording_completeness
    FROM mission_events
    WHERE mission_id = ?
      AND event_type IN (
        'mission_created', 'mission_paused', 'mission_resumed',
        'mission_finished', 'mission_finalized', 'mission_unlocked'
      )
      AND timestamp <= ?
      AND recorded_at IS NOT NULL
      AND recorded_at <= ?
    ORDER BY timestamp DESC, recorded_at DESC, rowid DESC LIMIT 1`)
    .get(input.missionId, input.selectedTime, input.selectedTime) ?? null
}

function readMissionParticipants(database, input) {
  return database.prepare(`SELECT * FROM mission_participants
    WHERE mission_id = ?
      AND added_at <= ?
      AND effective_from <= ?
      AND (removed_at IS NULL OR removed_at > ?)
    ORDER BY kind ASC, COALESCE(traccar_device_id, mission_team_id) ASC, id ASC`)
    .all(input.missionId, input.selectedTime, input.selectedTime, input.selectedTime)
}

function readMissionGroupMembership(database, input) {
  const rows = database.prepare(`SELECT * FROM mission_group_membership_events
    WHERE mission_id = ? AND observed_at <= ?
      AND recorded_at IS NOT NULL AND recorded_at <= ?
    ORDER BY mission_team_id ASC, traccar_device_id ASC, observed_at ASC, sequence ASC, id ASC`)
    .all(input.missionId, input.selectedTime, input.selectedTime)
  const latest = new Map()
  for (const row of rows) latest.set(`${row.mission_team_id}:${row.traccar_device_id}`, row)
  return [...latest.values()].filter((row) => row.change === 'member')
}

/** Reads one bounded reconstructed-object page without sending unbounded state to main. */
function readMissionReplayObjectChunk(database, input) {
  const normalized = normalizeReplayInput(input)
  const offset = normalizeReplayCursor(input.objectCursor)
  const result = readObjectRows(database, normalized, offset)
  return {
    missionId: normalized.missionId,
    selectedTime: normalized.selectedTime,
    objects: result.objects,
    totalObjectCount: result.totalObjectCount,
    objectCursor: String(offset),
    nextObjectCursor: result.nextObjectCursor,
    progress: result.totalObjectCount === 0
      ? 1
      : Math.min(1, (offset + result.objects.length) / result.totalObjectCount),
    summarizedObjectCount: result.summarizedObjectCount,
  }
}

/** Reads one bounded continuation page from exact Traccar/GPX source evidence. */
function readMissionReplayTrackChunk(database, input) {
  const normalized = normalizeReplayInput(input)
  const offset = normalizeReplayCursor(input.cursor)
  const result = readTrackRows(database, normalized, offset)
  return {
    missionId: normalized.missionId,
    selectedTime: normalized.selectedTime,
    tracks: result.tracks,
    trackCursor: String(offset),
    previousCursor: offset === 0 ? null : String(Math.max(0, offset - normalized.trackLimit)),
    totalTrackCount: result.totalTrackCount,
    nextCursor: result.nextCursor,
    progress: result.totalTrackCount === 0
      ? 1
      : Math.min(1, (offset + result.tracks.length) / result.totalTrackCount),
  }
}

function readObjectRows(database, input, offset) {
  const total = database.prepare(`SELECT COUNT(*) AS count FROM (
    SELECT object_type, object_id FROM mission_object_versions
    WHERE mission_id = ? AND recorded_at <= ? AND effective_at <= ?
    GROUP BY object_type, object_id
  )`).get(input.missionId, input.selectedTime, input.selectedTime)
  const totalObjectCount = Number(total?.count ?? 0)
  const rows = database.prepare(`WITH ranked AS (
    SELECT *, ROW_NUMBER() OVER (
      PARTITION BY object_type, object_id
      ORDER BY recorded_at DESC, version_sequence DESC, id DESC
    ) AS replay_rank
    FROM mission_object_versions
    WHERE mission_id = ? AND recorded_at <= ? AND effective_at <= ?
  )
  SELECT * FROM ranked WHERE replay_rank = 1
  ORDER BY object_type ASC, object_id ASC
  LIMIT ? OFFSET ?`).all(
    input.missionId,
    input.selectedTime,
    input.selectedTime,
    input.objectLimit,
    offset,
  )
  let summarizedObjectCount = 0
  const objects = rows.map((row) => {
    const parsed = parseState(row.state_json, row.object_type, row.object_id)
    const state = summarizeReplayState(parsed, row.state_json)
    if (state !== parsed) summarizedObjectCount += 1
    return {
      object_type: row.object_type,
      object_id: row.object_id,
      version_sequence: row.version_sequence,
      operation: row.operation,
      effective_at: row.effective_at,
      recorded_at: row.recorded_at,
      completeness: row.completeness,
      state,
    }
  })
  const nextOffset = offset + objects.length
  return {
    objects,
    totalObjectCount,
    summarizedObjectCount,
    nextObjectCursor: nextOffset < totalObjectCount ? String(nextOffset) : null,
  }
}

function readTrackRows(database, input, offset) {
  const tracks = readTrackRowsBySourceIndex(database, input, offset)
  const positionStats = readPositionReplayStats(database, input)
  const totalTrackCount = countReplayTrackRows(database, input, positionStats.eligibleCount)
  const staticGpxPointCount = countStaticGpxPoints(database, input)
  const nextOffset = offset + tracks.length
  return {
    tracks,
    totalTrackCount,
    staticGpxPointCount,
    positionStats,
    nextCursor: nextOffset < totalTrackCount ? String(nextOffset) : null,
  }
}

/** Merges one deterministic page using the existing mission/device/fixTime index. */
function readTrackRowsBySourceIndex(database, input, offset) {
  const batchSize = Math.min(100, input.trackLimit)
  const deviceIds = database.prepare(`SELECT DISTINCT device_id
    FROM positions INDEXED BY idx_positions_mission_device_timestamp
    WHERE mission_id = ? ORDER BY device_id ASC`).all(input.missionId)
  const selectDeviceRows = `SELECT
      id AS evidence_id, 'traccar_fix' AS source_type, device_id AS track_id,
      timestamp AS effective_at, received_at AS recorded_at, lat, lon,
      altitude AS elevation, accuracy, 'fixTime' AS time_authority,
      'complete' AS completeness, 0 AS source_order, id AS stable_order
    FROM positions INDEXED BY idx_positions_mission_device_timestamp
    WHERE mission_id = ? AND device_id = ? AND timestamp_source = 'fix'
      AND received_at IS NOT NULL AND received_at <= ? AND timestamp <= ?`
  const readDeviceFirst = database.prepare(`${selectDeviceRows}
    ORDER BY timestamp ASC, received_at ASC, id ASC LIMIT ?`)
  const readDeviceAfter = database.prepare(`${selectDeviceRows}
      AND (timestamp > ?
        OR (timestamp = ? AND received_at > ?)
        OR (timestamp = ? AND received_at = ? AND id > ?))
    ORDER BY timestamp ASC, received_at ASC, id ASC LIMIT ?`)
  const sources = []
  for (const row of deviceIds) {
    const firstRows = readDeviceFirst.all(
      input.missionId, row.device_id, input.selectedTime, input.selectedTime, batchSize,
    )
    if (firstRows.length > 0) {
      sources.push({
        rows: firstRows,
        index: 0,
        fetchNext: (last) => readDeviceAfter.all(
          input.missionId, row.device_id, input.selectedTime, input.selectedTime,
          last.effective_at, last.effective_at, last.recorded_at,
          last.effective_at, last.recorded_at, last.evidence_id, batchSize,
        ),
      })
    }
  }
  const gpxRows = readInitialGpxTrackRows(database, input, offset + input.trackLimit)
  if (gpxRows.length > 0) sources.push({ rows: gpxRows, index: 0, fetchNext: null })
  const tracks = []
  let visited = 0
  while (tracks.length < input.trackLimit) {
    let selectedSource = null
    for (const source of sources) {
      const candidate = source.rows[source.index]
      if (candidate !== undefined && (selectedSource === null
        || compareReplayTrackRows(candidate, selectedSource.rows[selectedSource.index]) < 0)) {
        selectedSource = source
      }
    }
    if (selectedSource === null) break
    const selected = selectedSource.rows[selectedSource.index]
    if (visited >= offset) tracks.push(stripReplayOrderFields(selected))
    visited += 1
    selectedSource.index += 1
    if (selectedSource.index === selectedSource.rows.length && selectedSource.fetchNext !== null
      && selectedSource.rows.length === batchSize) {
      selectedSource.rows = selectedSource.fetchNext(selected)
      selectedSource.index = 0
    }
  }
  return tracks
}

/** Reads only the GPX candidates that could enter the bounded initial merged page. */
function readInitialGpxTrackRows(database, input, candidateLimit) {
  return database.prepare(`WITH eligible_gpx AS (
      SELECT revisions.*,
        ROW_NUMBER() OVER (
          PARTITION BY revisions.import_id
          ORDER BY revisions.recorded_at DESC, revisions.revision_sequence DESC
        ) AS replay_rank
      FROM gpx_import_revisions AS revisions
      JOIN gpx_track_imports AS imports ON imports.id = revisions.import_id
      WHERE revisions.mission_id = ? AND revisions.import_state = 'complete'
        AND revisions.recorded_at <= ?
        AND (imports.retired_at IS NULL OR imports.retired_at > ?)
    )
    SELECT
      eligible_gpx.import_id || ':' || eligible_gpx.revision_sequence || ':' ||
        points.segment_index || ':' || points.point_index AS evidence_id,
      'gpx_point' AS source_type, eligible_gpx.import_id AS track_id,
      points.source_time AS effective_at, eligible_gpx.recorded_at AS recorded_at,
      points.lat, points.lon, points.elevation, NULL AS accuracy,
      'gpx_source_time' AS time_authority, eligible_gpx.completeness AS completeness,
      1 AS source_order,
      eligible_gpx.import_id || ':' || printf('%08d', points.segment_index) || ':' ||
        printf('%08d', points.point_index) AS stable_order
    FROM eligible_gpx
    JOIN gpx_evidence_points AS points
      ON points.import_id = eligible_gpx.import_id
      AND points.revision_sequence = eligible_gpx.revision_sequence
    WHERE eligible_gpx.replay_rank = 1 AND points.source_time IS NOT NULL
      AND points.source_time <= ?
    ORDER BY points.source_time ASC, eligible_gpx.recorded_at ASC,
      eligible_gpx.import_id ASC, points.segment_index ASC, points.point_index ASC
    LIMIT ?`).all(
    input.missionId, input.selectedTime, input.selectedTime,
    input.selectedTime, candidateLimit,
  )
}

/** Orders mixed replay candidates by effective, recorded, source, and stable identity. */
function compareReplayTrackRows(left, right) {
  return left.effective_at.localeCompare(right.effective_at)
    || left.recorded_at.localeCompare(right.recorded_at)
    || Number(left.source_order) - Number(right.source_order)
    || left.stable_order.localeCompare(right.stable_order)
}

/** Removes internal merge keys from one renderer-facing exact evidence row. */
function stripReplayOrderFields(row) {
  const { source_order: _sourceOrder, stable_order: _stableOrder, ...track } = row
  return track
}

function countReplayTrackRows(database, input, eligiblePositionCount) {
  const row = database.prepare(`WITH eligible_gpx AS (
      SELECT revisions.import_id, revisions.revision_sequence,
        ROW_NUMBER() OVER (
          PARTITION BY revisions.import_id
          ORDER BY revisions.recorded_at DESC, revisions.revision_sequence DESC
        ) AS replay_rank
      FROM gpx_import_revisions AS revisions
      JOIN gpx_track_imports AS imports ON imports.id = revisions.import_id
      WHERE revisions.mission_id = ?
        AND revisions.import_state = 'complete'
        AND revisions.recorded_at <= ?
        AND (imports.retired_at IS NULL OR imports.retired_at > ?)
    )
    SELECT COUNT(*) AS count
        FROM eligible_gpx
        JOIN gpx_evidence_points AS points
          ON points.import_id = eligible_gpx.import_id
          AND points.revision_sequence = eligible_gpx.revision_sequence
        WHERE eligible_gpx.replay_rank = 1
          AND points.source_time IS NOT NULL
          AND points.source_time <= ?`)
    .get(
      input.missionId, input.selectedTime, input.selectedTime,
      input.selectedTime,
    )
  return eligiblePositionCount + Number(row?.count ?? 0)
}

/** Aggregates exact-replay eligibility and explicit legacy gaps in one mission scan. */
function readPositionReplayStats(database, input) {
  const hasReplayIndex = database.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_positions_replay_known_fix'`).get() !== undefined
  if (hasReplayIndex) {
    const eligible = database.prepare(`SELECT COUNT(*) AS count
      FROM positions INDEXED BY idx_positions_replay_known_fix
      WHERE mission_id = ? AND timestamp_source = 'fix' AND received_at IS NOT NULL
        AND received_at <= ? AND timestamp <= ?`)
      .get(input.missionId, input.selectedTime, input.selectedTime)
    const exact = database.prepare(`SELECT COUNT(*) AS count
      FROM positions INDEXED BY idx_positions_replay_known_fix
      WHERE mission_id = ? AND timestamp_source = 'fix'`).get(input.missionId)
    const missingRecorded = database.prepare(`SELECT COUNT(*) AS count
      FROM positions INDEXED BY idx_positions_replay_known_fix
      WHERE mission_id = ? AND timestamp_source = 'fix' AND received_at IS NULL`)
      .get(input.missionId)
    const total = database.prepare(`SELECT COUNT(*) AS count
      FROM positions INDEXED BY idx_positions_mission_device_timestamp
      WHERE mission_id = ?`).get(input.missionId)
    return {
      eligibleCount: Number(eligible?.count ?? 0),
      missingRecordedCount: Number(missingRecorded?.count ?? 0),
      unprovedTimeCount: Math.max(0, Number(total?.count ?? 0) - Number(exact?.count ?? 0)),
    }
  }
  const row = database.prepare(`SELECT
      SUM(CASE WHEN timestamp_source = 'fix' AND received_at IS NOT NULL
        AND received_at <= ? AND timestamp <= ? THEN 1 ELSE 0 END) AS eligible_count,
      SUM(CASE WHEN timestamp_source = 'fix' AND received_at IS NULL THEN 1 ELSE 0 END) AS missing_recorded_count,
      SUM(CASE WHEN timestamp_source IS NULL THEN 1 ELSE 0 END) AS unproved_time_count
    FROM positions INDEXED BY idx_positions_mission_device_timestamp
    WHERE mission_id = ?`).get(input.selectedTime, input.selectedTime, input.missionId)
  return {
    eligibleCount: Number(row?.eligible_count ?? 0),
    missingRecordedCount: Number(row?.missing_recorded_count ?? 0),
    unprovedTimeCount: Number(row?.unproved_time_count ?? 0),
  }
}

function countStaticGpxPoints(database, input) {
  const row = database.prepare(`WITH eligible AS (
      SELECT revisions.*,
        ROW_NUMBER() OVER (
          PARTITION BY revisions.import_id
          ORDER BY revisions.recorded_at DESC, revisions.revision_sequence DESC
        ) AS replay_rank
      FROM gpx_import_revisions AS revisions
      JOIN gpx_track_imports AS imports ON imports.id = revisions.import_id
      WHERE revisions.mission_id = ?
        AND revisions.import_state = 'complete'
        AND revisions.recorded_at <= ?
        AND (imports.retired_at IS NULL OR imports.retired_at > ?)
    )
    SELECT COUNT(*) AS count
    FROM eligible
    JOIN gpx_evidence_points AS points
      ON points.import_id = eligible.import_id
      AND points.revision_sequence = eligible.revision_sequence
    WHERE eligible.replay_rank = 1 AND points.source_time IS NULL`)
    .get(input.missionId, input.selectedTime, input.selectedTime)
  return Number(row?.count ?? 0)
}

/** Returns bounded provenance summaries for static GPX evidence eligible at T. */
function readStaticGpxEvidence(database, input) {
  const baseSql = `WITH eligible AS (
      SELECT revisions.*,
        ROW_NUMBER() OVER (
          PARTITION BY revisions.import_id
          ORDER BY revisions.recorded_at DESC, revisions.revision_sequence DESC
        ) AS replay_rank
      FROM gpx_import_revisions AS revisions
      JOIN gpx_track_imports AS imports ON imports.id = revisions.import_id
      WHERE revisions.mission_id = ? AND revisions.recorded_at <= ?
        AND revisions.import_state = 'complete'
        AND (imports.retired_at IS NULL OR imports.retired_at > ?)
    ), static_imports AS (
      SELECT eligible.*,
        (SELECT COUNT(*) FROM gpx_evidence_points AS points
          WHERE points.import_id = eligible.import_id
            AND points.revision_sequence = eligible.revision_sequence
            AND points.source_time IS NULL) AS static_point_count,
        (SELECT COUNT(*) FROM gpx_evidence_rejections AS rejections
          WHERE rejections.import_id = eligible.import_id
            AND rejections.revision_sequence = eligible.revision_sequence) AS rejection_count
      FROM eligible
      WHERE eligible.replay_rank = 1
        AND EXISTS (
          SELECT 1 FROM gpx_evidence_points AS points
          WHERE points.import_id = eligible.import_id
            AND points.revision_sequence = eligible.revision_sequence
            AND points.source_time IS NULL
        )
    )`
  const parameters = [input.missionId, input.selectedTime, input.selectedTime]
  const count = database.prepare(`${baseSql} SELECT COUNT(*) AS count FROM static_imports`)
    .get(...parameters)
  const rows = database.prepare(`${baseSql}
    SELECT import_id, revision_sequence, source_path, file_name, display_name,
      content_sha256, timing_class, outing_id, completeness, recorded_at,
      static_point_count, rejection_count
    FROM static_imports ORDER BY display_name ASC, import_id ASC LIMIT 100`)
    .all(...parameters)
  return { rows, totalCount: Number(count?.count ?? 0) }
}

function readReplayLimitations(
  database,
  input,
  staticGpxPointCount,
  summarizedObjectCount = 0,
  positionStats = readPositionReplayStats(database, input),
) {
  const limitations = []
  const futureBaseline = database.prepare(`SELECT recorded_at FROM mission_object_versions
    WHERE mission_id = ? AND completeness = 'legacy_baseline' AND recorded_at > ?
    ORDER BY recorded_at ASC LIMIT 1`).get(input.missionId, input.selectedTime)
  if (futureBaseline !== undefined) {
    limitations.push({
      code: 'legacy_history_unknown_before_baseline',
      message: 'Mutable evidence history is unknown before the recorded migration baseline.',
      boundaryTime: futureBaseline.recorded_at,
    })
  }
  const eligibleLegacy = database.prepare(`SELECT COUNT(*) AS count FROM mission_object_versions
    WHERE mission_id = ? AND completeness = 'legacy_baseline' AND recorded_at <= ?`)
    .get(input.missionId, input.selectedTime)
  if (Number(eligibleLegacy?.count ?? 0) > 0) {
    limitations.push({
      code: 'legacy_baseline_only',
      message: 'Earlier revisions are unknown for one or more legacy evidence objects.',
    })
  }
  if (staticGpxPointCount > 0) {
    limitations.push({
      code: 'undated_gpx_static',
      message: 'Undated GPX points remain visible as static evidence and are excluded from precise replay placement.',
      count: staticGpxPointCount,
    })
  }
  const legacyGpx = database.prepare(`SELECT COUNT(*) AS count FROM gpx_import_revisions
    WHERE mission_id = ? AND completeness = 'legacy_baseline'
      AND import_state = 'complete' AND recorded_at <= ?`)
    .get(input.missionId, input.selectedTime)
  if (Number(legacyGpx?.count ?? 0) > 0) {
    limitations.push({
      code: 'legacy_gpx_baseline_only',
      message: 'One or more migrated GPX imports retain static geometry, but earlier revisions, exact source bytes, and source times are unknown.',
      count: Number(legacyGpx.count),
    })
  }
  if (positionStats.missingRecordedCount > 0) {
    limitations.push({
      code: 'position_recorded_time_missing',
      message: 'Some exact fixes lack durable recorded-time provenance and cannot be placed in data-known-at-T replay.',
      count: positionStats.missingRecordedCount,
    })
  }
  if (positionStats.unprovedTimeCount > 0) {
    limitations.push({
      code: 'position_time_authority_unproved',
      message: 'Some retained legacy positions have no proved Traccar fixTime authority and are excluded from exact replay.',
      count: positionStats.unprovedTimeCount,
    })
  }
  const legacyLifecycle = database.prepare(`SELECT COUNT(*) AS count FROM mission_events
    WHERE mission_id = ? AND recording_completeness = 'legacy_baseline'
      AND recorded_at <= ?`).get(input.missionId, input.selectedTime)
  if (Number(legacyLifecycle?.count ?? 0) > 0) {
    limitations.push({
      code: 'legacy_lifecycle_baseline_only',
      message: 'Earlier recorded-at provenance is unknown for one or more migrated mission lifecycle events.',
      count: Number(legacyLifecycle.count),
    })
  }
  const legacyMembership = database.prepare(`SELECT COUNT(*) AS count
    FROM mission_group_membership_events
    WHERE mission_id = ? AND recording_completeness = 'legacy_baseline'
      AND recorded_at <= ?`).get(input.missionId, input.selectedTime)
  if (Number(legacyMembership?.count ?? 0) > 0) {
    limitations.push({
      code: 'legacy_membership_baseline_only',
      message: 'Earlier recorded-at provenance is unknown for one or more migrated group membership events.',
      count: Number(legacyMembership.count),
    })
  }
  if (summarizedObjectCount > 0) {
    limitations.push({
      code: 'large_object_details_summarized',
      message: 'Large evidence states are represented by bounded summaries and retained-state hashes in this page.',
      count: summarizedObjectCount,
    })
  }
  return limitations
}

function normalizeReplayInput(input) {
  if (typeof input?.missionId !== 'string' || input.missionId.length < 1 || input.missionId.length > 200) {
    throw new Error('Mission replay mission ID is invalid.')
  }
  if (typeof input.selectedTime !== 'string' || !Number.isFinite(Date.parse(input.selectedTime))) {
    throw new Error('Mission replay selected time is invalid.')
  }
  if (!Number.isInteger(input.trackLimit) || input.trackLimit < 1 || input.trackLimit > MAX_REPLAY_TRACK_LIMIT) {
    throw new Error(`Mission replay track limit must be between 1 and ${MAX_REPLAY_TRACK_LIMIT}.`)
  }
  const objectLimit = input.objectLimit ?? MAX_REPLAY_OBJECT_LIMIT
  if (!Number.isInteger(objectLimit) || objectLimit < 1 || objectLimit > MAX_REPLAY_OBJECT_LIMIT) {
    throw new Error(`Mission replay object limit must be between 1 and ${MAX_REPLAY_OBJECT_LIMIT}.`)
  }
  return {
    missionId: input.missionId,
    selectedTime: new Date(input.selectedTime).toISOString(),
    trackLimit: input.trackLimit,
    objectLimit,
    timezone: typeof input.timezone === 'string' && input.timezone.trim() !== ''
      ? input.timezone.trim()
      : 'Europe/Dublin',
  }
}

/** Returns a small explicit summary when a version state is too large for worker IPC. */
function summarizeReplayState(state, serializedState) {
  const sizeBytes = Buffer.byteLength(serializedState, 'utf8')
  if (sizeBytes <= MAX_REPLAY_OBJECT_STATE_BYTES) return state
  const summary = {}
  for (const key of [
    'id', 'name', 'label', 'title', 'type', 'status', 'outcome', 'search_area_id',
    'assignment_id', 'outing_id', 'team_id', 'coordinator_name', 'started_at',
    'ended_at', 'retired_at', 'version_sequence',
  ]) {
    const value = state[key]
    if (typeof value === 'string') {
      summary[key] = value.slice(0, 500)
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      summary[key] = value
    }
  }
  return {
    ...summary,
    _state_details_omitted: true,
    _state_size_bytes: sizeBytes,
    _state_sha256: createHash('sha256').update(serializedState).digest('hex'),
  }
}

function normalizeReplayCursor(value) {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value !== 'string' || !/^\d{1,12}$/u.test(value)) {
    throw new Error('Mission replay cursor is invalid.')
  }
  const offset = Number(value)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_REPLAY_CURSOR_OFFSET) {
    throw new Error('Mission replay cursor is invalid.')
  }
  return offset
}

function parseState(value, objectType, objectId) {
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
    return parsed
  } catch {
    throw new Error(`Mission replay ${objectType} ${objectId} has corrupt version state.`)
  }
}

module.exports = {
  MAX_REPLAY_TRACK_LIMIT,
  MAX_REPLAY_OBJECT_LIMIT,
  normalizeReplayInput,
  readMissionReplayObjectChunk,
  readMissionReplayState,
  readMissionReplayTrackChunk,
}
