import { invoke } from '@tauri-apps/api/core'

export type MissionStatus = 'idle' | 'active' | 'paused' | 'finished' | 'finalized'

export type Mission = {
  readonly id: string
  readonly name: string
  readonly status: MissionStatus
  readonly start_time: string
  readonly pause_time: string | null
  readonly finish_time: string | null
  readonly paused_seconds: number
  readonly notes: string | null
  readonly schema_version: number
}

export type MissionStoreInfo = {
  readonly schema_version: number
  readonly database_path: string
  readonly backup_path: string
}

export type CreateMissionInput = {
  readonly name: string
  readonly notes?: string | null
}

export type MissionStore = {
  readonly info: () => Promise<MissionStoreInfo>
  readonly syncBackup: () => Promise<string>
  readonly createMission: (input: CreateMissionInput) => Promise<Mission>
  readonly getMission: (missionId: string) => Promise<Mission>
  readonly listMissions: () => Promise<readonly Mission[]>
  readonly getActiveMission: () => Promise<Mission | null>
  readonly getRecoverableMission: () => Promise<Mission | null>
  readonly pauseMission: (missionId: string) => Promise<Mission>
  readonly resumeMission: (missionId: string) => Promise<Mission>
  readonly finishMission: (missionId: string) => Promise<Mission>
}

export function createTauriMissionStore(): MissionStore {
  return {
    info: () => invoke<MissionStoreInfo>('mission_store_info'),
    syncBackup: () => invoke<string>('sync_mission_store_backup'),
    createMission: (input) => invoke<Mission>('create_mission', { input }),
    getMission: (missionId) => invoke<Mission>('get_mission', { missionId }),
    listMissions: () => invoke<readonly Mission[]>('list_missions'),
    getActiveMission: () => invoke<Mission | null>('get_active_mission'),
    getRecoverableMission: () => invoke<Mission | null>('get_recoverable_mission'),
    pauseMission: (missionId) => invoke<Mission>('pause_mission', { missionId }),
    resumeMission: (missionId) => invoke<Mission>('resume_mission', { missionId }),
    finishMission: (missionId) => invoke<Mission>('finish_mission', { missionId }),
  }
}
