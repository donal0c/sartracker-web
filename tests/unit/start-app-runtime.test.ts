import { describe, expect, it, vi } from 'vitest'

import type { AutosaveStore } from '../../src/features/persistence/mission-autosave'
import type { MissionStore } from '../../src/infrastructure/mission-store/tauri-mission-store'
import { startAppRuntime } from '../../src/features/runtime/start-app-runtime'

describe('app runtime startup', () => {
  it('registers the service worker on startup', async () => {
    const registerServiceWorker = vi.fn().mockResolvedValue(undefined)

    await startAppRuntime({
      registerServiceWorker,
      isTauriRuntimeAvailable: vi.fn().mockReturnValue(false),
      createMissionStore: vi.fn(),
      startMissionAutosave: vi.fn(),
      startMissionRuntime: vi.fn(),
      startTrackingRuntime: vi.fn(),
    })

    expect(registerServiceWorker).toHaveBeenCalledTimes(1)
  })

  it('starts mission autosave only inside a Tauri runtime', async () => {
    const store: MissionStore & AutosaveStore = {
      info: vi.fn(),
      createMissionArchive: vi.fn(),
      createMission: vi.fn(),
      upsertDevice: vi.fn(),
      getDevice: vi.fn(),
      listDevices: vi.fn(),
      addPosition: vi.fn(),
      listPositions: vi.fn(),
      latestPositions: vi.fn(),
      listMissionEvents: vi.fn(),
      upsertMarker: vi.fn(),
      getMarker: vi.fn(),
      listMarkers: vi.fn(),
      deleteMarker: vi.fn(),
      upsertDrawing: vi.fn(),
      getDrawing: vi.fn(),
      listDrawings: vi.fn(),
      deleteDrawing: vi.fn(),
      getMission: vi.fn(),
      listMissions: vi.fn(),
      getActiveMission: vi.fn(),
      getRecoverableMission: vi.fn(),
      pauseMission: vi.fn(),
      resumeMission: vi.fn(),
      finishMission: vi.fn(),
      syncBackup: vi.fn(),
    }
    const createMissionStore = vi.fn().mockReturnValue(store)
    const startMissionAutosave = vi.fn().mockReturnValue(vi.fn())
    const startMissionRuntime = vi.fn().mockResolvedValue({})
    const startTrackingRuntime = vi.fn().mockResolvedValue(vi.fn())

    await startAppRuntime({
      registerServiceWorker: vi.fn().mockResolvedValue(undefined),
      isTauriRuntimeAvailable: vi.fn().mockReturnValue(true),
      createMissionStore,
      startMissionAutosave,
      startMissionRuntime,
      startTrackingRuntime,
    })

    expect(createMissionStore).toHaveBeenCalledTimes(1)
    expect(startMissionAutosave).toHaveBeenCalledWith(store)
    expect(startMissionRuntime).toHaveBeenCalledWith({
      missionStore: store,
      applyRuntime: expect.any(Function),
    })
    expect(startTrackingRuntime).toHaveBeenCalledTimes(1)
  })

  it('does not create the mission store outside Tauri', async () => {
    const createMissionStore = vi.fn()
    const startMissionAutosave = vi.fn()

    await startAppRuntime({
      registerServiceWorker: vi.fn().mockResolvedValue(undefined),
      isTauriRuntimeAvailable: vi.fn().mockReturnValue(false),
      createMissionStore,
      startMissionAutosave,
      startMissionRuntime: vi.fn(),
      startTrackingRuntime: vi.fn(),
    })

    expect(createMissionStore).not.toHaveBeenCalled()
    expect(startMissionAutosave).not.toHaveBeenCalled()
  })
})
