import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

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
  createMissionArchive(missionId: string): Promise<Readonly<Record<string, unknown>>>
  upsertMarker(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  deleteMarker(markerId: string): Promise<boolean>
  listMarkers(missionId: string): Promise<readonly Readonly<Record<string, unknown>>[]>
  upsertDrawing(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  listDrawings(missionId: string): Promise<readonly Readonly<Record<string, unknown>>[]>
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
  listSearchOperationPage(input: Readonly<Record<string, unknown>>): Promise<{
    readonly entries: readonly Readonly<Record<string, unknown>>[]
    readonly totalCount: number
    readonly nextCursor: string | null
  }>
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
    readonly gpxShutdownJoinTimeoutMs?: number
    readonly startLegacyEvidenceBackfillWorker?: (input: Readonly<Record<string, unknown>>) => {
      readonly completion: Promise<Readonly<Record<string, unknown>>>
      terminate(): Promise<void>
    }
    readonly runGpxEvidenceImportInWorker?: (input: {
      readonly databasePath: string
      readonly missionId: string
      readonly signal?: AbortSignal
    }) => Promise<unknown> & { readonly workerExited?: Promise<void> }
  }) => MissionEvidenceStore
}

const { backfillLegacyEventProvenance } = require(
  '../../electron/mission-event-provenance-backfill.cjs',
) as {
  readonly backfillLegacyEventProvenance: (
    db: unknown,
    migrationTime: string,
    maximumRows?: number,
  ) => { readonly remaining: number }
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
    vi.restoreAllMocks()
    await store?.prepareClose()
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

  it('rejects oversized marker and non-search drawing evidence before synchronous version writes [DON-277]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Bounded Mutable Evidence Mission' })
    const oversized = 'x'.repeat(64 * 1024 * 1024)

    const markerStarted = performance.now()
    await expect(store.upsertMarker({
      mission_id: mission.id,
      ...SAMPLE_MARKER,
      description: oversized,
    })).rejects.toThrow(/marker description.*invalid/i)
    expect(performance.now() - markerStarted).toBeLessThan(200)

    const drawingStarted = performance.now()
    await expect(store.upsertDrawing({
      mission_id: mission.id,
      type: 'line',
      name: 'Oversized line',
      display_order: 0,
      geometry_json: oversized,
    })).rejects.toThrow(/drawing geometry.*invalid/i)
    expect(performance.now() - drawingStarted).toBeLessThan(200)

    const tooManyCoordinates = JSON.stringify({
      type: 'LineString',
      coordinates: Array.from({ length: 50_001 }, () => [0, 0]),
    })
    expect(Buffer.byteLength(tooManyCoordinates, 'utf8')).toBeLessThan(512 * 1024)
    await expect(store.upsertDrawing({
      mission_id: mission.id,
      type: 'line',
      name: 'Too many coordinates',
      display_order: 0,
      geometry_json: tooManyCoordinates,
    })).rejects.toThrow(/drawing geometry.*invalid/i)

    const retirementStarted = performance.now()
    await expect(store.deleteMarker(oversized)).rejects.toThrow(/marker identity.*200/i)
    expect(performance.now() - retirementStarted).toBeLessThan(200)

    await expect(store.listMarkers(mission.id)).resolves.toEqual([])
    await expect(store.listDrawings(mission.id)).resolves.toEqual([])
    await expect(store.listMissionObjectVersions({ missionId: mission.id })).resolves.toEqual([])
  })

  it('preserves an accumulated casualty treatment log beyond a single-note limit [DON-277]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Accumulated Treatment Evidence Mission' })
    const treatment = Array.from(
      { length: 80 },
      (_, index) => `[2026-08-29 10:${String(index % 60).padStart(2, '0')}] Coordinator: Treatment update ${index} ${'x'.repeat(160)}`,
    ).join('\n\n')
    expect(Buffer.byteLength(treatment, 'utf8')).toBeGreaterThan(2_000)
    expect(Buffer.byteLength(treatment, 'utf8')).toBeLessThan(512 * 1_024)

    const created = await store.upsertMarker({
      mission_id: mission.id,
      ...SAMPLE_MARKER,
      type: 'casualty',
      condition: 'Stable',
      treatment,
      evacuation_priority: 'Priority 2',
    })
    const updated = await store.upsertMarker({
      ...created,
      condition: 'Monitoring',
    })

    expect(updated.treatment).toBe(treatment)
    expect(updated.condition).toBe('Monitoring')
    const versions = await store.listMissionObjectVersions({
      missionId: mission.id,
      objectType: 'marker',
      objectId: String(created.id),
    })
    expect(JSON.parse(versions.at(-1)!.state_json)).toMatchObject({ treatment })

    await expect(store.upsertMarker({
      ...updated,
      treatment: 'x'.repeat(512 * 1_024 + 1),
    })).rejects.toThrow(/treatment log.*524288 UTF-8 bytes/i)
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
    const legacyArea = await first.upsertDrawing({
      mission_id: mission.id,
      type: 'search_area',
      name: 'Legacy Area',
      display_order: 0,
      geometry_json: '{"type":"Polygon","coordinates":[]}',
    })
    await first.createOuting({ mission_id: mission.id, label: 'Outing One' })
    first.close()

    const db = openDatabase(path.join(userDataPath, 'mission-store.sqlite'))
    db.prepare(`UPDATE drawings SET geometry_json = ? WHERE id = ?`).run(
      '{"type":"MultiPolygon","coordinates":[]}',
      legacyArea.id,
    )
    db.prepare(`UPDATE search_areas SET geometry_json = ? WHERE id = ?`).run(
      '{"type":"MultiPolygon","coordinates":[]}',
      legacyArea.id,
    )
    db.prepare("UPDATE metadata SET value = '11' WHERE key = 'schema_version'").run()
    db.exec('DROP TABLE mission_object_versions')
    db.close()

    store = createElectronMissionStore({ userDataPath })
    expect(CURRENT_SCHEMA_VERSION).toBe(12)
    await expect(store.info()).resolves.toMatchObject({ schema_version: 12 })
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const inspection = openDatabase(path.join(userDataPath, 'mission-store.sqlite'))
      const count = Number(inspection.prepare(
        'SELECT COUNT(*) AS count FROM mission_object_versions',
      ).get()?.count ?? 0)
      inspection.close()
      if (count === 4) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const versions = await store.listMissionObjectVersions({ missionId: mission.id })
    expect(versions).toHaveLength(4)
    expect(new Set(versions.map((version) => version.object_type))).toEqual(
      new Set(['marker', 'drawing', 'outing', 'search_area']),
    )
    expect(versions.every((version) => version.operation === 'legacy_baseline')).toBe(true)
    expect(versions.every((version) => version.completeness === 'legacy_baseline')).toBe(true)
    await expect(store.retireSearchArea(String(legacyArea.id), 'Coordinator')).resolves.toBe(true)
    expect(await store.listSearchAreas(mission.id)).toEqual([])
  })

  it('rejects edits that would overwrite the sole exact copy of oversized legacy mutable evidence [DON-277]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-oversized-object-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Oversized Legacy Object Mission' })
    const marker = await first.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    first.close()

    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const exactLegacyDescription = `Exact retained legacy evidence ${'x'.repeat(1024 * 1024)}`
    const legacyDb = openDatabase(databaseFile)
    legacyDb.prepare('UPDATE markers SET description = ? WHERE id = ?')
      .run(exactLegacyDescription, marker.id)
    legacyDb.prepare("UPDATE metadata SET value = '11' WHERE key = 'schema_version'").run()
    legacyDb.exec('DROP TABLE mission_object_versions')
    legacyDb.close()

    store = createElectronMissionStore({ userDataPath })
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const inspection = openDatabase(databaseFile)
      const count = Number(inspection.prepare(
        'SELECT COUNT(*) AS count FROM mission_object_versions',
      ).get()?.count ?? 0)
      inspection.close()
      if (count === 1) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    const baseline = await store.listMissionObjectVersions({
      missionId: mission.id,
      objectType: 'marker',
      objectId: String(marker.id),
    })
    expect(baseline).toHaveLength(1)
    expect(JSON.parse(baseline[0].state_json)).toMatchObject({
      id: marker.id,
      mission_id: mission.id,
      legacy_history_known: false,
      legacy_state_omitted: true,
    })

    await expect(store.upsertMarker({
      id: marker.id,
      mission_id: mission.id,
      ...SAMPLE_MARKER,
      description: 'Replacement that must not overwrite retained evidence',
    })).rejects.toThrow(/sole exact.*legacy.*retained.*cannot be changed or retired/iu)
    await expect(store.deleteMarker(String(marker.id)))
      .rejects.toThrow(/sole exact.*legacy.*retained.*cannot be changed or retired/iu)

    expect(await store.listMarkers(mission.id)).toEqual([
      expect.objectContaining({ id: marker.id, description: exactLegacyDescription }),
    ])
    expect(await store.listMissionObjectVersions({
      missionId: mission.id,
      objectType: 'marker',
      objectId: String(marker.id),
    })).toEqual(baseline)
  })

  it('reconstructs large legacy mutable-object inventories in bounded background turns [DON-277]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-object-backfill-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Large Legacy Object Inventory' })
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = openDatabase(databaseFile)
    legacyDb.exec(`
      WITH RECURSIVE numbers(n) AS (
        VALUES (0) UNION ALL SELECT n + 1 FROM numbers WHERE n < 49999
      )
      INSERT INTO markers (
        id, mission_id, type, name, description, lat, lon, irish_grid_e,
        irish_grid_n, created_at, updated_at, display_order, updated_by
      ) SELECT printf('legacy-marker-%05d', n), '${mission.id}', 'clue',
        printf('Legacy marker %05d', n), 'Retained legacy evidence',
        52.1, -9.5, 480000, 580000,
        '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z', n,
        'Legacy coordinator'
      FROM numbers;
      UPDATE metadata SET value = '11' WHERE key = 'schema_version';
      DROP TABLE mission_object_versions;
      DROP TABLE legacy_mission_object_backfill_state;
    `)
    legacyDb.close()

    const openedAt = performance.now()
    store = createElectronMissionStore({ userDataPath })
    const openMs = performance.now() - openedAt
    expect(openMs).toBeLessThan(200)
    await expect(store.listMissionObjectVersions({ missionId: mission.id }))
      .rejects.toThrow(/legacy mutable evidence baselines.*background/iu)
    await expect(store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER }))
      .rejects.toThrow(/legacy mutable evidence baselines.*background/iu)
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'current-priority-device',
      name: 'Current priority device',
      color: '#3b82f6',
      status: 'online',
    })
    const currentWriteStarted = performance.now()
    const currentFixTime = new Date().toISOString()
    await store.addPosition({
      mission_id: mission.id,
      device_id: 'current-priority-device',
      source_position_id: 'current-during-object-backfill',
      lat: 52.1,
      lon: -9.5,
      timestamp: currentFixTime,
      received_at: currentFixTime,
      timestamp_source: 'fix',
    })
    expect(performance.now() - currentWriteStarted).toBeLessThan(200)

    let lastHeartbeat = performance.now()
    let maximumHeartbeatGapMs = 0
    const heartbeat = setInterval(() => {
      const current = performance.now()
      maximumHeartbeatGapMs = Math.max(maximumHeartbeatGapMs, current - lastHeartbeat)
      lastHeartbeat = current
    }, 10)
    const inspection = openDatabase(databaseFile)
    let baselineCount = 0
    // Smaller production turns retain current-position priority on slower Linux
    // runners, so allow the same complete 50k settlement more bounded turns.
    for (let attempt = 0; attempt < 4_500 && baselineCount < 50_000; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      baselineCount = Number(inspection.prepare(
        'SELECT COUNT(*) AS count FROM mission_object_versions',
      ).get()?.count ?? 0)
    }
    clearInterval(heartbeat)
    inspection.close()
    expect(baselineCount).toBe(50_000)
    expect(maximumHeartbeatGapMs).toBeLessThan(200)
    await expect(store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER }))
      .resolves.toMatchObject({ mission_id: mission.id })
  }, 60_000)

  it('keeps current positions available and records a fail-closed reason when legacy worker startup fails [DON-277]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-worker-start-failure-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Legacy Worker Start Failure' })
    await first.upsertDevice({
      mission_id: mission.id,
      device_id: 'current-priority-device',
      name: 'Current priority device',
      color: '#3b82f6',
      status: 'online',
    })
    await first.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = openDatabase(databaseFile)
    legacyDb.exec(`
      UPDATE metadata SET value = '11' WHERE key = 'schema_version';
      DROP TABLE mission_object_versions;
      DROP TABLE legacy_mission_object_backfill_state;
    `)
    legacyDb.close()
    const loggedFailure = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    store = createElectronMissionStore({
      userDataPath,
      startLegacyEvidenceBackfillWorker: () => {
        throw new Error('worker constructor unavailable\nunsafe detail')
      },
    })

    await expect(store.listMissionObjectVersions({ missionId: mission.id }))
      .rejects.toThrow(/reconstruction stopped safely.*worker constructor unavailable/iu)
    const currentFixTime = new Date().toISOString()
    const currentWriteStarted = performance.now()
    await expect(store.addPosition({
      mission_id: mission.id,
      device_id: 'current-priority-device',
      source_position_id: 'current-after-worker-start-failure',
      lat: 52.1,
      lon: -9.5,
      timestamp: currentFixTime,
      received_at: currentFixTime,
      timestamp_source: 'fix',
    })).resolves.toMatchObject({ source_position_id: 'current-after-worker-start-failure' })
    expect(performance.now() - currentWriteStarted).toBeLessThan(200)
    const inspection = openDatabase(databaseFile)
    expect(inspection.prepare(`SELECT value FROM metadata
      WHERE key = 'legacy_evidence_backfill_failure'`).get()?.value)
      .toBe('worker constructor unavailable unsafe detail')
    inspection.close()
    expect(loggedFailure).toHaveBeenCalledWith(expect.stringMatching(
      /migration could not start safely.*worker constructor unavailable unsafe detail/iu,
    ))
    loggedFailure.mockRestore()

    store.close()
    store = createElectronMissionStore({ userDataPath })
    let reconstructed = false
    for (let attempt = 0; attempt < 100 && !reconstructed; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      reconstructed = await store.listMissionObjectVersions({ missionId: mission.id })
        .then(() => true, () => false)
    }
    expect(reconstructed).toBe(true)
    const recovered = openDatabase(databaseFile)
    expect(recovered.prepare(`SELECT value FROM metadata
      WHERE key = 'legacy_evidence_backfill_failure'`).get()).toBeUndefined()
    recovered.close()
  })

  it('prepares large legacy event provenance in bounded turns and fails Replay closed meanwhile [DON-278]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-event-provenance-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Legacy Event Provenance Mission' })
    await first.upsertDevice({
      mission_id: mission.id,
      device_id: 'event-provenance-current',
      name: 'Current priority device',
      color: '#3b82f6',
      status: 'online',
    })
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = openDatabase(databaseFile)
    legacyDb.prepare('DELETE FROM mission_events WHERE mission_id = ?').run(mission.id)
    legacyDb.exec(`
      WITH RECURSIVE numbers(n) AS (
        VALUES (0) UNION ALL SELECT n + 1 FROM numbers WHERE n < 499999
      )
      INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json, recorded_at,
        recording_completeness
      ) SELECT printf('legacy-event-%06d', n), '${mission.id}', 'legacy_event',
        '2026-08-20T10:00:00.000Z', NULL, NULL, NULL
      FROM numbers;
      DROP TABLE legacy_event_provenance_backfill_state;
      DROP INDEX idx_mission_events_replay;
      UPDATE metadata SET value = '11' WHERE key = 'schema_version';
    `)
    legacyDb.close()

    const openedAt = performance.now()
    store = createElectronMissionStore({ userDataPath })
    expect(performance.now() - openedAt).toBeLessThan(200)
    const postMigrationDb = openDatabase(databaseFile)
    expect(postMigrationDb.prepare(`SELECT 1 FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_mission_events_replay'`).get()).toBeUndefined()
    postMigrationDb.close()
    await expect(store.readMissionReplay({
      missionId: mission.id,
      selectedTime: '2026-08-20T10:05:00.000Z',
      timezone: 'Europe/Dublin',
      trackLimit: 100,
      objectLimit: 100,
    })).rejects.toThrow(/event provenance.*background|replay.*preparation/iu)

    const currentWriteStarted = performance.now()
    const currentFixTime = new Date().toISOString()
    await store.addPosition({
      mission_id: mission.id,
      device_id: 'event-provenance-current',
      source_position_id: 'current-during-event-provenance',
      lat: 52.1,
      lon: -9.5,
      timestamp: currentFixTime,
      received_at: currentFixTime,
      timestamp_source: 'fix',
    })
    expect(performance.now() - currentWriteStarted).toBeLessThan(200)

    const checkpointDb = openDatabase(databaseFile)
    let durableCursor: string | null = null
    for (let attempt = 0; attempt < 100 && durableCursor === null; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      durableCursor = checkpointDb.prepare(`SELECT scanned_through_id
        FROM legacy_event_provenance_backfill_state
        WHERE table_name = 'mission_events'`).get()?.scanned_through_id as string | null
    }
    expect(durableCursor).toMatch(/^\d+$/u)
    checkpointDb.close()
    await store.prepareClose()
    store.close()
    store = createElectronMissionStore({ userDataPath })
    const restartedDb = openDatabase(databaseFile)
    const restartedCursor = String(restartedDb.prepare(`SELECT scanned_through_id
      FROM legacy_event_provenance_backfill_state
      WHERE table_name = 'mission_events'`).get()?.scanned_through_id)
    expect(Number(restartedCursor)).toBeGreaterThanOrEqual(Number(durableCursor))
    restartedDb.close()
    await expect(store.readMissionReplay({
      missionId: mission.id,
      selectedTime: '2026-08-20T10:05:00.000Z',
      timezone: 'Europe/Dublin',
      trackLimit: 100,
      objectLimit: 100,
    })).rejects.toThrow(/event provenance.*background|replay.*preparation/iu)

    let lastHeartbeat = performance.now()
    let maximumHeartbeatGapMs = 0
    const heartbeat = setInterval(() => {
      const current = performance.now()
      maximumHeartbeatGapMs = Math.max(maximumHeartbeatGapMs, current - lastHeartbeat)
      lastHeartbeat = current
    }, 10)
    const inspection = openDatabase(databaseFile)
    let pending = 1
    for (let attempt = 0; attempt < 8_000 && pending > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      pending = Number(inspection.prepare(`SELECT COUNT(*) AS count
        FROM legacy_event_provenance_backfill_state
        WHERE scan_target_id IS NOT NULL
          AND (scanned_through_id IS NULL
            OR CAST(scanned_through_id AS INTEGER) < CAST(scan_target_id AS INTEGER))`)
        .get()?.count ?? 0)
    }
    clearInterval(heartbeat)
    expect(pending).toBe(0)
    expect(inspection.prepare(`SELECT COUNT(*) AS count FROM mission_events
      WHERE mission_id = ? AND (recorded_at IS NULL OR recording_completeness IS NULL)`)
      .get(mission.id)).toMatchObject({ count: 0 })
    inspection.close()
    expect(maximumHeartbeatGapMs).toBeLessThan(200)
    await expect(store.readMissionReplay({
      missionId: mission.id,
      selectedTime: '2026-08-20T10:05:00.000Z',
      timezone: 'Europe/Dublin',
      trackLimit: 100,
      objectLimit: 100,
    })).resolves.toMatchObject({
      missionId: mission.id,
      limitations: expect.arrayContaining([
        expect.objectContaining({ code: 'legacy_event_replay_scan_fallback' }),
      ]),
    })
  }, 60_000)

  it('keeps current fixes below the hard gate while byte-bounding legacy event writer turns [DON-278]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-event-bytes-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Large Legacy Event Payload Mission' })
    await first.upsertDevice({
      mission_id: mission.id,
      device_id: 'event-byte-priority',
      name: 'Current priority device',
      color: '#3b82f6',
      status: 'online',
    })
    await first.prepareClose()
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = openDatabase(databaseFile)
    const insert = legacyDb.prepare(`INSERT INTO mission_events (
      id, mission_id, event_type, timestamp, details_json, recorded_at,
      recording_completeness
    ) VALUES (?, ?, 'legacy_event', '2026-08-20T10:00:00.000Z', ?, NULL, NULL)`)
    const largeDetails = JSON.stringify({ note: 'x'.repeat(64 * 1024) })
    legacyDb.exec('BEGIN')
    try {
      for (let index = 0; index < 1_000; index += 1) {
        insert.run(`legacy-large-event-${String(index).padStart(4, '0')}`, mission.id, largeDetails)
      }
      legacyDb.exec(`
        DROP TABLE legacy_event_provenance_backfill_state;
        DROP INDEX idx_mission_events_replay;
        UPDATE metadata SET value = '11' WHERE key = 'schema_version';
        COMMIT;
      `)
    } catch (error) {
      legacyDb.exec('ROLLBACK')
      throw error
    }
    legacyDb.close()

    store = createElectronMissionStore({ userDataPath })
    let maximumCurrentWriteMs = 0
    let completed = false
    for (let index = 0; index < 1_000 && !completed; index += 1) {
      const fixTime = new Date(Date.now() + index).toISOString()
      const startedAt = performance.now()
      await store.addPosition({
        mission_id: mission.id,
        device_id: 'event-byte-priority',
        source_position_id: `event-byte-current-${index}`,
        lat: 52.1,
        lon: -9.5,
        timestamp: fixTime,
        received_at: fixTime,
        timestamp_source: 'fix',
      })
      maximumCurrentWriteMs = Math.max(maximumCurrentWriteMs, performance.now() - startedAt)
      const inspection = openDatabase(databaseFile)
      completed = inspection.prepare(`SELECT 1 FROM legacy_event_provenance_backfill_state
        WHERE scan_target_id IS NOT NULL
          AND (scanned_through_id IS NULL
            OR CAST(scanned_through_id AS INTEGER) < CAST(scan_target_id AS INTEGER))
        LIMIT 1`).get() === undefined
      inspection.close()
      if (!completed) await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(completed).toBe(true)
    expect(maximumCurrentWriteMs).toBeLessThan(200)
  }, 60_000)

  it('retains an oversized legacy event and fails evidence custody closed with explicit quarantine [DON-278]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-event-quarantine-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Oversized Legacy Event Mission' })
    await first.finishMission(mission.id)
    await first.prepareClose()
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = openDatabase(databaseFile)
    legacyDb.prepare(`INSERT INTO mission_events (
      id, mission_id, event_type, timestamp, details_json, recorded_at,
      recording_completeness
    ) VALUES ('oversized-legacy-event', ?, 'legacy_event',
      '2026-08-20T10:00:00.000Z', ?, NULL, NULL)`).run(
      mission.id,
      JSON.stringify({ note: 'x'.repeat(256 * 1024) }),
    )
    legacyDb.exec(`
      DROP TABLE legacy_event_provenance_backfill_state;
      DROP INDEX idx_mission_events_replay;
      UPDATE metadata SET value = '11' WHERE key = 'schema_version';
    `)
    legacyDb.close()

    store = createElectronMissionStore({ userDataPath })
    let quarantined = 0
    for (let attempt = 0; attempt < 1_000 && quarantined === 0; attempt += 1) {
      const inspection = openDatabase(databaseFile)
      quarantined = Number(inspection.prepare(`SELECT COUNT(*) AS count
        FROM legacy_event_provenance_quarantine`).get()?.count ?? 0)
      inspection.close()
      if (quarantined === 0) await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(quarantined).toBe(1)
    const inspection = openDatabase(databaseFile)
    expect(inspection.prepare(`SELECT length(details_json) AS details_length,
      recorded_at, recording_completeness FROM mission_events
      WHERE id = 'oversized-legacy-event'`).get()).toMatchObject({
      details_length: expect.any(Number),
      recorded_at: null,
      recording_completeness: null,
    })
    inspection.close()
    await expect(store.readMissionReplay({
      missionId: mission.id,
      selectedTime: '2026-08-20T10:05:00.000Z',
      timezone: 'Europe/Dublin',
      trackLimit: 100,
      objectLimit: 100,
    })).rejects.toThrow(/exceed.*bounded reconstruction.*Replay.*unavailable/iu)
    await expect(store.createMissionArchive(mission.id))
      .rejects.toThrow(/exceed.*bounded reconstruction.*archive.*unavailable/iu)
  })

  it('quarantines an oversized legacy event identity without retaining it in the migration cursor [DON-278]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-event-id-quarantine-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Oversized Legacy Event Identity Mission' })
    await first.finishMission(mission.id)
    await first.prepareClose()
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = openDatabase(databaseFile)
    const oversizedIdentity = `z${'x'.repeat(2 * 1024 * 1024)}`
    legacyDb.prepare(`INSERT INTO mission_events (
      id, mission_id, event_type, timestamp, details_json, recorded_at,
      recording_completeness
    ) VALUES (?, ?, 'legacy_event', '2026-08-20T10:00:00.000Z', '{}', NULL, NULL)`).run(
      oversizedIdentity,
      mission.id,
    )
    const sourceRowid = Number(legacyDb.prepare(`SELECT rowid FROM mission_events
      ORDER BY rowid DESC LIMIT 1`).get()?.rowid)
    legacyDb.exec(`
      DROP TABLE legacy_event_provenance_backfill_state;
      DROP INDEX idx_mission_events_replay;
      UPDATE metadata SET value = '11' WHERE key = 'schema_version';
    `)
    legacyDb.close()

    const openedAt = performance.now()
    store = createElectronMissionStore({ userDataPath })
    expect(performance.now() - openedAt).toBeLessThan(200)
    let quarantined = 0
    for (let attempt = 0; attempt < 1_000 && quarantined === 0; attempt += 1) {
      const inspection = openDatabase(databaseFile)
      quarantined = Number(inspection.prepare(`SELECT COUNT(*) AS count
        FROM legacy_event_provenance_quarantine`).get()?.count ?? 0)
      inspection.close()
      if (quarantined === 0) await new Promise((resolve) => setTimeout(resolve, 1))
    }

    const inspection = openDatabase(databaseFile)
    expect(inspection.prepare(`SELECT source_rowid, length(event_id_preview) AS preview_length,
      reason, payload_bytes FROM legacy_event_provenance_quarantine`).get()).toMatchObject({
      source_rowid: sourceRowid,
      preview_length: 200,
      reason: expect.stringMatching(/identity.*200-byte safe reconstruction limit/iu),
      payload_bytes: expect.any(Number),
    })
    expect(inspection.prepare(`SELECT length(id) AS id_length, recorded_at,
      recording_completeness FROM mission_events WHERE rowid = ?`).get(sourceRowid)).toMatchObject({
      id_length: oversizedIdentity.length,
      recorded_at: null,
      recording_completeness: null,
    })
    expect(inspection.prepare(`SELECT scanned_through_id, scan_target_id
      FROM legacy_event_provenance_backfill_state
      WHERE table_name = 'mission_events'`).get()).toMatchObject({
      scanned_through_id: String(sourceRowid),
      scan_target_id: String(sourceRowid),
    })
    expect(inspection.prepare(`SELECT value FROM metadata
      WHERE key = 'legacy_evidence_backfill_failure'`).get()).toBeUndefined()
    inspection.close()
  })

  it('recaptures rowid targets when a prior candidate left textual event cursors [DON-278]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-event-cursor-upgrade-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Prior Event Cursor Candidate Mission' })
    await first.finishMission(mission.id)
    await first.prepareClose()
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const candidateDb = openDatabase(databaseFile)
    candidateDb.prepare(`INSERT INTO mission_events (
      id, mission_id, event_type, timestamp, details_json, recorded_at,
      recording_completeness
    ) VALUES ('prior-candidate-event', ?, 'legacy_event',
      '2026-08-20T10:00:00.000Z', '{}', NULL, NULL)`).run(mission.id)
    candidateDb.prepare(`UPDATE legacy_event_provenance_backfill_state
      SET scanned_through_id = NULL,
          scan_target_id = 'zzzz-old-cursor-target',
          updated_at = '2026-08-20T10:00:00.000Z'
      WHERE table_name = 'mission_events'`).run()
    candidateDb.prepare(`DELETE FROM metadata
      WHERE key = 'legacy_event_provenance_cursor_format'`).run()
    candidateDb.close()

    store = createElectronMissionStore({ userDataPath })
    let incomplete = 1
    for (let attempt = 0; attempt < 1_000 && incomplete > 0; attempt += 1) {
      const inspection = openDatabase(databaseFile)
      incomplete = Number(inspection.prepare(`SELECT COUNT(*) AS count FROM mission_events
        WHERE mission_id = ?
          AND (recorded_at IS NULL OR recording_completeness IS NULL)`).get(mission.id)?.count ?? 0)
      inspection.close()
      if (incomplete > 0) await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(incomplete).toBe(0)

    const inspection = openDatabase(databaseFile)
    expect(inspection.prepare(`SELECT scanned_through_id, scan_target_id
      FROM legacy_event_provenance_backfill_state
      WHERE table_name = 'mission_events'`).get()).toMatchObject({
      scanned_through_id: expect.stringMatching(/^\d+$/u),
      scan_target_id: expect.stringMatching(/^\d+$/u),
    })
    inspection.close()
    await expect(store.createMissionArchive(mission.id)).resolves.toMatchObject({
      mission_id: mission.id,
    })
  })

  it('updates only the sparse incomplete event rows selected for one bounded turn [DON-278]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-event-sparse-turn-'))
    const databaseFile = path.join(userDataPath, 'sparse-events.sqlite')
    const db = openDatabase(databaseFile)
    db.exec(`
      CREATE TABLE mission_events (
        id TEXT NOT NULL,
        mission_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        details_json TEXT,
        recorded_at TEXT,
        recording_completeness TEXT
      );
      CREATE TABLE legacy_event_provenance_backfill_state (
        table_name TEXT PRIMARY KEY,
        scanned_through_id TEXT,
        scan_target_id TEXT,
        updated_at TEXT NOT NULL
      );
      WITH RECURSIVE complete_rows(sequence) AS (
        SELECT 1
        UNION ALL
        SELECT sequence + 1 FROM complete_rows WHERE sequence < 10000
      )
      INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json, recorded_at,
        recording_completeness
      ) SELECT printf('complete-%05d', sequence), 'mission-complete', 'legacy_event',
        '2026-08-20T10:00:00.000Z', '{}', '2026-08-20T10:00:00.000Z',
        'legacy_baseline' FROM complete_rows;
      INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json, recorded_at,
        recording_completeness
      ) VALUES ('incomplete-final', 'mission-incomplete', 'legacy_event',
        '2026-08-20T10:00:00.000Z', '{}', NULL, NULL);
      INSERT INTO legacy_event_provenance_backfill_state (
        table_name, scanned_through_id, scan_target_id, updated_at
      ) VALUES ('mission_events', NULL, '10001', '2026-08-20T10:00:00.000Z');
    `)
    const changesBefore = Number(db.prepare(
      'SELECT total_changes() AS count',
    ).get()?.count ?? 0)

    expect(backfillLegacyEventProvenance(
      db,
      '2026-08-29T02:00:00.000Z',
    )).toMatchObject({ remaining: 1 })

    const changesAfter = Number(db.prepare(
      'SELECT total_changes() AS count',
    ).get()?.count ?? 0)
    expect(changesAfter - changesBefore).toBe(1)
    expect(db.prepare(`SELECT scanned_through_id, scan_target_id
      FROM legacy_event_provenance_backfill_state
      WHERE table_name = 'mission_events'`).get()).toMatchObject({
      scanned_through_id: '1000',
      scan_target_id: '10001',
    })
    for (let turn = 0; turn < 10; turn += 1) {
      backfillLegacyEventProvenance(db, '2026-08-29T02:00:00.000Z')
    }
    expect(db.prepare(`SELECT recorded_at, recording_completeness
      FROM mission_events WHERE id = 'incomplete-final'`).get()).toMatchObject({
      recorded_at: '2026-08-29T02:00:00.000Z',
      recording_completeness: 'legacy_baseline',
    })
    db.close()
  })

  it('scopes legacy event quarantine custody fences to the affected mission [DON-278]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-event-quarantine-scope-'))
    const first = createElectronMissionStore({ userDataPath })
    const affectedMission = await first.createMission({ name: 'Affected Event Quarantine Mission' })
    await first.finishMission(affectedMission.id)
    const cleanMission = await first.createMission({ name: 'Clean Finished Mission' })
    await first.finishMission(cleanMission.id)
    const activeMission = await first.createMission({ name: 'Clean Active Mission' })
    await first.prepareClose()
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = openDatabase(databaseFile)
    legacyDb.prepare(`INSERT INTO mission_events (
      id, mission_id, event_type, timestamp, details_json, recorded_at,
      recording_completeness
    ) VALUES ('mission-scoped-oversized-event', ?, 'legacy_event',
      '2026-08-20T10:00:00.000Z', ?, NULL, NULL)`).run(
      affectedMission.id,
      JSON.stringify({ note: 'x'.repeat(280 * 1024) }),
    )
    legacyDb.exec(`
      DROP TABLE legacy_event_provenance_backfill_state;
      DROP INDEX idx_mission_events_replay;
      UPDATE metadata SET value = '11' WHERE key = 'schema_version';
    `)
    legacyDb.close()

    store = createElectronMissionStore({ userDataPath })
    let pendingOrUnquarantined = true
    for (let attempt = 0; attempt < 1_000 && pendingOrUnquarantined; attempt += 1) {
      const inspection = openDatabase(databaseFile)
      const state = inspection.prepare(`SELECT
        (SELECT COUNT(*) FROM legacy_event_provenance_backfill_state
          WHERE scan_target_id IS NOT NULL
            AND (scanned_through_id IS NULL
              OR CAST(scanned_through_id AS INTEGER) < CAST(scan_target_id AS INTEGER))) AS pending,
        (SELECT COUNT(*) FROM legacy_event_provenance_quarantine) AS quarantined`).get()
      pendingOrUnquarantined = Number(state?.pending) > 0 || Number(state?.quarantined) !== 1
      inspection.close()
      if (pendingOrUnquarantined) await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(pendingOrUnquarantined).toBe(false)

    const replayInput = {
      selectedTime: new Date().toISOString(),
      timezone: 'Europe/Dublin',
      trackLimit: 100,
      objectLimit: 100,
    }
    await expect(store.readMissionReplay({ missionId: affectedMission.id, ...replayInput }))
      .rejects.toThrow(/exceed.*bounded reconstruction.*Replay.*unavailable/iu)
    await expect(store.createMissionArchive(affectedMission.id))
      .rejects.toThrow(/exceed.*bounded reconstruction.*archive.*unavailable/iu)
    await expect(store.finalizeMission(affectedMission.id))
      .rejects.toThrow(/exceed.*bounded reconstruction.*finalization.*unavailable/iu)

    await expect(store.readMissionReplay({ missionId: cleanMission.id, ...replayInput }))
      .resolves.toMatchObject({ missionId: cleanMission.id })
    await expect(store.createMissionArchive(cleanMission.id)).resolves.toMatchObject({
      mission_id: cleanMission.id,
    })
    await expect(store.finalizeMission(cleanMission.id)).resolves.toMatchObject({
      mission: expect.objectContaining({ id: cleanMission.id, status: 'finalized' }),
    })
    await expect(store.finishMission(activeMission.id)).resolves.toMatchObject({
      id: activeMission.id,
      status: 'finished',
    })
  })

  it('keeps clean-mission custody bounded with a field-scale quarantine map [DON-278]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-event-quarantine-scale-'))
    const first = createElectronMissionStore({ userDataPath })
    const affectedMission = await first.createMission({ name: 'Scaled Quarantine Mission' })
    await first.finishMission(affectedMission.id)
    const cleanMission = await first.createMission({ name: 'Scaled Clean Mission' })
    await first.prepareClose()
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const seededDb = openDatabase(databaseFile)
    seededDb.prepare(`WITH RECURSIVE quarantine_rows(source_rowid) AS (
        SELECT 1
        UNION ALL
        SELECT source_rowid + 1 FROM quarantine_rows WHERE source_rowid < 500000
      )
      INSERT INTO legacy_event_provenance_quarantine_missions (
        mission_id, table_name, source_rowid
      ) SELECT ?, 'mission_events', source_rowid FROM quarantine_rows`).run(affectedMission.id)
    const plan = seededDb.prepare(`EXPLAIN QUERY PLAN
      SELECT 1 FROM legacy_event_provenance_quarantine_missions
      WHERE mission_id = ? LIMIT 1`).all(cleanMission.id)
    expect(plan.map((row) => String(row.detail)).join('\n')).toMatch(/PRIMARY KEY.*mission_id/iu)
    seededDb.close()

    store = createElectronMissionStore({ userDataPath })
    const startedAt = performance.now()
    await expect(store.finishMission(cleanMission.id)).resolves.toMatchObject({
      id: cleanMission.id,
      status: 'finished',
    })
    expect(performance.now() - startedAt).toBeLessThan(200)
    await expect(store.createMissionArchive(affectedMission.id))
      .rejects.toThrow(/exceed.*bounded reconstruction.*archive.*unavailable/iu)
  })

  it('fails archive and finalization closed while legacy event provenance is pending [DON-278]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-event-finalize-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Finished Legacy Event Mission' })
    await first.finishMission(mission.id)
    await first.prepareClose()
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = openDatabase(databaseFile)
    legacyDb.exec(`
      UPDATE mission_events
      SET recorded_at = NULL, recording_completeness = NULL
      WHERE mission_id = '${mission.id}';
      DROP TABLE legacy_event_provenance_backfill_state;
      DROP INDEX idx_mission_events_replay;
      UPDATE metadata SET value = '11' WHERE key = 'schema_version';
    `)
    legacyDb.close()
    store = createElectronMissionStore({
      userDataPath,
      startLegacyEvidenceBackfillWorker: () => ({
        completion: new Promise(() => undefined),
        terminate: async () => undefined,
      }),
    })

    await expect(store.createMissionArchive(mission.id))
      .rejects.toThrow(/event provenance.*background|reconstructed/iu)
    await expect(store.finalizeMission(mission.id))
      .rejects.toThrow(/event provenance.*background|reconstructed/iu)
    await expect(store.getMission(mission.id)).resolves.toMatchObject({ status: 'finished' })

    await store.prepareClose()
    store.close()
    store = null
    const loggedFailure = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    store = createElectronMissionStore({
      userDataPath,
      startLegacyEvidenceBackfillWorker: () => ({
        completion: Promise.reject(new Error('injected event worker failure')),
        terminate: async () => undefined,
      }),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(store.createMissionArchive(mission.id))
      .rejects.toThrow(/reconstruction stopped safely.*injected event worker failure/iu)
    await expect(store.finalizeMission(mission.id))
      .rejects.toThrow(/reconstruction stopped safely.*injected event worker failure/iu)
    loggedFailure.mockRestore()
  })

  it('migrates an authentic v11 GPX table before creating v12 indexes and retains a static baseline [DON-274]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-real-v11-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Authentic v11 GPX Mission' })
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const db = openDatabase(databaseFile)
    const legacyGeometry = JSON.stringify({
      type: 'MultiLineString',
      coordinates: [
        Array.from({ length: 5_000 }, (_, index) => [-9.7 - index / 100_000, 52 + index / 100_000]),
        [[-9.8, 52], [-9.8, 95], [-9.9, 52.2, 'unknown']],
        'not-a-segment',
        [[-9.8, 52.3]],
      ],
    })
    const malformedGeometry = '{"type":"MultiLineString","coordinates":['
    const oversizedGeometry = JSON.stringify({
      type: 'MultiLineString',
      coordinates: [Array.from({ length: 20_000 }, (_, index) => [-9.7, 52 + index / 1_000_000])],
    })
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
      UPDATE metadata SET value = '11' WHERE key = 'schema_version';
      PRAGMA foreign_keys = ON;
    `)
    db.prepare(`INSERT INTO gpx_track_imports VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?
    )`).run(
      'legacy-gpx', mission.id, '/legacy/route.gpx', 'route.gpx', 'Legacy route',
      legacyGeometry, '{}', '2026-08-20T10:00:00Z', '2026-08-20T10:00:00Z',
    )
    db.prepare(`INSERT INTO gpx_track_imports VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?
    )`).run(
      'legacy-malformed', mission.id, '/legacy/malformed.gpx', 'malformed.gpx', 'Malformed route',
      malformedGeometry, '{}', '2026-08-20T10:00:01Z', '2026-08-20T10:00:01Z',
    )
    db.prepare(`INSERT INTO gpx_track_imports VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?
    )`).run(
      'legacy-oversized', mission.id, '/legacy/oversized.gpx', 'oversized.gpx', 'Oversized route',
      oversizedGeometry, '{}', '2026-08-20T10:00:02Z', '2026-08-20T10:00:02Z',
    )
    db.close()

    store = createElectronMissionStore({ userDataPath })
    await expect(store.info()).resolves.toMatchObject({ schema_version: 12 })
    const migratedDb = openDatabase(databaseFile)
    expect(migratedDb.prepare(`SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_positions_replay_known_fix'`).get()).toBeUndefined()
    migratedDb.close()
    let migratedRevisionCount = 0
    for (let attempt = 0; attempt < 100 && migratedRevisionCount < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      const inspection = openDatabase(databaseFile)
      migratedRevisionCount = Number(inspection.prepare(
        'SELECT COUNT(*) AS count FROM gpx_import_revisions',
      ).get()?.count ?? 0)
      inspection.close()
    }
    expect(migratedRevisionCount).toBe(2)
    const revisions = await store.listGpxImportRevisions('legacy-gpx')
    expect(revisions).toEqual([
      expect.objectContaining({ completeness: 'legacy_baseline', revision_sequence: 1 }),
    ])
    const retainedDb = openDatabase(databaseFile)
    expect(retainedDb.prepare(`SELECT geometry_json FROM gpx_import_revisions
      WHERE import_id = 'legacy-gpx' AND revision_sequence = 1`).get())
      .toMatchObject({ geometry_json: legacyGeometry })
    expect(retainedDb.prepare(`SELECT geometry_json FROM gpx_import_revisions
      WHERE import_id = 'legacy-malformed' AND revision_sequence = 1`).get())
      .toMatchObject({ geometry_json: malformedGeometry })
    expect(retainedDb.prepare(`SELECT reason FROM gpx_evidence_rejections
      WHERE import_id = 'legacy-malformed'`).get())
      .toMatchObject({ reason: expect.stringMatching(/legacy geometry.*retained/i) })
    expect(retainedDb.prepare(`SELECT COUNT(*) AS count FROM gpx_import_revisions
      WHERE import_id = 'legacy-oversized'`).get()).toMatchObject({ count: 0 })
    expect(retainedDb.prepare(`SELECT quarantine.reason
      FROM legacy_gpx_backfill_quarantine AS quarantine
      JOIN gpx_track_imports AS imports ON imports.rowid = quarantine.source_rowid
      WHERE imports.id = 'legacy-oversized'`).get())
      .toMatchObject({ reason: 'legacy_geometry_over_byte_envelope' })
    expect(retainedDb.prepare(`SELECT geometry_json FROM gpx_track_imports
      WHERE id = 'legacy-oversized'`).get()).toMatchObject({ geometry_json: oversizedGeometry })
    expect(retainedDb.prepare(`SELECT kind, segment_index, point_index, reason FROM gpx_evidence_rejections
      WHERE import_id = 'legacy-gpx' ORDER BY segment_index, point_index, reason`).all())
      .toEqual([
        { kind: 'point', segment_index: 1, point_index: 1, reason: 'invalid_coordinates' },
        { kind: 'point', segment_index: 1, point_index: 2, reason: 'invalid_elevation' },
        { kind: 'segment', segment_index: 2, point_index: null, reason: 'invalid_segment' },
        { kind: 'segment', segment_index: 3, point_index: null, reason: 'insufficient_segment_points' },
      ])
    expect(JSON.parse(String(retainedDb.prepare(`SELECT geometry_json FROM gpx_track_imports
      WHERE id = 'legacy-gpx'`).get()?.geometry_json))).toMatchObject({
      type: 'MultiLineString',
      coordinates: expect.arrayContaining([
        [[-9.8, 52], [-9.9, 52.2]],
      ]),
    })
    expect(retainedDb.prepare(`SELECT COUNT(*) AS count FROM gpx_evidence_points
      WHERE import_id = 'legacy-oversized'`).get()).toMatchObject({ count: 0 })
    retainedDb.close()
    const replay = await store.readMissionReplay({
      missionId: mission.id,
      selectedTime: new Date().toISOString(),
      timezone: 'Europe/Dublin',
      trackLimit: 100,
    })
    expect(replay).toMatchObject({
      staticGpxPointCount: 5_003,
      staticGpxEvidence: expect.arrayContaining([
        expect.objectContaining({ import_id: 'legacy-malformed', static_point_count: 0, rejection_count: 1 }),
        expect.objectContaining({ import_id: 'legacy-gpx', static_point_count: 5_003, rejection_count: 4 }),
      ]),
      limitations: expect.arrayContaining([
        expect.objectContaining({ code: 'legacy_gpx_baseline_only' }),
        expect.objectContaining({ code: 'legacy_gpx_backfill_quarantined', count: 1 }),
        expect.objectContaining({ code: 'legacy_replay_scan_fallback' }),
      ]),
    })
    expect((replay as { staticGpxEvidence: readonly { import_id: string }[] }).staticGpxEvidence
      .some((entry) => entry.import_id === 'legacy-oversized')).toBe(false)
  })

  it('bounds legacy GPX startup work and resumes every retained import without silent loss [DON-274]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-bounded-gpx-migration-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Bounded Legacy GPX Migration' })
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = openDatabase(databaseFile)
    legacyDb.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE gpx_evidence_rejections;
      DROP TABLE gpx_evidence_points;
      DROP TABLE gpx_import_revisions;
      DROP TABLE gpx_import_aliases;
      DROP INDEX IF EXISTS idx_gpx_import_content;
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
      UPDATE metadata SET value = '11' WHERE key = 'schema_version';
      PRAGMA foreign_keys = ON;
    `)
    const geometry = JSON.stringify({
      type: 'MultiLineString',
      coordinates: [Array.from({ length: 200 }, (_, index) => [-9.7, 52 + index / 100_000])],
    })
    const insert = legacyDb.prepare(`INSERT INTO gpx_track_imports VALUES (
      ?, ?, ?, ?, ?, ?, '{}', ?, ?
    )`)
    for (let index = 0; index < 12; index += 1) {
      const timestamp = `2026-08-20T10:00:${String(index).padStart(2, '0')}Z`
      insert.run(
        `legacy-${String(index).padStart(2, '0')}`, mission.id, `/legacy/${index}.gpx`,
        `${index}.gpx`, `Legacy ${index}`, geometry, timestamp, timestamp,
      )
    }
    legacyDb.close()

    store = createElectronMissionStore({ userDataPath })
    let inspection = openDatabase(databaseFile)
    const firstStartupCount = Number(inspection.prepare(
      'SELECT COUNT(*) AS count FROM gpx_import_revisions',
    ).get()?.count ?? 0)
    inspection.close()
    expect(firstStartupCount).toBe(0)
    for (let attempt = 0; attempt < 100; attempt += 1) {
      inspection = openDatabase(databaseFile)
      const eventPending = inspection.prepare(`SELECT 1
        FROM legacy_event_provenance_backfill_state
        WHERE scan_target_id IS NOT NULL
          AND (scanned_through_id IS NULL
            OR CAST(scanned_through_id AS INTEGER) < CAST(scan_target_id AS INTEGER))
        LIMIT 1`).get()
      inspection.close()
      if (eventPending === undefined) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await expect(store.readMissionReplay({
      missionId: mission.id,
      selectedTime: new Date().toISOString(),
      timezone: 'Europe/Dublin',
      trackLimit: 100,
    })).resolves.toMatchObject({
      limitations: expect.arrayContaining([
        expect.objectContaining({ code: 'legacy_gpx_backfill_pending', count: expect.any(Number) }),
      ]),
    })
    await expect(store.finishMission(mission.id)).rejects.toThrow(/legacy GPX.*pending|unsettled/iu)

    await store.prepareClose()
    store.close()
    store = createElectronMissionStore({ userDataPath })
    let migratedCount = 0
    for (let attempt = 0; attempt < 100 && migratedCount < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      inspection = openDatabase(databaseFile)
      migratedCount = Number(inspection.prepare(
        'SELECT COUNT(*) AS count FROM gpx_import_revisions',
      ).get()?.count ?? 0)
      inspection.close()
    }
    expect(migratedCount).toBe(12)
    inspection = openDatabase(databaseFile)
    expect(inspection.prepare('SELECT COUNT(*) AS count FROM gpx_evidence_points').get())
      .toMatchObject({ count: 2_400 })
    inspection.close()
    await expect(store.finishMission(mission.id)).resolves.toMatchObject({ status: 'finished' })
  })

  it('seeks legacy GPX reconstruction from a durable cursor instead of rescanning settled rows [DON-274]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-gpx-cursor-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Settled Legacy GPX Cursor' })
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const settledDb = openDatabase(databaseFile)
    settledDb.exec(`
      PRAGMA synchronous = OFF;
      WITH digits(d) AS (
        VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)
      ), numbers(n) AS (
        SELECT a.d + b.d * 10 + c.d * 100 + d.d * 1000 + e.d * 10000 + f.d * 100000
        FROM digits AS a, digits AS b, digits AS c, digits AS d, digits AS e, digits AS f
      )
      INSERT INTO gpx_track_imports (
        id, mission_id, source_path, file_name, display_name, geometry_json,
        metadata_json, imported_at, updated_at
      )
      SELECT printf('settled-%06d', n), '${mission.id}', printf('/legacy/%06d.gpx', n),
        printf('%06d.gpx', n), printf('Settled %06d', n),
        '{"type":"MultiLineString","coordinates":[]}', '{}',
        '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z'
      FROM numbers WHERE n < 500000;
      INSERT INTO gpx_import_revisions (
        id, mission_id, import_id, revision_sequence, source_revision_sequence, content_sha256,
        source_bytes_base64, source_path, file_name, display_name, geometry_json,
        metadata_json, timing_class, import_state, completeness, recorded_at, audit_event_id
      )
      SELECT 'revision-' || id, mission_id, id, 1, 1, NULL, NULL, source_path,
        file_name, display_name, geometry_json, metadata_json, 'undated', 'complete',
        'legacy_baseline', updated_at, NULL
      FROM gpx_track_imports WHERE mission_id = '${mission.id}';
    `)
    settledDb.close()

    const openedAt = performance.now()
    store = createElectronMissionStore({ userDataPath })
    const openMs = performance.now() - openedAt
    expect(openMs).toBeLessThan(200)
    let lastHeartbeat = performance.now()
    let maximumHeartbeatGapMs = 0
    const heartbeat = setInterval(() => {
      const current = performance.now()
      maximumHeartbeatGapMs = Math.max(maximumHeartbeatGapMs, current - lastHeartbeat)
      lastHeartbeat = current
    }, 10)
    const inspection = openDatabase(databaseFile)
    let scannedThroughRowid = 0
    for (let attempt = 0; attempt < 500 && scannedThroughRowid < 500_000; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      scannedThroughRowid = Number(inspection.prepare(`SELECT scanned_through_rowid
        FROM legacy_gpx_backfill_state WHERE singleton = 1`).get()?.scanned_through_rowid ?? 0)
    }
    clearInterval(heartbeat)
    expect(maximumHeartbeatGapMs).toBeLessThan(200)
    expect(inspection.prepare(`SELECT scanned_through_rowid, scan_target_rowid
      FROM legacy_gpx_backfill_state WHERE singleton = 1`).get())
      .toMatchObject({ scanned_through_rowid: 500_000, scan_target_rowid: 500_000 })
    inspection.close()
    await expect(store.finishMission(mission.id)).resolves.toMatchObject({ status: 'finished' })
  }, 30_000)

  it('settles every signed rowid boundary as an immutable revision or explicit quarantine [DON-274]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-gpx-rowid-envelope-'))
    const first = createElectronMissionStore({ userDataPath })
    const finishedMission = await first.createMission({ name: 'Rowid Envelope Finished Mission' })
    await first.finishMission(finishedMission.id)
    const runningMission = await first.createMission({ name: 'Rowid Envelope Running Mission' })
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = openDatabase(databaseFile)
    const geometry = '{"type":"MultiLineString","coordinates":[]}'
    const timestamp = '2026-08-20T10:00:00.000Z'
    legacyDb.exec(`
      INSERT INTO gpx_track_imports (
        rowid, id, mission_id, source_path, file_name, display_name, geometry_json,
        metadata_json, imported_at, updated_at
      ) VALUES
        (-1, 'rowid-negative', '${runningMission.id}', '/legacy/negative.gpx',
          'negative.gpx', 'Negative rowid', '${geometry}', '{}', '${timestamp}', '${timestamp}'),
        (0, 'rowid-zero', '${runningMission.id}', '/legacy/zero.gpx',
          'zero.gpx', 'Zero rowid', '${geometry}', '{}', '${timestamp}', '${timestamp}'),
        (9007199254740991, 'rowid-max-safe', '${runningMission.id}', '/legacy/max-safe.gpx',
          'max-safe.gpx', 'Maximum safe rowid', '${geometry}', '{}', '${timestamp}', '${timestamp}'),
        (9007199254740992, 'rowid-first-unsafe', '${finishedMission.id}', '/legacy/first-unsafe.gpx',
          'first-unsafe.gpx', 'First unsafe rowid', '${geometry}', '{}', '${timestamp}', '${timestamp}'),
        (9007199254740993, 'rowid-next-unsafe', '${finishedMission.id}', '/legacy/next-unsafe.gpx',
          'next-unsafe.gpx', 'Next unsafe rowid', '${geometry}', '{}', '${timestamp}', '${timestamp}');
    `)
    legacyDb.close()

    store = createElectronMissionStore({ userDataPath })
    let settled = false
    for (let attempt = 0; attempt < 100 && !settled; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      const inspection = openDatabase(databaseFile)
      const counts = inspection.prepare(`SELECT
        (SELECT COUNT(*) FROM gpx_import_revisions WHERE import_id = 'rowid-max-safe')
          AS revisions,
        (SELECT COUNT(*) FROM legacy_gpx_backfill_quarantine) AS quarantines`).get()
      inspection.close()
      settled = Number(counts?.revisions) === 1 && Number(counts?.quarantines) === 4
    }
    expect(settled).toBe(true)
    const inspection = openDatabase(databaseFile)
    expect(inspection.prepare(`SELECT imports.id, quarantine.reason
      FROM legacy_gpx_backfill_quarantine AS quarantine
      JOIN gpx_track_imports AS imports ON imports.rowid = quarantine.source_rowid
      ORDER BY imports.id`).all()).toEqual([
      { id: 'rowid-first-unsafe', reason: 'legacy_rowid_outside_safe_envelope' },
      { id: 'rowid-negative', reason: 'legacy_rowid_outside_safe_envelope' },
      { id: 'rowid-next-unsafe', reason: 'legacy_rowid_outside_safe_envelope' },
      { id: 'rowid-zero', reason: 'legacy_rowid_outside_safe_envelope' },
    ])
    expect(inspection.prepare(`SELECT
        safe.scanned_through_rowid = safe.scan_target_rowid AS safe_complete,
        unsafe.low_scanned_through_rowid = unsafe.low_target_rowid AS low_complete,
        unsafe.high_scanned_through_rowid = unsafe.high_target_rowid AS high_complete
      FROM legacy_gpx_backfill_state AS safe
      JOIN legacy_gpx_rowid_scan_state AS unsafe ON unsafe.singleton = safe.singleton`).get())
      .toMatchObject({ safe_complete: 1, low_complete: 1, high_complete: 1 })
    inspection.close()
    await expect(store.listGpxImportIssues({ missionId: finishedMission.id, limit: 10 }))
      .resolves.toMatchObject({
        entries: [
          expect.objectContaining({ id: 'quarantine:9007199254740993' }),
          expect.objectContaining({ id: 'quarantine:9007199254740992' }),
        ],
      })
    await expect(store.listGpxImportIssues({ missionId: runningMission.id, limit: 10 }))
      .resolves.toMatchObject({
        entries: [
          expect.objectContaining({ id: 'quarantine:0' }),
          expect.objectContaining({ id: 'quarantine:-1' }),
        ],
      })
    await expect(store.finishMission(runningMission.id)).rejects.toThrow(
      /legacy GPX.*quarantin|unsettled/iu,
    )
    await expect(store.createMissionArchive(finishedMission.id)).rejects.toThrow(
      /legacy GPX.*quarantin|unsettled/iu,
    )
  })

  it('quarantines over-envelope legacy GPX without materializing it into renderer evidence [DON-274]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-gpx-quarantine-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Oversized Legacy GPX Quarantine' })
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = openDatabase(databaseFile)
    const originalGeometry = JSON.stringify({
      type: 'MultiLineString',
      coordinates: [],
      retainedLegacyPayload: 'x'.repeat(256 * 1024),
    })
    legacyDb.prepare(`INSERT INTO gpx_track_imports (
      id, mission_id, source_path, file_name, display_name, geometry_json,
      metadata_json, imported_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
      'legacy-over-envelope', mission.id, '/legacy/oversized.gpx', 'oversized.gpx',
      'Oversized legacy evidence', originalGeometry,
      '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z',
    )
    legacyDb.close()

    const openedAt = performance.now()
    store = createElectronMissionStore({ userDataPath })
    expect(performance.now() - openedAt).toBeLessThan(200)
    await expect(store.listGpxImports(mission.id)).resolves.toEqual([])
    await expect(store.listGpxImportPage({ missionId: mission.id, limit: 10 }))
      .resolves.toEqual({ entries: [], nextCursor: null })
    await expect(store.listGpxImportIssues({ missionId: mission.id, limit: 10 }))
      .resolves.toMatchObject({
        entries: [expect.objectContaining({
          file_name: 'legacy-over-envelope',
          source_retained: true,
          reason: expect.stringMatching(/quarantined.*safe reconstruction envelope/iu),
        })],
      })
    await expect(store.readMissionReplay({
      missionId: mission.id,
      selectedTime: new Date().toISOString(),
      timezone: 'Europe/Dublin',
      trackLimit: 100,
    })).resolves.toMatchObject({
      limitations: expect.arrayContaining([
        expect.objectContaining({ code: 'legacy_gpx_backfill_quarantined', count: 1 }),
      ]),
    })

    let inspection = openDatabase(databaseFile)
    expect(inspection.prepare(`SELECT quarantine.reason, quarantine.geometry_bytes
      FROM legacy_gpx_backfill_quarantine AS quarantine
      JOIN gpx_track_imports AS imports ON imports.rowid = quarantine.source_rowid
      WHERE imports.id = ?`)
      .get('legacy-over-envelope')).toMatchObject({
      reason: 'legacy_geometry_over_byte_envelope',
      geometry_bytes: Buffer.byteLength(originalGeometry, 'utf8'),
    })
    expect(inspection.prepare(`SELECT length(CAST(geometry_json AS BLOB)) AS geometry_bytes,
      substr(geometry_json, 1, 54) AS geometry_prefix
      FROM gpx_track_imports WHERE id = ?`).get('legacy-over-envelope')).toMatchObject({
      geometry_bytes: Buffer.byteLength(originalGeometry, 'utf8'),
      geometry_prefix: originalGeometry.slice(0, 54),
    })
    expect(inspection.prepare('SELECT COUNT(*) AS count FROM gpx_import_revisions WHERE import_id = ?')
      .get('legacy-over-envelope')).toMatchObject({ count: 0 })
    inspection.close()
    await expect(store.upsertGpxImport({
      id: 'legacy-over-envelope',
      mission_id: mission.id,
      source_path: '/legacy/oversized.gpx',
      file_name: 'replacement.gpx',
      display_name: 'Unsafe replacement',
      geometry_json: '{"type":"MultiLineString","coordinates":[]}',
    })).rejects.toThrow(/revisionless legacy.*quarantine repair/iu)
    await expect(store.finishMission(mission.id)).rejects.toThrow(/legacy GPX.*quarantin|unsettled/iu)

    store.close()
    store = createElectronMissionStore({ userDataPath })
    inspection = openDatabase(databaseFile)
    expect(inspection.prepare('SELECT COUNT(*) AS count FROM legacy_gpx_backfill_quarantine')
      .get()).toMatchObject({ count: 1 })
    expect(inspection.prepare(`SELECT length(CAST(geometry_json AS BLOB)) AS geometry_bytes,
      substr(geometry_json, 1, 54) AS geometry_prefix
      FROM gpx_track_imports WHERE id = ?`).get('legacy-over-envelope')).toMatchObject({
      geometry_bytes: Buffer.byteLength(originalGeometry, 'utf8'),
      geometry_prefix: originalGeometry.slice(0, 54),
    })
    inspection.close()
  })

  it('fences revisionless legacy GPX before background classification can overwrite it [DON-274]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-gpx-pending-fence-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Pending Legacy GPX Fence' })
    const outing = await first.createOuting({ mission_id: mission.id, label: 'Legacy outing' })
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = openDatabase(databaseFile)
    const insert = legacyDb.prepare(`INSERT INTO gpx_track_imports (
      id, mission_id, source_path, file_name, display_name, geometry_json,
      metadata_json, content_sha256, imported_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`)
    for (let index = 0; index < 3; index += 1) {
      insert.run(
        `legacy-prefix-${index}`, mission.id, `/legacy/prefix-${index}.gpx`,
        `prefix-${index}.gpx`, `Legacy prefix ${index}`,
        '{"type":"MultiLineString","coordinates":[]}', null,
        '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z',
      )
    }
    const originalGeometry = JSON.stringify({
      type: 'MultiLineString',
      coordinates: [],
      retainedLegacyPayload: 'x'.repeat(256 * 1024),
    })
    const retainedBytes = 'PGdweD5wZW5kaW5nLWxlZ2FjeTwvZ3B4Pg=='
    const retainedHash = digestBase64(retainedBytes)
    insert.run(
      'legacy-pending-target', mission.id, '/legacy/pending-target.gpx',
      'pending-target.gpx', 'Pending legacy target', originalGeometry, retainedHash,
      '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z',
    )
    legacyDb.close()

    store = createElectronMissionStore({ userDataPath })
    const replacementBytes = 'PGdweD5yZXBsYWNlbWVudC1wZW5kaW5nLWxlZ2FjeTwvZ3B4Pg=='
    await expect(store.upsertGpxImport(gpxInput(mission.id, {
      id: 'legacy-pending-target',
      source_path: '/legacy/pending-target.gpx',
      source_bytes_base64: replacementBytes,
      content_sha256: digestBase64(replacementBytes),
    }))).rejects.toThrow(/legacy GPX.*reconstruction|revisionless.*legacy/iu)
    await expect(store.upsertGpxImport(gpxInput(mission.id, {
      source_path: '/legacy/pending-target.gpx',
      source_bytes_base64: replacementBytes,
      content_sha256: digestBase64(replacementBytes),
    }))).rejects.toThrow(/revisionless legacy/iu)
    await expect(store.updateGpxImportPresentation({
      id: 'legacy-pending-target',
      mission_id: mission.id,
      metadata_json: '{"color":"#F032E6"}',
    })).rejects.toThrow(/revisionless legacy/iu)
    await expect(store.assignGpxImportToOuting({
      import_id: 'legacy-pending-target',
      outing_id: outing.id,
      assigned_by: 'Coordinator One',
    })).rejects.toThrow(/revisionless legacy/iu)
    await expect(store.deleteGpxImport('legacy-pending-target'))
      .rejects.toThrow(/revisionless legacy/iu)

    const separate = await store.upsertGpxImport(gpxInput(mission.id, {
      source_path: '/field/same-hash-new-path.gpx',
      file_name: 'same-hash-new-path.gpx',
      source_bytes_base64: retainedBytes,
      content_sha256: retainedHash,
    }))
    expect(separate.id).not.toBe('legacy-pending-target')
    const inspection = openDatabase(databaseFile)
    expect(inspection.prepare(`SELECT length(CAST(geometry_json AS BLOB)) AS geometry_bytes,
      substr(geometry_json, 1, 54) AS geometry_prefix
      FROM gpx_track_imports WHERE id = ?`).get('legacy-pending-target')).toMatchObject({
      geometry_bytes: Buffer.byteLength(originalGeometry, 'utf8'),
      geometry_prefix: originalGeometry.slice(0, 54),
    })
    expect(inspection.prepare('SELECT COUNT(*) AS count FROM gpx_import_revisions WHERE import_id = ?')
      .get('legacy-pending-target')).toMatchObject({ count: 0 })
    expect(inspection.prepare(`SELECT COUNT(*) AS count FROM gpx_import_aliases
      WHERE import_id = 'legacy-pending-target' AND source_path = '/field/same-hash-new-path.gpx'`)
      .get()).toMatchObject({ count: 0 })
    inspection.close()
  })

  it('blocks direct archive custody while legacy GPX quarantine is unsettled [DON-274]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-gpx-archive-fence-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Legacy GPX Archive Fence' })
    await first.finishMission(mission.id)
    first.close()
    const databaseFile = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = openDatabase(databaseFile)
    legacyDb.prepare(`INSERT INTO gpx_track_imports (
      id, mission_id, source_path, file_name, display_name, geometry_json,
      metadata_json, imported_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
      'legacy-archive-quarantine', mission.id, '/legacy/archive-oversized.gpx',
      'archive-oversized.gpx', 'Archive oversized legacy evidence',
      JSON.stringify({
        type: 'MultiLineString',
        coordinates: [],
        retainedLegacyPayload: 'x'.repeat(256 * 1024),
      }),
      '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z',
    )
    legacyDb.close()

    store = createElectronMissionStore({ userDataPath })
    await expect(store.createMissionArchive(mission.id)).rejects.toThrow(
      /legacy GPX.*quarantin|unsettled/iu,
    )
    const inspection = openDatabase(databaseFile)
    expect(inspection.prepare('SELECT COUNT(*) AS count FROM legacy_gpx_backfill_quarantine')
      .get()).toMatchObject({ count: 1 })
    expect(inspection.prepare('SELECT COUNT(*) AS count FROM gpx_import_revisions WHERE import_id = ?')
      .get('legacy-archive-quarantine')).toMatchObject({ count: 0 })
    inspection.close()
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

  it('rolls restart receipt settlement back if batch accounting cannot commit [DON-278]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Atomic Restart Receipt Mission' })
    const sourceBytesBase64 = 'PGdweD5yZXN0YXJ0LWF0b21pYzwvZ3B4Pg=='
    const contentSha256 = digestBase64(sourceBytesBase64)
    await store.upsertGpxImport(gpxInput(mission.id, {
      source_path: '/field/restart-atomic.gpx',
      file_name: 'restart-atomic.gpx',
      content_sha256: contentSha256,
      source_bytes_base64: sourceBytesBase64,
    }))
    const databaseFile = await databasePath()
    const seeded = openDatabase(databaseFile)
    startGpxImportBatch(seeded, {
      batchId: 'restart-atomic-batch', missionId: mission.id, totalFiles: 1,
    })
    recordGpxImportSourceReceipt(seeded, {
      batchId: 'restart-atomic-batch',
      missionId: mission.id,
      sourcePath: '/field/restart-atomic.gpx',
      fileName: 'restart-atomic.gpx',
    })
    retainGpxImportSourceBytes(seeded, {
      batchId: 'restart-atomic-batch',
      missionId: mission.id,
      sourcePath: '/field/restart-atomic.gpx',
      contentSha256,
      sourceBytesBase64,
    })
    seeded.close()
    store.close()
    store = createElectronMissionStore({
      userDataPath: userDataPath!,
      gpxReceiptRecoveryFaultInjection: { afterReceiptSettlement: true },
    })

    const inspection = openDatabase(databaseFile)
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const failure = inspection.prepare(`SELECT value FROM metadata
        WHERE key = 'gpx_receipt_recovery_failure'`).get()
      if (failure !== undefined) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(inspection.prepare(`SELECT status, source_bytes_base64
      FROM gpx_import_source_receipts WHERE batch_id = ?`)
      .get('restart-atomic-batch')).toMatchObject({
      status: 'retained', source_bytes_base64: sourceBytesBase64,
    })
    expect(inspection.prepare(`SELECT status, completed_files, failed_files
      FROM gpx_import_batches WHERE id = ?`).get('restart-atomic-batch')).toMatchObject({
      status: 'interrupted', completed_files: 0, failed_files: 0,
    })
    inspection.close()

    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })
    const recovered = openDatabase(databaseFile)
    await waitForGpxReceiptRecovery(recovered, 'restart-atomic-batch')
    expect(recovered.prepare(`SELECT status FROM gpx_import_source_receipts
      WHERE batch_id = ?`).get('restart-atomic-batch')).toMatchObject({ status: 'settled' })
    expect(recovered.prepare(`SELECT status, completed_files, failed_files
      FROM gpx_import_batches WHERE id = ?`).get('restart-atomic-batch')).toMatchObject({
      status: 'completed', completed_files: 1, failed_files: 0,
    })
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
    await waitForGpxReceiptRecovery(recovered, 'retired-evidence-batch')
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
    await waitForGpxReceiptRecovery(recovered, 'superseded-evidence-batch')
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
    await waitForGpxReceiptRecovery(recovered, 'legacy-baseline-reimport-batch')
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
    await waitForGpxReceiptRecovery(recoveredDb, 'receipt-batch')
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

  it('recovers a large interrupted receipt queue in bounded background turns [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Bounded GPX Receipt Recovery Mission' })
    const newImportPath = path.join(userDataPath!, 'blocked-during-recovery.gpx')
    await writeFile(
      newImportPath,
      '<gpx version="1.1"><trk><trkseg><trkpt lat="52" lon="-9.7"/></trkseg></trk></gpx>',
    )
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'receipt-recovery-current',
      name: 'Receipt recovery current device',
      color: '#38bdf8',
      status: 'online',
    })
    const databaseFile = await databasePath()
    const receiptDb = openDatabase(databaseFile)
    startGpxImportBatch(receiptDb, {
      batchId: 'large-receipt-recovery-batch',
      missionId: mission.id,
      totalFiles: 5_000,
    })
    receiptDb.exec(`
      WITH RECURSIVE receipts(n) AS (
        VALUES (0) UNION ALL SELECT n + 1 FROM receipts WHERE n < 4999
      )
      INSERT INTO gpx_import_source_receipts (
        batch_id, mission_id, source_path, file_name, status,
        content_sha256, source_bytes_base64, created_at, updated_at
      ) SELECT 'large-receipt-recovery-batch', '${mission.id}',
        printf('/field/interrupted-%05d.gpx', n),
        printf('interrupted-%05d.gpx', n), 'pending', NULL, NULL,
        '2026-08-28T12:00:00.000Z', '2026-08-28T12:00:00.000Z'
      FROM receipts;
    `)
    receiptDb.close()
    store.close()
    store = null

    const openedAt = performance.now()
    store = createElectronMissionStore({ userDataPath: userDataPath! })
    expect(performance.now() - openedAt).toBeLessThan(200)
    const replayWhileRecovering = store.readMissionReplay({
      missionId: mission.id,
      selectedTime: '2026-08-28T12:05:00.000Z',
      timezone: 'Europe/Dublin',
      trackLimit: 100,
      objectLimit: 100,
    })
    const importWhileRecovering = store.importGpxEvidencePaths({
      missionId: mission.id,
      paths: [newImportPath],
    })
    await expect(importWhileRecovering).rejects.toThrow(/still being recovered/iu)
    await expect(replayWhileRecovering).rejects.toThrow(/unsettled/iu)
    const currentWriteStarted = performance.now()
    await store.addPosition({
      mission_id: mission.id,
      device_id: 'receipt-recovery-current',
      source_position_id: 'current-during-receipt-recovery',
      lat: 52,
      lon: -9.7,
      timestamp: new Date().toISOString(),
      timestamp_source: 'fix',
    })
    expect(performance.now() - currentWriteStarted).toBeLessThan(200)

    const inspection = openDatabase(databaseFile)
    let failureCount = 0
    for (let attempt = 0; attempt < 1_000 && failureCount < 5_000; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      failureCount = Number(inspection.prepare(`SELECT COUNT(*) AS count
        FROM gpx_import_failures WHERE batch_id = ?`)
        .get('large-receipt-recovery-batch')?.count ?? 0)
    }
    expect(failureCount).toBe(5_000)
    expect(inspection.prepare(`SELECT status, failed_files FROM gpx_import_batches
      WHERE id = ?`).get('large-receipt-recovery-batch'))
      .toMatchObject({ status: 'interrupted', failed_files: 5_000 })
    inspection.close()
  }, 15_000)

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

  it('rejects same-hash evidence mutations instead of splitting projection from its revision [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'GPX Same Hash Mission' })
    const first = await store.upsertGpxImport(gpxInput(mission.id, {}))

    await expect(store.upsertGpxImport(gpxInput(mission.id, {
      id: first.id,
      display_name: 'Different derived route',
      geometry_json: '{"type":"MultiLineString","coordinates":[[[-8,53]]]}',
      timing_class: 'undated',
      points: [{
        segment_index: 0, point_index: 0, track_name: 'Different',
        lat: 53, lon: -8, elevation: null, timestamp: null,
      }],
    }))).rejects.toThrow(/same retained GPX bytes.*evidence fields/i)

    const db = openDatabase(await databasePath())
    const projection = db.prepare(`SELECT display_name, geometry_json, timing_class,
      revision_sequence FROM gpx_track_imports WHERE id = ?`).get(first.id)
    const revision = db.prepare(`SELECT display_name, geometry_json, timing_class,
      revision_sequence FROM gpx_import_revisions WHERE import_id = ?`).get(first.id)
    expect(projection).toMatchObject(revision ?? {})
    expect(projection).toMatchObject({ display_name: 'Route', timing_class: 'fully_dated', revision_sequence: 1 })
    db.close()
  })

  it('compares every parsed row before accepting a chunked same-hash retry or alias [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Chunked Same Hash Mission' })
    const db = openDatabase(await databasePath())
    const points = Array.from({ length: 30 }, (_, pointIndex) => ({
      segment_index: 0,
      point_index: pointIndex,
      track_name: 'Route',
      lat: 52 + pointIndex / 100_000,
      lon: -9.7,
      elevation: 100,
      timestamp: '2026-08-27T08:00:00Z',
    }))
    const rejections = [{
      kind: 'point', segment_index: 0, point_index: 31,
      reason: 'invalid_elevation', source_value: 'unknown',
    }]
    const retained = await upsertGpxEvidenceChunked(
      db,
      gpxInput(mission.id, { points, rejections }),
      5,
    )

    await expect(upsertGpxEvidenceChunked(db, gpxInput(mission.id, {
      id: retained.id,
      points: points.map((point, index) => index === 29 ? { ...point, elevation: 999 } : point),
      rejections,
    }), 5)).rejects.toThrow(/parsed points differ/u)
    await expect(upsertGpxEvidenceChunked(db, gpxInput(mission.id, {
      id: retained.id,
      source_path: '/field/route-alias.gpx',
      file_name: 'route-alias.gpx',
      points,
      rejections: [{ ...rejections[0], source_value: 'changed' }],
    }), 5)).rejects.toThrow(/rejection evidence differs/u)
    await expect(upsertGpxEvidenceChunked(db, gpxInput(mission.id, {
      id: retained.id, points, rejections,
    }), 5)).resolves.toMatchObject({ id: retained.id, revision_sequence: 1 })
    expect(db.prepare(`SELECT elevation FROM gpx_evidence_points
      WHERE import_id = ? AND point_index = 29`).get(retained.id)).toMatchObject({ elevation: 100 })
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

  it('assigns GPX to an outing as a new immutable static-evidence revision [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Static GPX Outing Mission' })
    const outing = await store.createOuting({ mission_id: mission.id, label: 'Operational period 1' })
    const imported = await store.upsertGpxImport(gpxInput(mission.id, {
      timing_class: 'partially_dated',
      points: [
        { segment_index: 0, point_index: 0, track_name: 'Route', lat: 52, lon: -9.7, elevation: 100, timestamp: '2026-08-27T08:00:00Z' },
        { segment_index: 0, point_index: 1, track_name: 'Route', lat: 52.01, lon: -9.71, elevation: null, timestamp: null },
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
      totalTrackCount: 1,
      tracks: [expect.objectContaining({ track_id: imported.id, source_type: 'gpx_point' })],
      staticGpxEvidence: [expect.objectContaining({ import_id: imported.id, outing_id: outing.id })],
    })
  })

  it('assigns 200k-point retained GPX by immutable source reference without blocking current work [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Large GPX Assignment Mission' })
    const outing = await store.createOuting({ mission_id: mission.id, label: 'Operational period 2' })
    const sourceBytesBase64 = Buffer.alloc(3_900_000, 0x67).toString('base64')
    const imported = await store.upsertGpxImport(gpxInput(mission.id, {
      content_sha256: digestBase64(sourceBytesBase64),
      source_bytes_base64: sourceBytesBase64,
      timing_class: 'undated',
      points: [],
    }))
    const seed = openDatabase(await databasePath())
    seed.exec(`WITH RECURSIVE point(value) AS (
        SELECT 0 UNION ALL SELECT value + 1 FROM point WHERE value < 199999
      )
      INSERT INTO gpx_evidence_points (
        import_id, revision_sequence, segment_index, point_index, track_name,
        lat, lon, elevation, source_time
      )
      SELECT '${String(imported.id)}', 1, CAST(value / 1000 AS INTEGER), value % 1000,
        'Retained route', 52 + (value % 1000) / 100000, -9.7, NULL, NULL
      FROM point;`)
    seed.close()

    let lastHeartbeat = performance.now()
    let maximumHeartbeatGapMs = 0
    const heartbeat = setInterval(() => {
      const current = performance.now()
      maximumHeartbeatGapMs = Math.max(maximumHeartbeatGapMs, current - lastHeartbeat)
      lastHeartbeat = current
    }, 5)
    const startedAt = performance.now()
    await store.assignGpxImportToOuting({
      import_id: imported.id,
      outing_id: outing.id,
      assigned_by: 'Coordinator One',
    })
    const assignmentDurationMs = performance.now() - startedAt
    await new Promise((resolve) => setTimeout(resolve, 0))
    clearInterval(heartbeat)

    const db = openDatabase(await databasePath())
    expect(db.prepare(`SELECT revision_sequence, source_revision_sequence,
        length(source_bytes_base64) AS source_bytes_base64_length
      FROM gpx_import_revisions WHERE import_id = ? ORDER BY revision_sequence`).all(imported.id))
      .toEqual([
        { revision_sequence: 1, source_revision_sequence: 1, source_bytes_base64_length: sourceBytesBase64.length },
        { revision_sequence: 2, source_revision_sequence: 1, source_bytes_base64_length: null },
      ])
    expect(db.prepare(`SELECT revision_sequence, COUNT(*) AS count FROM gpx_evidence_points
      WHERE import_id = ? GROUP BY revision_sequence ORDER BY revision_sequence`).all(imported.id))
      .toEqual([{ revision_sequence: 1, count: 200_000 }])
    db.close()
    expect(assignmentDurationMs).toBeLessThan(200)
    expect(maximumHeartbeatGapMs).toBeLessThan(200)

    await expect(store.readMissionReplay({
      missionId: mission.id,
      selectedTime: new Date().toISOString(),
      timezone: 'Europe/Dublin',
      trackLimit: 100,
    })).resolves.toMatchObject({
      staticGpxPointCount: 200_000,
      staticGpxEvidence: [expect.objectContaining({
        import_id: imported.id,
        revision_sequence: 2,
        outing_id: outing.id,
        static_point_count: 200_000,
      })],
    })
  }, 30_000)

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
    await expect(store.upsertSearchPass({
      ...openPass,
      ended_at: null,
    })).rejects.toThrow(/declared search pass outcome.*explicit pass end/i)
    await store.upsertSearchPass({
      ...openPass,
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
    const oversizedAreaStartedAt = performance.now()
    await expect(store.upsertDrawing({
      mission_id: mission.id,
      type: 'search_area',
      name: 'Oversized drawing area',
      display_order: 0,
      geometry_json: 'g'.repeat(64 * 1_024 * 1_024),
    })).rejects.toThrow(/search area geometry.*524288 characters/i)
    expect(performance.now() - oversizedAreaStartedAt).toBeLessThan(200)
    await expect(store.listDrawings(mission.id)).resolves.toEqual([])
    await expect(store.listSearchAreas(mission.id)).resolves.toEqual([])
    await expect(store.upsertDrawing({
      mission_id: mission.id,
      type: 'search_area',
      name: 'Malformed metadata area',
      display_order: 0,
      geometry_json: '{"type":"Polygon","coordinates":[]}',
      metadata_json: { malformed: true },
    })).rejects.toThrow(/search area metadata.*must be text/i)
    await expect(store.upsertSearchArea({
      mission_id: mission.id,
      name: 'Malformed geometry area',
      status: 'active',
      geometry_json: '{not-json}',
      updated_by: 'Coordinator One',
    })).rejects.toThrow(/search area geometry.*valid Polygon JSON/i)
    const oversizedLegacyStartedAt = performance.now()
    await expect(store.upsertSearchArea({
      mission_id: mission.id,
      name: 'Oversized legacy link area',
      status: 'active',
      geometry_json: '{"type":"Polygon","coordinates":[]}',
      legacy_drawing_id: 'l'.repeat(32 * 1_024 * 1_024),
      updated_by: 'Coordinator One',
    })).rejects.toThrow(/legacy drawing.*200 characters/i)
    expect(performance.now() - oversizedLegacyStartedAt).toBeLessThan(200)
    await expect(store.upsertSearchArea({
      mission_id: mission.id,
      name: 'Invalid effective time area',
      status: 'active',
      geometry_json: '{"type":"Polygon","coordinates":[]}',
      effective_at: `2026-03-02T08:00:00.${'1'.repeat(1_024 * 1_024)}Z`,
      updated_by: 'Coordinator One',
    })).rejects.toThrow(/effective time.*64 characters/i)
    const area = await store.upsertSearchArea({
      mission_id: mission.id,
      name: 'Area Alpha',
      status: 'active',
      geometry_json: '{"type":"Polygon","coordinates":[]}',
      updated_by: 'Coordinator One',
    })
    await expect(store.retireSearchArea(area.id, { malformed: true } as never))
      .rejects.toThrow(/search area coordinator.*must be text/i)
    await expect(store.listSearchAreas('m'.repeat(201)))
      .rejects.toThrow(/search area mission.*200 characters/i)
    await expect(store.upsertSearchAssignment({
      mission_id: mission.id,
      search_area_id: area.id,
      outing_id: outing.id,
      team_id: 't'.repeat(121),
      participant_ids: [],
      updated_by: 'Coordinator One',
    })).rejects.toThrow(/team.*120 characters/i)
    await expect(store.upsertSearchAssignment({
      mission_id: mission.id,
      search_area_id: area.id,
      outing_id: outing.id,
      team_id: 'team-1',
      participant_ids: [],
      notes: { malformed: true },
      updated_by: 'Coordinator One',
    })).rejects.toThrow(/assignment notes.*must be text/i)
    await expect(store.upsertSearchAssignment({
      mission_id: mission.id,
      search_area_id: area.id,
      outing_id: outing.id,
      team_id: 'team-1',
      participant_ids: [],
      effective_at: `2026-03-02T08:00:00.${'1'.repeat(1_024 * 1_024)}Z`,
      updated_by: 'Coordinator One',
    })).rejects.toThrow(/assignment effective time.*64 characters/i)
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
    await expect(store.upsertSearchPass({
      ...validPass,
      notes: { malformed: true },
    })).rejects.toThrow(/pass notes.*must be text/i)
    const oversizedTimestampStartedAt = performance.now()
    await expect(store.upsertSearchPass({
      ...validPass,
      started_at: `2026-03-02T08:00:00.${'1'.repeat(32 * 1_024 * 1_024)}Z`,
    })).rejects.toThrow(/pass start.*64 characters/i)
    expect(performance.now() - oversizedTimestampStartedAt).toBeLessThan(200)
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
    await expect(store.upsertSearchPass({
      ...validPass,
      advisory_coverage_json: { malformed: true },
    })).rejects.toThrow(/advisory coverage.*must be text/i)
    await expect(store.upsertSearchPass({
      ...validPass,
      advisory_coverage_json: '{not-json}',
    })).rejects.toThrow(/advisory coverage.*valid JSON/i)
    await expect(store.upsertSearchPass({
      ...validPass,
      advisory_coverage_json: 'c'.repeat(512 * 1_024 + 1),
    })).rejects.toThrow(/advisory coverage.*524288 characters/i)
    const recordedPass = await store.upsertSearchPass({
      ...validPass,
      advisory_coverage_json: '{"source":"advisory"}',
    })
    expect(recordedPass).toMatchObject({ advisory_coverage_json: '{"source":"advisory"}' })
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
    const passPage = await store.listSearchOperationPage({
      missionId: mission.id, kind: 'passes', limit: 25,
    })
    expect(passPage).toMatchObject({
      totalCount: 1,
      nextCursor: null,
      entries: [expect.objectContaining({
        id: pass.id,
        outcome: 'partial',
        participant_count: 1,
        clue_count: 1,
        track_evidence_count: 1,
      })],
    })
    expect(JSON.stringify(passPage)).not.toContain('advisory_coverage_json')
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
      ended_at: outing.started_at,
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

  it('retains structured point and segment rejections when every GPX point is invalid [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'All-invalid GPX Provenance Mission' })
    const sourcePath = path.join(userDataPath!, 'all-invalid.gpx')
    const source = `<gpx version="1.1"><trk><trkseg>
      <trkpt lat="91" lon="-9.7"/>
      <trkpt lat="52" lon="181"/>
    </trkseg></trk></gpx>`
    await writeFile(sourcePath, source)

    await expect(store.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] }))
      .resolves.toMatchObject({
        imports: [],
        failures: [expect.objectContaining({ sourcePath })],
      })

    const db = openDatabase(await databasePath())
    const failure = db.prepare(`SELECT source_bytes_base64, rejection_count, rejections_json
      FROM gpx_import_failures WHERE source_path = ?`).get(sourcePath)
    expect(failure).toMatchObject({
      source_bytes_base64: Buffer.from(source).toString('base64'),
      rejection_count: 3,
    })
    expect(JSON.parse(String(failure?.rejections_json))).toEqual([
      expect.objectContaining({ kind: 'point', point_index: 0, reason: 'invalid_coordinates' }),
      expect.objectContaining({ kind: 'point', point_index: 1, reason: 'invalid_coordinates' }),
      expect.objectContaining({ kind: 'segment', point_index: null, reason: 'insufficient_segment_points' }),
    ])
    db.close()
    await expect(store.listGpxImportIssues({ missionId: mission.id, limit: 10 }))
      .resolves.toMatchObject({
        entries: [expect.objectContaining({ rejection_count: 3 })],
      })
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

  it('caps admitted GPX import batches before creating unbounded durable receipts [DON-274]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-gpx-admission-'))
    let releaseWorker = () => undefined
    const heldWorker = new Promise<void>((resolve) => { releaseWorker = resolve })
    const runner = (() => Object.assign(
      heldWorker.then(() => ({ imports: [], failures: [], dispatchDurationMs: 0 })),
      { workerExited: heldWorker },
    )) as unknown as NonNullable<Parameters<typeof createElectronMissionStore>[0]['runGpxEvidenceImportInWorker']>
    store = createElectronMissionStore({
      userDataPath,
      runGpxEvidenceImportInWorker: runner,
    })
    const mission = await store.createMission({ name: 'Bounded GPX Admission Mission' })
    const paths = Array.from({ length: 5 }, (_unused, index) =>
      path.join(userDataPath!, `queued-${index}.gpx`))
    await Promise.all(paths.map((sourcePath) => writeFile(
      sourcePath,
      '<gpx version="1.1"><trk><trkseg><trkpt lat="52" lon="-9.7"/></trkseg></trk></gpx>',
    )))

    const admitted = paths.slice(0, 4).map((sourcePath) =>
      store!.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] }))
    await expect(store.importGpxEvidencePaths({ missionId: mission.id, paths: [paths[4]!] }))
      .rejects.toThrow(/queue is full/iu)
    const db = openDatabase(await databasePath())
    expect(db.prepare(`SELECT COUNT(*) AS count FROM gpx_import_batches
      WHERE mission_id = ?`).get(mission.id)).toMatchObject({ count: 4 })
    expect(db.prepare(`SELECT COUNT(*) AS count FROM gpx_import_source_receipts
      WHERE mission_id = ?`).get(mission.id)).toMatchObject({ count: 4 })
    db.close()
    releaseWorker()
    await Promise.all(admitted)
  })

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

  it('preflights renderer GPX identities and assignment actors before database work [DON-274]', async () => {
    store = await createStore()
    const oversizedImportId = 'i'.repeat(1_001)
    const oversizedMissionId = 'm'.repeat(1_001)
    const oversizedOutingId = 'o'.repeat(201)

    await expect(store.listGpxImportIssues({ missionId: oversizedMissionId }))
      .rejects.toThrow(/1000 characters/i)
    await expect(store.updateGpxImportPresentation({
      id: oversizedImportId,
      mission_id: 'mission-id',
    })).rejects.toThrow(/1000 characters/i)
    await expect(store.updateGpxImportPresentation({
      id: 'import-id',
      mission_id: oversizedMissionId,
    })).rejects.toThrow(/1000 characters/i)
    await expect(store.assignGpxImportToOuting({
      import_id: oversizedImportId,
      outing_id: 'outing-id',
    })).rejects.toThrow(/1000 characters/i)
    await expect(store.assignGpxImportToOuting({
      import_id: 'import-id',
      outing_id: oversizedOutingId,
    })).rejects.toThrow(/200 characters/i)
    await expect(store.assignGpxImportToOuting({
      import_id: 'import-id',
      outing_id: 'outing-id',
      assigned_by: 'c'.repeat(121),
    })).rejects.toThrow(/120 characters/i)
    await expect(store.assignGpxImportToOuting({
      import_id: 'import-id',
      outing_id: 'outing-id',
      assigned_by: 42,
    })).rejects.toThrow(/must be text/i)
    await expect(store.deleteGpxImport(oversizedImportId))
      .rejects.toThrow(/1000 characters/i)
    await expect(store.importGpxEvidencePaths({
      missionId: oversizedMissionId,
      paths: ['/field/track.gpx'],
    })).rejects.toThrow(/1000 characters/i)
    await expect(store.importGpxEvidencePaths({
      missionId: 'mission-id',
      paths: [' '.repeat(4_096)],
    })).rejects.toThrow(/paths are invalid/i)
  })

  it('bounds every persisted GPX issue scalar and exposes projection loss explicitly [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'GPX Issue Projection Mission' })
    const databaseFile = await databasePath()
    const db = openDatabase(databaseFile)
    startGpxImportBatch(db, {
      batchId: 'projection-batch',
      missionId: mission.id,
      totalFiles: 1,
    })
    recordGpxImportSourceReceipt(db, {
      batchId: 'projection-batch',
      missionId: mission.id,
      sourcePath: '/field/projection.gpx',
      fileName: 'projection.gpx',
    })
    recordGpxImportFailure(db, {
      batchId: 'projection-batch',
      missionId: mission.id,
      sourcePath: '/field/projection.gpx',
      fileName: 'projection.gpx',
      reason: 'projection failure',
    })
    db.prepare(`UPDATE gpx_import_failures SET
      file_name = ?, content_sha256 = ?, reason = ?, recorded_at = ?
      WHERE batch_id = ?`).run(
      `unsafe-${'f'.repeat(20_000)}`,
      'h'.repeat(20_000),
      'r'.repeat(20_000),
      '2026-08-27T10:00:00.000Z'.padEnd(20_000, 't'),
      'projection-batch',
    )
    db.close()

    const page = await store.listGpxImportIssues({ missionId: mission.id, limit: 100 })
    expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThanOrEqual(1024 * 1024)
    expect(page.entries).toHaveLength(1)
    expect(page.entries[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^failure:-?\d+$/),
      projection_warnings: expect.arrayContaining([
        'file_name_truncated',
        'content_sha256_truncated',
        'reason_truncated',
        'recorded_at_truncated',
      ]),
    }))
    expect(String(page.entries[0]?.file_name)).toMatch(/truncated for renderer/u)
    expect(page.nextCursor).toBeNull()
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

  it('fails shutdown closed on a bounded deadline until the GPX worker physically exits [DON-274]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-shutdown-deadline-'))
    let resolveWorkerExit: (() => void) | undefined
    const workerExited = new Promise<void>((resolve) => { resolveWorkerExit = resolve })
    const runner = ((input: { readonly signal?: AbortSignal }) => {
      const result = new Promise((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
      Object.defineProperty(result, 'workerExited', { value: workerExited })
      return result
    }) as (input: { readonly signal?: AbortSignal }) => Promise<unknown> & { readonly workerExited: Promise<void> }
    store = createElectronMissionStore({
      userDataPath,
      runGpxEvidenceImportInWorker: runner,
      gpxShutdownJoinTimeoutMs: 20,
    })
    const mission = await store.createMission({ name: 'Bounded GPX Shutdown Mission' })
    const importing = store.importGpxEvidencePaths({ missionId: mission.id, paths: ['/field/stuck.gpx'] })
    void importing.catch(() => undefined)

    await expect(store.prepareClose()).rejects.toThrow(/worker.*did not exit.*shutdown/i)
    expect(() => store?.close()).toThrow(/GPX evidence imports are active/i)

    resolveWorkerExit?.()
    await expect(store.prepareClose()).resolves.toBeUndefined()
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
    const inspection = openDatabase(await databasePath())
    expect(inspection.prepare(`SELECT
        length(COALESCE(imports.source_bytes_base64, '')) AS projection_bytes,
        length(COALESCE(revisions.source_bytes_base64, '')) AS revision_bytes
      FROM gpx_track_imports AS imports
      JOIN gpx_import_revisions AS revisions
        ON revisions.import_id = imports.id
        AND revisions.revision_sequence = imports.revision_sequence
      WHERE imports.mission_id = ?`).get(mission.id)).toMatchObject({
      projection_bytes: 0,
      revision_bytes: Math.ceil(maximumBytes / 3) * 4,
    })
    inspection.close()
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

  async function waitForGpxReceiptRecovery(
    database: InstanceType<typeof Database>,
    batchId: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const pending = database.prepare(`SELECT 1 FROM gpx_import_source_receipts
        WHERE batch_id = ? AND status IN ('pending', 'retained') LIMIT 1`).get(batchId)
      if (pending === undefined) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`Timed out waiting for GPX receipt recovery for ${batchId}.`)
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
