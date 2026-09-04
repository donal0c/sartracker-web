'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const Database = require('better-sqlite3')
const { enumerateArchiveAttachments } = require('./archive-attachments.cjs')
const { canonicalJson } = require('./archive-container.cjs')
const {
  ARCHIVE_INVENTORY_VERSION,
  ARCHIVE_TABLE_INVENTORY,
  computeArchivedTableContentDigest,
  computeTableContentDigest,
  createArchiveTableSelection,
  reconcileArchiveInventory,
} = require('./archive-inventory.cjs')
const {
  assertArchiveGpxCustodyReady,
  computeArchiveGpxContentProof,
} = require('./archive-gpx-proof.cjs')
const { computeMissionReplaySemanticProof } = require('./archive-replay-proof.cjs')
const {
  readCurrentMissionFinalizationBoundary,
} = require('./mission-finalization-boundary.cjs')
const {
  ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_NAMES,
  ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_SQL,
  assertArchiveCleanupMembershipGeneration,
} = require('./archive-cleanup-membership.cjs')

const CURRENT_SCHEMA_VERSION = 13
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const MAX_COPY_BATCH_ROWS = 64
const MAX_COPY_BATCH_BYTES = 4 * 1024 * 1024
const COPY_PROGRESS_INTERVAL_ROWS = 4_096
const EXPECTED_INDEX_NAMES = Object.freeze([
  'idx_coverage_chunks_mission',
  'idx_coverage_invalidations_pending',
  'idx_gpx_import_content',
  'idx_gpx_import_failures_mission',
  'idx_gpx_import_receipts_unsettled',
  'idx_gpx_points_replay',
  'idx_gpx_revisions_replay',
  'idx_group_membership_mission_team',
  'idx_ingest_anomalies_mission_created',
  'idx_mission_archives_custody',
  'idx_mission_events_replay',
  'idx_mission_object_versions_replay',
  'idx_mission_participants_active_device',
  'idx_mission_participants_active_group',
  'idx_mission_participants_mission',
  'idx_missions_status',
  'idx_outings_mission_active',
  'idx_outings_mission_started',
  'idx_position_revisions_position_corrected',
  'idx_positions_mission_device_timestamp',
  'idx_positions_mission_source_position_id',
  'idx_positions_replay_device_known_at',
  'idx_positions_replay_known_at',
  'idx_positions_replay_known_fix',
  'idx_positions_replay_unknown_time',
  'idx_search_areas_mission',
  'idx_search_assignments_mission',
  'idx_search_passes_mission',
])
const EXPECTED_TRIGGER_NAMES = Object.freeze([
  ...ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_NAMES,
  'positions_replay_day_count_delete',
  'positions_replay_day_count_insert',
  'positions_replay_day_count_update',
])
const CANONICAL_MISSING_REPLAY_OBJECTS = Object.freeze({
  ...ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_SQL,
  idx_mission_events_replay: `CREATE INDEX idx_mission_events_replay
    ON mission_events(mission_id, timestamp, event_type, id)`,
  idx_positions_replay_known_fix: `CREATE INDEX idx_positions_replay_known_fix
    ON positions(mission_id, received_at, timestamp_provenance_recorded_at, timestamp, id)
    WHERE timestamp_source = 'fix'`,
  idx_positions_replay_unknown_time: `CREATE INDEX idx_positions_replay_unknown_time
    ON positions(mission_id) WHERE timestamp_source IS NULL`,
  idx_positions_replay_known_at: `CREATE INDEX idx_positions_replay_known_at
    ON positions(
      mission_id,
      MAX(timestamp, received_at, COALESCE(timestamp_provenance_recorded_at, received_at))
    ) WHERE timestamp_source = 'fix' AND received_at IS NOT NULL`,
  idx_positions_replay_device_known_at: `CREATE INDEX idx_positions_replay_device_known_at
    ON positions(
      mission_id,
      device_id,
      MAX(timestamp, received_at, COALESCE(timestamp_provenance_recorded_at, received_at))
    ) WHERE timestamp_source = 'fix' AND received_at IS NOT NULL`,
  positions_replay_day_count_insert: `CREATE TRIGGER positions_replay_day_count_insert
    AFTER INSERT ON positions
    WHEN NEW.timestamp_source = 'fix' AND NEW.received_at IS NOT NULL
    BEGIN
      INSERT INTO mission_replay_position_day_counts (
        mission_id, device_id, known_day, position_count
      ) VALUES (
        NEW.mission_id,
        NEW.device_id,
        substr(MAX(NEW.timestamp, NEW.received_at,
          COALESCE(NEW.timestamp_provenance_recorded_at, NEW.received_at)), 1, 10),
        1
      ) ON CONFLICT(mission_id, device_id, known_day)
      DO UPDATE SET position_count = position_count + 1;
    END`,
  positions_replay_day_count_update: `CREATE TRIGGER positions_replay_day_count_update
    AFTER UPDATE OF mission_id, device_id, timestamp, received_at,
      timestamp_source, timestamp_provenance_recorded_at ON positions
    BEGIN
      UPDATE mission_replay_position_day_counts
      SET position_count = position_count - 1
      WHERE OLD.timestamp_source = 'fix' AND OLD.received_at IS NOT NULL
        AND mission_id = OLD.mission_id AND device_id = OLD.device_id
        AND known_day = substr(MAX(OLD.timestamp, OLD.received_at,
          COALESCE(OLD.timestamp_provenance_recorded_at, OLD.received_at)), 1, 10);
      INSERT INTO mission_replay_position_day_counts (
        mission_id, device_id, known_day, position_count
      ) SELECT
        NEW.mission_id,
        NEW.device_id,
        substr(MAX(NEW.timestamp, NEW.received_at,
          COALESCE(NEW.timestamp_provenance_recorded_at, NEW.received_at)), 1, 10),
        1
      WHERE NEW.timestamp_source = 'fix' AND NEW.received_at IS NOT NULL
      ON CONFLICT(mission_id, device_id, known_day)
      DO UPDATE SET position_count = position_count + 1;
    END`,
  positions_replay_day_count_delete: `CREATE TRIGGER positions_replay_day_count_delete
    AFTER DELETE ON positions
    WHEN OLD.timestamp_source = 'fix' AND OLD.received_at IS NOT NULL
    BEGIN
      UPDATE mission_replay_position_day_counts
      SET position_count = position_count - 1
      WHERE mission_id = OLD.mission_id AND device_id = OLD.device_id
        AND known_day = substr(MAX(OLD.timestamp, OLD.received_at,
          COALESCE(OLD.timestamp_provenance_recorded_at, OLD.received_at)), 1, 10);
    END`,
})

/** Stable archive scratch error with no mission content in its message. */
class ArchiveScratchError extends Error {
  /** Creates a typed extraction failure. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveScratchError'
    this.code = code
  }
}

/** Quotes one inventory-validated SQLite identifier. */
function quoteIdentifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new ArchiveScratchError('ARCHIVE_SCOPE_INVALID', 'Archive schema identifier is unsafe.')
  }
  return `"${value}"`
}

/** Throws a stable cancellation at bounded extraction boundaries. */
function assertNotCancelled(input) {
  if (input.isCancelled?.() === true) {
    throw new ArchiveScratchError('ARCHIVE_CANCELLED', 'Mission archive extraction was cancelled.')
  }
}

/** Validates the immutable request-event row and live PR5 fence inside the pinned snapshot. */
function assertRequestFence(source, input) {
  const mission = source.prepare('SELECT id, status FROM missions WHERE id = ?').get(input.missionId)
  if (mission === undefined || !['finished', 'finalized'].includes(mission.status)) {
    throw new ArchiveScratchError(
      'ARCHIVE_SCOPE_INVALID',
      'Mission archive source is not a finished or finalized mission.',
    )
  }
  const requestEvent = source.prepare(`SELECT rowid AS event_rowid, id, mission_id,
      event_type, timestamp, details_json
    FROM mission_events WHERE id = ?`).get(input.requestEventId)
  const expectedEventType = input.archiveKind === 'finalized'
    ? 'mission_finalize_requested'
    : 'mission_archive_requested'
  if (
    requestEvent === undefined
    || Number(requestEvent.event_rowid) !== input.requestEventRowid
    || requestEvent.id !== input.requestEventId
    || requestEvent.mission_id !== input.missionId
    || requestEvent.event_type !== expectedEventType
    || requestEvent.timestamp !== input.fenceRequestedAt
  ) {
    throw new ArchiveScratchError(
      'ARCHIVE_SCOPE_INVALID',
      'Mission archive request identity does not match the immutable fence event.',
    )
  }
  let details
  try {
    details = JSON.parse(requestEvent.details_json)
  } catch {
    throw new ArchiveScratchError(
      'ARCHIVE_SCOPE_INVALID',
      'Mission archive request event details are invalid.',
    )
  }
  if (
    details === null
    || typeof details !== 'object'
    || Array.isArray(details)
    || details.archive_id !== input.archiveId
    || details.operation_id !== input.operationId
    || details.archive_kind !== input.archiveKind
    || details.archive_relative_path !== `${input.archiveId}.sararch`
    || !Number.isSafeInteger(details.cleanup_membership_generation)
    || details.cleanup_membership_generation < 0
    || details.protected_finalization_epoch !== input.protectedFinalizationEpoch
  ) {
    throw new ArchiveScratchError(
      'ARCHIVE_SCOPE_INVALID',
      'Mission archive request event does not bind the planned custody identity.',
    )
  }
  try {
    assertArchiveCleanupMembershipGeneration(source, {
      missionId: input.missionId,
      expectedGeneration: details.cleanup_membership_generation,
    })
  } catch {
    throw new ArchiveScratchError(
      'ARCHIVE_SOURCE_CHANGED',
      'Mission archive cleanup membership changed after its immutable request event.',
    )
  }
  if (input.finalizationProjection !== undefined
    && input.finalizationProjection !== null
    && input.finalizationProjection.cleanupMembershipGeneration
      !== details.cleanup_membership_generation) {
    throw new ArchiveScratchError(
      'ARCHIVE_SCOPE_INVALID',
      'Mission archive finalization projection does not match its cleanup membership boundary.',
    )
  }
  if (input.protectedFinalizationEpoch !== null) {
    const finalizationBoundary = readCurrentMissionFinalizationBoundary(source, {
      missionId: input.missionId,
    })
    if (finalizationBoundary?.eventRowid !== input.protectedFinalizationEpoch) {
      throw new ArchiveScratchError(
        'ARCHIVE_SCOPE_INVALID',
        'Mission archive protected finalization epoch is not current.',
      )
    }
  }
  const fence = source.prepare(`SELECT requested_at FROM mission_finalization_fences
    WHERE mission_id = ?`).get(input.missionId)
  if (fence?.requested_at !== input.fenceRequestedAt) {
    throw new ArchiveScratchError(
      'ARCHIVE_SCOPE_INVALID',
      'Mission archive evidence fence is missing or changed.',
    )
  }
  return mission
}

/** Reads exactly the declared table DDL from the pinned source. */
function readTableSchema(source) {
  const rows = source.prepare(`SELECT name, sql FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name`).all()
  if (
    rows.length !== ARCHIVE_TABLE_INVENTORY.length
    || rows.some((row) => typeof row.sql !== 'string' || row.sql.trim() === '')
  ) {
    throw new ArchiveScratchError(
      'ARCHIVE_SCOPE_INVALID',
      'Mission archive source table schema is incomplete.',
    )
  }
  return rows
}

/** Creates the empty full-schema scratch without indexes or triggers. */
function createScratchSchema(scratch, tableSchema) {
  scratch.pragma('foreign_keys = OFF')
  for (const row of tableSchema) scratch.prepare(row.sql).run()
}

/** Reads stored columns and deterministic row order for one table. */
function readTableShape(db, tableName) {
  const columns = db.prepare(`PRAGMA table_xinfo(${quoteIdentifier(tableName)})`).all()
    .filter((column) => Number(column.hidden) === 0)
    .sort((left, right) => Number(left.cid) - Number(right.cid))
  const definition = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(tableName)
  const withoutRowid = Boolean(definition && /\bWITHOUT\s+ROWID\b/iu.test(definition.sql || ''))
  const primaryKeyColumns = columns
    .filter((column) => Number(column.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((column) => column.name)
  return {
    columns: columns.map((column) => column.name),
    includesRowid: !withoutRowid,
    orderColumns: primaryKeyColumns.length > 0 ? primaryKeyColumns : ['_rowid_'],
  }
}

/** Returns a conservative byte estimate for one SQLite row batch. */
function estimateRowBytes(row) {
  let bytes = 0
  for (const value of row) {
    if (typeof value === 'string') bytes += Buffer.byteLength(value, 'utf8')
    else if (Buffer.isBuffer(value) || value instanceof Uint8Array) bytes += value.byteLength
    else bytes += 16
  }
  return bytes
}

/** Copies one declared source selection in bounded batches while preserving hidden rowid. */
function copyIncludedTable(source, scratch, input, declaration, onProgress) {
  const shape = readTableShape(source, declaration.tableName)
  const selection = createArchiveTableSelection({
    tableName: declaration.tableName,
    missionId: input.missionId,
    schemaVersion: input.schemaVersion,
  })
  const selectTerms = [
    ...(shape.includesRowid ? ['archive_row._rowid_'] : []),
    ...shape.columns.map((column) => `archive_row.${quoteIdentifier(column)}`),
  ]
  const orderTerms = shape.orderColumns.map((column) => column === '_rowid_'
    ? 'archive_row._rowid_'
    : `archive_row.${quoteIdentifier(column)}`)
  const reader = source.prepare(`SELECT ${selectTerms.join(', ')}
    FROM ${quoteIdentifier(declaration.tableName)} AS archive_row
    WHERE ${selection.whereSql}
    ORDER BY ${orderTerms.join(', ')}`).safeIntegers(true).raw(true)
  const insertColumns = [
    ...(shape.includesRowid ? ['rowid'] : []),
    ...shape.columns,
  ]
  const placeholders = insertColumns.map(() => '?').join(', ')
  const writer = scratch.prepare(`INSERT INTO ${quoteIdentifier(declaration.tableName)} (
      ${insertColumns.map(quoteIdentifier).join(', ')}
    ) VALUES (${placeholders})`)
  const writeBatch = scratch.transaction((rows) => {
    for (const row of rows) writer.run(...row)
  })
  let batch = []
  let batchBytes = 0
  let copiedRows = 0
  let lastProgressRows = 0
  for (const row of reader.iterate(...selection.parameters)) {
    assertNotCancelled(input)
    const rowBytes = estimateRowBytes(row)
    if (batch.length > 0 && (
      batch.length >= MAX_COPY_BATCH_ROWS
      || batchBytes + rowBytes > MAX_COPY_BATCH_BYTES
    )) {
      writeBatch(batch)
      batch = []
      batchBytes = 0
    }
    batch.push(row)
    batchBytes += rowBytes
    copiedRows += 1
    if (copiedRows === 1 || copiedRows - lastProgressRows >= COPY_PROGRESS_INTERVAL_ROWS) {
      onProgress?.(Object.freeze({ rowsProcessed: copiedRows }))
      lastProgressRows = copiedRows
    }
  }
  if (batch.length > 0) writeBatch(batch)
  if (copiedRows > lastProgressRows) {
    onProgress?.(Object.freeze({ rowsProcessed: copiedRows }))
  }
  return copiedRows
}

/** Converts local row counters into one monotonic public phase counter. */
function createRowProgressForwarder(input, phase) {
  let phaseRows = 0
  return (detail) => {
    let localRows = 0
    return (progress) => {
      if (!Number.isSafeInteger(progress?.rowsProcessed)
        || progress.rowsProcessed < 1 || progress.rowsProcessed <= localRows
        || phaseRows > Number.MAX_SAFE_INTEGER - (progress.rowsProcessed - localRows)) {
        throw new ArchiveScratchError(
          'ARCHIVE_SCOPE_INVALID',
          'Mission archive scratch row progress is invalid.',
        )
      }
      phaseRows += progress.rowsProcessed - localRows
      localRows = progress.rowsProcessed
      input.onProgress?.({
        phase,
        unit: 'rows',
        completed: phaseRows,
        total: null,
        detail,
      })
    }
  }
}

/** Rebuilds only declared derived read models from archived primary evidence. */
function rebuildDerivedTables(scratch, missionId) {
  scratch.prepare('DELETE FROM mission_replay_generations').run()
  scratch.prepare(`INSERT INTO mission_replay_generations (mission_id, generation)
    VALUES (?, 1)`).run(missionId)
  scratch.prepare('DELETE FROM mission_replay_position_day_counts').run()
  scratch.prepare(`INSERT INTO mission_replay_position_day_counts (
      mission_id, device_id, known_day, position_count
    ) SELECT mission_id, device_id,
      substr(MAX(timestamp, received_at,
        COALESCE(timestamp_provenance_recorded_at, received_at)), 1, 10),
      COUNT(*)
    FROM positions
    WHERE mission_id = ? AND timestamp_source = 'fix' AND received_at IS NOT NULL
    GROUP BY mission_id, device_id,
      substr(MAX(timestamp, received_at,
        COALESCE(timestamp_provenance_recorded_at, received_at)), 1, 10)`).run(missionId)
  scratch.prepare('DELETE FROM ingest_anomaly_devices').run()
  scratch.prepare(`INSERT INTO ingest_anomaly_devices (
      mission_id, device_id, conflict_count, rejected_count
    ) SELECT mission_id, device_id,
      SUM(CASE WHEN kind = 'conflict' THEN 1 ELSE 0 END),
      SUM(CASE WHEN kind = 'rejected' THEN 1 ELSE 0 END)
    FROM ingest_anomalies WHERE device_id IS NOT NULL
    GROUP BY mission_id, device_id`).run()
  scratch.prepare('DELETE FROM ingest_anomaly_mission_health').run()
  scratch.prepare(`INSERT INTO ingest_anomaly_mission_health (
      mission_id, conflict_count, rejected_count, affected_device_count
    ) SELECT mission_id,
      SUM(CASE WHEN kind = 'conflict' THEN 1 ELSE 0 END),
      SUM(CASE WHEN kind = 'rejected' THEN 1 ELSE 0 END),
      COUNT(DISTINCT device_id)
    FROM ingest_anomalies GROUP BY mission_id`).run()
}

/** Installs the exact named source indexes and triggers after bulk extraction. */
function installPostLoadObjects(source, scratch) {
  const objects = source.prepare(`SELECT type, name, sql FROM sqlite_master
    WHERE type IN ('index', 'trigger') AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
    ORDER BY type, name`).all()
  const indexes = objects.filter((row) => row.type === 'index')
  const triggers = objects.filter((row) => row.type === 'trigger')
  if (indexes.some((row) => !EXPECTED_INDEX_NAMES.includes(row.name))
    || triggers.some((row) => !EXPECTED_TRIGGER_NAMES.includes(row.name))) {
    throw new ArchiveScratchError(
      'ARCHIVE_SCOPE_INVALID',
      'Mission archive source indexes or triggers do not match schema v13.',
    )
  }
  const sourceSql = new Map(objects.map((row) => [row.name, row.sql]))
  for (const name of [...EXPECTED_INDEX_NAMES, ...EXPECTED_TRIGGER_NAMES]) {
    const sql = sourceSql.get(name) ?? CANONICAL_MISSING_REPLAY_OBJECTS[name]
    if (typeof sql !== 'string') {
      throw new ArchiveScratchError(
        'ARCHIVE_SCOPE_INVALID',
        'Mission archive source is missing a required schema object.',
      )
    }
    scratch.prepare(sql).run()
  }
}

/** Produces an authenticated schema-ledger identity for manifest verification. */
function createSchemaLedger(scratch) {
  const rows = scratch.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE type IN ('table', 'index', 'trigger')
      AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
    ORDER BY type, name`).all()
  const canonicalRows = rows.map((row) => ({
    name: row.name,
    sql: row.sql,
    tableName: row.tbl_name,
    type: row.type,
  }))
  return Object.freeze({
    tableCount: canonicalRows.filter((row) => row.type === 'table').length,
    indexCount: canonicalRows.filter((row) => row.type === 'index').length,
    triggerCount: canonicalRows.filter((row) => row.type === 'trigger').length,
    sha256: createHash('sha256').update(JSON.stringify(canonicalRows), 'utf8').digest('hex'),
  })
}

/** Removes only one explicitly owned scratch SQLite file set. */
function removeScratchFileSet(databasePath) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      fs.rmSync(`${databasePath}${suffix}`, { force: true })
    } catch {
      // Preserve the original extraction failure; the worker reports cleanup separately.
    }
  }
}

/** Adds the terminal finalized projection that is committed after archive bytes are sealed. */
function applyFinalizationProjection(scratch, input) {
  const projection = input.finalizationProjection
  if (projection === undefined || projection === null) return false
  const mission = scratch.prepare('SELECT status FROM missions WHERE id = ?')
    .get(input.missionId)
  if (mission?.status !== 'finished') {
    throw new ArchiveScratchError(
      'ARCHIVE_SCOPE_INVALID',
      'Mission archive finalization projection requires a finished mission snapshot.',
    )
  }
  const existingFinalization = scratch.prepare(`SELECT id FROM mission_events
    WHERE id = ?`).get(projection.eventId)
  if (existingFinalization !== undefined) {
    throw new ArchiveScratchError(
      'ARCHIVE_SCOPE_INVALID',
      'Mission archive finalization projection event identity is already present.',
    )
  }
  if (projection.supplement !== null) {
    scratch.prepare(`INSERT INTO mission_events (
      id, mission_id, event_type, timestamp, details_json, recorded_at, recording_completeness
    ) VALUES (?, ?, 'mission_archive_supplement_recorded', ?, ?, ?, 'complete')`).run(
      projection.supplement.eventId,
      input.missionId,
      projection.timestamp,
      JSON.stringify({
        archive_id: input.archiveId,
        previous_archive_id: input.previousArchiveId,
        supplement_sequence: projection.supplement.sequence,
        authority: projection.supplement.authority,
        reason: projection.supplement.reason,
        resulting_status: 'finalized',
      }),
      projection.recordedAt,
    )
  }
  scratch.prepare('UPDATE missions SET status = ? WHERE id = ?')
    .run('finalized', input.missionId)
  scratch.prepare(`INSERT INTO mission_events (
    id, mission_id, event_type, timestamp, details_json, recorded_at, recording_completeness
  ) VALUES (?, ?, 'mission_finalized', ?, ?, ?, 'complete')`).run(
    projection.eventId,
    input.missionId,
    projection.timestamp,
    JSON.stringify({
      resulting_status: 'finalized',
      archive_id: input.archiveId,
      archive_path: projection.archivePath,
      archive_relative_path: projection.archiveRelativePath,
      cleanup_membership_generation: projection.cleanupMembershipGeneration,
      container_version: 2,
    }),
    projection.recordedAt,
  )
  return true
}

/** Validates the bounded projected terminal lifecycle identity supplied by the main store. */
function assertFinalizationProjection(input) {
  const projection = input.finalizationProjection
  if (projection === undefined || projection === null) return
  if (input.archiveKind !== 'finalized'
    || projection === null
    || typeof projection !== 'object'
    || Array.isArray(projection)
    || !UUID_V4.test(projection.eventId)
    || typeof projection.timestamp !== 'string'
    || Number.isNaN(Date.parse(projection.timestamp))
    || new Date(projection.timestamp).toISOString() !== projection.timestamp
    || typeof projection.recordedAt !== 'string'
    || Number.isNaN(Date.parse(projection.recordedAt))
    || new Date(projection.recordedAt).toISOString() !== projection.recordedAt
    || typeof projection.archivePath !== 'string'
    || !path.isAbsolute(projection.archivePath)
    || path.resolve(projection.archivePath) !== projection.archivePath
    || projection.archiveRelativePath !== `${input.archiveId}.sararch`
    || !Number.isSafeInteger(projection.cleanupMembershipGeneration)
    || projection.cleanupMembershipGeneration < 0
    || !Object.hasOwn(projection, 'supplement')) {
    throw new ArchiveScratchError(
      'ARCHIVE_SCOPE_INVALID',
      'Mission archive finalization projection identity is invalid.',
    )
  }
  if (projection.supplement === null) return
  const supplement = projection.supplement
  if (supplement === null
    || typeof supplement !== 'object'
    || Array.isArray(supplement)
    || !UUID_V4.test(supplement.eventId)
    || !Number.isSafeInteger(supplement.sequence)
    || supplement.sequence < 1
    || typeof supplement.authority !== 'string'
    || supplement.authority.length < 1
    || supplement.authority.length > 200
    || typeof supplement.reason !== 'string'
    || supplement.reason.length < 1
    || supplement.reason.length > 2_000
    || input.previousArchiveId === null
    || typeof input.previousArchiveId !== 'string') {
    throw new ArchiveScratchError(
      'ARCHIVE_SCOPE_INVALID',
      'Mission archive supplement projection identity is invalid.',
    )
  }
}

/**
 * Creates and exhaustively proves one mission-scoped v13 SQLite scratch database.
 * The live source is opened read-only and held in one pinned transaction throughout.
 */
function createMissionArchiveScratch(input) {
  if (
    !input
    || input.schemaVersion !== CURRENT_SCHEMA_VERSION
    || input.inventoryVersion !== ARCHIVE_INVENTORY_VERSION
    || typeof input.sourceDatabasePath !== 'string'
    || typeof input.scratchDatabasePath !== 'string'
    || !path.isAbsolute(input.sourceDatabasePath)
    || !path.isAbsolute(input.scratchDatabasePath)
  ) {
    throw new ArchiveScratchError(
      'ARCHIVE_SCOPE_INVALID',
      'Mission archive scratch input is invalid.',
    )
  }
  assertFinalizationProjection(input)
  fs.mkdirSync(path.dirname(input.scratchDatabasePath), { recursive: true, mode: 0o700 })
  let source
  let scratch
  let success = false
  try {
    const descriptor = fs.openSync(input.scratchDatabasePath, 'wx', 0o600)
    fs.closeSync(descriptor)
    source = new Database(input.sourceDatabasePath, { readonly: true, fileMustExist: true })
    source.pragma('query_only = ON')
    source.exec('BEGIN')
    source.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()
    assertNotCancelled(input)
    const inventory = reconcileArchiveInventory(source, { schemaVersion: input.schemaVersion })
    if (inventory.inventoryVersion !== input.inventoryVersion) {
      throw new ArchiveScratchError(
        'ARCHIVE_SCOPE_INVALID',
        'Mission archive inventory version changed during extraction.',
      )
    }
    const mission = assertRequestFence(source, input)
    assertArchiveGpxCustodyReady(source, {
      missionId: input.missionId,
      isCancelled: input.isCancelled,
    })
    const tableSchema = readTableSchema(source)
    scratch = new Database(input.scratchDatabasePath)
    scratch.pragma('journal_mode = DELETE')
    scratch.pragma('synchronous = FULL')
    createScratchSchema(scratch, tableSchema)

    const sourceProofs = new Map()
    const declarations = ARCHIVE_TABLE_INVENTORY
      .filter((entry) => entry.sinceSchemaVersion <= input.schemaVersion)
    const included = declarations.filter((entry) =>
      entry.decision === 'mission_rows' || entry.decision === 'global_rows')
    const forwardExtractRows = createRowProgressForwarder(input, 'extract')
    input.onProgress?.({
      phase: 'extract', unit: 'rows', completed: 0, total: null, detail: 'mission-scope',
    })
    for (const declaration of included) {
      assertNotCancelled(input)
      const sourceProof = computeTableContentDigest(source, {
        tableName: declaration.tableName,
        missionId: input.missionId,
        schemaVersion: input.schemaVersion,
        isCancelled: input.isCancelled,
        onProgress: forwardExtractRows(declaration.tableName),
      })
      const copiedRows = copyIncludedTable(
        source,
        scratch,
        input,
        declaration,
        forwardExtractRows(declaration.tableName),
      )
      if (copiedRows !== sourceProof.rowCount) {
        throw new ArchiveScratchError(
          'ARCHIVE_SOURCE_CHANGED',
          'Mission archive row count changed during pinned extraction.',
        )
      }
      sourceProofs.set(declaration.tableName, sourceProof)
    }

    const projectedFinalization = applyFinalizationProjection(scratch, input)
    if (projectedFinalization) {
      for (const tableName of ['missions', 'mission_events']) {
        const projectedProof = computeArchivedTableContentDigest(scratch, {
          tableName,
          schemaVersion: input.schemaVersion,
          isCancelled: input.isCancelled,
        })
        sourceProofs.set(tableName, projectedProof)
      }
    }

    const sqliteWorkBytes = Math.max(1, fs.statSync(input.sourceDatabasePath).size)
    input.onProgress?.({
      phase: 'sqlite',
      unit: 'bytes',
      completed: 0,
      total: sqliteWorkBytes,
      detail: 'rebuild-and-integrity',
    })
    rebuildDerivedTables(scratch, input.missionId)
    installPostLoadObjects(source, scratch)
    scratch.pragma('foreign_keys = ON')
    if (scratch.prepare('PRAGMA foreign_key_check').all().length !== 0) {
      throw new ArchiveScratchError(
        'ARCHIVE_SCOPE_INVALID',
        'Mission archive scratch failed foreign-key verification.',
      )
    }
    const integrity = scratch.prepare('PRAGMA integrity_check').get()
    if (integrity?.integrity_check !== 'ok') {
      throw new ArchiveScratchError(
        'ARCHIVE_SCOPE_INVALID',
        'Mission archive scratch failed SQLite integrity verification.',
      )
    }
    reconcileArchiveInventory(scratch, { schemaVersion: input.schemaVersion })
    input.onProgress?.({
      phase: 'sqlite',
      unit: 'bytes',
      completed: sqliteWorkBytes,
      total: sqliteWorkBytes,
      detail: 'rebuild-and-integrity',
    })
    const archivedMissions = scratch.prepare('SELECT id FROM missions ORDER BY id').all()
    if (archivedMissions.length !== 1 || archivedMissions[0].id !== input.missionId) {
      throw new ArchiveScratchError(
        'ARCHIVE_SCOPE_INVALID',
        'Mission archive scratch contains the wrong mission scope.',
      )
    }
    const archivedRequest = scratch.prepare(`SELECT rowid AS event_rowid, id
      FROM mission_events WHERE id = ?`).get(input.requestEventId)
    if (
      archivedRequest?.id !== input.requestEventId
      || Number(archivedRequest.event_rowid) !== input.requestEventRowid
    ) {
      throw new ArchiveScratchError(
        'ARCHIVE_SCOPE_INVALID',
        'Mission archive scratch did not preserve its request epoch.',
      )
    }

    const forwardProofRows = createRowProgressForwarder(input, 'proof')
    input.onProgress?.({
      phase: 'proof', unit: 'rows', completed: 0, total: null, detail: 'archive-content',
    })
    const tableProofs = declarations.map((declaration) => {
      assertNotCancelled(input)
      const proof = computeArchivedTableContentDigest(scratch, {
        tableName: declaration.tableName,
        schemaVersion: input.schemaVersion,
        isCancelled: input.isCancelled,
        onProgress: forwardProofRows(declaration.tableName),
      })
      const sourceProof = sourceProofs.get(declaration.tableName)
      if (sourceProof !== undefined && (
        sourceProof.rowCount !== proof.rowCount
        || sourceProof.contentSha256 !== proof.contentSha256
      )) {
        throw new ArchiveScratchError(
          'ARCHIVE_SOURCE_CHANGED',
          'Mission archive scratch content does not match the pinned source selection.',
        )
      }
      if (declaration.decision === 'operational_excluded' && proof.rowCount !== 0) {
        throw new ArchiveScratchError(
          'ARCHIVE_SCOPE_INVALID',
          'Mission archive scratch retained excluded operational state.',
        )
      }
      return Object.freeze({
        tableName: declaration.tableName,
        decision: declaration.decision,
        rowCount: proof.rowCount,
        contentSha256: proof.contentSha256,
        sourceMatched: sourceProof === undefined ? null : true,
      })
    })
    const sourceGpxContentProof = computeArchiveGpxContentProof(source, {
      missionId: input.missionId,
      isCancelled: input.isCancelled,
    })
    const sourceReplaySemanticProof = computeMissionReplaySemanticProof(
      projectedFinalization ? scratch : source,
      {
        missionId: input.missionId,
        requestEventId: input.requestEventId,
        archiveKind: input.archiveKind,
        isCancelled: input.isCancelled,
        onProgress: forwardProofRows('source-replay'),
      },
    )
    const scratchGpxContentProof = computeArchiveGpxContentProof(scratch, {
      missionId: input.missionId,
      isCancelled: input.isCancelled,
    })
    const scratchReplaySemanticProof = computeMissionReplaySemanticProof(scratch, {
      missionId: input.missionId,
      requestEventId: input.requestEventId,
      archiveKind: input.archiveKind,
      isCancelled: input.isCancelled,
      onProgress: forwardProofRows('scratch-replay'),
    })
    if (canonicalJson(sourceGpxContentProof) !== canonicalJson(scratchGpxContentProof)
      || canonicalJson(sourceReplaySemanticProof) !== canonicalJson(scratchReplaySemanticProof)) {
      throw new ArchiveScratchError(
        'ARCHIVE_SOURCE_CHANGED',
        'Mission archive scratch does not reproduce pinned GPX or replay semantics.',
      )
    }
    const attachments = enumerateArchiveAttachments({
      db: source,
      databasePath: input.sourceDatabasePath,
      missionId: input.missionId,
      isCancelled: input.isCancelled,
      onProgress: ({ completed, total }) => input.onProgress?.({
        phase: 'attachments',
        unit: 'files',
        completed,
        total,
        detail: 'custody-files',
      }),
    })
    if (attachments.length === 0) {
      input.onProgress?.({
        phase: 'attachments', unit: 'files', completed: 0, total: 0, detail: 'custody-files',
      })
    }
    const schemaLedger = createSchemaLedger(scratch)
    scratch.pragma('wal_checkpoint(TRUNCATE)')
    scratch.close()
    scratch = null
    source.exec('ROLLBACK')
    source.close()
    source = null
    fs.chmodSync(input.scratchDatabasePath, 0o600)
    success = true
    return Object.freeze({
      mission: Object.freeze({ id: mission.id, status: mission.status }),
      missionId: input.missionId,
      requestEventRowid: input.requestEventRowid,
      requestEventId: input.requestEventId,
      schemaVersion: input.schemaVersion,
      inventoryVersion: input.inventoryVersion,
      tableProofs: Object.freeze(tableProofs),
      attachments,
      schemaLedger,
      sourceGpxContentProof,
      sourceReplaySemanticProof,
    })
  } catch (error) {
    if (error?.code === 'SQLITE_FULL' || error?.code === 'ENOSPC') {
      throw new ArchiveScratchError('ARCHIVE_DISK_FULL', 'Mission archive scratch ran out of space.')
    }
    throw error
  } finally {
    try { scratch?.close() } catch {}
    try { source?.exec('ROLLBACK') } catch {}
    try { source?.close() } catch {}
    if (!success) removeScratchFileSet(input.scratchDatabasePath)
  }
}

module.exports = {
  ArchiveScratchError,
  createMissionArchiveScratch,
}
