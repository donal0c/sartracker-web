import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AutosaveStore } from '../../src/features/persistence/mission-autosave'
import type { MissionStore } from '../../src/infrastructure/mission-store/tauri-mission-store'
import { startAppRuntime } from '../../src/features/runtime/start-app-runtime'
import type { CoreFeatureRuntimeHandles } from '../../src/features/runtime/start-core-feature-runtimes'

describe('app runtime startup', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registers the service worker on startup', async () => {
    const registerServiceWorker = vi.fn().mockResolvedValue(undefined)

    await startAppRuntime({
      registerServiceWorker,
      isTauriRuntimeAvailable: vi.fn().mockReturnValue(false),
      createMissionStore: vi.fn(),
      readRuntimeBootstrapSettings: vi.fn(),
      startMissionAutosave: vi.fn(),
      startMissionRuntime: vi.fn(),
      startMissionGovernanceRuntime: vi.fn(),
      startMarkerRuntime: vi.fn(),
      startDrawingRuntime: vi.fn(),
      startGpxRuntime: vi.fn(),
      startTrackingRuntime: vi.fn(),
    })

    expect(registerServiceWorker).toHaveBeenCalledTimes(1)
  })

  it('starts mission autosave inside the Electron desktop runtime', async () => {
    const store: MissionStore & AutosaveStore = createMissionStoreStub()
    const createMissionStore = vi.fn().mockReturnValue(store)
    const startMissionAutosave = vi.fn().mockReturnValue(createAutosaveController())
    const startMissionRuntime = vi.fn().mockResolvedValue({})
    const startMissionGovernanceRuntime = vi.fn().mockResolvedValue({})
    const startMarkerRuntime = vi.fn().mockResolvedValue({})
    const startDrawingRuntime = vi.fn().mockResolvedValue({})
    const startTrackingRuntime = vi.fn().mockResolvedValue(vi.fn())
    const readRuntimeBootstrapSettings = vi.fn().mockResolvedValue({
      autosaveEnabled: true,
      autosaveIntervalMs: 45_000,
      trackingPollIntervalMs: 60_000,
      trackingCacheEnabled: false,
      trackingConfig: {
        baseUrl: 'https://traccar.example.com',
        email: 'ops@example.com',
        password: 'secret',
      },
    })

    await startAppRuntime({
      registerServiceWorker: vi.fn().mockResolvedValue(undefined),
      isTauriRuntimeAvailable: vi.fn().mockReturnValue(false),
      isElectronRuntimeAvailable: vi.fn().mockReturnValue(true),
      createMissionStore,
      readRuntimeBootstrapSettings,
      startMissionAutosave,
      startMissionRuntime,
      startMissionGovernanceRuntime,
      startMarkerRuntime,
      startDrawingRuntime,
      startGpxRuntime: vi.fn().mockResolvedValue({}),
      startTrackingRuntime,
    })

    expect(createMissionStore).toHaveBeenCalledTimes(1)
    expect(readRuntimeBootstrapSettings).toHaveBeenCalledWith(false)
    expect(startMissionAutosave).toHaveBeenCalledWith(store, {
      intervalMs: 45_000,
    })
    expect(startMissionRuntime).toHaveBeenCalledWith({
      missionStore: store,
      applyRuntime: expect.any(Function),
      requestAutosaveSync: expect.any(Function),
    })
    expect(startMissionGovernanceRuntime).toHaveBeenCalledWith({
      missionStore: store,
      applyRuntime: expect.any(Function),
      requestAutosaveSync: expect.any(Function),
    })
    expect(startMarkerRuntime).toHaveBeenCalledWith({
      markerStore: store,
      attachmentStore: {
        ingest: expect.any(Function),
      },
      applyRuntime: expect.any(Function),
    })
    expect(startDrawingRuntime).toHaveBeenCalledWith({
      drawingStore: store,
      applyRuntime: expect.any(Function),
    })
    expect(startTrackingRuntime).toHaveBeenCalledTimes(1)
    expect(startTrackingRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ baseUrl: 'https://traccar.example.com' }),
        createClient: expect.any(Function),
        cache: expect.objectContaining({
          read: expect.any(Function),
          write: expect.any(Function),
        }),
      }),
    )
  })

  it('keeps the legacy Tauri-backed Traccar client factory available for retained builds', async () => {
    const store: MissionStore & AutosaveStore = createMissionStoreStub()
    let createClient: ((config: {
      readonly baseUrl: string
      readonly email?: string
      readonly password?: string
      readonly token?: string
    }) => unknown) | null = null
    const startTrackingRuntime = vi.fn().mockImplementation(async (input) => {
      createClient = input.createClient
      return vi.fn()
    })

    await startAppRuntime({
      registerServiceWorker: vi.fn().mockResolvedValue(undefined),
      isTauriRuntimeAvailable: vi.fn().mockReturnValue(true),
      createMissionStore: vi.fn().mockReturnValue(store),
      readRuntimeBootstrapSettings: vi.fn().mockResolvedValue(createBootstrapSettings()),
      startMissionAutosave: vi.fn().mockReturnValue(createAutosaveController()),
      startMissionRuntime: vi.fn().mockResolvedValue({}),
      startMissionGovernanceRuntime: vi.fn().mockResolvedValue({}),
      startMarkerRuntime: vi.fn().mockResolvedValue({}),
      startDrawingRuntime: vi.fn().mockResolvedValue({}),
      startGpxRuntime: vi.fn().mockResolvedValue({}),
      startTrackingRuntime,
    })

    expect(createClient).not.toBeNull()
    expect(createClient?.name).toBe('createTauriTraccarClient')
  })

  it('uses Electron mission, tracking, and cache adapters inside an Electron runtime', async () => {
    const store: MissionStore & AutosaveStore = createMissionStoreStub()
    const createMissionStore = vi.fn().mockReturnValue(store)
    const bridge = {
      sartrackerElectron: {
        readTrackingCache: vi.fn().mockResolvedValue('cached'),
        writeTrackingCache: vi.fn().mockResolvedValue('written'),
      },
    }
    vi.stubGlobal('window', bridge)
    let createClient: ((config: {
      readonly baseUrl: string
      readonly email?: string
      readonly password?: string
      readonly token?: string
    }) => unknown) | null = null
    let trackingCache: {
      readonly read: () => Promise<string | null>
      readonly write: (contents: string) => Promise<string>
    } | null = null
    const startTrackingRuntime = vi.fn().mockImplementation(async (input) => {
      createClient = input.createClient
      trackingCache = input.cache
      return vi.fn()
    })

    await startAppRuntime({
      registerServiceWorker: vi.fn().mockResolvedValue(undefined),
      isTauriRuntimeAvailable: vi.fn().mockReturnValue(false),
      isElectronRuntimeAvailable: vi.fn().mockReturnValue(true),
      createMissionStore,
      readRuntimeBootstrapSettings: vi
        .fn()
        .mockResolvedValue(createBootstrapSettings({ trackingCacheEnabled: true })),
      startMissionAutosave: vi.fn().mockReturnValue(createAutosaveController()),
      startMissionRuntime: vi.fn().mockResolvedValue({}),
      startMissionGovernanceRuntime: vi.fn().mockResolvedValue({}),
      startMarkerRuntime: vi.fn().mockResolvedValue({}),
      startDrawingRuntime: vi.fn().mockResolvedValue({}),
      startGpxRuntime: vi.fn().mockResolvedValue({}),
      startTrackingRuntime,
    })

    expect(createMissionStore).toHaveBeenCalledWith('electron')
    expect(createClient).not.toBeNull()
    expect(createClient?.name).toBe('createElectronTraccarClient')
    expect(await trackingCache?.read()).toBe('cached')
    expect(await trackingCache?.write('next')).toBe('written')
  })

  it('prefers Electron when both desktop runtime markers are present', async () => {
    const store: MissionStore & AutosaveStore = createMissionStoreStub()
    const createMissionStore = vi.fn().mockReturnValue(store)

    await startAppRuntime({
      registerServiceWorker: vi.fn().mockResolvedValue(undefined),
      isTauriRuntimeAvailable: vi.fn().mockReturnValue(true),
      isElectronRuntimeAvailable: vi.fn().mockReturnValue(true),
      createMissionStore,
      readRuntimeBootstrapSettings: vi.fn().mockResolvedValue(createBootstrapSettings()),
      startMissionAutosave: vi.fn().mockReturnValue(createAutosaveController()),
      startMissionRuntime: vi.fn().mockResolvedValue({}),
      startMissionGovernanceRuntime: vi.fn().mockResolvedValue({}),
      startMarkerRuntime: vi.fn().mockResolvedValue({}),
      startDrawingRuntime: vi.fn().mockResolvedValue({}),
      startGpxRuntime: vi.fn().mockResolvedValue({}),
      startTrackingRuntime: vi.fn().mockResolvedValue(vi.fn()),
    })

    expect(createMissionStore).toHaveBeenCalledWith('electron')
  })

  it('does not create the mission store outside a desktop runtime', async () => {
    const createMissionStore = vi.fn()
    const startMissionAutosave = vi.fn()

    await startAppRuntime({
      registerServiceWorker: vi.fn().mockResolvedValue(undefined),
      isTauriRuntimeAvailable: vi.fn().mockReturnValue(false),
      createMissionStore,
      readRuntimeBootstrapSettings: vi.fn(),
      startMissionAutosave,
      startMissionRuntime: vi.fn(),
      startMissionGovernanceRuntime: vi.fn(),
      startMarkerRuntime: vi.fn(),
      startDrawingRuntime: vi.fn(),
      startGpxRuntime: vi.fn(),
      startTrackingRuntime: vi.fn(),
    })

    expect(createMissionStore).not.toHaveBeenCalled()
    expect(startMissionAutosave).not.toHaveBeenCalled()
  })

  it('keeps existing services alive when a settings reload fails', async () => {
    const store: MissionStore & AutosaveStore = createMissionStoreStub()
    const initialAutosaveStop = vi.fn()
    const initialTrackingStop = vi.fn()
    const startMissionAutosave = vi
      .fn()
      .mockReturnValueOnce(createAutosaveController(initialAutosaveStop))
    const startTrackingRuntime = vi
      .fn()
      .mockResolvedValueOnce(initialTrackingStop)
    const readRuntimeBootstrapSettings = vi
      .fn()
      .mockResolvedValueOnce(createBootstrapSettings())
      .mockRejectedValueOnce(new Error('settings unavailable'))

    const runtime = await startAppRuntime({
      registerServiceWorker: vi.fn().mockResolvedValue(undefined),
      isTauriRuntimeAvailable: vi.fn().mockReturnValue(true),
      createMissionStore: vi.fn().mockReturnValue(store),
      readRuntimeBootstrapSettings,
      startMissionAutosave,
      startMissionRuntime: vi.fn().mockResolvedValue({}),
      startMissionGovernanceRuntime: vi.fn().mockResolvedValue({}),
      startMarkerRuntime: vi.fn().mockResolvedValue({}),
      startDrawingRuntime: vi.fn().mockResolvedValue({}),
      startGpxRuntime: vi.fn().mockResolvedValue({}),
      startTrackingRuntime,
    })

    await expect(runtime?.reloadSettings()).rejects.toThrow('settings unavailable')
    expect(initialAutosaveStop).not.toHaveBeenCalled()
    expect(initialTrackingStop).not.toHaveBeenCalled()
  })

  it('disposes core feature runtimes when initial settings reload fails', async () => {
    const store: MissionStore & AutosaveStore = createMissionStoreStub()
    const disposeCoreFeatureRuntimes = vi.fn()
    const readRuntimeBootstrapSettings = vi
      .fn()
      .mockRejectedValueOnce(new Error('settings unavailable'))

    await expect(
      startAppRuntime({
        registerServiceWorker: vi.fn().mockResolvedValue(undefined),
        isTauriRuntimeAvailable: vi.fn().mockReturnValue(true),
        createMissionStore: vi.fn().mockReturnValue(store),
        readRuntimeBootstrapSettings,
        startMissionAutosave: vi.fn(),
        startMissionRuntime: vi.fn(),
        startMissionGovernanceRuntime: vi.fn(),
        startMarkerRuntime: vi.fn(),
        startDrawingRuntime: vi.fn(),
        startGpxRuntime: vi.fn(),
        startTrackingRuntime: vi.fn(),
        startCoreFeatureRuntimes: vi
          .fn()
          .mockResolvedValue(createCoreFeatureRuntimeHandles(disposeCoreFeatureRuntimes)),
      }),
    ).rejects.toThrow('settings unavailable')

    expect(disposeCoreFeatureRuntimes).toHaveBeenCalledTimes(1)
  })

  it('applies only the latest overlapping settings reload', async () => {
    const store: MissionStore & AutosaveStore = createMissionStoreStub()
    const initialAutosaveStop = vi.fn()
    const initialTrackingStop = vi.fn()
    const latestAutosaveStop = vi.fn()
    const latestTrackingStop = vi.fn()
    const staleAutosaveStop = vi.fn()
    const staleTrackingStop = vi.fn()

    let releaseFirstReload: (() => void) | null = null
    const readRuntimeBootstrapSettings = vi
      .fn()
      .mockResolvedValueOnce(createBootstrapSettings({ autosaveIntervalMs: 10_000 }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirstReload = () =>
              resolve(createBootstrapSettings({ autosaveIntervalMs: 20_000 }))
          }),
      )
      .mockResolvedValueOnce(createBootstrapSettings({ autosaveIntervalMs: 30_000 }))

    const startMissionAutosave = vi
      .fn()
      .mockReturnValueOnce(createAutosaveController(initialAutosaveStop))
      .mockReturnValueOnce(createAutosaveController(latestAutosaveStop))
      .mockReturnValueOnce(createAutosaveController(staleAutosaveStop))

    const startTrackingRuntime = vi
      .fn()
      .mockResolvedValueOnce(initialTrackingStop)
      .mockResolvedValueOnce(latestTrackingStop)
      .mockResolvedValueOnce(staleTrackingStop)

    const runtime = await startAppRuntime({
      registerServiceWorker: vi.fn().mockResolvedValue(undefined),
      isTauriRuntimeAvailable: vi.fn().mockReturnValue(true),
      createMissionStore: vi.fn().mockReturnValue(store),
      readRuntimeBootstrapSettings,
      startMissionAutosave,
      startMissionRuntime: vi.fn().mockResolvedValue({}),
      startMissionGovernanceRuntime: vi.fn().mockResolvedValue({}),
      startMarkerRuntime: vi.fn().mockResolvedValue({}),
      startDrawingRuntime: vi.fn().mockResolvedValue({}),
      startGpxRuntime: vi.fn().mockResolvedValue({}),
      startTrackingRuntime,
    })

    const firstReload = runtime?.reloadSettings()
    const secondReload = runtime?.reloadSettings()
    await Promise.resolve()
    releaseFirstReload?.()
    await Promise.all([firstReload, secondReload])

    expect(initialAutosaveStop).toHaveBeenCalledTimes(1)
    expect(initialTrackingStop).toHaveBeenCalledTimes(1)
    expect(staleAutosaveStop).toHaveBeenCalledTimes(1)
    expect(staleTrackingStop).toHaveBeenCalledTimes(1)
    expect(latestAutosaveStop).not.toHaveBeenCalled()
    expect(latestTrackingStop).not.toHaveBeenCalled()
    expect(startMissionAutosave).toHaveBeenNthCalledWith(2, store, {
      intervalMs: 30_000,
    })
    expect(startMissionAutosave).toHaveBeenNthCalledWith(3, store, {
      intervalMs: 20_000,
    })
  })

  it('disposes the active runtime services explicitly', async () => {
    const store: MissionStore & AutosaveStore = createMissionStoreStub()
    const activeAutosaveStop = vi.fn()
    const activeTrackingStop = vi.fn()

    const runtime = await startAppRuntime({
      registerServiceWorker: vi.fn().mockResolvedValue(undefined),
      isTauriRuntimeAvailable: vi.fn().mockReturnValue(true),
      createMissionStore: vi.fn().mockReturnValue(store),
      readRuntimeBootstrapSettings: vi.fn().mockResolvedValue(createBootstrapSettings()),
      startMissionAutosave: vi.fn().mockReturnValue(createAutosaveController(activeAutosaveStop)),
      startMissionRuntime: vi.fn().mockResolvedValue({}),
      startMissionGovernanceRuntime: vi.fn().mockResolvedValue({}),
      startMarkerRuntime: vi.fn().mockResolvedValue({}),
      startDrawingRuntime: vi.fn().mockResolvedValue({}),
      startGpxRuntime: vi.fn().mockResolvedValue({}),
      startTrackingRuntime: vi.fn().mockResolvedValue(activeTrackingStop),
    })

    runtime?.dispose()

    expect(activeAutosaveStop).toHaveBeenCalledTimes(1)
    expect(activeTrackingStop).toHaveBeenCalledTimes(1)
  })

  it('keeps runtime disposal idempotent when called more than once', async () => {
    const store: MissionStore & AutosaveStore = createMissionStoreStub()
    const activeAutosaveStop = vi.fn()
    const activeTrackingStop = vi.fn()

    const runtime = await startAppRuntime({
      registerServiceWorker: vi.fn().mockResolvedValue(undefined),
      isTauriRuntimeAvailable: vi.fn().mockReturnValue(true),
      createMissionStore: vi.fn().mockReturnValue(store),
      readRuntimeBootstrapSettings: vi.fn().mockResolvedValue(createBootstrapSettings()),
      startMissionAutosave: vi.fn().mockReturnValue(createAutosaveController(activeAutosaveStop)),
      startMissionRuntime: vi.fn().mockResolvedValue({}),
      startMissionGovernanceRuntime: vi.fn().mockResolvedValue({}),
      startMarkerRuntime: vi.fn().mockResolvedValue({}),
      startDrawingRuntime: vi.fn().mockResolvedValue({}),
      startGpxRuntime: vi.fn().mockResolvedValue({}),
      startTrackingRuntime: vi.fn().mockResolvedValue(activeTrackingStop),
    })

    runtime?.dispose()
    runtime?.dispose()

    expect(activeAutosaveStop).toHaveBeenCalledTimes(1)
    expect(activeTrackingStop).toHaveBeenCalledTimes(1)
    await expect(runtime?.reloadSettings()).rejects.toThrow('already been disposed')
  })
})

function createMissionStoreStub(): MissionStore & AutosaveStore {
  return {
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
    upsertHelicopter: vi.fn(),
    listHelicopters: vi.fn(),
    deleteHelicopter: vi.fn(),
    getMission: vi.fn(),
    listMissions: vi.fn(),
    getActiveMission: vi.fn(),
    getRecoverableMission: vi.fn(),
    pauseMission: vi.fn(),
    resumeMission: vi.fn(),
    finishMission: vi.fn(),
    finalizeMission: vi.fn(),
    unlockFinalizedMission: vi.fn(),
    syncBackup: vi.fn(),
    upsertGpxImport: vi.fn(),
    listGpxImports: vi.fn(),
    deleteGpxImport: vi.fn(),
  }
}

function createAutosaveController(stop: () => void = vi.fn()) {
  return {
    stop,
    requestSync: vi.fn().mockResolvedValue(undefined),
  }
}

function createCoreFeatureRuntimeHandles(dispose: () => void): CoreFeatureRuntimeHandles {
  return {
    missionRuntimeController: {},
    missionGovernanceController: {},
    markerRuntimeController: {},
    drawingRuntimeController: {},
    helicopterRuntimeController: {},
    gpxRuntimeController: {},
    dispose,
  } as CoreFeatureRuntimeHandles
}

function createBootstrapSettings(overrides?: Partial<{
  autosaveEnabled: boolean
  autosaveIntervalMs: number
  trackingPollIntervalMs: number
  trackingCacheEnabled: boolean
}>){
  return {
    autosaveEnabled: true,
    autosaveIntervalMs: 45_000,
    trackingPollIntervalMs: 60_000,
    trackingCacheEnabled: false,
    trackingConfig: {
      baseUrl: 'https://traccar.example.com',
      email: 'ops@example.com',
      password: 'secret',
    },
    ...overrides,
  }
}
