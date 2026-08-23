import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installBrowserHarnessApi } from '../../src/features/browser-validation/browser-harness-api'
import {
  getBrowserHarnessStore,
  readBrowserHarnessState,
  resetBrowserHarnessStore,
} from '../../src/features/browser-validation/browser-harness-store'

describe('browser harness position persistence', () => {
  beforeEach(() => {
    resetBrowserHarnessStore()
  })

  afterEach(() => {
    delete window.__SARTRACKER_BROWSER_HARNESS__
    vi.restoreAllMocks()
  })

  it('persists a bulk tracking batch with one bounded storage write', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Bulk Browser Harness Mission',
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setItem.mockClear()

    const positions = await store.addPositionsBulk({
      mission_id: mission.id,
      positions: Array.from({ length: 3 }, (_, index) => ({
        device_id: 'team-1',
        source_position_id: `source-${index + 1}`,
        lat: 52 + index / 10_000,
        lon: -9 - index / 10_000,
        timestamp: new Date(Date.UTC(2026, 6, 29, 20, 0, index)).toISOString(),
        data_origin: 'live' as const,
      })),
    })

    expect(positions).toHaveLength(3)
    expect(readBrowserHarnessState().positions).toHaveLength(3)
    expect(setItem).toHaveBeenCalledTimes(1)
  })

  it('applies the existing tracking retention cap to one large bulk batch', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Bulk Retention Mission',
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setItem.mockClear()

    const positions = await store.addPositionsBulk({
      mission_id: mission.id,
      positions: Array.from({ length: 2_100 }, (_, index) => ({
        device_id: 'team-1',
        lat: 52 + index / 100_000,
        lon: -9 - index / 100_000,
        timestamp: new Date(Date.UTC(2026, 6, 29, 20, 0, index)).toISOString(),
        data_origin: 'live' as const,
      })),
    })

    const persistedState = readBrowserHarnessState()
    expect(positions).toHaveLength(2_100)
    expect(persistedState.positions).toHaveLength(2_000)
    expect(persistedState.positions[0]?.timestamp).toBe('2026-07-29T20:01:40.000Z')
    expect(persistedState.positions.at(-1)?.timestamp).toBe('2026-07-29T20:34:59.000Z')
    expect(
      persistedState.missionEvents.filter((event) => event.event_type === 'position_recorded'),
    ).toHaveLength(0)
    expect(setItem).toHaveBeenCalledTimes(1)
  })

  it('injects a tracking snapshot through the bulk persistence boundary', async () => {
    const store = getBrowserHarnessStore()
    await store.createMission({ name: 'Injected Browser Harness Mission' })
    installBrowserHarnessApi()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setItem.mockClear()
    const positions = Array.from({ length: 3 }, (_, index) => ({
      id: `tracking-${index + 1}`,
      device_id: 'team-1',
      lat: 52 + index / 10_000,
      lon: -9 - index / 10_000,
      altitude: null,
      speed: null,
      battery: null,
      accuracy: null,
      timestamp: new Date(Date.UTC(2026, 6, 29, 20, 0, index)).toISOString(),
      source: 'traccar',
      data_origin: 'live' as const,
      cache_age_seconds: null,
      device_cache_stale: false,
    }))

    await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
      devices: [],
      positions: positions.slice(0, 1),
      breadcrumbs: positions.slice(1),
    })

    expect(readBrowserHarnessState().positions).toHaveLength(3)
    expect(setItem).toHaveBeenCalledTimes(1)
  })
})

describe('browser harness store', () => {
  beforeEach(() => {
    resetBrowserHarnessStore(false)
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  it('persists devices and positions for the active mission', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Harness Mission' })

    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'alpha',
      name: 'Alpha Team',
      color: '#38bdf8',
      status: 'online',
      last_seen: '2026-04-10T12:00:00.000Z',
    })
    await store.addPosition({
      mission_id: mission.id,
      device_id: 'alpha',
      lat: 52,
      lon: -9.7,
      timestamp: '2026-04-10T12:00:00.000Z',
      data_origin: 'live',
    })
    await store.addPosition({
      mission_id: mission.id,
      device_id: 'alpha',
      lat: 52.0002,
      lon: -9.7003,
      timestamp: '2026-04-10T12:05:00.000Z',
      data_origin: 'live',
    })

    expect(await store.getActiveMission()).toMatchObject({ id: mission.id, status: 'active' })
    expect(await store.listDevices(mission.id)).toHaveLength(1)
    expect(await store.listPositions(mission.id)).toHaveLength(2)

    const persistedState = readBrowserHarnessState()
    expect(persistedState.currentMissionId).toBe(mission.id)
    expect(persistedState.devices).toHaveLength(1)
    expect(persistedState.positions).toHaveLength(2)
    expect(persistedState.missionEvents.map((event) => event.event_type)).toContain('mission_created')
    expect(persistedState.missionEvents.map((event) => event.event_type)).not.toContain(
      'position_recorded',
    )
  })

  it('mirrors the audited half-open outing lifecycle for browser validation', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Outing Harness',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    const first = await store.createOuting({
      mission_id: mission.id,
      label: 'Outing 1',
      started_at: '2026-08-20T09:00:00.000Z',
    })
    await store.endOuting({
      mission_id: mission.id,
      outing_id: first.id,
      ended_at: '2026-08-20T11:00:00.000Z',
    })
    await store.createOuting({
      mission_id: mission.id,
      label: 'Outing 2',
      started_at: '2026-08-20T11:00:00.000Z',
    })

    await expect(store.listOutings(mission.id)).resolves.toHaveLength(2)
    expect(readBrowserHarnessState().missionEvents.map((event) => event.event_type)).toEqual(
      expect.arrayContaining(['outing_started', 'outing_ended']),
    )
  })

  it('returns one bounded Mission Review audit page with the exact breadcrumb count', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Review Mission' })
    await store.addPosition({
      mission_id: mission.id,
      device_id: 'alpha',
      lat: 52,
      lon: -9.7,
      timestamp: '2026-08-22T18:00:00.000Z',
      data_origin: 'live',
    })

    await expect(store.readMissionReview({
      missionId: mission.id,
      includeTelemetry: false,
      auditLimit: 1,
    })).resolves.toEqual({
      auditEvents: [expect.objectContaining({ event_type: 'mission_created' })],
      breadcrumbCount: 1,
    })
  })

  it('caps browser-only tracking persistence so large breadcrumb imports do not exceed session storage', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Large Tracking Mission' })

    for (let index = 0; index < 2_100; index += 1) {
      await store.addPosition({
        mission_id: mission.id,
        device_id: 'alpha',
        lat: 52 + index / 100_000,
        lon: -9.7 - index / 100_000,
        timestamp: new Date(Date.UTC(2026, 4, 15, 6, 0, index)).toISOString(),
        data_origin: 'live',
      })
    }

    const persistedState = readBrowserHarnessState()
    const recordedPositionEvents = persistedState.missionEvents.filter(
      (event) => event.event_type === 'position_recorded',
    )

    expect(persistedState.positions).toHaveLength(2_000)
    expect(recordedPositionEvents).toHaveLength(0)
    expect(persistedState.positions[0]?.timestamp).toBe('2026-05-15T06:01:40.000Z')
    expect(persistedState.positions.at(-1)?.timestamp).toBe('2026-05-15T06:34:59.000Z')
  }, 30_000)

  it('change-gates browser-harness device events while preserving last_seen [DON-245]', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Device Change Gate Mission' })
    const baseDevice = {
      mission_id: mission.id,
      device_id: 'alpha',
      name: 'Alpha Team',
      color: '#38bdf8',
      status: 'online',
    }

    await store.upsertDevice({ ...baseDevice, last_seen: '2026-07-10T12:00:00.000Z' })
    const lastSeenOnly = await store.upsertDevice({
      ...baseDevice,
      last_seen: '2026-07-10T12:00:05.000Z',
    })
    await store.upsertDevice({
      ...baseDevice,
      status: 'offline',
      last_seen: '2026-07-10T12:00:10.000Z',
    })

    expect(lastSeenOnly.last_seen).toBe('2026-07-10T12:00:05.000Z')
    const eventTypes = (await store.listMissionEvents(mission.id)).map(
      (event) => event.event_type,
    )
    expect(eventTypes.filter((type) => type === 'device_created')).toHaveLength(1)
    expect(eventTypes.filter((type) => type === 'device_updated')).toHaveLength(1)
  })

  it('finalizes and unlocks a mission using the configured admin roster', async () => {
    window.localStorage.setItem(
      'sartracker:browser-settings',
      JSON.stringify({
        missionDefaults: {
          adminRoster: ['Ops Lead'],
        },
      }),
    )

    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Governance Mission' })
    await store.finishMission(mission.id)

    const finalized = await store.finalizeMission(mission.id)
    expect(finalized.mission.status).toBe('finalized')
    expect(finalized.archive.archive_path).toContain(`${mission.id}-archive.zip`)

    await expect(
      store.upsertMarker({
        mission_id: mission.id,
        type: 'clue',
        name: 'Blocked Marker',
        lat: 52,
        lon: -9.7,
        irish_grid_e: 496584,
        irish_grid_n: 591256,
        display_order: 1,
      }),
    ).rejects.toThrow(/Cannot write data to finished mission .* resume the mission or unlock it first/)

    const unlocked = await store.unlockFinalizedMission({
      mission_id: mission.id,
      admin_name: 'Ops Lead',
      reason: 'Need to correct mission notes',
    })
    expect(unlocked.status).toBe('finished')
    expect(await store.listMissionEvents(mission.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'mission_finalized' }),
        expect.objectContaining({ event_type: 'mission_unlocked' }),
      ]),
    )
  })

  it('records opened paths for review workflows', async () => {
    const store = getBrowserHarnessStore()

    await store.openExternalPath('/tmp/review-archive.zip')

    expect(readBrowserHarnessState().openedPaths).toEqual(['/tmp/review-archive.zip'])
  })

  it('persists GPX imports and audit events for the active mission', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'GPX Mission' })

    await store.upsertGpxImport({
      mission_id: mission.id,
      source_path: '/tracks/alpha.gpx',
      file_name: 'alpha.gpx',
      display_name: 'Alpha Track',
      geometry_json: '{"type":"MultiLineString","coordinates":[]}',
      metadata_json: '{"trackCount":1,"pointCount":2}',
    })

    expect(await store.listGpxImports(mission.id)).toEqual([
      expect.objectContaining({
        source_path: '/tracks/alpha.gpx',
        display_name: 'Alpha Track',
      }),
    ])

    expect(readBrowserHarnessState().missionEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'gpx_import_created' }),
      ]),
    )
  })

  it('persists helicopters per slot and records audit events', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Helicopter Mission' })

    await store.upsertHelicopter({
      mission_id: mission.id,
      slot_key: 'slot_4',
      call_sign: 'Air Corps 2',
      hex_id: '4CAE44',
      lat: 52.2,
      lon: -9.8,
      altitude: 1800,
      speed: 120,
      heading: 45,
      last_update: '2026-04-11T12:05:00.000Z',
    })

    expect(await store.listHelicopters(mission.id)).toEqual([
      expect.objectContaining({
        slot_key: 'slot_4',
        call_sign: 'Air Corps 2',
      }),
    ])

    expect(readBrowserHarnessState().missionEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'helicopter_created' }),
      ]),
    )
  })
})
