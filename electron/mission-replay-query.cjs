const { createHash } = require('node:crypto')
const { isStrictTrackingTimestamp } = require('./tracking-timestamp.cjs')
const {
  assertLegacyEventProvenanceReady,
} = require('./mission-event-provenance-backfill.cjs')

const MAX_REPLAY_TRACK_LIMIT = 1_000
const MAX_REPLAY_OBJECT_LIMIT = 100
const MAX_REPLAY_OBJECT_STATE_BYTES = 4_096
const MAX_REPLAY_CURSOR_OFFSET = 10_000_000
const MAX_REPLAY_FILTER_IDS = 200
const MAX_REPLAY_FILTER_PAGE_LIMIT = 100
const MAX_REPLAY_FILTER_SEARCH_LENGTH = 120
const MAX_REPLAY_SELECTED_TIME_LENGTH = 64
const REPLAY_TIMEZONE = 'Europe/Dublin'

/** Builds the deterministic metadata snapshot and first bounded exact-track page for data known at T. */
function readMissionReplayState(database, input) {
  assertLegacyEventProvenanceReady(database, input?.missionId)
  return database.transaction(() => readMissionReplayStateWithinSnapshot(database, input))()
}

/** Builds replay state while the caller-owned SQLite read transaction pins one WAL snapshot. */
function readMissionReplayStateWithinSnapshot(database, input) {
  const baseInput = normalizeReplayInput(input)
  const normalized = {
    ...baseInput,
    replayGeneration: readMissionReplayGeneration(database, baseInput.missionId),
  }
  const objectResult = readObjectRows(database, normalized, 0)
  const trackResult = readTrackRows(database, normalized, null)
  const staticGpxEvidence = readStaticGpxEvidence(database, normalized)
  const outingFilterPage = readMissionReplayFilterPageWithinSnapshot(database, {
    ...normalized,
    filterKind: 'outing',
    filterLimit: MAX_REPLAY_FILTER_PAGE_LIMIT,
  })
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
    replayGeneration: normalized.replayGeneration,
    timezone: normalized.timezone,
    objects: objectResult.objects,
    totalObjectCount: objectResult.totalObjectCount,
    objectTypeCounts: objectResult.objectTypeCounts,
    objectCursor: '0',
    nextObjectCursor: objectResult.nextObjectOffset === null
      ? null
      : encodeReplayObjectCursor(
          objectResult.nextObjectOffset, normalized, objectResult.totalObjectCount,
        ),
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
    availableDeviceIds: readAvailableDeviceIds(database, normalized),
    availableOutingIds: outingFilterPage.entries,
    availableOutingTotalCount: outingFilterPage.totalCount,
    availableOutingNextCursor: outingFilterPage.nextCursor,
    deviceFilterIds: normalized.deviceIds ?? [],
    outingFilterIds: normalized.outingIds ?? [],
    progress: trackResult.totalTrackCount === 0
      ? 1
      : trackResult.tracks.length / trackResult.totalTrackCount,
    limitations: [
      ...limitations,
      ...(outingFilterPage.nextCursor === null ? [] : [{
        code: 'outing_filter_choices_paged',
        message: 'Additional eligible GPX outings are available through bounded filter-choice pages.',
        count: outingFilterPage.totalCount - outingFilterPage.entries.length,
      }]),
      ...(staticGpxEvidence.totalCount > staticGpxEvidence.rows.length ? [{
          code: 'static_gpx_summary_truncated',
          message: 'Additional static GPX imports are retained and available in the GPX evidence panel.',
          count: staticGpxEvidence.totalCount - staticGpxEvidence.rows.length,
        }] : []),
    ],
  }
}

/** Reads one bounded searchable Replay filter-choice page inside a pinned SQLite snapshot. */
function readMissionReplayFilterPage(database, input) {
  assertLegacyEventProvenanceReady(database, input?.missionId)
  return database.transaction(() => {
    const normalized = normalizeReplayInput(input)
    return readMissionReplayFilterPageWithinSnapshot(database, {
      ...normalized,
      replayGeneration: readMissionReplayGeneration(database, normalized.missionId),
      filterKind: input.filterKind,
      filterSearch: input.filterSearch,
      filterCursor: input.filterCursor,
      filterLimit: input.filterLimit,
    })
  })()
}

/** Executes one validated Replay outing-choice page. */
function readMissionReplayFilterPageWithinSnapshot(database, input) {
  if (input.filterKind !== 'outing') {
    throw new Error('Mission replay filter kind is invalid.')
  }
  const search = normalizeReplayFilterSearch(input.filterSearch)
  const limit = normalizeReplayFilterPageLimit(input.filterLimit)
  const cursor = decodeReplayFilterCursor(input.filterCursor, { ...input, search })
  const eligibleCte = `WITH eligible AS (
      SELECT revisions.outing_id,
        ROW_NUMBER() OVER (PARTITION BY revisions.import_id
          ORDER BY revisions.recorded_at DESC, revisions.revision_sequence DESC) AS replay_rank
      FROM gpx_import_revisions AS revisions
      JOIN gpx_track_imports AS imports ON imports.id = revisions.import_id
      WHERE revisions.mission_id = ? AND revisions.import_state = 'complete'
        AND revisions.recorded_at <= ?
        AND (imports.retired_at IS NULL OR imports.retired_at > ?)
    ), choices AS (
      SELECT DISTINCT outing_id FROM eligible
      WHERE replay_rank = 1 AND outing_id IS NOT NULL
        AND outing_id LIKE ? ESCAPE '\\' COLLATE NOCASE
    )`
  const parameters = [
    input.missionId,
    input.selectedTime,
    input.selectedTime,
    `%${escapeReplayFilterSearch(search)}%`,
  ]
  const totalCount = Number(database.prepare(`${eligibleCte}
    SELECT COUNT(*) AS count FROM choices`).get(...parameters).count)
  const rows = database.prepare(`${eligibleCte}
    SELECT outing_id FROM choices
    ${cursor === null ? '' : 'WHERE outing_id > ?'}
    ORDER BY outing_id ASC LIMIT ?`).all(
      ...parameters,
      ...(cursor === null ? [] : [cursor.lastId]),
      limit + 1,
    )
  const entries = rows.slice(0, limit).map((row) => row.outing_id)
  const lastId = entries.at(-1)
  return {
    filterKind: 'outing',
    search,
    entries,
    totalCount,
    nextCursor: rows.length <= limit || lastId === undefined
      ? null
      : encodeReplayFilterCursor({
          missionId: input.missionId,
          selectedTime: input.selectedTime,
          replayGeneration: input.replayGeneration,
          filterKind: 'outing',
          search,
          lastId,
        }),
  }
}

function readMissionLifecycle(database, input) {
  const event = database.prepare(`SELECT id, event_type, timestamp, details_json, recorded_at,
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
  return event === null
    ? null
    : { ...event, state: missionLifecycleStateFromEventType(event.event_type) }
}

/** Converts lifecycle transition provenance into the mission state established by that event. */
function missionLifecycleStateFromEventType(eventType) {
  switch (eventType) {
    case 'mission_created':
    case 'mission_resumed':
      return 'active'
    case 'mission_paused':
      return 'paused'
    case 'mission_finished':
    case 'mission_unlocked':
      return 'finished'
    case 'mission_finalized':
      return 'finalized'
    default:
      return 'unknown'
  }
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
  assertLegacyEventProvenanceReady(database, input?.missionId)
  return database.transaction(() => readMissionReplayObjectChunkWithinSnapshot(database, input))()
}

/** Reads an object page while the caller-owned SQLite read transaction pins one WAL snapshot. */
function readMissionReplayObjectChunkWithinSnapshot(database, input) {
  const baseInput = normalizeReplayInput(input)
  const currentGeneration = readMissionReplayGeneration(database, baseInput.missionId)
  if (!Number.isSafeInteger(input.replayGeneration) || input.replayGeneration < 0) {
    throw new Error('Mission replay object snapshot generation is invalid.')
  }
  if (input.replayGeneration !== currentGeneration) {
    throw new Error('Mission replay evidence changed while paging. Re-seek the selected time.')
  }
  const normalized = { ...baseInput, replayGeneration: currentGeneration }
  const cursor = normalizeReplayObjectCursor(input.objectCursor)
  const offset = cursor?.offset ?? 0
  const result = readObjectRows(database, normalized, offset)
  if (cursor !== null && (cursor.replayGeneration !== currentGeneration
    || cursor.eligibleObjectCount !== result.totalObjectCount)) {
    throw new Error('Mission replay evidence changed while paging. Re-seek the selected time.')
  }
  if (cursor !== null && cursor.contextHash !== replayCursorContextHash(
    'object', normalized, result.totalObjectCount,
  )) {
    throw new Error('Mission replay object cursor context does not match this request.')
  }
  return {
    missionId: normalized.missionId,
    selectedTime: normalized.selectedTime,
    replayGeneration: normalized.replayGeneration,
    objects: result.objects,
    totalObjectCount: result.totalObjectCount,
    objectCursor: String(offset),
    nextObjectCursor: result.nextObjectOffset === null
      ? null
      : encodeReplayObjectCursor(
          result.nextObjectOffset, normalized, result.totalObjectCount,
        ),
    progress: result.totalObjectCount === 0
      ? 1
      : Math.min(1, (offset + result.objects.length) / result.totalObjectCount),
    summarizedObjectCount: result.summarizedObjectCount,
  }
}

/** Reads one bounded continuation page from exact Traccar/GPX source evidence. */
function readMissionReplayTrackChunk(database, input) {
  assertLegacyEventProvenanceReady(database, input?.missionId)
  return database.transaction(() => readMissionReplayTrackChunkWithinSnapshot(database, input))()
}

/** Reads a track page while the caller-owned SQLite read transaction pins one WAL snapshot. */
function readMissionReplayTrackChunkWithinSnapshot(database, input) {
  const cursor = normalizeReplayTrackCursor(input.cursor)
  const baseInput = normalizeReplayInput(input)
  const currentGeneration = readMissionReplayGeneration(database, baseInput.missionId)
  if (cursor !== null && cursor.replayGeneration !== currentGeneration) {
    throw new Error('Mission replay evidence changed while paging. Re-seek the selected time.')
  }
  const normalized = {
    ...baseInput,
    replayGeneration: currentGeneration,
  }
  const result = readTrackRows(database, normalized, cursor)
  return {
    missionId: normalized.missionId,
    selectedTime: normalized.selectedTime,
    tracks: result.tracks,
    trackCursor: String(result.offset),
    previousCursor: result.previousCursor,
    totalTrackCount: result.totalTrackCount,
    nextCursor: result.nextCursor,
    progress: result.totalTrackCount === 0
      ? 1
      : Math.min(1, (result.offset + result.tracks.length) / result.totalTrackCount),
  }
}

function readObjectRows(database, input, offset) {
  const totals = database.prepare(`SELECT object_type, COUNT(*) AS count FROM (
    SELECT object_type, object_id FROM mission_object_versions
    WHERE mission_id = ? AND recorded_at <= ? AND effective_at <= ?
    GROUP BY object_type, object_id
  ) GROUP BY object_type ORDER BY object_type ASC`)
    .all(input.missionId, input.selectedTime, input.selectedTime)
  const objectTypeCounts = Object.fromEntries(totals.map((row) => [row.object_type, Number(row.count)]))
  const totalObjectCount = totals.reduce((sum, row) => sum + Number(row.count), 0)
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
    objectTypeCounts,
    summarizedObjectCount,
    nextObjectOffset: nextOffset < totalObjectCount ? nextOffset : null,
  }
}

function readTrackRows(database, input, cursor) {
  const positionStats = readPositionReplayStats(database, input)
  if (cursor !== null && cursor.eligiblePositionCount !== positionStats.eligibleCount) {
    throw new Error('Mission replay evidence changed while paging. Re-seek the selected time.')
  }
  const totalTrackCount = countReplayTrackRows(database, input, positionStats.eligibleCount)
  if (cursor !== null && cursor.eligibleTrackCount !== totalTrackCount) {
    throw new Error('Mission replay evidence changed while paging. Re-seek the selected time.')
  }
  if (cursor !== null && cursor.contextHash !== replayCursorContextHash(
    'track', input, totalTrackCount,
  )) {
    throw new Error('Mission replay cursor context does not match this request.')
  }
  const page = readTrackRowsBySourceIndex(database, input, cursor)
  const staticGpxPointCount = countStaticGpxPoints(database, input)
  return {
    tracks: page.rows.map(stripReplayOrderFields),
    offset: page.offset,
    totalTrackCount,
    staticGpxPointCount,
    positionStats,
    previousCursor: page.offset === 0 || page.rows.length === 0
      ? null
      : encodeReplayTrackCursor(
          'before', page.offset, page.rows[0], input.replayGeneration,
          positionStats.eligibleCount, input, totalTrackCount,
        ),
    nextCursor: page.offset + page.rows.length < totalTrackCount && page.rows.length > 0
      ? encodeReplayTrackCursor(
          'after', page.offset + page.rows.length, page.rows.at(-1), input.replayGeneration,
          positionStats.eligibleCount, input, totalTrackCount,
        )
      : null,
  }
}

/** Merges one deterministic keyset page using the existing mission/device/fixTime index. */
function readTrackRowsBySourceIndex(database, input, cursor) {
  const direction = cursor?.direction ?? 'after'
  const key = cursor?.key ?? null
  const batchSize = Math.min(20, input.trackLimit)
  const deviceIds = database.prepare(`SELECT device_id FROM devices
    WHERE mission_id = ? ORDER BY device_id ASC`).all(input.missionId)
    .map((row) => row.device_id)
    .filter((deviceId) => input.deviceIds === null || input.deviceIds.includes(deviceId))
  const selectDeviceRows = `SELECT
      id AS evidence_id, 'traccar_fix' AS source_type, device_id AS track_id,
      timestamp AS effective_at, received_at AS recorded_at, lat, lon,
      altitude AS elevation, accuracy, 'fixTime' AS time_authority,
      'complete' AS completeness, 0 AS source_order, id AS stable_order
    FROM positions INDEXED BY idx_positions_mission_device_timestamp
    WHERE mission_id = ? AND device_id = ? AND timestamp_source = 'fix'
      AND received_at IS NOT NULL AND received_at <= ? AND timestamp <= ?
      AND COALESCE(timestamp_provenance_recorded_at, received_at) <= ?`
  const keyPredicate = direction === 'after'
    ? ` AND timestamp >= ? AND (timestamp > ? OR (timestamp = ? AND received_at > ?)
        OR (timestamp = ? AND received_at = ? AND 0 > ?)
        OR (timestamp = ? AND received_at = ? AND 0 = ? AND id > ?))`
    : ` AND timestamp <= ? AND (timestamp < ? OR (timestamp = ? AND received_at < ?)
        OR (timestamp = ? AND received_at = ? AND 0 < ?)
        OR (timestamp = ? AND received_at = ? AND 0 = ? AND id < ?))`
  const order = direction === 'after' ? 'ASC' : 'DESC'
  const readDeviceFirst = database.prepare(`${selectDeviceRows}
    ORDER BY timestamp ${order}, received_at ${order}, id ${order} LIMIT ?`)
  const readDeviceRows = database.prepare(`${selectDeviceRows}${keyPredicate}
    ORDER BY timestamp ${order}, received_at ${order}, id ${order} LIMIT ?`)
  const readDevicePage = (deviceId, boundary) => boundary === null
    ? readDeviceFirst.all(
        input.missionId, deviceId, input.selectedTime, input.selectedTime,
        input.selectedTime, batchSize,
      )
    : readDeviceRows.all(
        input.missionId, deviceId, input.selectedTime, input.selectedTime,
        input.selectedTime,
        boundary.effectiveAt, ...replayKeyParameters(boundary), batchSize,
      )
  const sources = deviceIds.flatMap((deviceId) => {
    const rows = readDevicePage(deviceId, key)
    return rows.length === 0 ? [] : [{
      rows,
      index: 0,
      fetchNext: (last) => readDevicePage(deviceId, replayKeyFromRow(last)),
    }]
  })
  const readGpxPage = (boundary) => readInitialGpxTrackRows(
    database, input, boundary, direction, batchSize,
  )
  const firstGpxPage = readGpxPage(key)
  if (firstGpxPage.length > 0) {
    sources.push({
      rows: firstGpxPage,
      index: 0,
      fetchNext: (last) => readGpxPage(replayKeyFromRow(last)),
    })
  }
  const rows = []
  while (rows.length < input.trackLimit) {
    let selectedSource = null
    for (const source of sources) {
      const candidate = source.rows[source.index]
      if (candidate !== undefined && (selectedSource === null
        || (direction === 'after'
          ? compareReplayTrackRows(candidate, selectedSource.rows[selectedSource.index]) < 0
          : compareReplayTrackRows(candidate, selectedSource.rows[selectedSource.index]) > 0))) {
        selectedSource = source
      }
    }
    if (selectedSource === null) break
    const selected = selectedSource.rows[selectedSource.index]
    rows.push(selected)
    selectedSource.index += 1
    if (selectedSource.index === selectedSource.rows.length
      && selectedSource.rows.length === batchSize) {
      selectedSource.rows = selectedSource.fetchNext(selected)
      selectedSource.index = 0
    }
  }
  if (direction === 'before') rows.reverse()
  const offset = direction === 'before'
    ? Math.max(0, Number(cursor?.offset ?? 0) - rows.length)
    : Number(cursor?.offset ?? 0)
  return { rows, offset }
}

/** Extracts the private deterministic order key retained only inside the replay worker. */
function replayKeyFromRow(row) {
  return {
    effectiveAt: row.effective_at,
    recordedAt: row.recorded_at,
    sourceOrder: Number(row.source_order),
    stableOrder: row.stable_order,
  }
}

/** Reads only GPX candidates adjacent to the requested deterministic keyset boundary. */
function readInitialGpxTrackRows(database, input, key, direction, candidateLimit) {
  const outingFilter = sqlIdFilter('eligible_gpx.outing_id', input.outingIds)
  const keyPredicate = key === null ? '' : direction === 'after'
    ? ` AND (points.source_time > ? OR (points.source_time = ? AND eligible_gpx.recorded_at > ?)
        OR (points.source_time = ? AND eligible_gpx.recorded_at = ? AND 1 > ?)
        OR (points.source_time = ? AND eligible_gpx.recorded_at = ? AND 1 = ? AND
          (eligible_gpx.import_id || ':' || printf('%08d', points.segment_index) || ':' ||
            printf('%08d', points.point_index)) > ?))`
    : ` AND (points.source_time < ? OR (points.source_time = ? AND eligible_gpx.recorded_at < ?)
        OR (points.source_time = ? AND eligible_gpx.recorded_at = ? AND 1 < ?)
        OR (points.source_time = ? AND eligible_gpx.recorded_at = ? AND 1 = ? AND
          (eligible_gpx.import_id || ':' || printf('%08d', points.segment_index) || ':' ||
            printf('%08d', points.point_index)) < ?))`
  const order = direction === 'after' ? 'ASC' : 'DESC'
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
      AND points.revision_sequence = eligible_gpx.source_revision_sequence
    WHERE eligible_gpx.replay_rank = 1 AND points.source_time IS NOT NULL
      AND points.source_time <= ?${outingFilter.sql}${keyPredicate}
    ORDER BY points.source_time ${order}, eligible_gpx.recorded_at ${order},
      eligible_gpx.import_id ${order}, points.segment_index ${order}, points.point_index ${order}
    LIMIT ?`).all(
    input.missionId, input.selectedTime, input.selectedTime,
    input.selectedTime, ...outingFilter.params,
    ...(key === null ? [] : replayKeyParameters(key)), candidateLimit,
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
  const outingFilter = sqlIdFilter('eligible_gpx.outing_id', input.outingIds)
  const row = database.prepare(`WITH eligible_gpx AS (
      SELECT revisions.import_id, revisions.revision_sequence,
        revisions.source_revision_sequence, revisions.outing_id,
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
          AND points.revision_sequence = eligible_gpx.source_revision_sequence
        WHERE eligible_gpx.replay_rank = 1
          AND points.source_time IS NOT NULL
          AND points.source_time <= ?${outingFilter.sql}`)
    .get(
      input.missionId, input.selectedTime, input.selectedTime,
      input.selectedTime, ...outingFilter.params,
    )
  return eligiblePositionCount + Number(row?.count ?? 0)
}

/** Aggregates exact-replay eligibility and explicit legacy gaps in one mission scan. */
function readPositionReplayStats(database, input) {
  const deviceFilter = sqlIdFilter('device_id', input.deviceIds)
  const hasReplayIndex = database.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_positions_replay_known_fix'`).get() !== undefined
  const hasUnknownTimeIndex = database.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_positions_replay_unknown_time'`).get() !== undefined
  const hasKnownAtIndexes = ['idx_positions_replay_known_at', 'idx_positions_replay_device_known_at']
    .every((name) => database.prepare(`SELECT 1 FROM sqlite_master
      WHERE type = 'index' AND name = ?`).get(name) !== undefined)
  const hasKnownDayCounts = database.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'mission_replay_position_day_counts'`).get() !== undefined
  const usesLegacyScanFallback = database.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'metadata'`).get() !== undefined
    && !(hasReplayIndex && hasUnknownTimeIndex && hasKnownAtIndexes && hasKnownDayCounts)
  if (hasReplayIndex && hasUnknownTimeIndex && hasKnownAtIndexes && hasKnownDayCounts) {
    const eligibleCount = countKnownReplayPositions(database, input)
    const missingRecorded = database.prepare(`SELECT COUNT(*) AS count
      FROM positions INDEXED BY idx_positions_replay_known_fix
      WHERE mission_id = ? AND timestamp_source = 'fix' AND received_at IS NULL${deviceFilter.sql}`)
      .get(input.missionId, ...deviceFilter.params)
    const unproved = database.prepare(`SELECT COUNT(*) AS count
      FROM positions INDEXED BY idx_positions_replay_unknown_time
      WHERE mission_id = ? AND timestamp_source IS NULL${deviceFilter.sql}`)
      .get(input.missionId, ...deviceFilter.params)
    return {
      eligibleCount,
      missingRecordedCount: Number(missingRecorded?.count ?? 0),
      unprovedTimeCount: Number(unproved?.count ?? 0),
      usesLegacyScanFallback: false,
    }
  }
  const row = database.prepare(`SELECT
      SUM(CASE WHEN timestamp_source = 'fix' AND received_at IS NOT NULL
        AND received_at <= ? AND timestamp <= ?
        AND COALESCE(timestamp_provenance_recorded_at, received_at) <= ?
        THEN 1 ELSE 0 END) AS eligible_count,
      SUM(CASE WHEN timestamp_source = 'fix' AND received_at IS NULL THEN 1 ELSE 0 END) AS missing_recorded_count,
      SUM(CASE WHEN timestamp_source IS NULL THEN 1 ELSE 0 END) AS unproved_time_count
    FROM positions INDEXED BY idx_positions_mission_device_timestamp
    WHERE mission_id = ?${deviceFilter.sql}`)
    .get(
      input.selectedTime, input.selectedTime, input.selectedTime,
      input.missionId, ...deviceFilter.params,
    )
  return {
    eligibleCount: Number(row?.eligible_count ?? 0),
    missingRecordedCount: Number(row?.missing_recorded_count ?? 0),
    unprovedTimeCount: Number(row?.unproved_time_count ?? 0),
    usesLegacyScanFallback,
  }
}

/** Counts exact fixes known by T from complete days plus one bounded indexed day slice. */
function countKnownReplayPositions(database, input) {
  const knownDay = input.selectedTime.slice(0, 10)
  const dayStart = `${knownDay}T00:00:00.000Z`
  const knownAtExpression = `MAX(
    timestamp, received_at, COALESCE(timestamp_provenance_recorded_at, received_at)
  )`
  if (input.deviceIds === null) {
    const completeDays = Number(database.prepare(`SELECT COALESCE(SUM(position_count), 0) AS count
      FROM mission_replay_position_day_counts
      WHERE mission_id = ? AND known_day < ?`).get(input.missionId, knownDay)?.count ?? 0)
    const partialDay = Number(database.prepare(`SELECT COUNT(*) AS count
      FROM positions INDEXED BY idx_positions_replay_known_at
      WHERE mission_id = ? AND timestamp_source = 'fix' AND received_at IS NOT NULL
        AND ${knownAtExpression} >= ? AND ${knownAtExpression} <= ?`)
      .get(input.missionId, dayStart, input.selectedTime)?.count ?? 0)
    return completeDays + partialDay
  }
  const completeDayCount = database.prepare(`SELECT COALESCE(SUM(position_count), 0) AS count
    FROM mission_replay_position_day_counts
    WHERE mission_id = ? AND device_id = ? AND known_day < ?`)
  const partialDayCount = database.prepare(`SELECT COUNT(*) AS count
    FROM positions INDEXED BY idx_positions_replay_device_known_at
    WHERE mission_id = ? AND device_id = ? AND timestamp_source = 'fix'
      AND received_at IS NOT NULL AND ${knownAtExpression} >= ? AND ${knownAtExpression} <= ?`)
  return input.deviceIds.reduce((total, deviceId) => total
    + Number(completeDayCount.get(input.missionId, deviceId, knownDay)?.count ?? 0)
    + Number(partialDayCount.get(
      input.missionId, deviceId, dayStart, input.selectedTime,
    )?.count ?? 0), 0)
}

function countStaticGpxPoints(database, input) {
  const outingFilter = sqlIdFilter('eligible.outing_id', input.outingIds)
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
      AND points.revision_sequence = eligible.source_revision_sequence
    WHERE eligible.replay_rank = 1 AND points.source_time IS NULL${outingFilter.sql}`)
    .get(input.missionId, input.selectedTime, input.selectedTime, ...outingFilter.params)
  return Number(row?.count ?? 0)
}

/** Returns bounded provenance summaries for static GPX evidence eligible at T. */
function readStaticGpxEvidence(database, input) {
  const outingFilter = sqlIdFilter('eligible.outing_id', input.outingIds)
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
            AND points.revision_sequence = eligible.source_revision_sequence
            AND points.source_time IS NULL) AS static_point_count,
        (SELECT COUNT(*) FROM gpx_evidence_rejections AS rejections
          WHERE rejections.import_id = eligible.import_id
            AND rejections.revision_sequence = eligible.source_revision_sequence) AS rejection_count
      FROM eligible
      WHERE eligible.replay_rank = 1${outingFilter.sql}
        AND (EXISTS (
            SELECT 1 FROM gpx_evidence_points AS points
            WHERE points.import_id = eligible.import_id
              AND points.revision_sequence = eligible.source_revision_sequence
              AND points.source_time IS NULL
          ) OR EXISTS (
            SELECT 1 FROM gpx_evidence_rejections AS rejections
            WHERE rejections.import_id = eligible.import_id
              AND rejections.revision_sequence = eligible.source_revision_sequence
          ))
    )`
  const parameters = [input.missionId, input.selectedTime, input.selectedTime, ...outingFilter.params]
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
  const hasEventReplayIndex = database.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_mission_events_replay'`).get() !== undefined
  const hasLegacyEventEnvelope = database.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'legacy_event_provenance_quarantine'`).get() !== undefined
  if (!hasEventReplayIndex && hasLegacyEventEnvelope) {
    limitations.push({
      code: 'legacy_event_replay_scan_fallback',
      message: 'This upgraded mission store retains the legacy event replay scan path; large historical seeks may be slower while current-position work remains prioritized.',
    })
  }
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
  const omittedLegacyState = database.prepare(`SELECT COUNT(*) AS count
    FROM mission_object_versions
    WHERE mission_id = ? AND completeness = 'legacy_baseline' AND recorded_at <= ?
      AND json_extract(state_json, '$.legacy_state_omitted') = 1`)
    .get(input.missionId, input.selectedTime)
  if (Number(omittedLegacyState?.count ?? 0) > 0) {
    limitations.push({
      code: 'legacy_object_state_retained_outside_replay',
      message: 'One or more over-envelope legacy evidence states remain retained in the mission store but Replay exposes only an explicit bounded baseline summary.',
      count: Number(omittedLegacyState.count),
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
      message: 'One or more migrated GPX imports retain an immutable original artifact and explicit reconstruction rejections; earlier revisions, exact source bytes, and source times are unknown.',
      count: Number(legacyGpx.count),
    })
  }
  const pendingLegacyGpx = database.prepare(`SELECT CASE WHEN
      safe.scanned_through_rowid < safe.scan_target_rowid
      OR unsafe.low_scanned_through_rowid > unsafe.low_target_rowid
      OR unsafe.high_scanned_through_rowid < unsafe.high_target_rowid
    THEN 1 ELSE 0 END AS count
    FROM legacy_gpx_backfill_state AS safe
    JOIN legacy_gpx_rowid_scan_state AS unsafe ON unsafe.singleton = safe.singleton
    WHERE safe.singleton = 1`).get()
  if (Number(pendingLegacyGpx?.count ?? 0) > 0) {
    limitations.push({
      code: 'legacy_gpx_backfill_pending',
      message: 'Legacy GPX evidence reconstruction inventory is still being verified in bounded background slices; original projections remain retained and mission lifecycle changes are blocked until it settles.',
      count: Number(pendingLegacyGpx.count),
    })
  }
  const quarantinedLegacyGpx = database.prepare(`SELECT COUNT(*) AS count
    FROM gpx_track_imports AS imports
    JOIN legacy_gpx_backfill_quarantine AS quarantine
      ON quarantine.source_rowid = imports.rowid
    WHERE imports.mission_id = ?`).get(input.missionId)
  if (Number(quarantinedLegacyGpx?.count ?? 0) > 0) {
    limitations.push({
      code: 'legacy_gpx_backfill_quarantined',
      message: 'One or more legacy GPX artifacts remain retained but are quarantined outside the safe reconstruction envelope (size, identity, or storage key). Mission completion and archive custody are blocked until a bounded repair path reconstructs them.',
      count: Number(quarantinedLegacyGpx.count),
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
  if (positionStats.usesLegacyScanFallback === true) {
    limitations.push({
      code: 'legacy_replay_scan_fallback',
      message: 'This upgraded mission store retains the bounded legacy replay scan path; large historical seeks may be slower while current-position work remains prioritized.',
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
  const futureLegacyLifecycle = database.prepare(`SELECT MIN(recorded_at) AS boundary_time
    FROM mission_events WHERE mission_id = ? AND recording_completeness = 'legacy_baseline'
      AND recorded_at > ?`).get(input.missionId, input.selectedTime)
  if (futureLegacyLifecycle?.boundary_time !== null
    && futureLegacyLifecycle?.boundary_time !== undefined) {
    limitations.push({
      code: 'legacy_lifecycle_history_unknown_before_baseline',
      message: 'Mission lifecycle history is unknown before the recorded migration baseline.',
      boundaryTime: futureLegacyLifecycle.boundary_time,
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
  const futureLegacyMembership = database.prepare(`SELECT MIN(recorded_at) AS boundary_time
    FROM mission_group_membership_events
    WHERE mission_id = ? AND recording_completeness = 'legacy_baseline'
      AND recorded_at > ?`).get(input.missionId, input.selectedTime)
  if (futureLegacyMembership?.boundary_time !== null
    && futureLegacyMembership?.boundary_time !== undefined) {
    limitations.push({
      code: 'legacy_membership_history_unknown_before_baseline',
      message: 'Group membership history is unknown before the recorded migration baseline.',
      boundaryTime: futureLegacyMembership.boundary_time,
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
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Mission replay input is invalid.')
  }
  if (typeof input.missionId !== 'string' || input.missionId.length < 1 || input.missionId.length > 200) {
    throw new Error('Mission replay mission ID is invalid.')
  }
  if (typeof input.selectedTime !== 'string'
    || input.selectedTime.length < 1
    || input.selectedTime.length > MAX_REPLAY_SELECTED_TIME_LENGTH
    || input.selectedTime !== input.selectedTime.trim()
    || !isStrictTrackingTimestamp(input.selectedTime)) {
    throw new Error('Mission replay selected time is invalid.')
  }
  const selectedTimeMs = Date.parse(input.selectedTime)
  if (!Number.isFinite(selectedTimeMs)) {
    throw new Error('Mission replay selected time is invalid.')
  }
  if (selectedTimeMs > Date.now()) {
    throw new Error('Mission replay selected time cannot be in the future.')
  }
  const timezone = input.timezone === undefined ? REPLAY_TIMEZONE : input.timezone
  if (timezone !== REPLAY_TIMEZONE) {
    throw new Error('Mission replay timezone is invalid.')
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
    selectedTime: new Date(selectedTimeMs).toISOString(),
    trackLimit: input.trackLimit,
    objectLimit,
    deviceIds: normalizeReplayFilterIds(input.deviceIds, 'device'),
    outingIds: normalizeReplayFilterIds(input.outingIds, 'outing'),
    timezone,
  }
}

/** Projects a renderer-originated request into the only fields a Replay worker accepts. */
function normalizeReplayWorkerQuery(input, kind) {
  const normalized = normalizeReplayInput(input)
  if (kind === 'state') return normalized
  if (kind === 'chunk') {
    normalizeReplayTrackCursor(input.cursor)
    return {
      ...normalized,
      ...(input.cursor === undefined || input.cursor === null || input.cursor === ''
        ? {}
        : { cursor: input.cursor }),
    }
  }
  if (kind === 'objects') {
    normalizeReplayObjectCursor(input.objectCursor)
    if (!Number.isSafeInteger(input.replayGeneration) || input.replayGeneration < 0) {
      throw new Error('Mission replay object snapshot generation is invalid.')
    }
    return {
      ...normalized,
      replayGeneration: input.replayGeneration,
      ...(input.objectCursor === undefined || input.objectCursor === null || input.objectCursor === ''
        ? {}
        : { objectCursor: input.objectCursor }),
    }
  }
  if (kind === 'filters') {
    if (input.filterKind !== 'outing') {
      throw new Error('Mission replay filter kind is invalid.')
    }
    const filterSearch = normalizeReplayFilterSearch(input.filterSearch)
    const filterLimit = normalizeReplayFilterPageLimit(input.filterLimit)
    if (input.filterCursor !== undefined && input.filterCursor !== null
      && (typeof input.filterCursor !== 'string' || input.filterCursor.length > 2_000)) {
      throw new Error('Mission replay filter cursor is invalid.')
    }
    return {
      ...normalized,
      filterKind: 'outing',
      filterSearch,
      filterLimit,
      ...(input.filterCursor === undefined || input.filterCursor === null
        || input.filterCursor === '' ? {} : { filterCursor: input.filterCursor }),
    }
  }
  throw new Error('Mission replay worker query kind is invalid.')
}

/** Validates one bounded display-only evidence-source filter. */
function normalizeReplayFilterIds(value, label) {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value) || value.length > MAX_REPLAY_FILTER_IDS) {
    throw new Error(`Mission replay ${label} filter is invalid.`)
  }
  const normalized = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '' || item.length > 200) {
      throw new Error(`Mission replay ${label} filter is invalid.`)
    }
    const id = item.trim()
    if (!normalized.includes(id)) normalized.push(id)
  }
  return normalized.sort((left, right) => left.localeCompare(right))
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

/** Decodes one opaque, versioned reconstructed-object continuation cursor. */
function normalizeReplayObjectCursor(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 2_000 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Mission replay object cursor is invalid.')
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (parsed?.v !== 4 || parsed.kind !== 'object'
      || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0
      || parsed.offset > MAX_REPLAY_CURSOR_OFFSET
      || !Number.isSafeInteger(parsed.replayGeneration) || parsed.replayGeneration < 0
      || !Number.isSafeInteger(parsed.eligibleObjectCount) || parsed.eligibleObjectCount < 0
      || typeof parsed.contextHash !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed.contextHash)) {
      throw new Error('invalid shape')
    }
    return parsed
  } catch {
    throw new Error('Mission replay object cursor is invalid.')
  }
}

/** Decodes one opaque, versioned, bidirectional exact-track cursor. */
function normalizeReplayTrackCursor(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 2_000 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Mission replay cursor is invalid.')
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (parsed?.v !== 4 || parsed.kind !== 'track'
      || !['after', 'before'].includes(parsed.direction)
      || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0
      || parsed.offset > MAX_REPLAY_CURSOR_OFFSET || !Array.isArray(parsed.key)
      || parsed.key.length !== 4 || typeof parsed.key[0] !== 'string'
      || typeof parsed.key[1] !== 'string' || ![0, 1].includes(parsed.key[2])
      || typeof parsed.key[3] !== 'string'
      || !Number.isSafeInteger(parsed.replayGeneration) || parsed.replayGeneration < 0
      || !Number.isSafeInteger(parsed.eligiblePositionCount)
      || parsed.eligiblePositionCount < 0
      || !Number.isSafeInteger(parsed.eligibleTrackCount) || parsed.eligibleTrackCount < 0
      || typeof parsed.contextHash !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed.contextHash)) {
      throw new Error('invalid shape')
    }
    return {
      direction: parsed.direction,
      offset: parsed.offset,
      replayGeneration: parsed.replayGeneration,
      eligiblePositionCount: parsed.eligiblePositionCount,
      eligibleTrackCount: parsed.eligibleTrackCount,
      contextHash: parsed.contextHash,
      key: {
        effectiveAt: parsed.key[0],
        recordedAt: parsed.key[1],
        sourceOrder: parsed.key[2],
        stableOrder: parsed.key[3],
      },
    }
  } catch {
    throw new Error('Mission replay cursor is invalid.')
  }
}

/** Encodes a deterministic track row boundary without exposing it as an SQL offset. */
function encodeReplayTrackCursor(
  direction,
  offset,
  row,
  replayGeneration = 0,
  eligiblePositionCount = 0,
  input,
  eligibleTrackCount = eligiblePositionCount,
) {
  const normalized = normalizeReplayCursorContextInput(input, replayGeneration)
  return Buffer.from(JSON.stringify({
    v: 4,
    kind: 'track',
    direction,
    offset,
    replayGeneration,
    eligiblePositionCount,
    eligibleTrackCount,
    contextHash: replayCursorContextHash('track', normalized, eligibleTrackCount),
    key: [row.effective_at, row.recorded_at, Number(row.source_order), row.stable_order],
  }), 'utf8').toString('base64url')
}

/** Encodes a bounded reconstructed-object continuation without exposing query context. */
function encodeReplayObjectCursor(offset, input, eligibleObjectCount) {
  const replayGeneration = input?.replayGeneration
  if (!Number.isSafeInteger(replayGeneration) || replayGeneration < 0
    || !Number.isSafeInteger(offset) || offset < 0 || offset > MAX_REPLAY_CURSOR_OFFSET
    || !Number.isSafeInteger(eligibleObjectCount) || eligibleObjectCount < 0) {
    throw new Error('Mission replay object cursor is invalid.')
  }
  const normalized = normalizeReplayCursorContextInput(input, replayGeneration)
  return Buffer.from(JSON.stringify({
    v: 4,
    kind: 'object',
    offset,
    replayGeneration,
    eligibleObjectCount,
    contextHash: replayCursorContextHash('object', normalized, eligibleObjectCount),
  }), 'utf8').toString('base64url')
}

/** Normalizes the request fields that bind a continuation to one replay query. */
function normalizeReplayCursorContextInput(input, replayGeneration) {
  const normalized = normalizeReplayInput(input)
  return { ...normalized, replayGeneration }
}

/** Returns a fixed-size fingerprint for all fields that define one replay page chain. */
function replayCursorContextHash(kind, input, eligibleSnapshotCount) {
  return createHash('sha256').update(JSON.stringify({
    kind,
    missionId: input.missionId,
    selectedTime: input.selectedTime,
    deviceIds: input.deviceIds,
    outingIds: input.outingIds,
    timezone: input.timezone,
    replayGeneration: input.replayGeneration,
    eligibleSnapshotCount,
  })).digest('hex')
}

/** Reads the bounded mission generation used to invalidate newly queryable evidence chains. */
function readMissionReplayGeneration(database, missionId) {
  const hasGenerationTable = database.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'mission_replay_generations'`).get() !== undefined
  if (!hasGenerationTable) return 0
  return Number(database.prepare(`SELECT generation FROM mission_replay_generations
    WHERE mission_id = ?`).get(missionId)?.generation ?? 0)
}

/** Expands a replay order key for the explicit SQLite lexicographic predicate. */
function replayKeyParameters(key) {
  return [
    key.effectiveAt,
    key.effectiveAt, key.recordedAt,
    key.effectiveAt, key.recordedAt, key.sourceOrder,
    key.effectiveAt, key.recordedAt, key.sourceOrder, key.stableOrder,
  ]
}

/** Builds a parameterized, bounded IN filter; an explicit empty list matches no source. */
function sqlIdFilter(column, ids) {
  if (ids === null) return { sql: '', params: [] }
  if (ids.length === 0) return { sql: ' AND 0', params: [] }
  return { sql: ` AND ${column} IN (${ids.map(() => '?').join(', ')})`, params: ids }
}

/** Lists bounded Traccar device filter choices known by the selected replay time. */
function readAvailableDeviceIds(database, input) {
  const hasDevicesTable = database.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'devices'`).get() !== undefined
  const rows = hasDevicesTable
    ? database.prepare(`SELECT devices.device_id FROM devices
        WHERE devices.mission_id = ?
          AND EXISTS (
            SELECT 1 FROM positions
            WHERE positions.mission_id = devices.mission_id
              AND positions.device_id = devices.device_id
              AND positions.timestamp_source = 'fix'
              AND positions.timestamp <= ?
              AND positions.received_at <= ?
              AND COALESCE(
                positions.timestamp_provenance_recorded_at,
                positions.received_at
              ) <= ?
            LIMIT 1
          )
        ORDER BY devices.device_id ASC LIMIT ?`)
      .all(
        input.missionId,
        input.selectedTime,
        input.selectedTime,
        input.selectedTime,
        MAX_REPLAY_FILTER_IDS,
      )
    : database.prepare(`SELECT DISTINCT device_id FROM positions
        WHERE mission_id = ? AND timestamp_source = 'fix'
          AND timestamp <= ? AND received_at <= ?
          AND COALESCE(timestamp_provenance_recorded_at, received_at) <= ?
        ORDER BY device_id ASC LIMIT ?`)
      .all(
        input.missionId,
        input.selectedTime,
        input.selectedTime,
        input.selectedTime,
        MAX_REPLAY_FILTER_IDS,
      )
  return rows
    .map((row) => row.device_id)
}

/** Normalizes one bounded filter-choice search substring. */
function normalizeReplayFilterSearch(value) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > MAX_REPLAY_FILTER_SEARCH_LENGTH) {
    throw new Error('Mission replay filter search is invalid.')
  }
  return value.trim()
}

/** Normalizes one bounded filter-choice page size. */
function normalizeReplayFilterPageLimit(value) {
  const limit = value ?? MAX_REPLAY_FILTER_PAGE_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REPLAY_FILTER_PAGE_LIMIT) {
    throw new Error(
      `Mission replay filter page limit must be between 1 and ${MAX_REPLAY_FILTER_PAGE_LIMIT}.`,
    )
  }
  return limit
}

/** Escapes a literal Replay filter substring for SQLite LIKE. */
function escapeReplayFilterSearch(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

/** Encodes a replay-generation and query-bound filter continuation. */
function encodeReplayFilterCursor(value) {
  return Buffer.from(JSON.stringify({ v: 1, ...value }), 'utf8').toString('base64url')
}

/** Decodes and verifies a Replay filter continuation before SQLite use. */
function decodeReplayFilterCursor(value, input) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 2_000) {
    throw new Error('Mission replay filter cursor is invalid.')
  }
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Mission replay filter cursor is invalid.')
  }
  if (parsed?.v !== 1 || parsed.missionId !== input.missionId
    || parsed.selectedTime !== input.selectedTime
    || parsed.replayGeneration !== input.replayGeneration
    || parsed.filterKind !== input.filterKind || parsed.search !== input.search
    || typeof parsed.lastId !== 'string' || parsed.lastId.length < 1
    || parsed.lastId.length > 200) {
    throw new Error('Mission replay filter cursor is invalid.')
  }
  return parsed
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
  missionLifecycleStateFromEventType,
  normalizeReplayInput,
  normalizeReplayWorkerQuery,
  encodeReplayObjectCursor,
  encodeReplayTrackCursor,
  readMissionReplayObjectChunk,
  readMissionReplayFilterPage,
  readMissionReplayState,
  readMissionReplayTrackChunk,
}
