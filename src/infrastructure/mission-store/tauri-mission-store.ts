import { invoke } from '@tauri-apps/api/core'

export type MissionStatus = 'active' | 'paused' | 'finished' | 'finalized'

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

export type MarkerType = 'ipp_lkp' | 'clue' | 'hazard' | 'casualty'

export type Marker = {
  readonly id: string
  readonly mission_id: string
  readonly type: MarkerType
  readonly name: string
  readonly description: string | null
  readonly lat: number
  readonly lon: number
  readonly irish_grid_e: number
  readonly irish_grid_n: number
  readonly created_at: string
  readonly updated_at: string
  readonly display_order: number
  readonly subject_category: string | null
  readonly clue_type: string | null
  readonly confidence: number | null
  readonly found_by: string | null
  readonly hazard_type: string | null
  readonly severity: string | null
  readonly condition: string | null
  readonly treatment: string | null
  readonly evacuation_priority: string | null
}

export type DrawingType =
  | 'line'
  | 'search_area'
  | 'range_ring'
  | 'bearing_line'
  | 'search_sector'
  | 'text_label'

export type Drawing = {
  readonly id: string
  readonly mission_id: string
  readonly type: DrawingType
  readonly name: string
  readonly description: string | null
  readonly color: string | null
  readonly width: number | null
  readonly distance_m: number | null
  readonly temporary_measure: boolean | null
  readonly label: string | null
  readonly display_order: number
  readonly geometry_json: string
  readonly metadata_json: string | null
  readonly created_at: string
  readonly updated_at: string
}

export type MissionStoreInfo = {
  readonly schema_version: number
  readonly database_path: string
  readonly backup_path: string
}

export type MissionArchiveInfo = {
  readonly mission_id: string
  readonly archive_path: string
  readonly created_at: string
}

export type MissionEvent = {
  readonly id: string
  readonly mission_id: string
  readonly event_type: string
  readonly timestamp: string
  readonly details_json: string | null
}

export type CreateMissionInput = {
  readonly name: string
  readonly start_time?: string
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

export type UpsertMarkerInput = {
  readonly id?: string | null
  readonly mission_id: string
  readonly type: MarkerType
  readonly name: string
  readonly description?: string | null
  readonly lat: number
  readonly lon: number
  readonly irish_grid_e: number
  readonly irish_grid_n: number
  readonly display_order: number
  readonly subject_category?: string | null
  readonly clue_type?: string | null
  readonly confidence?: number | null
  readonly found_by?: string | null
  readonly hazard_type?: string | null
  readonly severity?: string | null
  readonly condition?: string | null
  readonly treatment?: string | null
  readonly evacuation_priority?: string | null
}

export type UpsertDrawingInput = {
  readonly id?: string | null
  readonly mission_id: string
  readonly type: DrawingType
  readonly name: string
  readonly description?: string | null
  readonly color?: string | null
  readonly width?: number | null
  readonly distance_m?: number | null
  readonly temporary_measure?: boolean | null
  readonly label?: string | null
  readonly display_order: number
  readonly geometry_json: string
  readonly metadata_json?: string | null
}

export type MissionStore = {
  readonly info: () => Promise<MissionStoreInfo>
  readonly syncBackup: () => Promise<string>
  readonly createMissionArchive: (missionId: string) => Promise<MissionArchiveInfo>
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
  readonly listMissionEvents: (missionId: string) => Promise<readonly MissionEvent[]>
  readonly upsertMarker: (input: UpsertMarkerInput) => Promise<Marker>
  readonly getMarker: (markerId: string) => Promise<Marker>
  readonly listMarkers: (missionId: string) => Promise<readonly Marker[]>
  readonly deleteMarker: (markerId: string) => Promise<boolean>
  readonly upsertDrawing: (input: UpsertDrawingInput) => Promise<Drawing>
  readonly getDrawing: (drawingId: string) => Promise<Drawing>
  readonly listDrawings: (missionId: string) => Promise<readonly Drawing[]>
  readonly deleteDrawing: (drawingId: string) => Promise<boolean>
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
    createMissionArchive: (missionId) =>
      invoke<MissionArchiveInfo>('create_mission_archive', { missionId }),
    createMission: (input) => invoke<Mission>('create_mission', { input }),
    upsertDevice: (input) => invoke<Device>('upsert_device', { input }),
    getDevice: (missionId, deviceId) => invoke<Device>('get_device', { missionId, deviceId }),
    listDevices: (missionId) => invoke<readonly Device[]>('list_devices', { missionId }),
    addPosition: (input) => invoke<Position>('add_position', { input }),
    listPositions: (missionId, deviceId) =>
      invoke<readonly Position[]>('list_positions', { missionId, deviceId }),
    latestPositions: (missionId) =>
      invoke<readonly Position[]>('latest_positions', { missionId }),
    listMissionEvents: (missionId) =>
      invoke<readonly MissionEvent[]>('list_mission_events', { missionId }),
    upsertMarker: (input) => invoke<Marker>('upsert_marker', { input }),
    getMarker: (markerId) => invoke<Marker>('get_marker', { markerId }),
    listMarkers: (missionId) => invoke<readonly Marker[]>('list_markers', { missionId }),
    deleteMarker: (markerId) => invoke<boolean>('delete_marker', { markerId }),
    upsertDrawing: (input) => invoke<Drawing>('upsert_drawing', { input }),
    getDrawing: (drawingId) => invoke<Drawing>('get_drawing', { drawingId }),
    listDrawings: (missionId) => invoke<readonly Drawing[]>('list_drawings', { missionId }),
    deleteDrawing: (drawingId) => invoke<boolean>('delete_drawing', { drawingId }),
    getMission: (missionId) => invoke<Mission>('get_mission', { missionId }),
    listMissions: () => invoke<readonly Mission[]>('list_missions'),
    getActiveMission: () => invoke<Mission | null>('get_active_mission'),
    getRecoverableMission: () => invoke<Mission | null>('get_recoverable_mission'),
    pauseMission: (missionId) => invoke<Mission>('pause_mission', { missionId }),
    resumeMission: (missionId) => invoke<Mission>('resume_mission', { missionId }),
    finishMission: (missionId) => invoke<Mission>('finish_mission', { missionId }),
  }
}
