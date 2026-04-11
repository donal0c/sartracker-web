import { describe, expect, it, beforeEach } from 'vitest'

import {
  getBrowserHarnessStore,
  readBrowserHarnessState,
  resetBrowserHarnessStore,
} from '../../src/features/browser-validation/browser-harness-store'

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
    expect(persistedState.missionEvents.map((event) => event.event_type)).toContain('position_recorded')
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
    ).rejects.toThrow('read-only')

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
})
