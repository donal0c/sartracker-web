const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const Database = require('better-sqlite3')
const { runSqliteBackupInWorker } = require('./sqlite-backup-runner.cjs')
const { validateSqliteSnapshotSanity } = require('./sqlite-snapshot-sanity.cjs')

const { createZipArchive, readZipArchive } = require('./zip-archive.cjs')

const CURRENT_SCHEMA_VERSION = 4
const DATABASE_FILE_NAME = 'mission-store.sqlite'
const BACKUP_FILE_NAME = 'mission-store.backup.sqlite'
const ARCHIVE_DIRECTORY_NAME = 'archives'
const ARCHIVE_VERSION = 1

/**
 * Creates the Electron SQLite mission store.
 */
function createElectronMissionStore(options) {
  const databasePath = path.join(options.userDataPath, DATABASE_FILE_NAME)
  const backupPath = path.join(options.userDataPath, BACKUP_FILE_NAME)
  const archiveDirectory = path.join(options.userDataPath, ARCHIVE_DIRECTORY_NAME)
  const finalizeMissionFaultInjection = options.finalizeMissionFaultInjection ?? {}
  const archiveFaultInjection = options.archiveFaultInjection ?? {}
  const storageDiagnostics = options.storageDiagnostics ?? null
  const db = new Database(databasePath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = FULL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  const backupCoordinator = createBackupCoordinator(
    db,
    databasePath,
    backupPath,
    options.backupFaultInjection ?? {},
    storageDiagnostics,
  )
  let finalizeTail = Promise.resolve()
  const enqueueFinalize = (missionId) => {
    const run = finalizeTail.then(() =>
      finalizeMission(
        db,
        missionId,
        backupCoordinator,
        archiveDirectory,
        finalizeMissionFaultInjection,
        archiveFaultInjection,
      ),
    )
    finalizeTail = run.catch(() => {})
    return run
  }

  return {
    close: () => db.close(),
    info: async () => ({
      schema_version: schemaVersion(db),
      synchronous_mode: db.pragma('synchronous', { simple: true }),
      database_path: databasePath,
      backup_path: backupPath,
    }),
    syncBackup: async (trigger) => backupCoordinator.syncBackup(trigger),
    createMissionArchive: async (missionId) =>
      createMissionArchive(db, missionId, backupCoordinator, archiveDirectory, true, archiveFaultInjection),
    createMission: async (input) => {
      const mission = createMission(db, input)
      await safeStorageDiagnostic(() =>
        storageDiagnostics?.startMission({ startedAt: mission.start_time }),
      )
      return mission
    },
    upsertDevice: async (input) => upsertDevice(db, input),
    upsertDevicesBulk: async (input) => {
      const startedAtMs = performance.now()
      const devices = upsertDevicesBulk(db, input)
      await safeStorageDiagnostic(() =>
        storageDiagnostics?.recordTrackingBatch({
          durationMs: performance.now() - startedAtMs,
          deviceCount: devices.length,
          changedDeviceEventCount: devices.length,
          observedAt: new Date().toISOString(),
        }),
      )
      return devices
    },
    getDevice: async (missionId, deviceId) => getDevice(db, missionId, deviceId),
    listDevices: async (missionId) => all(db, 'SELECT * FROM devices WHERE mission_id = ? ORDER BY name ASC', missionId),
    addPosition: async (input) => addPosition(db, input),
    addPositionsBulk: async (input) => {
      const startedAtMs = performance.now()
      const positions = addPositionsBulk(db, input)
      await safeStorageDiagnostic(() =>
        storageDiagnostics?.recordInsertedPositions({
          durationMs: performance.now() - startedAtMs,
          insertedPositionCount: positions.length,
          positionTelemetryEventCount: positions.length,
        }),
      )
      return positions
    },
    listPositions: async (missionId, deviceId) =>
      deviceId === undefined
        ? all(db, 'SELECT * FROM positions WHERE mission_id = ? ORDER BY timestamp ASC', missionId)
        : all(db, 'SELECT * FROM positions WHERE mission_id = ? AND device_id = ? ORDER BY timestamp ASC', missionId, deviceId),
    countPositions: async (missionId, deviceId) => countPositions(db, missionId, deviceId),
    latestPositions: async (missionId) => latestPositions(db, missionId),
    listMissionEvents: async (missionId) =>
      // Tie-break on the implicit monotonic rowid so events written within the same
      // millisecond (e.g. the finalize sequence) keep their true insertion order
      // rather than ordering by a random UUID.
      all(db, 'SELECT * FROM mission_events WHERE mission_id = ? ORDER BY timestamp ASC, rowid ASC', missionId),
    listAuditEvents: async (missionId, options) => listAuditEvents(db, missionId, options),
    upsertMarker: async (input) => upsertById(db, 'markers', input, markerDefaults),
    getMarker: async (markerId) => getById(db, 'markers', markerId, 'Marker'),
    listMarkers: async (missionId) =>
      all(db, 'SELECT * FROM markers WHERE mission_id = ? ORDER BY display_order ASC, name ASC', missionId),
    deleteMarker: async (markerId) => deleteById(db, 'markers', markerId),
    upsertDrawing: async (input) => upsertById(db, 'drawings', input, drawingDefaults),
    getDrawing: async (drawingId) => getById(db, 'drawings', drawingId, 'Drawing'),
    listDrawings: async (missionId) =>
      all(db, 'SELECT * FROM drawings WHERE mission_id = ? ORDER BY display_order ASC, name ASC', missionId),
    deleteDrawing: async (drawingId) => deleteById(db, 'drawings', drawingId),
    upsertHelicopter: async (input) => upsertHelicopter(db, input),
    listHelicopters: async (missionId) =>
      all(db, 'SELECT * FROM helicopters WHERE mission_id = ? ORDER BY slot_key ASC', missionId),
    deleteHelicopter: async (helicopterId) => deleteById(db, 'helicopters', helicopterId),
    upsertGpxImport: async (input) => upsertById(db, 'gpx_track_imports', input, gpxDefaults),
    listGpxImports: async (missionId) =>
      all(db, 'SELECT * FROM gpx_track_imports WHERE mission_id = ? ORDER BY display_name ASC, imported_at ASC', missionId),
    deleteGpxImport: async (importId) => deleteById(db, 'gpx_track_imports', importId),
    listLayerCatalogMetadata: async (missionId) => listLayerCatalogMetadata(db, missionId),
    upsertLayerCatalogMetadata: async (input) => upsertLayerCatalogMetadata(db, input),
    clearLayerCatalogMetadata: async (missionId) => clearLayerCatalogMetadata(db, missionId),
    getMission: async (missionId) => getMission(db, missionId),
    listMissions: async () => all(db, 'SELECT * FROM missions ORDER BY start_time DESC'),
    getActiveMission: async () => getActiveMission(db),
    getRecoverableMission: async () => getActiveMission(db),
    pauseMission: async (missionId) => transitionMission(db, missionId, 'active', 'paused'),
    resumeMission: async (missionId) => transitionMission(db, missionId, 'paused', 'active'),
    finishMission: async (missionId) => finishMission(db, missionId),
    finalizeMission: async (missionId) => enqueueFinalize(missionId),
    unlockFinalizedMission: async (input) => unlockFinalizedMission(db, input, options.readAdminRoster),
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  const existingSchemaVersion = readStoredSchemaVersion(db)
  if (existingSchemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Cannot open mission store created by newer mission store schema ${existingSchemaVersion}; this build supports schema ${CURRENT_SCHEMA_VERSION}.`,
    )
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('idle', 'active', 'paused', 'finished', 'finalized')),
      start_time TEXT NOT NULL,
      pause_time TEXT,
      finish_time TEXT,
      paused_seconds INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      schema_version INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      last_seen TEXT,
      status TEXT NOT NULL CHECK(status IN ('online', 'offline', 'unknown')),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      UNIQUE (mission_id, device_id)
    );
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      name TEXT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      altitude REAL,
      speed REAL,
      battery REAL,
      accuracy REAL,
      source TEXT,
      timestamp TEXT NOT NULL,
      data_origin TEXT NOT NULL DEFAULT 'live' CHECK(data_origin IN ('live', 'cache')),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      FOREIGN KEY (mission_id, device_id) REFERENCES devices(mission_id, device_id)
    );
    CREATE INDEX IF NOT EXISTS idx_positions_mission_device_timestamp ON positions(mission_id, device_id, timestamp);
    CREATE TABLE IF NOT EXISTS markers (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('ipp_lkp', 'clue', 'hazard', 'casualty')),
      name TEXT NOT NULL,
      description TEXT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      irish_grid_e INTEGER NOT NULL,
      irish_grid_n INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      subject_category TEXT,
      clue_type TEXT,
      confidence REAL,
      found_by TEXT,
      hazard_type TEXT,
      severity TEXT,
      condition TEXT,
      treatment TEXT,
      evacuation_priority TEXT,
      label_size INTEGER,
      updated_by TEXT,
      coordinator_ids TEXT,
      attachment_path TEXT,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS drawings (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('line', 'search_area', 'range_ring', 'bearing_line', 'search_sector', 'text_label')),
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      width REAL,
      distance_m REAL,
      temporary_measure INTEGER,
      label TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      geometry_json TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS helicopters (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      slot_key TEXT NOT NULL CHECK(slot_key IN ('slot_1', 'slot_2', 'slot_3', 'slot_4')),
      call_sign TEXT NOT NULL,
      hex_id TEXT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      altitude REAL,
      speed REAL,
      heading REAL,
      last_update TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      UNIQUE (mission_id, slot_key)
    );
    CREATE TABLE IF NOT EXISTS gpx_track_imports (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      geometry_json TEXT NOT NULL,
      metadata_json TEXT,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      UNIQUE (mission_id, source_path)
    );
    CREATE TABLE IF NOT EXISTS mission_events (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details_json TEXT,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS layer_catalog_entries (
      mission_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      parent_node_id TEXT,
      node_kind TEXT NOT NULL CHECK(node_kind IN ('group', 'layer', 'feature_item')),
      alias TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_visible INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, node_id),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
  `)
  ensureColumnExists(db, 'markers', 'updated_by', 'TEXT')
  ensureColumnExists(db, 'markers', 'coordinator_ids', 'TEXT')
  ensureColumnExists(db, 'markers', 'attachment_path', 'TEXT')
  ensureColumnExists(db, 'markers', 'label_size', 'INTEGER')

  db.prepare("INSERT INTO metadata (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(CURRENT_SCHEMA_VERSION))
}

function schemaVersion(db) {
  return readStoredSchemaVersion(db) || CURRENT_SCHEMA_VERSION
}

function readStoredSchemaVersion(db) {
  const row = db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()
  const value = Number(row?.value ?? 0)
  return Number.isFinite(value) ? value : 0
}

function ensureColumnExists(db, tableName, columnName, columnSql) {
  const existingColumns = db.prepare(`PRAGMA table_info(${tableName})`).all()
  if (existingColumns.some((column) => column.name === columnName)) {
    return
  }

  db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSql}`).run()
}

function createBackupCoordinator(
  db,
  databasePath,
  backupPath,
  faultInjection,
  storageDiagnostics,
) {
  let backupTail = Promise.resolve()
  let queueDepth = 0

  const enqueue = (task) => {
    const run = backupTail.then(task, task)
    backupTail = run.catch(() => {})
    return run
  }

  return {
    syncBackup: async (trigger = 'unknown') => {
      const operation = createStorageDiagnosticOperation(storageDiagnostics)
      queueDepth += 1
      await safeStorageDiagnostic(() =>
        operation === null
          ? undefined
          : storageDiagnostics.requested(operation, { queueDepth, trigger }),
      )
      return enqueue(async () => {
        queueDepth = Math.max(0, queueDepth - 1)
        return syncBackup(
          db,
          databasePath,
          backupPath,
          faultInjection,
          storageDiagnostics,
          operation,
        )
      })
    },
  }
}

async function syncBackup(
  db,
  databasePath,
  backupPath,
  faultInjection = {},
  storageDiagnostics = null,
  operation = null,
) {
  await fs.mkdir(path.dirname(backupPath), { recursive: true })
  const temporaryPath = `${backupPath}.tmp-${randomUUID()}`
  let stage = 'started'
  try {
    await safeStorageDiagnostic(() =>
      operation === null ? undefined : storageDiagnostics.started(operation),
    )
    await runSqliteBackupInWorker({
      sourcePath: databasePath,
      targetPath: temporaryPath,
    })
    stage = 'copied'
    await safeStorageDiagnostic(() =>
      operation === null ? undefined : storageDiagnostics.phase(operation, stage),
    )
    if (faultInjection.afterTemporaryBackup === true) {
      throw new Error('Injected backup interruption after temporary backup.')
    }
    if (faultInjection.corruptTemporarySnapshotBeforeSanityCheck === true) {
      await corruptSqliteHeader(temporaryPath)
    }
    stage = 'sanity_check_started'
    await safeStorageDiagnostic(() =>
      operation === null ? undefined : storageDiagnostics.phase(operation, stage),
    )
    await validateSqliteSnapshotSanity(temporaryPath, 'Rolling mission backup')
    stage = 'sanity_checked'
    await safeStorageDiagnostic(() =>
      operation === null ? undefined : storageDiagnostics.phase(operation, stage),
    )
    await fs.rename(temporaryPath, backupPath)
    stage = 'renamed'
    await safeStorageDiagnostic(() =>
      operation === null ? undefined : storageDiagnostics.phase(operation, stage),
    )
  } catch (error) {
    await safeStorageDiagnostic(() =>
      operation === null
        ? undefined
        : storageDiagnostics.failed(operation, {
            stage,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          }),
    )
    await removeSqliteFileSet(temporaryPath)
    throw error
  }

  const activeMission = getActiveMission(db)
  if (activeMission !== null) {
    appendEvent(db, activeMission.id, 'mission_backup_synced', { backup_path: backupPath })
  }
  await safeStorageDiagnostic(() =>
    operation === null ? undefined : storageDiagnostics.completed(operation),
  )
  return backupPath
}

/** Corrupts only the temporary snapshot header for a fail-closed regression seam. */
async function corruptSqliteHeader(databasePath) {
  const fileHandle = await fs.open(databasePath, 'r+')
  try {
    await fileHandle.write(Buffer.from('Not SQLite data!'), 0, 16, 0)
  } finally {
    await fileHandle.close()
  }
}

async function safeStorageDiagnostic(callback) {
  try {
    await callback?.()
  } catch {
    // Diagnostics are fail-open: a local log/checkpoint failure must never block mission storage.
  }
}

function createStorageDiagnosticOperation(storageDiagnostics) {
  try {
    return storageDiagnostics?.createOperation('backup') ?? null
  } catch {
    return null
  }
}

async function removeSqliteFileSet(databasePath) {
  await Promise.all([
    fs.rm(databasePath, { force: true }),
    fs.rm(`${databasePath}-wal`, { force: true }),
    fs.rm(`${databasePath}-shm`, { force: true }),
  ])
}

function validateSqliteDatabaseFile(databasePath, label) {
  let snapshotDb
  try {
    snapshotDb = new Database(databasePath, { readonly: true, fileMustExist: true })
    const integrityResult = snapshotDb.pragma('integrity_check', { simple: true })
    if (integrityResult !== 'ok') {
      throw new Error(`${label} SQLite snapshot failed integrity_check: ${integrityResult}`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('SQLite snapshot failed integrity_check')) {
      throw error
    }
    throw new Error(`${label} SQLite snapshot cannot be opened for integrity validation: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    snapshotDb?.close()
  }
}

function createMission(db, input) {
  if (getActiveMission(db) !== null) {
    throw new Error('Cannot create a new mission while another mission is active.')
  }
  const id = randomUUID()
  const startTime = input.start_time ?? now()
  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO missions (id, name, status, start_time, pause_time, finish_time, paused_seconds, notes, schema_version)
      VALUES (?, ?, 'active', ?, NULL, NULL, 0, ?, ?)`)
      .run(id, input.name, startTime, input.notes ?? null, CURRENT_SCHEMA_VERSION)
    insertEvent(db, id, 'mission_created', startTime, {
      name: input.name,
      notes: input.notes ?? null,
      start_time: startTime,
    })
  })
  transaction()
  return getMission(db, id)
}

function getMission(db, missionId) {
  const mission = db.prepare('SELECT * FROM missions WHERE id = ?').get(missionId)
  if (mission === undefined) {
    throw new Error(`Mission not found: ${missionId}`)
  }
  return mission
}

function getActiveMission(db) {
  return db.prepare("SELECT * FROM missions WHERE status IN ('active', 'paused') ORDER BY start_time DESC LIMIT 1").get() ?? null
}

function transitionMission(db, missionId, requiredStatus, nextStatus) {
  const mission = getMission(db, missionId)
  if (mission.status !== requiredStatus) {
    throw new Error(`Cannot transition mission with status '${mission.status}'.`)
  }
  const timestamp = now()
  const pauseTime = nextStatus === 'paused' ? timestamp : null
  const eventType = nextStatus === 'paused' ? 'mission_paused' : 'mission_resumed'
  const additionalPausedSeconds =
    requiredStatus === 'paused' ? calculatePausedSeconds(mission.pause_time, timestamp) : 0
  const transaction = db.transaction(() => {
    db.prepare(`UPDATE missions
      SET status = ?,
          pause_time = ?,
          finish_time = NULL,
          paused_seconds = paused_seconds + ?
      WHERE id = ?`)
      .run(nextStatus, pauseTime, additionalPausedSeconds, missionId)
    insertEvent(db, missionId, eventType, timestamp, { status: nextStatus })
  })
  transaction()
  return getMission(db, missionId)
}

function finishMission(db, missionId) {
  const mission = getMission(db, missionId)
  if (mission.status === 'finished' || mission.status === 'finalized') {
    throw new Error('Mission is already finished.')
  }
  const timestamp = now()
  const additionalPausedSeconds =
    mission.status === 'paused' ? calculatePausedSeconds(mission.pause_time, timestamp) : 0
  const transaction = db.transaction(() => {
    db.prepare(`UPDATE missions
      SET status = ?,
          pause_time = NULL,
          finish_time = ?,
          paused_seconds = paused_seconds + ?
      WHERE id = ?`)
      .run('finished', timestamp, additionalPausedSeconds, missionId)
    insertEvent(db, missionId, 'mission_finished', timestamp, { status: 'finished' })
  })
  transaction()
  return getMission(db, missionId)
}

function calculatePausedSeconds(pauseTime, resumeOrFinishTime) {
  const pauseStartMs = Date.parse(pauseTime ?? '')
  const pauseEndMs = Date.parse(resumeOrFinishTime)
  if (Number.isNaN(pauseStartMs) || Number.isNaN(pauseEndMs)) {
    throw new Error('Mission pause time is invalid; paused duration cannot be calculated.')
  }
  return Math.max(0, Math.floor((pauseEndMs - pauseStartMs) / 1000))
}

/**
 * Builds a real, immutable, standalone archive for a finished or finalized mission and
 * returns its location. Mirrors the Rust reference (`persistence.rs`): a fresh SQLite
 * snapshot plus a manifest, the mission record, and every marker attachment, written to
 * a temporary file and atomically renamed into the per-mission `archives/` directory so
 * a partially-written archive can never be observed. Unlike the shared rolling backup,
 * each archive is uniquely named and is never overwritten by a later mission.
 *
 * @param {boolean} [recordArchiveEvent] when true, append a `mission_archived` event
 *   (matching Rust); finalize passes false because it records its own event sequence.
 */
async function createMissionArchive(
  db,
  missionId,
  backupCoordinator,
  archiveDirectory,
  recordArchiveEvent = true,
  archiveFaultInjection = {},
) {
  const mission = getMission(db, missionId)
  if (mission.status !== 'finished' && mission.status !== 'finalized') {
    throw new Error('Only finished or finalized missions can be archived.')
  }

  const createdAt = now()
  const backupPath = await backupCoordinator.syncBackup()
  const snapshotBytes = await fs.readFile(backupPath)
  if (snapshotBytes.length === 0) {
    throw new Error('Mission archive cannot be created from an empty database snapshot.')
  }
  let archiveSnapshotBytes = snapshotBytes
  if (archiveFaultInjection.corruptSnapshotBeforeZip === true) {
    archiveSnapshotBytes = Buffer.from('corrupt sqlite snapshot', 'utf8')
  }

  const manifestBytes = Buffer.from(
    JSON.stringify(
      {
        archive_version: ARCHIVE_VERSION,
        created_at: createdAt,
        mission_id: missionId,
        schema_version: CURRENT_SCHEMA_VERSION,
        snapshot_format: 'sqlite',
      },
      null,
      2,
    ),
    'utf8',
  )
  const missionBytes = Buffer.from(JSON.stringify(mission, null, 2), 'utf8')

  const entries = [
    { name: 'manifest.json', data: manifestBytes },
    { name: 'mission.json', data: missionBytes },
    { name: 'mission-store.sqlite', data: archiveSnapshotBytes },
  ]

  for (const attachmentPath of listMarkerAttachmentPaths(db, missionId)) {
    let attachmentBytes
    try {
      attachmentBytes = await fs.readFile(attachmentPath)
    } catch {
      throw new Error(
        `Mission archive cannot be created because marker attachment is missing: ${attachmentPath}`,
      )
    }
    entries.push({ name: `attachments/${path.basename(attachmentPath)}`, data: attachmentBytes })
  }

  await fs.mkdir(archiveDirectory, { recursive: true })
  await validateSqliteSnapshotBuffer(
    archiveSnapshotBytes,
    'Mission archive embedded SQLite snapshot',
    archiveDirectory,
  )
  const archiveBuffer = createZipArchive(entries)

  const archiveName = `${missionId}-${createdAt.replace(/:/g, '-')}.zip`
  const temporaryPath = path.join(archiveDirectory, `${archiveName}.tmp`)
  const finalPath = path.join(archiveDirectory, archiveName)

  await fs.writeFile(temporaryPath, archiveBuffer)
  try {
    validateArchiveFile(archiveBuffer, missionId)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true })
    throw error
  }
  await fs.rename(temporaryPath, finalPath)

  if (recordArchiveEvent) {
    appendEvent(db, missionId, 'mission_archived', { archive_path: finalPath }, createdAt)
  }

  return { mission_id: missionId, archive_path: finalPath, created_at: createdAt }
}

async function validateSqliteSnapshotBuffer(snapshotBytes, label, workingDirectory) {
  const temporaryPath = path.join(workingDirectory, `.sqlite-integrity-${randomUUID()}.sqlite`)
  try {
    await fs.writeFile(temporaryPath, snapshotBytes)
    validateSqliteDatabaseFile(temporaryPath, label)
  } finally {
    await removeSqliteFileSet(temporaryPath)
  }
}

function listMarkerAttachmentPaths(db, missionId) {
  return all(
    db,
    `SELECT attachment_path FROM markers
      WHERE mission_id = ? AND attachment_path IS NOT NULL AND TRIM(attachment_path) != ''
      ORDER BY display_order ASC, created_at ASC`,
    missionId,
  ).map((row) => row.attachment_path)
}

/**
 * Verifies a freshly-built archive can be re-read, its CRCs match, the required entries
 * are present, the snapshot is non-empty, and the manifest/mission identify the mission —
 * the same guarantees the Rust reader checks. Surfaces corruption loudly before the
 * archive is committed via atomic rename.
 */
function validateArchiveFile(archiveBuffer, missionId) {
  const entries = readZipArchive(archiveBuffer)
  const manifestEntry = entries.get('manifest.json')
  if (manifestEntry === undefined) {
    throw new Error('Mission archive is missing manifest.json.')
  }
  const manifest = JSON.parse(manifestEntry.toString('utf8'))
  if (manifest.mission_id !== missionId) {
    throw new Error('Mission archive manifest does not match the requested mission.')
  }
  const missionEntry = entries.get('mission.json')
  if (missionEntry === undefined) {
    throw new Error('Mission archive is missing mission.json.')
  }
  const archivedMission = JSON.parse(missionEntry.toString('utf8'))
  if (archivedMission.id !== missionId) {
    throw new Error('Mission archive payload does not match the requested mission.')
  }
  const snapshotEntry = entries.get('mission-store.sqlite')
  if (snapshotEntry === undefined || snapshotEntry.length === 0) {
    throw new Error('Mission archive contains an empty mission-store.sqlite snapshot.')
  }
}

async function finalizeMission(
  db,
  missionId,
  backupCoordinator,
  archiveDirectory,
  finalizeMissionFaultInjection = {},
  archiveFaultInjection = {},
) {
  const mission = getMission(db, missionId)
  if (mission.status === 'finalized') {
    const existingArchive = await readRecoverableFinalizeArchive(db, missionId)
    if (existingArchive !== null) {
      return { mission, archive: existingArchive }
    }
    throw new Error('Finalized mission is missing a recoverable archive record.')
  }
  if (mission.status !== 'finished') {
    throw new Error('Only finished missions can be finalized.')
  }

  appendEvent(db, missionId, 'mission_finalize_requested', { resulting_status: 'finished' })

  let archive = await readRecoverableFinalizeArchive(db, missionId)
  if (archive === null) {
    try {
      archive = await createMissionArchive(
        db,
        missionId,
        backupCoordinator,
        archiveDirectory,
        false,
        archiveFaultInjection,
      )
    } catch (error) {
      appendEvent(db, missionId, 'mission_archive_failed', {
        resulting_status: 'finished',
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }

    appendEvent(db, missionId, 'mission_archive_succeeded', {
      resulting_status: 'finished',
      archive_path: archive.archive_path,
    })
  }

  if (finalizeMissionFaultInjection.afterArchiveSucceededEvent === true) {
    throw new Error('Injected finalize interruption after archive success.')
  }

  const transaction = db.transaction(() => {
    db.prepare('UPDATE missions SET status = ? WHERE id = ?').run('finalized', missionId)
    insertEvent(db, missionId, 'mission_finalized', now(), {
      resulting_status: 'finalized',
      archive_path: archive.archive_path,
    })
  })
  transaction()
  return { mission: getMission(db, missionId), archive }
}

async function readRecoverableFinalizeArchive(db, missionId) {
  const latestUnlock = db.prepare(
    `SELECT rowid AS event_rowid, timestamp FROM mission_events
      WHERE mission_id = ? AND event_type = ?
      ORDER BY timestamp DESC, rowid DESC
      LIMIT 1`,
  ).get(missionId, 'mission_unlocked')

  const rows = db.prepare(
    `SELECT rowid AS event_rowid, timestamp, details_json FROM mission_events
      WHERE mission_id = ? AND event_type = ?
      ORDER BY timestamp DESC, rowid DESC`,
  ).all(missionId, 'mission_archive_succeeded')

  for (const row of rows) {
    if (latestUnlock !== undefined && !isEventAfter(row, latestUnlock)) {
      continue
    }
    const details = readEventDetails(row.details_json)
    const archivePath = typeof details.archive_path === 'string' ? details.archive_path : ''
    if (archivePath === '') {
      continue
    }

    try {
      await fs.access(archivePath)
    } catch {
      continue
    }

    return {
      mission_id: missionId,
      archive_path: archivePath,
      created_at: typeof row.timestamp === 'string' ? row.timestamp : now(),
    }
  }
  return null
}

function isEventAfter(candidate, reference) {
  const candidateTimestamp = typeof candidate.timestamp === 'string' ? candidate.timestamp : ''
  const referenceTimestamp = typeof reference.timestamp === 'string' ? reference.timestamp : ''
  if (candidateTimestamp > referenceTimestamp) {
    return true
  }
  if (candidateTimestamp < referenceTimestamp) {
    return false
  }
  return Number(candidate.event_rowid) > Number(reference.event_rowid)
}

function readEventDetails(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return {}
  }

  try {
    const parsed = JSON.parse(input)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function unlockFinalizedMission(db, input, readAdminRoster) {
  const mission = getMission(db, input.mission_id)
  if (mission.status !== 'finalized') {
    throw new Error('Only finalized missions can be unlocked.')
  }
  const adminRoster = typeof readAdminRoster === 'function' ? await readAdminRoster() : []
  if (!adminRoster.map((value) => value.trim()).includes(input.admin_name.trim())) {
    appendEvent(db, input.mission_id, 'mission_unlock_denied', {
      admin_name: input.admin_name,
      reason: input.reason,
      resulting_status: 'finalized',
    })
    throw new Error('Selected admin is not authorized to unlock finalized missions.')
  }
  const timestamp = now()
  const transaction = db.transaction(() => {
    db.prepare('UPDATE missions SET status = ? WHERE id = ?').run('finished', input.mission_id)
    insertEvent(db, input.mission_id, 'mission_unlocked', timestamp, {
      admin_name: input.admin_name,
      reason: input.reason,
      resulting_status: 'finished',
    })
  })
  transaction()
  return getMission(db, input.mission_id)
}

function upsertDevice(db, input) {
  ensureWritableMission(db, input.mission_id)
  const id = randomUUID()
  const timestamp = input.last_seen ?? now()
  // First contact emits `device_created` (a non-telemetry event that surfaces in the
  // default review feed); subsequent updates emit the telemetry-filtered `device_updated`.
  // Mirrors Rust (`persistence.rs`) and the browser harness.
  const existing = db
    .prepare('SELECT id FROM devices WHERE mission_id = ? AND device_id = ?')
    .get(input.mission_id, input.device_id)
  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO devices (id, mission_id, device_id, name, color, last_seen, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mission_id, device_id) DO UPDATE SET
        name = excluded.name, color = excluded.color, last_seen = excluded.last_seen, status = excluded.status`)
      .run(id, input.mission_id, input.device_id, input.name, input.color, input.last_seen ?? null, input.status)
    insertEvent(db, input.mission_id, existing === undefined ? 'device_created' : 'device_updated', timestamp, {
      device_id: input.device_id,
      name: input.name,
      status: input.status,
      color: input.color,
    })
  })
  transaction()
  return getDevice(db, input.mission_id, input.device_id)
}

/**
 * Upserts many devices in a SINGLE transaction (one commit → one fsync at synchronous=FULL).
 * The tracking poller previously upserted each device in its own transaction, so a 32-device
 * mission produced 32 fsync'd writes on the main process every poll — tens of seconds of
 * event-loop blocking on a slow field disk (DON-240). Emits device_created on first contact and
 * device_updated otherwise, matching upsertDevice.
 */
function upsertDevicesBulk(db, input) {
  ensureWritableMission(db, input.mission_id)
  const devices = Array.isArray(input.devices) ? input.devices : []
  if (devices.length === 0) {
    return []
  }

  const existsStmt = db.prepare('SELECT id FROM devices WHERE mission_id = ? AND device_id = ?')
  const upsertStmt = db.prepare(`INSERT INTO devices (id, mission_id, device_id, name, color, last_seen, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mission_id, device_id) DO UPDATE SET
      name = excluded.name, color = excluded.color, last_seen = excluded.last_seen, status = excluded.status`)

  const transaction = db.transaction(() => {
    for (const device of devices) {
      const existing = existsStmt.get(input.mission_id, device.device_id)
      const id = randomUUID()
      const timestamp = device.last_seen ?? now()
      upsertStmt.run(
        id,
        input.mission_id,
        device.device_id,
        device.name,
        device.color,
        device.last_seen ?? null,
        device.status,
      )
      insertEvent(db, input.mission_id, existing === undefined ? 'device_created' : 'device_updated', timestamp, {
        device_id: device.device_id,
        name: device.name,
        status: device.status,
        color: device.color,
      })
    }
  })
  transaction()

  return devices.map((device) => getDevice(db, input.mission_id, device.device_id))
}

function getDevice(db, missionId, deviceId) {
  const device = db.prepare('SELECT * FROM devices WHERE mission_id = ? AND device_id = ?').get(missionId, deviceId)
  if (device === undefined) {
    throw new Error(`Device not found: ${deviceId}`)
  }
  return device
}

function addPosition(db, input) {
  ensureWritableMission(db, input.mission_id)
  validateLatLon(input.lat, input.lon, 'Position')
  getDevice(db, input.mission_id, input.device_id)
  const id = randomUUID()
  const timestamp = input.timestamp ?? now()
  const dataOrigin = input.data_origin ?? 'live'
  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO positions (id, mission_id, device_id, name, lat, lon, altitude, speed, battery, accuracy, source, timestamp, data_origin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.mission_id, input.device_id, input.name ?? null, input.lat, input.lon, input.altitude ?? null, input.speed ?? null, input.battery ?? null, input.accuracy ?? null, input.source ?? null, timestamp, dataOrigin)
    db.prepare("UPDATE devices SET last_seen = ?, status = 'online' WHERE mission_id = ? AND device_id = ?")
      .run(timestamp, input.mission_id, input.device_id)
    insertEvent(db, input.mission_id, 'position_recorded', timestamp, {
      position_id: id,
      device_id: input.device_id,
      timestamp,
      data_origin: dataOrigin,
      source: input.source ?? null,
    })
  })
  transaction()
  return getById(db, 'positions', id, 'Position')
}

function addPositionsBulk(db, input) {
  ensureWritableMission(db, input.mission_id)
  const positions = Array.isArray(input.positions) ? input.positions : []
  if (positions.length === 0) {
    return []
  }

  const deviceExists = db.prepare('SELECT id FROM devices WHERE mission_id = ? AND device_id = ?')
  const existingPositionByCoordinate = db.prepare(
    'SELECT id FROM positions WHERE mission_id = ? AND device_id = ? AND timestamp = ? AND lat = ? AND lon = ? LIMIT 1',
  )
  const insertPosition = db.prepare(`INSERT INTO positions (id, mission_id, device_id, name, lat, lon, altitude, speed, battery, accuracy, source, timestamp, data_origin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const updateDevice = db.prepare("UPDATE devices SET last_seen = ?, status = 'online' WHERE mission_id = ? AND device_id = ?")
  const seenInBatch = new Set()
  const insertedIds = []

  const transaction = db.transaction(() => {
    for (const position of positions) {
      validateLatLon(position.lat, position.lon, 'Position')
      if (deviceExists.get(input.mission_id, position.device_id) === undefined) {
        throw new Error(`Device not found: ${position.device_id}`)
      }

      const timestamp = position.timestamp ?? now()
      const positionKey = createPositionIdentityKey(position, timestamp)
      if (seenInBatch.has(positionKey)) {
        continue
      }
      seenInBatch.add(positionKey)

      if (
        existingPositionByCoordinate.get(
          input.mission_id,
          position.device_id,
          timestamp,
          position.lat,
          position.lon,
        ) !== undefined
      ) {
        continue
      }

      const id = randomUUID()
      const dataOrigin = position.data_origin ?? 'live'
      insertPosition.run(
        id,
        input.mission_id,
        position.device_id,
        position.name ?? null,
        position.lat,
        position.lon,
        position.altitude ?? null,
        position.speed ?? null,
        position.battery ?? null,
        position.accuracy ?? null,
        position.source ?? null,
        timestamp,
        dataOrigin,
      )
      updateDevice.run(timestamp, input.mission_id, position.device_id)
      insertEvent(db, input.mission_id, 'position_recorded', timestamp, {
        position_id: id,
        device_id: position.device_id,
        timestamp,
        data_origin: dataOrigin,
        source: position.source ?? null,
      })
      insertedIds.push(id)
    }
  })

  transaction()
  return insertedIds.map((id) => getById(db, 'positions', id, 'Position'))
}

function createPositionIdentityKey(position, timestamp) {
  if (typeof position.id === 'string' && position.id.trim() !== '') {
    return `${position.device_id}:id:${position.id}`
  }

  return `${position.device_id}:fix:${timestamp}:${Number(position.lat).toFixed(7)}:${Number(position.lon).toFixed(7)}`
}

function countPositions(db, missionId, deviceId) {
  const row =
    deviceId === undefined
      ? db.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ?').get(missionId)
      : db.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ? AND device_id = ?').get(missionId, deviceId)
  return Number(row?.count ?? 0)
}

function latestPositions(db, missionId) {
  return all(db, `SELECT p.* FROM positions p
    INNER JOIN (
      SELECT device_id, MAX(timestamp) AS max_timestamp
      FROM positions
      WHERE mission_id = ?
      GROUP BY device_id
    ) latest ON p.device_id = latest.device_id AND p.timestamp = latest.max_timestamp
    WHERE p.mission_id = ?
    ORDER BY p.device_id ASC`, missionId, missionId)
}

// High-volume tracking heartbeats excluded from the review audit log by default.
// Mirrors src/features/mission-review/audit-events.ts (kept in sync by tests).
const TELEMETRY_EVENT_TYPES = ['device_updated', 'position_recorded', 'mission_backup_synced']
const DEFAULT_AUDIT_EVENT_LIMIT = 500
const MAX_AUDIT_EVENT_LIMIT = 5000

/**
 * Returns operator-meaningful mission events for the review audit log, ordered most
 * recent first and capped, so a long mission never transfers an unbounded event set
 * across IPC. Telemetry heartbeats are excluded unless `includeTelemetry` is set.
 */
function listAuditEvents(db, missionId, options) {
  const includeTelemetry = options?.includeTelemetry === true
  const requestedLimit = options?.limit
  const limit = clampAuditLimit(requestedLimit)

  if (includeTelemetry) {
    return all(
      db,
      'SELECT * FROM mission_events WHERE mission_id = ? ORDER BY timestamp DESC, rowid DESC LIMIT ?',
      missionId,
      limit,
    )
  }

  const placeholders = TELEMETRY_EVENT_TYPES.map(() => '?').join(', ')
  return all(
    db,
    `SELECT * FROM mission_events
     WHERE mission_id = ? AND event_type NOT IN (${placeholders})
     ORDER BY timestamp DESC, rowid DESC
     LIMIT ?`,
    missionId,
    ...TELEMETRY_EVENT_TYPES,
    limit,
  )
}

function clampAuditLimit(requestedLimit) {
  if (typeof requestedLimit !== 'number' || !Number.isFinite(requestedLimit)) {
    return DEFAULT_AUDIT_EVENT_LIMIT
  }
  const rounded = Math.floor(requestedLimit)
  if (rounded < 1) {
    return 1
  }
  return Math.min(rounded, MAX_AUDIT_EVENT_LIMIT)
}

function upsertHelicopter(db, input) {
  ensureWritableMission(db, input.mission_id)
  validateLatLon(input.lat, input.lon, 'Helicopter')
  const existing = db.prepare('SELECT id FROM helicopters WHERE mission_id = ? AND slot_key = ?').get(input.mission_id, input.slot_key)
  const id = input.id ?? existing?.id ?? randomUUID()
  const timestamp = input.last_update ?? now()
  const audit = AUDIT_EVENT_TABLES.helicopters
  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO helicopters (id, mission_id, slot_key, call_sign, hex_id, lat, lon, altitude, speed, heading, last_update, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mission_id, slot_key) DO UPDATE SET
        call_sign = excluded.call_sign, hex_id = excluded.hex_id, lat = excluded.lat, lon = excluded.lon,
        altitude = excluded.altitude, speed = excluded.speed, heading = excluded.heading,
        last_update = excluded.last_update, updated_at = excluded.updated_at`)
      .run(id, input.mission_id, input.slot_key, input.call_sign, input.hex_id ?? null, input.lat, input.lon, input.altitude ?? null, input.speed ?? null, input.heading ?? null, timestamp, timestamp, timestamp)
    insertEvent(
      db,
      input.mission_id,
      existing === undefined ? audit.created : audit.updated,
      timestamp,
      audit.upsertDetails({ id, slot_key: input.slot_key, call_sign: input.call_sign, hex_id: input.hex_id ?? null }),
    )
  })
  transaction()
  return getById(db, 'helicopters', id, 'Helicopter')
}

/**
 * Audit-event metadata for the generic upsert/delete helpers, keeping Electron's
 * emitted event types and detail payloads in lock-step with the Rust reference
 * (`src-tauri/src/persistence.rs`) and the browser harness. Each entry names the
 * create/update/delete event types and builds the operator-facing detail object
 * recorded against the mission timeline.
 */
const AUDIT_EVENT_TABLES = {
  markers: {
    created: 'marker_created',
    updated: 'marker_updated',
    deleted: 'marker_deleted',
    upsertDetails: (row) => ({
      marker_id: row.id,
      marker_type: row.type,
      name: row.name,
      display_order: row.display_order,
      updated_by: row.updated_by ?? null,
      coordinator_ids: row.coordinator_ids ?? null,
      attachment_path: row.attachment_path ?? null,
    }),
    deleteDetails: (row) => ({
      marker_id: row.id,
      marker_type: row.type,
      name: row.name,
    }),
  },
  drawings: {
    created: 'drawing_created',
    updated: 'drawing_updated',
    deleted: 'drawing_deleted',
    upsertDetails: (row) => ({
      drawing_id: row.id,
      drawing_type: row.type,
      name: row.name,
      display_order: row.display_order,
    }),
    deleteDetails: (row) => ({
      drawing_id: row.id,
      drawing_type: row.type,
      name: row.name,
    }),
  },
  helicopters: {
    created: 'helicopter_created',
    updated: 'helicopter_updated',
    deleted: 'helicopter_deleted',
    upsertDetails: (row) => ({
      helicopter_id: row.id,
      slot_key: row.slot_key,
      call_sign: row.call_sign,
      hex_id: row.hex_id ?? null,
    }),
    deleteDetails: (row) => ({
      helicopter_id: row.id,
      slot_key: row.slot_key,
      call_sign: row.call_sign,
    }),
  },
  gpx_track_imports: {
    created: 'gpx_import_created',
    updated: 'gpx_import_updated',
    deleted: 'gpx_import_deleted',
    upsertDetails: (row) => ({
      gpx_import_id: row.id,
      source_path: row.source_path,
      file_name: row.file_name,
      display_name: row.display_name,
    }),
    deleteDetails: (row) => ({
      gpx_import_id: row.id,
      source_path: row.source_path,
      file_name: row.file_name,
      display_name: row.display_name,
    }),
  },
}

const IMMUTABLE_UPSERT_COLUMNS = {
  markers: new Set(['id', 'mission_id', 'created_at']),
  drawings: new Set(['id', 'mission_id', 'created_at']),
  gpx_track_imports: new Set(['id', 'mission_id', 'imported_at']),
}

function upsertById(db, table, input, defaults) {
  const row = defaults(input)
  const existing = db.prepare(`SELECT id, mission_id FROM ${table} WHERE id = ?`).get(row.id)
  const missionId = existing?.mission_id ?? input.mission_id
  if (existing !== undefined && existing.mission_id !== input.mission_id) {
    throw new Error(`Cannot move ${table} row ${row.id} to a different mission.`)
  }
  ensureWritableMission(db, missionId)
  const columns = Object.keys(row)
  const placeholders = columns.map(() => '?').join(', ')
  const immutableColumns = IMMUTABLE_UPSERT_COLUMNS[table] ?? new Set(['id'])
  const assignments = columns
    .filter((column) => !immutableColumns.has(column))
    .map((column) => `${column} = excluded.${column}`)
    .join(', ')
  const audit = AUDIT_EVENT_TABLES[table]
  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})
      ON CONFLICT(id) DO UPDATE SET ${assignments}`).run(...columns.map((column) => row[column]))
    insertEvent(
      db,
      missionId,
      existing === undefined ? audit.created : audit.updated,
      row.updated_at ?? now(),
      audit.upsertDetails(row),
    )
  })
  transaction()
  return getById(db, table, row.id, table)
}

function markerDefaults(input) {
  validateLatLon(input.lat, input.lon, 'Marker')
  const timestamp = now()
  return {
    id: input.id ?? randomUUID(),
    mission_id: input.mission_id,
    type: input.type,
    name: input.name,
    description: input.description ?? null,
    lat: input.lat,
    lon: input.lon,
    irish_grid_e: input.irish_grid_e,
    irish_grid_n: input.irish_grid_n,
    created_at: timestamp,
    updated_at: timestamp,
    display_order: input.display_order,
    subject_category: input.subject_category ?? null,
    clue_type: input.clue_type ?? null,
    confidence: input.confidence ?? null,
    found_by: input.found_by ?? null,
    hazard_type: input.hazard_type ?? null,
    severity: input.severity ?? null,
    condition: input.condition ?? null,
    treatment: input.treatment ?? null,
    evacuation_priority: input.evacuation_priority ?? null,
    label_size: input.label_size ?? null,
    updated_by: input.updated_by ?? null,
    coordinator_ids: input.coordinator_ids ?? null,
    attachment_path: input.attachment_path ?? null,
  }
}

function drawingDefaults(input) {
  const timestamp = now()
  return {
    id: input.id ?? randomUUID(),
    mission_id: input.mission_id,
    type: input.type,
    name: input.name,
    description: input.description ?? null,
    color: input.color ?? null,
    width: input.width ?? null,
    distance_m: input.distance_m ?? null,
    temporary_measure: input.temporary_measure === undefined || input.temporary_measure === null ? null : Number(Boolean(input.temporary_measure)),
    label: input.label ?? null,
    display_order: input.display_order,
    geometry_json: input.geometry_json,
    metadata_json: input.metadata_json ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

function gpxDefaults(input) {
  const timestamp = now()
  return {
    id: input.id ?? randomUUID(),
    mission_id: input.mission_id,
    source_path: input.source_path,
    file_name: input.file_name,
    display_name: input.display_name,
    geometry_json: input.geometry_json,
    metadata_json: input.metadata_json ?? null,
    imported_at: timestamp,
    updated_at: timestamp,
  }
}

function listLayerCatalogMetadata(db, missionId) {
  return all(
    db,
    `SELECT mission_id, node_id, parent_node_id, node_kind, alias, is_favorite, is_visible,
            display_order, metadata_json, updated_at
       FROM layer_catalog_entries
      WHERE mission_id = ?
      ORDER BY parent_node_id ASC, display_order ASC, node_id ASC`,
    missionId,
  ).map(fromLayerCatalogRow)
}

function upsertLayerCatalogMetadata(db, input) {
  ensureWritableMission(db, input.missionId)
  const timestamp = now()
  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO layer_catalog_entries (
      mission_id, node_id, parent_node_id, node_kind, alias, is_favorite, is_visible,
      display_order, metadata_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mission_id, node_id) DO UPDATE SET
      parent_node_id = excluded.parent_node_id,
      node_kind = excluded.node_kind,
      alias = excluded.alias,
      is_favorite = excluded.is_favorite,
      is_visible = excluded.is_visible,
      display_order = excluded.display_order,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at`)
    .run(
      input.missionId,
      input.nodeId,
      input.parentNodeId,
      input.nodeKind,
      input.alias ?? null,
      Number(input.isFavorite ?? false),
      Number(input.isVisible ?? true),
      input.displayOrder ?? 0,
      input.metadataJson ?? null,
      timestamp,
    )
    insertEvent(db, input.missionId, 'layer_catalog_metadata_updated', timestamp, {
      node_id: input.nodeId,
      parent_node_id: input.parentNodeId,
      node_kind: input.nodeKind,
      is_visible: Boolean(input.isVisible ?? true),
    })
  })
  transaction()
  const row = db.prepare(`SELECT mission_id, node_id, parent_node_id, node_kind, alias, is_favorite,
      is_visible, display_order, metadata_json, updated_at
      FROM layer_catalog_entries
      WHERE mission_id = ? AND node_id = ?`)
    .get(input.missionId, input.nodeId)
  return fromLayerCatalogRow(row)
}

function clearLayerCatalogMetadata(db, missionId) {
  ensureWritableMission(db, missionId)
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM layer_catalog_entries WHERE mission_id = ?').run(missionId)
    insertEvent(db, missionId, 'layer_catalog_repaired', now(), {
      action: 'reset_metadata',
      mission_id: missionId,
    })
  })
  transaction()
}

function fromLayerCatalogRow(row) {
  return {
    missionId: row.mission_id,
    nodeId: row.node_id,
    parentNodeId: row.parent_node_id,
    nodeKind: row.node_kind,
    alias: row.alias,
    isFavorite: Boolean(row.is_favorite),
    isVisible: Boolean(row.is_visible),
    displayOrder: row.display_order,
    metadataJson: row.metadata_json,
    updatedAt: row.updated_at,
  }
}

function getById(db, table, id, label) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
  if (row === undefined) {
    throw new Error(`${label} not found: ${id}`)
  }
  return row
}

/**
 * Deletes a row by id, mirroring the Rust reference: a no-op (returns false) when the
 * row is absent, otherwise enforcing the writable-mission guard so records on a
 * finished/finalized (locked) mission cannot be silently destroyed, and emitting the
 * matching `*_deleted` audit event inside the same transaction as the row removal.
 */
function deleteById(db, table, id) {
  const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
  if (existing === undefined) {
    return false
  }
  ensureWritableMission(db, existing.mission_id)
  const audit = AUDIT_EVENT_TABLES[table]
  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
    insertEvent(db, existing.mission_id, audit.deleted, now(), audit.deleteDetails(existing))
  })
  transaction()
  return true
}

function all(db, sql, ...params) {
  return db.prepare(sql).all(...params)
}

function ensureWritableMission(db, missionId) {
  const mission = getMission(db, missionId)
  if (mission.status === 'finished' || mission.status === 'finalized') {
    throw new Error(
      `Cannot write data to finished mission ${missionId}; resume the mission or unlock it first.`,
    )
  }
}

function validateLatLon(lat, lon, label) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`${label} latitude must be a finite value between -90 and 90.`)
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error(`${label} longitude must be a finite value between -180 and 180.`)
  }
}

function appendEvent(db, missionId, eventType, detailsJson, timestamp = now()) {
  insertEvent(db, missionId, eventType, timestamp, detailsJson)
}

function insertEvent(db, missionId, eventType, timestamp, detailsJson) {
  db.prepare('INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), missionId, eventType, timestamp, detailsJson === undefined || detailsJson === null ? null : JSON.stringify(detailsJson))
}

function now() {
  return new Date().toISOString()
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  createElectronMissionStore,
}
