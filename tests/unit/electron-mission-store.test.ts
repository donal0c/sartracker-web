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
        'device_updated',
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

  async function createStore(): Promise<ElectronMissionStore> {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-mission-'))
    return createElectronMissionStore({ userDataPath })
  }
})
