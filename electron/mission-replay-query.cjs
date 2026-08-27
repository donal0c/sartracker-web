const MAX_REPLAY_TRACK_LIMIT = 1_000

/** Builds the deterministic metadata snapshot and first bounded exact-track page for data known at T. */
function readMissionReplayState(database, input) {
  const normalized = normalizeReplayInput(input)
  const objects = foldMissionObjects(database, normalized)
  const trackResult = readTrackRows(database, normalized, 0)
  const limitations = readReplayLimitations(database, normalized, trackResult.staticGpxPointCount)
  return {
    missionId: normalized.missionId,
    selectedTime: normalized.selectedTime,
    timezone: normalized.timezone,
    objects,
    missionLifecycle: readMissionLifecycle(database, normalized),
    participants: readMissionParticipants(database, normalized),
    groupMembership: readMissionGroupMembership(database, normalized),
    tracks: trackResult.tracks,
    totalTrackCount: trackResult.totalTrackCount,
    staticGpxPointCount: trackResult.staticGpxPointCount,
    nextCursor: trackResult.nextCursor,
    progress: trackResult.totalTrackCount === 0
      ? 1
      : trackResult.tracks.length / trackResult.totalTrackCount,
    limitations,
  }
}

function readMissionLifecycle(database, input) {
  return database.prepare(`SELECT id, event_type, timestamp, details_json
    FROM mission_events
    WHERE mission_id = ?
      AND event_type IN (
        'mission_created', 'mission_paused', 'mission_resumed',
        'mission_finished', 'mission_finalized', 'mission_unlocked'
      )
      AND timestamp <= ?
    ORDER BY timestamp DESC, rowid DESC LIMIT 1`).get(input.missionId, input.selectedTime) ?? null
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
    ORDER BY mission_team_id ASC, traccar_device_id ASC, observed_at ASC, sequence ASC, id ASC`)
    .all(input.missionId, input.selectedTime)
  const latest = new Map()
  for (const row of rows) latest.set(`${row.mission_team_id}:${row.traccar_device_id}`, row)
  return [...latest.values()].filter((row) => row.change === 'member')
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
    totalTrackCount: result.totalTrackCount,
    nextCursor: result.nextCursor,
    progress: result.totalTrackCount === 0
      ? 1
      : Math.min(1, (offset + result.tracks.length) / result.totalTrackCount),
  }
}

function foldMissionObjects(database, input) {
  const rows = database.prepare(`SELECT * FROM mission_object_versions
    WHERE mission_id = ? AND recorded_at <= ? AND effective_at <= ?
    ORDER BY object_type ASC, object_id ASC, recorded_at ASC, version_sequence ASC, id ASC`)
    .all(input.missionId, input.selectedTime, input.selectedTime)
  const latest = new Map()
  for (const row of rows) latest.set(`${row.object_type}:${row.object_id}`, row)
  return [...latest.values()].map((row) => ({
    object_type: row.object_type,
    object_id: row.object_id,
    version_sequence: row.version_sequence,
    operation: row.operation,
    effective_at: row.effective_at,
    recorded_at: row.recorded_at,
    completeness: row.completeness,
    state: parseState(row.state_json, row.object_type, row.object_id),
  }))
}

function readTrackRows(database, input, offset) {
  const tracks = database.prepare(`WITH eligible_gpx AS (
      SELECT revisions.*,
        ROW_NUMBER() OVER (
          PARTITION BY revisions.import_id
          ORDER BY revisions.recorded_at DESC, revisions.revision_sequence DESC
        ) AS replay_rank
      FROM gpx_import_revisions AS revisions
      JOIN gpx_track_imports AS imports ON imports.id = revisions.import_id
      WHERE revisions.mission_id = ?
        AND revisions.recorded_at <= ?
        AND (imports.retired_at IS NULL OR imports.retired_at > ?)
    ), replay_tracks AS (
      SELECT
        id AS evidence_id,
        'traccar_fix' AS source_type,
        device_id AS track_id,
        timestamp AS effective_at,
        received_at AS recorded_at,
        lat,
        lon,
        altitude AS elevation,
        accuracy,
        'fixTime' AS time_authority,
        'complete' AS completeness,
        0 AS source_order,
        id AS stable_order
      FROM positions
      WHERE mission_id = ?
        AND timestamp_source = 'fix'
        AND received_at IS NOT NULL
        AND received_at <= ?
        AND timestamp <= ?

      UNION ALL

      SELECT
        eligible_gpx.import_id || ':' || eligible_gpx.revision_sequence || ':' ||
          points.segment_index || ':' || points.point_index AS evidence_id,
        'gpx_point' AS source_type,
        eligible_gpx.import_id AS track_id,
        points.source_time AS effective_at,
        eligible_gpx.recorded_at AS recorded_at,
        points.lat,
        points.lon,
        points.elevation,
        NULL AS accuracy,
        'gpx_source_time' AS time_authority,
        eligible_gpx.completeness AS completeness,
        1 AS source_order,
        eligible_gpx.import_id || ':' || printf('%08d', points.segment_index) || ':' ||
          printf('%08d', points.point_index) AS stable_order
      FROM eligible_gpx
      JOIN gpx_evidence_points AS points
        ON points.import_id = eligible_gpx.import_id
        AND points.revision_sequence = eligible_gpx.revision_sequence
      WHERE eligible_gpx.replay_rank = 1
        AND points.source_time IS NOT NULL
        AND points.source_time <= ?
    )
    SELECT
      evidence_id, source_type, track_id, effective_at, recorded_at,
      lat, lon, elevation, accuracy, time_authority, completeness
    FROM replay_tracks
    ORDER BY effective_at ASC, recorded_at ASC, source_order ASC, stable_order ASC
    LIMIT ? OFFSET ?`)
    .all(
      input.missionId, input.selectedTime, input.selectedTime,
      input.missionId, input.selectedTime, input.selectedTime,
      input.selectedTime, input.trackLimit, offset,
    )
  const totalTrackCount = countReplayTrackRows(database, input)
  const staticGpxPointCount = countStaticGpxPoints(database, input)
  const nextOffset = offset + tracks.length
  return {
    tracks,
    totalTrackCount,
    staticGpxPointCount,
    nextCursor: nextOffset < totalTrackCount ? String(nextOffset) : null,
  }
}

function countReplayTrackRows(database, input) {
  const row = database.prepare(`WITH eligible_gpx AS (
      SELECT revisions.import_id, revisions.revision_sequence,
        ROW_NUMBER() OVER (
          PARTITION BY revisions.import_id
          ORDER BY revisions.recorded_at DESC, revisions.revision_sequence DESC
        ) AS replay_rank
      FROM gpx_import_revisions AS revisions
      JOIN gpx_track_imports AS imports ON imports.id = revisions.import_id
      WHERE revisions.mission_id = ?
        AND revisions.recorded_at <= ?
        AND (imports.retired_at IS NULL OR imports.retired_at > ?)
    )
    SELECT
      (SELECT COUNT(*) FROM positions
        WHERE mission_id = ?
          AND timestamp_source = 'fix'
          AND received_at IS NOT NULL
          AND received_at <= ?
          AND timestamp <= ?)
      +
      (SELECT COUNT(*)
        FROM eligible_gpx
        JOIN gpx_evidence_points AS points
          ON points.import_id = eligible_gpx.import_id
          AND points.revision_sequence = eligible_gpx.revision_sequence
        WHERE eligible_gpx.replay_rank = 1
          AND points.source_time IS NOT NULL
          AND points.source_time <= ?) AS count`)
    .get(
      input.missionId, input.selectedTime, input.selectedTime,
      input.missionId, input.selectedTime, input.selectedTime,
      input.selectedTime,
    )
  return Number(row?.count ?? 0)
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

function readReplayLimitations(database, input, staticGpxPointCount) {
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
  const missingRecorded = database.prepare(`SELECT COUNT(*) AS count FROM positions
    WHERE mission_id = ? AND timestamp_source = 'fix' AND received_at IS NULL`)
    .get(input.missionId)
  if (Number(missingRecorded?.count ?? 0) > 0) {
    limitations.push({
      code: 'position_recorded_time_missing',
      message: 'Some exact fixes lack durable recorded-time provenance and cannot be placed in data-known-at-T replay.',
      count: Number(missingRecorded.count),
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
  return {
    missionId: input.missionId,
    selectedTime: new Date(input.selectedTime).toISOString(),
    trackLimit: input.trackLimit,
    timezone: typeof input.timezone === 'string' && input.timezone.trim() !== ''
      ? input.timezone.trim()
      : 'Europe/Dublin',
  }
}

function normalizeReplayCursor(value) {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value !== 'string' || !/^\d{1,12}$/u.test(value)) {
    throw new Error('Mission replay cursor is invalid.')
  }
  const offset = Number(value)
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Mission replay cursor is invalid.')
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
  normalizeReplayInput,
  readMissionReplayState,
  readMissionReplayTrackChunk,
}
