import { describe, expect, it, vi } from 'vitest'

import {
  createManagedRuntimeServices,
  createNoopRuntimeServiceHandles,
  stopRuntimeServices,
  type RuntimeBootstrapSettings,
} from '../../src/features/runtime/runtime-managed-services'

const BASE_SETTINGS: RuntimeBootstrapSettings = {
  autosaveEnabled: true,
  autosaveIntervalMs: 45_000,
  trackingPollIntervalMs: 60_000,
  trackingCacheEnabled: true,
  trackingConfig: {
    baseUrl: 'https://traccar.example.com',
    email: 'ops@example.com',
    password: 'secret',
  },
}

describe('runtime-managed-services', () => {
  it('stops autosave if tracking startup fails', async () => {
    const stopAutosave = vi.fn()

    await expect(
      createManagedRuntimeServices({
        runtimeSettings: BASE_SETTINGS,
        missionStore: createMissionStoreStub(),
        startMissionAutosave: vi.fn().mockReturnValue({
          stop: stopAutosave,
          requestSync: vi.fn().mockResolvedValue(undefined),
        }),
        startTrackingRuntime: vi.fn().mockRejectedValue(new Error('tracking unavailable')),
        createClient: vi.fn().mockReturnValue({}),
        createPoller: vi.fn(),
        createTrackingCache: vi.fn().mockReturnValue({
          read: vi.fn().mockResolvedValue(null),
          write: vi.fn().mockResolvedValue('/tmp/tracking-cache.json'),
        }),
        applySnapshot: vi.fn(),
        applyStatus: vi.fn(),
        readTrackingRuntimeConfig: vi.fn(),
      }),
    ).rejects.toThrow('tracking unavailable')

    expect(stopAutosave).toHaveBeenCalledTimes(1)
  })

  it('creates the tracking cache only when cache support is enabled', async () => {
    const createTrackingCache = vi.fn().mockReturnValue({
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue('/tmp/tracking-cache.json'),
    })

    await createManagedRuntimeServices({
      runtimeSettings: {
        ...BASE_SETTINGS,
        trackingCacheEnabled: false,
      },
      missionStore: createMissionStoreStub(),
      startMissionAutosave: vi.fn().mockReturnValue({
        stop: vi.fn(),
        requestSync: vi.fn().mockResolvedValue(undefined),
      }),
      startTrackingRuntime: vi.fn().mockResolvedValue(vi.fn()),
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn(),
      createTrackingCache,
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      readTrackingRuntimeConfig: vi.fn(),
    })

    expect(createTrackingCache).not.toHaveBeenCalled()
  })

  it('stops both services through the shared lifecycle helpers', () => {
    const stopAutosave = vi.fn()
    const stopTracking = vi.fn()

    const noopHandles = createNoopRuntimeServiceHandles()
    expect(() => stopRuntimeServices(noopHandles)).not.toThrow()

    stopRuntimeServices({
      stopAutosave,
      stopTracking,
    })

    expect(stopAutosave).toHaveBeenCalledTimes(1)
    expect(stopTracking).toHaveBeenCalledTimes(1)
  })
})

function createMissionStoreStub() {
  return {
    getActiveMission: vi.fn().mockResolvedValue(null),
    syncBackup: vi.fn().mockResolvedValue('/tmp/mission.sqlite'),
    listPositions: vi.fn().mockResolvedValue([]),
    upsertDevice: vi.fn().mockResolvedValue(undefined),
    addPosition: vi.fn().mockResolvedValue(undefined),
  }
}
