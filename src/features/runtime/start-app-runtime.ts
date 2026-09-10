import type {
  AutosaveStore,
  MissionAutosaveController,
} from '../persistence/mission-autosave'
import { startMissionAutosave } from '../persistence/mission-autosave'
import type { AutosaveSyncReason } from '../persistence/autosave-status-store'
import { createRuntimeCleanup } from './runtime-cleanup'
import {
  createTauriMissionStore,
  type IngestEvidenceHealth,
  type MissionStore,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { createElectronMissionStore } from '../../infrastructure/mission-store/electron-mission-store'
import { createElectronGpxImportSource } from '../../infrastructure/gpx-import-source/electron-gpx-import-source'
import { createTauriGpxImportSource } from '../../infrastructure/gpx-import-source/tauri-gpx-import-source'
import { electronMarkerAttachmentAdapter } from '../../infrastructure/marker-attachment-store/electron-marker-attachment-store'
import { noopMarkerAttachmentAdapter } from '../../infrastructure/marker-attachment-store/noop-marker-attachment-adapter'
import { tauriMarkerAttachmentAdapter } from '../../infrastructure/marker-attachment-store/tauri-marker-attachment-store'
import { createElectronTrackingCache } from '../../infrastructure/tracking-cache/electron-tracking-cache'
import { createTauriTrackingCache } from '../../infrastructure/tracking-cache/tauri-tracking-cache'
import { createElectronTraccarClient } from '../../infrastructure/traccar-http/electron-traccar-fetch'
import { createTauriTraccarClient } from '../../infrastructure/traccar-http/tauri-traccar-fetch'
import { loadRuntimeBootstrapSettings } from '../../infrastructure/settings-store/tauri-settings-store'
import { registerServiceWorker } from '../../lib/register-service-worker'
import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'
import { isElectronRuntimeAvailable, type DesktopRuntimeKind } from '../../lib/desktop-runtime'
import { startGpxRuntime } from '../gpx/start-gpx-runtime'
import { startHelicopterRuntime } from '../helicopters/start-helicopter-runtime'
import { startMarkerRuntime } from '../markers/start-marker-runtime'
import { startDrawingRuntime } from '../drawings/start-drawing-runtime'
import { useMissionStore } from '../mission/mission-store'
import { startMissionGovernanceRuntime } from '../mission/start-mission-governance-runtime'
import { startMissionRuntime } from '../mission/start-mission-runtime'
import {
  createPollingManager,
  type TrackingPollerClient,
} from '../tracking/polling-manager'
import { applyTrackingSnapshot, applyTrackingStatus } from '../tracking/tracking-store'
import { readTrackingRuntimeConfig } from '../tracking/tracking-runtime-config'
import type { TrackingRuntimeMissionStore, TrackingRuntimeStop } from '../tracking/start-tracking-runtime'
import { DEFAULT_DEVICE_STALE_THRESHOLD_MS } from '../tracking/tracking-snapshot-health'
import { useActiveMissionDevicesStore } from '../tracking/active-mission-devices-store'
import {
  applyCurrentPositionRejections,
  applyIngestEvidenceHealth,
  useIngestHealthStore,
} from '../tracking/ingest-health-store'
import { createRejectionEvidenceDelivery } from '../tracking/rejection-evidence-delivery'
import { createIngestEvidenceFinalizationBoundary } from '../tracking/ingest-evidence-finalization-boundary'
import { startExactBreadcrumbDotRuntime } from '../tracking/start-exact-breadcrumb-dot-runtime'
import { startCoverageRuntime } from '../tracking/start-coverage-runtime'
import {
  isCoverageEnabled,
  resolveCoverageRuntimeEnabled,
} from './coverage-flag'
import { useStationaryAttentionStore } from '../tracking/stationary-attention-store'
import { useExactBreadcrumbDotStore } from '../tracking/exact-breadcrumb-dot-store'
import type { AppRuntimeController } from './app-runtime-controller'
import {
  createManagedRuntimeServices,
  createNoopRuntimeServiceHandles,
  stopRuntimeServices,
} from './runtime-managed-services'
import { startCoreFeatureRuntimes } from './start-core-feature-runtimes'
import { useParticipantStore } from '../participants/participant-store'
import { resolveParticipantMissionId } from '../participants/participant-mission-context'
import { isMissionModelEnabled } from './mission-model-flag'
import { setMissionReviewMissionStore } from '../mission-review/mission-review-runtime-context'

type StartAppRuntimeDependencies = {
  readonly registerServiceWorker: () => Promise<void>
  readonly isTauriRuntimeAvailable: () => boolean
  readonly isElectronRuntimeAvailable: () => boolean
  readonly createMissionStore: (runtimeKind: Exclude<DesktopRuntimeKind, 'browser'>) => MissionStore
  readonly readRuntimeBootstrapSettings: (
    forceConnect?: boolean,
  ) => Promise<{
    readonly autosaveEnabled: boolean
    readonly autosaveIntervalMs: number
    readonly trackingPollIntervalMs: number
    readonly trackingMinimumPollIntervalMs?: number
    readonly trackingHistoryAntiEntropyIntervalMs?: number
    readonly trackingCacheEnabled: boolean
    readonly stationaryAttentionConfig?: {
      readonly heartbeatWindowMs: number
      readonly heartbeatToleranceMs: number
      readonly movementFloorM: number
      readonly accuracyFactor: number
      readonly outlierRejectM: number
    }
    readonly trackingConfig: {
      readonly baseUrl: string
      readonly email?: string
      readonly password?: string
      readonly token?: string
    } | null
  }>
  readonly startMissionAutosave: (
    store: AutosaveStore,
    options?: { readonly intervalMs?: number },
  ) => MissionAutosaveController
  readonly startMissionRuntime: typeof startMissionRuntime
  readonly startMissionGovernanceRuntime: typeof startMissionGovernanceRuntime
  readonly startMarkerRuntime: typeof startMarkerRuntime
  readonly startDrawingRuntime: typeof startDrawingRuntime
  readonly startHelicopterRuntime: typeof startHelicopterRuntime
  readonly startGpxRuntime: typeof startGpxRuntime
  readonly startTrackingRuntime:
    typeof import('../tracking/start-tracking-runtime').startTrackingRuntime
  readonly startExactBreadcrumbDotRuntime: typeof startExactBreadcrumbDotRuntime
  readonly startCoverageRuntime: typeof startCoverageRuntime
  readonly createPollingManager: typeof createPollingManager
  readonly startCoreFeatureRuntimes: typeof startCoreFeatureRuntimes
}

/** Loads the sizeable tracking runtime only when application services start it. */
const startDefaultTrackingRuntime:
  typeof import('../tracking/start-tracking-runtime').startTrackingRuntime =
    async (dependencies) => {
      const module = await import('../tracking/start-tracking-runtime')
      return module.startTrackingRuntime(dependencies)
    }

const DEFAULT_DEPENDENCIES: StartAppRuntimeDependencies = {
  registerServiceWorker,
  isTauriRuntimeAvailable,
  isElectronRuntimeAvailable,
  createMissionStore: (runtimeKind) =>
    runtimeKind === 'electron' ? createElectronMissionStore() : createTauriMissionStore(),
  readRuntimeBootstrapSettings: loadRuntimeBootstrapSettings,
  startMissionAutosave,
  startMissionRuntime,
  startMissionGovernanceRuntime,
  startMarkerRuntime,
  startDrawingRuntime,
  startHelicopterRuntime,
  startGpxRuntime,
  startTrackingRuntime: startDefaultTrackingRuntime,
  startExactBreadcrumbDotRuntime,
  startCoverageRuntime,
  createPollingManager,
  startCoreFeatureRuntimes,
}

/**
 * Starts non-React application runtime services behind a small orchestration boundary.
 */
export async function startAppRuntime(
  dependencies: Partial<StartAppRuntimeDependencies> = {},
): Promise<AppRuntimeController | null> {
  const resolvedDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...dependencies,
  } satisfies StartAppRuntimeDependencies

  await resolvedDependencies.registerServiceWorker()

  const runtimeKind = resolveOperationalRuntimeKind(resolvedDependencies)
  if (runtimeKind === null) {
    return null
  }

  const missionStore = resolvedDependencies.createMissionStore(runtimeKind)
  const trackingMissionStore = missionStore as MissionStore & TrackingRuntimeMissionStore
  const rejectionEvidenceDelivery = missionStore.recordIngestRejections === undefined
    ? null
    : createRejectionEvidenceDelivery({
        missionStore: {
          recordIngestRejections: missionStore.recordIngestRejections,
          ...(missionStore.recordIngestEvidenceLoss === undefined
            ? {}
            : { recordIngestEvidenceLoss: missionStore.recordIngestEvidenceLoss }),
        },
        applyRejections: applyCurrentPositionRejections,
        applyEvidenceHealth: applyIngestEvidenceHealth,
        readEvidenceHealth: () => useIngestHealthStore.getState().evidenceHealth,
      })
  const unavailableEvidenceHealth: IngestEvidenceHealth = {
    state: 'critical',
    reason: 'evidence_health_unavailable',
    pendingCount: 0,
    corruptCount: 0,
    conflictCount: 0,
    rejectedCount: 0,
    affectedDeviceCount: 0,
    conflictDeviceIds: [],
  }
  /** Routes startup hydration through the finalized-mission health boundary. */
  const applyStartupMissionHealth = (
    missionId: string,
    health: IngestEvidenceHealth,
  ): void => {
    if (rejectionEvidenceDelivery === null) {
      applyIngestEvidenceHealth(health)
    } else {
      rejectionEvidenceDelivery.applyMissionHealth(missionId, health)
    }
  }
  if (missionStore.getIngestEvidenceHealth !== undefined) {
    void missionStore.getActiveMission().then((mission) => {
      if (mission === null) return
      void missionStore.getIngestEvidenceHealth?.(mission.id).then((health) => {
        applyStartupMissionHealth(mission.id, health)
      }).catch(() => {
        applyStartupMissionHealth(mission.id, unavailableEvidenceHealth)
      })
    }).catch(() => {
      applyIngestEvidenceHealth(unavailableEvidenceHealth)
    })
  }
  const gpxImportSource =
    runtimeKind === 'electron' ? createElectronGpxImportSource() : createTauriGpxImportSource()
  const attachmentAdapter =
    runtimeKind === 'electron'
      ? electronMarkerAttachmentAdapter
      : runtimeKind === 'tauri'
        ? tauriMarkerAttachmentAdapter
        : noopMarkerAttachmentAdapter
  let activeServices = createNoopRuntimeServiceHandles()
  let reloadGeneration = 0
  const coreMissionStore = rejectionEvidenceDelivery === null
    ? missionStore
    : createIngestEvidenceFinalizationBoundary(missionStore, rejectionEvidenceDelivery)

  const missionModelEnabled = isMissionModelEnabled()
  const coreFeatureRuntimes = await resolvedDependencies.startCoreFeatureRuntimes({
    missionStore: coreMissionStore,
    attachmentAdapter,
    missionModelEnabled,
    gpxWatchSource: gpxImportSource,
    requestAutosaveSync: (reason: AutosaveSyncReason) =>
      activeServices.requestAutosaveSync(reason),
    startMissionRuntime: resolvedDependencies.startMissionRuntime,
    startMissionGovernanceRuntime: resolvedDependencies.startMissionGovernanceRuntime,
    startMarkerRuntime: resolvedDependencies.startMarkerRuntime,
    startDrawingRuntime: resolvedDependencies.startDrawingRuntime,
    startHelicopterRuntime: resolvedDependencies.startHelicopterRuntime,
    startGpxRuntime: resolvedDependencies.startGpxRuntime,
  })
  setMissionReviewMissionStore(coreMissionStore)
  let stopExactBreadcrumbDots = (): void => undefined
  let stopCoverage = (): void => undefined
  let trackingSession: TrackingRuntimeStop | null = null
  let reloadTail: Promise<void> = Promise.resolve()
  let disposed = false
  let stopOwnedServices = async (): Promise<void> => undefined
  let trackingCustodyStopped = false
  const cleanup = createRuntimeCleanup([
    async () => {
      disposed = true
      reloadGeneration += 1
      await reloadTail.catch(() => undefined)
      const previousServices = activeServices
      activeServices = createNoopRuntimeServiceHandles()
      stopOwnedServices = createRuntimeCleanup([
        previousServices.stopAutosave, previousServices.stopTracking,
      ])
    },
    () => stopOwnedServices(),
    async () => { await stopTrackingSession(); trackingCustodyStopped = true },
    async () => {
      if (!trackingCustodyStopped) throw new Error('Rejection evidence admission remains open until tracking settles.')
      await rejectionEvidenceDelivery?.dispose()
    },
    () => { setMissionReviewMissionStore(null) },
    () => stopExactBreadcrumbDots(),
    () => stopCoverage(),
    () => coreFeatureRuntimes.dispose(),
  ])
  try {
    stopExactBreadcrumbDots = resolvedDependencies.startExactBreadcrumbDotRuntime(
      missionStore,
    )
    stopCoverage = resolvedDependencies.startCoverageRuntime(missionStore, {
      enabled: runtimeKind === 'electron' && resolveCoverageRuntimeEnabled({
        missionModelEnabled,
        coverageEnabled: isCoverageEnabled(),
      }),
    })
    await reloadSettings()
  } catch (error) {
    try {
      await cleanup()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError],
        'App startup failed and cleanup remains incomplete.', { cause: error })
    }
    throw error
  }

  return {
    reloadSettings: async (options) => {
      if (disposed) {
        throw new Error('App runtime has already been disposed.')
      }

      await reloadSettings(options)
    },
    dispose: cleanup,
  }

  /** Releases the session only after every settings replacement has settled. */
  async function stopTrackingSession(): Promise<void> {
    await trackingSession?.()
  }

  async function reloadSettings(options?: { readonly forceConnect?: boolean }): Promise<void> {
    const generation = ++reloadGeneration

    const runtimeSettings = await resolvedDependencies.readRuntimeBootstrapSettings(
      options?.forceConnect ?? false,
    )

    if (generation !== reloadGeneration) {
      return
    }

    const replacement = reloadTail.catch(() => undefined).then(async () => {
      if (generation !== reloadGeneration || disposed) return
      await replaceServices(runtimeSettings, generation)
    })
    reloadTail = replacement
    await replacement
  }

  /** Serializes settings intent while the tracking session retains evidence custody. */
  async function replaceServices(
    runtimeSettings: Awaited<ReturnType<StartAppRuntimeDependencies['readRuntimeBootstrapSettings']>>,
    generation: number,
  ): Promise<void> {

    useStationaryAttentionStore.getState().setConfig(runtimeSettings.stationaryAttentionConfig)

    // Settings load while the current tracker remains live. Replace auxiliary
    // services here; the retained tracking session selects one publisher while
    // retiring transports finish their accepted evidence independently.
    const previousServices = activeServices
    const preservesTrackingSession = trackingSession !== null
    if (!preservesTrackingSession) {
      activeServices = createNoopRuntimeServiceHandles()
      await stopRuntimeServices(previousServices)
    }
    if (generation !== reloadGeneration || disposed) return

    const nextServices = await createManagedRuntimeServices({
      runtimeSettings,
      missionStore: trackingMissionStore,
      startMissionAutosave: resolvedDependencies.startMissionAutosave,
      startTrackingRuntime: async (input) => {
        if (trackingSession?.reconfigure !== undefined) {
          await trackingSession.reconfigure(input)
          return () => undefined
        }
        const started = await resolvedDependencies.startTrackingRuntime(input)
        if (started.reconfigure !== undefined) {
          trackingSession = started
          return () => undefined
        }
        return started
      },
      createClient:
        runtimeKind === 'electron' ? createElectronTraccarClient : createTauriTraccarClient,
      createPoller: (client, hooks) =>
        resolvedDependencies.createPollingManager(client as TrackingPollerClient, {
          intervalMs: runtimeSettings.trackingPollIntervalMs,
          ...(runtimeSettings.trackingMinimumPollIntervalMs === undefined
            ? {}
            : { minimumIntervalMs: runtimeSettings.trackingMinimumPollIntervalMs }),
          ...(runtimeSettings.trackingHistoryAntiEntropyIntervalMs === undefined
            ? {}
            : {
                historyAntiEntropyIntervalMs:
                  runtimeSettings.trackingHistoryAntiEntropyIntervalMs,
              }),
          staleThresholdMs: DEFAULT_DEVICE_STALE_THRESHOLD_MS,
          maxBackoffMs: 60_000,
          getPollingMode: () => {
            const phase = useMissionStore.getState().phase
            return phase === 'active' || phase === 'paused' ? phase : 'idle'
          },
          getHistoryResetKey: () => useMissionStore.getState().currentMission?.id ?? null,
          ...(rejectionEvidenceDelivery === null
            ? {}
            : {
                beginMissionEvidenceObservation:
                  rejectionEvidenceDelivery.beginMissionObservation,
              }),
          getInitialBreadcrumbFrom: () => {
            const mission = useMissionStore.getState().currentMission
            return mission === null ? null : new Date(mission.start_time)
          },
          getBreadcrumbDeviceIds: () => {
            const missionId = useMissionStore.getState().currentMission?.id ?? null
            return useActiveMissionDevicesStore.getState().getActiveDeviceIds(missionId)
          },
          getParticipantDeviceIds: () =>
            isMissionModelEnabled()
              ? useParticipantStore.getState().scope.historicalDeviceIdsThrough(
                  new Date().toISOString(),
                )
              : null,
          getParticipantHistoryStarts: (deviceIds, from, until) => {
            if (!isMissionModelEnabled()) return {}
            const scope = useParticipantStore.getState().scope
            return Object.fromEntries(deviceIds.flatMap((deviceId) => {
              const historyFrom = scope.firstEvidenceTimestampAtOrAfter(
                deviceId,
                from.toISOString(),
                until.toISOString(),
              )
              return historyFrom === null ? [] : [[deviceId, historyFrom]]
            }))
          },
          getInitialBreadcrumbs: hooks.getInitialBreadcrumbs,
          getInitialBreadcrumbTotals: hooks.getInitialBreadcrumbTotals,
          getInitialBreadcrumbSelectionMetadata:
            hooks.getInitialBreadcrumbSelectionMetadata,
          getInitialHistoryCheckpoints: hooks.getInitialHistoryCheckpoints,
          ...(hooks.persistHistoryRequest === undefined ? {} : { persistHistoryRequest: hooks.persistHistoryRequest }),
          ...(hooks.getCanonicalBreadcrumbs === undefined
            ? {}
            : { getCanonicalBreadcrumbs: hooks.getCanonicalBreadcrumbs }),
          ...(hooks.persistHistoryChunk === undefined
            ? {}
            : { persistHistoryChunk: hooks.persistHistoryChunk }),
          ...(hooks.persistHistoryChunks === undefined
            ? {}
            : { persistHistoryChunks: hooks.persistHistoryChunks }),
          onSnapshot: hooks.onSnapshot,
          onCurrentSnapshot: hooks.onCurrentSnapshot,
          waitForCurrentEvidenceCapacity: hooks.waitForCurrentEvidenceCapacity,
          ...(hooks.reserveCurrentEvidenceCapacity === undefined ? {} : {
            reserveCurrentEvidenceCapacity: hooks.reserveCurrentEvidenceCapacity,
          }),
          onStatusChange: hooks.onStatusChange,
          onCurrentPositionRejections: (rejections, context) => {
            if (context.suppressOperationalPublication) {
              // Retiring responses retain anomaly custody without replacing
              // the selected connection's current warning state.
              rejectionEvidenceDelivery?.recordEvidence(rejections, context)
            } else if (rejectionEvidenceDelivery !== null) {
              rejectionEvidenceDelivery.record(rejections, context)
            } else {
              applyCurrentPositionRejections(rejections)
            }
          },
          ...(rejectionEvidenceDelivery === null
            ? {}
            : { onBreadcrumbRejections: rejectionEvidenceDelivery.recordEvidence }),
          onPollDiagnostic: hooks.onPollDiagnostic,
        }),
      createTrackingCache:
        runtimeKind === 'electron' ? createElectronTrackingCache : createTauriTrackingCache,
      readTrackingRuntimeConfig,
      applySnapshot: (snapshot) => {
        const missionId = useMissionStore.getState().currentMission?.id ?? null
        applyTrackingSnapshot(
          snapshot,
          missionId,
          useActiveMissionDevicesStore.getState().getActiveDeviceIds(missionId),
        )
      },
      applyStatus: applyTrackingStatus,
      recordMissionEvidenceLoss: rejectionEvidenceDelivery?.recordMissionEvidenceLoss,
      ...(rejectionEvidenceDelivery === null
        ? {}
        : {
            recordBreadcrumbRejections:
              rejectionEvidenceDelivery.recordEvidenceAndFlush,
          }),
      ...(rejectionEvidenceDelivery === null
        ? {}
        : {
            beginMissionEvidenceObservation:
              rejectionEvidenceDelivery.beginMissionObservation,
            registerMissionEvidenceSettler:
              rejectionEvidenceDelivery.registerMissionObservationSettler,
          }),
      missionModelEnabled: isMissionModelEnabled(),
      readParticipationScope: () => useParticipantStore.getState().scope,
      readParticipationScopeStatus: () => {
        const missionState = useMissionStore.getState()
        const missionId = resolveParticipantMissionId(missionState)
        const participantState = useParticipantStore.getState()
        if (missionId === null) return 'ready'
        if (participantState.activeMissionId !== missionId || participantState.loading) {
          return 'loading'
        }
        return participantState.error === null ? 'ready' : 'error'
      },
      subscribeParticipationScope: (listener) =>
        useParticipantStore.subscribe((state, previousState) => {
          if (
            state.scope !== previousState.scope ||
            state.activeMissionId !== previousState.activeMissionId ||
            state.loading !== previousState.loading ||
            state.error !== previousState.error
          ) listener()
        }),
      applyParticipantRoster: (devices, options) =>
        useParticipantStore.getState().controller?.applyRoster(devices, undefined, options),
      applyParticipantGroups: (groups) =>
        useParticipantStore.getState().controller?.applyGroups(groups),
      applyParticipantRosterError: (message) =>
        useParticipantStore.getState().controller?.reportRosterError(message),
      notifyDurablePositionChange: (changedPositionCount) => {
        useExactBreadcrumbDotStore.getState().controller?.notifyDurableChange(
          changedPositionCount,
        )
      },
    })

    if (generation !== reloadGeneration) {
      await stopRuntimeServices(nextServices)
      return
    }

    activeServices = nextServices
    if (preservesTrackingSession) await stopRuntimeServices(previousServices)
  }
}

function resolveOperationalRuntimeKind(
  dependencies: Pick<
    StartAppRuntimeDependencies,
    'isTauriRuntimeAvailable' | 'isElectronRuntimeAvailable'
  >,
): Exclude<DesktopRuntimeKind, 'browser'> | null {
  if (dependencies.isElectronRuntimeAvailable()) {
    return 'electron'
  }

  if (dependencies.isTauriRuntimeAvailable()) {
    return 'tauri'
  }

  return null
}
