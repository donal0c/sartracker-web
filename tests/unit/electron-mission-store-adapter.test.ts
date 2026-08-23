import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createElectronMissionStore } from '../../src/infrastructure/mission-store/electron-mission-store'

describe('electron mission store adapter', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'sartrackerElectron')
  })

  it('returns the typed mission store exposed by the preload bridge', async () => {
    const missionStore = {
      info: vi.fn().mockResolvedValue({ schema_version: 3 }),
      listBreadcrumbPositions: vi.fn().mockResolvedValue({
        positions: [],
        deviceTotals: [],
      }),
      cancelBreadcrumbQuery: vi.fn().mockResolvedValue(true),
      listOutings: vi.fn().mockResolvedValue([]),
      listMissionParticipants: vi.fn().mockResolvedValue([]),
    }
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: {
        missionStore,
      },
    })

    const store = createElectronMissionStore()

    await expect(store.info()).resolves.toEqual({ schema_version: 3 })
    await expect(
      store.listBreadcrumbPositions?.('mission-a', 5_000, 'request-a'),
    ).resolves.toEqual({ positions: [], deviceTotals: [] })
    await expect(store.cancelBreadcrumbQuery?.('request-a')).resolves.toBe(true)
    await expect(store.listOutings?.('mission-a')).resolves.toEqual([])
    await expect(store.listMissionParticipants?.('mission-a')).resolves.toEqual([])
    expect(missionStore.info).toHaveBeenCalledWith()
    expect(missionStore.listBreadcrumbPositions).toHaveBeenCalledWith(
      'mission-a',
      5_000,
      'request-a',
    )
    expect(missionStore.cancelBreadcrumbQuery).toHaveBeenCalledWith('request-a')
    expect(missionStore.listOutings).toHaveBeenCalledWith('mission-a')
    expect(missionStore.listMissionParticipants).toHaveBeenCalledWith('mission-a')
  })
})
