import type { Outing } from '../../infrastructure/mission-store/tauri-mission-store'
import { useMissionStore } from '../mission/mission-store'
import { isMissionModelEnabled } from '../runtime/mission-model-flag'
import { useOutingStore } from './outing-store'

export type OutingControlsViewModel = {
  readonly enabled: boolean
  readonly missionId: string | null
  readonly outings: readonly Outing[]
  readonly activeOuting: Outing | null
  readonly loading: boolean
  readonly saving: boolean
  readonly error: string | null
  readonly canMutate: boolean
  readonly nextDefaultLabel: string
  readonly noActiveOutingNotice: string | null
  readonly unassignedFixCount: number | null
  readonly fixCountFor: (outingId: string) => number | null
  readonly startOuting: (label?: string, startedAt?: string) => Promise<boolean>
  readonly endOuting: (outingId: string, endedAt?: string) => Promise<boolean>
  readonly renameOuting: (outingId: string, label: string) => Promise<boolean>
  readonly editBoundaries: (
    outingId: string,
    startedAt: string,
    endedAt: string | null,
  ) => Promise<boolean>
}

/** Adapts outing runtime state into explicit coordinator-owned UI actions. */
export function useOutingControlsViewModel(): OutingControlsViewModel {
  const currentMission = useMissionStore((state) => state.currentMission)
  const governanceMission = useMissionStore((state) => state.governanceMission)
  const runtimeMissionId = useOutingStore((state) => state.activeMissionId)
  const outings = useOutingStore((state) => state.outings)
  const fixSummary = useOutingStore((state) => state.fixSummary)
  const loading = useOutingStore((state) => state.loading)
  const saving = useOutingStore((state) => state.saving)
  const error = useOutingStore((state) => state.error)
  const controller = useOutingStore((state) => state.controller)
  const enabled = isMissionModelEnabled()
  const mission = currentMission ?? governanceMission
  const missionId = mission?.id ?? null
  const runtimeMatchesMission = missionId !== null && runtimeMissionId === missionId
  const scopedOutings = runtimeMatchesMission ? outings : []
  const scopedFixSummary = runtimeMatchesMission ? fixSummary : null
  const effectiveLoading = loading || (missionId !== null && !runtimeMatchesMission)
  const scopedError = runtimeMatchesMission ? error : null
  const activeOuting = scopedOutings.find((outing) => outing.ended_at === null) ?? null
  const canMutate =
    enabled &&
    controller !== null &&
    mission !== null &&
    runtimeMatchesMission &&
    mission.status !== 'finalized' &&
    !loading &&
    error === null

  return {
    enabled,
    missionId,
    outings: scopedOutings,
    activeOuting,
    loading: effectiveLoading,
    saving: runtimeMatchesMission ? saving : false,
    error: scopedError,
    canMutate,
    nextDefaultLabel: `Outing ${scopedOutings.length + 1}`,
    noActiveOutingNotice:
      enabled &&
      mission !== null &&
      runtimeMatchesMission &&
      !loading &&
      error === null &&
      activeOuting === null
        ? 'No active outing — new fixes will be recorded as Unassigned.'
        : null,
    unassignedFixCount: scopedFixSummary?.unassigned_accepted_fix_count ?? null,
    fixCountFor: (outingId) =>
      scopedFixSummary?.outings.find((row) => row.outing_id === outingId)?.accepted_fix_count ?? null,
    startOuting: async (label, startedAt) => {
      if (!canMutate) return false
      return (await controller.startOuting({
        ...(label === undefined ? {} : { label }),
        ...(startedAt === undefined ? {} : { started_at: startedAt }),
      })) !== null
    },
    endOuting: async (outingId, endedAt) => {
      if (!canMutate) return false
      if (endedAt === undefined) {
        return (await controller.endOuting(outingId)) !== null
      }
      return (await controller.endOuting(outingId, endedAt)) !== null
    },
    renameOuting: async (outingId, label) => {
      if (!canMutate) return false
      return (await controller.renameOuting(outingId, label)) !== null
    },
    editBoundaries: async (outingId, startedAt, endedAt) => {
      if (!canMutate) return false
      return (await controller.editOutingBoundaries(outingId, {
        started_at: startedAt,
        ended_at: endedAt,
      })) !== null
    },
  }
}
