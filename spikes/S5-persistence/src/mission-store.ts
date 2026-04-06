/**
 * MissionStore — crash-safe SQLite persistence for SAR missions.
 *
 * Uses better-sqlite3 (synchronous) with WAL mode for:
 * - Crash safety: WAL ensures committed transactions survive process kills
 * - Performance: concurrent reads during writes
 * - Simplicity: no async complexity for desktop app
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { initializeDatabase, getSchemaVersion, CURRENT_SCHEMA_VERSION } from './schema.js';
import type {
  Mission,
  MissionStatus,
  Device,
  Position,
  PositionInput,
  Marker,
  MarkerInput,
  MarkerUpdate,
  Drawing,
  DrawingInput,
  DrawingUpdate,
  MissionEvent,
} from './types.js';

const MAX_BACKUPS = 3;
let backupCounter = 0;

export class MissionStore {
  readonly db: Database.Database;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    initializeDatabase(this.db);
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }

  /** Get current schema version */
  get schemaVersion(): number {
    return getSchemaVersion(this.db);
  }

  // ===================================================================
  // Mission Lifecycle
  // ===================================================================

  createMission(name: string): Mission {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO missions (id, name, status, start_time, schema_version)
      VALUES (?, ?, 'active', ?, ?)
    `).run(id, name, now, CURRENT_SCHEMA_VERSION);

    this._addEvent(id, 'mission_created', { name });

    return this.getMission(id);
  }

  pauseMission(id: string): void {
    const mission = this.getMission(id);
    if (mission.status !== 'active') {
      throw new Error(`Cannot pause mission with status '${mission.status}'`);
    }

    const now = new Date().toISOString();
    this.db.prepare(`UPDATE missions SET status = 'paused', pause_time = ? WHERE id = ?`).run(
      now,
      id
    );
    this._addEvent(id, 'mission_paused', null);
  }

  resumeMission(id: string): void {
    const mission = this.getMission(id);
    if (mission.status !== 'paused') {
      throw new Error(`Cannot resume mission with status '${mission.status}'`);
    }

    this.db.prepare(`UPDATE missions SET status = 'active', pause_time = NULL WHERE id = ?`).run(
      id
    );
    this._addEvent(id, 'mission_resumed', null);
  }

  finishMission(id: string): void {
    const mission = this.getMission(id);
    if (mission.status === 'finished') {
      throw new Error('Mission is already finished');
    }

    const now = new Date().toISOString();
    this.db.prepare(
      `UPDATE missions SET status = 'finished', finish_time = ?, pause_time = NULL WHERE id = ?`
    ).run(now, id);
    this._addEvent(id, 'mission_finished', null);
  }

  getActiveMission(): Mission | null {
    const row = this.db.prepare(`SELECT * FROM missions WHERE status = 'active' LIMIT 1`).get() as
      | Mission
      | undefined;
    return row ?? null;
  }

  getMission(id: string): Mission {
    const row = this.db.prepare(`SELECT * FROM missions WHERE id = ?`).get(id) as
      | Mission
      | undefined;
    if (!row) {
      throw new Error(`Mission not found: ${id}`);
    }
    return row;
  }

  listMissions(status?: MissionStatus): Mission[] {
    if (status) {
      return this.db.prepare(`SELECT * FROM missions WHERE status = ? ORDER BY start_time DESC`).all(status) as Mission[];
    }
    return this.db.prepare(`SELECT * FROM missions ORDER BY start_time DESC`).all() as Mission[];
  }

  // ===================================================================
  // Devices
  // ===================================================================

  upsertDevice(missionId: string, deviceId: string, name: string, color: string = '#FF0000'): Device {
    const now = new Date().toISOString();
    const id = randomUUID();

    this.db.prepare(`
      INSERT INTO devices (id, mission_id, device_id, name, color, last_seen)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(mission_id, device_id) DO UPDATE SET
        name = excluded.name,
        color = excluded.color,
        last_seen = excluded.last_seen
    `).run(id, missionId, deviceId, name, color, now);

    return this.db.prepare(
      `SELECT * FROM devices WHERE mission_id = ? AND device_id = ?`
    ).get(missionId, deviceId) as Device;
  }

  getDevices(missionId: string): Device[] {
    return this.db.prepare(`SELECT * FROM devices WHERE mission_id = ? ORDER BY name`).all(
      missionId
    ) as Device[];
  }

  // ===================================================================
  // Positions
  // ===================================================================

  addPosition(missionId: string, deviceId: string, position: PositionInput): void {
    const id = randomUUID();
    const timestamp = position.timestamp ?? new Date().toISOString();

    this.db.prepare(`
      INSERT INTO positions (id, mission_id, device_id, lat, lon, altitude, accuracy, speed, bearing, battery, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      missionId,
      deviceId,
      position.lat,
      position.lon,
      position.altitude ?? null,
      position.accuracy ?? null,
      position.speed ?? null,
      position.bearing ?? null,
      position.battery ?? null,
      timestamp
    );

    // Update device last_seen
    this.db.prepare(`
      UPDATE devices SET last_seen = ? WHERE mission_id = ? AND device_id = ?
    `).run(timestamp, missionId, deviceId);
  }

  /** Bulk insert positions in a single transaction for performance */
  addPositionsBatch(missionId: string, deviceId: string, positions: PositionInput[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO positions (id, mission_id, device_id, lat, lon, altitude, accuracy, speed, bearing, battery, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAll = this.db.transaction((items: PositionInput[]) => {
      for (const pos of items) {
        const id = randomUUID();
        const timestamp = pos.timestamp ?? new Date().toISOString();
        stmt.run(
          id,
          missionId,
          deviceId,
          pos.lat,
          pos.lon,
          pos.altitude ?? null,
          pos.accuracy ?? null,
          pos.speed ?? null,
          pos.bearing ?? null,
          pos.battery ?? null,
          timestamp
        );
      }
    });

    insertAll(positions);
  }

  getPositions(
    missionId: string,
    deviceId?: string,
    fromTime?: string,
    toTime?: string
  ): Position[] {
    let sql = `SELECT * FROM positions WHERE mission_id = ?`;
    const params: unknown[] = [missionId];

    if (deviceId) {
      sql += ` AND device_id = ?`;
      params.push(deviceId);
    }
    if (fromTime) {
      sql += ` AND timestamp >= ?`;
      params.push(fromTime);
    }
    if (toTime) {
      sql += ` AND timestamp <= ?`;
      params.push(toTime);
    }

    sql += ` ORDER BY timestamp ASC`;
    return this.db.prepare(sql).all(...params) as Position[];
  }

  /** Get the latest position for each device in a mission */
  getLatestPositions(missionId: string): Position[] {
    return this.db.prepare(`
      SELECT p.* FROM positions p
      INNER JOIN (
        SELECT device_id, MAX(timestamp) as max_ts
        FROM positions
        WHERE mission_id = ?
        GROUP BY device_id
      ) latest ON p.device_id = latest.device_id AND p.timestamp = latest.max_ts
      WHERE p.mission_id = ?
    `).all(missionId, missionId) as Position[];
  }

  // ===================================================================
  // Markers
  // ===================================================================

  addMarker(missionId: string, marker: MarkerInput): Marker {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO markers (id, mission_id, type, name, lat, lon, description, subject_category, confidence, found_by, grid_reference, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      missionId,
      marker.type,
      marker.name,
      marker.lat,
      marker.lon,
      marker.description ?? null,
      marker.subject_category ?? null,
      marker.confidence ?? null,
      marker.found_by ?? null,
      marker.grid_reference ?? null,
      now
    );

    this._addEvent(missionId, 'marker_added', { marker_id: id, type: marker.type, name: marker.name });

    return this.db.prepare(`SELECT * FROM markers WHERE id = ?`).get(id) as Marker;
  }

  updateMarker(id: string, updates: MarkerUpdate): void {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (setClauses.length === 0) return;

    params.push(id);
    this.db.prepare(`UPDATE markers SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
  }

  deleteMarker(id: string): void {
    this.db.prepare(`DELETE FROM markers WHERE id = ?`).run(id);
  }

  getMarkers(missionId: string, type?: string): Marker[] {
    if (type) {
      return this.db.prepare(`SELECT * FROM markers WHERE mission_id = ? AND type = ? ORDER BY created_at`).all(
        missionId,
        type
      ) as Marker[];
    }
    return this.db.prepare(`SELECT * FROM markers WHERE mission_id = ? ORDER BY created_at`).all(
      missionId
    ) as Marker[];
  }

  // ===================================================================
  // Drawings
  // ===================================================================

  addDrawing(missionId: string, drawing: DrawingInput): Drawing {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO drawings (id, mission_id, type, name, geojson, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, missionId, drawing.type, drawing.name, drawing.geojson, drawing.metadata_json ?? null, now);

    this._addEvent(missionId, 'drawing_added', { drawing_id: id, type: drawing.type, name: drawing.name });

    return this.db.prepare(`SELECT * FROM drawings WHERE id = ?`).get(id) as Drawing;
  }

  updateDrawing(id: string, updates: DrawingUpdate): void {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (setClauses.length === 0) return;

    params.push(id);
    this.db.prepare(`UPDATE drawings SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
  }

  deleteDrawing(id: string): void {
    this.db.prepare(`DELETE FROM drawings WHERE id = ?`).run(id);
  }

  getDrawings(missionId: string, type?: string): Drawing[] {
    if (type) {
      return this.db.prepare(`SELECT * FROM drawings WHERE mission_id = ? AND type = ? ORDER BY created_at`).all(
        missionId,
        type
      ) as Drawing[];
    }
    return this.db.prepare(`SELECT * FROM drawings WHERE mission_id = ? ORDER BY created_at`).all(
      missionId
    ) as Drawing[];
  }

  // ===================================================================
  // Events
  // ===================================================================

  getEvents(missionId: string): MissionEvent[] {
    return this.db.prepare(
      `SELECT * FROM mission_events WHERE mission_id = ? ORDER BY timestamp ASC`
    ).all(missionId) as MissionEvent[];
  }

  // ===================================================================
  // Backup
  // ===================================================================

  /**
   * Create a backup of the database file.
   * Uses VACUUM INTO for a consistent snapshot (SQLite 3.27+).
   * Rotates backups to keep only the last MAX_BACKUPS.
   */
  createBackup(backupDir?: string): string {
    const dir = backupDir ?? path.join(path.dirname(this.dbPath), 'backups');
    fs.mkdirSync(dir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const seq = String(backupCounter++).padStart(4, '0');
    const backupName = `mission-backup-${timestamp}-${seq}.db`;
    const backupPath = path.join(dir, backupName);

    // VACUUM INTO creates a consistent snapshot even during active writes
    this.db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

    // Rotate: keep only last MAX_BACKUPS
    this._rotateBackups(dir);

    return backupPath;
  }

  /** List existing backup files, newest first */
  listBackups(backupDir?: string): string[] {
    const dir = backupDir ?? path.join(path.dirname(this.dbPath), 'backups');
    if (!fs.existsSync(dir)) return [];

    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('mission-backup-') && f.endsWith('.db'))
      .sort()
      .reverse()
      .map((f) => path.join(dir, f));
  }

  /** Restore from a backup file. Closes current DB, replaces it, reopens. */
  static restoreFromBackup(backupPath: string, targetPath: string): MissionStore {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    fs.copyFileSync(backupPath, targetPath);
    return new MissionStore(targetPath);
  }

  // ===================================================================
  // Internals
  // ===================================================================

  private _addEvent(missionId: string, eventType: string, details: unknown): void {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, missionId, eventType, now, details ? JSON.stringify(details) : null);
  }

  private _rotateBackups(dir: string): void {
    const backups = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('mission-backup-') && f.endsWith('.db'))
      .sort(); // oldest first

    while (backups.length > MAX_BACKUPS) {
      const oldest = backups.shift()!;
      fs.unlinkSync(path.join(dir, oldest));
    }
  }
}
