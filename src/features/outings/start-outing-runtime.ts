import type {
  CreateOutingInput,
  EditOutingBoundariesInput,
  EndOutingInput,
  Outing,
  OutingFixSummary,
  RenameOutingInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { OutingRuntimeState } from './outing-store'

type OutingStoreBoundary = {
  readonly createOuting: (input: CreateOutingInput) => Promise<Outing>
  readonly endOuting: (input: EndOutingInput) => Promise<Outing>
  readonly renameOuting: (input: RenameOutingInput) => Promise<Outing>
  readonly editOutingBoundaries: (input: EditOutingBoundariesInput) => Promise<Outing>
  readonly listOutings: (missionId: string) => Promise<readonly Outing[]>
  readonly readOutingFixSummary: (
    input: { readonly missionId: string },
    requestId?: string,
  ) => Promise<OutingFixSummary>
  readonly cancelOutingFixSummary: (requestId: string) => Promise<boolean>
}

type StartOutingRuntimeDependencies = {
  readonly outingStore: OutingStoreBoundary
  readonly applyRuntime: (runtime: OutingRuntimeState) => void
}

export type OutingRuntimeController = {
  readonly refreshMission: (missionId: string | null) => Promise<void>
  readonly startOuting: (input?: { readonly label?: string; readonly started_at?: string }) => Promise<Outing | null>
  readonly endOuting: (outingId: string, endedAt?: string) => Promise<Outing | null>
  readonly renameOuting: (outingId: string, label: string) => Promise<Outing | null>
  readonly editOutingBoundaries: (
    outingId: string,
    boundaries: Pick<EditOutingBoundariesInput, 'started_at' | 'ended_at'>,
  ) => Promise<Outing | null>
  readonly clearError: () => void
}

/**
 * Owns outing hydration and write orchestration. Fix summaries remain on the
 * cancellable worker-backed mission-store path and stale results are ignored.
 */
export async function startOutingRuntime(
  dependencies: StartOutingRuntimeDependencies,
): Promise<OutingRuntimeController> {
  let activeMissionId: string | null = null
  let outings: readonly Outing[] = []
  let fixSummary: OutingFixSummary | null = null
  let loading = false
  let saving = false
  let error: string | null = null
  let refreshToken = 0
  let summarySequence = 0
  let activeSummaryRequestId: string | null = null

  publishRuntime()

  const controller: OutingRuntimeController = {
    refreshMission: async (missionId) => {
      const token = ++refreshToken
      const previousRequestId = activeSummaryRequestId
      activeSummaryRequestId = null
      if (previousRequestId !== null) {
        await dependencies.outingStore.cancelOutingFixSummary(previousRequestId).catch(() => false)
      }

      activeMissionId = missionId
      error = null
      if (missionId === null) {
        outings = []
        fixSummary = null
        loading = false
        publishRuntime()
        return
      }

      loading = true
      fixSummary = null
      publishRuntime()
      const requestId = `outing-summary-${++summarySequence}`
      activeSummaryRequestId = requestId
      try {
        const [nextOutings, nextSummary] = await Promise.all([
          dependencies.outingStore.listOutings(missionId),
          dependencies.outingStore.readOutingFixSummary({ missionId }, requestId),
        ])
        if (token !== refreshToken || missionId !== activeMissionId) {
          return
        }
        outings = nextOutings
        fixSummary = nextSummary
      } catch (runtimeError) {
        if (token !== refreshToken || missionId !== activeMissionId) {
          return
        }
        outings = []
        fixSummary = null
        error = toErrorMessage(runtimeError)
      } finally {
        if (activeSummaryRequestId === requestId) {
          activeSummaryRequestId = null
        }
        if (token === refreshToken && missionId === activeMissionId) {
          loading = false
          publishRuntime()
        }
      }
    },
    startOuting: async (input = {}) => mutate(async (missionId) =>
      dependencies.outingStore.createOuting({
        mission_id: missionId,
        label: input.label?.trim() || nextDefaultLabel(outings),
        ...(input.started_at === undefined ? {} : { started_at: input.started_at }),
      })),
    endOuting: async (outingId, endedAt) => mutate(async (missionId) =>
      dependencies.outingStore.endOuting({
        mission_id: missionId,
        outing_id: outingId,
        ...(endedAt === undefined ? {} : { ended_at: endedAt }),
      })),
    renameOuting: async (outingId, label) => mutate(async (missionId) =>
      dependencies.outingStore.renameOuting({
        mission_id: missionId,
        outing_id: outingId,
        label,
      })),
    editOutingBoundaries: async (outingId, boundaries) => mutate(async (missionId) =>
      dependencies.outingStore.editOutingBoundaries({
        mission_id: missionId,
        outing_id: outingId,
        ...boundaries,
      })),
    clearError: () => {
      error = null
      publishRuntime()
    },
  }

  return controller

  async function mutate(operation: (missionId: string) => Promise<Outing>): Promise<Outing | null> {
    const missionId = activeMissionId
    if (missionId === null || saving) {
      return null
    }
    saving = true
    error = null
    publishRuntime()
    try {
      const result = await operation(missionId)
      if (activeMissionId === missionId) {
        await controller.refreshMission(missionId)
      }
      return result
    } catch (runtimeError) {
      if (activeMissionId === missionId) {
        error = toErrorMessage(runtimeError)
      }
      return null
    } finally {
      saving = false
      publishRuntime()
    }
  }

  function publishRuntime(): void {
    dependencies.applyRuntime({
      activeMissionId,
      outings,
      fixSummary,
      loading,
      saving,
      error,
    })
  }
}

/** Narrows the optional MissionStore outing surface after boot validation. */
export function hasOutingStoreBoundary(
  store: Partial<OutingStoreBoundary>,
): store is OutingStoreBoundary {
  return (
    store.createOuting !== undefined &&
    store.endOuting !== undefined &&
    store.renameOuting !== undefined &&
    store.editOutingBoundaries !== undefined &&
    store.listOutings !== undefined &&
    store.readOutingFixSummary !== undefined &&
    store.cancelOutingFixSummary !== undefined
  )
}

function nextDefaultLabel(outings: readonly Outing[]): string {
  return `Outing ${outings.length + 1}`
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
