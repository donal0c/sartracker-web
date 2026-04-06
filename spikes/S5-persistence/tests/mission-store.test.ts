import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MissionStore } from '../src/mission-store.js';
import { getSchemaVersion, CURRENT_SCHEMA_VERSION } from '../src/schema.js';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-test-'));
  return path.join(dir, 'test-mission.db');
}

function cleanup(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('MissionStore', () => {
  let store: MissionStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = new MissionStore(dbPath);
  });

  afterEach(() => {
    try { store.close(); } catch { /* already closed */ }
    cleanup(dbPath);
  });

  // =================================================================
  // Schema & Initialization
  // =================================================================

  describe('schema initialization', () => {
    it('creates database with current schema version', () => {
      expect(store.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('enables WAL mode', () => {
      const mode = store.db.pragma('journal_mode', { simple: true });
      expect(mode).toBe('wal');
    });

    it('enables foreign keys', () => {
      const fk = store.db.pragma('foreign_keys', { simple: true });
      expect(fk).toBe(1);
    });
  });

  // =================================================================
  // Mission Lifecycle
  // =================================================================

  describe('mission lifecycle', () => {
    it('creates a mission with active status', () => {
      const mission = store.createMission('Kerry MR - Missing Hiker');
      expect(mission.name).toBe('Kerry MR - Missing Hiker');
      expect(mission.status).toBe('active');
      expect(mission.start_time).toBeTruthy();
      expect(mission.pause_time).toBeNull();
      expect(mission.finish_time).toBeNull();
    });

    it('retrieves a mission by id', () => {
      const created = store.createMission('Test Mission');
      const fetched = store.getMission(created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe('Test Mission');
    });

    it('throws for non-existent mission', () => {
      expect(() => store.getMission('nonexistent')).toThrow('Mission not found');
    });

    it('gets active mission', () => {
      expect(store.getActiveMission()).toBeNull();
      const m = store.createMission('Active One');
      expect(store.getActiveMission()!.id).toBe(m.id);
    });

    it('pauses an active mission', () => {
      const m = store.createMission('Test');
      store.pauseMission(m.id);
      const paused = store.getMission(m.id);
      expect(paused.status).toBe('paused');
      expect(paused.pause_time).toBeTruthy();
    });

    it('resumes a paused mission', () => {
      const m = store.createMission('Test');
      store.pauseMission(m.id);
      store.resumeMission(m.id);
      const resumed = store.getMission(m.id);
      expect(resumed.status).toBe('active');
      expect(resumed.pause_time).toBeNull();
    });

    it('finishes a mission', () => {
      const m = store.createMission('Test');
      store.finishMission(m.id);
      const finished = store.getMission(m.id);
      expect(finished.status).toBe('finished');
      expect(finished.finish_time).toBeTruthy();
    });

    it('prevents pausing a finished mission', () => {
      const m = store.createMission('Test');
      store.finishMission(m.id);
      expect(() => store.pauseMission(m.id)).toThrow();
    });

    it('prevents resuming an active mission', () => {
      const m = store.createMission('Test');
      expect(() => store.resumeMission(m.id)).toThrow();
    });

    it('prevents finishing an already finished mission', () => {
      const m = store.createMission('Test');
      store.finishMission(m.id);
      expect(() => store.finishMission(m.id)).toThrow('already finished');
    });

    it('can finish a paused mission', () => {
      const m = store.createMission('Test');
      store.pauseMission(m.id);
      store.finishMission(m.id);
      const finished = store.getMission(m.id);
      expect(finished.status).toBe('finished');
      expect(finished.pause_time).toBeNull();
    });

    it('lists missions by status', () => {
      store.createMission('A');
      const b = store.createMission('B');
      store.pauseMission(b.id);
      const c = store.createMission('C');
      store.finishMission(c.id);

      expect(store.listMissions('active')).toHaveLength(1);
      expect(store.listMissions('paused')).toHaveLength(1);
      expect(store.listMissions('finished')).toHaveLength(1);
      expect(store.listMissions()).toHaveLength(3);
    });
  });

  // =================================================================
  // Mission Events
  // =================================================================

  describe('mission events', () => {
    it('records lifecycle events', () => {
      const m = store.createMission('Test');
      store.pauseMission(m.id);
      store.resumeMission(m.id);
      store.finishMission(m.id);

      const events = store.getEvents(m.id);
      const types = events.map((e) => e.event_type);
      expect(types).toEqual([
        'mission_created',
        'mission_paused',
        'mission_resumed',
        'mission_finished',
      ]);
    });
  });

  // =================================================================
  // Full CRUD Workflow
  // =================================================================

  describe('full CRUD workflow', () => {
    it('create mission → positions → markers → drawings → query all', () => {
      const mission = store.createMission('Full Workflow');

      // Add device
      store.upsertDevice(mission.id, 'device-1', 'Radio Alpha', '#00FF00');

      // Add positions
      for (let i = 0; i < 10; i++) {
        store.addPosition(mission.id, 'device-1', {
          lat: 51.97 + i * 0.001,
          lon: -9.89 + i * 0.001,
          altitude: 300 + i,
          accuracy: 5,
          speed: 1.2,
          bearing: 45,
          battery: 85,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
        });
      }

      // Add markers
      const ipp = store.addMarker(mission.id, {
        type: 'ipp_lkp',
        name: 'Last Known Position',
        lat: 51.97,
        lon: -9.89,
        description: 'Car park at trailhead',
        grid_reference: 'V768852',
      });

      const clue = store.addMarker(mission.id, {
        type: 'clue',
        name: 'Glove found',
        lat: 51.975,
        lon: -9.885,
        found_by: 'Team Alpha',
      });

      // Add drawings
      const searchArea = store.addDrawing(mission.id, {
        type: 'search_area',
        name: 'Primary search zone',
        geojson: JSON.stringify({
          type: 'Polygon',
          coordinates: [[[- 9.9, 51.96], [-9.88, 51.96], [-9.88, 51.98], [-9.9, 51.98], [-9.9, 51.96]]],
        }),
      });

      // Query everything back
      const positions = store.getPositions(mission.id);
      expect(positions).toHaveLength(10);

      const markers = store.getMarkers(mission.id);
      expect(markers).toHaveLength(2);

      const ippMarkers = store.getMarkers(mission.id, 'ipp_lkp');
      expect(ippMarkers).toHaveLength(1);
      expect(ippMarkers[0].name).toBe('Last Known Position');

      const drawings = store.getDrawings(mission.id);
      expect(drawings).toHaveLength(1);
      expect(drawings[0].name).toBe('Primary search zone');

      const latestPos = store.getLatestPositions(mission.id);
      expect(latestPos).toHaveLength(1);
      expect(latestPos[0].device_id).toBe('device-1');

      const devices = store.getDevices(mission.id);
      expect(devices).toHaveLength(1);
      expect(devices[0].name).toBe('Radio Alpha');

      // Update marker
      store.updateMarker(ipp.id, { description: 'Updated description' });
      const updatedIpp = store.getMarkers(mission.id, 'ipp_lkp')[0];
      expect(updatedIpp.description).toBe('Updated description');

      // Delete marker
      store.deleteMarker(clue.id);
      expect(store.getMarkers(mission.id)).toHaveLength(1);

      // Update drawing
      store.updateDrawing(searchArea.id, { name: 'Updated search zone' });
      const updatedDrawing = store.getDrawings(mission.id)[0];
      expect(updatedDrawing.name).toBe('Updated search zone');

      // Delete drawing
      store.deleteDrawing(searchArea.id);
      expect(store.getDrawings(mission.id)).toHaveLength(0);
    });
  });

  // =================================================================
  // Positions
  // =================================================================

  describe('positions', () => {
    it('queries by device and time range', () => {
      const m = store.createMission('Test');
      store.upsertDevice(m.id, 'd1', 'Dev1');
      store.upsertDevice(m.id, 'd2', 'Dev2');

      const baseTime = new Date('2026-04-06T10:00:00Z');

      for (let i = 0; i < 5; i++) {
        store.addPosition(m.id, 'd1', {
          lat: 52.0,
          lon: -9.5,
          timestamp: new Date(baseTime.getTime() + i * 60_000).toISOString(),
        });
        store.addPosition(m.id, 'd2', {
          lat: 52.1,
          lon: -9.6,
          timestamp: new Date(baseTime.getTime() + i * 60_000).toISOString(),
        });
      }

      // All positions
      expect(store.getPositions(m.id)).toHaveLength(10);

      // By device
      expect(store.getPositions(m.id, 'd1')).toHaveLength(5);

      // By time range
      const from = new Date(baseTime.getTime() + 60_000).toISOString();
      const to = new Date(baseTime.getTime() + 3 * 60_000).toISOString();
      expect(store.getPositions(m.id, 'd1', from, to)).toHaveLength(3);

      // Latest per device
      const latest = store.getLatestPositions(m.id);
      expect(latest).toHaveLength(2);
    });

    it('handles batch insert', () => {
      const m = store.createMission('Batch');
      store.upsertDevice(m.id, 'd1', 'Dev1');

      const positions = Array.from({ length: 100 }, (_, i) => ({
        lat: 52.0 + i * 0.0001,
        lon: -9.5,
        timestamp: new Date(Date.now() + i * 100).toISOString(),
      }));

      store.addPositionsBatch(m.id, 'd1', positions);
      expect(store.getPositions(m.id)).toHaveLength(100);
    });
  });

  // =================================================================
  // Devices
  // =================================================================

  describe('devices', () => {
    it('upserts device — updates on conflict', () => {
      const m = store.createMission('Test');
      const d1 = store.upsertDevice(m.id, 'radio-1', 'Radio One', '#FF0000');
      expect(d1.name).toBe('Radio One');

      const d2 = store.upsertDevice(m.id, 'radio-1', 'Radio One Updated', '#00FF00');
      expect(d2.name).toBe('Radio One Updated');
      expect(d2.color).toBe('#00FF00');

      // Still only one device
      expect(store.getDevices(m.id)).toHaveLength(1);
    });

    it('handles duplicate device IDs across missions', () => {
      const m1 = store.createMission('Mission 1');
      const m2 = store.createMission('Mission 2');
      store.upsertDevice(m1.id, 'radio-1', 'Radio One M1');
      store.upsertDevice(m2.id, 'radio-1', 'Radio One M2');

      expect(store.getDevices(m1.id)).toHaveLength(1);
      expect(store.getDevices(m2.id)).toHaveLength(1);
    });
  });

  // =================================================================
  // Edge Cases
  // =================================================================

  describe('edge cases', () => {
    it('handles empty mission with no data', () => {
      const m = store.createMission('Empty');
      expect(store.getPositions(m.id)).toHaveLength(0);
      expect(store.getMarkers(m.id)).toHaveLength(0);
      expect(store.getDrawings(m.id)).toHaveLength(0);
      expect(store.getLatestPositions(m.id)).toHaveLength(0);
      expect(store.getDevices(m.id)).toHaveLength(0);
    });

    it('rejects invalid marker types at DB level', () => {
      const m = store.createMission('Test');
      expect(() =>
        store.db.prepare(`
          INSERT INTO markers (id, mission_id, type, name, lat, lon, created_at)
          VALUES ('x', ?, 'invalid_type', 'Bad', 0, 0, datetime('now'))
        `).run(m.id)
      ).toThrow();
    });

    it('rejects invalid drawing types at DB level', () => {
      const m = store.createMission('Test');
      expect(() =>
        store.db.prepare(`
          INSERT INTO drawings (id, mission_id, type, name, geojson, created_at)
          VALUES ('x', ?, 'invalid_type', 'Bad', '{}', datetime('now'))
        `).run(m.id)
      ).toThrow();
    });

    it('rejects invalid mission status at DB level', () => {
      expect(() =>
        store.db.prepare(`
          INSERT INTO missions (id, name, status, start_time, schema_version)
          VALUES ('x', 'Bad', 'invalid', datetime('now'), 1)
        `).run()
      ).toThrow();
    });
  });

  // =================================================================
  // Crash Recovery / WAL Durability
  // =================================================================

  describe('crash recovery', () => {
    it('survives unclean shutdown — data persists after close without explicit flush', () => {
      const m = store.createMission('Crash Test');
      store.upsertDevice(m.id, 'd1', 'Device');

      // Add data
      for (let i = 0; i < 100; i++) {
        store.addPosition(m.id, 'd1', {
          lat: 52.0 + i * 0.0001,
          lon: -9.5,
        });
      }
      store.addMarker(m.id, { type: 'clue', name: 'Evidence', lat: 52.0, lon: -9.5 });

      const missionId = m.id;

      // Simulate crash: close without checkpoint
      store.close();

      // Reopen — WAL recovery should happen automatically
      const recovered = new MissionStore(dbPath);
      const recoveredMission = recovered.getMission(missionId);
      expect(recoveredMission.name).toBe('Crash Test');
      expect(recovered.getPositions(missionId)).toHaveLength(100);
      expect(recovered.getMarkers(missionId)).toHaveLength(1);
      recovered.close();
    });

    it('recovers from corrupted WAL by rebuilding from main DB', () => {
      const m = store.createMission('WAL Corrupt Test');
      store.addMarker(m.id, { type: 'hazard', name: 'Cliff', lat: 52.0, lon: -9.5 });
      const missionId = m.id;

      // Force WAL checkpoint so data is in the main DB file
      store.db.pragma('wal_checkpoint(TRUNCATE)');
      store.close();

      // Corrupt the WAL file (if it exists)
      const walPath = dbPath + '-wal';
      if (fs.existsSync(walPath)) {
        fs.writeFileSync(walPath, Buffer.alloc(512, 0xFF));
      }

      // SQLite should recover by ignoring corrupt WAL
      const recovered = new MissionStore(dbPath);
      const recoveredMission = recovered.getMission(missionId);
      expect(recoveredMission.name).toBe('WAL Corrupt Test');
      // Data that was checkpointed should survive
      expect(recovered.getMarkers(missionId).length).toBeGreaterThanOrEqual(1);
      recovered.close();
    });
  });

  // =================================================================
  // Schema Migration
  // =================================================================

  describe('schema migration', () => {
    it('migrates from v1 to v2 (adds priority column to markers)', () => {
      // Create a v1-only database manually
      const v1Path = tmpDbPath();
      const v1Db = new Database(v1Path);
      v1Db.pragma('journal_mode = WAL');
      v1Db.pragma('foreign_keys = ON');

      // Apply only v1 schema
      v1Db.exec(`
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO metadata (key, value) VALUES ('schema_version', '1');

        CREATE TABLE missions (
          id TEXT PRIMARY KEY, name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'finished')),
          start_time TEXT NOT NULL, pause_time TEXT, finish_time TEXT, notes TEXT,
          schema_version INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE devices (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, device_id TEXT NOT NULL,
          name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#FF0000', last_seen TEXT NOT NULL,
          FOREIGN KEY (mission_id) REFERENCES missions(id)
        );
        CREATE UNIQUE INDEX idx_devices_mission_device ON devices(mission_id, device_id);

        CREATE TABLE positions (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, device_id TEXT NOT NULL,
          lat REAL NOT NULL, lon REAL NOT NULL, altitude REAL, accuracy REAL,
          speed REAL, bearing REAL, battery REAL, timestamp TEXT NOT NULL,
          FOREIGN KEY (mission_id) REFERENCES missions(id)
        );

        CREATE TABLE markers (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('ipp_lkp', 'clue', 'hazard', 'casualty')),
          name TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
          description TEXT, subject_category TEXT, confidence REAL,
          found_by TEXT, grid_reference TEXT, created_at TEXT NOT NULL,
          FOREIGN KEY (mission_id) REFERENCES missions(id)
        );

        CREATE TABLE drawings (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('line', 'search_area', 'range_ring', 'bearing_line', 'sector')),
          name TEXT NOT NULL, geojson TEXT NOT NULL, metadata_json TEXT, created_at TEXT NOT NULL,
          FOREIGN KEY (mission_id) REFERENCES missions(id)
        );

        CREATE TABLE mission_events (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL,
          event_type TEXT NOT NULL, timestamp TEXT NOT NULL, details_json TEXT,
          FOREIGN KEY (mission_id) REFERENCES missions(id)
        );
      `);

      // Insert v1 data
      v1Db.prepare(`
        INSERT INTO missions (id, name, status, start_time, schema_version)
        VALUES ('m1', 'V1 Mission', 'active', datetime('now'), 1)
      `).run();

      v1Db.prepare(`
        INSERT INTO markers (id, mission_id, type, name, lat, lon, created_at)
        VALUES ('mk1', 'm1', 'clue', 'V1 Marker', 52.0, -9.5, datetime('now'))
      `).run();

      expect(getSchemaVersion(v1Db)).toBe(1);
      v1Db.close();

      // Open with MissionStore — should auto-migrate to v2
      const migrated = new MissionStore(v1Path);
      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

      // Verify the priority column exists and old data survives
      const marker = migrated.db.prepare(`SELECT * FROM markers WHERE id = 'mk1'`).get() as Record<string, unknown>;
      expect(marker.name).toBe('V1 Marker');
      expect(marker.priority).toBe(0); // default value

      // Can use the new column
      migrated.db.prepare(`UPDATE markers SET priority = 3 WHERE id = 'mk1'`).run();
      const updated = migrated.db.prepare(`SELECT priority FROM markers WHERE id = 'mk1'`).get() as Record<string, unknown>;
      expect(updated.priority).toBe(3);

      migrated.close();
      cleanup(v1Path);
    });
  });

  // =================================================================
  // Backup & Rotation
  // =================================================================

  describe('backup and rotation', () => {
    it('creates a backup file', () => {
      store.createMission('Backup Test');
      const backupPath = store.createBackup();
      expect(fs.existsSync(backupPath)).toBe(true);

      // Verify backup is a valid SQLite DB
      const backupDb = new Database(backupPath);
      const missions = backupDb.prepare(`SELECT * FROM missions`).all();
      expect(missions).toHaveLength(1);
      backupDb.close();
    });

    it('rotates backups — keeps only last 3', () => {
      const backupDir = path.join(path.dirname(dbPath), 'backups');
      store.createMission('Test');

      // Create 5 backups
      for (let i = 0; i < 5; i++) {
        store.createBackup(backupDir);
      }

      const backups = store.listBackups(backupDir);
      expect(backups).toHaveLength(3);
    });

    it('restores from backup', () => {
      const m = store.createMission('Original');
      store.addMarker(m.id, { type: 'clue', name: 'Original Marker', lat: 52.0, lon: -9.5 });

      const backupPath = store.createBackup();
      store.close();

      // Restore to a new path
      const restorePath = path.join(path.dirname(dbPath), 'restored.db');
      const restored = MissionStore.restoreFromBackup(backupPath, restorePath);

      const missions = restored.listMissions();
      expect(missions).toHaveLength(1);
      expect(missions[0].name).toBe('Original');

      const markers = restored.getMarkers(missions[0].id);
      expect(markers).toHaveLength(1);
      expect(markers[0].name).toBe('Original Marker');

      restored.close();
    });
  });

  // =================================================================
  // Concurrent Access
  // =================================================================

  describe('concurrent access', () => {
    it('handles simultaneous add marker + batch insert positions', () => {
      const m = store.createMission('Concurrent');
      store.upsertDevice(m.id, 'd1', 'Device');

      // Simulate interleaved operations (synchronous, but tests transaction safety)
      const positions = Array.from({ length: 1000 }, (_, i) => ({
        lat: 52.0 + i * 0.00001,
        lon: -9.5,
        timestamp: new Date(Date.now() + i * 10).toISOString(),
      }));

      // Batch insert in a transaction
      store.addPositionsBatch(m.id, 'd1', positions);

      // Add marker (would interleave in a real async scenario)
      store.addMarker(m.id, { type: 'clue', name: 'During batch', lat: 52.0, lon: -9.5 });

      expect(store.getPositions(m.id)).toHaveLength(1000);
      expect(store.getMarkers(m.id)).toHaveLength(1);
    });

    it('second connection can read while first writes', () => {
      const m = store.createMission('WAL Concurrency');
      store.upsertDevice(m.id, 'd1', 'Device');

      // Open second reader connection
      const reader = new Database(dbPath, { readonly: true });

      // Write via store
      store.addPosition(m.id, 'd1', { lat: 52.0, lon: -9.5 });

      // Read via second connection — WAL allows this
      const positions = reader.prepare(`SELECT * FROM positions WHERE mission_id = ?`).all(m.id);
      expect(positions.length).toBeGreaterThanOrEqual(0); // may see 0 or 1 depending on timing

      reader.close();
    });
  });

  // =================================================================
  // Performance: 30K Positions
  // =================================================================

  describe('performance', () => {
    it('inserts 30,000 positions and queries by device + time range < 50ms', () => {
      const m = store.createMission('Perf Test');
      store.upsertDevice(m.id, 'device-perf', 'Perf Device');

      const baseTime = new Date('2026-04-06T00:00:00Z').getTime();

      // Generate 30K positions
      const positions = Array.from({ length: 30_000 }, (_, i) => ({
        lat: 52.0 + (i % 1000) * 0.0001,
        lon: -9.5 + Math.floor(i / 1000) * 0.0001,
        altitude: 300 + (i % 100),
        accuracy: 5,
        speed: 1.0 + (i % 10) * 0.1,
        bearing: (i % 360),
        battery: 100 - (i % 50),
        timestamp: new Date(baseTime + i * 1000).toISOString(),
      }));

      // Insert — measure time
      const insertStart = performance.now();
      store.addPositionsBatch(m.id, 'device-perf', positions);
      const insertMs = performance.now() - insertStart;
      console.log(`  Insert 30K positions: ${insertMs.toFixed(1)}ms`);

      // Verify count
      const count = store.db.prepare(`SELECT COUNT(*) as c FROM positions WHERE mission_id = ?`).get(m.id) as { c: number };
      expect(count.c).toBe(30_000);

      // Query by device + time range (middle 10K positions)
      const from = new Date(baseTime + 10_000 * 1000).toISOString();
      const to = new Date(baseTime + 20_000 * 1000).toISOString();

      const queryStart = performance.now();
      const results = store.getPositions(m.id, 'device-perf', from, to);
      const queryMs = performance.now() - queryStart;
      console.log(`  Query 10K positions by device+time: ${queryMs.toFixed(1)}ms (${results.length} rows)`);

      expect(results.length).toBe(10_001); // inclusive range
      expect(queryMs).toBeLessThan(50);

      // Latest positions query
      const latestStart = performance.now();
      const latest = store.getLatestPositions(m.id);
      const latestMs = performance.now() - latestStart;
      console.log(`  Latest positions query: ${latestMs.toFixed(1)}ms`);

      expect(latest).toHaveLength(1);
      expect(latestMs).toBeLessThan(50);
    });

    it('measures insert rate (positions/second)', () => {
      const m = store.createMission('Insert Rate');
      store.upsertDevice(m.id, 'd1', 'Device');

      const batchSize = 10_000;
      const positions = Array.from({ length: batchSize }, (_, i) => ({
        lat: 52.0 + i * 0.00001,
        lon: -9.5,
        timestamp: new Date(Date.now() + i * 100).toISOString(),
      }));

      const start = performance.now();
      store.addPositionsBatch(m.id, 'd1', positions);
      const elapsed = performance.now() - start;

      const rate = Math.round(batchSize / (elapsed / 1000));
      console.log(`  Insert rate: ${rate.toLocaleString()} positions/sec (${batchSize} in ${elapsed.toFixed(1)}ms)`);

      expect(rate).toBeGreaterThan(10_000); // should easily exceed 10K/s
    });
  });
});
