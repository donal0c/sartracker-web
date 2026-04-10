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
  })
})
