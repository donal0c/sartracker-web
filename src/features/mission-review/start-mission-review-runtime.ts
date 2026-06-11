import type {
  Mission,
  MissionEvent,
  MissionStore,
  MissionStoreInfo,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { LayerCatalogStore } from '../../infrastructure/layer-catalog-store/tauri-layer-catalog-store'
import { buildMissionReviewSnapshot, type MissionReviewSnapshot } from './mission-review-model'
import { DEFAULT_AUDIT_EVENT_LIMIT } from './audit-events'

type MissionReviewStoreBoundary = Pick<
  MissionStore,
  | 'info'
  | 'listMissions'
  | 'listAuditEvents'
  | 'listMarkers'
  | 'listDevices'
  | 'listPositions'
  | 'listDrawings'
  | 'listHelicopters'
  | 'listGpxImports'
>

export type MissionReviewRuntimeState = {
  readonly missions: readonly Mission[]
  readonly selectedMissionId: string | null
  readonly snapshot: MissionReviewSnapshot | null
  readonly loading: boolean
  readonly refreshing: boolean
  readonly error: string | null
  /** Whether high-volume tracking telemetry is included in the audit log. */
  readonly includeTelemetry: boolean
  /** True when the audit log was capped and older events are not shown. */
  readonly auditLogTruncated: boolean
}

export type MissionReviewController = {
  readonly load: (preferredMissionId?: string | null) => Promise<void>
  readonly selectMission: (missionId: string) => Promise<void>
  readonly refreshSelectedMission: () => Promise<void>
  /** Reloads the selected mission with telemetry events shown or hidden. */
  readonly setIncludeTelemetry: (includeTelemetry: boolean) => Promise<void>
}

type StartMissionReviewRuntimeDependencies = {
  readonly missionStore: MissionReviewStoreBoundary
  readonly layerCatalogStore: Pick<LayerCatalogStore, 'listMetadata'>
  readonly applyRuntime: (runtime: MissionReviewRuntimeState) => void
}

const EMPTY_RUNTIME: MissionReviewRuntimeState = {
  missions: [],
  selectedMissionId: null,
  snapshot: null,
  loading: false,
  refreshing: false,
  error: null,
  includeTelemetry: false,
  auditLogTruncated: false,
}

export async function startMissionReviewRuntime(
  dependencies: StartMissionReviewRuntimeDependencies,
): Promise<MissionReviewController> {
  let state: MissionReviewRuntimeState = EMPTY_RUNTIME
  let refreshToken = 0

  publishRuntime()

  return {
    load: async (preferredMissionId) => {
      await loadMission(preferredMissionId ?? null, false)
    },
    selectMission: async (missionId) => {
      await loadMission(missionId, true)
    },
    refreshSelectedMission: async () => {
      await loadMission(state.selectedMissionId, true)
    },
    setIncludeTelemetry: async (includeTelemetry) => {
      state = { ...state, includeTelemetry }
      await loadMission(state.selectedMissionId, true)
    },
  }

  async function loadMission(
    preferredMissionId: string | null,
    preserveSnapshot: boolean,
  ): Promise<void> {
    const currentToken = ++refreshToken
    state = {
      ...state,
      loading: !preserveSnapshot || state.snapshot === null,
      refreshing: preserveSnapshot && state.snapshot !== null,
      error: null,
    }
    publishRuntime()

    try {
      const missions = await dependencies.missionStore.listMissions()
      const selectedMission =
        selectMissionFromList(missions, preferredMissionId ?? state.selectedMissionId) ?? null

      if (selectedMission === null) {
        state = {
          ...state,
          missions,
          selectedMissionId: null,
          snapshot: null,
          loading: false,
          refreshing: false,
          error: null,
          auditLogTruncated: false,
        }
        publishIfCurrent(currentToken)
        return
      }

      // Request one extra event so a full page signals there is more history than shown.
      const auditEventLimit = DEFAULT_AUDIT_EVENT_LIMIT
      const [auditEvents, info, markers, devices, positions, drawings, helicopters, gpxImports, layerMetadata] =
        await Promise.all([
          dependencies.missionStore.listAuditEvents(selectedMission.id, {
            includeTelemetry: state.includeTelemetry,
            limit: auditEventLimit + 1,
          }),
          dependencies.missionStore.info(),
          dependencies.missionStore.listMarkers(selectedMission.id),
          dependencies.missionStore.listDevices(selectedMission.id),
          dependencies.missionStore.listPositions(selectedMission.id),
          dependencies.missionStore.listDrawings(selectedMission.id),
          'listHelicopters' in dependencies.missionStore
            ? dependencies.missionStore.listHelicopters(selectedMission.id)
            : Promise.resolve([]),
          dependencies.missionStore.listGpxImports(selectedMission.id),
          dependencies.layerCatalogStore.listMetadata(selectedMission.id),
        ])

      const auditLogTruncated = auditEvents.length > auditEventLimit
      // Stores return audit events newest-first and capped; the snapshot model expects
      // chronological order, so trim to the page size and reverse to ascending.
      const events = auditEvents.slice(0, auditEventLimit).slice().reverse()

      state = {
        ...state,
        missions,
        selectedMissionId: selectedMission.id,
        snapshot: buildMissionReviewSnapshot({
          mission: selectedMission,
          info,
          events,
          markers,
          devices,
          positions,
          drawings,
          helicopters,
          gpxImports,
          layerMetadata,
        }),
        loading: false,
        refreshing: false,
        error: null,
        auditLogTruncated,
      }
      publishIfCurrent(currentToken)
    } catch (error) {
      state = {
        ...state,
        loading: false,
        refreshing: false,
        error: toErrorMessage(error),
      }
      publishIfCurrent(currentToken)
    }
  }

  function publishIfCurrent(token: number): void {
    if (token !== refreshToken) {
      return
    }

    publishRuntime()
  }

  function publishRuntime(): void {
    dependencies.applyRuntime(state)
  }
}

function selectMissionFromList(
  missions: readonly Mission[],
  missionId: string | null,
): Mission | null {
  if (missions.length === 0) {
    return null
  }

  if (missionId !== null) {
    const selected = missions.find((mission) => mission.id === missionId)
    if (selected !== undefined) {
      return selected
    }
  }

  return (
    missions.find((mission) => mission.status === 'active' || mission.status === 'paused') ??
    missions.find((mission) => mission.status === 'finished' || mission.status === 'finalized') ??
    missions[0] ??
    null
  )
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Mission review could not load.'
}

export function createMissionReviewRuntimeState(
  overrides: Partial<MissionReviewRuntimeState> = {},
): MissionReviewRuntimeState {
  return {
    ...EMPTY_RUNTIME,
    ...overrides,
  }
}

export type MissionReviewRuntimeFixtures = {
  readonly info: MissionStoreInfo
  readonly events: readonly MissionEvent[]
}
