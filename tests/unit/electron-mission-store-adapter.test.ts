import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createElectronMissionStore } from '../../src/infrastructure/mission-store/electron-mission-store'

describe('electron mission store adapter', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'sartrackerElectron')
  })

  it('returns the typed mission store exposed by the preload bridge', async () => {
    const missionStore = {
      info: vi.fn().mockResolvedValue({ schema_version: 3 }),
    }
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: {
        missionStore,
      },
    })

    const store = createElectronMissionStore()

    await expect(store.info()).resolves.toEqual({ schema_version: 3 })
    expect(missionStore.info).toHaveBeenCalledWith()
  })
})
