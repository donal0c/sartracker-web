import type {
  CreateMissionInput,
  Mission,
  MissionStore,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { AutosaveSyncReason } from '../persistence/autosave-status-store'
import type { MissionRuntimeState } from './mission-store'

type StartMissionRuntimeDependencies = {
  readonly missionStore: Pick<
    MissionStore,
    'createMission' | 'listMissions' | 'getRecoverableMission' | 'pauseMission' | 'resumeMission' | 'finishMission'
  >
  readonly applyRuntime: (runtime: MissionRuntimeState) => void
  readonly requestAutosaveSync?: (reason: AutosaveSyncReason) => Promise<void>
  readonly now?: () => Date
}

type StartMissionInput = {
  readonly name: string
  readonly startTime?: string
}

const MAX_START_OFFSET_HOURS = 48
const MAX_START_OFFSET_MILLISECONDS = MAX_START_OFFSET_HOURS * 60 * 60 * 1000

export type MissionRuntimeController = {
  readonly startMission: (input: StartMissionInput) => Promise<Mission>
  readonly hasMissionNameConflict: (name: string) => Promise<boolean>
  readonly pauseMission: () => Promise<Mission | null>
  readonly resumeMission: () => Promise<Mission | null>
  readonly finishMission: () => Promise<Mission | null>
  readonly resumeRecoverableMission: () => Promise<Mission | null>
  readonly startFresh: () => Promise<Mission | null>
}

/**
 * Starts the mission runtime, including crash recovery detection.
 */
export async function startMissionRuntime(
  dependencies: StartMissionRuntimeDependencies,
): Promise<MissionRuntimeController> {
  const recoverableMission = await dependencies.missionStore.getRecoverableMission()
  let currentMission: Mission | null = null
  let currentRecoverableMission: Mission | null =
    recoverableMission?.status === 'active'
      ? await dependencies.missionStore.pauseMission(recoverableMission.id)
      : recoverableMission

  publishRuntime()

  return {
    startMission: async (input) => {
      assertMissionName(input.name)
      if (currentMission !== null || currentRecoverableMission !== null) {
        throw new Error('Resolve the current mission before starting a new one.')
      }

      const mission = await dependencies.missionStore.createMission(
        buildCreateMissionInput(input, dependencies.now?.()),
      )
      currentMission = mission
      currentRecoverableMission = null
      publishRuntime()
      await requestAutosaveSync('mission-start')
      return mission
    },
    hasMissionNameConflict: async (name) => {
      const normalizedName = name.trim().toLowerCase()
      if (normalizedName === '') {
        return false
      }

      const missions = await dependencies.missionStore.listMissions()
      return missions.some((mission) => mission.name.trim().toLowerCase() === normalizedName)
    },
    pauseMission: async () => {
      if (currentMission === null) {
        return null
      }

      const mission = await dependencies.missionStore.pauseMission(currentMission.id)
      currentMission = mission
      publishRuntime()
      await requestAutosaveSync('mission-pause')
      return mission
    },
    resumeMission: async () => {
      if (currentMission === null) {
        return null
      }

      const mission = await dependencies.missionStore.resumeMission(currentMission.id)
      currentMission = mission
      publishRuntime()
      await requestAutosaveSync('mission-resume')
      return mission
    },
    finishMission: async () => {
      if (currentMission === null) {
        return null
      }

      const mission = await dependencies.missionStore.finishMission(currentMission.id)
      currentMission = null
      currentRecoverableMission = null
      publishRuntime()
      await requestAutosaveSync('mission-finish')
      return mission
    },
    resumeRecoverableMission: async () => {
      if (currentRecoverableMission === null) {
        return null
      }

      const mission = await dependencies.missionStore.resumeMission(currentRecoverableMission.id)
      currentMission = mission
      currentRecoverableMission = null
      publishRuntime()
      await requestAutosaveSync('mission-recover-resume')
      return mission
    },
    startFresh: async () => {
      if (currentRecoverableMission === null) {
        currentMission = null
        currentRecoverableMission = null
        publishRuntime()
        return null
      }

      const mission = await dependencies.missionStore.finishMission(currentRecoverableMission.id)
      currentMission = null
      currentRecoverableMission = null
      publishRuntime()
      await requestAutosaveSync('mission-start-fresh')
      return mission
    },
  }

  function publishRuntime(): void {
    dependencies.applyRuntime(toRuntimeState(currentMission, currentRecoverableMission))
  }

  async function requestAutosaveSync(reason: AutosaveSyncReason): Promise<void> {
    try {
      await dependencies.requestAutosaveSync?.(reason)
    } catch (error) {
      console.warn('Mission lifecycle autosave request failed.', error)
    }
  }
}

function buildCreateMissionInput(input: StartMissionInput, now?: Date): CreateMissionInput {
  const startTime = input.startTime
  if (startTime === undefined) {
    return { name: input.name }
  }

  const normalizedStartTime = new Date(startTime)
  if (Number.isNaN(normalizedStartTime.getTime())) {
    throw new Error('Mission start time must be a valid UTC timestamp.')
  }

  if (now !== undefined && normalizedStartTime.getTime() > now.getTime()) {
    throw new Error('Mission start time cannot be in the future.')
  }

  if (now !== undefined && now.getTime() - normalizedStartTime.getTime() > MAX_START_OFFSET_MILLISECONDS) {
    throw new Error(
      `Mission start time cannot be more than ${MAX_START_OFFSET_HOURS} hours in the past.`,
    )
  }

  return {
    name: input.name,
    start_time: normalizedStartTime.toISOString(),
  }
}

function toRuntimeState(
  currentMission: Mission | null,
  recoverableMission: Mission | null,
): MissionRuntimeState {
  if (recoverableMission !== null) {
    return {
      phase: 'recovery',
      currentMission: null,
      recoverableMission,
    }
  }

  if (currentMission === null) {
    return {
      phase: 'idle',
      currentMission: null,
      recoverableMission: null,
    }
  }

  return {
    phase: currentMission.status === 'paused' ? 'paused' : 'active',
    currentMission,
    recoverableMission: null,
  }
}

function assertMissionName(name: string): void {
  if (name.trim() === '') {
    throw new Error('Mission name is required.')
  }
}
