import type { TrackingCache } from '../../infrastructure/tracking-cache/tauri-tracking-cache'
import type {
  AutosaveStore,
  MissionAutosaveController,
} from '../persistence/mission-autosave'
import type { AutosaveSyncReason } from '../persistence/autosave-status-store'
import { useAutosaveStatusStore } from '../persistence/autosave-status-store'
import type { TrackingRuntimeMissionStore } from '../tracking/start-tracking-runtime'
import { startMissionTrackingStatusBridge } from '../tracking/mission-tracking-status-bridge'
import { recordDiagnosticEvent } from '../diagnostics/diagnostic-event-log'
import {
  recordTrackingPollLedgerEntry,
  type TrackingPollLedgerEntry,
} from '../diagnostics/tracking-poll-ledger'
import type {
  TrackingMissionEvidenceTransfer,
  TrackingSnapshotContext,
} from '../tracking/polling-manager'

const NOOP_STOP = () => undefined
const NOOP_ASYNC_STOP = async () => undefined

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
  readonly trackingDisabledReason?: string
}

export type RuntimeServiceHandles = {
  readonly stopAutosave: () => void
  readonly requestAutosaveSync: (reason: AutosaveSyncReason) => Promise<void>
  readonly stopTracking: () => Promise<void>
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
        readonly onSnapshot: (
          snapshot: import('../tracking/tracking-types').TrackingSnapshot,
          context?: TrackingSnapshotContext,
        ) => Promise<void>
        readonly onCurrentSnapshot: (
          snapshot: import('../tracking/tracking-types').TrackingSnapshot,
          context: TrackingSnapshotContext,
          observation: TrackingMissionEvidenceTransfer,
        ) => void
        readonly onStatusChange: (status: import('../tracking/tracking-types').TrackingConnectionStatus) => void
        readonly getInitialBreadcrumbs: () => Promise<readonly import('../tracking/tracking-types').NormalizedTrackingPosition[]>
        readonly getInitialBreadcrumbTotals: () => Promise<Readonly<Record<string, number>>>
        readonly getInitialBreadcrumbSelectionMetadata: () => Promise<Readonly<Record<string, {
          readonly geometryErrorBoundMetres: number | null
          readonly targetGeometryErrorSatisfied: boolean
        }>>>
        readonly getInitialHistoryCheckpoints: () => Promise<Readonly<Record<string, {
          readonly historyFrom: string
          readonly reconciledUntil: string
        }>>>
        readonly getCanonicalBreadcrumbs?: (
          expectedMissionId: string,
        ) => Promise<import('../tracking/polling-manager').CanonicalBreadcrumbSeed>
        readonly persistHistoryChunk?: (
          input: import('../tracking/polling-manager').TrackingHistoryChunkPersistenceInput,
        ) => Promise<import('../tracking/polling-manager').TrackingHistoryChunkPersistenceResult>
        readonly persistHistoryChunks?: (
          inputs: readonly import('../tracking/polling-manager').TrackingHistoryChunkPersistenceInput[],
        ) => Promise<void>
        readonly onPollDiagnostic: (entry: TrackingPollLedgerEntry) => void
      },
    ) => {
      readonly start: () => void
      readonly stop: () => Promise<void>
    }
    readonly cache: {
      readonly read: () => Promise<string | null>
      readonly write: (contents: string) => Promise<string>
    }
    readonly missionStore: TrackingRuntimeMissionStore
    readonly applySnapshot: (snapshot: import('../tracking/tracking-types').TrackingSnapshot) => void
    readonly applyStatus: (status: import('../tracking/tracking-types').TrackingConnectionStatus) => void
    readonly idleWarning?: string
    readonly maxPersistedPositionsPerSnapshot?: number
    readonly writeCache?: boolean
    readonly recordDiagnosticEvent?: typeof recordDiagnosticEvent
    readonly recordMissionEvidenceLoss?:
      | ((
          missionId: string,
          reason: import('../../domain/tracking-ingest-evidence').IngestEvidenceLossReason,
        ) => Promise<void>)
      | undefined
    readonly beginMissionEvidenceObservation?: (missionId: string) => {
      readonly missionId: string | null
      readonly complete: () => void
    }
    readonly registerMissionEvidenceSettler?: (
      settler: (missionId: string) => Promise<void>,
    ) => () => void
    readonly recordTrackingPollDiagnostic?: typeof recordTrackingPollLedgerEntry
    readonly notifyDurablePositionChange?: (changedPositionCount: number) => void
    readonly missionModelEnabled?: boolean
    readonly readParticipationScope?: () => import('../participants/participation-scope').ParticipationScope
    readonly readParticipationScopeStatus?: () => 'loading' | 'ready' | 'error'
    readonly subscribeParticipationScope?: (listener: () => void) => () => void
    readonly applyParticipantRoster?: (
      devices: readonly import('../tracking/tracking-types').NormalizedTrackingDevice[],
      options?: { readonly complete: boolean },
    ) => void | Promise<void>
    readonly applyParticipantGroups?: (
      groups: readonly import('../tracking/tracking-types').NormalizedTraccarGroup[],
    ) => void | Promise<void>
    readonly applyParticipantRosterError?: (message: string | null) => void
  }) => Promise<() => void>
  readonly createClient: (config: NonNullable<RuntimeBootstrapSettings['trackingConfig']>) => unknown
  readonly createPoller: (
    client: unknown,
    hooks: {
      readonly onSnapshot: (
        snapshot: import('../tracking/tracking-types').TrackingSnapshot,
        context?: TrackingSnapshotContext,
      ) => Promise<void>
      readonly onCurrentSnapshot: (
        snapshot: import('../tracking/tracking-types').TrackingSnapshot,
        context: TrackingSnapshotContext,
        observation: TrackingMissionEvidenceTransfer,
      ) => void
      readonly onStatusChange: (status: import('../tracking/tracking-types').TrackingConnectionStatus) => void
      readonly getInitialBreadcrumbs: () => Promise<readonly import('../tracking/tracking-types').NormalizedTrackingPosition[]>
      readonly getInitialBreadcrumbTotals: () => Promise<Readonly<Record<string, number>>>
      readonly getInitialBreadcrumbSelectionMetadata: () => Promise<Readonly<Record<string, {
        readonly geometryErrorBoundMetres: number | null
        readonly targetGeometryErrorSatisfied: boolean
      }>>>
      readonly getInitialHistoryCheckpoints: () => Promise<Readonly<Record<string, {
        readonly historyFrom: string
        readonly reconciledUntil: string
      }>>>
      readonly getCanonicalBreadcrumbs?: (
        expectedMissionId: string,
      ) => Promise<import('../tracking/polling-manager').CanonicalBreadcrumbSeed>
      readonly persistHistoryChunk?: (
        input: import('../tracking/polling-manager').TrackingHistoryChunkPersistenceInput,
      ) => Promise<import('../tracking/polling-manager').TrackingHistoryChunkPersistenceResult>
      readonly persistHistoryChunks?: (
        inputs: readonly import('../tracking/polling-manager').TrackingHistoryChunkPersistenceInput[],
      ) => Promise<void>
      readonly onPollDiagnostic: (entry: TrackingPollLedgerEntry) => void
    },
  ) => {
    readonly start: () => void
    readonly stop: () => Promise<void>
  }
  readonly applySnapshot: (snapshot: import('../tracking/tracking-types').TrackingSnapshot) => void
  readonly applyStatus: (status: import('../tracking/tracking-types').TrackingConnectionStatus) => void
  readonly readTrackingRuntimeConfig: () => RuntimeBootstrapSettings['trackingConfig']
  readonly createTrackingCache: () => TrackingCache
  readonly notifyDurablePositionChange?: (changedPositionCount: number) => void
  readonly recordMissionEvidenceLoss?:
    | ((
        missionId: string,
        reason: import('../../domain/tracking-ingest-evidence').IngestEvidenceLossReason,
      ) => Promise<void>)
    | undefined
  readonly beginMissionEvidenceObservation?: (missionId: string) => {
    readonly missionId: string | null
    readonly complete: () => void
  }
  readonly registerMissionEvidenceSettler?: (
    settler: (missionId: string) => Promise<void>,
  ) => () => void
  readonly missionModelEnabled?: boolean
  readonly readParticipationScope?: () => import('../participants/participation-scope').ParticipationScope
  readonly readParticipationScopeStatus?: () => 'loading' | 'ready' | 'error'
  readonly subscribeParticipationScope?: (listener: () => void) => () => void
  readonly applyParticipantRoster?: (
    devices: readonly import('../tracking/tracking-types').NormalizedTrackingDevice[],
    options?: { readonly complete: boolean },
  ) => void | Promise<void>
  readonly applyParticipantGroups?: (
    groups: readonly import('../tracking/tracking-types').NormalizedTraccarGroup[],
  ) => void | Promise<void>
  readonly applyParticipantRosterError?: (message: string | null) => void
}

/**
 * Creates an empty service handle set so callers can manage lifecycle uniformly.
 */
export function createNoopRuntimeServiceHandles(): RuntimeServiceHandles {
  return {
    stopAutosave: NOOP_STOP,
    requestAutosaveSync: async () => undefined,
    stopTracking: NOOP_ASYNC_STOP,
  }
}

/**
 * Stops a previously-started runtime service set.
 */
export async function stopRuntimeServices(handles: RuntimeServiceHandles): Promise<void> {
  handles.stopAutosave()
  await handles.stopTracking()
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
    const trackingConfig = Object.prototype.hasOwnProperty.call(
      dependencies.runtimeSettings,
      'trackingConfig',
    )
      ? dependencies.runtimeSettings.trackingConfig
      : dependencies.readTrackingRuntimeConfig()
    const stopTrackingPoller = await dependencies.startTrackingRuntime({
      config: trackingConfig,
      createClient: dependencies.createClient,
      createPoller: dependencies.createPoller,
      cache: dependencies.runtimeSettings.trackingCacheEnabled
        ? dependencies.createTrackingCache()
        : NOOP_TRACKING_CACHE,
      writeCache: dependencies.runtimeSettings.trackingCacheEnabled,
      missionStore: dependencies.missionStore,
      applySnapshot: dependencies.applySnapshot,
      applyStatus: dependencies.applyStatus,
      recordDiagnosticEvent,
      recordTrackingPollDiagnostic: recordTrackingPollLedgerEntry,
      recordMissionEvidenceLoss: dependencies.recordMissionEvidenceLoss,
      ...(dependencies.beginMissionEvidenceObservation === undefined
        ? {}
        : {
            beginMissionEvidenceObservation:
              dependencies.beginMissionEvidenceObservation,
          }),
      ...(dependencies.registerMissionEvidenceSettler === undefined
        ? {}
        : {
            registerMissionEvidenceSettler:
              dependencies.registerMissionEvidenceSettler,
          }),
      ...(dependencies.missionModelEnabled === undefined
        ? {}
        : { missionModelEnabled: dependencies.missionModelEnabled }),
      ...(dependencies.readParticipationScope === undefined
        ? {}
        : { readParticipationScope: dependencies.readParticipationScope }),
      ...(dependencies.readParticipationScopeStatus === undefined
        ? {}
        : { readParticipationScopeStatus: dependencies.readParticipationScopeStatus }),
      ...(dependencies.subscribeParticipationScope === undefined
        ? {}
        : { subscribeParticipationScope: dependencies.subscribeParticipationScope }),
      ...(dependencies.applyParticipantRoster === undefined
        ? {}
        : { applyParticipantRoster: dependencies.applyParticipantRoster }),
      ...(dependencies.applyParticipantGroups === undefined
        ? {}
        : { applyParticipantGroups: dependencies.applyParticipantGroups }),
      ...(dependencies.applyParticipantRosterError === undefined
        ? {}
        : { applyParticipantRosterError: dependencies.applyParticipantRosterError }),
      ...(dependencies.notifyDurablePositionChange === undefined
        ? {}
        : { notifyDurablePositionChange: dependencies.notifyDurablePositionChange }),
      ...(dependencies.runtimeSettings.trackingDisabledReason === undefined
        ? {}
        : { idleWarning: dependencies.runtimeSettings.trackingDisabledReason }),
    })
    const stopTrackingStatusBridge = trackingConfig === null
      ? NOOP_STOP
      : startMissionTrackingStatusBridge({
          applySnapshot: dependencies.applySnapshot,
          applyStatus: dependencies.applyStatus,
        })

    return {
      stopAutosave: autosave.stop,
      requestAutosaveSync: autosave.requestSync,
      stopTracking: async () => {
        stopTrackingStatusBridge()
        await stopTrackingPoller()
      },
    }
  } catch (error) {
    autosave.stop()
    throw error
  }
}
