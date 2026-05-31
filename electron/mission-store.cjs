const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const Database = require('better-sqlite3')

const CURRENT_SCHEMA_VERSION = 3
const DATABASE_FILE_NAME = 'mission-store.sqlite'
const BACKUP_FILE_NAME = 'mission-store.backup.sqlite'

/**
 * Creates the Electron SQLite mission store.
 */
function createElectronMissionStore(options) {
  const databasePath = path.join(options.userDataPath, DATABASE_FILE_NAME)
  const backupPath = path.join(options.userDataPath, BACKUP_FILE_NAME)
  const db = new Database(databasePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)

  return {
    close: () => db.close(),
    info: async () => ({
      schema_version: schemaVersion(db),
      database_path: databasePath,
      backup_path: backupPath,
    }),
    syncBackup: async () => syncBackup(db, backupPath),
    createMissionArchive: async (missionId) => {
      throw new Error(`Electron mission archive export is tracked by DON-34 and is not available yet for mission ${missionId}.`)
    },
    createMission: async (input) => createMission(db, input),
    upsertDevice: async (input) => upsertDevice(db, input),
    getDevice: async (missionId, deviceId) => getDevice(db, missionId, deviceId),
    listDevices: async (missionId) => all(db, 'SELECT * FROM devices WHERE mission_id = ? ORDER BY name ASC', missionId),
    addPosition: async (input) => addPosition(db, input),
    listPositions: async (missionId, deviceId) =>
      deviceId === undefined
        ? all(db, 'SELECT * FROM positions WHERE mission_id = ? ORDER BY timestamp ASC', missionId)
        : all(db, 'SELECT * FROM positions WHERE mission_id = ? AND device_id = ? ORDER BY timestamp ASC', missionId, deviceId),
    latestPositions: async (missionId) => latestPositions(db, missionId),
    listMissionEvents: async (missionId) =>
      all(db, 'SELECT * FROM mission_events WHERE mission_id = ? ORDER BY timestamp ASC, id ASC', missionId),
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
    finalizeMission: async (missionId) => finalizeMission(db, missionId, backupPath),
    unlockFinalizedMission: async (input) => unlockFinalizedMission(db, input, options.readAdminRoster),
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
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
  db.prepare("INSERT INTO metadata (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(CURRENT_SCHEMA_VERSION))
}

function schemaVersion(db) {
  const row = db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()
  return Number(row?.value ?? CURRENT_SCHEMA_VERSION)
}

async function syncBackup(db, backupPath) {
  await fs.mkdir(path.dirname(backupPath), { recursive: true })
  await db.backup(backupPath)
  const activeMission = getActiveMission(db)
  if (activeMission !== null) {
    appendEvent(db, activeMission.id, 'mission_backup_synced', { backup_path: backupPath })
  }
  return backupPath
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
  const transaction = db.transaction(() => {
    db.prepare('UPDATE missions SET status = ?, pause_time = ?, finish_time = NULL WHERE id = ?')
      .run(nextStatus, pauseTime, missionId)
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
  const transaction = db.transaction(() => {
    db.prepare('UPDATE missions SET status = ?, pause_time = NULL, finish_time = ? WHERE id = ?')
      .run('finished', timestamp, missionId)
    insertEvent(db, missionId, 'mission_finished', timestamp, { status: 'finished' })
  })
  transaction()
  return getMission(db, missionId)
}

async function finalizeMission(db, missionId, backupPath) {
  const mission = getMission(db, missionId)
  if (mission.status !== 'finished') {
    throw new Error('Only finished missions can be finalized.')
  }
  await syncBackup(db, backupPath)
  const archive = {
    mission_id: missionId,
    archive_path: backupPath,
    created_at: now(),
  }
  const transaction = db.transaction(() => {
    db.prepare('UPDATE missions SET status = ? WHERE id = ?').run('finalized', missionId)
    insertEvent(db, missionId, 'mission_finalized', archive.created_at, {
      resulting_status: 'finalized',
      archive_path: archive.archive_path,
    })
  })
  transaction()
  return { mission: getMission(db, missionId), archive }
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
  db.prepare(`INSERT INTO devices (id, mission_id, device_id, name, color, last_seen, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mission_id, device_id) DO UPDATE SET
      name = excluded.name, color = excluded.color, last_seen = excluded.last_seen, status = excluded.status`)
    .run(id, input.mission_id, input.device_id, input.name, input.color, input.last_seen ?? null, input.status)
  appendEvent(db, input.mission_id, 'device_updated', {
    device_id: input.device_id,
    name: input.name,
    status: input.status,
    color: input.color,
  }, timestamp)
  return getDevice(db, input.mission_id, input.device_id)
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

function upsertHelicopter(db, input) {
  ensureWritableMission(db, input.mission_id)
  validateLatLon(input.lat, input.lon, 'Helicopter')
  const existing = db.prepare('SELECT id FROM helicopters WHERE mission_id = ? AND slot_key = ?').get(input.mission_id, input.slot_key)
  const id = input.id ?? existing?.id ?? randomUUID()
  const timestamp = input.last_update ?? now()
  db.prepare(`INSERT INTO helicopters (id, mission_id, slot_key, call_sign, hex_id, lat, lon, altitude, speed, heading, last_update, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mission_id, slot_key) DO UPDATE SET
      call_sign = excluded.call_sign, hex_id = excluded.hex_id, lat = excluded.lat, lon = excluded.lon,
      altitude = excluded.altitude, speed = excluded.speed, heading = excluded.heading,
      last_update = excluded.last_update, updated_at = excluded.updated_at`)
    .run(id, input.mission_id, input.slot_key, input.call_sign, input.hex_id ?? null, input.lat, input.lon, input.altitude ?? null, input.speed ?? null, input.heading ?? null, timestamp, timestamp, timestamp)
  return getById(db, 'helicopters', id, 'Helicopter')
}

function upsertById(db, table, input, defaults) {
  ensureWritableMission(db, input.mission_id)
  const row = defaults(input)
  const columns = Object.keys(row)
  const placeholders = columns.map(() => '?').join(', ')
  const assignments = columns.filter((column) => column !== 'id').map((column) => `${column} = excluded.${column}`).join(', ')
  db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})
    ON CONFLICT(id) DO UPDATE SET ${assignments}`).run(...columns.map((column) => row[column]))
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

function deleteById(db, table, id) {
  return db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0
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
