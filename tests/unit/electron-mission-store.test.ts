import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
type StorageOperation = { readonly id: string; readonly type: 'backup'; readonly requestedAtMs: number }
type StorageDiagnosticsPort = {
  readonly createOperation: (type: 'backup') => StorageOperation
  readonly requested: (
    operation: StorageOperation,
    input: { readonly queueDepth: number; readonly trigger?: string },
  ) => Promise<void>
  readonly started: (operation: StorageOperation) => Promise<void>
  readonly phase: (
    operation: StorageOperation,
    stage: 'copied' | 'sanity_check_started' | 'sanity_checked' | 'renamed',
  ) => Promise<void>
  readonly completed: (operation: StorageOperation) => Promise<void>
  readonly failed: (operation: StorageOperation, input: { readonly stage: string; readonly errorName: string }) => Promise<void>
  readonly startMission: (input: { readonly startedAt: string }) => Promise<void>
  readonly recordTrackingBatch: (input: {
    readonly durationMs: number
    readonly deviceCount: number
    readonly changedDeviceEventCount: number
    readonly observedAt: string
  }) => Promise<void>
  readonly recordInsertedPositions: (input: {
    readonly durationMs: number
    readonly insertedPositionCount: number
    readonly positionTelemetryEventCount: number
  }) => Promise<void>
}
const { createElectronMissionStore, CURRENT_SCHEMA_VERSION } = require('../../electron/mission-store.cjs') as {
  readonly CURRENT_SCHEMA_VERSION: number
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly readAdminRoster?: () => Promise<readonly string[]>
    readonly backupFaultInjection?: {
      readonly afterTemporaryBackup?: boolean
      readonly corruptTemporarySnapshotBeforeSanityCheck?: boolean
    }
    readonly archiveFaultInjection?: {
      readonly corruptSnapshotBeforeZip?: boolean
    }
    readonly finalizeMissionFaultInjection?: {
      readonly afterArchiveSucceededEvent?: boolean
    }
    readonly storageDiagnostics?: StorageDiagnosticsPort
  }) => ElectronMissionStore
}
const Database = require('better-sqlite3')

type ElectronMissionStore = {
  readonly close: () => void
  readonly info: () => Promise<{
    readonly schema_version: number
    readonly synchronous_mode: number
    readonly database_path: string
    readonly backup_path: string
  }>
  readonly syncBackup: (trigger?: string) => Promise<string>
  readonly createMission: (input: { readonly name: string; readonly start_time?: string }) => Promise<{ readonly id: string; readonly status: string }>
  readonly getMission: (missionId: string) => Promise<{
    readonly id: string
    readonly status: string
    readonly pause_time: string | null
    readonly paused_seconds: number
  }>
  readonly getActiveMission: () => Promise<{ readonly id: string; readonly status: string } | null>
  readonly listMissions: () => Promise<readonly { readonly id: string; readonly status: string }[]>
  readonly pauseMission: (missionId: string) => Promise<{ readonly status: string }>
  readonly resumeMission: (missionId: string) => Promise<{ readonly status: string }>
  readonly finishMission: (missionId: string) => Promise<{ readonly status: string }>
  readonly listMissionEvents: (missionId: string) => Promise<readonly {
    readonly event_type: string
    readonly timestamp: string
    readonly details_json: string | null
  }[]>
  readonly listAuditEvents: (
    missionId: string,
    options?: { readonly includeTelemetry?: boolean; readonly limit?: number },
  ) => Promise<readonly { readonly event_type: string; readonly timestamp: string }[]>
  readonly upsertDevice: (input: {
    readonly mission_id: string
    readonly device_id: string
    readonly name: string
    readonly color: string
    readonly status: string
    readonly last_seen?: string | null
  }) => Promise<{ readonly device_id: string; readonly last_seen: string | null }>
  readonly upsertDevicesBulk: (input: {
    readonly mission_id: string
    readonly devices: readonly {
      readonly device_id: string
      readonly name: string
      readonly color: string
      readonly status: string
      readonly last_seen?: string | null
    }[]
  }) => Promise<readonly { readonly device_id: string }[]>
  readonly addPosition: (input: {
    readonly id?: string
    readonly mission_id: string
    readonly device_id: string
    readonly lat: number
    readonly lon: number
    readonly timestamp?: string
  }) => Promise<{ readonly device_id: string }>
  readonly addPositionsBulk: (input: {
    readonly mission_id: string
    readonly positions: readonly {
      readonly id?: string
      readonly device_id: string
      readonly lat: number
      readonly lon: number
      readonly altitude?: number | null
      readonly speed?: number | null
      readonly battery?: number | null
      readonly accuracy?: number | null
      readonly source?: string | null
      readonly timestamp?: string | null
      readonly data_origin?: 'live' | 'cache'
    }[]
  }) => Promise<readonly { readonly device_id: string; readonly timestamp: string }[]>
  readonly listPositions: (
    missionId: string,
    deviceId?: string,
  ) => Promise<readonly { readonly device_id: string; readonly timestamp: string; readonly data_origin: string }[]>
  readonly listRecentPositions: (
    missionId: string,
    perDeviceLimit: number,
  ) => Promise<readonly { readonly device_id: string; readonly timestamp: string }[]>
  readonly countPositions: (missionId: string, deviceId?: string) => Promise<number>
  readonly latestPositions: (missionId: string) => Promise<readonly { readonly device_id: string; readonly lat: number }[]>
  readonly upsertMarker: (input: {
    readonly id?: string
    readonly mission_id: string
    readonly type: string
    readonly name: string
    readonly lat: number
    readonly lon: number
    readonly irish_grid_e: number
    readonly irish_grid_n: number
    readonly display_order: number
    readonly label_size?: number
  }) => Promise<{ readonly id: string }>
  readonly deleteMarker: (markerId: string) => Promise<boolean>
  readonly listMarkers: (missionId: string) => Promise<readonly { readonly id: string; readonly label_size?: number | null }[]>
  readonly getDrawing: (drawingId: string) => Promise<{
    readonly id: string
    readonly mission_id: string
    readonly name: string
    readonly created_at: string
    readonly updated_at: string
  }>
  readonly listDrawings: (missionId: string) => Promise<readonly { readonly id: string }[]>
  readonly listHelicopters: (missionId: string) => Promise<readonly { readonly id: string }[]>
  readonly listGpxImports: (missionId: string) => Promise<readonly {
    readonly id: string
    readonly mission_id: string
    readonly display_name: string
    readonly imported_at: string
    readonly updated_at: string
  }[]>
  readonly upsertDrawing: (input: {
    readonly id?: string
    readonly mission_id: string
    readonly type: string
    readonly name: string
    readonly display_order: number
    readonly geometry_json: string
  }) => Promise<{ readonly id: string }>
  readonly deleteDrawing: (drawingId: string) => Promise<boolean>
  readonly upsertHelicopter: (input: {
    readonly mission_id: string
    readonly slot_key: string
    readonly call_sign: string
    readonly lat: number
    readonly lon: number
  }) => Promise<{ readonly id: string }>
  readonly deleteHelicopter: (helicopterId: string) => Promise<boolean>
  readonly upsertGpxImport: (input: {
    readonly id?: string
    readonly mission_id: string
    readonly source_path: string
    readonly file_name: string
    readonly display_name: string
    readonly geometry_json: string
  }) => Promise<{ readonly id: string }>
  readonly deleteGpxImport: (importId: string) => Promise<boolean>
  readonly finalizeMission: (
    missionId: string,
  ) => Promise<{ readonly mission: { readonly status: string }; readonly archive: { readonly archive_path: string; readonly created_at: string } }>
  readonly unlockFinalizedMission: (input: {
    readonly mission_id: string
    readonly admin_name: string
    readonly reason: string
  }) => Promise<{ readonly status: string }>
  readonly createMissionArchive: (
    missionId: string,
  ) => Promise<{ readonly mission_id: string; readonly archive_path: string; readonly created_at: string }>
  readonly getMarker: (markerId: string) => Promise<{
    readonly id: string
    readonly mission_id: string
    readonly name: string
    readonly created_at: string
    readonly updated_at: string
  }>
  readonly listLayerCatalogMetadata: (
    missionId: string,
  ) => Promise<readonly { readonly missionId: string; readonly nodeId: string; readonly isVisible: boolean }[]>
  readonly upsertLayerCatalogMetadata: (input: {
    readonly missionId: string
    readonly nodeId: string
    readonly parentNodeId: string | null
    readonly nodeKind: 'group' | 'layer' | 'feature_item'
    readonly isVisible?: boolean
  }) => Promise<{ readonly missionId: string; readonly nodeId: string; readonly isVisible: boolean }>
  readonly clearLayerCatalogMetadata: (missionId: string) => Promise<void>
}

describe('electron mission store', () => {
  let userDataPath: string | null = null
  let store: ElectronMissionStore | null = null

  afterEach(async () => {
    vi.useRealTimers()
    store?.close()
    store = null
    if (userDataPath !== null) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = null
    }
  })

  it('creates WAL-backed mission storage under userData and survives store restart', async () => {
    store = await createStore()

    const mission = await store.createMission({
      name: 'Electron Mission',
      start_time: '2026-05-19T12:00:00.000Z',
    })
    await store.pauseMission(mission.id)
    store.close()

    store = createElectronMissionStore({ userDataPath: userDataPath! })
    const info = await store.info()
    const activeMission = await store.getActiveMission()

    expect(info).toMatchObject({
      schema_version: 4,
      database_path: path.join(userDataPath!, 'mission-store.sqlite'),
      backup_path: path.join(userDataPath!, 'mission-store.backup.sqlite'),
    })
    expect(activeMission).toMatchObject({ id: mission.id, status: 'paused' })
    await expect(store.listMissions()).resolves.toHaveLength(1)
  })

  it('uses FULL synchronous mode for the WAL database so committed mission writes are durable [DON-232]', async () => {
    store = await createStore()

    const info = await store.info()
    const db = new Database(info.database_path, { readonly: true })
    try {
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
      expect(info.synchronous_mode).toBe(2)
    } finally {
      db.close()
    }
  })

  it('refuses to open a database from a newer schema instead of downgrading metadata [DON-232]', async () => {
    store = await createStore()
    const info = await store.info()
    store.close()
    store = null

    const db = new Database(info.database_path)
    try {
      db.prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'")
        .run(String(CURRENT_SCHEMA_VERSION + 1))
    } finally {
      db.close()
    }

    expect(() => createElectronMissionStore({ userDataPath: userDataPath! })).toThrow(
      /newer mission store schema/i,
    )
  })

  it('records tracking devices, positions, backup events, and mission lifecycle events', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Tracking Mission' })

    await expect(
      store.upsertDevice({
        mission_id: mission.id,
        device_id: 'tracker-1',
        name: 'Tracker One',
        color: '#00AAFF',
        status: 'unknown',
      }),
    ).resolves.toMatchObject({ device_id: 'tracker-1' })
    await expect(
      store.addPosition({
        mission_id: mission.id,
        device_id: 'tracker-1',
        lat: 52.0599,
        lon: -9.5045,
        timestamp: '2026-05-19T12:01:00.000Z',
      }),
    ).resolves.toMatchObject({ device_id: 'tracker-1' })

    await expect(store.latestPositions(mission.id)).resolves.toMatchObject([
      { device_id: 'tracker-1', lat: 52.0599 },
    ])
    await expect(store.syncBackup()).resolves.toBe(
      path.join(userDataPath!, 'mission-store.backup.sqlite'),
    )
    await store.pauseMission(mission.id)
    await expect(store.resumeMission(mission.id)).resolves.toMatchObject({
      status: 'active',
    })
    await expect(store.finishMission(mission.id)).resolves.toMatchObject({ status: 'finished' })

    const events = await store.listMissionEvents(mission.id)
    expect(events.map((event) => event.event_type)).toEqual(
      expect.arrayContaining([
        'mission_created',
        // First contact for this device emits device_created (DON-164).
        'device_created',
        'mission_backup_synced',
        'mission_paused',
        'mission_resumed',
        'mission_finished',
      ]),
    )
    expect(events.map((event) => event.event_type)).not.toContain('position_recorded')
  })

  it('loads only a bounded recent breadcrumb window per device on restart [DON-246]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Bounded Restart Mission' })
    for (const deviceId of ['tracker-1', 'tracker-2']) {
      await store.upsertDevice({
        mission_id: mission.id,
        device_id: deviceId,
        name: deviceId,
        color: '#00AAFF',
        status: 'online',
      })
      for (let minute = 0; minute < 4; minute += 1) {
        await store.addPosition({
          mission_id: mission.id,
          device_id: deviceId,
          lat: 52 + minute * 0.001,
          lon: -9 - minute * 0.001,
          timestamp: `2026-05-19T12:0${minute}:00.000Z`,
        })
      }
    }

    const recent = await store.listRecentPositions(mission.id, 2)

    expect(recent).toHaveLength(4)
    expect(recent.map((position) => `${position.device_id}:${position.timestamp}`)).toEqual([
      'tracker-1:2026-05-19T12:02:00.000Z',
      'tracker-2:2026-05-19T12:02:00.000Z',
      'tracker-1:2026-05-19T12:03:00.000Z',
      'tracker-2:2026-05-19T12:03:00.000Z',
    ])
    await expect(store.listRecentPositions(mission.id, 0)).rejects.toThrow(/positive integer/i)
  })

  it('accumulates paused seconds when a mission resumes [DON-231]', async () => {
    vi.useFakeTimers()
    store = await createStore()
    const mission = await store.createMission({
      name: 'Paused Time Mission',
      start_time: '2026-07-06T12:00:00.000Z',
    })

    vi.setSystemTime(new Date('2026-07-06T12:10:00.000Z'))
    await store.pauseMission(mission.id)
    vi.setSystemTime(new Date('2026-07-06T12:40:00.000Z'))
    await store.resumeMission(mission.id)

    const resumed = await store.getMission(mission.id)
    expect(resumed).toMatchObject({
      status: 'active',
      pause_time: null,
      paused_seconds: 1_800,
    })

    vi.setSystemTime(new Date('2026-07-06T13:00:00.000Z'))
    await store.finishMission(mission.id)

    const finished = await store.getMission(mission.id)
    expect(finished).toMatchObject({
      status: 'finished',
      pause_time: null,
      paused_seconds: 1_800,
    })
  })

  it('folds the current pause into paused seconds when finishing a paused mission [DON-231]', async () => {
    vi.useFakeTimers()
    store = await createStore()
    const mission = await store.createMission({
      name: 'Paused Finish Mission',
      start_time: '2026-07-06T12:00:00.000Z',
    })

    vi.setSystemTime(new Date('2026-07-06T12:05:00.000Z'))
    await store.pauseMission(mission.id)
    vi.setSystemTime(new Date('2026-07-06T12:20:00.000Z'))
    await store.finishMission(mission.id)

    const finished = await store.getMission(mission.id)
    expect(finished).toMatchObject({
      status: 'finished',
      pause_time: null,
      paused_seconds: 900,
    })
  })

  it('bulk records tracking positions in one mission-store operation while preserving mission truth [DON-200]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Bulk Tracking Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })
    const positions = Array.from({ length: 2_500 }, (_, index) => ({
      mission_id: mission.id,
      device_id: 'tracker-1',
      lat: 52.0599 + index / 1_000_000,
      lon: -9.5045 - index / 1_000_000,
      altitude: index % 3 === 0 ? 120 + index : null,
      speed: index % 5 === 0 ? 2.5 : null,
      battery: index % 7 === 0 ? 87 : null,
      accuracy: index % 11 === 0 ? 4 : null,
      source: 'traccar',
      timestamp: new Date(Date.UTC(2026, 5, 13, 0, 0, index)).toISOString(),
      data_origin: index % 2 === 0 ? 'live' as const : 'cache' as const,
    }))

    await expect(
      store.addPositionsBulk({
        mission_id: mission.id,
        positions,
      }),
    ).resolves.toHaveLength(positions.length)

    await expect(store.countPositions(mission.id)).resolves.toBe(positions.length)
    const persisted = await store.listPositions(mission.id)
    expect(persisted).toHaveLength(positions.length)
    expect(persisted[0]).toMatchObject({
      device_id: 'tracker-1',
      timestamp: positions[0]!.timestamp,
      data_origin: 'live',
    })
    expect(persisted.at(-1)).toMatchObject({
      device_id: 'tracker-1',
      timestamp: positions.at(-1)!.timestamp,
      data_origin: 'cache',
    })

    const telemetry = await store.listAuditEvents(mission.id, {
      includeTelemetry: true,
      limit: 5_000,
    })
    expect(telemetry.filter((event) => event.event_type === 'position_recorded')).toHaveLength(0)
    const auditEvents = await store.listAuditEvents(mission.id)
    expect(auditEvents.map((event) => event.event_type)).not.toContain('position_recorded')
  })

  it('bulk records same-second distinct Traccar positions when upstream ids differ [DON-233]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Same Second Tracking Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })

    await expect(
      store.addPositionsBulk({
        mission_id: mission.id,
        positions: [
          {
            id: 'traccar-9001',
            device_id: 'tracker-1',
            lat: 52.0599,
            lon: -9.5045,
            timestamp: '2026-06-13T12:00:05.000Z',
          },
          {
            id: 'traccar-9002',
            device_id: 'tracker-1',
            lat: 52.0601,
            lon: -9.5047,
            timestamp: '2026-06-13T12:00:05.000Z',
          },
        ],
      }),
    ).resolves.toHaveLength(2)

    await expect(store.countPositions(mission.id)).resolves.toBe(2)
  })

  it('counts positions without loading position rows for Mission Review [DON-202]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Review Count Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-2',
      name: 'Tracker Two',
      color: '#00BB66',
      status: 'unknown',
    })
    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: [
        {
          device_id: 'tracker-1',
          lat: 52.0599,
          lon: -9.5045,
          timestamp: '2026-05-19T12:01:00.000Z',
        },
        {
          device_id: 'tracker-1',
          lat: 52.06,
          lon: -9.505,
          timestamp: '2026-05-19T12:02:00.000Z',
        },
        {
          device_id: 'tracker-2',
          lat: 52.07,
          lon: -9.506,
          timestamp: '2026-05-19T12:03:00.000Z',
        },
      ],
    })

    await expect(store.countPositions(mission.id)).resolves.toBe(3)
    await expect(store.countPositions(mission.id, 'tracker-1')).resolves.toBe(2)
    await expect(store.countPositions(mission.id, 'tracker-2')).resolves.toBe(1)
  })

  it('excludes telemetry events and bounds the result for the review audit log', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Audit Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })

    // Generate a burst of positions. Current Electron stores position truth without
    // duplicating every fix into mission_events.
    for (let index = 0; index < 50; index += 1) {
      await store.addPosition({
        mission_id: mission.id,
        device_id: 'tracker-1',
        lat: 52.0599,
        lon: -9.5045,
        timestamp: `2026-05-19T12:${String(index).padStart(2, '0')}:00.000Z`,
      })
    }

    const auditEvents = await store.listAuditEvents(mission.id)
    const auditTypes = auditEvents.map((event) => event.event_type)
    expect(auditTypes).toContain('mission_created')
    // device upsert + GPS fixes are telemetry heartbeats and must be filtered out.
    expect(auditTypes).not.toContain('position_recorded')
    expect(auditTypes).not.toContain('device_updated')

    await store.syncBackup('interval')
    const auditTypesAfterBackup = (await store.listAuditEvents(mission.id)).map(
      (event) => event.event_type,
    )
    expect(auditTypesAfterBackup).not.toContain('mission_backup_synced')

    // Legacy/current telemetry can still be opted back in, but respects the bound.
    const withTelemetry = await store.listAuditEvents(mission.id, {
      includeTelemetry: true,
      limit: 10,
    })
    expect(withTelemetry.length).toBeLessThanOrEqual(10)
    expect(withTelemetry.map((event) => event.event_type)).toContain('mission_backup_synced')
    expect(withTelemetry.map((event) => event.event_type)).not.toContain('position_recorded')
    for (let index = 1; index < withTelemetry.length; index += 1) {
      expect(
        Date.parse(withTelemetry[index - 1]!.timestamp) >=
          Date.parse(withTelemetry[index]!.timestamp),
      ).toBe(true)
    }
  })

  it('keeps the rolling backup mirror atomic when backup is interrupted [DON-232]', async () => {
    store = await createStore({
      backupFaultInjection: {
        afterTemporaryBackup: true,
      },
    })
    const mission = await store.createMission({ name: 'Interrupted Backup Mission' })

    await expect(store.syncBackup()).rejects.toThrow(/Injected backup interruption/)
    await expect(access(path.join(userDataPath!, 'mission-store.backup.sqlite'))).rejects.toThrow()
    const files = await readdir(userDataPath!)
    expect(files.some((fileName) => fileName.includes('mission-store.backup.sqlite.tmp'))).toBe(false)

    const eventTypes = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(eventTypes).not.toContain('mission_backup_synced')
  })

  it('rejects a rolling snapshot whose fixed SQLite header sanity check fails [DON-240]', async () => {
    store = await createStore({
      backupFaultInjection: {
        corruptTemporarySnapshotBeforeSanityCheck: true,
      },
    })
    const mission = await store.createMission({ name: 'Corrupt Rolling Snapshot Mission' })

    await expect(store.syncBackup('interval')).rejects.toThrow(/SQLite header signature/)
    await expect(access(path.join(userDataPath!, 'mission-store.backup.sqlite'))).rejects.toThrow()
    expect((await store.listMissionEvents(mission.id)).map((event) => event.event_type)).not.toContain(
      'mission_backup_synced',
    )
  })

  it('rejects an archive whose embedded SQLite snapshot fails integrity validation [DON-232]', async () => {
    store = await createStore({
      archiveFaultInjection: {
        corruptSnapshotBeforeZip: true,
      },
    })
    const mission = await store.createMission({ name: 'Corrupt Snapshot Archive Mission' })
    await store.finishMission(mission.id)

    await expect(store.createMissionArchive(mission.id)).rejects.toThrow(/SQLite snapshot/i)
    const archiveDirectory = path.join(userDataPath!, 'archives')
    const archiveFiles = await readdir(archiveDirectory).catch(() => [])
    expect(archiveFiles.filter((fileName) => fileName.endsWith('.zip'))).toEqual([])
  })

  it('persists layer catalog metadata in the same userData SQLite database', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Layer Mission' })

    await expect(
      store.upsertLayerCatalogMetadata({
        missionId: mission.id,
        nodeId: 'group:tracking',
        parentNodeId: null,
        nodeKind: 'group',
        isVisible: false,
      }),
    ).resolves.toMatchObject({
      missionId: mission.id,
      nodeId: 'group:tracking',
      isVisible: false,
    })

    await expect(store.listLayerCatalogMetadata(mission.id)).resolves.toMatchObject([
      {
        missionId: mission.id,
        nodeId: 'group:tracking',
        isVisible: false,
      },
    ])

    await store.clearLayerCatalogMetadata(mission.id)
    await expect(store.listLayerCatalogMetadata(mission.id)).resolves.toEqual([])

    const eventTypes = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(eventTypes.filter((eventType) => eventType === 'layer_catalog_metadata_updated')).toHaveLength(1)
    expect(eventTypes).toContain('layer_catalog_repaired')
  })

  // --- DON-163 / DON-164: audit-event parity with Rust + harness ---

  const SAMPLE_MARKER = {
    type: 'ipp_lkp',
    name: 'IPP',
    lat: 52.0599,
    lon: -9.5045,
    irish_grid_e: 480000,
    irish_grid_n: 580000,
    display_order: 0,
    label_size: 14,
  } as const
  const SAMPLE_DRAWING = {
    type: 'search_area',
    name: 'Sector A',
    display_order: 0,
    geometry_json: '{"type":"Polygon","coordinates":[]}',
  } as const
  const SAMPLE_HELICOPTER = {
    slot_key: 'slot_1',
    call_sign: 'Rescue 115',
    lat: 52.06,
    lon: -9.5,
  } as const
  const SAMPLE_GPX = {
    source_path: '/tmp/track.gpx',
    file_name: 'track.gpx',
    display_name: 'Ridge Track',
    geometry_json: '{"type":"LineString","coordinates":[]}',
  } as const

  it('emits device events only for first contact or a real operator-visible change [DON-245]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Device Mission' })

    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
      last_seen: '2026-07-10T12:00:05.000Z',
    })
    const lastSeenOnly = await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
      last_seen: '2026-07-10T12:00:10.000Z',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One Renamed',
      color: '#00AAFF',
      status: 'online',
    })

    const types = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(types.filter((type) => type === 'device_created')).toHaveLength(1)
    expect(types.filter((type) => type === 'device_updated')).toHaveLength(1)
    expect(lastSeenOnly.last_seen).toBe('2026-07-10T12:00:10.000Z')

    // device_created is NOT telemetry, so it surfaces in the default review feed; the
    // subsequent device_updated is telemetry and must be filtered out.
    const auditTypes = (await store.listAuditEvents(mission.id)).map((event) => event.event_type)
    expect(auditTypes).toContain('device_created')
    expect(auditTypes).not.toContain('device_updated')
  })

  it('bulk upserts persist last_seen but emit updates only for real changes [DON-245]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Bulk Device Mission' })

    // Pre-existing device so the batch exercises both the created and updated event paths.
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })

    const result = await store.upsertDevicesBulk({
      mission_id: mission.id,
      devices: [
        { device_id: 'tracker-1', name: 'Tracker One Renamed', color: '#00AAFF', status: 'online' },
        { device_id: 'tracker-2', name: 'Tracker Two', color: '#FF8800', status: 'online' },
        { device_id: 'tracker-3', name: 'Tracker Three', color: '#22CC66', status: 'unknown' },
      ],
    })

    expect(result.map((device) => device.device_id)).toEqual(['tracker-1', 'tracker-2', 'tracker-3'])

    const devices = await store.listDevices(mission.id)
    expect(devices).toHaveLength(3)

    const types = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    // tracker-1 already existed (1 created earlier) → this batch: 1 update + 2 creates.
    expect(types.filter((type) => type === 'device_created')).toHaveLength(3)
    expect(types.filter((type) => type === 'device_updated')).toHaveLength(1)

    await store.upsertDevicesBulk({
      mission_id: mission.id,
      devices: [
        {
          device_id: 'tracker-1',
          name: 'Tracker One Renamed',
          color: '#00AAFF',
          status: 'online',
          last_seen: '2026-07-10T12:05:00.000Z',
        },
        {
          device_id: 'tracker-2',
          name: 'Tracker Two',
          color: '#FF8800',
          status: 'online',
          last_seen: '2026-07-10T12:05:00.000Z',
        },
        {
          device_id: 'tracker-3',
          name: 'Tracker Three',
          color: '#22CC66',
          status: 'unknown',
          last_seen: '2026-07-10T12:05:00.000Z',
        },
      ],
    })

    const typesAfterUnchangedPoll = (await store.listMissionEvents(mission.id)).map(
      (event) => event.event_type,
    )
    expect(typesAfterUnchangedPoll.filter((type) => type === 'device_updated')).toHaveLength(1)
    const trackerTwo = (await store.listDevices(mission.id)).find(
      (device: { readonly device_id: string }) => device.device_id === 'tracker-2',
    )
    expect(trackerTwo).toMatchObject({ last_seen: '2026-07-10T12:05:00.000Z' })
  })

  it('flushes backup diagnostic phases and aggregate tracking metrics without operational identity [DON-244]', async () => {
    const operation = { id: 'backup-operation', type: 'backup' as const, requestedAtMs: 10 }
    const storageDiagnostics: StorageDiagnosticsPort = {
      createOperation: vi.fn(() => operation),
      requested: vi.fn().mockResolvedValue(undefined),
      started: vi.fn().mockResolvedValue(undefined),
      phase: vi.fn().mockResolvedValue(undefined),
      completed: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(undefined),
      startMission: vi.fn().mockResolvedValue(undefined),
      recordTrackingBatch: vi.fn().mockResolvedValue(undefined),
      recordInsertedPositions: vi.fn().mockResolvedValue(undefined),
    }
    store = await createStore({ storageDiagnostics })
    const mission = await store.createMission({
      name: 'Private Mission Name',
      start_time: '2026-07-10T12:00:00.000Z',
    })
    await store.upsertDevicesBulk({
      mission_id: mission.id,
      devices: [
        { device_id: 'private-device', name: 'Private Device', color: '#00AAFF', status: 'online' },
      ],
    })
    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: [
        {
          device_id: 'private-device',
          lat: 52.0,
          lon: -9.5,
          timestamp: '2026-07-10T12:00:30.000Z',
        },
      ],
    })
    await store.syncBackup('interval')

    expect(storageDiagnostics.startMission).toHaveBeenCalledWith({
      startedAt: '2026-07-10T12:00:00.000Z',
    })
    expect(storageDiagnostics.recordTrackingBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceCount: 1,
        changedDeviceEventCount: 0,
      }),
    )
    expect(storageDiagnostics.recordTrackingBatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ missionId: expect.anything(), deviceId: expect.anything() }),
    )
    expect(storageDiagnostics.recordInsertedPositions).toHaveBeenCalledWith(
      expect.objectContaining({
        insertedPositionCount: 1,
        positionTelemetryEventCount: 0,
      }),
    )
    expect(storageDiagnostics.requested).toHaveBeenCalledWith(operation, {
      queueDepth: 1,
      trigger: 'interval',
    })
    expect(storageDiagnostics.started).toHaveBeenCalledWith(operation)
    expect(vi.mocked(storageDiagnostics.phase).mock.calls.map((call) => call[1])).toEqual([
      'copied',
      'sanity_check_started',
      'sanity_checked',
      'renamed',
    ])
    expect(storageDiagnostics.completed).toHaveBeenCalledWith(operation)
    expect(storageDiagnostics.failed).not.toHaveBeenCalled()
  })

  it('keeps mission backup fail-open when diagnostics cannot create an operation token [DON-244]', async () => {
    const storageDiagnostics: StorageDiagnosticsPort = {
      createOperation: vi.fn(() => {
        throw new Error('diagnostics unavailable')
      }),
      requested: vi.fn(),
      started: vi.fn(),
      phase: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn(),
      startMission: vi.fn(),
      recordTrackingBatch: vi.fn(),
      recordInsertedPositions: vi.fn(),
    }
    store = await createStore({ storageDiagnostics })
    const mission = await store.createMission({ name: 'Diagnostics Failure Mission' })

    await expect(store.syncBackup('interval')).resolves.toBe(
      path.join(userDataPath!, 'mission-store.backup.sqlite'),
    )
    expect((await store.listMissionEvents(mission.id)).map((event) => event.event_type)).toContain(
      'mission_backup_synced',
    )
  })

  it('emits create/update/delete audit events for markers, drawings, helicopters, and GPX imports (DON-163)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Audit Trail Mission' })

    const marker = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    await store.upsertMarker({ id: marker.id, mission_id: mission.id, ...SAMPLE_MARKER, name: 'IPP edited' })
    await store.deleteMarker(marker.id)

    const drawing = await store.upsertDrawing({ mission_id: mission.id, ...SAMPLE_DRAWING })
    await store.upsertDrawing({ id: drawing.id, mission_id: mission.id, ...SAMPLE_DRAWING, name: 'Sector A edited' })
    await store.deleteDrawing(drawing.id)

    const helicopter = await store.upsertHelicopter({ mission_id: mission.id, ...SAMPLE_HELICOPTER })
    await store.upsertHelicopter({ mission_id: mission.id, ...SAMPLE_HELICOPTER, call_sign: 'Rescue 116' })
    await store.deleteHelicopter(helicopter.id)

    const gpx = await store.upsertGpxImport({ mission_id: mission.id, ...SAMPLE_GPX })
    await store.upsertGpxImport({ id: gpx.id, mission_id: mission.id, ...SAMPLE_GPX, display_name: 'Ridge Track edited' })
    await store.deleteGpxImport(gpx.id)

    const types = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(types).toEqual(
      expect.arrayContaining([
        'marker_created',
        'marker_updated',
        'marker_deleted',
        'drawing_created',
        'drawing_updated',
        'drawing_deleted',
        'helicopter_created',
        'helicopter_updated',
        'helicopter_deleted',
        'gpx_import_created',
        'gpx_import_updated',
        'gpx_import_deleted',
      ]),
    )

    // These are all non-telemetry, so they surface in the default review feed.
    const auditTypes = (await store.listAuditEvents(mission.id, { limit: 5000 })).map(
      (event) => event.event_type,
    )
    expect(auditTypes).toContain('marker_deleted')
    expect(auditTypes).toContain('drawing_created')
    expect(auditTypes).toContain('helicopter_updated')
    expect(auditTypes).toContain('gpx_import_deleted')
  })

  it('keeps marker, drawing, and GPX creation timestamps immutable across edits [DON-231]', async () => {
    vi.useFakeTimers()
    store = await createStore()
    const mission = await store.createMission({ name: 'Immutable Timestamp Mission' })

    vi.setSystemTime(new Date('2026-07-06T12:00:00.000Z'))
    const marker = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    const drawing = await store.upsertDrawing({ mission_id: mission.id, ...SAMPLE_DRAWING })
    const gpx = await store.upsertGpxImport({ mission_id: mission.id, ...SAMPLE_GPX })

    const createdMarker = await store.getMarker(marker.id)
    const createdDrawing = await store.getDrawing(drawing.id)
    const createdGpx = (await store.listGpxImports(mission.id)).find((row) => row.id === gpx.id)
    expect(createdGpx).toBeDefined()

    vi.setSystemTime(new Date('2026-07-06T13:00:00.000Z'))
    await store.upsertMarker({
      id: marker.id,
      mission_id: mission.id,
      ...SAMPLE_MARKER,
      name: 'IPP edited',
    })
    await store.upsertDrawing({
      id: drawing.id,
      mission_id: mission.id,
      ...SAMPLE_DRAWING,
      name: 'Sector A edited',
    })
    await store.upsertGpxImport({
      id: gpx.id,
      mission_id: mission.id,
      ...SAMPLE_GPX,
      display_name: 'Ridge Track edited',
    })

    const editedMarker = await store.getMarker(marker.id)
    const editedDrawing = await store.getDrawing(drawing.id)
    const editedGpx = (await store.listGpxImports(mission.id)).find((row) => row.id === gpx.id)
    expect(editedGpx).toBeDefined()

    expect(editedMarker).toMatchObject({
      mission_id: mission.id,
      name: 'IPP edited',
      created_at: createdMarker.created_at,
      updated_at: '2026-07-06T13:00:00.000Z',
    })
    expect(editedDrawing).toMatchObject({
      mission_id: mission.id,
      name: 'Sector A edited',
      created_at: createdDrawing.created_at,
      updated_at: '2026-07-06T13:00:00.000Z',
    })
    expect(editedGpx).toMatchObject({
      mission_id: mission.id,
      display_name: 'Ridge Track edited',
      imported_at: createdGpx!.imported_at,
      updated_at: '2026-07-06T13:00:00.000Z',
    })
  })

  it('writes the audit event atomically with the row so neither lands alone (DON-163)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Atomic Mission' })
    const marker = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })

    const beforeDelete = (await store.listMissionEvents(mission.id)).filter(
      (event) => event.event_type === 'marker_deleted',
    )
    expect(beforeDelete).toHaveLength(0)

    await store.deleteMarker(marker.id)
    const afterDelete = (await store.listMissionEvents(mission.id)).filter(
      (event) => event.event_type === 'marker_deleted',
    )
    expect(afterDelete).toHaveLength(1)
  })

  it('does not emit a delete event when the row does not exist (DON-163)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'No-op Delete Mission' })

    await expect(store.deleteMarker('does-not-exist')).resolves.toBe(false)
    const types = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(types).not.toContain('marker_deleted')
  })

  // --- DON-161: writable guard on deletes ---

  it('refuses to delete records from a finished mission and preserves them (DON-161)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Locked Mission' })

    const marker = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    const drawing = await store.upsertDrawing({ mission_id: mission.id, ...SAMPLE_DRAWING })
    const helicopter = await store.upsertHelicopter({ mission_id: mission.id, ...SAMPLE_HELICOPTER })
    const gpx = await store.upsertGpxImport({ mission_id: mission.id, ...SAMPLE_GPX })

    await store.finishMission(mission.id)

    await expect(store.deleteMarker(marker.id)).rejects.toThrow(/finished mission/)
    await expect(store.deleteDrawing(drawing.id)).rejects.toThrow(/finished mission/)
    await expect(store.deleteHelicopter(helicopter.id)).rejects.toThrow(/finished mission/)
    await expect(store.deleteGpxImport(gpx.id)).rejects.toThrow(/finished mission/)

    // The locked records must survive the refused deletes.
    await expect(store.listMarkers(mission.id)).resolves.toHaveLength(1)
    await expect(store.listDrawings(mission.id)).resolves.toHaveLength(1)
    await expect(store.listHelicopters(mission.id)).resolves.toHaveLength(1)
    await expect(store.listGpxImports(mission.id)).resolves.toHaveLength(1)
  })

  it('refuses to delete records from a finalized mission (DON-161)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Finalized Mission' })
    const marker = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })

    await store.finishMission(mission.id)
    await store.finalizeMission(mission.id)

    await expect(store.deleteMarker(marker.id)).rejects.toThrow(/finalized mission|finished mission/)
    await expect(store.listMarkers(mission.id)).resolves.toHaveLength(1)
  })

  // --- DON-162: real per-mission archive + finalize event sequence ---

  it('writes a real, standalone per-mission archive zip on finalize (DON-162)', async () => {
    const { readZipArchive } = require('../../electron/zip-archive.cjs') as {
      readonly readZipArchive: (buffer: Buffer) => ReadonlyMap<string, Buffer>
    }

    store = await createStore()
    const mission = await store.createMission({ name: 'Archive Mission' })
    await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    await store.finishMission(mission.id)

    const result = await store.finalizeMission(mission.id)
    const archivePath = result.archive.archive_path

    // The archive must be a real, standalone file — NOT the shared rolling backup.
    expect(archivePath).not.toBe(path.join(userDataPath!, 'mission-store.backup.sqlite'))
    expect(path.dirname(archivePath)).toBe(path.join(userDataPath!, 'archives'))
    const { access } = await import('node:fs/promises')
    await expect(access(archivePath)).resolves.toBeUndefined()

    const { readFile } = await import('node:fs/promises')
    const entries = readZipArchive(await readFile(archivePath))
    expect([...entries.keys()]).toEqual(
      expect.arrayContaining(['manifest.json', 'mission.json', 'mission-store.sqlite']),
    )
    const manifest = JSON.parse(entries.get('manifest.json')!.toString('utf8'))
    expect(manifest.mission_id).toBe(mission.id)
    const archivedMission = JSON.parse(entries.get('mission.json')!.toString('utf8'))
    expect(archivedMission.id).toBe(mission.id)
    expect(entries.get('mission-store.sqlite')!.length).toBeGreaterThan(0)
  })

  it('does not overwrite an earlier mission archive when a later mission finalizes (DON-162)', async () => {
    const { readFile } = await import('node:fs/promises')
    store = await createStore()

    const first = await store.createMission({ name: 'First Mission' })
    await store.finishMission(first.id)
    const firstArchive = (await store.finalizeMission(first.id)).archive.archive_path
    const firstBytes = await readFile(firstArchive)

    const second = await store.createMission({ name: 'Second Mission' })
    await store.finishMission(second.id)
    const secondArchive = (await store.finalizeMission(second.id)).archive.archive_path

    expect(secondArchive).not.toBe(firstArchive)
    // The first archive must still exist, unmodified, after the second finalize.
    await expect(readFile(firstArchive)).resolves.toEqual(firstBytes)
  })

  it('emits the full finalize event sequence matching Rust (DON-162)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Finalize Sequence Mission' })
    await store.finishMission(mission.id)
    await store.finalizeMission(mission.id)

    const types = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    const finalizeSlice = types.filter((type) =>
      [
        'mission_finished',
        'mission_finalize_requested',
        'mission_archive_succeeded',
        'mission_finalized',
      ].includes(type),
    )
    expect(finalizeSlice).toEqual([
      'mission_finished',
      'mission_finalize_requested',
      'mission_archive_succeeded',
      'mission_finalized',
    ])
  })

  it('recovers idempotently when finalization is interrupted after archive success [DON-209]', async () => {
    store = await createStore({
      finalizeMissionFaultInjection: {
        afterArchiveSucceededEvent: true,
      },
    })
    const mission = await store.createMission({ name: 'Interrupted Finalize Mission' })
    await store.finishMission(mission.id)

    await expect(store.finalizeMission(mission.id)).rejects.toThrow(
      /Injected finalize interruption after archive success/,
    )
    expect((await store.listMissions()).find((entry) => entry.id === mission.id)?.status).toBe(
      'finished',
    )
    let eventTypes = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(eventTypes.filter((eventType) => eventType === 'mission_archive_succeeded')).toHaveLength(1)
    expect(eventTypes).not.toContain('mission_finalized')

    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })

    const retry = await store.finalizeMission(mission.id)

    expect(retry.mission.status).toBe('finalized')
    eventTypes = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(eventTypes.filter((eventType) => eventType === 'mission_archive_succeeded')).toHaveLength(1)
    expect(eventTypes.filter((eventType) => eventType === 'mission_finalized')).toHaveLength(1)
  })

  it('serializes concurrent finalize requests so a mission finalizes once with one archive [DON-232]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Concurrent Finalize Mission' })
    await store.finishMission(mission.id)

    await expect(Promise.all([
      store.finalizeMission(mission.id),
      store.finalizeMission(mission.id),
    ])).resolves.toHaveLength(2)

    const eventTypes = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(eventTypes.filter((eventType) => eventType === 'mission_archive_succeeded')).toHaveLength(1)
    expect(eventTypes.filter((eventType) => eventType === 'mission_finalized')).toHaveLength(1)
    await expect(store.getMission(mission.id)).resolves.toMatchObject({ status: 'finalized' })
  })

  it('creates a fresh archive when a mission is unlocked and finalized again [DON-232]', async () => {
    store = await createStore({
      readAdminRoster: async () => ['Duty Admin'],
    })
    const mission = await store.createMission({
      name: 'Refinalize Mission',
      start_time: '2026-07-06T12:00:00.000Z',
    })
    await store.finishMission(mission.id)

    const firstFinalize = await store.finalizeMission(mission.id)

    await expect(
      store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Correction requested during review.',
      }),
    ).resolves.toMatchObject({ status: 'finished' })

    await new Promise((resolve) => setTimeout(resolve, 5))
    const secondFinalize = await store.finalizeMission(mission.id)

    expect(secondFinalize.archive.archive_path).not.toBe(firstFinalize.archive.archive_path)
    const archiveSucceededEvents = (await store.listMissionEvents(mission.id)).filter(
      (event) => event.event_type === 'mission_archive_succeeded',
    )
    expect(archiveSucceededEvents).toHaveLength(2)
    expect(
      archiveSucceededEvents.map((event) => JSON.parse(event.details_json ?? '{}').archive_path),
    ).toEqual([firstFinalize.archive.archive_path, secondFinalize.archive.archive_path])
  })

  it('createMissionArchive builds an archive for a finished mission (DON-162 / DON-34)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Direct Archive Mission' })
    await store.finishMission(mission.id)

    const archive = await store.createMissionArchive(mission.id)
    expect(archive.mission_id).toBe(mission.id)
    expect(path.dirname(archive.archive_path)).toBe(path.join(userDataPath!, 'archives'))
    const { access } = await import('node:fs/promises')
    await expect(access(archive.archive_path)).resolves.toBeUndefined()
  })

  it('createMissionArchive refuses missions that are not finished or finalized (DON-162)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Active Archive Mission' })
    await expect(store.createMissionArchive(mission.id)).rejects.toThrow(
      /finished or finalized/,
    )
  })

  async function createStore(options: {
    readonly readAdminRoster?: () => Promise<readonly string[]>
    readonly backupFaultInjection?: {
      readonly afterTemporaryBackup?: boolean
      readonly corruptTemporarySnapshotBeforeSanityCheck?: boolean
    }
    readonly archiveFaultInjection?: {
      readonly corruptSnapshotBeforeZip?: boolean
    }
    readonly finalizeMissionFaultInjection?: {
      readonly afterArchiveSucceededEvent?: boolean
    }
    readonly storageDiagnostics?: StorageDiagnosticsPort
  } = {}): Promise<ElectronMissionStore> {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-mission-'))
    return createElectronMissionStore({ userDataPath, ...options })
  }
})
