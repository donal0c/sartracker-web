import type {
  CreateMissionInput,
  Mission,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { applyMissionRuntime, applyMissionRuntimeController } from './mission-store'
import { startMissionRuntime } from './start-mission-runtime'

type MissionHarnessState = {
  readonly missions: readonly Mission[]
  readonly currentMissionId: string | null
  readonly recoverableMissionId: string | null
}

const MISSION_HARNESS_STORAGE_KEY = 'sartracker:mission-harness'

/**
 * Returns whether the browser mission harness should be enabled for validation.
 */
export function shouldEnableMissionBrowserHarness(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return false
  }

  return new URLSearchParams(window.location.search).get('missionHarness') === '1'
}

/**
 * Starts a browser-only mission runtime harness for headless validation.
 */
export async function startMissionBrowserHarness(): Promise<void> {
  if (typeof window === 'undefined') {
    return
  }

  const browserStore = createBrowserMissionStore(() => new Date())
  const controller = await startMissionRuntime({
    missionStore: browserStore,
    applyRuntime: applyMissionRuntime,
    now: () => new Date(),
  })

  applyMissionRuntimeController(controller)
}

function createBrowserMissionStore(now: () => Date) {
  let state = readHarnessState()

  const save = () => {
    window.sessionStorage.setItem(MISSION_HARNESS_STORAGE_KEY, JSON.stringify(state))
  }

  return {
    createMission: async (input: CreateMissionInput): Promise<Mission> => {
      const mission = {
        id: createMissionId(),
        name: input.name,
        status: 'active',
        start_time: input.start_time ?? now().toISOString(),
        pause_time: null,
        finish_time: null,
        paused_seconds: 0,
        notes: input.notes ?? null,
        schema_version: 1,
      } satisfies Mission

      state = {
        missions: [...state.missions, mission],
        currentMissionId: mission.id,
        recoverableMissionId: null,
      }
      save()

      return mission
    },
    listMissions: async (): Promise<readonly Mission[]> => state.missions,
    getRecoverableMission: async (): Promise<Mission | null> => {
      const currentMission = findMission(state.currentMissionId, state.missions)
      if (currentMission?.status === 'active') {
        const pausedMission = {
          ...currentMission,
          status: 'paused' as const,
          pause_time: now().toISOString(),
        }
        state = replaceMission(state, pausedMission, null, pausedMission.id)
        save()
        return pausedMission
      }

      if (currentMission?.status === 'paused') {
        state = replaceMission(state, currentMission, null, currentMission.id)
        save()
        return currentMission
      }

      return findMission(state.recoverableMissionId, state.missions)
    },
    pauseMission: async (missionId: string): Promise<Mission> => {
      const mission = requireMission(missionId, state.missions)
      const pausedMission = {
        ...mission,
        status: 'paused' as const,
        pause_time: now().toISOString(),
      }
      state = replaceMission(state, pausedMission, missionId, null)
      save()
      return pausedMission
    },
    resumeMission: async (missionId: string): Promise<Mission> => {
      const mission = requireMission(missionId, state.missions)
      const resumedMission = {
        ...mission,
        status: 'active' as const,
        pause_time: null,
        paused_seconds: mission.paused_seconds + calculatePausedSeconds(mission.pause_time, now),
      }
      state = replaceMission(state, resumedMission, missionId, null)
      save()
      return resumedMission
    },
    finishMission: async (missionId: string): Promise<Mission> => {
      const mission = requireMission(missionId, state.missions)
      const finishedMission = {
        ...mission,
        status: 'finished' as const,
        pause_time: null,
        finish_time: now().toISOString(),
        paused_seconds:
          mission.paused_seconds +
          (mission.status === 'paused' ? calculatePausedSeconds(mission.pause_time, now) : 0),
      }
      state = replaceMission(state, finishedMission, null, null)
      save()
      return finishedMission
    },
  }
}

function readHarnessState(): MissionHarnessState {
  if (typeof window === 'undefined') {
    return { missions: [], currentMissionId: null, recoverableMissionId: null }
  }

  const stored = window.sessionStorage.getItem(MISSION_HARNESS_STORAGE_KEY)
  if (stored === null) {
    return { missions: [], currentMissionId: null, recoverableMissionId: null }
  }

  try {
    const parsed = JSON.parse(stored) as Partial<MissionHarnessState>
    return {
      missions: Array.isArray(parsed.missions) ? parsed.missions : [],
      currentMissionId:
        typeof parsed.currentMissionId === 'string' ? parsed.currentMissionId : null,
      recoverableMissionId:
        typeof parsed.recoverableMissionId === 'string' ? parsed.recoverableMissionId : null,
    }
  } catch {
    return { missions: [], currentMissionId: null, recoverableMissionId: null }
  }
}

function replaceMission(
  state: MissionHarnessState,
  nextMission: Mission,
  currentMissionId: string | null,
  recoverableMissionId: string | null,
): MissionHarnessState {
  return {
    missions: state.missions.map((mission) => (mission.id === nextMission.id ? nextMission : mission)),
    currentMissionId,
    recoverableMissionId,
  }
}

function findMission(
  missionId: string | null,
  missions: readonly Mission[],
): Mission | null {
  if (missionId === null) {
    return null
  }

  return missions.find((mission) => mission.id === missionId) ?? null
}

function requireMission(missionId: string, missions: readonly Mission[]): Mission {
  const mission = findMission(missionId, missions)
  if (mission === null) {
    throw new Error(`Mission not found: ${missionId}`)
  }

  return mission
}

function createMissionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `browser-${crypto.randomUUID()}`
  }

  return `browser-${Date.now()}`
}

function calculatePausedSeconds(pauseTime: string | null, now: () => Date): number {
  if (pauseTime === null) {
    return 0
  }

  return Math.max(0, Math.floor((now().getTime() - Date.parse(pauseTime)) / 1000))
}
