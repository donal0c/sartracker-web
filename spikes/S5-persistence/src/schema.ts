/**
 * Schema definitions and migrations for SAR mission persistence.
 *
 * Each migration is a function that takes a Database and runs the DDL.
 * Migrations are cumulative and run in order from the current version.
 */
import type Database from 'better-sqlite3';

export const CURRENT_SCHEMA_VERSION = 2;

/** Migration from version 0 (empty) to version 1 — initial schema */
function migrateV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'finished')),
      start_time TEXT NOT NULL,
      pause_time TEXT,
      finish_time TEXT,
      notes TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#FF0000',
      last_seen TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_devices_mission ON devices(mission_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_mission_device ON devices(mission_id, device_id);

    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      altitude REAL,
      accuracy REAL,
      speed REAL,
      bearing REAL,
      battery REAL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_positions_mission_device ON positions(mission_id, device_id);
    CREATE INDEX IF NOT EXISTS idx_positions_timestamp ON positions(mission_id, device_id, timestamp);

    CREATE TABLE IF NOT EXISTS markers (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('ipp_lkp', 'clue', 'hazard', 'casualty')),
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      description TEXT,
      subject_category TEXT,
      confidence REAL,
      found_by TEXT,
      grid_reference TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_markers_mission ON markers(mission_id);
    CREATE INDEX IF NOT EXISTS idx_markers_type ON markers(mission_id, type);

    CREATE TABLE IF NOT EXISTS drawings (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('line', 'search_area', 'range_ring', 'bearing_line', 'sector')),
      name TEXT NOT NULL,
      geojson TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_drawings_mission ON drawings(mission_id);

    CREATE TABLE IF NOT EXISTS mission_events (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details_json TEXT,
      FOREIGN KEY (mission_id) REFERENCES missions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_events_mission ON mission_events(mission_id);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON mission_events(mission_id, timestamp);
  `);

  db.prepare(`INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', '1')`).run();
}

/** Migration from version 1 to version 2 — add priority column to markers */
function migrateV2(db: Database.Database): void {
  db.exec(`ALTER TABLE markers ADD COLUMN priority INTEGER DEFAULT 0;`);
  db.prepare(`UPDATE metadata SET value = '2' WHERE key = 'schema_version'`).run();
}

/** All migrations in order. Index = from_version. */
const migrations: Array<(db: Database.Database) => void> = [
  migrateV1, // 0 → 1
  migrateV2, // 1 → 2
];

/**
 * Get the current schema version from the database.
 * Returns 0 if no schema has been applied yet.
 */
export function getSchemaVersion(db: Database.Database): number {
  try {
    const row = db.prepare(`SELECT value FROM metadata WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    // metadata table doesn't exist yet
    return 0;
  }
}

/**
 * Run all pending migrations to bring the database up to CURRENT_SCHEMA_VERSION.
 * Runs each migration in a transaction for safety.
 */
export function migrate(db: Database.Database): void {
  let currentVersion = getSchemaVersion(db);

  while (currentVersion < CURRENT_SCHEMA_VERSION) {
    const migration = migrations[currentVersion];
    if (!migration) {
      throw new Error(
        `No migration found for version ${currentVersion} → ${currentVersion + 1}`
      );
    }

    db.transaction(() => {
      migration(db);
    })();

    currentVersion = getSchemaVersion(db);
  }
}

/**
 * Initialize the database: enable WAL mode, foreign keys, and run migrations.
 */
export function initializeDatabase(db: Database.Database): void {
  // WAL mode for crash safety and concurrent reads
  db.pragma('journal_mode = WAL');
  // Enforce foreign keys
  db.pragma('foreign_keys = ON');
  // Sync mode: NORMAL is safe with WAL and much faster than FULL
  db.pragma('synchronous = NORMAL');

  migrate(db);
}
