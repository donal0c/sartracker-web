import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AutosaveStore } from '../../src/features/persistence/mission-autosave'
import type { MissionStore } from '../../src/infrastructure/mission-store/tauri-mission-store'
import { startAppRuntime } from '../../src/features/runtime/start-app-runtime'
import type { CoreFeatureRuntimeHandles } from '../../src/features/runtime/start-core-feature-runtimes'
import { useMissionStore } from '../../src/features/mission/mission-store'
import { useActiveMissionDevicesStore } from '../../src/features/tracking/active-mission-devices-store'
import { useIngestHealthStore } from '../../src/features/tracking/ingest-health-store'
import { useParticipantStore } from '../../src/features/participants/participant-store'
import { createParticipationScope } from '../../src/features/participants/participation-scope'

describe('app runtime startup', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useMissionStore.setState(useMissionStore.getInitialState())
    useActiveMissionDevicesStore.setState(useActiveMissionDevicesStore.getInitialState())
    useIngestHealthStore.setState(useIngestHealthStore.getInitialState())
    useParticipantStore.setState(useParticipantStore.getInitialState())
  })

  it('publishes current rejections before non-blocking durable evidence delivery [DON-268]', async () => {
    useMissionStore.setState({
      phase: 'active',
      currentMission: {
        id: 'mission-1', name: 'Mission 1', status: 'active',
        start_time: '2026-08-22T10:00:00.000Z', pause_time: null,
        finish_time: null, paused_seconds: 0, notes: null, schema_version: 8,
      },
    })
    const recordIngestRejections = vi.fn().mockImplementation(async (input) => ({
      acknowledgedDeliveryIds: input.rejections.map((entry) => entry.deliveryId),
      health: {
        state: 'healthy', reason: null, pendingCount: 0, corruptCount: 0,
        conflictCount: 0, rejectedCount: 1, affectedDeviceCount: 1,
        conflictDeviceIds: [],
      },
    }))
    const missionStore = Object.assign(createMissionStoreStub(), {
      getActiveMission: vi.fn().mockResolvedValue(useMissionStore.getState().currentMission),
      recordIngestRejections,
      getIngestEvidenceHealth: vi.fn().mockResolvedValue({
        state: 'healthy', reason: null, pendingCount: 0, corruptCount: 0,
        conflictCount: 0, rejectedCount: 0, affectedDeviceCount: 0,
        conflictDeviceIds: [],
      }),
    })
    let rejectionHook: ((rejections: readonly {
      readonly deviceId: string | null
      readonly reason: 'invalid_coordinates'
      readonly rowIndex: number
      readonly anomalyKey: string
      readonly canonicalEvidence: Readonly<Record<string, unknown>>
    }[], context: {
      readonly missionId: string | null
      readonly observedAt: string
    }) => void) | undefined
    const createPollingManager = vi.fn().mockImplementation((_client, options) => {
      rejectionHook = options.onCurrentPositionRejections
      return { start: vi.fn(), stop: vi.fn() }
    })
    const startTrackingRuntime = vi.fn().mockImplementation(async (input) => {
      input.createPoller({}, {
        onSnapshot: vi.fn(), onStatusChange: vi.fn(),
        getInitialBreadcrumbs: vi.fn().mockResolvedValue([]),
        getInitialBreadcrumbTotals: vi.fn().mockResolvedValue({}),
        getInitialBreadcrumbSelectionMetadata: vi.fn().mockResolvedValue({}),
        getInitialHistoryCheckpoints: vi.fn().mockResolvedValue({}),
        onPollDiagnostic: vi.fn(),
      })
      return vi.fn()
    })
    const startMissionGovernanceRuntime = vi.fn().mockResolvedValue({})

    await startAppRuntime({
      registerServiceWorker: vi.fn().mockResolvedValue(undefined),
      isTauriRuntimeAvailable: vi.fn().mockReturnValue(false),
      isElectronRuntimeAvailable: vi.fn().mockReturnValue(true),
      createMissionStore: vi.fn().mockReturnValue(missionStore),
      readRuntimeBootstrapSettings: vi.fn().mockResolvedValue(createBootstrapSettings()),
      startMissionAutosave: vi.fn().mockReturnValue(createAutosaveController()),
      startMissionRuntime: vi.fn().mockResolvedValue({}),
      startMissionGovernanceRuntime,
      startMarkerRuntime: vi.fn().mockResolvedValue({}),
      startDrawingRuntime: vi.fn().mockResolvedValue({}),
      startGpxRuntime: vi.fn().mockResolvedValue({}),
      startTrackingRuntime,
      createPollingManager,
    })
    rejectionHook?.(
      [{
        deviceId: 'device-1', reason: 'invalid_coordinates', rowIndex: 0,
        anomalyKey: 'source:bad-1', canonicalEvidence: { id: 'bad-1' },
      }],
      { missionId: 'mission-1', observedAt: '2026-08-22T10:00:01.000Z' },
    )

    expect(useIngestHealthStore.getState().summary.totalRejected).toBe(1)
    await vi.waitFor(() => expect(recordIngestRejections).toHaveBeenCalledTimes(1))
    expect(recordIngestRejections).toHaveBeenCalledWith(expect.objectContaining({
      mission_id: 'mission-1',
      rejections: [expect.objectContaining({
        receivedAt: '2026-08-22T10:00:01.000Z',
      })],
    }))
    expect(missionStore.getIngestEvidenceHealth).toHaveBeenCalledWith('mission-1')
    const governanceMissionStore = startMissionGovernanceRuntime.mock.calls[0]?.[0].missionStore
    expect(governanceMissionStore.finalizeMission).not.toBe(missionStore.finalizeMission)
    await governanceMissionStore.finalizeMission('mission-1')
    expect(missionStore.finalizeMission).toHaveBeenCalledWith('mission-1')
  })

  it('wires the active mission device selection into breadcrumb polling', async () => {
    useMissionStore.setState({
      phase: 'active',
      currentMission: {
        id: 'mission-1',
        name: 'Mission 1',
        status: 'active',
        start_time: '2026-08-08T00:00:00.000Z',
        pause_time: null,
        finish_time: null,
        paused_seconds: 0,
        notes: null,
        schema_version: 1,
      },
    })
    useActiveMissionDevicesStore.getState().setDeviceActive('mission-1', '7', true)
    useActiveMissionDevicesStore.getState().setDeviceActive('mission-1', '2', true)
    useParticipantStore.setState({
      activeMissionId: 'mission-1',
      scope: createParticipationScope({
        participants: [{
          id: 'participant-7', mission_id: 'mission-1', kind: 'device',
          traccar_device_id: '7', mission_team_id: null, traccar_group_id: null,
          team_name: null, provenance: 'explicit',
          effective_from: '2026-08-08T00:00:00.000Z',
          added_at: '2026-08-08T00:00:00.000Z', added_by: 'Coordinator',
          removed_at: '2026-08-08T01:00:00.000Z', removed_by: 'Coordinator',
        }],
        membershipEvents: [],
      }),
    })

    const createPollingManager = vi.fn().mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
    })
    const persistHistoryChunks = vi.fn().mockResolvedValue(undefined)
    const startTrackingRuntime = vi.fn().mockImplementation(async (input) => {
      input.createPoller({}, {
        onSnapshot: vi.fn(),
        onStatusChange: vi.fn(),
        getInitialBreadcrumbs: vi.fn().mockResolvedValue([]),
        getInitialBreadcrumbTotals: vi.fn().mockResolvedValue({}),
        getInitialBreadcrumbSelectionMetadata: vi.fn().mockResolvedValue({}),
        getInitialHistoryCheckpoints: vi.fn().mockResolvedValue({
          '7': {
            historyFrom: '2026-08-08T00:00:00.000Z',
            reconciledUntil: '2026-08-08T02:00:00.000Z',
          },
        }),
        getCanonicalBreadcrumbs: vi.fn().mockResolvedValue({
          positions: [],
          totalObservedByDevice: {},
          selectionMetadataByDevice: {},
        }),
        persistHistoryChunk: vi.fn().mockResolvedValue({ changed: false }),
        persistHistoryChunks,
        onPollDiagnostic: vi.fn(),
      })
      return vi.fn()
    })

    await startAppRuntime({
      registerServiceWorker: vi.fn().mockResolvedValue(undefined),
      isTauriRuntimeAvailable: vi.fn().mockReturnValue(true),
      createMissionStore: vi.fn().mockReturnValue(createMissionStoreStub()),
      readRuntimeBootstrapSettings: vi.fn().mockResolvedValue(createBootstrapSettings()),
      startMissionAutosave: vi.fn().mockReturnValue(createAutosaveController()),
      startMissionRuntime: vi.fn().mockResolvedValue({}),
      startMissionGovernanceRuntime: vi.fn().mockResolvedValue({}),
      startMarkerRuntime: vi.fn().mockResolvedValue({}),
      startDrawingRuntime: vi.fn().mockResolvedValue({}),
      startGpxRuntime: vi.fn().mockResolvedValue({}),
      startTrackingRuntime,
      createPollingManager,
    })
    useParticipantStore.setState({
      activeMissionId: 'mission-1',
      scope: createParticipationScope({
        participants: [{
          id: 'participant-7', mission_id: 'mission-1', kind: 'device',
          traccar_device_id: '7', mission_team_id: null, traccar_group_id: null,
          team_name: null, provenance: 'explicit',
          effective_from: '2026-08-08T00:00:00.000Z',
          added_at: '2026-08-08T00:00:00.000Z', added_by: 'Coordinator',
          removed_at: '2026-08-08T01:00:00.000Z', removed_by: 'Coordinator',
        }],
        membershipEvents: [],
      }),
    })

    const pollingOptions = createPollingManager.mock.calls[0]?.[1] as {
      readonly getBreadcrumbDeviceIds?: () => readonly string[]
      readonly getParticipantDeviceIds?: () => readonly string[] | null
      readonly getInitialHistoryCheckpoints?: () => Promise<unknown>
      readonly getCanonicalBreadcrumbs?: (missionId: string) => Promise<unknown>
      readonly persistHistoryChunk?: (input: unknown) => Promise<void>
      readonly persistHistoryChunks?: (inputs: readonly unknown[]) => Promise<void>
    }
    expect(pollingOptions.getBreadcrumbDeviceIds?.()).toEqual(['2', '7'])
    expect(pollingOptions.getParticipantDeviceIds?.()).toEqual(['7'])
    await expect(pollingOptions.getInitialHistoryCheckpoints?.()).resolves.toEqual({
      '7': {
        historyFrom: '2026-08-08T00:00:00.000Z',
        reconciledUntil: '2026-08-08T02:00:00.000Z',
      },
    })
    expect(pollingOptions.persistHistoryChunk).toEqual(expect.any(Function))
    expect(pollingOptions.persistHistoryChunks).toBe(persistHistoryChunks)
    await expect(
      pollingOptions.getCanonicalBreadcrumbs?.('mission-1'),
    ).resolves.toEqual({
      positions: [],
      totalObservedByDevice: {},
      selectionMetadataByDevice: {},
    })

    useMissionStore.setState({ currentMission: null, phase: 'idle' })
    expect(pollingOptions.getBreadcrumbDeviceIds?.()).toEqual([])
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
      runMissionFinish: expect.any(Function),
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
      recordDiagnosticEvent: expect.any(Function),
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

  it('applies only the latest overlapping settings reload without starting stale services', async () => {
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
    expect(staleAutosaveStop).not.toHaveBeenCalled()
    expect(staleTrackingStop).not.toHaveBeenCalled()
    expect(latestAutosaveStop).not.toHaveBeenCalled()
    expect(latestTrackingStop).not.toHaveBeenCalled()
    expect(startMissionAutosave).toHaveBeenNthCalledWith(2, store, {
      intervalMs: 30_000,
    })
    expect(startMissionAutosave).toHaveBeenCalledTimes(2)
    expect(startTrackingRuntime).toHaveBeenCalledTimes(2)
  })

  it('stops the active tracking runtime before starting its replacement [DON-260]', async () => {
    const store: MissionStore & AutosaveStore = createMissionStoreStub()
    const lifecycle: string[] = []
    const startTrackingRuntime = vi
      .fn()
      .mockImplementationOnce(async () => {
        lifecycle.push('initial-start')
        return () => lifecycle.push('initial-stop')
      })
      .mockImplementationOnce(async () => {
        lifecycle.push('replacement-start')
        return () => lifecycle.push('replacement-stop')
      })

    const runtime = await startAppRuntime({
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

    await runtime?.reloadSettings()

    expect(lifecycle).toEqual([
      'initial-start',
      'initial-stop',
      'replacement-start',
    ])
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
