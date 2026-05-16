import type { TrackingCache } from '../../infrastructure/tracking-cache/tauri-tracking-cache'
import type {
  AutosaveStore,
  MissionAutosaveController,
} from '../persistence/mission-autosave'
import type { AutosaveSyncReason } from '../persistence/autosave-status-store'
import { useAutosaveStatusStore } from '../persistence/autosave-status-store'
import type { TrackingRuntimeMissionStore } from '../tracking/start-tracking-runtime'

const NOOP_STOP = () => undefined

const NOOP_TRACKING_CACHE = {
  read: async () => null,
  write: async (contents: string) => contents,
}

export type RuntimeBootstrapSettings = {
  readonly autosaveEnabled: boolean
  readonly autosaveIntervalMs: number
  readonly trackingPollIntervalMs: number
  readonly trackingCacheEnabled: boolean
  readonly trackingConfig: {
    readonly baseUrl: string
    readonly email?: string
    readonly password?: string
    readonly token?: string
  } | null
}

export type RuntimeServiceHandles = {
  readonly stopAutosave: () => void
  readonly requestAutosaveSync: (reason: AutosaveSyncReason) => Promise<void>
  readonly stopTracking: () => void
}

type CreateManagedRuntimeServicesDependencies = {
  readonly runtimeSettings: RuntimeBootstrapSettings
  readonly missionStore: AutosaveStore & TrackingRuntimeMissionStore
  readonly startMissionAutosave: (
    store: AutosaveStore,
    options?: { readonly intervalMs?: number },
  ) => MissionAutosaveController
  readonly startTrackingRuntime: (input: {
    readonly config: RuntimeBootstrapSettings['trackingConfig']
    readonly createClient: (config: NonNullable<RuntimeBootstrapSettings['trackingConfig']>) => unknown
    readonly createPoller: (
      client: unknown,
      hooks: {
        readonly onSnapshot: (snapshot: import('../tracking/tracking-types').TrackingSnapshot) => Promise<void>
        readonly onStatusChange: (status: import('../tracking/tracking-types').TrackingConnectionStatus) => void
      },
    ) => {
      readonly start: () => void
      readonly stop: () => void
    }
    readonly cache: {
      readonly read: () => Promise<string | null>
      readonly write: (contents: string) => Promise<string>
    }
    readonly missionStore: TrackingRuntimeMissionStore
    readonly applySnapshot: (snapshot: import('../tracking/tracking-types').TrackingSnapshot) => void
    readonly applyStatus: (status: import('../tracking/tracking-types').TrackingConnectionStatus) => void
  }) => Promise<() => void>
  readonly createClient: (config: NonNullable<RuntimeBootstrapSettings['trackingConfig']>) => unknown
  readonly createPoller: (
    client: unknown,
    hooks: {
      readonly onSnapshot: (snapshot: import('../tracking/tracking-types').TrackingSnapshot) => Promise<void>
      readonly onStatusChange: (status: import('../tracking/tracking-types').TrackingConnectionStatus) => void
    },
  ) => {
    readonly start: () => void
    readonly stop: () => void
  }
  readonly applySnapshot: (snapshot: import('../tracking/tracking-types').TrackingSnapshot) => void
  readonly applyStatus: (status: import('../tracking/tracking-types').TrackingConnectionStatus) => void
  readonly readTrackingRuntimeConfig: () => RuntimeBootstrapSettings['trackingConfig']
  readonly createTrackingCache: () => TrackingCache
}

/**
 * Creates an empty service handle set so callers can manage lifecycle uniformly.
 */
export function createNoopRuntimeServiceHandles(): RuntimeServiceHandles {
  return {
    stopAutosave: NOOP_STOP,
    requestAutosaveSync: async () => undefined,
    stopTracking: NOOP_STOP,
  }
}

/**
 * Stops a previously-started runtime service set.
 */
export function stopRuntimeServices(handles: RuntimeServiceHandles): void {
  handles.stopAutosave()
  handles.stopTracking()
}

/**
 * Starts autosave and tracking together, ensuring partial startup is cleaned up on failure.
 */
export async function createManagedRuntimeServices(
  dependencies: CreateManagedRuntimeServicesDependencies,
): Promise<RuntimeServiceHandles> {
  if (!dependencies.runtimeSettings.autosaveEnabled) {
    useAutosaveStatusStore.getState().markDisabled()
  }

  const autosave = dependencies.runtimeSettings.autosaveEnabled
    ? dependencies.startMissionAutosave(dependencies.missionStore, {
        intervalMs: dependencies.runtimeSettings.autosaveIntervalMs,
      })
    : {
        stop: NOOP_STOP,
        requestSync: async () => undefined,
      }

  try {
    const stopTracking = await dependencies.startTrackingRuntime({
      config:
        dependencies.runtimeSettings.trackingConfig ??
        dependencies.readTrackingRuntimeConfig(),
      createClient: dependencies.createClient,
      createPoller: dependencies.createPoller,
      cache: dependencies.runtimeSettings.trackingCacheEnabled
        ? dependencies.createTrackingCache()
        : NOOP_TRACKING_CACHE,
      missionStore: dependencies.missionStore,
      applySnapshot: dependencies.applySnapshot,
      applyStatus: dependencies.applyStatus,
    })

    return {
      stopAutosave: autosave.stop,
      requestAutosaveSync: autosave.requestSync,
      stopTracking,
    }
  } catch (error) {
    autosave.stop()
    throw error
  }
}
