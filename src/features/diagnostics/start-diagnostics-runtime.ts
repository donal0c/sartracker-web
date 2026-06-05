import { buildDiagnosticsSnapshot } from './diagnostics-model'
import type { DiagnosticsRuntimeState } from './diagnostics-store'
import type { MissionRuntimeState } from '../mission/mission-store'
import type { MissionGovernanceRuntimeState } from '../mission/start-mission-governance-runtime'
import type { AppSettings, RuntimeBootstrapSettings } from '../settings/settings-types'
import type { TrackingConnectionStatus, TrackingSnapshot } from '../tracking/tracking-types'
import type { Mission, MissionStore } from '../../infrastructure/mission-store/tauri-mission-store'
import type { DesktopRuntimeKind } from '../../lib/desktop-runtime'

type DependencySmoke = {
  readonly hasMapLibre: boolean
  readonly hasProj4: boolean
  readonly hasTurf: boolean
  readonly hasZustand: boolean
  readonly hasTerraDraw: boolean
}

type DiagnosticsMissionStoreBoundary = Pick<MissionStore, 'info' | 'listMissions'>
type DiagnosticsLayerCatalogBoundary = {
  readonly clearMetadata: (missionId: string) => Promise<void>
}

type StartDiagnosticsRuntimeDependencies = {
  readonly appVersion: string
  readonly getRuntimeKind: () => DesktopRuntimeKind
  readonly getUserAgent: () => string
  readonly getDependencySmoke: () => DependencySmoke
  readonly loadSettings: () => Promise<AppSettings>
  readonly loadRuntimeBootstrapSettings: () => Promise<RuntimeBootstrapSettings>
  readonly missionStore: DiagnosticsMissionStoreBoundary
  readonly layerCatalogStore: DiagnosticsLayerCatalogBoundary
  readonly readMissionRuntime: () => MissionRuntimeState
  readonly readMissionGovernanceRuntime: () => MissionGovernanceRuntimeState
  readonly readTrackingRuntime: () => {
    readonly status: TrackingConnectionStatus
    readonly snapshot: TrackingSnapshot
  }
  readonly readLayerCatalogRuntime: () => {
    readonly missionId: string | null
    readonly metadataEntryCount: number
    readonly loading: boolean
    readonly error: string | null
  }
  readonly exportReport: (fileName: string, contents: string) => Promise<string>
  readonly refreshLayerCatalogIfActive: (missionId: string) => Promise<void>
  readonly applyRuntime: (runtime: DiagnosticsRuntimeState) => void
  readonly now?: () => Date
}

const EMPTY_RUNTIME: DiagnosticsRuntimeState = {
  snapshot: null,
  selectedMissionId: null,
  loading: false,
  repairing: false,
  exporting: false,
  error: null,
  feedback: null,
  exportPath: null,
}

/**
 * Loads and manages the diagnostics workspace state using cached runtime snapshots.
 */
export async function startDiagnosticsRuntime(
  dependencies: StartDiagnosticsRuntimeDependencies,
) {
  let state: DiagnosticsRuntimeState = EMPTY_RUNTIME
  let refreshToken = 0

  publishRuntime()

  return {
    load: async (preferredMissionId?: string | null) => {
      await refreshSnapshot(preferredMissionId ?? state.selectedMissionId)
    },
    selectMission: async (missionId: string) => {
      await refreshSnapshot(missionId)
    },
    repairLayerCatalog: async () => {
      const targetMissionId = state.snapshot?.repair.targetMissionId ?? null
      if (targetMissionId === null) {
        throw new Error('No mission is available for layer repair.')
      }

      state = {
        ...state,
        repairing: true,
        error: null,
        feedback: null,
      }
      publishRuntime()

      try {
        await dependencies.layerCatalogStore.clearMetadata(targetMissionId)
        await dependencies.refreshLayerCatalogIfActive(targetMissionId)
        await refreshSnapshot(targetMissionId, {
          feedback: 'Layer catalog metadata reset. The catalog has been rebuilt from canonical mission data.',
        })
      } catch (error) {
        state = {
          ...state,
          repairing: false,
          error: toErrorMessage(error, 'Layer repair failed.'),
        }
        publishRuntime()
        throw error
      }
    },
    exportSupportReport: async () => {
      const snapshot = state.snapshot
      if (snapshot === null) {
        return null
      }

      state = {
        ...state,
        exporting: true,
        error: null,
        feedback: null,
      }
      publishRuntime()

      try {
        const exportPath = await dependencies.exportReport(
          snapshot.reportFileName,
          snapshot.supportReport,
        )
        state = {
          ...state,
          exporting: false,
          exportPath,
          feedback: `Exported diagnostics report to ${exportPath}`,
        }
        publishRuntime()
        return exportPath
      } catch (error) {
        state = {
          ...state,
          exporting: false,
          error: toErrorMessage(error, 'Diagnostics report export failed.'),
        }
        publishRuntime()
        throw error
      }
    },
    clearFeedback: () => {
      state = {
        ...state,
        feedback: null,
        error: null,
      }
      publishRuntime()
    },
  }

  async function refreshSnapshot(
    preferredMissionId: string | null,
    overrides?: {
      readonly feedback?: string
    },
  ): Promise<void> {
    const token = ++refreshToken
    state = {
      ...state,
      loading: true,
      repairing: false,
      error: null,
      ...(overrides?.feedback === undefined ? {} : { feedback: overrides.feedback }),
    }
    publishRuntime()

    try {
      const [settings, runtimeBootstrap, missionStoreInfo, missions] = await Promise.all([
        dependencies.loadSettings(),
        dependencies.loadRuntimeBootstrapSettings(),
        dependencies.missionStore.info(),
        dependencies.missionStore.listMissions(),
      ])
      const missionRuntime = dependencies.readMissionRuntime()
      const governanceRuntime = dependencies.readMissionGovernanceRuntime()
      const trackingRuntime = dependencies.readTrackingRuntime()
      const layerCatalogRuntime = dependencies.readLayerCatalogRuntime()
      const selectedMissionId = resolveSelectedMissionId(missions, preferredMissionId)
      const snapshot = buildDiagnosticsSnapshot({
        generatedAt: now(dependencies).toISOString(),
        appVersion: dependencies.appVersion,
        runtimeKind: dependencies.getRuntimeKind(),
        userAgent: dependencies.getUserAgent(),
        dependencySmoke: dependencies.getDependencySmoke(),
        settings,
        runtimeBootstrap,
        missionStoreInfo,
        missions,
        missionRuntime,
        governanceRuntime,
        trackingStatus: trackingRuntime.status,
        trackingSnapshot: trackingRuntime.snapshot,
        layerCatalogState: layerCatalogRuntime,
        selectedMissionId,
      })

      if (token !== refreshToken) {
        return
      }

      state = {
        ...state,
        snapshot,
        selectedMissionId,
        loading: false,
        repairing: false,
        error: null,
        ...(overrides?.feedback === undefined ? {} : { feedback: overrides.feedback }),
      }
      publishRuntime()
    } catch (error) {
      if (token !== refreshToken) {
        return
      }

      state = {
        ...state,
        loading: false,
        repairing: false,
        error: toErrorMessage(error, 'Diagnostics could not load.'),
      }
      publishRuntime()
    }
  }

  function publishRuntime(): void {
    dependencies.applyRuntime(state)
  }
}

function resolveSelectedMissionId(
  missions: readonly Mission[],
  preferredMissionId: string | null,
): string | null {
  if (preferredMissionId !== null && missions.some((mission) => mission.id === preferredMissionId)) {
    return preferredMissionId
  }

  return missions[0]?.id ?? null
}

function now(
  dependencies: Pick<StartDiagnosticsRuntimeDependencies, 'now'>,
): Date {
  return dependencies.now?.() ?? new Date()
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
