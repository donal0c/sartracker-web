import type {
  AddPositionInput,
  CreateMissionInput,
  Device,
  Drawing,
  FinalizeMissionResult,
  Marker,
  Mission,
  MissionEvent,
  MissionArchiveInfo,
  MissionStoreInfo,
  Position,
  UnlockFinalizedMissionInput,
  UpsertDeviceInput,
  UpsertDrawingInput,
  UpsertMarkerInput,
} from '../../infrastructure/mission-store/tauri-mission-store'

type BrowserHarnessState = {
  readonly missions: readonly Mission[]
  readonly devices: readonly Device[]
  readonly positions: readonly Position[]
  readonly markers: readonly Marker[]
  readonly drawings: readonly Drawing[]
  readonly missionEvents: readonly MissionEvent[]
  readonly openedPaths: readonly string[]
  readonly currentMissionId: string | null
  readonly recoverableMissionId: string | null
}

const BROWSER_HARNESS_STORAGE_KEY = 'sartracker:browser-harness'

type BrowserHarnessStore = {
  readonly createMission: (input: CreateMissionInput) => Promise<Mission>
  readonly listMissions: () => Promise<readonly Mission[]>
  readonly getActiveMission: () => Promise<Mission | null>
  readonly getRecoverableMission: () => Promise<Mission | null>
  readonly info: () => Promise<MissionStoreInfo>
  readonly listMissionEvents: (missionId: string) => Promise<readonly MissionEvent[]>
  readonly openExternalPath: (path: string) => Promise<void>
  readonly pauseMission: (missionId: string) => Promise<Mission>
  readonly resumeMission: (missionId: string) => Promise<Mission>
  readonly finishMission: (missionId: string) => Promise<Mission>
  readonly finalizeMission: (missionId: string) => Promise<FinalizeMissionResult>
  readonly unlockFinalizedMission: (input: UnlockFinalizedMissionInput) => Promise<Mission>
  readonly listDevices: (missionId: string) => Promise<readonly Device[]>
  readonly upsertDevice: (input: UpsertDeviceInput) => Promise<Device>
  readonly addPosition: (input: AddPositionInput) => Promise<Position>
  readonly listPositions: (
    missionId: string,
    deviceId?: string,
  ) => Promise<readonly Position[]>
  readonly listMarkers: (missionId: string) => Promise<readonly Marker[]>
  readonly upsertMarker: (input: UpsertMarkerInput) => Promise<Marker>
  readonly deleteMarker: (markerId: string) => Promise<boolean>
  readonly listDrawings: (missionId: string) => Promise<readonly Drawing[]>
  readonly upsertDrawing: (input: UpsertDrawingInput) => Promise<Drawing>
  readonly deleteDrawing: (drawingId: string) => Promise<boolean>
}

let browserHarnessStore: BrowserHarnessStore | null = null

export function getBrowserHarnessStore(): BrowserHarnessStore {
  if (browserHarnessStore !== null) {
    return browserHarnessStore
  }

  let state = readHarnessState()

  const save = () => {
    window.sessionStorage.setItem(BROWSER_HARNESS_STORAGE_KEY, JSON.stringify(state))
  }

  browserHarnessStore = {
    info: async () => ({
      schema_version: 1,
      database_path: '/tmp/browser-harness/mission-store.sqlite',
      backup_path: '/tmp/browser-harness/mission-store.backup.sqlite',
    }),
    createMission: async (input) => {
      const missionId = createId('mission')
      const startTime = input.start_time ?? new Date().toISOString()
      const mission = {
        id: missionId,
        name: input.name,
        status: 'active',
        start_time: startTime,
        pause_time: null,
        finish_time: null,
        paused_seconds: 0,
        notes: input.notes ?? null,
        schema_version: 1,
      } satisfies Mission

      state = {
        ...state,
        missions: [...state.missions, mission],
        missionEvents: appendEvent(state.missionEvents, missionId, 'mission_created', startTime, {
          name: input.name,
          notes: input.notes ?? null,
          start_time: startTime,
        }),
        currentMissionId: mission.id,
        recoverableMissionId: null,
      }
      save()

      return mission
    },
    listMissions: async () => state.missions,
    listMissionEvents: async (missionId) =>
      state.missionEvents
        .filter((event) => event.mission_id === missionId)
        .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)),
    openExternalPath: async (path) => {
      if (path.trim() === '') {
        throw new Error('Path is required.')
      }

      state = {
        ...state,
        openedPaths: [...state.openedPaths, path],
      }
      save()
    },
    getActiveMission: async () => {
      const mission = findMission(state.currentMissionId, state.missions)
      return mission?.status === 'active' ? mission : null
    },
    getRecoverableMission: async () => {
      const currentMission = findMission(state.currentMissionId, state.missions)
      if (currentMission?.status === 'active') {
        const pausedMission = {
          ...currentMission,
          status: 'paused' as const,
          pause_time: new Date().toISOString(),
        }
        state = replaceMission(
          {
            ...state,
            missionEvents: appendEvent(
              state.missionEvents,
              pausedMission.id,
              'mission_paused',
              pausedMission.pause_time ?? new Date().toISOString(),
              { status: 'paused' },
            ),
          },
          pausedMission,
          null,
          pausedMission.id,
        )
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
    pauseMission: async (missionId) => {
      const mission = requireMission(missionId, state.missions)
      const pausedMission = {
        ...mission,
        status: 'paused' as const,
        pause_time: new Date().toISOString(),
      }
      state = replaceMission(state, pausedMission, missionId, null)
      state = {
        ...state,
        missionEvents: appendEvent(
          state.missionEvents,
          missionId,
          'mission_paused',
          pausedMission.pause_time ?? new Date().toISOString(),
          { status: 'paused' },
        ),
      }
      save()
      return pausedMission
    },
    resumeMission: async (missionId) => {
      const mission = requireMission(missionId, state.missions)
      const resumedMission = {
        ...mission,
        status: 'active' as const,
        pause_time: null,
        paused_seconds: mission.paused_seconds + calculatePausedSeconds(mission.pause_time),
      }
      state = replaceMission(state, resumedMission, missionId, null)
      state = {
        ...state,
        missionEvents: appendEvent(
          state.missionEvents,
          missionId,
          'mission_resumed',
          new Date().toISOString(),
          { status: 'active' },
        ),
      }
      save()
      return resumedMission
    },
    finishMission: async (missionId) => {
      const mission = requireMission(missionId, state.missions)
      const finishedMission = {
        ...mission,
        status: 'finished' as const,
        pause_time: null,
        finish_time: new Date().toISOString(),
        paused_seconds:
          mission.paused_seconds +
          (mission.status === 'paused' ? calculatePausedSeconds(mission.pause_time) : 0),
      }
      state = replaceMission(state, finishedMission, null, null)
      state = {
        ...state,
        missionEvents: appendEvent(
          state.missionEvents,
          missionId,
          'mission_finished',
          finishedMission.finish_time ?? new Date().toISOString(),
          { status: 'finished' },
        ),
      }
      save()
      return finishedMission
    },
    finalizeMission: async (missionId) => {
      const mission = requireMission(missionId, state.missions)
      if (mission.status !== 'finished') {
        throw new Error('Only finished missions can be finalized.')
      }

      const finalizedMission = {
        ...mission,
        status: 'finalized' as const,
      }
      const archive = {
        mission_id: missionId,
        archive_path: `/tmp/${missionId}-archive.zip`,
        created_at: new Date().toISOString(),
      } satisfies MissionArchiveInfo

      state = replaceMission(
        {
          ...state,
          missionEvents: [
            ...appendEvent(state.missionEvents, missionId, 'mission_finalize_requested', new Date().toISOString(), {
              resulting_status: 'finished',
            }),
          ],
        },
        finalizedMission,
        null,
        null,
      )
      state = {
        ...state,
        missionEvents: appendEvent(
          appendEvent(state.missionEvents, missionId, 'mission_archive_succeeded', archive.created_at, {
            resulting_status: 'finished',
            archive_path: archive.archive_path,
          }),
          missionId,
          'mission_finalized',
          archive.created_at,
          {
            resulting_status: 'finalized',
            archive_path: archive.archive_path,
          },
        ),
      }
      save()
      return { mission: finalizedMission, archive }
    },
    unlockFinalizedMission: async (input) => {
      const mission = requireMission(input.mission_id, state.missions)
      if (mission.status !== 'finalized') {
        throw new Error('Only finalized missions can be unlocked.')
      }

      const settings = readBrowserSettings()
      if (!settings.missionDefaults.adminRoster.includes(input.admin_name)) {
        state = {
          ...state,
          missionEvents: appendEvent(
            appendEvent(state.missionEvents, input.mission_id, 'mission_unlock_requested', new Date().toISOString(), {
              admin_name: input.admin_name,
              reason: input.reason,
              resulting_status: 'finalized',
            }),
            input.mission_id,
            'mission_unlock_denied',
            new Date().toISOString(),
            {
              admin_name: input.admin_name,
              reason: input.reason,
              resulting_status: 'finalized',
            },
          ),
        }
        save()
        throw new Error('Selected admin is not authorized to unlock finalized missions.')
      }
      if (input.reason.trim() === '') {
        throw new Error('Unlock reason is required.')
      }

      const unlockedMission = {
        ...mission,
        status: 'finished' as const,
      }
      state = replaceMission(
        {
          ...state,
          missionEvents: appendEvent(
            appendEvent(state.missionEvents, input.mission_id, 'mission_unlock_requested', new Date().toISOString(), {
              admin_name: input.admin_name,
              reason: input.reason,
              resulting_status: 'finalized',
            }),
            input.mission_id,
            'mission_unlocked',
            new Date().toISOString(),
            {
              admin_name: input.admin_name,
              reason: input.reason,
              resulting_status: 'finished',
            },
          ),
        },
        unlockedMission,
        null,
        null,
      )
      save()
      return unlockedMission
    },
    listDevices: async (missionId) =>
      state.devices.filter((device) => device.mission_id === missionId),
    upsertDevice: async (input) => {
      ensureMissionMutable(input.mission_id, state.missions)
      const existingDevice =
        state.devices.find(
          (device) =>
            device.mission_id === input.mission_id && device.device_id === input.device_id,
        ) ?? null

      const device = {
        id: existingDevice?.id ?? createId('device'),
        mission_id: input.mission_id,
        device_id: input.device_id,
        name: input.name,
        color: input.color,
        status: input.status,
        last_seen: input.last_seen ?? null,
      } satisfies Device

      state = {
        ...state,
        devices: upsertDevice(state.devices, device),
        missionEvents: appendEvent(
          state.missionEvents,
          input.mission_id,
          existingDevice === null ? 'device_created' : 'device_updated',
          new Date().toISOString(),
          {
            device_id: input.device_id,
            name: input.name,
          },
        ),
      }
      save()
      return device
    },
    addPosition: async (input) => {
      ensureMissionMutable(input.mission_id, state.missions)
      const position = {
        id: createId('position'),
        mission_id: input.mission_id,
        device_id: input.device_id,
        name: input.name ?? null,
        lat: input.lat,
        lon: input.lon,
        altitude: input.altitude ?? null,
        speed: input.speed ?? null,
        battery: input.battery ?? null,
        accuracy: input.accuracy ?? null,
        source: input.source ?? null,
        timestamp: input.timestamp ?? new Date().toISOString(),
        data_origin: input.data_origin ?? 'live',
      } satisfies Position

      state = {
        ...state,
        positions: [...state.positions, position],
        missionEvents: appendEvent(
          state.missionEvents,
          input.mission_id,
          'position_recorded',
          position.timestamp,
          {
            position_id: position.id,
            device_id: input.device_id,
            timestamp: position.timestamp,
            data_origin: position.data_origin,
            source: position.source,
          },
        ),
      }
      save()
      return position
    },
    listPositions: async (missionId, deviceId) =>
      state.positions
        .filter((position) => {
          if (position.mission_id !== missionId) {
            return false
          }

          if (deviceId === undefined) {
            return true
          }

          return position.device_id === deviceId
        })
        .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)),
    listMarkers: async (missionId) =>
      state.markers
        .filter((marker) => marker.mission_id === missionId)
        .sort((left, right) => left.display_order - right.display_order),
    upsertMarker: async (input) => {
      ensureMissionMutable(input.mission_id, state.missions)
      const existingMarker = input.id === undefined || input.id === null
        ? null
        : state.markers.find((marker) => marker.id === input.id) ?? null
      const now = new Date().toISOString()
      const marker = {
        id: existingMarker?.id ?? input.id ?? createId('marker'),
        mission_id: input.mission_id,
        type: input.type,
        name: input.name,
        description: input.description ?? null,
        lat: input.lat,
        lon: input.lon,
        irish_grid_e: input.irish_grid_e,
        irish_grid_n: input.irish_grid_n,
        created_at: existingMarker?.created_at ?? now,
        updated_at: now,
        display_order: input.display_order,
        subject_category: input.subject_category ?? null,
        clue_type: input.clue_type ?? null,
        confidence: input.confidence ?? null,
        found_by: input.found_by ?? null,
        hazard_type: input.hazard_type ?? null,
        severity: input.severity ?? null,
        condition: input.condition ?? null,
        treatment: input.treatment ?? null,
        evacuation_priority: input.evacuation_priority ?? null,
        updated_by: input.updated_by ?? null,
        coordinator_ids: input.coordinator_ids ?? null,
        attachment_path: input.attachment_path ?? null,
      } satisfies Marker

      state = {
        ...state,
        markers: upsertMarker(state.markers, marker),
        missionEvents: appendEvent(
          state.missionEvents,
          input.mission_id,
          existingMarker === null ? 'marker_created' : 'marker_updated',
          now,
          {
            marker_id: marker.id,
            marker_type: marker.type,
            name: marker.name,
            display_order: marker.display_order,
            updated_by: marker.updated_by,
            coordinator_ids: marker.coordinator_ids,
            attachment_path: marker.attachment_path,
          },
        ),
      }
      save()
      return marker
    },
    deleteMarker: async (markerId) => {
      const didDelete = state.markers.some((marker) => marker.id === markerId)
      if (!didDelete) {
        return false
      }
      const marker = state.markers.find((candidate) => candidate.id === markerId)
      if (marker !== undefined) {
        ensureMissionMutable(marker.mission_id, state.missions)
      }

      state = {
        ...state,
        markers: state.markers.filter((marker) => marker.id !== markerId),
        missionEvents:
          marker === undefined
            ? state.missionEvents
            : appendEvent(state.missionEvents, marker.mission_id, 'marker_deleted', new Date().toISOString(), {
                marker_id: marker.id,
                marker_type: marker.type,
                name: marker.name,
              }),
      }
      save()
      return true
    },
    listDrawings: async (missionId) =>
      state.drawings
        .filter((drawing) => drawing.mission_id === missionId)
        .sort((left, right) => left.display_order - right.display_order),
    upsertDrawing: async (input) => {
      ensureMissionMutable(input.mission_id, state.missions)
      const existingDrawing =
        input.id === undefined || input.id === null
          ? null
          : state.drawings.find((drawing) => drawing.id === input.id) ?? null
      const now = new Date().toISOString()
      const drawing = {
        id: existingDrawing?.id ?? input.id ?? createId('drawing'),
        mission_id: input.mission_id,
        type: input.type,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        width: input.width ?? null,
        distance_m: input.distance_m ?? null,
        temporary_measure: input.temporary_measure ?? null,
        label: input.label ?? null,
        display_order: input.display_order,
        geometry_json: input.geometry_json,
        metadata_json: input.metadata_json ?? null,
        created_at: existingDrawing?.created_at ?? now,
        updated_at: now,
      } satisfies Drawing

      state = {
        ...state,
        drawings: upsertDrawing(state.drawings, drawing),
        missionEvents: appendEvent(
          state.missionEvents,
          input.mission_id,
          existingDrawing === null ? 'drawing_created' : 'drawing_updated',
          now,
          {
            drawing_id: drawing.id,
            drawing_type: drawing.type,
            name: drawing.name,
            display_order: drawing.display_order,
          },
        ),
      }
      save()
      return drawing
    },
    deleteDrawing: async (drawingId) => {
      const didDelete = state.drawings.some((drawing) => drawing.id === drawingId)
      if (!didDelete) {
        return false
      }
      const drawing = state.drawings.find((candidate) => candidate.id === drawingId)
      if (drawing !== undefined) {
        ensureMissionMutable(drawing.mission_id, state.missions)
      }

      state = {
        ...state,
        drawings: state.drawings.filter((drawing) => drawing.id !== drawingId),
        missionEvents:
          drawing === undefined
            ? state.missionEvents
            : appendEvent(state.missionEvents, drawing.mission_id, 'drawing_deleted', new Date().toISOString(), {
                drawing_id: drawing.id,
                drawing_type: drawing.type,
                name: drawing.name,
              }),
      }
      save()
      return true
    },
  }

  return browserHarnessStore
}

export function readBrowserHarnessState(): BrowserHarnessState {
  return readHarnessState()
}

export function resetBrowserHarnessStore(clearStorage = true): void {
  browserHarnessStore = null

  if (clearStorage && typeof window !== 'undefined') {
    window.sessionStorage.removeItem(BROWSER_HARNESS_STORAGE_KEY)
  }
}

function readHarnessState(): BrowserHarnessState {
  if (typeof window === 'undefined') {
    return {
      missions: [],
      devices: [],
      positions: [],
      markers: [],
      drawings: [],
      missionEvents: [],
      openedPaths: [],
      currentMissionId: null,
      recoverableMissionId: null,
    }
  }

  const stored = window.sessionStorage.getItem(BROWSER_HARNESS_STORAGE_KEY)
  if (stored === null) {
    return {
      missions: [],
      devices: [],
      positions: [],
      markers: [],
      drawings: [],
      missionEvents: [],
      openedPaths: [],
      currentMissionId: null,
      recoverableMissionId: null,
    }
  }

  try {
    const parsed = JSON.parse(stored) as Partial<BrowserHarnessState>
    return {
      missions: Array.isArray(parsed.missions) ? parsed.missions : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      markers: Array.isArray(parsed.markers) ? parsed.markers : [],
      drawings: Array.isArray(parsed.drawings) ? parsed.drawings : [],
      missionEvents: Array.isArray(parsed.missionEvents) ? parsed.missionEvents : [],
      openedPaths: Array.isArray(parsed.openedPaths) ? parsed.openedPaths : [],
      currentMissionId:
        typeof parsed.currentMissionId === 'string' ? parsed.currentMissionId : null,
      recoverableMissionId:
        typeof parsed.recoverableMissionId === 'string' ? parsed.recoverableMissionId : null,
    }
  } catch {
    return {
      missions: [],
      devices: [],
      positions: [],
      markers: [],
      drawings: [],
      missionEvents: [],
      openedPaths: [],
      currentMissionId: null,
      recoverableMissionId: null,
    }
  }
}

function readBrowserSettings(): {
  readonly missionDefaults: {
    readonly adminRoster: readonly string[]
  }
} {
  if (typeof window === 'undefined') {
    return { missionDefaults: { adminRoster: [] } }
  }

  try {
    const raw = window.localStorage.getItem('sartracker:browser-settings')
    if (raw === null) {
      return { missionDefaults: { adminRoster: [] } }
    }

    const parsed = JSON.parse(raw) as {
      missionDefaults?: {
        adminRoster?: readonly string[]
      }
    }

    return {
      missionDefaults: {
        adminRoster: Array.isArray(parsed.missionDefaults?.adminRoster)
          ? parsed.missionDefaults?.adminRoster ?? []
          : [],
      },
    }
  } catch {
    return { missionDefaults: { adminRoster: [] } }
  }
}

function replaceMission(
  state: BrowserHarnessState,
  nextMission: Mission,
  currentMissionId: string | null,
  recoverableMissionId: string | null,
): BrowserHarnessState {
  return {
    ...state,
    missions: state.missions.map((mission) => (mission.id === nextMission.id ? nextMission : mission)),
    currentMissionId,
    recoverableMissionId,
  }
}

function findMission(missionId: string | null, missions: readonly Mission[]): Mission | null {
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

function ensureMissionMutable(missionId: string, missions: readonly Mission[]): Mission {
  const mission = requireMission(missionId, missions)
  if (mission.status === 'finalized') {
    throw new Error('Finalized missions are read-only until an admin unlocks them.')
  }

  return mission
}

function calculatePausedSeconds(pauseTime: string | null): number {
  if (pauseTime === null) {
    return 0
  }

  return Math.max(0, Math.floor((Date.now() - Date.parse(pauseTime)) / 1000))
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}`
}

function upsertMarker(markers: readonly Marker[], marker: Marker): readonly Marker[] {
  const existingIndex = markers.findIndex((candidate) => candidate.id === marker.id)
  if (existingIndex === -1) {
    return [...markers, marker]
  }

  return markers.map((candidate) => (candidate.id === marker.id ? marker : candidate))
}

function upsertDevice(devices: readonly Device[], device: Device): readonly Device[] {
  const existingIndex = devices.findIndex(
    (candidate) =>
      candidate.mission_id === device.mission_id && candidate.device_id === device.device_id,
  )
  if (existingIndex === -1) {
    return [...devices, device]
  }

  return devices.map((candidate, index) => (index === existingIndex ? device : candidate))
}

function upsertDrawing(drawings: readonly Drawing[], drawing: Drawing): readonly Drawing[] {
  const existingIndex = drawings.findIndex((candidate) => candidate.id === drawing.id)
  if (existingIndex === -1) {
    return [...drawings, drawing]
  }

  return drawings.map((candidate) => (candidate.id === drawing.id ? drawing : candidate))
}

function appendEvent(
  events: readonly MissionEvent[],
  missionId: string,
  eventType: string,
  timestamp: string,
  details: Record<string, unknown>,
): readonly MissionEvent[] {
  return [
    ...events,
    {
      id: createId('event'),
      mission_id: missionId,
      event_type: eventType,
      timestamp,
      details_json: JSON.stringify(details),
    },
  ]
}
