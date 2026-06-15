import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly readAdminRoster?: () => Promise<readonly string[]>
  }) => ElectronMissionStore
}

type ElectronMissionStore = {
  readonly close: () => void
  readonly info: () => Promise<{
    readonly schema_version: number
    readonly database_path: string
    readonly backup_path: string
  }>
  readonly syncBackup: () => Promise<string>
  readonly createMission: (input: { readonly name: string; readonly start_time?: string }) => Promise<{ readonly id: string; readonly status: string }>
  readonly getActiveMission: () => Promise<{ readonly id: string; readonly status: string } | null>
  readonly listMissions: () => Promise<readonly { readonly id: string }[]>
  readonly pauseMission: (missionId: string) => Promise<{ readonly status: string }>
  readonly resumeMission: (missionId: string) => Promise<{ readonly status: string }>
  readonly finishMission: (missionId: string) => Promise<{ readonly status: string }>
  readonly listMissionEvents: (missionId: string) => Promise<readonly { readonly event_type: string }[]>
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
  }) => Promise<{ readonly device_id: string }>
  readonly addPosition: (input: {
    readonly mission_id: string
    readonly device_id: string
    readonly lat: number
    readonly lon: number
    readonly timestamp?: string
  }) => Promise<{ readonly device_id: string }>
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
  }) => Promise<{ readonly id: string }>
  readonly deleteMarker: (markerId: string) => Promise<boolean>
  readonly listMarkers: (missionId: string) => Promise<readonly { readonly id: string }[]>
  readonly listDrawings: (missionId: string) => Promise<readonly { readonly id: string }[]>
  readonly listHelicopters: (missionId: string) => Promise<readonly { readonly id: string }[]>
  readonly listGpxImports: (missionId: string) => Promise<readonly { readonly id: string }[]>
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
      schema_version: 3,
      database_path: path.join(userDataPath!, 'mission-store.sqlite'),
      backup_path: path.join(userDataPath!, 'mission-store.backup.sqlite'),
    })
    expect(activeMission).toMatchObject({ id: mission.id, status: 'paused' })
    await expect(store.listMissions()).resolves.toHaveLength(1)
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
        'position_recorded',
        'mission_backup_synced',
        'mission_paused',
        'mission_resumed',
        'mission_finished',
      ]),
    )
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

    // Generate a burst of telemetry that would dominate an unfiltered query.
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

    // Telemetry can be opted back in, but still respects the bound.
    const withTelemetry = await store.listAuditEvents(mission.id, {
      includeTelemetry: true,
      limit: 10,
    })
    expect(withTelemetry).toHaveLength(10)
    // Bounded query returns the most recent events.
    expect(withTelemetry.some((event) => event.event_type === 'position_recorded')).toBe(true)
    for (let index = 1; index < withTelemetry.length; index += 1) {
      expect(
        Date.parse(withTelemetry[index - 1]!.timestamp) >=
          Date.parse(withTelemetry[index]!.timestamp),
      ).toBe(true)
    }
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

  it('emits device_created on first insert and device_updated on conflict (DON-164)', async () => {
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
      name: 'Tracker One Renamed',
      color: '#00AAFF',
      status: 'online',
    })

    const types = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(types.filter((type) => type === 'device_created')).toHaveLength(1)
    expect(types.filter((type) => type === 'device_updated')).toHaveLength(1)

    // device_created is NOT telemetry, so it surfaces in the default review feed; the
    // subsequent device_updated is telemetry and must be filtered out.
    const auditTypes = (await store.listAuditEvents(mission.id)).map((event) => event.event_type)
    expect(auditTypes).toContain('device_created')
    expect(auditTypes).not.toContain('device_updated')
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

  async function createStore(): Promise<ElectronMissionStore> {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-mission-'))
    return createElectronMissionStore({ userDataPath })
  }
})
