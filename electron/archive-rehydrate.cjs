'use strict'

const fs = require('node:fs')
const path = require('node:path')

const Database = require('better-sqlite3')
const { listArchiveInventoryForSchema } = require('./archive-inventory.cjs')

const SKIPPED_TABLES = new Set([
  'metadata',
  'mission_archives',
  'mission_archive_supplements',
  'mission_cleanup_journal',
  'mission_events',
  'missions',
  'mission_finalization_fences',
])

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SHA256 = /^[0-9a-f]{64}$/u

/** Stable archive rehydration failure with no reflected path or mission data. */
class ArchiveRehydrateError extends Error {
  /** Creates one bounded rehydration error. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveRehydrateError'
    this.code = code
  }
}

/** Quotes one inventory-controlled SQLite identifier. */
function quoteIdentifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new ArchiveRehydrateError(
      'ARCHIVE_REHYDRATE_SCOPE_INVALID',
      'Archive correction snapshot contains an unsafe schema identifier.',
    )
  }
  return `"${value}"`
}

/** Validates the private correction snapshot path before it reaches SQLite. */
function normalizeSnapshotPath(value) {
  if (typeof value !== 'string' || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 8_192 || value.includes('\0')
    || !path.isAbsolute(value) || path.resolve(value) !== value) {
    throw new ArchiveRehydrateError(
      'ARCHIVE_REHYDRATE_REQUEST_INVALID',
      'Archive correction snapshot path is invalid.',
    )
  }
  let stat
  try {
    stat = fs.lstatSync(value)
  } catch {
    throw new ArchiveRehydrateError(
      'ARCHIVE_REHYDRATE_SNAPSHOT_UNAVAILABLE',
      'The verified archive correction snapshot is unavailable.',
    )
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new ArchiveRehydrateError(
      'ARCHIVE_REHYDRATE_SNAPSHOT_UNAVAILABLE',
      'The verified archive correction snapshot is not a regular private file.',
    )
  }
  return value
}

/** Reads columns from one attached snapshot table. */
function tableColumns(database, schema, tableName) {
  return database.prepare(`PRAGMA ${schema}.table_info(${quoteIdentifier(tableName)})`)
    .all()
    .map((column) => column.name)
}

/** Returns true when a table has one named column. */
function hasColumn(database, schema, tableName, columnName) {
  return tableColumns(database, schema, tableName).includes(columnName)
}

/** Builds a mission-scoped source selection for every declared archive table. */
function sourceSelection(database, tableName, missionId) {
  if (hasColumn(database, 'correction_snapshot', tableName, 'mission_id')) {
    return Object.freeze({
      whereSql: 'archive_row."mission_id" = ?',
      parameters: [missionId],
    })
  }
  if (tableName === 'gpx_evidence_points' || tableName === 'gpx_evidence_rejections') {
    return Object.freeze({
      whereSql: `EXISTS (
        SELECT 1 FROM correction_snapshot."gpx_import_revisions" AS revision
        WHERE revision.import_id = archive_row.import_id
          AND revision.revision_sequence = archive_row.revision_sequence
          AND revision.mission_id = ?
      )`,
      parameters: [missionId],
    })
  }
  if (tableName === 'search_pass_evidence_links') {
    return Object.freeze({
      whereSql: `EXISTS (
        SELECT 1 FROM correction_snapshot."search_passes" AS pass
        WHERE pass.id = archive_row.pass_id AND pass.mission_id = ?
      )`,
      parameters: [missionId],
    })
  }
  if (tableName === 'legacy_event_provenance_quarantine') {
    return Object.freeze({
      whereSql: `EXISTS (
        SELECT 1 FROM correction_snapshot."legacy_event_provenance_quarantine_missions" AS reference
        WHERE reference.table_name = archive_row.table_name
          AND reference.source_rowid = archive_row.source_rowid
          AND reference.mission_id = ?
      )`,
      parameters: [missionId],
    })
  }
  if (tableName === 'legacy_gpx_backfill_quarantine') {
    return Object.freeze({
      whereSql: `EXISTS (
        SELECT 1 FROM correction_snapshot."gpx_track_imports" AS import_row
        WHERE import_row.rowid = archive_row.source_rowid AND import_row.mission_id = ?
      )`,
      parameters: [missionId],
    })
  }
  throw new ArchiveRehydrateError(
    'ARCHIVE_REHYDRATE_SCOPE_INVALID',
    'Archive correction snapshot contains a table without a mission-scoped disposition.',
  )
}

/** Orders mission tables parent-before-child using the live schema foreign keys. */
function orderTables(database, tables) {
  const candidates = new Set(tables)
  const dependencies = new Map(tables.map((table) => [table, new Set()]))
  for (const table of tables) {
    for (const foreignKey of database.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`).all()) {
      if (candidates.has(foreignKey.table) && foreignKey.table !== table) {
        dependencies.get(table).add(foreignKey.table)
      }
    }
  }
  const ordered = []
  while (dependencies.size > 0) {
    const ready = [...dependencies.entries()]
      .filter(([, parents]) => parents.size === 0)
      .map(([table]) => table)
      .sort()
    if (ready.length === 0) {
      throw new ArchiveRehydrateError(
        'ARCHIVE_REHYDRATE_SCHEMA_CYCLE',
        'Archive correction snapshot tables contain an unsafe foreign-key cycle.',
      )
    }
    for (const table of ready) {
      ordered.push(table)
      dependencies.delete(table)
    }
    for (const parents of dependencies.values()) {
      for (const table of ready) parents.delete(table)
    }
  }
  return ordered
}

/** Rebuilds derived indexes that are needed immediately by live Review/Replay. */
function rebuildDerivedMissionState(database, missionId) {
  database.prepare('DELETE FROM mission_replay_position_day_counts WHERE mission_id = ?')
    .run(missionId)
  database.prepare(`INSERT INTO mission_replay_position_day_counts (
      mission_id, device_id, known_day, position_count
    ) SELECT mission_id, device_id,
      substr(MAX(timestamp, received_at, COALESCE(timestamp_provenance_recorded_at, received_at)), 1, 10),
      COUNT(*)
    FROM positions
    WHERE mission_id = ? AND timestamp_source = 'fix' AND received_at IS NOT NULL
    GROUP BY mission_id, device_id,
      substr(MAX(timestamp, received_at, COALESCE(timestamp_provenance_recorded_at, received_at)), 1, 10)`)
    .run(missionId)
  database.prepare('DELETE FROM ingest_anomaly_devices WHERE mission_id = ?').run(missionId)
  database.prepare('DELETE FROM ingest_anomaly_mission_health WHERE mission_id = ?').run(missionId)
  database.exec(`
    INSERT INTO ingest_anomaly_devices (
      mission_id, device_id, conflict_count, rejected_count
    )
    SELECT mission_id, device_id,
      SUM(CASE WHEN kind = 'conflict' THEN 1 ELSE 0 END),
      SUM(CASE WHEN kind = 'rejected' THEN 1 ELSE 0 END)
    FROM ingest_anomalies WHERE mission_id = '${missionId.replaceAll("'", "''")}' AND device_id IS NOT NULL
    GROUP BY mission_id, device_id;
    INSERT INTO ingest_anomaly_mission_health (
      mission_id, conflict_count, rejected_count, affected_device_count
    )
    SELECT mission_id,
      SUM(CASE WHEN kind = 'conflict' THEN 1 ELSE 0 END),
      SUM(CASE WHEN kind = 'rejected' THEN 1 ELSE 0 END),
      COUNT(DISTINCT device_id)
    FROM ingest_anomalies WHERE mission_id = '${missionId.replaceAll("'", "''")}'
    GROUP BY mission_id;
  `)
  database.prepare(`INSERT INTO mission_replay_generations (mission_id, generation)
    VALUES (?, 1) ON CONFLICT(mission_id) DO UPDATE SET generation = generation + 1`).run(missionId)
}

/** Restores one verified archive snapshot into an emptied archived mission namespace. */
function rehydrateMissionFromSnapshot(input) {
  const missionId = input?.missionId
  const archiveId = input?.archiveId
  if (typeof missionId !== 'string' || missionId.length < 1 || missionId.length > 200
    || typeof archiveId !== 'string' || !UUID_V4.test(archiveId)) {
    throw new ArchiveRehydrateError(
      'ARCHIVE_REHYDRATE_REQUEST_INVALID',
      'Archive correction identity is invalid.',
    )
  }
  const snapshotPath = normalizeSnapshotPath(input.snapshotPath)
  const schemaVersion = input.schemaVersion
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new ArchiveRehydrateError(
      'ARCHIVE_REHYDRATE_REQUEST_INVALID',
      'Archive correction schema identity is invalid.',
    )
  }
  const database = input.db
  if (database === null || typeof database?.prepare !== 'function'
    || typeof database?.transaction !== 'function') {
    throw new ArchiveRehydrateError(
      'ARCHIVE_REHYDRATE_REQUEST_INVALID',
      'Archive correction live store is invalid.',
    )
  }

  let snapshot
  try {
    snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true })
    snapshot.pragma('query_only = ON')
    const integrity = snapshot.pragma('integrity_check', { simple: true })
    const schema = Number(snapshot.prepare(
      "SELECT value FROM metadata WHERE key = 'schema_version'",
    ).get()?.value)
    const mission = snapshot.prepare('SELECT id, status FROM missions WHERE id = ?').get(missionId)
    const missionCount = Number(snapshot.prepare('SELECT COUNT(*) AS count FROM missions').get().count)
    const archive = snapshot.prepare(
      'SELECT id, mission_id, container_version, status, ciphertext_sha256 FROM mission_archives WHERE id = ?',
    ).get(archiveId)
    const finalized = snapshot.prepare(`SELECT details_json FROM mission_events
      WHERE mission_id = ? AND event_type = 'mission_finalized'
      ORDER BY rowid DESC LIMIT 1`).get(missionId)
    if (integrity !== 'ok' || schema !== schemaVersion || mission?.id !== missionId
      || mission.status !== 'finalized' || missionCount !== 1
      || archive?.mission_id !== missionId || archive.status !== 'verified'
      || archive.container_version !== 2 || !SHA256.test(String(archive.ciphertext_sha256 ?? ''))) {
      throw new ArchiveRehydrateError(
        'ARCHIVE_REHYDRATE_SNAPSHOT_INVALID',
        'The verified archive correction snapshot failed identity validation.',
      )
    }
    let finalizedDetails
    try { finalizedDetails = JSON.parse(finalized?.details_json ?? '{}') } catch { finalizedDetails = {} }
    if (finalizedDetails.archive_id !== archiveId) {
      throw new ArchiveRehydrateError(
        'ARCHIVE_REHYDRATE_SNAPSHOT_INVALID',
        'The archive correction snapshot is not bound to the requested finalization.',
      )
    }
  } finally {
    snapshot?.close()
  }

  database.prepare('ATTACH DATABASE ? AS correction_snapshot').run(snapshotPath)
  try {
    const declarations = listArchiveInventoryForSchema(schemaVersion)
      .filter((entry) => !SKIPPED_TABLES.has(entry.tableName)
        && (entry.decision === 'mission_rows' || entry.decision === 'global_rows'))
      .map((entry) => entry.tableName)
      .filter((tableName) => database.prepare(
        `SELECT 1 FROM correction_snapshot.sqlite_master WHERE type = 'table' AND name = ?`,
      ).get(tableName) !== undefined)
    const ordered = orderTables(database, declarations)
    const transaction = database.transaction(() => {
      const currentMission = database.prepare('SELECT status FROM missions WHERE id = ?')
        .get(missionId)
      if (currentMission?.status !== 'finalized') {
        throw new ArchiveRehydrateError(
          'ARCHIVE_REHYDRATE_EPOCH_CHANGED',
          'Mission finalization changed before archive correction restore could start.',
        )
      }
      for (const tableName of ordered) {
        const destinationColumns = tableColumns(database, 'main', tableName)
        const sourceColumns = tableColumns(database, 'correction_snapshot', tableName)
        if (destinationColumns.length === 0 || sourceColumns.length === 0
          || destinationColumns.some((column) => !sourceColumns.includes(column))) {
          throw new ArchiveRehydrateError(
            'ARCHIVE_REHYDRATE_SCHEMA_INVALID',
            'Archive correction snapshot schema does not match the live store.',
          )
        }
        const columns = destinationColumns.map(quoteIdentifier)
        const selection = sourceSelection(database, tableName, missionId)
        const existing = database.prepare(`SELECT COUNT(*) AS count FROM main.${quoteIdentifier(tableName)} AS archive_row WHERE ${selection.whereSql}`)
          .get(...selection.parameters).count
        if (Number(existing) !== 0) {
          throw new ArchiveRehydrateError(
            'ARCHIVE_REHYDRATE_LIVE_ROWS_PRESENT',
            'Live mission rows are present; archive correction restore refused to overwrite them.',
          )
        }
        database.prepare(`INSERT INTO main.${quoteIdentifier(tableName)} (${columns.join(', ')})
          SELECT ${columns.join(', ')} FROM correction_snapshot.${quoteIdentifier(tableName)} AS archive_row
          WHERE ${selection.whereSql}`).run(...selection.parameters)
      }
      rebuildDerivedMissionState(database, missionId)
    })
    transaction.immediate()
  } finally {
    database.exec('DETACH DATABASE correction_snapshot')
  }
  return Object.freeze({ missionId, archiveId })
}

module.exports = {
  ArchiveRehydrateError,
  rehydrateMissionFromSnapshot,
}
