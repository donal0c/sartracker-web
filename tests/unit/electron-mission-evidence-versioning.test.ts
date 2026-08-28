import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (path: string) => {
  close(): void
  prepare(sql: string): {
    all(...params: readonly unknown[]): readonly Record<string, unknown>[]
    get(...params: readonly unknown[]): Record<string, unknown> | undefined
    run(...params: readonly unknown[]): unknown
  }
  exec(sql: string): void
}

type MissionEvidenceStore = {
  prepareClose(): Promise<void>
  close(): void
  info(): Promise<{ readonly schema_version: number; readonly database_path: string }>
  createMission(input: { readonly name: string; readonly start_time?: string }): Promise<{ readonly id: string }>
  getMission(missionId: string): Promise<{ readonly status: string }>
  addPosition(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  addPositionsBulk(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  upsertDevice(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  addMissionParticipant(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  finishMission(missionId: string): Promise<{ readonly status: string }>
  finalizeMission(missionId: string): Promise<Readonly<Record<string, unknown>>>
  upsertMarker(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  deleteMarker(markerId: string): Promise<boolean>
  listMarkers(missionId: string): Promise<readonly Readonly<Record<string, unknown>>[]>
  upsertDrawing(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  createOuting(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  endOuting(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  editOutingBoundaries(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  renameOuting(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  upsertGpxImport(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  deleteGpxImport(importId: string): Promise<boolean>
  listGpxImports(missionId: string): Promise<readonly Readonly<Record<string, unknown>>[]>
  listGpxImportRevisions(importId: string): Promise<readonly Readonly<Record<string, unknown>>[]>
  listGpxImportPage(input: Readonly<Record<string, unknown>>): Promise<{
    readonly entries: readonly Readonly<Record<string, unknown>>[]
    readonly nextCursor: string | null
  }>
  listGpxImportRevisionPage(input: Readonly<Record<string, unknown>>): Promise<{
    readonly entries: readonly Readonly<Record<string, unknown>>[]
    readonly nextCursor: string | null
  }>
  updateGpxImportPresentation(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  listGpxImportIssues(input: {
    readonly missionId: string
    readonly cursor?: string
    readonly limit?: number
  }): Promise<{
    readonly entries: readonly Readonly<Record<string, unknown>>[]
    readonly nextCursor: string | null
  }>
  assignGpxImportToOuting(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  upsertSearchArea(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  retireSearchArea(areaId: string, actor?: string): Promise<boolean>
  upsertSearchAssignment(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  upsertSearchPass(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  listSearchAreas(missionId: string): Promise<readonly Readonly<Record<string, unknown>>[]>
  listSearchAssignments(missionId: string): Promise<readonly Readonly<Record<string, unknown>>[]>
  listSearchPasses(missionId: string): Promise<readonly Readonly<Record<string, unknown>>[]>
  importGpxEvidencePaths(input: { readonly missionId: string; readonly paths: readonly string[] }): Promise<{
    readonly imports: readonly { readonly id: string }[]
    readonly failures: readonly { readonly sourcePath: string; readonly reason: string }[]
    readonly dispatchDurationMs: number
  }>
  readMissionReplay(input: Readonly<Record<string, unknown>>, requestId?: string): Promise<Readonly<Record<string, unknown>>>
  readMissionReplayTrackChunk(input: Readonly<Record<string, unknown>>, requestId?: string): Promise<Readonly<Record<string, unknown>>>
  cancelMissionReplay(requestId: string): Promise<boolean>
  listMissionObjectVersions(input: {
    readonly missionId: string
    readonly objectType?: 'marker' | 'drawing' | 'outing'
    readonly objectId?: string
  }): Promise<readonly {
    readonly object_type: string
    readonly object_id: string
    readonly version_sequence: number
    readonly operation: string
    readonly completeness: string
    readonly state_json: string
    readonly audit_event_id: string
  }[]>
}

const {
  createElectronMissionStore,
  CURRENT_SCHEMA_VERSION,
  finishGpxImportBatch,
  recordGpxImportFailure,
  recordGpxImportSourceReceipt,
  retainGpxImportSourceBytes,
  settleGpxImportSourceReceipt,
  startGpxImportBatch,
  upsertGpxEvidence,
  upsertGpxEvidenceChunked,
} = require('../../electron/mission-store.cjs') as {
  readonly CURRENT_SCHEMA_VERSION: number
  readonly finishGpxImportBatch: (
    db: InstanceType<typeof Database>,
    batchId: string,
    missionId: string,
  ) => void
  readonly upsertGpxEvidence: (
    db: InstanceType<typeof Database>,
    input: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>
  readonly upsertGpxEvidenceChunked: (
    db: InstanceType<typeof Database>,
    input: Readonly<Record<string, unknown>>,
    chunkSize?: number,
    publicationReceipt?: Readonly<Record<string, unknown>>,
  ) => Promise<Readonly<Record<string, unknown>>>
  readonly startGpxImportBatch: (
    db: InstanceType<typeof Database>,
    input: Readonly<Record<string, unknown>>,
  ) => void
  readonly recordGpxImportFailure: (
    db: InstanceType<typeof Database>,
    input: Readonly<Record<string, unknown>>,
  ) => void
  readonly recordGpxImportSourceReceipt: (
    db: InstanceType<typeof Database>,
    input: Readonly<Record<string, unknown>>,
  ) => void
  readonly retainGpxImportSourceBytes: (
    db: InstanceType<typeof Database>,
    input: Readonly<Record<string, unknown>>,
  ) => void
  readonly settleGpxImportSourceReceipt: (
    db: InstanceType<typeof Database>,
    input: Readonly<Record<string, unknown>>,
  ) => void
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly evidenceVersionFaultInjection?: { readonly afterProjection?: boolean }
    readonly gpxRetirementFaultInjection?: { readonly beforeTransaction?: () => void }
    readonly runGpxEvidenceImportInWorker?: (input: {
      readonly databasePath: string
      readonly missionId: string
      readonly signal?: AbortSignal
    }) => Promise<unknown> & { readonly workerExited?: Promise<void> }
  }) => MissionEvidenceStore
}

const SAMPLE_MARKER = {
  type: 'clue',
  name: 'Boot print',
  description: 'Initial description',
  lat: 52.0599,
  lon: -9.5045,
  irish_grid_e: 480000,
  irish_grid_n: 580000,
  display_order: 0,
  updated_by: 'Coordinator One',
} as const

describe('mission evidence versioning [DON-277]', () => {
  let userDataPath: string | null = null
  let store: MissionEvidenceStore | null = null

  afterEach(async () => {
    store?.close()
    store = null
    if (userDataPath !== null) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = null
    }
  })

  it('indexes explicit missing-time evidence without a mission-wide replay scan [DON-278]', async () => {
    store = await createStore()
    const db = openDatabase(await databasePath())

    expect(db.prepare(`SELECT sql FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_positions_replay_unknown_time'`).get()?.sql)
      .toMatch(/WHERE timestamp_source IS NULL/u)
    expect(db.prepare(`SELECT sql FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_positions_replay_known_at'`).get()?.sql)
      .toMatch(/timestamp_provenance_recorded_at/u)
    expect(db.prepare(`SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = 'mission_replay_position_day_counts'`).get()?.sql)
      .toMatch(/known_day TEXT NOT NULL/u)
    expect(db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE 'positions_replay_day_count_%'`).get()?.count)
      .toBe(3)
    db.close()
  })

  it('counts replay eligibility on the later of fixTime and durable recorded time [DON-278]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Replay Known-Time Count Mission' })
    await store.upsertDevice({
      mission_id: mission.id, device_id: 'device-1', name: 'Device 1',
      color: '#38bdf8', status: 'online',
    })
    const db = openDatabase(await databasePath())
    const insert = db.prepare(`INSERT INTO positions (
      id, mission_id, device_id, lat, lon, timestamp, received_at, data_origin, timestamp_source
    ) VALUES (?, ?, 'device-1', 52, -9.7, ?, ?, 'live', ?)`)
    insert.run('same-day', mission.id, '2026-08-26T23:00:00.000Z', '2026-08-26T23:00:01.000Z', 'fix')
    insert.run('late-known', mission.id, '2026-08-26T23:30:00.000Z', '2026-08-27T00:00:01.000Z', 'fix')
    insert.run('unproved', mission.id, '2026-08-27T01:00:00.000Z', '2026-08-27T01:00:01.000Z', null)

    expect(db.prepare(`SELECT known_day, position_count
      FROM mission_replay_position_day_counts WHERE mission_id = ? ORDER BY known_day`).all(mission.id))
      .toEqual([
        { known_day: '2026-08-26', position_count: 1 },
        { known_day: '2026-08-27', position_count: 1 },
      ])

    db.prepare(`UPDATE positions SET timestamp_source = 'fix' WHERE id = 'unproved'`).run()
    db.prepare(`DELETE FROM positions WHERE id = 'late-known'`).run()
    expect(db.prepare(`SELECT known_day, position_count
      FROM mission_replay_position_day_counts WHERE mission_id = ? ORDER BY known_day`).all(mission.id))
      .toEqual([
        { known_day: '2026-08-26', position_count: 1 },
        { known_day: '2026-08-27', position_count: 1 },
      ])
    db.close()
  })

  it('records late fixTime provenance and invalidates an already-open replay chain [DON-278]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Replay Provenance Promotion Mission' })
    await store.upsertDevice({
      mission_id: mission.id, device_id: 'device-1', name: 'Device 1',
      color: '#38bdf8', status: 'online',
    })
    const db = openDatabase(await databasePath())
    const insert = db.prepare(`INSERT INTO positions (
      id, mission_id, device_id, source_position_id, lat, lon, accuracy,
      timestamp, received_at, data_origin, timestamp_source
    ) VALUES (?, ?, 'device-1', ?, 52, -9.7, 5, ?, ?, 'live', ?)`)
    insert.run('fix-first', mission.id, 'source-first', '2026-08-27T08:01:00Z', '2026-08-27T08:01:01Z', 'fix')
    insert.run('fix-unproved', mission.id, 'source-unproved', '2026-08-27T08:02:00Z', '2026-08-27T08:02:01Z', null)
    insert.run('fix-second', mission.id, 'source-second', '2026-08-27T08:03:00Z', '2026-08-27T08:03:01Z', 'fix')
    const initialGeneration = Number(db.prepare(`SELECT generation FROM mission_replay_generations
      WHERE mission_id = ?`).get(mission.id)?.generation ?? 0)
    db.close()
    const selectedTime = new Date().toISOString()
    const first = await store.readMissionReplay({
      missionId: mission.id, selectedTime, trackLimit: 1,
    }) as { readonly nextCursor: string }

    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: [{
        device_id: 'device-1', source_position_id: 'source-unproved',
        lat: 52, lon: -9.7, accuracy: 5,
        timestamp: '2026-08-27T08:02:00Z', timestamp_source: 'fix',
      }],
    })

    await expect(store.readMissionReplayTrackChunk({
      missionId: mission.id, selectedTime, trackLimit: 1, cursor: first.nextCursor,
    })).rejects.toThrow('Mission replay evidence changed while paging. Re-seek the selected time.')
    const verified = openDatabase(await databasePath())
    expect(verified.prepare(`SELECT timestamp_source, timestamp_provenance_recorded_at
      FROM positions WHERE id = 'fix-unproved'`).get()).toMatchObject({
      timestamp_source: 'fix', timestamp_provenance_recorded_at: expect.any(String),
    })
    expect(verified.prepare(`SELECT generation FROM mission_replay_generations
      WHERE mission_id = ?`).get(mission.id)).toMatchObject({ generation: initialGeneration + 1 })
    verified.close()
  })

  it('invalidates an equal-now replay chain when an accepted fix enters that mission [DON-278]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Equal-now Replay Fence Mission' })
    await store.upsertDevice({
      mission_id: mission.id, device_id: 'device-1', name: 'Device 1',
      color: '#38bdf8', status: 'online',
    })
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-27T09:00:00.000Z')
    try {
      await store.addPositionsBulk({
        mission_id: mission.id,
        positions: [
          {
            device_id: 'device-1', source_position_id: 'source-first',
            lat: 52, lon: -9.7, timestamp: '2026-08-27T08:01:00Z', timestamp_source: 'fix',
          },
          {
            device_id: 'device-1', source_position_id: 'source-second',
            lat: 52.01, lon: -9.71, timestamp: '2026-08-27T08:02:00Z', timestamp_source: 'fix',
          },
        ],
      })
      const selectedTime = '2026-08-27T09:00:00.000Z'
      const first = await store.readMissionReplay({
        missionId: mission.id, selectedTime, trackLimit: 1,
      }) as { readonly nextCursor: string }

      await store.addPositionsBulk({
        mission_id: mission.id,
        positions: [{
          device_id: 'device-1', source_position_id: 'source-same-ms',
          lat: 52.02, lon: -9.72, timestamp: '2026-08-27T08:03:00Z', timestamp_source: 'fix',
        }],
      })

      await expect(store.readMissionReplayTrackChunk({
        missionId: mission.id, selectedTime, trackLimit: 1, cursor: first.nextCursor,
      })).rejects.toThrow('Mission replay evidence changed while paging. Re-seek the selected time.')
    } finally {
      vi.useRealTimers()
    }
  })

  it('invalidates an open replay chain when participant evidence changes [DON-278]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Participant Replay Fence Mission' })
    await store.upsertDevice({
      mission_id: mission.id, device_id: 'device-1', name: 'Device 1',
      color: '#38bdf8', status: 'online',
    })
    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: [
        {
          device_id: 'device-1', source_position_id: 'source-first',
          lat: 52, lon: -9.7, timestamp: '2026-08-27T08:01:00Z', timestamp_source: 'fix',
        },
        {
          device_id: 'device-1', source_position_id: 'source-second',
          lat: 52.01, lon: -9.71, timestamp: '2026-08-27T08:02:00Z', timestamp_source: 'fix',
        },
      ],
    })
    const selectedTime = new Date().toISOString()
    const first = await store.readMissionReplay({
      missionId: mission.id, selectedTime, trackLimit: 1,
    }) as { readonly nextCursor: string }

    await store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'device',
      ref: 'device-1',
      confirmed_by: 'Coordinator One',
    })

    await expect(store.readMissionReplayTrackChunk({
      missionId: mission.id, selectedTime, trackLimit: 1, cursor: first.nextCursor,
    })).rejects.toThrow('Mission replay evidence changed while paging. Re-seek the selected time.')
  })

  it('writes projection, immutable version, and audit identity in one transaction', async () => {
    store = await createStore()
    const mission = await store.createMission({
      name: 'Versioned Evidence Mission',
      start_time: '2026-08-27T08:00:00.000Z',
    })

    const created = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    await store.upsertMarker({
      mission_id: mission.id,
      ...SAMPLE_MARKER,
      id: created.id,
      description: 'Coordinator-confirmed description',
    })

    const versions = await store.listMissionObjectVersions({
      missionId: mission.id,
      objectType: 'marker',
      objectId: String(created.id),
    })
    expect(versions.map((version) => version.version_sequence)).toEqual([1, 2])
    expect(versions.map((version) => version.operation)).toEqual(['created', 'updated'])
    expect(JSON.parse(versions[0]!.state_json)).toMatchObject({ description: 'Initial description' })
    expect(JSON.parse(versions[1]!.state_json)).toMatchObject({
      description: 'Coordinator-confirmed description',
    })
    expect(versions.every((version) => version.audit_event_id !== '')).toBe(true)

    const db = openDatabase(await databasePath())
    const auditRows = db.prepare(
      `SELECT id, details_json FROM mission_events
       WHERE mission_id = ? AND event_type IN ('marker_created', 'marker_updated')
       ORDER BY rowid ASC`,
    ).all(mission.id)
    db.close()
    expect(auditRows).toHaveLength(2)
    expect(auditRows.map((row) => row.id)).toEqual(
      versions.map((version) => version.audit_event_id),
    )
  })

  it('rolls the projection back when immutable version persistence fails', async () => {
    store = await createStore({ afterProjection: true })
    const mission = await store.createMission({ name: 'Atomic Failure Mission' })

    await expect(
      store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER }),
    ).rejects.toThrow(/evidence version/i)
    await expect(store.listMarkers(mission.id)).resolves.toEqual([])
    await expect(
      store.listMissionObjectVersions({ missionId: mission.id, objectType: 'marker' }),
    ).resolves.toEqual([])
  })

  it('versions outing lifecycle changes without rewriting the earlier outing state', async () => {
    store = await createStore()
    const mission = await store.createMission({
      name: 'Versioned Outing Mission',
      start_time: '2026-08-27T08:00:00.000Z',
    })
    const outing = await store.createOuting({
      mission_id: mission.id,
      label: 'Morning deployment',
      started_at: '2026-08-27T08:10:00.000Z',
    })
    await store.renameOuting({
      mission_id: mission.id,
      outing_id: outing.id,
      label: 'Northern deployment',
    })

    const versions = await store.listMissionObjectVersions({
      missionId: mission.id,
      objectType: 'outing',
      objectId: String(outing.id),
    })
    expect(versions.map((version) => version.operation)).toEqual(['created', 'updated'])
    expect(JSON.parse(versions[0]!.state_json)).toMatchObject({ label: 'Morning deployment' })
    expect(JSON.parse(versions[1]!.state_json)).toMatchObject({ label: 'Northern deployment' })
  })

  it('retires evidence without physically deleting it and rejects finalized writes', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Retained Evidence Mission' })
    const created = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })

    await expect(store.deleteMarker(String(created.id))).resolves.toBe(true)
    await expect(store.listMarkers(mission.id)).resolves.toEqual([])
    const versions = await store.listMissionObjectVersions({
      missionId: mission.id,
      objectType: 'marker',
      objectId: String(created.id),
    })
    expect(versions.map((version) => version.operation)).toEqual(['created', 'retired'])
    expect(JSON.parse(versions[1]!.state_json)).toMatchObject({ retired_at: expect.any(String) })

    const db = openDatabase(await databasePath())
    expect(db.prepare('SELECT id, retired_at FROM markers WHERE id = ?').get(created.id)).toMatchObject({
      id: created.id,
      retired_at: expect.any(String),
    })
    db.close()

    const second = await store.upsertMarker({
      mission_id: mission.id,
      ...SAMPLE_MARKER,
      name: 'Locked clue',
    })
    await store.finishMission(mission.id)
    await expect(
      store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER, id: second.id }),
    ).rejects.toThrow(/finished mission|read-only/i)
    await expect(store.deleteMarker(String(second.id))).rejects.toThrow(/finished mission|read-only/i)
  })

  it('migrates legacy mutable rows to explicit incomplete baseline versions', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-migration-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Legacy Baseline Mission' })
    await first.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    await first.upsertDrawing({
      mission_id: mission.id,
      type: 'search_area',
      name: 'Legacy Area',
      display_order: 0,
      geometry_json: '{"type":"Polygon","coordinates":[]}',
    })
    await first.createOuting({ mission_id: mission.id, label: 'Outing One' })
    first.close()

    const db = openDatabase(path.join(userDataPath, 'mission-store.sqlite'))
    db.prepare("UPDATE metadata SET value = '11' WHERE key = 'schema_version'").run()
    db.exec('DROP TABLE mission_object_versions')
    db.close()

    store = createElectronMissionStore({ userDataPath })
    expect(CURRENT_SCHEMA_VERSION).toBe(12)
    await expect(store.info()).resolves.toMatchObject({ schema_version: 12 })
    const versions = await store.listMissionObjectVersions({ missionId: mission.id })
    expect(versions).toHaveLength(4)
    expect(new Set(versions.map((version) => version.object_type))).toEqual(
      new Set(['marker', 'drawing', 'outing', 'search_area']),
    )
    expect(versions.every((version) => version.operation === 'legacy_baseline')).toBe(true)
    expect(versions.every((version) => version.completeness === 'legacy_baseline')).toBe(true)
  })

  it('migrates an authentic v11 GPX table before creating v12 indexes and retains a static baseline [DON-274]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-real-v11-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Authentic v11 GPX Mission' })
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const db = openDatabase(databaseFile)
    db.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE gpx_evidence_rejections;
      DROP TABLE gpx_evidence_points;
      DROP TABLE gpx_import_revisions;
      DROP TABLE gpx_import_aliases;
      DROP INDEX IF EXISTS idx_gpx_import_content;
      DROP INDEX IF EXISTS idx_positions_replay_known_fix;
      DROP TABLE gpx_track_imports;
      CREATE TABLE gpx_track_imports (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        geometry_json TEXT NOT NULL,
        metadata_json TEXT,
        imported_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (mission_id, source_path)
      );
      INSERT INTO gpx_track_imports VALUES (
        'legacy-gpx', '${mission.id}', '/legacy/route.gpx', 'route.gpx', 'Legacy route',
        '{"type":"MultiLineString","coordinates":[[[-9.7,52],[-9.71,52.01]]]}',
        '{}', '2026-08-20T10:00:00Z', '2026-08-20T10:00:00Z'
      );
      UPDATE metadata SET value = '11' WHERE key = 'schema_version';
      PRAGMA foreign_keys = ON;
    `)
    db.close()

    store = createElectronMissionStore({ userDataPath })
    await expect(store.info()).resolves.toMatchObject({ schema_version: 12 })
    const migratedDb = openDatabase(databaseFile)
    expect(migratedDb.prepare(`SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_positions_replay_known_fix'`).get()).toBeUndefined()
    migratedDb.close()
    const revisions = await store.listGpxImportRevisions('legacy-gpx')
    expect(revisions).toEqual([
      expect.objectContaining({ completeness: 'legacy_baseline', revision_sequence: 1 }),
    ])
    const replay = await store.readMissionReplay({
      missionId: mission.id,
      selectedTime: new Date().toISOString(),
      timezone: 'Europe/Dublin',
      trackLimit: 100,
    })
    expect(replay).toMatchObject({
      staticGpxPointCount: 2,
      limitations: expect.arrayContaining([
        expect.objectContaining({ code: 'legacy_gpx_baseline_only' }),
      ]),
    })
  })

  it('recovers interrupted GPX staging into retained failure provenance before allowing retry [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Interrupted GPX Recovery Mission' })
    const imported = await store.upsertGpxImport(gpxInput(mission.id, {}))
    const databaseFile = await databasePath()
    store.close()
    store = null

    const interruptedDb = openDatabase(databaseFile)
    interruptedDb.prepare("UPDATE gpx_track_imports SET import_state = 'staging' WHERE id = ?")
      .run(imported.id)
    interruptedDb.prepare("UPDATE gpx_import_revisions SET import_state = 'staging' WHERE import_id = ?")
      .run(imported.id)
    interruptedDb.close()

    store = createElectronMissionStore({ userDataPath: userDataPath! })
    await expect(store.listGpxImports(mission.id)).resolves.toEqual([])
    const recoveredDb = openDatabase(databaseFile)
    expect(recoveredDb.prepare(`SELECT status, failed_files FROM gpx_import_batches
      WHERE mission_id = ? AND status = 'interrupted'`).get(mission.id))
      .toMatchObject({ status: 'interrupted', failed_files: 1 })
    expect(recoveredDb.prepare(`SELECT source_path, content_sha256, source_bytes_base64, reason
      FROM gpx_import_failures WHERE mission_id = ?`).get(mission.id)).toMatchObject({
      source_path: '/field/route.gpx',
      content_sha256: expect.any(String),
      source_bytes_base64: expect.any(String),
      reason: expect.stringMatching(/interrupted/i),
    })
    recoveredDb.close()
  })

  it('records chunked GPX evidence at publication so replay before publication stays unchanged [DON-278]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'GPX Publication Knowledge Time' })
    const db = openDatabase(await databasePath())
    const points = Array.from({ length: 200 }, (_, pointIndex) => ({
      segment_index: 0,
      point_index: pointIndex,
      track_name: 'Delayed route',
      lat: 52 + pointIndex / 100_000,
      lon: -9.7,
      elevation: null,
      timestamp: '2026-08-27T08:00:00Z',
    }))

    const publication = upsertGpxEvidenceChunked(db, gpxInput(mission.id, {
      source_path: '/field/delayed-route.gpx',
      file_name: 'delayed-route.gpx',
      display_name: 'Delayed route',
      points,
    }), 1)
    const staged = db.prepare(`SELECT recorded_at FROM gpx_import_revisions
      WHERE mission_id = ? AND import_state = 'staging'`).get(mission.id)
    expect(staged).toMatchObject({ recorded_at: expect.any(String) })
    const selectedTime = new Date(Date.parse(String(staged?.recorded_at)) + 1).toISOString()

    await publication
    const replay = await store.readMissionReplay({
      missionId: mission.id,
      selectedTime,
      timezone: 'Europe/Dublin',
      trackLimit: 1_000,
    })
    expect(replay).toMatchObject({ totalTrackCount: 0, staticGpxPointCount: 0 })
    const published = db.prepare(`SELECT recorded_at FROM gpx_import_revisions
      WHERE mission_id = ? AND import_state = 'complete'`).get(mission.id)
    expect(Date.parse(String(published?.recorded_at))).toBeGreaterThan(Date.parse(selectedTime))
    db.close()
  })

  it('rejects a staged GPX revision when the operator retires its current evidence [DON-274 DON-278]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'GPX Retirement Publication Fence' })
    const imported = await store.upsertGpxImport(gpxInput(mission.id, {}))
    const db = openDatabase(await databasePath())
    const replacementBytes = 'PGdweD5yZXBsYWNlbWVudDwvZ3B4Pg=='
    const replacementHash = digestBase64(replacementBytes)
    const sourcePath = '/field/route.gpx'
    const batchId = 'retirement-publication-fence-batch'
    const points = Array.from({ length: 200 }, (_, pointIndex) => ({
      segment_index: 0,
      point_index: pointIndex,
      track_name: 'Replacement route',
      lat: 52 + pointIndex / 100_000,
      lon: -9.7,
      elevation: null,
      timestamp: '2026-08-27T08:00:00Z',
    }))
    startGpxImportBatch(db, { batchId, missionId: mission.id, totalFiles: 1 })
    recordGpxImportSourceReceipt(db, {
      batchId,
      missionId: mission.id,
      sourcePath,
      fileName: 'route.gpx',
    })
    retainGpxImportSourceBytes(db, {
      batchId,
      missionId: mission.id,
      sourcePath,
      contentSha256: replacementHash,
      sourceBytesBase64: replacementBytes,
    })

    const publication = upsertGpxEvidenceChunked(db, gpxInput(mission.id, {
      id: imported.id,
      content_sha256: replacementHash,
      source_bytes_base64: replacementBytes,
      points,
    }), 1, { batchId, missionId: mission.id, sourcePath })
    expect(db.prepare(`SELECT import_state FROM gpx_import_revisions
      WHERE import_id = ? AND revision_sequence = 2`).get(imported.id))
      .toMatchObject({ import_state: 'staging' })
    await expect(store.deleteGpxImport(String(imported.id))).resolves.toBe(true)

    await expect(publication).rejects.toThrow(/retired.*staged.*not published/iu)
    await expect(store.listGpxImports(mission.id)).resolves.toEqual([])
    expect(db.prepare(`SELECT retired_at, revision_sequence, content_sha256
      FROM gpx_track_imports WHERE id = ?`).get(imported.id)).toMatchObject({
      retired_at: expect.any(String),
      revision_sequence: 1,
      content_sha256: imported.content_sha256,
    })
    expect(db.prepare(`SELECT COUNT(*) AS count FROM gpx_import_revisions
      WHERE import_id = ? AND revision_sequence = 2`).get(imported.id)).toMatchObject({ count: 0 })
    expect(db.prepare(`SELECT COUNT(*) AS count FROM gpx_evidence_points
      WHERE import_id = ? AND revision_sequence = 2`).get(imported.id)).toMatchObject({ count: 0 })
    expect(db.prepare(`SELECT status, content_sha256, source_bytes_base64
      FROM gpx_import_source_receipts WHERE batch_id = ? AND source_path = ?`)
      .get(batchId, sourcePath)).toMatchObject({
      status: 'failed',
      content_sha256: replacementHash,
      source_bytes_base64: replacementBytes,
    })
    expect(db.prepare(`SELECT content_sha256, source_bytes_base64, reason
      FROM gpx_import_failures WHERE batch_id = ? AND source_path = ?`)
      .get(batchId, sourcePath)).toMatchObject({
      content_sha256: replacementHash,
      source_bytes_base64: replacementBytes,
      reason: expect.stringMatching(/retired.*staged.*not published/iu),
    })
    expect(db.prepare(`SELECT status, completed_files, failed_files
      FROM gpx_import_batches WHERE id = ?`).get(batchId)).toMatchObject({
      status: 'running',
      completed_files: 0,
      failed_files: 1,
    })
    recordGpxImportFailure(db, {
      batchId,
      missionId: mission.id,
      sourcePath,
      fileName: 'route.gpx',
      contentSha256: replacementHash,
      sourceBytesBase64: replacementBytes,
      reason: 'Worker catch observed the already-recorded publication failure.',
    })
    expect(db.prepare(`SELECT failed_files FROM gpx_import_batches WHERE id = ?`)
      .get(batchId)).toMatchObject({ failed_files: 1 })
    expect(db.prepare(`SELECT COUNT(*) AS count FROM gpx_import_failures
      WHERE batch_id = ? AND source_path = ?`).get(batchId, sourcePath)).toMatchObject({ count: 1 })
    finishGpxImportBatch(db, batchId, mission.id)
    expect(db.prepare(`SELECT status, completed_files, failed_files
      FROM gpx_import_batches WHERE id = ?`).get(batchId)).toMatchObject({
      status: 'completed_with_failures',
      completed_files: 0,
      failed_files: 1,
    })
    expect(db.prepare(`SELECT COUNT(*) AS count FROM mission_events
      WHERE mission_id = ? AND event_type = 'gpx_import_updated'`).get(mission.id))
      .toMatchObject({ count: 0 })
    db.close()
  })

  it('audits the transaction-current GPX revision when publication wins retirement [DON-274 DON-278]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-retirement-race-'))
    let publishReplacement = () => undefined
    store = createElectronMissionStore({
      userDataPath,
      gpxRetirementFaultInjection: {
        beforeTransaction: () => publishReplacement(),
      },
    })
    const mission = await store.createMission({ name: 'GPX Publication Wins Retirement' })
    const imported = await store.upsertGpxImport(gpxInput(mission.id, {}))
    const db = openDatabase(await databasePath())
    const replacementBytes = 'PGdweD5wdWJsaWNhdGlvbi13aW5zPC9ncHg+'
    const replacementHash = digestBase64(replacementBytes)
    publishReplacement = () => {
      upsertGpxEvidence(db, gpxInput(mission.id, {
        id: imported.id,
        content_sha256: replacementHash,
        source_bytes_base64: replacementBytes,
      }))
    }

    await expect(store.deleteGpxImport(String(imported.id))).resolves.toBe(true)

    expect(db.prepare(`SELECT retired_at, revision_sequence, content_sha256
      FROM gpx_track_imports WHERE id = ?`).get(imported.id)).toMatchObject({
      retired_at: expect.any(String),
      revision_sequence: 2,
      content_sha256: replacementHash,
    })
    const deletionEvent = db.prepare(`SELECT details_json FROM mission_events
      WHERE mission_id = ? AND event_type = 'gpx_import_deleted'
      ORDER BY timestamp DESC, id DESC LIMIT 1`).get(mission.id)
    expect(JSON.parse(String(deletionEvent?.details_json))).toMatchObject({
      gpx_import_id: imported.id,
      content_sha256: replacementHash,
      revision_sequence: 2,
      retired: true,
    })
    db.close()
  })

  it('atomically settles the retained source receipt with GPX publication [DON-278]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Atomic GPX Receipt Mission' })
    const db = openDatabase(await databasePath())
    startGpxImportBatch(db, {
      batchId: 'atomic-publication-batch',
      missionId: mission.id,
      totalFiles: 1,
    })
    recordGpxImportSourceReceipt(db, {
      batchId: 'atomic-publication-batch',
      missionId: mission.id,
      sourcePath: '/field/atomic.gpx',
      fileName: 'atomic.gpx',
    })
    const sourceBytesBase64 = 'PGdweD5hdG9taWM8L2dweD4='
    retainGpxImportSourceBytes(db, {
      batchId: 'atomic-publication-batch',
      missionId: mission.id,
      sourcePath: '/field/atomic.gpx',
      contentSha256: digestBase64(sourceBytesBase64),
      sourceBytesBase64,
    })

    await upsertGpxEvidenceChunked(db, gpxInput(mission.id, {
      source_path: '/field/atomic.gpx',
      file_name: 'atomic.gpx',
      source_bytes_base64: sourceBytesBase64,
      content_sha256: digestBase64(sourceBytesBase64),
    }), 25, {
      batchId: 'atomic-publication-batch',
      missionId: mission.id,
      sourcePath: '/field/atomic.gpx',
    })
    expect(db.prepare(`SELECT status, source_bytes_base64 FROM gpx_import_source_receipts
      WHERE batch_id = ? AND source_path = ?`).get('atomic-publication-batch', '/field/atomic.gpx'))
      .toMatchObject({ status: 'settled', source_bytes_base64: null })
    expect(db.prepare(`SELECT completed_files, failed_files FROM gpx_import_batches WHERE id = ?`)
      .get('atomic-publication-batch')).toMatchObject({ completed_files: 1, failed_files: 0 })
    db.close()

    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })
    const recovered = openDatabase(await databasePath())
    expect(recovered.prepare(`SELECT status FROM gpx_import_batches WHERE id = ?`)
      .get('atomic-publication-batch')).toMatchObject({ status: 'completed' })
    expect(recovered.prepare(`SELECT COUNT(*) AS count FROM gpx_import_failures WHERE batch_id = ?`)
      .get('atomic-publication-batch')).toMatchObject({ count: 0 })
    recovered.close()
  })

  it('does not reconcile an unsettled receipt against retired GPX evidence [DON-278]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Retired GPX Receipt Mission' })
    const imported = await store.upsertGpxImport(gpxInput(mission.id, {}))
    await store.deleteGpxImport(String(imported.id))
    const db = openDatabase(await databasePath())
    startGpxImportBatch(db, {
      batchId: 'retired-evidence-batch',
      missionId: mission.id,
      totalFiles: 1,
    })
    recordGpxImportSourceReceipt(db, {
      batchId: 'retired-evidence-batch',
      missionId: mission.id,
      sourcePath: '/field/route.gpx',
      fileName: 'route.gpx',
    })
    retainGpxImportSourceBytes(db, {
      batchId: 'retired-evidence-batch',
      missionId: mission.id,
      sourcePath: '/field/route.gpx',
      contentSha256: digestBase64('PGdweD5maXJzdDwvZ3B4Pg=='),
      sourceBytesBase64: 'PGdweD5maXJzdDwvZ3B4Pg==',
    })
    db.close()
    store.close()

    store = createElectronMissionStore({ userDataPath: userDataPath! })
    const recovered = openDatabase(await databasePath())
    expect(recovered.prepare(`SELECT status FROM gpx_import_source_receipts
      WHERE batch_id = ?`).get('retired-evidence-batch')).toMatchObject({ status: 'failed' })
    expect(recovered.prepare(`SELECT status, failed_files FROM gpx_import_batches
      WHERE id = ?`).get('retired-evidence-batch'))
      .toMatchObject({ status: 'interrupted', failed_files: 1 })
    expect(recovered.prepare(`SELECT reason FROM gpx_import_failures
      WHERE batch_id = ?`).get('retired-evidence-batch'))
      .toMatchObject({ reason: expect.stringMatching(/before evidence was published/iu) })
    recovered.close()
  })

  it('does not reconcile against a superseded hash on an active GPX import [DON-278]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Superseded GPX Receipt Mission' })
    await store.upsertGpxImport(gpxInput(mission.id, {}))
    const replacementBytes = 'PGdweD5zZWNvbmQ8L2dweD4='
    await store.upsertGpxImport(gpxInput(mission.id, {
      content_sha256: digestBase64(replacementBytes),
      source_bytes_base64: replacementBytes,
    }))
    const db = openDatabase(await databasePath())
    startGpxImportBatch(db, {
      batchId: 'superseded-evidence-batch',
      missionId: mission.id,
      totalFiles: 1,
    })
    recordGpxImportSourceReceipt(db, {
      batchId: 'superseded-evidence-batch',
      missionId: mission.id,
      sourcePath: '/field/route.gpx',
      fileName: 'route.gpx',
    })
    retainGpxImportSourceBytes(db, {
      batchId: 'superseded-evidence-batch',
      missionId: mission.id,
      sourcePath: '/field/route.gpx',
      contentSha256: digestBase64('PGdweD5maXJzdDwvZ3B4Pg=='),
      sourceBytesBase64: 'PGdweD5maXJzdDwvZ3B4Pg==',
    })
    db.close()
    store.close()

    store = createElectronMissionStore({ userDataPath: userDataPath! })
    const recovered = openDatabase(await databasePath())
    expect(recovered.prepare(`SELECT status FROM gpx_import_source_receipts
      WHERE batch_id = ?`).get('superseded-evidence-batch')).toMatchObject({ status: 'failed' })
    expect(recovered.prepare(`SELECT status, failed_files FROM gpx_import_batches
      WHERE id = ?`).get('superseded-evidence-batch'))
      .toMatchObject({ status: 'interrupted', failed_files: 1 })
    recovered.close()
  })

  it('does not erase retained exact bytes for a matching legacy GPX baseline [DON-278]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Legacy Baseline Receipt Mission' })
    await store.upsertGpxImport(gpxInput(mission.id, { source_bytes_base64: undefined }))
    const db = openDatabase(await databasePath())
    expect(db.prepare(`SELECT completeness, source_bytes_base64 FROM gpx_import_revisions
      WHERE mission_id = ?`).get(mission.id))
      .toMatchObject({ completeness: 'legacy_baseline', source_bytes_base64: null })
    startGpxImportBatch(db, {
      batchId: 'legacy-baseline-reimport-batch',
      missionId: mission.id,
      totalFiles: 1,
    })
    recordGpxImportSourceReceipt(db, {
      batchId: 'legacy-baseline-reimport-batch',
      missionId: mission.id,
      sourcePath: '/field/route.gpx',
      fileName: 'route.gpx',
    })
    retainGpxImportSourceBytes(db, {
      batchId: 'legacy-baseline-reimport-batch',
      missionId: mission.id,
      sourcePath: '/field/route.gpx',
      contentSha256: digestBase64('PGdweD5maXJzdDwvZ3B4Pg=='),
      sourceBytesBase64: 'PGdweD5maXJzdDwvZ3B4Pg==',
    })
    db.close()
    store.close()

    store = createElectronMissionStore({ userDataPath: userDataPath! })
    const recovered = openDatabase(await databasePath())
    expect(recovered.prepare(`SELECT status, source_bytes_base64
      FROM gpx_import_source_receipts WHERE batch_id = ?`)
      .get('legacy-baseline-reimport-batch'))
      .toMatchObject({ status: 'failed', source_bytes_base64: expect.any(String) })
    expect(recovered.prepare(`SELECT completeness, source_bytes_base64
      FROM gpx_import_revisions WHERE mission_id = ?`).get(mission.id))
      .toMatchObject({ completeness: 'legacy_baseline', source_bytes_base64: null })
    expect(recovered.prepare(`SELECT source_bytes_base64 FROM gpx_import_failures
      WHERE batch_id = ?`).get('legacy-baseline-reimport-batch'))
      .toMatchObject({ source_bytes_base64: 'PGdweD5maXJzdDwvZ3B4Pg==' })
    recovered.close()
  })

  it('recovers pre-read and retained-source receipts as explicit durable failures [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'GPX Receipt Recovery Mission' })
    const databaseFile = await databasePath()
    const receiptDb = openDatabase(databaseFile)
    startGpxImportBatch(receiptDb, {
      batchId: 'receipt-batch',
      missionId: mission.id,
      totalFiles: 2,
    })
    recordGpxImportSourceReceipt(receiptDb, {
      batchId: 'receipt-batch',
      missionId: mission.id,
      sourcePath: '/field/not-read.gpx',
      fileName: 'not-read.gpx',
    })
    recordGpxImportSourceReceipt(receiptDb, {
      batchId: 'receipt-batch',
      missionId: mission.id,
      sourcePath: '/field/retained.gpx',
      fileName: 'retained.gpx',
    })
    retainGpxImportSourceBytes(receiptDb, {
      batchId: 'receipt-batch',
      missionId: mission.id,
      sourcePath: '/field/retained.gpx',
      contentSha256: digestBase64('PGdweD5yZXRhaW5lZDwvZ3B4Pg=='),
      sourceBytesBase64: 'PGdweD5yZXRhaW5lZDwvZ3B4Pg==',
    })
    receiptDb.close()
    store.close()
    store = null

    store = createElectronMissionStore({ userDataPath: userDataPath! })
    const recoveredDb = openDatabase(databaseFile)
    expect(recoveredDb.prepare(`SELECT source_path, content_sha256, source_bytes_base64, reason
      FROM gpx_import_failures WHERE batch_id = ? ORDER BY source_path`).all('receipt-batch'))
      .toEqual([
        expect.objectContaining({
          source_path: '/field/not-read.gpx',
          content_sha256: null,
          source_bytes_base64: null,
          reason: expect.stringMatching(/before source bytes were retained/i),
        }),
        expect.objectContaining({
          source_path: '/field/retained.gpx',
          content_sha256: digestBase64('PGdweD5yZXRhaW5lZDwvZ3B4Pg=='),
          source_bytes_base64: 'PGdweD5yZXRhaW5lZDwvZ3B4Pg==',
          reason: expect.stringMatching(/after source bytes were retained/i),
        }),
      ])
    expect(recoveredDb.prepare(`SELECT status, failed_files FROM gpx_import_batches
      WHERE id = ?`).get('receipt-batch')).toMatchObject({ status: 'interrupted', failed_files: 2 })
    recoveredDb.close()
  })

  it('deduplicates GPX by exact content and preserves changed files as revisions [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'GPX Evidence Mission' })
    const first = await store.upsertGpxImport(gpxInput(mission.id, {
      source_path: '/field/route.gpx',
      content_sha256: digestBase64('PGdweD5maXJzdDwvZ3B4Pg=='),
      source_bytes_base64: 'PGdweD5maXJzdDwvZ3B4Pg==',
    }))
    expect(first).not.toHaveProperty('source_bytes_base64')
    const alias = await store.upsertGpxImport(gpxInput(mission.id, {
      source_path: '/copied/route.gpx',
      content_sha256: digestBase64('PGdweD5maXJzdDwvZ3B4Pg=='),
      source_bytes_base64: 'PGdweD5maXJzdDwvZ3B4Pg==',
    }))
    expect(alias.id).toBe(first.id)

    const revised = await store.upsertGpxImport(gpxInput(mission.id, {
      id: String(first.id),
      source_path: '/field/route.gpx',
      content_sha256: digestBase64('PGdweD5zZWNvbmQ8L2dweD4='),
      source_bytes_base64: 'PGdweD5zZWNvbmQ8L2dweD4=',
      timing_class: 'partially_dated',
    }))
    expect(revised.revision_sequence).toBe(2)
    const revisions = await store.listGpxImportRevisions(String(first.id))
    expect(revisions).toHaveLength(2)
    expect(revisions.map((revision) => revision.content_sha256)).toEqual([
      digestBase64('PGdweD5maXJzdDwvZ3B4Pg=='),
      digestBase64('PGdweD5zZWNvbmQ8L2dweD4='),
    ])
    expect(revisions.map((revision) => revision.source_bytes_base64)).toEqual([
      'PGdweD5maXJzdDwvZ3B4Pg==',
      'PGdweD5zZWNvbmQ8L2dweD4=',
    ])
    const rendererPage = await store.listGpxImportPage({ missionId: mission.id, limit: 1 })
    const revisionPage = await store.listGpxImportRevisionPage({ importId: first.id, limit: 1 })
    const presentation = await store.updateGpxImportPresentation({
      id: first.id,
      mission_id: mission.id,
      metadata_json: '{"color":"#F032E6"}',
    })
    expect(JSON.stringify({ rendererPage, revisionPage, presentation }))
      .not.toContain('source_bytes_base64')
    expect(revisionPage.entries[0]).not.toHaveProperty('geometry_json')

    await expect(store.deleteGpxImport(String(first.id))).resolves.toBe(true)
    await expect(store.listGpxImports(mission.id)).resolves.toEqual([])
    const db = openDatabase(await databasePath())
    expect(db.prepare('SELECT retired_at FROM gpx_track_imports WHERE id = ?').get(first.id))
      .toMatchObject({ retired_at: expect.any(String) })
    expect(db.prepare('SELECT COUNT(*) AS count FROM gpx_import_aliases WHERE import_id = ?').get(first.id))
      .toMatchObject({ count: 2 })
    db.close()
  })

  it('rejects an explicit GPX ID whose source path belongs to different evidence [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'GPX Identity Collision Mission' })
    const first = await store.upsertGpxImport(gpxInput(mission.id, {
      id: 'gpx-first',
      source_path: '/field/first.gpx',
      source_bytes_base64: 'PGdweD5maXJzdDwvZ3B4Pg==',
      content_sha256: digestBase64('PGdweD5maXJzdDwvZ3B4Pg=='),
    }))
    const second = await store.upsertGpxImport(gpxInput(mission.id, {
      id: 'gpx-second',
      source_path: '/field/second.gpx',
      source_bytes_base64: 'PGdweD5zZWNvbmQ8L2dweD4=',
      content_sha256: digestBase64('PGdweD5zZWNvbmQ8L2dweD4='),
    }))
    const secondAlias = await store.upsertGpxImport(gpxInput(mission.id, {
      source_path: '/field/second-copy.gpx',
      source_bytes_base64: 'PGdweD5zZWNvbmQ8L2dweD4=',
      content_sha256: digestBase64('PGdweD5zZWNvbmQ8L2dweD4='),
    }))
    expect(secondAlias.id).toBe(second.id)

    await expect(store.upsertGpxImport(gpxInput(mission.id, {
      id: first.id,
      source_path: '/field/second.gpx',
      source_bytes_base64: 'PGdweD5jaGFuZ2VkPC9ncHg+',
      content_sha256: digestBase64('PGdweD5jaGFuZ2VkPC9ncHg+'),
    }))).rejects.toThrow(/identity.*path|path.*different GPX evidence/i)
    await expect(store.upsertGpxImport(gpxInput(mission.id, {
      id: first.id,
      source_path: '/field/second-copy.gpx',
      source_bytes_base64: 'PGdweD5jaGFuZ2VkPC9ncHg+',
      content_sha256: digestBase64('PGdweD5jaGFuZ2VkPC9ncHg+'),
    }))).rejects.toThrow(/identity.*path|path.*different GPX evidence/i)

    const db = openDatabase(await databasePath())
    expect(db.prepare(`SELECT import_id FROM gpx_import_aliases
      WHERE mission_id = ? AND source_path = ?`).get(mission.id, '/field/second.gpx'))
      .toMatchObject({ import_id: second.id })
    expect(db.prepare(`SELECT import_id FROM gpx_import_aliases
      WHERE mission_id = ? AND source_path = ?`).get(mission.id, '/field/second-copy.gpx'))
      .toMatchObject({ import_id: second.id })
    db.close()
  })

  it('binds the claimed GPX digest to retained bytes and preserves same-path lineage across dedupe [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'GPX Identity Mission' })
    await expect(store.upsertGpxImport(gpxInput(mission.id, {
      content_sha256: '0'.repeat(64),
      source_bytes_base64: 'PGdweD5maXJzdDwvZ3B4Pg==',
    }))).rejects.toThrow(/does not match retained source bytes/i)

    const firstBytes = 'PGdweD5maXJzdDwvZ3B4Pg=='
    const secondBytes = 'PGdweD5zZWNvbmQ8L2dweD4='
    const route = await store.upsertGpxImport(gpxInput(mission.id, {
      source_path: '/field/route.gpx',
      content_sha256: digestBase64(firstBytes),
      source_bytes_base64: firstBytes,
    }))
    await store.upsertGpxImport(gpxInput(mission.id, {
      source_path: '/field/copy.gpx',
      content_sha256: digestBase64(secondBytes),
      source_bytes_base64: secondBytes,
    }))
    const revisedRoute = await store.upsertGpxImport(gpxInput(mission.id, {
      id: route.id,
      source_path: '/field/route.gpx',
      content_sha256: digestBase64(secondBytes),
      source_bytes_base64: secondBytes,
    }))

    expect(revisedRoute.id).toBe(route.id)
    expect(await store.listGpxImportRevisions(String(route.id))).toHaveLength(2)
  })

  it('assigns undated GPX to an outing as a new immutable static-evidence revision [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Static GPX Outing Mission' })
    const outing = await store.createOuting({ mission_id: mission.id, label: 'Operational period 1' })
    const imported = await store.upsertGpxImport(gpxInput(mission.id, {
      timing_class: 'undated',
      points: [
        { segment_index: 0, point_index: 0, track_name: 'Route', lat: 52, lon: -9.7, elevation: 100, timestamp: null },
      ],
    }))

    const assigned = await store.assignGpxImportToOuting({
      import_id: imported.id,
      outing_id: outing.id,
      assigned_by: 'Coordinator One',
    })
    expect(assigned).toMatchObject({ outing_id: outing.id, revision_sequence: 2 })
    expect(await store.listGpxImportRevisions(String(imported.id))).toEqual([
      expect.objectContaining({ revision_sequence: 1, outing_id: null }),
      expect.objectContaining({ revision_sequence: 2, outing_id: outing.id }),
    ])
    const replay = await store.readMissionReplay({
      missionId: mission.id,
      selectedTime: new Date().toISOString(),
      timezone: 'Europe/Dublin',
      trackLimit: 100,
    })
    expect(replay).toMatchObject({
      staticGpxEvidence: [expect.objectContaining({ import_id: imported.id, outing_id: outing.id })],
    })
  })

  it('keeps every declared search pass inside its assignment outing [DON-279]', async () => {
    store = await createStore()
    const referenceTime = Date.now()
    const missionStart = new Date(referenceTime - 4 * 60 * 60_000).toISOString()
    const firstOutingStart = new Date(referenceTime - 3 * 60 * 60_000).toISOString()
    const firstOutingEnd = new Date(referenceTime - 60 * 60_000).toISOString()
    const validPassStart = new Date(referenceTime - 150 * 60_000).toISOString()
    const validPassEnd = new Date(referenceTime - 90 * 60_000).toISOString()
    const mission = await store.createMission({
      name: 'Search Pass Window Mission',
      start_time: missionStart,
    })
    const firstOuting = await store.createOuting({
      mission_id: mission.id,
      label: 'Completed outing',
      started_at: firstOutingStart,
    })
    await store.endOuting({
      mission_id: mission.id,
      outing_id: firstOuting.id,
      ended_at: firstOutingEnd,
    })
    const area = await store.upsertSearchArea({
      mission_id: mission.id,
      name: 'Area Alpha',
      status: 'active',
      geometry_json: '{"type":"Polygon","coordinates":[]}',
      updated_by: 'Coordinator One',
    })
    const firstAssignment = await store.upsertSearchAssignment({
      mission_id: mission.id,
      search_area_id: area.id,
      outing_id: firstOuting.id,
      team_id: 'team-1',
      participant_ids: [],
      updated_by: 'Coordinator One',
    })
    const completedPass = {
      mission_id: mission.id,
      search_area_id: area.id,
      assignment_id: firstAssignment.id,
      outcome: 'partial',
      coordinator_name: 'Coordinator One',
      participant_ids: [],
      clue_ids: [],
      track_evidence_ids: [],
    }

    await expect(store.upsertSearchPass({
      ...completedPass,
      started_at: new Date(referenceTime - 210 * 60_000).toISOString(),
      ended_at: validPassEnd,
    })).rejects.toThrow(/pass start.*outing start/i)
    await expect(store.upsertSearchPass({
      ...completedPass,
      started_at: validPassStart,
      ended_at: new Date(referenceTime - 30 * 60_000).toISOString(),
    })).rejects.toThrow(/pass end.*outing end/i)
    await expect(store.upsertSearchPass({
      ...completedPass,
      started_at: validPassStart,
      ended_at: null,
    })).rejects.toThrow(/ended outing.*pass end/i)

    const recorded = await store.upsertSearchPass({
      ...completedPass,
      started_at: validPassStart,
      ended_at: validPassEnd,
    })
    await expect(store.editOutingBoundaries({
      mission_id: mission.id,
      outing_id: firstOuting.id,
      started_at: new Date(referenceTime - 2 * 60 * 60_000).toISOString(),
    })).rejects.toThrow(/recorded search pass.*outside/i)
    await expect(store.editOutingBoundaries({
      mission_id: mission.id,
      outing_id: firstOuting.id,
      ended_at: new Date(referenceTime - 2 * 60 * 60_000).toISOString(),
    })).rejects.toThrow(/recorded search pass.*outside/i)

    const openOuting = await store.createOuting({
      mission_id: mission.id,
      label: 'Open outing',
      started_at: new Date(referenceTime - 30 * 60_000).toISOString(),
    })
    await expect(store.upsertSearchAssignment({
      ...firstAssignment,
      outing_id: openOuting.id,
      participant_ids: [],
    })).rejects.toThrow(/assignment scope.*recorded search pass/i)
    const openAssignment = await store.upsertSearchAssignment({
      mission_id: mission.id,
      search_area_id: area.id,
      outing_id: openOuting.id,
      team_id: 'team-2',
      participant_ids: [],
      updated_by: 'Coordinator One',
    })
    const openPass = {
      ...completedPass,
      assignment_id: openAssignment.id,
      started_at: new Date(referenceTime - 20 * 60_000).toISOString(),
    }
    await expect(store.upsertSearchPass({
      ...openPass,
      started_at: new Date(referenceTime + 60 * 60_000).toISOString(),
      ended_at: null,
    })).rejects.toThrow(/pass start.*future/i)
    await expect(store.upsertSearchPass({
      ...openPass,
      ended_at: new Date(referenceTime + 60 * 60_000).toISOString(),
    })).rejects.toThrow(/pass end.*future/i)
    const activePass = await store.upsertSearchPass({ ...openPass, ended_at: null })
    await expect(store.endOuting({
      mission_id: mission.id,
      outing_id: openOuting.id,
    })).rejects.toThrow(/active search pass/i)
    await store.upsertSearchPass({
      ...activePass,
      ended_at: new Date(referenceTime - 10 * 60_000).toISOString(),
    })
    await expect(store.endOuting({
      mission_id: mission.id,
      outing_id: openOuting.id,
    })).resolves.toMatchObject({ ended_at: expect.any(String) })
    expect(recorded).toMatchObject({ started_at: validPassStart, ended_at: validPassEnd })
  })

  it('rejects ambiguous or oversized Search Operations input before persistence work [DON-279]', async () => {
    store = await createStore()
    const mission = await store.createMission({
      name: 'Bounded Search Operations Mission',
      start_time: '2026-02-01T00:00:00Z',
    })
    const outing = await store.createOuting({
      mission_id: mission.id,
      label: 'Long completed outing',
      started_at: '2026-02-02T00:00:00Z',
    })
    await store.endOuting({
      mission_id: mission.id,
      outing_id: outing.id,
      ended_at: '2026-03-03T00:00:00Z',
    })
    const area = await store.upsertSearchArea({
      mission_id: mission.id,
      name: 'Area Alpha',
      status: 'active',
      geometry_json: '{"type":"Polygon","coordinates":[]}',
      updated_by: 'Coordinator One',
    })
    await expect(store.upsertSearchAssignment({
      mission_id: mission.id,
      search_area_id: area.id,
      outing_id: outing.id,
      team_id: 't'.repeat(121),
      participant_ids: [],
      updated_by: 'Coordinator One',
    })).rejects.toThrow(/team.*120 characters/i)
    const assignment = await store.upsertSearchAssignment({
      mission_id: mission.id,
      search_area_id: area.id,
      outing_id: outing.id,
      team_id: 'team-1',
      participant_ids: [],
      updated_by: 'Coordinator One',
    })
    const validPass = {
      mission_id: mission.id,
      search_area_id: area.id,
      assignment_id: assignment.id,
      started_at: '2026-03-02T08:00:00Z',
      ended_at: '2026-03-02T09:00:00Z',
      outcome: 'partial',
      coordinator_name: 'Coordinator One',
      participant_ids: [],
      clue_ids: [],
      track_evidence_ids: [],
    }
    await expect(store.upsertSearchPass({
      ...validPass,
      started_at: '2026-02-30T08:00:00Z',
    })).rejects.toThrow(/pass start.*valid ISO8601.*explicit offset/i)
    await expect(store.upsertSearchPass({
      ...validPass,
      started_at: '2026-03-02T08:00:00',
    })).rejects.toThrow(/pass start.*valid ISO8601.*explicit offset/i)
    await expect(store.upsertSearchPass({
      ...validPass,
      coordinator_name: 'c'.repeat(121),
    })).rejects.toThrow(/coordinator.*120 characters/i)
    await expect(store.upsertSearchPass({
      ...validPass,
      notes: 'n'.repeat(2_001),
    })).rejects.toThrow(/notes.*2000 characters/i)
    const oversizedNotes = 'n'.repeat(32 * 1_024 * 1_024)
    const oversizedStartedAt = performance.now()
    await expect(store.upsertSearchPass({
      ...validPass,
      notes: oversizedNotes,
    })).rejects.toThrow(/notes.*2000 characters/i)
    expect(performance.now() - oversizedStartedAt).toBeLessThan(200)
    await expect(store.upsertSearchPass({
      ...validPass,
      participant_ids: Array.from({ length: 201 }, (_, index) => `participant-${index}`),
    })).rejects.toThrow(/participant links.*at most 200/i)
    await expect(store.upsertSearchPass({
      ...validPass,
      track_evidence_ids: ['t'.repeat(201)],
    })).rejects.toThrow(/track links.*200 characters/i)
    await expect(store.listSearchPasses(mission.id)).resolves.toEqual([])
  })

  it('keeps stable areas, repeated assignments, and coordinator-declared pass revisions [DON-279]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Repeated Search Mission' })
    const outing = await store.createOuting({ mission_id: mission.id, label: 'Operational period 1' })
    const area = await store.upsertSearchArea({
      mission_id: mission.id,
      name: 'Area Alpha',
      status: 'active',
      geometry_json: '{"type":"Polygon","coordinates":[]}',
      updated_by: 'Coordinator One',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'device-1',
      name: 'Hill Team 1',
      color: '#ef4444',
      status: 'online',
    })
    const participant = await store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'device',
      ref: 'device-1',
      confirmed_by: 'Coordinator One',
    })
    const clue = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    const trackEvidence = await store.addPosition({
      mission_id: mission.id,
      device_id: 'device-1',
      source_position_id: 'search-pass-fix-1',
      lat: 52.0599,
      lon: -9.5045,
      timestamp: '2026-08-27T08:30:00Z',
      received_at: '2026-08-27T08:30:01Z',
      timestamp_source: 'fix',
    })
    const firstAssignment = await store.upsertSearchAssignment({
      mission_id: mission.id,
      search_area_id: area.id,
      outing_id: outing.id,
      team_id: 'team-1',
      participant_ids: [participant.id],
      notes: 'First attempt',
      updated_by: 'Coordinator One',
    })
    await store.upsertSearchAssignment({
      mission_id: mission.id,
      search_area_id: area.id,
      outing_id: outing.id,
      team_id: 'team-2',
      participant_ids: [],
      notes: 'Second independent attempt',
      updated_by: 'Coordinator One',
    })
    const pass = await store.upsertSearchPass({
      mission_id: mission.id,
      search_area_id: area.id,
      assignment_id: firstAssignment.id,
      started_at: outing.started_at,
      ended_at: new Date().toISOString(),
      outcome: 'full',
      notes: 'Coordinator declaration',
      coordinator_name: 'Coordinator One',
      participant_ids: [participant.id],
      clue_ids: [clue.id],
      track_evidence_ids: [trackEvidence.id],
    })
    await store.upsertSearchPass({
      ...pass,
      outcome: 'partial',
      notes: 'Corrected after debrief',
      coordinator_name: 'Coordinator One',
    })

    expect(await store.listSearchAreas(mission.id)).toHaveLength(1)
    expect(await store.listSearchAssignments(mission.id)).toHaveLength(2)
    expect(await store.listSearchPasses(mission.id)).toEqual([
      expect.objectContaining({
        id: pass.id,
        outcome: 'partial',
        coordinator_name: 'Coordinator One',
        version_sequence: 2,
      }),
    ])
    const passVersions = await store.listMissionObjectVersions({
      missionId: mission.id,
      objectType: 'search_pass',
      objectId: String(pass.id),
    })
    expect(passVersions.map((version) => JSON.parse(version.state_json).outcome))
      .toEqual(['full', 'partial'])

    await store.finishMission(mission.id)
    await expect(store.upsertSearchPass({ ...pass, outcome: 'aborted' }))
      .rejects.toThrow(/finished mission|read-only/i)
  })

  it('rejects invented and cross-mission search-pass evidence links [DON-279]', async () => {
    store = await createStore()
    const otherMission = await store.createMission({ name: 'Other mission' })
    const foreignClue = await store.upsertMarker({ mission_id: otherMission.id, ...SAMPLE_MARKER })
    await store.upsertDevice({
      mission_id: otherMission.id, device_id: 'foreign-device', name: 'Foreign device',
      color: '#ef4444', status: 'online',
    })
    const foreignTrack = await store.addPosition({
      mission_id: otherMission.id, device_id: 'foreign-device', source_position_id: 'foreign-fix',
      lat: 52, lon: -9.7, timestamp: '2026-08-27T07:00:00Z',
      received_at: '2026-08-27T07:00:01Z', timestamp_source: 'fix',
    })
    await store.finishMission(otherMission.id)
    const mission = await store.createMission({ name: 'Link validation mission' })
    const outing = await store.createOuting({ mission_id: mission.id, label: 'Outing' })
    const area = await store.upsertSearchArea({
      mission_id: mission.id,
      name: 'Area',
      status: 'active',
      geometry_json: '{"type":"Polygon","coordinates":[]}',
      updated_by: 'Coordinator',
    })
    const assignment = await store.upsertSearchAssignment({
      mission_id: mission.id,
      search_area_id: area.id,
      outing_id: outing.id,
      team_id: 'team-1',
      participant_ids: [],
      updated_by: 'Coordinator',
    })
    await store.upsertDevice({
      mission_id: mission.id, device_id: 'mission-device', name: 'Mission device',
      color: '#3b82f6', status: 'online',
    })
    const participant = await store.addMissionParticipant({
      mission_id: mission.id, kind: 'device', ref: 'mission-device', confirmed_by: 'Coordinator',
    })
    const clue = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    const track = await store.addPosition({
      mission_id: mission.id, device_id: 'mission-device', source_position_id: 'mission-fix',
      lat: 52, lon: -9.7, timestamp: '2026-08-27T08:00:00Z',
      received_at: '2026-08-27T08:00:01Z', timestamp_source: 'fix',
    })
    const basePass = {
      mission_id: mission.id,
      search_area_id: area.id,
      assignment_id: assignment.id,
      started_at: outing.started_at,
      outcome: 'partial',
      coordinator_name: 'Coordinator',
    }
    await expect(store.upsertSearchPass({
      ...basePass,
      participant_ids: ['invented-participant'],
      clue_ids: [clue.id],
      track_evidence_ids: [track.id],
    })).rejects.toThrow(/participant.*not in this mission/i)
    await expect(store.upsertSearchPass({
      ...basePass,
      participant_ids: [participant.id],
      clue_ids: [foreignClue.id],
      track_evidence_ids: [track.id],
    })).rejects.toThrow(/clue.*not in this mission/i)
    await expect(store.upsertSearchPass({
      ...basePass,
      participant_ids: [participant.id],
      clue_ids: [clue.id],
      track_evidence_ids: [foreignTrack.id],
    })).rejects.toThrow(/track evidence.*not in this mission/i)
    await expect(store.upsertSearchPass({
      ...basePass,
      participant_ids: [participant.id],
      clue_ids: [clue.id],
      track_evidence_ids: [track.id],
    })).resolves.toMatchObject({ outcome: 'partial' })
  })

  it('rejects invented and cross-mission participant assignments [DON-279]', async () => {
    store = await createStore()
    const otherMission = await store.createMission({ name: 'Foreign participant mission' })
    await store.upsertDevice({
      mission_id: otherMission.id, device_id: 'foreign-device', name: 'Foreign device',
      color: '#ef4444', status: 'online',
    })
    const foreignParticipant = await store.addMissionParticipant({
      mission_id: otherMission.id, kind: 'device', ref: 'foreign-device', confirmed_by: 'Coordinator',
    })
    await store.finishMission(otherMission.id)
    const mission = await store.createMission({ name: 'Assignment link mission' })
    await store.upsertDevice({
      mission_id: mission.id, device_id: 'mission-device', name: 'Mission device',
      color: '#3b82f6', status: 'online',
    })
    const participant = await store.addMissionParticipant({
      mission_id: mission.id, kind: 'device', ref: 'mission-device', confirmed_by: 'Coordinator',
    })
    const outing = await store.createOuting({ mission_id: mission.id, label: 'Outing' })
    const area = await store.upsertSearchArea({
      mission_id: mission.id,
      name: 'Area',
      status: 'active',
      geometry_json: '{"type":"Polygon","coordinates":[]}',
      updated_by: 'Coordinator',
    })
    const assignment = {
      mission_id: mission.id,
      search_area_id: area.id,
      outing_id: outing.id,
      team_id: 'team-1',
      updated_by: 'Coordinator',
    }

    await expect(store.upsertSearchAssignment({
      ...assignment, participant_ids: ['invented-participant'],
    })).rejects.toThrow(/participant.*not in this mission/i)
    await expect(store.upsertSearchAssignment({
      ...assignment, participant_ids: [foreignParticipant.id],
    })).rejects.toThrow(/participant.*not in this mission/i)
    await expect(store.upsertSearchAssignment({
      ...assignment, participant_ids: [participant.id],
    })).resolves.toMatchObject({ participant_ids_json: JSON.stringify([participant.id]) })
  })

  it('rejects assignments and passes whose area or assignment has been retired [DON-279]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Retired Area Mission' })
    const outing = await store.createOuting({ mission_id: mission.id, label: 'Outing' })
    const area = await store.upsertSearchArea({
      mission_id: mission.id,
      name: 'Area to retire',
      status: 'active',
      geometry_json: '{"type":"Polygon","coordinates":[]}',
      updated_by: 'Coordinator',
    })
    const assignment = await store.upsertSearchAssignment({
      mission_id: mission.id,
      search_area_id: area.id,
      outing_id: outing.id,
      team_id: 'team-1',
      participant_ids: [],
      updated_by: 'Coordinator',
    })
    await store.retireSearchArea(String(area.id), 'Coordinator')

    await expect(store.upsertSearchAssignment({
      mission_id: mission.id,
      search_area_id: area.id,
      outing_id: outing.id,
      team_id: 'team-2',
      participant_ids: [],
      updated_by: 'Coordinator',
    })).rejects.toThrow(/retired search area/i)
    await expect(store.upsertSearchPass({
      mission_id: mission.id,
      search_area_id: area.id,
      assignment_id: assignment.id,
      started_at: '2026-08-27T08:00:00Z',
      ended_at: '2026-08-27T09:00:00Z',
      outcome: 'partial',
      coordinator_name: 'Coordinator',
    })).rejects.toThrow(/retired search area|retired assignment/i)
  })

  it('hashes, parses, and bulk-persists GPX off the main isolate with bounded results [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Worker GPX Mission' })
    const sourcePath = path.join(userDataPath!, 'worker-track.gpx')
    await writeFile(sourcePath, `<gpx version="1.1"><trk><name>Hill Team</name><trkseg>
      <trkpt lat="52" lon="-9.7"><time>2026-08-27T08:00:00Z</time></trkpt>
      <trkpt lat="52.01" lon="-9.71"></trkpt>
    </trkseg></trk></gpx>`)

    const result = await store.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] })
    expect(result.dispatchDurationMs).toBeLessThan(150)
    expect(result.imports).toEqual([expect.objectContaining({ id: expect.any(String) })])
    expect(JSON.stringify(result)).not.toContain('source_bytes_base64')
    expect(JSON.stringify(result)).not.toContain('MultiLineString')

    const db = openDatabase(await databasePath())
    expect(db.prepare('SELECT COUNT(*) AS count FROM gpx_evidence_points').get())
      .toMatchObject({ count: 2 })
    expect(db.prepare('SELECT timing_class, source_bytes_base64 FROM gpx_import_revisions').get())
      .toMatchObject({ timing_class: 'partially_dated', source_bytes_base64: expect.any(String) })
    db.close()

    const seekStartedAt = performance.now()
    const replay = await store.readMissionReplay({
      missionId: mission.id,
      selectedTime: new Date().toISOString(),
      timezone: 'Europe/Dublin',
      trackLimit: 100,
    }, 'worker-gpx-replay')
    expect(performance.now() - seekStartedAt).toBeLessThan(1_000)
    expect(replay).toMatchObject({
      totalTrackCount: 1,
      staticGpxPointCount: 1,
      tracks: [expect.objectContaining({ time_authority: 'gpx_source_time' })],
      limitations: [expect.objectContaining({ code: 'undated_gpx_static' })],
    })
  })

  it('continues a GPX batch after malformed and invalid-UTF-8 files and retains explicit failure provenance [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'GPX Failure Provenance Mission' })
    const validPath = path.join(userDataPath!, 'valid.gpx')
    const emptyPath = path.join(userDataPath!, 'empty.gpx')
    const invalidUtf8Path = path.join(userDataPath!, 'invalid-utf8.gpx')
    await writeFile(validPath, '<gpx version="1.1"><trk><trkseg><trkpt lat="52" lon="-9.7"/><trkpt lat="52.01" lon="-9.71"/></trkseg></trk></gpx>')
    await writeFile(emptyPath, '')
    await writeFile(invalidUtf8Path, Buffer.from([0xff, 0xfe, 0x3c, 0x67, 0x70, 0x78, 0x3e]))

    const result = await store.importGpxEvidencePaths({
      missionId: mission.id,
      paths: [validPath, emptyPath, invalidUtf8Path],
    })
    expect(result.imports).toHaveLength(1)
    expect(result.failures).toEqual([
      expect.objectContaining({ sourcePath: emptyPath, reason: expect.stringMatching(/empty|GPX|document/i) }),
      expect.objectContaining({ sourcePath: invalidUtf8Path, reason: expect.stringMatching(/UTF-8/i) }),
    ])
    expect(await store.listGpxImports(mission.id)).toHaveLength(1)

    const db = openDatabase(await databasePath())
    expect(db.prepare(`SELECT source_path, content_sha256, source_bytes_base64, reason
      FROM gpx_import_failures ORDER BY source_path`).all()).toEqual([
      expect.objectContaining({ source_path: emptyPath, content_sha256: expect.any(String), source_bytes_base64: '' }),
      expect.objectContaining({ source_path: invalidUtf8Path, content_sha256: expect.any(String), source_bytes_base64: expect.any(String) }),
    ])
    db.close()
  })

  it('rejects permissive scalar coercions in the production worker without inventing exact evidence [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Strict GPX Scalar Mission' })
    const sourcePath = path.join(userDataPath!, 'strict-scalars.gpx')
    const underflowDecimal = `0.${'0'.repeat(323)}1`
    await writeFile(sourcePath, `<gpx version="1.1"><trk><trkseg>
      <trkpt lat="" lon=""><ele></ele><time>2026</time></trkpt>
      <trkpt lat="1e-9999" lon="-1e-9999" />
      <trkpt lat="${underflowDecimal}" lon="-${underflowDecimal}" />
      <trkpt lat="52" lon="-9.7"><ele> </ele><time>2026-08-27T08:00:00</time></trkpt>
      <trkpt lat="52.01" lon="-9.71"><time>2026-02-30T08:00:00Z</time></trkpt>
    </trkseg></trk></gpx>`)

    await expect(store.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] }))
      .resolves.toMatchObject({ imports: [expect.objectContaining({ timing_class: 'undated' })] })

    const db = openDatabase(await databasePath())
    expect(db.prepare(`SELECT point_index, elevation, source_time FROM gpx_evidence_points
      ORDER BY point_index`).all()).toEqual([
      { point_index: 3, elevation: null, source_time: null },
      { point_index: 4, elevation: null, source_time: null },
    ])
    expect(db.prepare(`SELECT point_index, reason FROM gpx_evidence_rejections
      ORDER BY point_index, reason`).all()).toEqual(expect.arrayContaining([
      { point_index: 0, reason: 'invalid_coordinates' },
      { point_index: 1, reason: 'invalid_coordinates' },
      { point_index: 2, reason: 'invalid_coordinates' },
      { point_index: 3, reason: 'invalid_elevation' },
      { point_index: 3, reason: 'invalid_timestamp' },
      { point_index: 4, reason: 'invalid_timestamp' },
    ]))
    db.close()
  })

  it('rejects out-of-range timezone offsets in the production worker [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Strict GPX Offset Mission' })
    const sourcePath = path.join(userDataPath!, 'strict-offsets.gpx')
    await writeFile(sourcePath, `<gpx version="1.1"><trk><trkseg>
      <trkpt lat="52" lon="-9.7"><time>2026-08-27T08:00:00+23:00</time></trkpt>
      <trkpt lat="52.01" lon="-9.71"><time>2026-08-27T08:01:00-14:01</time></trkpt>
      <trkpt lat="52.02" lon="-9.72"><time>0000-08-27T08:02:00Z</time></trkpt>
      <trkpt lat="52.03" lon="-9.73"><time>2026-08-27T08:03:00+14:00</time></trkpt>
    </trkseg></trk></gpx>`)

    await expect(store.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] }))
      .resolves.toMatchObject({ imports: [expect.objectContaining({ timing_class: 'partially_dated' })] })

    const db = openDatabase(await databasePath())
    expect(db.prepare(`SELECT point_index, source_time FROM gpx_evidence_points
      ORDER BY point_index`).all()).toEqual([
      { point_index: 0, source_time: null },
      { point_index: 1, source_time: null },
      { point_index: 2, source_time: null },
      { point_index: 3, source_time: '2026-08-26T18:03:00.000Z' },
    ])
    expect(db.prepare(`SELECT point_index, reason FROM gpx_evidence_rejections
      ORDER BY point_index`).all()).toEqual([
      { point_index: 0, reason: 'invalid_timestamp' },
      { point_index: 1, reason: 'invalid_timestamp' },
      { point_index: 2, reason: 'invalid_timestamp' },
    ])
    db.close()
  })

  it('serializes concurrent identical GPX batches into one canonical import with two aliases [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Concurrent GPX Dedupe Mission' })
    const firstPath = path.join(userDataPath!, 'same-a.gpx')
    const secondPath = path.join(userDataPath!, 'same-b.gpx')
    const points = Array.from({ length: 5_000 }, (_unused, index) =>
      `<trkpt lat="${52 + (index % 100) / 10_000}" lon="${-9.7 - (index % 100) / 10_000}"/>`).join('')
    const source = `<gpx version="1.1"><trk><trkseg>${points}</trkseg></trk></gpx>`
    await Promise.all([writeFile(firstPath, source), writeFile(secondPath, source)])

    const [first, second] = await Promise.all([
      store.importGpxEvidencePaths({ missionId: mission.id, paths: [firstPath] }),
      store.importGpxEvidencePaths({ missionId: mission.id, paths: [secondPath] }),
    ])

    expect(first.imports[0]?.id).toBe(second.imports[0]?.id)
    const db = openDatabase(await databasePath())
    expect(db.prepare(`SELECT COUNT(*) AS count FROM gpx_track_imports
      WHERE mission_id = ?`).get(mission.id)).toMatchObject({ count: 1 })
    expect(db.prepare(`SELECT COUNT(*) AS count FROM gpx_import_aliases
      WHERE mission_id = ?`).get(mission.id)).toMatchObject({ count: 2 })
    expect(Number(db.prepare(`SELECT generation FROM mission_replay_generations
      WHERE mission_id = ?`).get(mission.id)?.generation ?? 0)).toBeGreaterThan(1)
    db.close()
  }, 30_000)

  it('records an oversized GPX as an explicit per-file failure before exact-byte retention [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Oversized GPX Mission' })
    const sourcePath = path.join(userDataPath!, 'oversized.gpx')
    const prefix = '<gpx version="1.1"><metadata><desc>'
    const suffix = '</desc></metadata><trk><trkseg><trkpt lat="52" lon="-9.7"/><trkpt lat="52.01" lon="-9.71"/></trkseg></trk></gpx>'
    await writeFile(sourcePath, `${prefix}${'x'.repeat((8 * 1024 * 1024) + 1)}${suffix}`)

    const result = await store.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] })

    expect(result.imports).toEqual([])
    expect(result.failures).toEqual([
      expect.objectContaining({ sourcePath, reason: expect.stringMatching(/8 MiB.*safety limit/i) }),
    ])
    const db = openDatabase(await databasePath())
    expect(db.prepare(`SELECT status, content_sha256, source_bytes_base64
      FROM gpx_import_source_receipts WHERE mission_id = ? AND source_path = ?`)
      .get(mission.id, sourcePath)).toEqual({
      status: 'failed',
      content_sha256: null,
      source_bytes_base64: null,
    })
    db.close()
  }, 30_000)

  it('imports readable siblings while durably recording a missing selected GPX file [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'GPX Missing Sibling Mission' })
    const validPath = path.join(userDataPath!, 'readable.gpx')
    const missingPath = path.join(userDataPath!, 'missing.gpx')
    await writeFile(validPath, '<gpx version="1.1"><trk><trkseg><trkpt lat="52" lon="-9.7"/><trkpt lat="52.01" lon="-9.71"/></trkseg></trk></gpx>')

    const result = await store.importGpxEvidencePaths({
      missionId: mission.id,
      paths: [missingPath, validPath],
    })

    expect(result.imports).toHaveLength(1)
    expect(result.failures).toEqual([
      expect.objectContaining({ sourcePath: missingPath, reason: expect.stringMatching(/ENOENT|not found/i) }),
    ])
    const db = openDatabase(await databasePath())
    expect(db.prepare(`SELECT status, completed_files, failed_files FROM gpx_import_batches
      WHERE mission_id = ? ORDER BY started_at DESC LIMIT 1`).get(mission.id)).toMatchObject({
      status: 'completed_with_failures',
      completed_files: 1,
      failed_files: 1,
    })
    expect(db.prepare(`SELECT status FROM gpx_import_source_receipts
      WHERE mission_id = ? AND source_path = ?`).get(mission.id, missingPath))
      .toMatchObject({ status: 'failed' })
    db.close()
  })

  it('blocks Finish and Finalize while durable GPX state is unsettled [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'GPX Lifecycle Gate Mission' })
    const databaseFile = await databasePath()
    const db = openDatabase(databaseFile)
    startGpxImportBatch(db, {
      batchId: 'active-batch',
      missionId: mission.id,
      totalFiles: 1,
    })
    recordGpxImportSourceReceipt(db, {
      batchId: 'active-batch',
      missionId: mission.id,
      sourcePath: '/field/active.gpx',
      fileName: 'active.gpx',
    })
    db.close()

    await expect(store.finishMission(mission.id)).rejects.toThrow(/GPX evidence import.*unsettled/i)
    expect((await store.getMission(mission.id)).status).toBe('active')

    const forceFinishedDb = openDatabase(databaseFile)
    forceFinishedDb.prepare("UPDATE missions SET status = 'finished', finish_time = ? WHERE id = ?")
      .run(new Date().toISOString(), mission.id)
    forceFinishedDb.close()
    await expect(store.finalizeMission(mission.id)).rejects.toThrow(/GPX evidence import.*unsettled/i)
  })

  it('returns bounded persisted GPX import issues without retained bytes or absolute paths [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'GPX Issue Page Mission' })
    const validPath = path.join(userDataPath!, 'valid-page.gpx')
    await writeFile(validPath, '<gpx version="1.1"><trk><trkseg><trkpt lat="52" lon="-9.7"/><trkpt lat="52.01" lon="-9.71"/></trkseg></trk></gpx>')
    const missingPaths = Array.from({ length: 3 }, (_unused, index) =>
      path.join(userDataPath!, `missing-page-${index}.gpx`))
    await store.importGpxEvidencePaths({ missionId: mission.id, paths: [validPath, ...missingPaths] })

    const firstPage = await store.listGpxImportIssues({ missionId: mission.id, limit: 2 })
    expect(firstPage.entries).toHaveLength(2)
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    expect(JSON.stringify(firstPage)).not.toContain('source_bytes_base64')
    expect(JSON.stringify(firstPage)).not.toContain(userDataPath)
    for (const entry of firstPage.entries) {
      expect(entry).toEqual(expect.objectContaining({
        batch_id: expect.any(String),
        file_name: expect.stringMatching(/\.gpx$/),
        reason: expect.any(String),
        recorded_at: expect.any(String),
      }))
    }
    const secondPage = await store.listGpxImportIssues({
      missionId: mission.id,
      cursor: firstPage.nextCursor ?? undefined,
      limit: 2,
    })
    expect(secondPage.entries).toHaveLength(1)
    await expect(store.listGpxImportIssues({ missionId: mission.id, limit: 101 }))
      .rejects.toThrow(/limit/i)
  })

  it('cancels and joins active GPX workers before allowing mission-store shutdown [DON-274]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-shutdown-'))
    let importSignal: AbortSignal | undefined
    let resolveWorkerExit: (() => void) | undefined
    const workerExited = new Promise<void>((resolve) => { resolveWorkerExit = resolve })
    const runner = ((input: { readonly signal?: AbortSignal }) => {
      importSignal = input.signal
      const result = new Promise((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          reject(error)
          queueMicrotask(() => resolveWorkerExit?.())
        }, { once: true })
      })
      Object.defineProperty(result, 'workerExited', { value: workerExited })
      return result
    }) as (input: { readonly signal?: AbortSignal }) => Promise<unknown> & { readonly workerExited: Promise<void> }
    store = createElectronMissionStore({ userDataPath, runGpxEvidenceImportInWorker: runner })
    const mission = await store.createMission({ name: 'GPX Shutdown Mission' })
    const importing = store.importGpxEvidencePaths({ missionId: mission.id, paths: ['/field/active.gpx'] })
    const rejection = expect(importing).rejects.toMatchObject({ name: 'AbortError' })

    await store.prepareClose()
    expect(importSignal?.aborted).toBe(true)
    await rejection
    expect(() => store?.close()).not.toThrow()
    store = null
  })

  it('rechecks the finished-mission write fence inside the GPX worker transaction [DON-274]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-finalization-fence-'))
    let releaseWrite: (() => void) | undefined
    let reportStarted: (() => void) | undefined
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve })
    const started = new Promise<void>((resolve) => { reportStarted = resolve })
    const runner = (async (input: {
      readonly batchId: string
      readonly databasePath: string
      readonly missionId: string
    }) => {
      reportStarted?.()
      await writeGate
      const workerDb = openDatabase(input.databasePath)
      try {
        const sourceBytesBase64 = 'PGdweD5maXJzdDwvZ3B4Pg=='
        retainGpxImportSourceBytes(workerDb, {
          batchId: input.batchId,
          missionId: input.missionId,
          sourcePath: '/field/late.gpx',
          contentSha256: digestBase64(sourceBytesBase64),
          sourceBytesBase64,
        })
        const imported = upsertGpxEvidence(workerDb, gpxInput(input.missionId, {
          source_path: '/field/late.gpx',
          content_sha256: digestBase64(sourceBytesBase64),
          source_bytes_base64: sourceBytesBase64,
        }))
        settleGpxImportSourceReceipt(workerDb, {
          batchId: input.batchId,
          missionId: input.missionId,
          sourcePath: '/field/late.gpx',
        })
        workerDb.prepare(`UPDATE gpx_import_batches SET status = 'completed', finished_at = ?
          WHERE id = ?`).run(new Date().toISOString(), input.batchId)
        return {
          imports: [imported],
          failures: [],
          dispatchDurationMs: 0,
        }
      } finally {
        workerDb.close()
      }
    }) as (input: {
      readonly batchId: string
      readonly databasePath: string
      readonly missionId: string
    }) => Promise<unknown>
    store = createElectronMissionStore({ userDataPath, runGpxEvidenceImportInWorker: runner })
    const mission = await store.createMission({ name: 'GPX Finalization Fence Mission' })
    const importing = store.importGpxEvidencePaths({ missionId: mission.id, paths: ['/field/late.gpx'] })
    await started
    await expect(store.finishMission(mission.id)).rejects.toThrow(/GPX evidence import.*unsettled/i)
    releaseWrite?.()

    await expect(importing).resolves.toMatchObject({ imports: [expect.objectContaining({ id: expect.any(String) })] })
    await expect(store.finishMission(mission.id)).resolves.toMatchObject({ status: 'finished' })
    await expect(store.listGpxImports(mission.id)).resolves.toHaveLength(1)
  })

  it('keeps synchronous current-position writes below the 200 ms hard gate during a 50k-point GPX import [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'GPX Current Priority Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'current-device',
      name: 'Current Device',
      color: '#38bdf8',
      status: 'online',
    })
    const sourcePath = path.join(userDataPath!, 'fifty-thousand.gpx')
    const points = Array.from({ length: 50_000 }, (_unused, index) =>
      `<trkpt lat="${52 + (index % 100) / 10_000}" lon="${-9.7 - (index % 100) / 10_000}"/>`).join('')
    await writeFile(sourcePath, `<gpx version="1.1"><trk><trkseg>${points}</trkseg></trk></gpx>`)

    let importSettled = false
    const importing = store.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] })
      .finally(() => { importSettled = true })
    let maximumWriteMs = 0
    let sequence = 0
    while (!importSettled && sequence < 500) {
      const startedAt = performance.now()
      await store.addPosition({
        mission_id: mission.id,
        device_id: 'current-device',
        source_position_id: `current-${sequence}`,
        lat: 52,
        lon: -9.7,
        timestamp: new Date().toISOString(),
        timestamp_source: 'fix',
      })
      maximumWriteMs = Math.max(maximumWriteMs, performance.now() - startedAt)
      sequence += 1
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    await importing
    expect(sequence).toBeGreaterThan(0)
    expect(maximumWriteMs).toBeLessThan(200)
  }, 30_000)

  it('keeps current writes below 200 ms while retaining an exact-limit 8 MiB GPX source [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Exact-Limit GPX Current Priority Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'limit-current-device',
      name: 'Limit Current Device',
      color: '#38bdf8',
      status: 'online',
    })
    const sourcePath = path.join(userDataPath!, 'exact-limit.gpx')
    const prefix = '<gpx version="1.1"><metadata><desc>'
    const suffix = '</desc></metadata><trk><trkseg><trkpt lat="52" lon="-9.7"/><trkpt lat="52.01" lon="-9.71"/></trkseg></trk></gpx>'
    const maximumBytes = 8 * 1024 * 1024
    const fillerBytes = maximumBytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix)
    await writeFile(sourcePath, `${prefix}${'x'.repeat(fillerBytes)}${suffix}`)

    let importSettled = false
    const importing = store.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] })
      .finally(() => { importSettled = true })
    let maximumWriteMs = 0
    let sequence = 0
    while (!importSettled && sequence < 500) {
      const startedAt = performance.now()
      await store.addPosition({
        mission_id: mission.id,
        device_id: 'limit-current-device',
        source_position_id: `limit-current-${sequence}`,
        lat: 52,
        lon: -9.7,
        timestamp: new Date().toISOString(),
        timestamp_source: 'fix',
      })
      maximumWriteMs = Math.max(maximumWriteMs, performance.now() - startedAt)
      sequence += 1
      await new Promise((resolve) => setTimeout(resolve, 1))
    }

    await expect(importing).resolves.toMatchObject({ imports: [expect.objectContaining({ id: expect.any(String) })] })
    expect(sequence).toBeGreaterThan(0)
    expect(maximumWriteMs).toBeLessThan(200)
  }, 30_000)

  async function createStore(
    faultInjection?: { readonly afterProjection?: boolean },
  ): Promise<MissionEvidenceStore> {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-versioning-'))
    return createElectronMissionStore({
      userDataPath,
      ...(faultInjection === undefined ? {} : { evidenceVersionFaultInjection: faultInjection }),
    })
  }

  async function databasePath(): Promise<string> {
    const info = await store!.info()
    return info.database_path
  }

  function openDatabase(databasePath: string): InstanceType<typeof Database> {
    return new Database(databasePath)
  }

  function gpxInput(missionId: string, overrides: Readonly<Record<string, unknown>>) {
    return {
      mission_id: missionId,
      source_path: '/field/route.gpx',
      file_name: 'route.gpx',
      display_name: 'Route',
      geometry_json: '{"type":"MultiLineString","coordinates":[[[-9.7,52],[-9.71,52.01]]]}',
      metadata_json: '{}',
      content_sha256: digestBase64('PGdweD5maXJzdDwvZ3B4Pg=='),
      source_bytes_base64: 'PGdweD5maXJzdDwvZ3B4Pg==',
      timing_class: 'fully_dated',
      points: [
        { segment_index: 0, point_index: 0, track_name: 'Route', lat: 52, lon: -9.7, elevation: 100, timestamp: '2026-08-27T08:00:00Z' },
        { segment_index: 0, point_index: 1, track_name: 'Route', lat: 52.01, lon: -9.71, elevation: null, timestamp: null },
      ],
      rejections: [],
      ...overrides,
    }
  }

  function digestBase64(value: string): string {
    return createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex')
  }
})
