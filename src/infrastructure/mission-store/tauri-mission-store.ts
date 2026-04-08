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

export type DeviceStatus = 'online' | 'offline' | 'unknown'

export type Device = {
  readonly id: string
  readonly mission_id: string
  readonly device_id: string
  readonly name: string
  readonly color: string
  readonly last_seen: string | null
  readonly status: DeviceStatus
}

export type Position = {
  readonly id: string
  readonly mission_id: string
  readonly device_id: string
  readonly name: string | null
  readonly lat: number
  readonly lon: number
  readonly altitude: number | null
  readonly speed: number | null
  readonly battery: number | null
  readonly accuracy: number | null
  readonly source: string | null
  readonly timestamp: string
  readonly data_origin: 'live' | 'cache'
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

export type UpsertDeviceInput = {
  readonly mission_id: string
  readonly device_id: string
  readonly name: string
  readonly color: string
  readonly status: DeviceStatus
  readonly last_seen?: string | null
}

export type AddPositionInput = {
  readonly mission_id: string
  readonly device_id: string
  readonly name?: string | null
  readonly lat: number
  readonly lon: number
  readonly altitude?: number | null
  readonly speed?: number | null
  readonly battery?: number | null
  readonly accuracy?: number | null
  readonly source?: string | null
  readonly timestamp?: string | null
  readonly data_origin?: 'live' | 'cache' | null
}

export type MissionStore = {
  readonly info: () => Promise<MissionStoreInfo>
  readonly syncBackup: () => Promise<string>
  readonly createMission: (input: CreateMissionInput) => Promise<Mission>
  readonly upsertDevice: (input: UpsertDeviceInput) => Promise<Device>
  readonly getDevice: (missionId: string, deviceId: string) => Promise<Device>
  readonly listDevices: (missionId: string) => Promise<readonly Device[]>
  readonly addPosition: (input: AddPositionInput) => Promise<Position>
  readonly listPositions: (
    missionId: string,
    deviceId?: string,
  ) => Promise<readonly Position[]>
  readonly latestPositions: (missionId: string) => Promise<readonly Position[]>
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
    upsertDevice: (input) => invoke<Device>('upsert_device', { input }),
    getDevice: (missionId, deviceId) => invoke<Device>('get_device', { missionId, deviceId }),
    listDevices: (missionId) => invoke<readonly Device[]>('list_devices', { missionId }),
    addPosition: (input) => invoke<Position>('add_position', { input }),
    listPositions: (missionId, deviceId) =>
      invoke<readonly Position[]>('list_positions', { missionId, deviceId }),
    latestPositions: (missionId) =>
      invoke<readonly Position[]>('latest_positions', { missionId }),
    getMission: (missionId) => invoke<Mission>('get_mission', { missionId }),
    listMissions: () => invoke<readonly Mission[]>('list_missions'),
    getActiveMission: () => invoke<Mission | null>('get_active_mission'),
    getRecoverableMission: () => invoke<Mission | null>('get_recoverable_mission'),
    pauseMission: (missionId) => invoke<Mission>('pause_mission', { missionId }),
    resumeMission: (missionId) => invoke<Mission>('resume_mission', { missionId }),
    finishMission: (missionId) => invoke<Mission>('finish_mission', { missionId }),
  }
}
