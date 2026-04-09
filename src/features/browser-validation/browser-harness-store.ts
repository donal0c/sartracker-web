import type {
  CreateMissionInput,
  Drawing,
  Marker,
  Mission,
  UpsertDrawingInput,
  UpsertMarkerInput,
} from '../../infrastructure/mission-store/tauri-mission-store'

type BrowserHarnessState = {
  readonly missions: readonly Mission[]
  readonly markers: readonly Marker[]
  readonly drawings: readonly Drawing[]
  readonly currentMissionId: string | null
  readonly recoverableMissionId: string | null
}

const BROWSER_HARNESS_STORAGE_KEY = 'sartracker:browser-harness'

type BrowserHarnessStore = {
  readonly createMission: (input: CreateMissionInput) => Promise<Mission>
  readonly listMissions: () => Promise<readonly Mission[]>
  readonly getRecoverableMission: () => Promise<Mission | null>
  readonly pauseMission: (missionId: string) => Promise<Mission>
  readonly resumeMission: (missionId: string) => Promise<Mission>
  readonly finishMission: (missionId: string) => Promise<Mission>
  readonly listMarkers: (missionId: string) => Promise<readonly Marker[]>
  readonly upsertMarker: (input: UpsertMarkerInput) => Promise<Marker>
  readonly deleteMarker: (markerId: string) => Promise<boolean>
  readonly listDrawings: (missionId: string) => Promise<readonly Drawing[]>
  readonly upsertDrawing: (input: UpsertDrawingInput) => Promise<Drawing>
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
    createMission: async (input) => {
      const mission = {
        id: createId('mission'),
        name: input.name,
        status: 'active',
        start_time: input.start_time ?? new Date().toISOString(),
        pause_time: null,
        finish_time: null,
        paused_seconds: 0,
        notes: input.notes ?? null,
        schema_version: 1,
      } satisfies Mission

      state = {
        ...state,
        missions: [...state.missions, mission],
        currentMissionId: mission.id,
        recoverableMissionId: null,
      }
      save()

      return mission
    },
    listMissions: async () => state.missions,
    getRecoverableMission: async () => {
      const currentMission = findMission(state.currentMissionId, state.missions)
      if (currentMission?.status === 'active') {
        const pausedMission = {
          ...currentMission,
          status: 'paused' as const,
          pause_time: new Date().toISOString(),
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
    pauseMission: async (missionId) => {
      const mission = requireMission(missionId, state.missions)
      const pausedMission = {
        ...mission,
        status: 'paused' as const,
        pause_time: new Date().toISOString(),
      }
      state = replaceMission(state, pausedMission, missionId, null)
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
      save()
      return finishedMission
    },
    listMarkers: async (missionId) =>
      state.markers
        .filter((marker) => marker.mission_id === missionId)
        .sort((left, right) => left.display_order - right.display_order),
    upsertMarker: async (input) => {
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
      } satisfies Marker

      state = {
        ...state,
        markers: upsertMarker(state.markers, marker),
      }
      save()
      return marker
    },
    deleteMarker: async (markerId) => {
      const didDelete = state.markers.some((marker) => marker.id === markerId)
      if (!didDelete) {
        return false
      }

      state = {
        ...state,
        markers: state.markers.filter((marker) => marker.id !== markerId),
      }
      save()
      return true
    },
    listDrawings: async (missionId) =>
      state.drawings
        .filter((drawing) => drawing.mission_id === missionId)
        .sort((left, right) => left.display_order - right.display_order),
    upsertDrawing: async (input) => {
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
      }
      save()
      return drawing
    },
  }

  return browserHarnessStore
}

function readHarnessState(): BrowserHarnessState {
  if (typeof window === 'undefined') {
    return {
      missions: [],
      markers: [],
      drawings: [],
      currentMissionId: null,
      recoverableMissionId: null,
    }
  }

  const stored = window.sessionStorage.getItem(BROWSER_HARNESS_STORAGE_KEY)
  if (stored === null) {
    return {
      missions: [],
      markers: [],
      drawings: [],
      currentMissionId: null,
      recoverableMissionId: null,
    }
  }

  try {
    const parsed = JSON.parse(stored) as Partial<BrowserHarnessState>
    return {
      missions: Array.isArray(parsed.missions) ? parsed.missions : [],
      markers: Array.isArray(parsed.markers) ? parsed.markers : [],
      drawings: Array.isArray(parsed.drawings) ? parsed.drawings : [],
      currentMissionId:
        typeof parsed.currentMissionId === 'string' ? parsed.currentMissionId : null,
      recoverableMissionId:
        typeof parsed.recoverableMissionId === 'string' ? parsed.recoverableMissionId : null,
    }
  } catch {
    return {
      missions: [],
      markers: [],
      drawings: [],
      currentMissionId: null,
      recoverableMissionId: null,
    }
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

function upsertDrawing(drawings: readonly Drawing[], drawing: Drawing): readonly Drawing[] {
  const existingIndex = drawings.findIndex((candidate) => candidate.id === drawing.id)
  if (existingIndex === -1) {
    return [...drawings, drawing]
  }

  return drawings.map((candidate) => (candidate.id === drawing.id ? drawing : candidate))
}
