import type {
  AddPositionInput,
  CreateOutingInput,
  CreateMissionInput,
  Device,
  Drawing,
  FinalizeMissionResult,
  GpxTrackImport,
  Helicopter,
  Marker,
  ListAuditEventsOptions,
  Mission,
  MissionEvent,
  MissionArchiveInfo,
  MissionReviewReadQuery,
  MissionReviewReadResult,
  MissionStoreInfo,
  Position,
  Outing,
  OutingFixSummary,
  EditOutingBoundariesInput,
  EndOutingInput,
  RenameOutingInput,
  UnlockFinalizedMissionInput,
  UpsertDeviceInput,
  UpsertDrawingInput,
  UpsertGpxTrackImportInput,
  UpsertHelicopterInput,
  UpsertMarkerInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { outingWindowsOverlap } from '../outings/outing-schedule'
import {
  DEFAULT_AUDIT_EVENT_LIMIT,
  isTelemetryEventType,
} from '../mission-review/audit-events'

/**
 * Browser validation store for hosted/team-testing mode only.
 *
 * This sessionStorage-backed harness is not operational mission persistence,
 * not a backup system, and not a browser replacement for the Tauri/SQLite
 * mission store. It exists to exercise UI flows and hosted feedback sessions
 * without leaking Tauri APIs into the browser test lane.
 */
type BrowserHarnessState = {
  readonly missions: readonly Mission[]
  readonly devices: readonly Device[]
  readonly positions: readonly Position[]
  readonly outings: readonly Outing[]
  readonly markers: readonly Marker[]
  readonly drawings: readonly Drawing[]
  readonly helicopters: readonly Helicopter[]
  readonly gpxImports: readonly GpxTrackImport[]
  readonly missionEvents: readonly MissionEvent[]
  readonly openedPaths: readonly string[]
  readonly currentMissionId: string | null
  readonly recoverableMissionId: string | null
}

const BROWSER_HARNESS_STORAGE_KEY = 'sartracker:browser-harness'
const MAX_PERSISTED_TRACKING_POSITIONS = 2_000
const EMERGENCY_PERSISTED_TRACKING_POSITIONS = 500

type BrowserHarnessStore = {
  readonly createMission: (input: CreateMissionInput) => Promise<Mission>
  readonly createOuting: (input: CreateOutingInput) => Promise<Outing>
  readonly endOuting: (input: EndOutingInput) => Promise<Outing>
  readonly renameOuting: (input: RenameOutingInput) => Promise<Outing>
  readonly editOutingBoundaries: (input: EditOutingBoundariesInput) => Promise<Outing>
  readonly listOutings: (missionId: string) => Promise<readonly Outing[]>
  readonly readOutingFixSummary: (
    input: { readonly missionId: string },
  ) => Promise<OutingFixSummary>
  readonly cancelOutingFixSummary: (requestId: string) => Promise<boolean>
  readonly listMissions: () => Promise<readonly Mission[]>
  readonly getActiveMission: () => Promise<Mission | null>
  readonly getRecoverableMission: () => Promise<Mission | null>
  readonly info: () => Promise<MissionStoreInfo>
  readonly listMissionEvents: (missionId: string) => Promise<readonly MissionEvent[]>
  readonly listAuditEvents: (
    missionId: string,
    options?: ListAuditEventsOptions,
  ) => Promise<readonly MissionEvent[]>
  readonly readMissionReview: (
    query: MissionReviewReadQuery,
  ) => Promise<MissionReviewReadResult>
  readonly cancelMissionReviewRead: (requestId: string) => Promise<boolean>
  readonly openExternalPath: (path: string) => Promise<void>
  readonly pauseMission: (missionId: string) => Promise<Mission>
  readonly resumeMission: (missionId: string) => Promise<Mission>
  readonly finishMission: (missionId: string) => Promise<Mission>
  readonly finalizeMission: (missionId: string) => Promise<FinalizeMissionResult>
  readonly unlockFinalizedMission: (input: UnlockFinalizedMissionInput) => Promise<Mission>
  readonly listDevices: (missionId: string) => Promise<readonly Device[]>
  readonly upsertDevice: (input: UpsertDeviceInput) => Promise<Device>
  readonly addPosition: (input: AddPositionInput) => Promise<Position>
  readonly addPositionsBulk: (input: {
    readonly mission_id: string
    readonly positions: readonly Omit<AddPositionInput, 'mission_id'>[]
  }) => Promise<readonly Position[]>
  readonly listPositions: (
    missionId: string,
    deviceId?: string,
  ) => Promise<readonly Position[]>
  readonly listExactBreadcrumbDotPage: (input: {
    readonly missionId: string
    readonly activeDeviceIds: readonly string[]
    readonly limit: number
    readonly cursor?: string | null
    readonly direction: 'earlier' | 'later' | 'latest'
  }) => Promise<{
    readonly positions: readonly Position[]
    readonly totalPositionCount: number
    readonly pagePositionCount: number
    readonly fromTimestamp: string | null
    readonly toTimestamp: string | null
    readonly hasEarlier: false
    readonly hasLater: false
    readonly earlierCursor: null
    readonly laterCursor: null
  }>
  readonly countPositions: (missionId: string, deviceId?: string) => Promise<number>
  readonly listMarkers: (missionId: string) => Promise<readonly Marker[]>
  readonly upsertMarker: (input: UpsertMarkerInput) => Promise<Marker>
  readonly deleteMarker: (markerId: string) => Promise<boolean>
  readonly listDrawings: (missionId: string) => Promise<readonly Drawing[]>
  readonly upsertDrawing: (input: UpsertDrawingInput) => Promise<Drawing>
  readonly deleteDrawing: (drawingId: string) => Promise<boolean>
  readonly listHelicopters: (missionId: string) => Promise<readonly Helicopter[]>
  readonly upsertHelicopter: (input: UpsertHelicopterInput) => Promise<Helicopter>
  readonly deleteHelicopter: (helicopterId: string) => Promise<boolean>
  readonly listGpxImports: (missionId: string) => Promise<readonly GpxTrackImport[]>
  readonly upsertGpxImport: (input: UpsertGpxTrackImportInput) => Promise<GpxTrackImport>
  readonly deleteGpxImport: (importId: string) => Promise<boolean>
}

let browserHarnessStore: BrowserHarnessStore | null = null

export function getBrowserHarnessStore(): BrowserHarnessStore {
  if (browserHarnessStore !== null) {
    return browserHarnessStore
  }

  let state = readHarnessState()

  const save = () => {
    state = pruneTrackingPersistence(state, MAX_PERSISTED_TRACKING_POSITIONS)

    try {
      window.sessionStorage.setItem(BROWSER_HARNESS_STORAGE_KEY, JSON.stringify(state))
      return
    } catch (error) {
      if (!isStorageQuotaError(error)) {
        throw error
      }
    }

    state = pruneTrackingPersistence(state, EMERGENCY_PERSISTED_TRACKING_POSITIONS)
    try {
      window.sessionStorage.setItem(BROWSER_HARNESS_STORAGE_KEY, JSON.stringify(state))
    } catch (error) {
      if (!isStorageQuotaError(error)) {
        throw error
      }
      console.warn(
        'Browser harness tracking persistence exceeded session storage quota; live map state remains in memory.',
        error,
      )
    }
  }

  browserHarnessStore = {
    info: async () => ({
      schema_version: 9,
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
        schema_version: 9,
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
    createOuting: async (input) => {
      const mission = requireMission(input.mission_id, state.missions)
      if (mission.status !== 'active' && mission.status !== 'paused') {
        throw new Error('Cannot start an outing for a finished or finalized mission.')
      }
      const timestamp = new Date().toISOString()
      const outing: Outing = {
        id: createId('outing'),
        mission_id: mission.id,
        label: normalizeHarnessOutingLabel(input.label),
        started_at: normalizeHarnessOutingBoundary(input.started_at ?? timestamp),
        ended_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      }
      assertHarnessOutingWindow(mission, outing, state.outings)
      state = {
        ...state,
        outings: [...state.outings, outing],
        missionEvents: appendEvent(state.missionEvents, mission.id, 'outing_started', timestamp, {
          outing_id: outing.id,
          label: outing.label,
          started_at: outing.started_at,
        }),
      }
      save()
      return outing
    },
    endOuting: async (input) => {
      const mission = requireMission(input.mission_id, state.missions)
      if (mission.status === 'finalized') throw new Error('Finalized missions are read-only.')
      const existing = requireHarnessOuting(input.mission_id, input.outing_id, state.outings)
      if (existing.ended_at !== null) throw new Error(`Outing "${existing.label}" has already ended.`)
      const timestamp = new Date().toISOString()
      const endedAt = normalizeHarnessOutingBoundary(input.ended_at ?? timestamp)
      const outing = { ...existing, ended_at: endedAt, updated_at: timestamp }
      assertHarnessOutingWindow(mission, outing, state.outings)
      state = {
        ...state,
        outings: state.outings.map((candidate) => candidate.id === outing.id ? outing : candidate),
        missionEvents: appendEvent(state.missionEvents, mission.id, 'outing_ended', timestamp, {
          outing_id: outing.id,
          ended_at: outing.ended_at,
        }),
      }
      save()
      return outing
    },
    renameOuting: async (input) => {
      const mission = requireMission(input.mission_id, state.missions)
      if (mission.status === 'finalized') throw new Error('Finalized missions are read-only.')
      const existing = requireHarnessOuting(input.mission_id, input.outing_id, state.outings)
      const timestamp = new Date().toISOString()
      const outing = { ...existing, label: normalizeHarnessOutingLabel(input.label), updated_at: timestamp }
      state = {
        ...state,
        outings: state.outings.map((candidate) => candidate.id === outing.id ? outing : candidate),
        missionEvents: appendEvent(state.missionEvents, mission.id, 'outing_renamed', timestamp, {
          outing_id: outing.id,
          before: { label: existing.label },
          after: { label: outing.label },
        }),
      }
      save()
      return outing
    },
    editOutingBoundaries: async (input) => {
      const mission = requireMission(input.mission_id, state.missions)
      if (mission.status === 'finalized') throw new Error('Finalized missions are read-only.')
      const existing = requireHarnessOuting(input.mission_id, input.outing_id, state.outings)
      const timestamp = new Date().toISOString()
      const outing = {
        ...existing,
        started_at: input.started_at === undefined
          ? existing.started_at
          : normalizeHarnessOutingBoundary(input.started_at),
        ended_at: input.ended_at === undefined
          ? existing.ended_at
          : input.ended_at === null
            ? null
            : normalizeHarnessOutingBoundary(input.ended_at),
        updated_at: timestamp,
      }
      assertHarnessOutingWindow(mission, outing, state.outings)
      state = {
        ...state,
        outings: state.outings.map((candidate) => candidate.id === outing.id ? outing : candidate),
        missionEvents: appendEvent(state.missionEvents, mission.id, 'outing_boundaries_edited', timestamp, {
          outing_id: outing.id,
          before: { started_at: existing.started_at, ended_at: existing.ended_at },
          after: { started_at: outing.started_at, ended_at: outing.ended_at },
        }),
      }
      save()
      return outing
    },
    listOutings: async (missionId) => {
      requireMission(missionId, state.missions)
      return state.outings
        .filter((outing) => outing.mission_id === missionId)
        .toSorted((left, right) => left.started_at.localeCompare(right.started_at))
    },
    readOutingFixSummary: async ({ missionId }) => {
      requireMission(missionId, state.missions)
      const missionOutings = state.outings
        .filter((outing) => outing.mission_id === missionId)
        .toSorted((left, right) => left.started_at.localeCompare(right.started_at))
      const missionPositions = state.positions.filter(
        (position) => position.mission_id === missionId,
      )
      const outings = missionOutings.map((outing) => ({
        outing_id: outing.id,
        accepted_fix_count: missionPositions.filter((position) =>
          Date.parse(outing.started_at) <= Date.parse(position.timestamp) &&
          (outing.ended_at === null || Date.parse(position.timestamp) < Date.parse(outing.ended_at)),
        ).length,
      }))
      const assignedCount = outings.reduce(
        (total, outing) => total + outing.accepted_fix_count,
        0,
      )
      return {
        outings,
        unassigned_accepted_fix_count: missionPositions.length - assignedCount,
        total_accepted_fix_count: missionPositions.length,
      }
    },
    cancelOutingFixSummary: async () => false,
    listMissions: async () => state.missions,
    listMissionEvents: async (missionId) =>
      state.missionEvents
        .filter((event) => event.mission_id === missionId)
        .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)),
    listAuditEvents: async (missionId, options) => {
      const includeTelemetry = options?.includeTelemetry === true
      const limit = clampAuditLimit(options?.limit)
      return state.missionEvents
        .filter((event) => event.mission_id === missionId)
        .filter((event) => includeTelemetry || !isTelemetryEventType(event.event_type))
        .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
        .slice(0, limit)
    },
    readMissionReview: async (query) => ({
      auditEvents: state.missionEvents
        .filter((event) => event.mission_id === query.missionId)
        .filter(
          (event) => query.includeTelemetry || !isTelemetryEventType(event.event_type),
        )
        .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
        .slice(0, query.auditLimit),
      breadcrumbCount: state.positions.filter(
        (position) => position.mission_id === query.missionId,
      ).length,
    }),
    cancelMissionReviewRead: async () => false,
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

      const shouldRecordDeviceEvent =
        existingDevice === null ||
        existingDevice.name !== device.name ||
        existingDevice.color !== device.color ||
        existingDevice.status !== device.status

      state = {
        ...state,
        devices: upsertDevice(state.devices, device),
        missionEvents: shouldRecordDeviceEvent
          ? appendEvent(
              state.missionEvents,
              input.mission_id,
              existingDevice === null ? 'device_created' : 'device_updated',
              new Date().toISOString(),
              {
                device_id: input.device_id,
                name: input.name,
              },
            )
          : state.missionEvents,
      }
      save()
      return device
    },
    addPosition: async (input) => {
      ensureMissionMutable(input.mission_id, state.missions)
      const position = createBrowserHarnessPosition(input)

      state = {
        ...state,
        positions: [...state.positions, position],
      }
      save()
      return position
    },
    addPositionsBulk: async (input) => {
      ensureMissionMutable(input.mission_id, state.missions)
      // Preserve the browser harness's existing addPosition semantics. Source
      // identity deduplication is an Electron SQLite responsibility and must
      // not be inferred from browser-validation return values.
      const positions = input.positions.map((position) =>
        createBrowserHarnessPosition({
          mission_id: input.mission_id,
          ...position,
        }),
      )
      state = {
        ...state,
        positions: [...state.positions, ...positions],
      }
      save()
      return positions
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
    listExactBreadcrumbDotPage: async (input) => {
      if (input.direction !== 'latest' || input.cursor != null) {
        throw new Error('Browser validation exact-dot history has no earlier page.')
      }
      const mission = state.missions.find((candidate) => candidate.id === input.missionId)
      if (mission === undefined) {
        throw new Error('Browser validation exact-dot mission is unavailable.')
      }
      const activeDeviceIds = new Set(input.activeDeviceIds)
      const matchingByIdentity = new Map<string, Position>()
      for (const position of state.positions) {
        if (
          position.mission_id !== input.missionId ||
          position.timestamp < mission.start_time ||
          (activeDeviceIds.size > 0 && !activeDeviceIds.has(position.device_id))
        ) {
          continue
        }
        matchingByIdentity.set(
          `${position.device_id}:${position.source_position_id ?? position.id}`,
          position,
        )
      }
      const matching = [...matchingByIdentity.values()].sort(compareBrowserHarnessPositions)
      const positions = matching.slice(-input.limit)
      return {
        positions,
        totalPositionCount: matching.length,
        pagePositionCount: positions.length,
        fromTimestamp: positions[0]?.timestamp ?? null,
        toTimestamp: positions.at(-1)?.timestamp ?? null,
        hasEarlier: false,
        hasLater: false,
        earlierCursor: null,
        laterCursor: null,
      }
    },
    countPositions: async (missionId, deviceId) =>
      state.positions.filter((position) => {
        if (position.mission_id !== missionId) {
          return false
        }
        return deviceId === undefined || position.device_id === deviceId
      }).length,
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
        label_size: input.label_size ?? null,
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
    listHelicopters: async (missionId) =>
      state.helicopters
        .filter((helicopter) => helicopter.mission_id === missionId)
        .sort((left, right) => left.slot_key.localeCompare(right.slot_key)),
    upsertHelicopter: async (input) => {
      ensureMissionMutable(input.mission_id, state.missions)
      const existingHelicopter =
        state.helicopters.find(
          (entry) =>
            entry.mission_id === input.mission_id && entry.slot_key === input.slot_key,
        ) ?? null
      const now = new Date().toISOString()
      const helicopter = {
        id: existingHelicopter?.id ?? input.id ?? createId('helicopter'),
        mission_id: input.mission_id,
        slot_key: input.slot_key,
        call_sign: input.call_sign,
        hex_id: input.hex_id ?? null,
        lat: input.lat,
        lon: input.lon,
        altitude: input.altitude ?? null,
        speed: input.speed ?? null,
        heading: input.heading ?? null,
        last_update: input.last_update ?? now,
        created_at: existingHelicopter?.created_at ?? now,
        updated_at: now,
      } satisfies Helicopter

      state = {
        ...state,
        helicopters: upsertHelicopter(state.helicopters, helicopter),
        missionEvents: appendEvent(
          state.missionEvents,
          input.mission_id,
          existingHelicopter === null ? 'helicopter_created' : 'helicopter_updated',
          now,
          {
            helicopter_id: helicopter.id,
            slot_key: helicopter.slot_key,
            call_sign: helicopter.call_sign,
            hex_id: helicopter.hex_id,
          },
        ),
      }
      save()
      return helicopter
    },
    deleteHelicopter: async (helicopterId) => {
      const helicopter = state.helicopters.find((candidate) => candidate.id === helicopterId)
      if (helicopter === undefined) {
        return false
      }

      ensureMissionMutable(helicopter.mission_id, state.missions)
      state = {
        ...state,
        helicopters: state.helicopters.filter((entry) => entry.id !== helicopterId),
        missionEvents: appendEvent(
          state.missionEvents,
          helicopter.mission_id,
          'helicopter_deleted',
          new Date().toISOString(),
          {
            helicopter_id: helicopter.id,
            slot_key: helicopter.slot_key,
            call_sign: helicopter.call_sign,
          },
        ),
      }
      save()
      return true
    },
    listGpxImports: async (missionId) =>
      state.gpxImports
        .filter((entry) => entry.mission_id === missionId)
        .sort((left, right) => left.display_name.localeCompare(right.display_name)),
    upsertGpxImport: async (input) => {
      ensureMissionMutable(input.mission_id, state.missions)
      const existingImport =
        state.gpxImports.find(
          (entry) =>
            entry.mission_id === input.mission_id && entry.source_path === input.source_path,
        ) ?? null
      const now = new Date().toISOString()
      const gpxImport = {
        id: existingImport?.id ?? input.id ?? createId('gpx'),
        mission_id: input.mission_id,
        source_path: input.source_path,
        file_name: input.file_name,
        display_name: input.display_name,
        geometry_json: input.geometry_json,
        metadata_json: input.metadata_json ?? null,
        imported_at: existingImport?.imported_at ?? now,
        updated_at: now,
      } satisfies GpxTrackImport

      state = {
        ...state,
        gpxImports: upsertGpxImport(state.gpxImports, gpxImport),
        missionEvents: appendEvent(
          state.missionEvents,
          input.mission_id,
          existingImport === null ? 'gpx_import_created' : 'gpx_import_updated',
          now,
          {
            gpx_import_id: gpxImport.id,
            source_path: gpxImport.source_path,
            file_name: gpxImport.file_name,
            display_name: gpxImport.display_name,
          },
        ),
      }
      save()
      return gpxImport
    },
    deleteGpxImport: async (importId) => {
      const gpxImport = state.gpxImports.find((candidate) => candidate.id === importId)
      if (gpxImport === undefined) {
        return false
      }

      ensureMissionMutable(gpxImport.mission_id, state.missions)
      state = {
        ...state,
        gpxImports: state.gpxImports.filter((entry) => entry.id !== importId),
        missionEvents: appendEvent(
          state.missionEvents,
          gpxImport.mission_id,
          'gpx_import_deleted',
          new Date().toISOString(),
          {
            gpx_import_id: gpxImport.id,
            source_path: gpxImport.source_path,
            file_name: gpxImport.file_name,
            display_name: gpxImport.display_name,
          },
        ),
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

/** Builds one validated browser-harness position without persisting intermediate state. */
function createBrowserHarnessPosition(input: AddPositionInput): Position {
  return {
    id: createId('position'),
    mission_id: input.mission_id,
    device_id: input.device_id,
    source_position_id: input.source_position_id ?? null,
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
  }
}

function compareBrowserHarnessPositions(left: Position, right: Position): number {
  return (
    left.timestamp.localeCompare(right.timestamp) ||
    left.device_id.localeCompare(right.device_id) ||
    (left.source_position_id ?? left.id).localeCompare(
      right.source_position_id ?? right.id,
    ) ||
    left.id.localeCompare(right.id)
  )
}

function readHarnessState(): BrowserHarnessState {
  if (typeof window === 'undefined') {
    return {
      missions: [],
      devices: [],
      positions: [],
      outings: [],
      markers: [],
      drawings: [],
      helicopters: [],
      gpxImports: [],
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
      outings: [],
      markers: [],
      drawings: [],
      helicopters: [],
      gpxImports: [],
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
      outings: Array.isArray(parsed.outings) ? parsed.outings : [],
      markers: Array.isArray(parsed.markers) ? parsed.markers : [],
      drawings: Array.isArray(parsed.drawings) ? parsed.drawings : [],
      helicopters: Array.isArray(parsed.helicopters) ? parsed.helicopters : [],
      gpxImports: Array.isArray(parsed.gpxImports) ? parsed.gpxImports : [],
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
      outings: [],
      markers: [],
      drawings: [],
      helicopters: [],
      gpxImports: [],
      missionEvents: [],
      openedPaths: [],
      currentMissionId: null,
      recoverableMissionId: null,
    }
  }
}

const MAX_AUDIT_EVENT_LIMIT = 5_000

/**
 * Clamps a requested audit-event limit to the bounded range, defaulting when unset.
 */
function clampAuditLimit(requestedLimit: number | undefined): number {
  if (typeof requestedLimit !== 'number' || !Number.isFinite(requestedLimit)) {
    return DEFAULT_AUDIT_EVENT_LIMIT
  }
  const rounded = Math.floor(requestedLimit)
  if (rounded < 1) {
    return 1
  }
  return Math.min(rounded, MAX_AUDIT_EVENT_LIMIT)
}

function pruneTrackingPersistence(
  state: BrowserHarnessState,
  maxPositions: number,
): BrowserHarnessState {
  if (state.positions.length <= maxPositions) {
    return state
  }

  const keptPositions = [...state.positions]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-maxPositions)
  const keptPositionIds = new Set(keptPositions.map((position) => position.id))
  const keptPositionEvents = state.missionEvents
    .filter((event) => event.event_type === 'position_recorded')
    .filter((event) => {
      const positionId = readPositionIdFromEvent(event)
      return positionId !== null && keptPositionIds.has(positionId)
    })
  const nonPositionEvents = state.missionEvents.filter(
    (event) => event.event_type !== 'position_recorded',
  )

  return {
    ...state,
    positions: keptPositions,
    missionEvents: [...nonPositionEvents, ...keptPositionEvents].sort(
      (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
    ),
  }
}

function readPositionIdFromEvent(event: MissionEvent): string | null {
  if (event.details_json === null) {
    return null
  }

  try {
    const details = JSON.parse(event.details_json) as { position_id?: unknown }
    return typeof details.position_id === 'string' ? details.position_id : null
  } catch {
    return null
  }
}

function isStorageQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  )
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
  if (mission.status === 'finished' || mission.status === 'finalized') {
    throw new Error(
      `Cannot write data to finished mission ${missionId}; resume the mission or unlock it first.`,
    )
  }

  return mission
}

/** Returns one outing scoped to its mission. */
function requireHarnessOuting(
  missionId: string,
  outingId: string,
  outings: readonly Outing[],
): Outing {
  const outing = outings.find(
    (candidate) => candidate.mission_id === missionId && candidate.id === outingId,
  )
  if (outing === undefined) throw new Error(`Outing not found: ${outingId}`)
  return outing
}

/** Validates one browser-harness outing against the production invariants. */
function assertHarnessOutingWindow(
  mission: Mission,
  outing: Outing,
  outings: readonly Outing[],
): void {
  const start = Date.parse(outing.started_at)
  const end = outing.ended_at === null ? null : Date.parse(outing.ended_at)
  if (start < Date.parse(mission.start_time)) {
    throw new Error('Outing start cannot be before the mission start.')
  }
  if (end !== null && end <= start) throw new Error('Outing end must be after its start.')
  const conflict = outings.find(
    (candidate) => candidate.id !== outing.id && outingWindowsOverlap(outing, candidate),
  )
  if (conflict !== undefined) {
    throw new Error(`Outing window overlaps "${conflict.label}".`)
  }
}

/** Normalizes a browser-harness date-time boundary. */
function normalizeHarnessOutingBoundary(value: string): string {
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    throw new Error('Outing boundary must be a valid ISO8601 date-time.')
  }
  return new Date(milliseconds).toISOString()
}

/** Normalizes one bounded operator-facing outing label. */
function normalizeHarnessOutingLabel(value: string): string {
  const label = value.trim()
  if (label === '') throw new Error('Outing label is required.')
  if (label.length > 120) throw new Error('Outing label must be 120 characters or fewer.')
  return label
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

function upsertHelicopter(
  helicopters: readonly Helicopter[],
  helicopter: Helicopter,
): readonly Helicopter[] {
  const filtered = helicopters.filter(
    (candidate) =>
      candidate.id !== helicopter.id &&
      !(candidate.mission_id === helicopter.mission_id && candidate.slot_key === helicopter.slot_key),
  )
  return [...filtered, helicopter]
}

function upsertGpxImport(
  gpxImports: readonly GpxTrackImport[],
  gpxImport: GpxTrackImport,
): readonly GpxTrackImport[] {
  const existingIndex = gpxImports.findIndex((candidate) => candidate.id === gpxImport.id)
  if (existingIndex === -1) {
    return [...gpxImports, gpxImport]
  }

  return gpxImports.map((candidate) =>
    candidate.id === gpxImport.id ? gpxImport : candidate,
  )
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
