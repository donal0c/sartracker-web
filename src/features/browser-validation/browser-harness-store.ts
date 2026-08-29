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
  MissionReplayReadInput,
  MissionReplayReadResult,
  MissionReplayObjectChunkResult,
  MissionReplayTrackChunkResult,
  MissionStoreInfo,
  MissionParticipant,
  GroupMembershipEvent,
  ParticipantBackfillCheckpoint,
  SelectMissionParticipantsInput,
  AddMissionParticipantInput,
  Position,
  Outing,
  OutingFixSummary,
  EditOutingBoundariesInput,
  EndOutingInput,
  CoverageClaim,
  CoverageManifest,
  CoverageTileCatalog,
  RenameOutingInput,
  UnlockFinalizedMissionInput,
  UpsertDeviceInput,
  UpsertDrawingInput,
  UpsertGpxTrackImportInput,
  UpsertHelicopterInput,
  UpsertMarkerInput,
  SearchArea,
  SearchAssignment,
  SearchPass,
  SearchOperationPage,
  SearchOperationPageKind,
  MissionReplayFilterPage,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type {
  AcknowledgeIngestEvidenceLossInput,
  IngestEvidenceHealth,
  IngestEvidenceLossReason,
} from '../../domain/tracking-ingest-evidence'
import {
  acknowledgeBrowserEvidenceLoss,
  hasUnacknowledgedBrowserEvidenceLoss,
  readBrowserEvidenceHealth,
  readBrowserEvidenceLossState,
  recordBrowserEvidenceLoss,
  type BrowserEvidenceLossByMission,
} from './browser-evidence-loss-state'
import { createTrailSegments } from '../tracking/trail-segmentation'
import { coveragePeriodKey } from '../tracking/coverage-filter-store'
import { outingWindowsOverlap } from '../outings/outing-schedule'
import {
  DEFAULT_AUDIT_EVENT_LIMIT,
  isTelemetryEventType,
} from '../mission-review/audit-events'
import { normalizeTrackingIsoTimestamp } from '../tracking/tracking-timestamp'

const MAX_SEARCH_OPERATION_ID_LENGTH = 200
const MAX_SEARCH_OPERATION_LINK_COUNT = 200
const MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH = 120
const MAX_SEARCH_OPERATION_NOTES_LENGTH = 2_000
const MAX_MARKER_TREATMENT_LOG_BYTES = 512 * 1_024
const MAX_SEARCH_OPERATION_TIMESTAMP_LENGTH = 64
const MAX_SEARCH_AREA_GEOMETRY_LENGTH = 512 * 1_024
const MAX_SEARCH_ADVISORY_COVERAGE_LENGTH = 512 * 1_024
const MAX_MUTABLE_EVIDENCE_GEOMETRY_LENGTH = 512 * 1_024
const MAX_MUTABLE_EVIDENCE_COORDINATES = 50_000
const MAX_MUTABLE_EVIDENCE_NESTING_DEPTH = 16
const MAX_MUTABLE_EVIDENCE_PATH_LENGTH = 4_096
const MAX_REPLAY_TRACK_LIMIT = 1_000
const MAX_REPLAY_OBJECT_LIMIT = 100
const MAX_REPLAY_FILTER_IDS = 200
const MAX_REPLAY_FILTER_PAGE_LIMIT = 100
const MAX_REPLAY_CURSOR_OFFSET = 10_000_000
const MAX_REPLAY_SELECTED_TIME_LENGTH = 64
const REPLAY_TIMEZONE = 'Europe/Dublin'
const MAX_GPX_PROJECTION_PAGE_LIMIT = 25

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
  readonly missionTeams: readonly BrowserMissionTeam[]
  readonly missionParticipants: readonly MissionParticipant[]
  readonly groupMembershipEvents: readonly GroupMembershipEvent[]
  readonly participantBackfillCheckpoints: readonly ParticipantBackfillCheckpoint[]
  readonly markers: readonly Marker[]
  readonly drawings: readonly Drawing[]
  readonly helicopters: readonly Helicopter[]
  readonly gpxImports: readonly GpxTrackImport[]
  readonly gpxEvidencePoints: readonly BrowserGpxEvidencePoint[]
  readonly searchAreas: readonly SearchArea[]
  readonly searchAssignments: readonly SearchAssignment[]
  readonly searchPasses: readonly SearchPass[]
  readonly missionEvents: readonly MissionEvent[]
  readonly openedPaths: readonly string[]
  readonly currentMissionId: string | null
  readonly recoverableMissionId: string | null
  readonly evidenceLossByMission: BrowserEvidenceLossByMission
}

type BrowserGpxEvidencePoint = {
  readonly importId: string
  readonly revisionSequence: number
  /** Outing assignment captured with this evidence revision, not read from current import state. */
  readonly outingId?: string | null
  readonly segmentIndex: number
  readonly pointIndex: number
  readonly trackName?: string | null
  readonly lat: number
  readonly lon: number
  readonly elevation: number | null
  readonly timestamp: string | null
  readonly recordedAt: string
}

type BrowserMissionTeam = {
  readonly id: string
  readonly mission_id: string
  readonly traccar_group_id: string
  readonly name: string
  readonly frozen_at: string
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
  readonly selectMissionParticipants: (
    input: SelectMissionParticipantsInput,
  ) => Promise<readonly MissionParticipant[]>
  readonly addMissionParticipant: (
    input: AddMissionParticipantInput,
  ) => Promise<MissionParticipant>
  readonly removeMissionParticipant: (input: {
    readonly mission_id: string
    readonly participant_id: string
    readonly removed_by: string
    readonly reason?: string
  }) => Promise<MissionParticipant>
  readonly listMissionParticipants: (
    missionId: string,
  ) => Promise<readonly MissionParticipant[]>
  readonly recordGroupMembershipEvents: (input: {
    readonly mission_id: string
    readonly events: readonly Omit<GroupMembershipEvent, 'id' | 'sequence' | 'mission_id'>[]
  }) => Promise<readonly GroupMembershipEvent[]>
  readonly listGroupMembershipEvents: (
    missionId: string,
    teamId?: string,
  ) => Promise<readonly GroupMembershipEvent[]>
  readonly upsertParticipantBackfillCheckpoint: (
    input: Omit<ParticipantBackfillCheckpoint, 'completed' | 'updated_at'> & {
      readonly completed: boolean
    },
  ) => Promise<ParticipantBackfillCheckpoint>
  readonly listParticipantBackfillCheckpoints: (
    missionId: string,
  ) => Promise<readonly ParticipantBackfillCheckpoint[]>
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
  readonly recordIngestEvidenceLoss: (input: {
    readonly mission_id: string
    readonly reason: IngestEvidenceLossReason
  }) => Promise<IngestEvidenceHealth>
  readonly getIngestEvidenceHealth: (missionId?: string) => Promise<IngestEvidenceHealth>
  readonly acknowledgeIngestEvidenceLoss: (
    input: AcknowledgeIngestEvidenceLossInput,
  ) => Promise<IngestEvidenceHealth>
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
  readonly readCoverageManifest: (missionId: string) => Promise<CoverageManifest>
  readonly readCoverageClaim: (input: {
    readonly missionId: string
    readonly selectedKeys: readonly CoverageManifest['chunks'][number]['key'][]
  }) => Promise<CoverageClaim>
  readonly syncCoverageTileCatalog: (input: {
    readonly missionId: string
    readonly chunks: readonly {
      readonly key: CoverageManifest['chunks'][number]['key']
      readonly contentRev: number
    }[]
  }) => Promise<CoverageTileCatalog>
  readonly activateCoverageTileCatalog: (input: {
    readonly activationId: string
  }) => Promise<boolean>
  readonly finalizeCoverageTileCatalog: (input: {
    readonly activationId: string
  }) => Promise<boolean>
  readonly discardCoverageTileCatalog: (input: {
    readonly activationId: string
  }) => Promise<boolean>
  readonly cancelCoverageQuery: (requestId: string) => Promise<boolean>
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
  readonly listGpxImportPage: (input: {
    readonly missionId: string
    readonly cursor?: string
    readonly limit?: number
  }) => Promise<{
    readonly entries: readonly GpxTrackImport[]
    readonly nextCursor: string | null
  }>
  readonly upsertGpxImport: (input: UpsertGpxTrackImportInput) => Promise<GpxTrackImport>
  readonly updateGpxImportPresentation: (input: {
    readonly id: string
    readonly mission_id: string
    readonly display_name?: string
    readonly metadata_json?: string | null
  }) => Promise<GpxTrackImport>
  readonly deleteGpxImport: (importId: string) => Promise<boolean>
  readonly assignGpxImportToOuting: (input: { readonly import_id: string; readonly outing_id: string; readonly assigned_by?: string | null }) => Promise<GpxTrackImport>
  readonly readMissionReplay: (input: MissionReplayReadInput, requestId?: string) => Promise<MissionReplayReadResult>
  readonly readMissionReplayTrackChunk: (input: MissionReplayReadInput, requestId?: string) => Promise<MissionReplayTrackChunkResult>
  readonly readMissionReplayObjectChunk: (input: MissionReplayReadInput, requestId?: string) => Promise<MissionReplayObjectChunkResult>
  readonly readMissionReplayFilterPage: (input: MissionReplayReadInput & {
    readonly filterKind: 'outing'
    readonly filterSearch?: string
    readonly filterCursor?: string
    readonly filterLimit?: number
  }, requestId?: string) => Promise<MissionReplayFilterPage>
  readonly cancelMissionReplay: (requestId: string) => Promise<boolean>
  readonly listSearchAreas: (missionId: string) => Promise<readonly SearchArea[]>
  readonly listSearchAssignments: (missionId: string) => Promise<readonly SearchAssignment[]>
  readonly listSearchPasses: (missionId: string) => Promise<readonly SearchPass[]>
  readonly listSearchOperationPage: (input: {
    readonly missionId: string
    readonly kind: SearchOperationPageKind
    readonly search?: string
    readonly cursor?: string
    readonly limit?: number
  }) => Promise<SearchOperationPage>
  readonly upsertSearchAssignment: (input: Readonly<Record<string, unknown>>) => Promise<SearchAssignment>
  readonly upsertSearchPass: (input: Readonly<Record<string, unknown>>) => Promise<SearchPass>
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
      assertHarnessRecordedSearchPassesFitOuting(
        outing,
        state.searchAssignments,
        state.searchPasses,
      )
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
      assertHarnessRecordedSearchPassesFitOuting(
        outing,
        state.searchAssignments,
        state.searchPasses,
      )
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
    selectMissionParticipants: async (input) => {
      const mission = requireMutableParticipantMission(input.mission_id, state.missions)
      assertHarnessInitialParticipantSelection(input, state.missionParticipants)
      const timestamp = new Date().toISOString()
      const teams = input.groups.map((group) => ({
        id: createId('team'),
        mission_id: mission.id,
        traccar_group_id: group.traccar_group_id,
        name: group.name,
        frozen_at: timestamp,
      } satisfies BrowserMissionTeam))
      const groupParticipants = teams.map((team) =>
        createHarnessParticipant({
          missionId: mission.id,
          kind: 'group',
          missionTeamId: team.id,
          traccarGroupId: team.traccar_group_id,
          teamName: team.name,
          effectiveFrom: mission.start_time,
          addedAt: timestamp,
          addedBy: input.selected_by,
        }))
      const deviceParticipants = input.devices.map((device) =>
        createHarnessParticipant({
          missionId: mission.id,
          kind: 'device',
          deviceId: device.traccar_device_id,
          effectiveFrom: mission.start_time,
          addedAt: timestamp,
          addedBy: input.selected_by,
        }))
      let membershipSequence = nextHarnessMembershipSequence(state.groupMembershipEvents)
      const membershipEvents = input.groups.flatMap((group, groupIndex) =>
        group.member_device_ids.map((deviceId) => ({
          id: createId('membership'),
          sequence: membershipSequence++,
          mission_id: mission.id,
          mission_team_id: teams[groupIndex]?.id ?? '',
          traccar_device_id: deviceId,
          change: 'member' as const,
          observed_at: timestamp,
        })))
      const groupBackfillCheckpoints = membershipEvents.map((event) =>
        createHarnessBackfillCheckpoint({
          missionId: mission.id,
          deviceId: event.traccar_device_id,
          windowFrom: mission.start_time,
          windowTo: timestamp,
        }))
      const deviceBackfillCheckpoints = input.devices.map((device) =>
        createHarnessBackfillCheckpoint({
          missionId: mission.id,
          deviceId: device.traccar_device_id,
          windowFrom: mission.start_time,
          windowTo: timestamp,
        }))
      const participants = [...groupParticipants, ...deviceParticipants]
      state = {
        ...state,
        missionTeams: [...state.missionTeams, ...teams],
        missionParticipants: [...state.missionParticipants, ...participants],
        groupMembershipEvents: [...state.groupMembershipEvents, ...membershipEvents],
        participantBackfillCheckpoints: [
          ...state.participantBackfillCheckpoints,
          ...groupBackfillCheckpoints,
          ...deviceBackfillCheckpoints,
        ],
        missionEvents: appendEvent(
          state.missionEvents,
          mission.id,
          'participants_selected',
          timestamp,
          {
            selected_by: input.selected_by,
            group_count: teams.length,
            device_count: deviceParticipants.length,
            effective_from: mission.start_time,
          },
        ),
      }
      save()
      return participants
    },
    addMissionParticipant: async (input) => {
      const mission = requireMutableParticipantMission(input.mission_id, state.missions)
      const addedAt = new Date().toISOString()
      const effectiveFrom = normalizeParticipantEffectiveFrom(
        input.effective_from ?? addedAt,
        mission,
        addedAt,
      )
      let team: BrowserMissionTeam | null = null
      let observedMembershipEvents: readonly GroupMembershipEvent[] = []
      if (input.kind === 'group') {
        if (typeof input.ref === 'string') throw new Error('Participant group details are required.')
        const groupRef = input.ref
        if (!Array.isArray(groupRef.member_device_ids)) {
          throw new Error('Current group member device ids are required.')
        }
        team = state.missionTeams.find((candidate) =>
          candidate.mission_id === mission.id &&
          candidate.traccar_group_id === groupRef.traccar_group_id) ?? {
          id: createId('team'),
          mission_id: mission.id,
          traccar_group_id: groupRef.traccar_group_id,
          name: groupRef.name,
          frozen_at: addedAt,
        }
        observedMembershipEvents = createHarnessMembershipObservation({
          missionId: mission.id,
          teamId: team.id,
          observedDeviceIds: groupRef.member_device_ids,
          observedAt: addedAt,
          previousEvents: state.groupMembershipEvents,
        })
      }
      const deviceId = input.kind === 'device'
        ? requireHarnessText(input.ref, 'Traccar device id')
        : null
      const duplicate = state.missionParticipants.some((participant) =>
        participant.mission_id === mission.id &&
        participant.removed_at === null &&
        (input.kind === 'device'
          ? participant.kind === 'device' && participant.traccar_device_id === deviceId
          : participant.kind === 'group' && participant.mission_team_id === team?.id))
      if (duplicate) throw new Error('Participant is already active for this mission.')
      if (
        deviceId !== null &&
        isHarnessDeviceCoveredByActiveGroup(
          mission.id,
          deviceId,
          state.missionParticipants,
          state.groupMembershipEvents,
        )
      ) {
        throw new Error('Participant device is already active through a selected group.')
      }
      if (
        team !== null &&
        harnessGroupCoversActiveDevice(
          mission.id,
          team.id,
          state.missionParticipants,
          [...state.groupMembershipEvents, ...observedMembershipEvents],
        )
      ) {
        throw new Error('Participant group already covers an active individual device.')
      }
      const participant = createHarnessParticipant({
        missionId: mission.id,
        kind: input.kind,
        deviceId,
        missionTeamId: team?.id ?? null,
        traccarGroupId: team?.traccar_group_id ?? null,
        teamName: team?.name ?? null,
        effectiveFrom,
        addedAt,
        addedBy: input.confirmed_by,
      })
      const checkpoints = deviceId === null
        ? observedMembershipEvents.map((event) =>
            createHarnessBackfillCoverageCheckpoints(
              state.participantBackfillCheckpoints,
              {
                missionId: mission.id,
                deviceId: event.traccar_device_id,
                windowFrom: effectiveFrom,
                windowTo: addedAt,
              },
            )).flat()
        : createHarnessBackfillCoverageCheckpoints(
            state.participantBackfillCheckpoints,
            {
              missionId: mission.id,
              deviceId,
              windowFrom: effectiveFrom,
              windowTo: addedAt,
            },
          )
      state = {
        ...state,
        missionTeams: team === null || state.missionTeams.some((candidate) => candidate.id === team?.id)
          ? state.missionTeams
          : [...state.missionTeams, team],
        missionParticipants: [...state.missionParticipants, participant],
        groupMembershipEvents: [
          ...state.groupMembershipEvents,
          ...observedMembershipEvents,
        ],
        participantBackfillCheckpoints: [
          ...state.participantBackfillCheckpoints,
          ...checkpoints,
        ],
        missionEvents: appendEvent(
          state.missionEvents,
          mission.id,
          'participant_added',
          addedAt,
          {
            participant_id: participant.id,
            effective_from: effectiveFrom,
            confirmed_by: input.confirmed_by,
          },
        ),
      }
      save()
      return participant
    },
    removeMissionParticipant: async (input) => {
      requireMutableParticipantMission(input.mission_id, state.missions)
      const existing = state.missionParticipants.find((participant) =>
        participant.mission_id === input.mission_id && participant.id === input.participant_id)
      if (existing === undefined) throw new Error(`Mission participant not found: ${input.participant_id}`)
      if (existing.removed_at !== null) throw new Error('Mission participant has already been removed.')
      const removedAt = new Date().toISOString()
      const participant = { ...existing, removed_at: removedAt, removed_by: input.removed_by }
      state = {
        ...state,
        missionParticipants: state.missionParticipants.map((candidate) =>
          candidate.id === participant.id ? participant : candidate),
        missionEvents: appendEvent(
          state.missionEvents,
          input.mission_id,
          'participant_removed',
          removedAt,
          { participant_id: participant.id, removed_by: input.removed_by, reason: input.reason ?? null },
        ),
      }
      save()
      return participant
    },
    listMissionParticipants: async (missionId) => {
      requireMission(missionId, state.missions)
      return state.missionParticipants
        .filter((participant) => participant.mission_id === missionId)
        .map((participant) => {
          const checkpoints = participant.traccar_device_id === null
            ? []
            : state.participantBackfillCheckpoints.filter((candidate) =>
                candidate.mission_id === participant.mission_id &&
                candidate.traccar_device_id === participant.traccar_device_id &&
                candidate.window_from >= participant.effective_from &&
                candidate.window_to <= participant.added_at)
          const incompleteCheckpoint = checkpoints
            .filter((candidate) => candidate.completed === 0)
            .toSorted((left, right) => left.reconciled_until.localeCompare(right.reconciled_until))[0]
          const latestCheckpoint = checkpoints
            .toSorted((left, right) => right.window_to.localeCompare(left.window_to))[0]
          const groupCheckpoints = participant.kind !== 'group'
            ? []
            : state.groupMembershipEvents
                .filter((event) =>
                  event.mission_id === participant.mission_id &&
                  event.mission_team_id === participant.mission_team_id &&
                  event.change === 'member' &&
                  event.observed_at === participant.added_at)
                .flatMap((event) => state.participantBackfillCheckpoints.filter((candidate) =>
                  candidate.mission_id === participant.mission_id &&
                  candidate.traccar_device_id === event.traccar_device_id &&
                  candidate.window_from >= participant.effective_from &&
                  candidate.window_to <= participant.added_at))
          const groupMemberDeviceIds = participant.kind !== 'group'
            ? []
            : state.groupMembershipEvents
                .filter((event) =>
                  event.mission_id === participant.mission_id &&
                  event.mission_team_id === participant.mission_team_id &&
                  event.change === 'member' &&
                  event.observed_at === participant.added_at)
                .map((event) => event.traccar_device_id)
          return {
            ...participant,
            ...(latestCheckpoint === undefined
              ? {}
              : {
                  backfill_window_to: latestCheckpoint.window_to,
                  backfill_reconciled_until:
                    incompleteCheckpoint?.reconciled_until ?? latestCheckpoint.reconciled_until,
                  backfill_completed: checkpoints.every((entry) => entry.completed === 1) ? 1 : 0,
                }),
            ...(participant.kind !== 'group'
              ? {}
              : {
                  backfill_member_count: new Set(groupMemberDeviceIds).size,
                  backfill_completed_count: new Set(groupMemberDeviceIds.filter((deviceId) => {
                    const deviceCheckpoints = groupCheckpoints.filter((entry) =>
                      entry.traccar_device_id === deviceId)
                    return deviceCheckpoints.length > 0 &&
                      deviceCheckpoints.every((entry) => entry.completed === 1)
                  })).size,
                }),
          }
        })
    },
    recordGroupMembershipEvents: async (input) => {
      requireMutableParticipantMission(input.mission_id, state.missions)
      const inserted: GroupMembershipEvent[] = []
      for (const candidate of input.events) {
        const latest = state.groupMembershipEvents
          .filter((event) =>
            event.mission_id === input.mission_id &&
            event.mission_team_id === candidate.mission_team_id &&
            event.traccar_device_id === candidate.traccar_device_id)
          .toSorted((left, right) =>
            right.observed_at.localeCompare(left.observed_at) ||
            right.sequence - left.sequence)[0]
        if (latest?.change === candidate.change) continue
        inserted.push({
          id: createId('membership'),
          sequence: nextHarnessMembershipSequence([
            ...state.groupMembershipEvents,
            ...inserted,
          ]),
          mission_id: input.mission_id,
          ...candidate,
        })
      }
      if (inserted.length > 0) {
        const timestamp = new Date().toISOString()
        state = {
          ...state,
          groupMembershipEvents: [...state.groupMembershipEvents, ...inserted],
          missionEvents: appendEvent(
            state.missionEvents,
            input.mission_id,
            'group_membership_changed',
            timestamp,
            { event_count: inserted.length },
          ),
        }
        save()
      }
      return inserted
    },
    listGroupMembershipEvents: async (missionId, teamId) => {
      requireMission(missionId, state.missions)
      return state.groupMembershipEvents.filter((event) =>
        event.mission_id === missionId &&
        (teamId === undefined || event.mission_team_id === teamId))
    },
    upsertParticipantBackfillCheckpoint: async (input) => {
      requireMutableParticipantMission(input.mission_id, state.missions)
      const existing = state.participantBackfillCheckpoints.find((checkpoint) =>
        checkpoint.mission_id === input.mission_id &&
        checkpoint.traccar_device_id === input.traccar_device_id &&
        checkpoint.window_from === input.window_from)
      if (existing !== undefined && existing.window_to !== input.window_to) {
        throw new Error('Participant backfill window edges are immutable.')
      }
      if ((input.reconciled_until === input.window_to) !== input.completed) {
        throw new Error(
          'Completed participant backfill must have its cursor at the fixed window end.',
        )
      }
      if (existing?.completed === 1 && !input.completed) {
        throw new Error('Participant backfill completion is irreversible.')
      }
      if (
        existing !== undefined &&
        input.reconciled_until < existing.reconciled_until
      ) {
        throw new Error('Participant backfill cursor cannot decrease or rewind.')
      }
      const checkpoint: ParticipantBackfillCheckpoint = {
        mission_id: input.mission_id,
        traccar_device_id: input.traccar_device_id,
        window_from: input.window_from,
        window_to: input.window_to,
        reconciled_until: input.reconciled_until,
        completed: input.completed ? 1 : 0,
        updated_at: new Date().toISOString(),
      }
      state = {
        ...state,
        participantBackfillCheckpoints: [
          ...state.participantBackfillCheckpoints.filter((candidate) =>
            !(candidate.mission_id === checkpoint.mission_id &&
              candidate.traccar_device_id === checkpoint.traccar_device_id &&
              candidate.window_from === checkpoint.window_from)),
          checkpoint,
        ],
      }
      save()
      return checkpoint
    },
    listParticipantBackfillCheckpoints: async (missionId) => {
      requireMission(missionId, state.missions)
      return state.participantBackfillCheckpoints.filter((checkpoint) =>
        checkpoint.mission_id === missionId)
    },
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
      const incompleteBackfillCount = state.participantBackfillCheckpoints.filter(
        (checkpoint) => checkpoint.mission_id === missionId && checkpoint.completed === 0,
      ).length
      if (incompleteBackfillCount > 0) {
        throw new Error(
          `Mission cannot be finished while ${incompleteBackfillCount} participant history backfill checkpoint(s) are incomplete. Keep the mission active and retry history backfill before finishing.`,
        )
      }
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
    recordIngestEvidenceLoss: async (input) => {
      requireMission(input.mission_id, state.missions)
      state = {
        ...state,
        evidenceLossByMission: recordBrowserEvidenceLoss(
          state.evidenceLossByMission,
          input.mission_id,
          input.reason,
        ),
      }
      save()
      return readBrowserEvidenceHealth(state.evidenceLossByMission, input.mission_id)
    },
    getIngestEvidenceHealth: async (missionId) =>
      readBrowserEvidenceHealth(state.evidenceLossByMission, missionId),
    acknowledgeIngestEvidenceLoss: async (input) => {
      const mission = requireMission(input.mission_id, state.missions)
      if (mission.status !== 'finished') {
        throw new Error('Evidence loss can be acknowledged only after the mission is finished.')
      }
      const evidenceLoss = state.evidenceLossByMission[input.mission_id]
      if (evidenceLoss === undefined) {
        throw new Error('No isolated mission evidence loss is available to acknowledge.')
      }
      const settings = readBrowserSettings()
      if (!settings.missionDefaults.adminRoster.includes(input.admin_name)) {
        state = {
          ...state,
          missionEvents: appendEvent(
            state.missionEvents,
            input.mission_id,
            'mission_evidence_loss_acknowledgement_denied',
            new Date().toISOString(),
            {
              admin_name: input.admin_name,
              reason: input.reason,
              resulting_status: mission.status,
            },
          ),
        }
        save()
        throw new Error('Selected admin is not authorized to acknowledge mission evidence loss.')
      }
      const acknowledgedAt = new Date().toISOString()
      state = {
        ...state,
        evidenceLossByMission: acknowledgeBrowserEvidenceLoss(
          state.evidenceLossByMission,
          input,
          acknowledgedAt,
        ),
        missionEvents: appendEvent(
          state.missionEvents,
          input.mission_id,
          'mission_evidence_loss_acknowledged',
          acknowledgedAt,
          {
            admin_name: input.admin_name,
            reason: input.reason,
            loss_generation: evidenceLoss.generation,
            resulting_status: mission.status,
          },
        ),
      }
      save()
      return readBrowserEvidenceHealth(state.evidenceLossByMission, input.mission_id)
    },
    finalizeMission: async (missionId) => {
      const mission = requireMission(missionId, state.missions)
      if (mission.status !== 'finished') {
        throw new Error('Only finished missions can be finalized.')
      }
      if (hasUnacknowledgedBrowserEvidenceLoss(state.evidenceLossByMission, missionId)) {
        throw new Error(
          'Degraded evidence health blocks finalization; resolve durable ingest evidence before continuing.',
        )
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
        group_id: input.group_id ?? null,
        unique_id: input.unique_id ?? null,
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
    readCoverageManifest: async (missionId) => {
      await waitForBrowserCoverageValidationDelay()
      return createBrowserCoverageManifest(state, missionId)
    },
    readCoverageClaim: async (input) => {
      const manifest = createBrowserCoverageManifest(state, input.missionId)
      const evidenceHealth = readBrowserEvidenceHealth(
        state.evidenceLossByMission,
        input.missionId,
      )
      const revisions = new Map(manifest.chunks.map((chunk) => [
        `${chunk.key.device_id}\u0000${coveragePeriodKey(chunk.key)}`,
        chunk,
      ]))
      const selected = input.selectedKeys.flatMap((key) => {
        const chunk = revisions.get(`${key.device_id}\u0000${coveragePeriodKey(key)}`)
        return chunk === undefined ? [] : [{ key: chunk.key, contentRev: chunk.contentRev }]
      })
      const blockers = [
        ...(manifest.backfillIncomplete ? ['backfill_incomplete'] : []),
        ...(evidenceHealth.state === 'healthy' ? [] : ['ingest_health_degraded']),
      ]
      return {
        changeSeq: manifest.changeSeq,
        databaseReady: blockers.length === 0,
        blockers,
        chunkRevisions: selected,
      }
    },
    syncCoverageTileCatalog: async (input) => {
      await waitForBrowserCoverageValidationDelay()
      return createBrowserCoverageTileCatalog(state, input.missionId, input.chunks)
    },
    activateCoverageTileCatalog: async () => true,
    finalizeCoverageTileCatalog: async () => true,
    discardCoverageTileCatalog: async () => true,
    cancelCoverageQuery: async () => false,
    listMarkers: async (missionId) =>
      state.markers
        .filter((marker) => marker.mission_id === missionId)
        .sort((left, right) => left.display_order - right.display_order),
    upsertMarker: async (input) => {
      const normalizedInput = normalizeBrowserMarkerMutation(input)
      ensureMissionMutable(normalizedInput.mission_id, state.missions)
      const existingMarker = normalizedInput.id === undefined || normalizedInput.id === null
        ? null
        : state.markers.find((marker) => marker.id === normalizedInput.id) ?? null
      const now = new Date().toISOString()
      const marker = {
        id: existingMarker?.id ?? normalizedInput.id ?? createId('marker'),
        mission_id: normalizedInput.mission_id,
        type: normalizedInput.type,
        name: normalizedInput.name,
        description: normalizedInput.description ?? null,
        lat: normalizedInput.lat,
        lon: normalizedInput.lon,
        irish_grid_e: normalizedInput.irish_grid_e,
        irish_grid_n: normalizedInput.irish_grid_n,
        created_at: existingMarker?.created_at ?? now,
        updated_at: now,
        display_order: normalizedInput.display_order,
        subject_category: normalizedInput.subject_category ?? null,
        clue_type: normalizedInput.clue_type ?? null,
        confidence: normalizedInput.confidence ?? null,
        found_by: normalizedInput.found_by ?? null,
        hazard_type: normalizedInput.hazard_type ?? null,
        severity: normalizedInput.severity ?? null,
        condition: normalizedInput.condition ?? null,
        treatment: normalizedInput.treatment ?? null,
        evacuation_priority: normalizedInput.evacuation_priority ?? null,
        label_size: normalizedInput.label_size ?? null,
        updated_by: normalizedInput.updated_by ?? null,
        coordinator_ids: normalizedInput.coordinator_ids ?? null,
        attachment_path: normalizedInput.attachment_path ?? null,
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
      const normalizedMarkerId = normalizeBrowserEvidenceRequiredText(
        markerId, 'Marker identity', MAX_SEARCH_OPERATION_ID_LENGTH,
      )
      const didDelete = state.markers.some((marker) => marker.id === normalizedMarkerId)
      if (!didDelete) {
        return false
      }
      const marker = state.markers.find((candidate) => candidate.id === normalizedMarkerId)
      if (marker !== undefined) {
        ensureMissionMutable(marker.mission_id, state.missions)
      }

      state = {
        ...state,
        markers: state.markers.filter((marker) => marker.id !== normalizedMarkerId),
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
      const normalizedInput = input.type === 'search_area'
        ? normalizeBrowserSearchAreaDrawing(input)
        : normalizeBrowserDrawingMutation(input)
      ensureMissionMutable(normalizedInput.mission_id, state.missions)
      const existingDrawing =
        normalizedInput.id === undefined || normalizedInput.id === null
          ? null
          : state.drawings.find((drawing) => drawing.id === normalizedInput.id) ?? null
      const now = new Date().toISOString()
      const drawing = {
        id: existingDrawing?.id ?? normalizedInput.id ?? createId('drawing'),
        mission_id: normalizedInput.mission_id,
        type: normalizedInput.type,
        name: normalizedInput.name,
        description: normalizedInput.description ?? null,
        color: normalizedInput.color ?? null,
        width: normalizedInput.width ?? null,
        distance_m: normalizedInput.distance_m ?? null,
        temporary_measure: normalizedInput.temporary_measure ?? null,
        label: normalizedInput.label ?? null,
        display_order: normalizedInput.display_order,
        geometry_json: normalizedInput.geometry_json,
        metadata_json: normalizedInput.metadata_json ?? null,
        created_at: existingDrawing?.created_at ?? now,
        updated_at: now,
      } satisfies Drawing
      const stableArea = drawing.type === 'search_area'
        ? {
            id: drawing.id,
            mission_id: drawing.mission_id,
            name: drawing.name,
            status: 'active' as const,
            geometry_json: drawing.geometry_json,
            legacy_drawing_id: drawing.id,
            version_sequence: (state.searchAreas.find((area) => area.id === drawing.id)?.version_sequence ?? 0) + 1,
            updated_by: null,
            created_at: existingDrawing?.created_at ?? now,
            updated_at: now,
            retired_at: null,
          } satisfies SearchArea
        : null

      state = {
        ...state,
        drawings: upsertDrawing(state.drawings, drawing),
        searchAreas: stableArea === null
          ? state.searchAreas
          : upsertByStableId(state.searchAreas, stableArea),
        missionEvents: appendEvent(
          state.missionEvents,
          normalizedInput.mission_id,
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
      const normalizedDrawingId = normalizeBrowserSearchText(
        drawingId, 'Drawing identity', MAX_SEARCH_OPERATION_ID_LENGTH,
      )
      const didDelete = state.drawings.some((drawing) => drawing.id === normalizedDrawingId)
      if (!didDelete) {
        return false
      }
      const drawing = state.drawings.find((candidate) => candidate.id === normalizedDrawingId)
      if (drawing !== undefined) {
        ensureMissionMutable(drawing.mission_id, state.missions)
      }

      state = {
        ...state,
        drawings: state.drawings.filter((drawing) => drawing.id !== normalizedDrawingId),
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
        .filter((entry) => entry.mission_id === missionId && entry.retired_at == null)
        .sort((left, right) => left.display_name.localeCompare(right.display_name)),
    listGpxImportPage: async (input) => {
      const limit = input.limit ?? MAX_GPX_PROJECTION_PAGE_LIMIT
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_GPX_PROJECTION_PAGE_LIMIT) {
        throw new Error('Browser GPX projection page limit is invalid.')
      }
      const missionId = normalizeBrowserGpxProjectionContext(input.missionId)
      const cursor = decodeBrowserGpxProjectionCursor(input.cursor, missionId)
      const candidates = state.gpxImports
        .filter((entry) => entry.mission_id === missionId && entry.retired_at == null)
        .sort(compareBrowserGpxProjectionOrder)
        .filter((entry) => cursor === null || compareBrowserGpxProjectionOrder(entry, cursor) > 0)
      const page = candidates.slice(0, limit + 1)
      const entries = page.slice(0, limit).map(stripBrowserGpxRetainedBytes)
      const finalEntry = entries.at(-1)
      return {
        entries,
        nextCursor: page.length > limit && finalEntry !== undefined
          ? encodeBrowserGpxProjectionCursor(missionId, finalEntry)
          : null,
      }
    },
    upsertGpxImport: async (input) => {
      ensureMissionMutable(input.mission_id, state.missions)
      const existingWithId = input.id === undefined
        ? undefined
        : state.gpxImports.find((entry) => entry.id === input.id)
      if (existingWithId !== undefined && existingWithId.mission_id !== input.mission_id) {
        throw new Error(`Cannot move GPX evidence ${existingWithId.id} to a different mission.`)
      }
      const existingImport =
        state.gpxImports.find((entry) =>
          entry.mission_id === input.mission_id
          && input.content_sha256 != null
          && entry.content_sha256 === input.content_sha256,
        ) ?? state.gpxImports.find(
          (entry) =>
            entry.mission_id === input.mission_id
            && (entry.id === input.id || entry.source_path === input.source_path),
        ) ?? null
      if (existingImport !== null && existingImport.content_sha256 === input.content_sha256) {
        if (existingImport.geometry_json !== input.geometry_json
          || existingImport.timing_class !== (input.timing_class ?? existingImport.timing_class)
          || (existingImport.outing_id ?? null) !== (input.outing_id ?? existingImport.outing_id ?? null)) {
          throw new Error('The same retained GPX bytes cannot change evidence fields; use the presentation or outing-assignment operation instead.')
        }
        const requestedEvidencePoints = input.points ?? []
        if (requestedEvidencePoints.length > 0) {
          const retainedPoints = state.gpxEvidencePoints
            .filter((point) => point.importId === existingImport.id
              && point.revisionSequence === existingImport.revision_sequence)
            .map((point) => ({
              segment_index: point.segmentIndex,
              point_index: point.pointIndex,
              track_name: point.trackName ?? null,
              lat: point.lat,
              lon: point.lon,
              elevation: point.elevation,
              timestamp: point.timestamp,
            }))
          const requestedPoints = requestedEvidencePoints.map((point) => ({
            segment_index: point.segment_index,
            point_index: point.point_index,
            track_name: point.track_name ?? null,
            lat: point.lat,
            lon: point.lon,
            elevation: point.elevation ?? null,
            timestamp: point.timestamp ?? null,
          }))
          if (JSON.stringify(retainedPoints) !== JSON.stringify(requestedPoints)) {
            throw new Error('The same retained GPX bytes cannot change evidence fields; parsed points differ from the retained revision.')
          }
        }
        return existingImport
      }
      const now = new Date().toISOString()
      const revisionSequence = existingImport === null
        ? 1
        : (existingImport.revision_sequence ?? 1) + 1
      const gpxImport = {
        id: existingImport?.id ?? input.id ?? createId('gpx'),
        mission_id: input.mission_id,
        source_path: input.source_path,
        file_name: input.file_name,
        display_name: input.display_name,
        geometry_json: input.geometry_json,
        metadata_json: input.metadata_json ?? null,
        content_sha256: input.content_sha256 ?? existingImport?.content_sha256 ?? null,
        source_bytes_base64: input.source_bytes_base64 ?? existingImport?.source_bytes_base64 ?? null,
        timing_class: input.timing_class ?? existingImport?.timing_class ?? 'undated',
        outing_id: input.outing_id ?? existingImport?.outing_id ?? null,
        revision_sequence: revisionSequence,
        retired_at: null,
        retired_by: null,
        imported_at: existingImport?.imported_at ?? now,
        updated_at: now,
      } satisfies GpxTrackImport

      state = {
        ...state,
        gpxImports: upsertGpxImport(state.gpxImports, gpxImport),
        gpxEvidencePoints: [
          ...state.gpxEvidencePoints,
          ...(input.points ?? []).map((point) => ({
            importId: gpxImport.id,
            revisionSequence,
            outingId: gpxImport.outing_id ?? null,
            segmentIndex: point.segment_index,
            pointIndex: point.point_index,
            trackName: point.track_name ?? null,
            lat: point.lat,
            lon: point.lon,
            elevation: point.elevation,
            timestamp: point.timestamp,
            recordedAt: now,
          })),
        ],
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
    updateGpxImportPresentation: async (input) => {
      ensureMissionMutable(input.mission_id, state.missions)
      const existing = state.gpxImports.find((entry) => entry.id === input.id)
      if (existing === undefined || existing.mission_id !== input.mission_id
        || existing.retired_at != null) {
        throw new Error('Active GPX evidence was not found in the requested mission.')
      }
      const timestamp = new Date().toISOString()
      const updated = {
        ...existing,
        display_name: input.display_name ?? existing.display_name,
        metadata_json: input.metadata_json === undefined
          ? existing.metadata_json
          : input.metadata_json,
        updated_at: timestamp,
      }
      state = {
        ...state,
        gpxImports: upsertGpxImport(state.gpxImports, updated),
        missionEvents: appendEvent(
          state.missionEvents,
          input.mission_id,
          'gpx_import_presentation_updated',
          timestamp,
          { gpx_import_id: input.id },
        ),
      }
      save()
      return updated
    },
    deleteGpxImport: async (importId) => {
      const gpxImport = state.gpxImports.find((candidate) => candidate.id === importId)
      if (gpxImport === undefined) {
        return false
      }

      ensureMissionMutable(gpxImport.mission_id, state.missions)
      state = {
        ...state,
        gpxImports: state.gpxImports.map((entry) => entry.id === importId
          ? { ...entry, retired_at: new Date().toISOString() }
          : entry),
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
    assignGpxImportToOuting: async (input) => {
      const existing = state.gpxImports.find((entry) => entry.id === input.import_id)
      if (existing === undefined || existing.retired_at != null) throw new Error('Active GPX evidence was not found.')
      ensureMissionMutable(existing.mission_id, state.missions)
      const outing = state.outings.find((entry) => entry.id === input.outing_id)
      if (outing?.mission_id !== existing.mission_id) throw new Error('GPX evidence outing is not in the same mission.')
      const nextSequence = (existing.revision_sequence ?? 1) + 1
      const recordedAt = new Date().toISOString()
      const updated: GpxTrackImport = {
        ...existing,
        outing_id: outing.id,
        revision_sequence: nextSequence,
        updated_at: recordedAt,
      }
      const previousPoints = state.gpxEvidencePoints.filter((point) =>
        point.importId === existing.id && point.revisionSequence === (existing.revision_sequence ?? 1))
      state = {
        ...state,
        gpxImports: state.gpxImports.map((entry) => entry.id === updated.id ? updated : entry),
        gpxEvidencePoints: [
          ...state.gpxEvidencePoints,
          ...previousPoints.map((point) => ({
            ...point,
            revisionSequence: nextSequence,
            outingId: outing.id,
            recordedAt,
          })),
        ],
      }
      save()
      return updated
    },
    readMissionReplay: async (input) => buildBrowserReplay(state, input),
    readMissionReplayTrackChunk: async (input) => {
      const replay = await buildBrowserReplay(state, input)
      return {
        missionId: replay.missionId,
        selectedTime: replay.selectedTime,
        tracks: replay.tracks,
        trackCursor: replay.trackCursor,
        previousCursor: replay.previousCursor,
        totalTrackCount: replay.totalTrackCount,
        nextCursor: replay.nextCursor,
        progress: replay.progress,
      }
    },
    readMissionReplayObjectChunk: async (input) => {
      const replay = await buildBrowserReplay(state, input)
      return {
        missionId: replay.missionId,
        selectedTime: replay.selectedTime,
        objects: replay.objects,
        totalObjectCount: replay.totalObjectCount,
        objectCursor: replay.objectCursor,
        nextObjectCursor: replay.nextObjectCursor,
        progress: 1,
        summarizedObjectCount: 0,
      }
    },
    readMissionReplayFilterPage: async (input) =>
      buildBrowserReplayFilterPage(state, input),
    cancelMissionReplay: async () => true,
    listSearchAreas: async (missionId) => {
      const normalizedMissionId = normalizeBrowserSearchText(
        missionId, 'Search area mission', MAX_SEARCH_OPERATION_ID_LENGTH,
      )
      return state.searchAreas.filter(
        (area) => area.mission_id === normalizedMissionId && area.retired_at === null,
      )
    },
    listSearchAssignments: async (missionId) => {
      const normalizedMissionId = normalizeBrowserSearchText(
        missionId, 'Search assignment mission', MAX_SEARCH_OPERATION_ID_LENGTH,
      )
      return state.searchAssignments.filter(
        (assignment) => assignment.mission_id === normalizedMissionId
          && assignment.retired_at === null,
      )
    },
    listSearchPasses: async (missionId) => {
      const normalizedMissionId = normalizeBrowserSearchText(
        missionId, 'Search pass mission', MAX_SEARCH_OPERATION_ID_LENGTH,
      )
      return state.searchPasses.filter((pass) => pass.mission_id === normalizedMissionId)
    },
    listSearchOperationPage: async (input) =>
      buildBrowserSearchOperationPage(state, input),
    upsertSearchAssignment: async (input) => {
      const assignmentId = normalizeBrowserOptionalSearchIdentity(
        input.id, 'Search assignment identity',
      )
      const missionId = normalizeBrowserSearchText(
        input.mission_id,
        'Search assignment mission',
        MAX_SEARCH_OPERATION_ID_LENGTH,
      )
      const areaId = normalizeBrowserSearchText(
        input.search_area_id,
        'Search assignment area',
        MAX_SEARCH_OPERATION_ID_LENGTH,
      )
      const outingId = normalizeBrowserSearchText(
        input.outing_id,
        'Search assignment outing',
        MAX_SEARCH_OPERATION_ID_LENGTH,
      )
      const teamId = normalizeBrowserSearchText(
        input.team_id,
        'Search assignment team',
        MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
      )
      const participantIds = normalizeBrowserIds(
        input.participant_ids,
        'Search assignment participant links',
      )
      const notes = normalizeBrowserOptionalSearchText(
        input.notes,
        'Search assignment notes',
        MAX_SEARCH_OPERATION_NOTES_LENGTH,
      )
      const updatedBy = normalizeBrowserOptionalSearchText(
        input.updated_by,
        'Search assignment coordinator',
        MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
      )
      normalizeBrowserOptionalSearchTimestamp(
        input.effective_at, 'Search assignment effective time',
      )
      ensureMissionMutable(missionId, state.missions)
      const area = state.searchAreas.find((entry) => entry.id === areaId)
      if (area?.mission_id !== missionId || area.retired_at !== null || area.status === 'retired') {
        throw new Error('Search assignment requires an active search area in this mission.')
      }
      const outing = state.outings.find((entry) => entry.id === outingId)
      if (outing?.mission_id !== missionId) {
        throw new Error('Search assignment requires an outing in this mission.')
      }
      const existing = assignmentId === null
        ? null
        : state.searchAssignments.find((entry) => entry.id === assignmentId) ?? null
      if (
        existing !== null
        && (existing.search_area_id !== area.id || existing.outing_id !== outing.id)
        && state.searchPasses.some((pass) => pass.assignment_id === existing.id)
      ) {
        throw new Error(
          `Cannot change search assignment scope ${existing.id} after a recorded search pass; create a new assignment.`,
        )
      }
      const timestamp = new Date().toISOString()
      const assignment: SearchAssignment = {
        id: existing?.id ?? assignmentId ?? createId('search-assignment'),
        mission_id: missionId,
        search_area_id: areaId,
        outing_id: outingId,
        team_id: teamId,
        participant_ids_json: JSON.stringify(participantIds),
        notes,
        version_sequence: (existing?.version_sequence ?? 0) + 1,
        updated_by: updatedBy,
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
        retired_at: null,
      }
      state = { ...state, searchAssignments: upsertByStableId(state.searchAssignments, assignment) }
      save()
      return assignment
    },
    upsertSearchPass: async (input) => {
      const passId = normalizeBrowserOptionalSearchIdentity(input.id, 'Search pass identity')
      const missionId = normalizeBrowserSearchText(
        input.mission_id,
        'Search pass mission',
        MAX_SEARCH_OPERATION_ID_LENGTH,
      )
      const areaId = normalizeBrowserSearchText(
        input.search_area_id,
        'Search pass area',
        MAX_SEARCH_OPERATION_ID_LENGTH,
      )
      const assignmentId = normalizeBrowserSearchText(
        input.assignment_id,
        'Search pass assignment',
        MAX_SEARCH_OPERATION_ID_LENGTH,
      )
      const outcome = normalizeBrowserSearchPassOutcome(input.outcome)
      const startedAt = normalizeHarnessSearchPassBoundary(input.started_at, 'start')
      const endedAt = input.ended_at == null
        ? null
        : normalizeHarnessSearchPassBoundary(input.ended_at, 'end')
      const notes = normalizeBrowserOptionalSearchText(
        input.notes,
        'Search pass notes',
        MAX_SEARCH_OPERATION_NOTES_LENGTH,
      )
      const coordinatorName = normalizeBrowserSearchText(
        input.coordinator_name,
        'Search pass coordinator',
        MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
      )
      const advisoryCoverage = input.advisory_coverage_json == null
        ? undefined
        : normalizeBrowserOptionalJsonText(
          input.advisory_coverage_json,
          'Search pass advisory coverage',
          MAX_SEARCH_ADVISORY_COVERAGE_LENGTH,
        )
      const participantIds = normalizeBrowserOptionalIds(
        input.participant_ids, 'Search pass participant links',
      )
      const clueIds = normalizeBrowserOptionalIds(input.clue_ids, 'Search pass clue links')
      const trackEvidenceIds = normalizeBrowserOptionalIds(
        input.track_evidence_ids, 'Search pass track links',
      )
      ensureMissionMutable(missionId, state.missions)
      const mission = requireMission(missionId, state.missions)
      const area = state.searchAreas.find((entry) => entry.id === areaId)
      const assignment = state.searchAssignments.find((entry) => entry.id === assignmentId)
      if (area?.mission_id !== missionId || area.retired_at !== null || area.status === 'retired') {
        throw new Error('Search pass requires an active search area in this mission.')
      }
      if (assignment?.mission_id !== missionId || assignment.search_area_id !== area.id
        || assignment.retired_at !== null) {
        throw new Error('Search pass requires an active matching assignment.')
      }
      const outing = state.outings.find((entry) => entry.id === assignment.outing_id)
      if (outing?.mission_id !== missionId) {
        throw new Error('Search pass assignment outing is not in this mission.')
      }
      const existing = passId === null
        ? null
        : state.searchPasses.find((entry) => entry.id === passId) ?? null
      const timestamp = new Date().toISOString()
      if (endedAt !== null && endedAt < startedAt) {
        throw new Error('Search pass end time cannot precede its start time.')
      }
      assertHarnessSearchPassWindow({ mission, outing, startedAt, endedAt, currentTime: timestamp })
      if (endedAt === null) {
        throw new Error('A coordinator-declared search pass outcome requires an explicit pass end time.')
      }
      const pass: SearchPass = {
        id: existing?.id ?? passId ?? createId('search-pass'),
        mission_id: missionId,
        search_area_id: areaId,
        assignment_id: assignmentId,
        started_at: startedAt,
        ended_at: endedAt,
        outcome,
        notes,
        coordinator_name: coordinatorName,
        advisory_coverage_json: advisoryCoverage === undefined
          ? existing?.advisory_coverage_json ?? null
          : advisoryCoverage,
        version_sequence: (existing?.version_sequence ?? 0) + 1,
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
        participant_ids: participantIds ?? existing?.participant_ids ?? [],
        clue_ids: clueIds ?? existing?.clue_ids ?? [],
        track_evidence_ids: trackEvidenceIds ?? existing?.track_evidence_ids ?? [],
      }
      state = { ...state, searchPasses: upsertByStableId(state.searchPasses, pass) }
      save()
      return pass
    },
  }

  return browserHarnessStore as BrowserHarnessStore
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
    received_at: new Date().toISOString(),
    timestamp_source: input.timestamp_source ?? null,
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

type BrowserGpxProjectionCursor = Pick<GpxTrackImport, 'display_name' | 'imported_at' | 'id'>

/** Removes retained GPX source bytes from the renderer projection boundary. */
function stripBrowserGpxRetainedBytes(entry: GpxTrackImport): GpxTrackImport {
  const { source_bytes_base64: retainedBytes, ...projection } = entry
  void retainedBytes
  return projection
}

/** Orders browser-validation GPX projections by the same stable fields encoded in its cursor. */
function compareBrowserGpxProjectionOrder(
  left: BrowserGpxProjectionCursor,
  right: BrowserGpxProjectionCursor,
): number {
  return left.display_name.localeCompare(right.display_name)
    || left.imported_at.localeCompare(right.imported_at)
    || left.id.localeCompare(right.id)
}

/** Encodes one opaque browser-validation GPX keyset cursor with its mission context. */
function encodeBrowserGpxProjectionCursor(
  missionId: string,
  entry: BrowserGpxProjectionCursor,
): string {
  return encodeURIComponent(JSON.stringify({
    v: 2,
    kind: 'imports',
    contextId: missionId,
    displayName: entry.display_name,
    importedAt: entry.imported_at,
    id: entry.id,
  }))
}

/** Decodes one bounded browser-validation GPX keyset cursor. */
function decodeBrowserGpxProjectionCursor(
  value: string | undefined,
  expectedMissionId: string,
): BrowserGpxProjectionCursor | null {
  if (value === undefined) return null
  if (value.length < 1 || value.length > 4_000) {
    throw new Error('Browser GPX projection cursor is invalid.')
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Readonly<Record<string, unknown>>
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
      || parsed.v !== 2 || parsed.kind !== 'imports'
      || parsed.contextId !== expectedMissionId
      || !isBoundedBrowserGpxCursorText(parsed.displayName, true)
      || !isBoundedBrowserGpxCursorText(parsed.importedAt, false, 100)
      || !isBoundedBrowserGpxCursorText(parsed.id, false)) {
      throw new Error('invalid shape')
    }
    return {
      display_name: parsed.displayName,
      imported_at: parsed.importedAt,
      id: parsed.id,
    }
  } catch {
    throw new Error('Browser GPX projection cursor is invalid.')
  }
}

/** Normalizes the mission identity bound into a browser GPX cursor. */
function normalizeBrowserGpxProjectionContext(value: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 1_000) {
    throw new Error('Browser GPX projection mission identifier is invalid.')
  }
  return value.trim()
}

/** Checks decoded browser cursor text before using it as a keyset boundary. */
function isBoundedBrowserGpxCursorText(
  value: unknown,
  allowEmpty: boolean,
  maximumLength = 1_000,
): value is string {
  return typeof value === 'string'
    && value.length <= maximumLength
    && (allowEmpty || value.length > 0)
}

/** Preflights the browser harness with the packaged Replay envelope contract. */
function normalizeBrowserReplayInput(input: MissionReplayReadInput): {
  readonly missionId: string
  readonly selectedTime: string
  readonly timezone: typeof REPLAY_TIMEZONE
} {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Mission replay input is invalid.')
  }
  if (typeof input.missionId !== 'string'
    || input.missionId.length < 1 || input.missionId.length > 200) {
    throw new Error('Mission replay mission ID is invalid.')
  }
  if (typeof input.selectedTime !== 'string'
    || input.selectedTime.length < 1
    || input.selectedTime.length > MAX_REPLAY_SELECTED_TIME_LENGTH
    || input.selectedTime !== input.selectedTime.trim()) {
    throw new Error('Mission replay selected time is invalid.')
  }
  let selectedTime: string
  try {
    selectedTime = normalizeTrackingIsoTimestamp(input.selectedTime, 'Mission replay selected time')
  } catch {
    throw new Error('Mission replay selected time is invalid.')
  }
  const timezone = input.timezone ?? REPLAY_TIMEZONE
  if (timezone !== REPLAY_TIMEZONE) {
    throw new Error('Mission replay timezone is invalid.')
  }
  return { missionId: input.missionId, selectedTime, timezone }
}

/** Returns one bounded searchable Search Operations page with production-shaped projections. */
function buildBrowserSearchOperationPage(
  state: BrowserHarnessState,
  input: {
    readonly missionId: string
    readonly kind: SearchOperationPageKind
    readonly search?: string
    readonly cursor?: string
    readonly limit?: number
  },
): SearchOperationPage {
  const missionId = normalizeBrowserSearchText(
    input.missionId, 'Search Operations page mission', MAX_SEARCH_OPERATION_ID_LENGTH,
  )
  if (!['areas', 'assignments', 'outings', 'passes'].includes(input.kind)) {
    throw new Error('Search Operations page kind is invalid.')
  }
  const search = normalizeBrowserOptionalSearchText(
    input.search ?? '', 'Search Operations page search', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
  ) ?? ''
  const limit = input.limit ?? 25
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Search Operations page limit must be between 1 and 50.')
  }
  const generation = browserSearchOperationGeneration(state, missionId)
  const cursor = decodeBrowserSearchOperationCursor(input.cursor, {
    missionId, kind: input.kind, search, generation,
  })
  const loweredSearch = search.toLocaleLowerCase('en-IE')
  const rows = browserSearchOperationRows(state, missionId, input.kind)
    .filter((row) => row.searchText.toLocaleLowerCase('en-IE').includes(loweredSearch))
    .sort((left, right) => left.orderValue.localeCompare(right.orderValue)
      || left.id.localeCompare(right.id))
  const eligible = cursor === null ? rows : rows.filter((row) =>
    row.orderValue > cursor.orderValue
    || (row.orderValue === cursor.orderValue && row.id > cursor.id))
  const visible = eligible.slice(0, limit)
  const last = visible.at(-1)
  return {
    kind: input.kind,
    search,
    generation,
    entries: visible.map((row) => row.projection),
    totalCount: rows.length,
    nextCursor: eligible.length <= limit || last === undefined
      ? null
      : encodeBrowserBase64Url(JSON.stringify({
          v: 2, missionId, kind: input.kind, search, generation,
          orderValue: last.orderValue, id: last.id,
        })),
  }
}

/** Produces bounded browser projections and deterministic search/order keys. */
function browserSearchOperationRows(
  state: BrowserHarnessState,
  missionId: string,
  kind: SearchOperationPageKind,
): readonly {
  readonly id: string
  readonly orderValue: string
  readonly searchText: string
  readonly projection: SearchOperationPage['entries'][number]
}[] {
  if (kind === 'areas') return state.searchAreas
    .filter((area) => area.mission_id === missionId && area.retired_at === null)
    .map((area) => ({
      id: area.id, orderValue: area.name, searchText: `${area.name} ${area.id}`,
      projection: {
        id: area.id, mission_id: area.mission_id, name: area.name, status: area.status,
        version_sequence: area.version_sequence, updated_by: area.updated_by,
        created_at: area.created_at, updated_at: area.updated_at,
        retired_at: area.retired_at, geometry_available: true,
      },
    }))
  if (kind === 'assignments') return state.searchAssignments
    .filter((assignment) => assignment.mission_id === missionId && assignment.retired_at === null)
    .map((assignment) => ({
      id: assignment.id, orderValue: assignment.created_at,
      searchText: `${assignment.id} ${assignment.team_id} ${assignment.search_area_id} ${assignment.outing_id} ${assignment.updated_by ?? ''}`,
      projection: {
        id: assignment.id, mission_id: assignment.mission_id,
        search_area_id: assignment.search_area_id, outing_id: assignment.outing_id,
        team_id: assignment.team_id, version_sequence: assignment.version_sequence,
        updated_by: assignment.updated_by, created_at: assignment.created_at,
        updated_at: assignment.updated_at, retired_at: assignment.retired_at,
      },
    }))
  if (kind === 'outings') return state.outings
    .filter((outing) => outing.mission_id === missionId)
    .map((outing) => ({
      id: outing.id, orderValue: outing.started_at,
      searchText: `${outing.id} ${outing.label}`, projection: outing,
    }))
  return state.searchPasses.filter((pass) => pass.mission_id === missionId).map((pass) => ({
    id: pass.id, orderValue: pass.started_at,
    searchText: `${pass.id} ${pass.search_area_id} ${pass.assignment_id} ${pass.coordinator_name} ${pass.outcome} ${pass.notes ?? ''}`,
    projection: {
      id: pass.id, mission_id: pass.mission_id, search_area_id: pass.search_area_id,
      assignment_id: pass.assignment_id, started_at: pass.started_at,
      ended_at: pass.ended_at, outcome: pass.outcome,
      coordinator_name: pass.coordinator_name, version_sequence: pass.version_sequence,
      created_at: pass.created_at, updated_at: pass.updated_at,
      participant_count: pass.participant_ids?.length ?? 0,
      clue_count: pass.clue_ids?.length ?? 0,
      track_evidence_count: pass.track_evidence_ids?.length ?? 0,
    },
  }))
}

/** Decodes one browser Search Operations keyset cursor with context binding. */
function decodeBrowserSearchOperationCursor(
  value: string | undefined,
  context: {
    readonly missionId: string
    readonly kind: string
    readonly search: string
    readonly generation: number
  },
): { readonly orderValue: string; readonly id: string } | null {
  if (value === undefined || value === '') return null
  if (typeof value !== 'string' || value.length > 2_000) {
    throw new Error('Search Operations page cursor is invalid.')
  }
  try {
    const parsed = JSON.parse(decodeBrowserBase64Url(value)) as Record<string, unknown>
    if (parsed.v !== 2 || parsed.missionId !== context.missionId
      || parsed.kind !== context.kind || parsed.search !== context.search
      || !Number.isSafeInteger(parsed.generation) || Number(parsed.generation) < 0
      || typeof parsed.orderValue !== 'string' || parsed.orderValue.length > 200
      || typeof parsed.id !== 'string' || parsed.id.length < 1 || parsed.id.length > 200) {
      throw new Error('invalid')
    }
    if (parsed.generation !== context.generation) {
      throw new Error('changed')
    }
    return { orderValue: parsed.orderValue, id: parsed.id }
  } catch (error) {
    if (error instanceof Error && error.message === 'changed') {
      throw new Error('Search Operations page changed; return to the first page.')
    }
    throw new Error('Search Operations page cursor is invalid.')
  }
}

/** Derives a monotonic browser-validation generation for retained Search Operations state. */
function browserSearchOperationGeneration(state: BrowserHarnessState, missionId: string): number {
  const eventCount = state.missionEvents.filter((event) => event.mission_id === missionId).length
  const versionTotal = [...state.searchAreas, ...state.searchAssignments, ...state.searchPasses]
    .filter((entry) => entry.mission_id === missionId)
    .reduce((total, entry) => total + entry.version_sequence, 0)
  return eventCount + versionTotal
}

/** Reads every eligible browser-harness outing identity known at the selected time. */
function readBrowserEligibleReplayOutingIds(
  state: BrowserHarnessState,
  missionId: string,
  selectedTime: string,
): readonly string[] {
  const missionImportIds = new Set(state.gpxImports
    .filter((entry) => entry.mission_id === missionId
      && (entry.retired_at === null || entry.retired_at === undefined
        || entry.retired_at > selectedTime))
    .map((entry) => entry.id))
  const latestRevision = new Map<string, number>()
  for (const point of state.gpxEvidencePoints) {
    if (missionImportIds.has(point.importId) && point.recordedAt <= selectedTime) {
      latestRevision.set(
        point.importId,
        Math.max(latestRevision.get(point.importId) ?? 0, point.revisionSequence),
      )
    }
  }
  return [...new Set(state.gpxEvidencePoints
    .filter((point) => missionImportIds.has(point.importId)
      && point.revisionSequence === latestRevision.get(point.importId)
      && point.recordedAt <= selectedTime && point.outingId != null)
    .map((point) => point.outingId as string))].sort()
}

/** Reads one bounded searchable Replay outing-choice page in browser validation. */
function buildBrowserReplayFilterPage(
  state: BrowserHarnessState,
  input: MissionReplayReadInput & {
    readonly filterKind: 'outing'
    readonly filterSearch?: string
    readonly filterCursor?: string
    readonly filterLimit?: number
  },
): MissionReplayFilterPage {
  const envelope = normalizeBrowserReplayInput(input)
  if (input.filterKind !== 'outing') throw new Error('Mission replay filter kind is invalid.')
  const search = normalizeBrowserOptionalSearchText(
    input.filterSearch ?? '', 'Mission replay filter search', 120,
  ) ?? ''
  const limit = input.filterLimit ?? MAX_REPLAY_FILTER_PAGE_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REPLAY_FILTER_PAGE_LIMIT) {
    throw new Error('Mission replay filter page limit must be between 1 and 100.')
  }
  const allEntries = readBrowserEligibleReplayOutingIds(
    state, envelope.missionId, envelope.selectedTime,
  ).filter((outingId) => outingId.toLocaleLowerCase('en-IE')
    .includes(search.toLocaleLowerCase('en-IE')))
  const cursor = decodeBrowserReplayFilterCursor(input.filterCursor, {
    missionId: envelope.missionId,
    selectedTime: envelope.selectedTime,
    search,
  })
  const eligible = cursor === null
    ? allEntries
    : allEntries.filter((outingId) => outingId > cursor.lastId)
  const entries = eligible.slice(0, limit)
  const lastId = entries.at(-1)
  return {
    filterKind: 'outing', search, entries, totalCount: allEntries.length,
    nextCursor: eligible.length <= limit || lastId === undefined
      ? null
      : encodeBrowserBase64Url(JSON.stringify({
          v: 1, missionId: envelope.missionId, selectedTime: envelope.selectedTime,
          filterKind: 'outing', search, lastId,
        })),
  }
}

/** Decodes one context-bound browser Replay filter cursor. */
function decodeBrowserReplayFilterCursor(
  value: string | undefined,
  context: { readonly missionId: string; readonly selectedTime: string; readonly search: string },
): { readonly lastId: string } | null {
  if (value === undefined || value === '') return null
  if (typeof value !== 'string' || value.length > 2_000) {
    throw new Error('Mission replay filter cursor is invalid.')
  }
  try {
    const parsed = JSON.parse(decodeBrowserBase64Url(value)) as Record<string, unknown>
    if (parsed.v !== 1 || parsed.missionId !== context.missionId
      || parsed.selectedTime !== context.selectedTime || parsed.filterKind !== 'outing'
      || parsed.search !== context.search || typeof parsed.lastId !== 'string'
      || parsed.lastId.length < 1 || parsed.lastId.length > 200) throw new Error('invalid')
    return { lastId: parsed.lastId }
  } catch {
    throw new Error('Mission replay filter cursor is invalid.')
  }
}

/** Uses the production replay port with explicit harness completeness limits. */
async function buildBrowserReplay(
  state: BrowserHarnessState,
  input: MissionReplayReadInput,
): Promise<MissionReplayReadResult> {
  const envelope = normalizeBrowserReplayInput(input)
  if (Date.parse(envelope.selectedTime) > Date.now()) {
    throw new Error('Mission replay selected time cannot be in the future.')
  }
  const { missionId, selectedTime, timezone } = envelope
  if (!Number.isInteger(input.trackLimit) || input.trackLimit < 1
    || input.trackLimit > MAX_REPLAY_TRACK_LIMIT) {
    throw new Error(`Mission replay track limit must be between 1 and ${MAX_REPLAY_TRACK_LIMIT}.`)
  }
  const objectLimit = input.objectLimit ?? MAX_REPLAY_OBJECT_LIMIT
  if (!Number.isInteger(objectLimit) || objectLimit < 1 || objectLimit > MAX_REPLAY_OBJECT_LIMIT) {
    throw new Error(`Mission replay object limit must be between 1 and ${MAX_REPLAY_OBJECT_LIMIT}.`)
  }
  const deviceFilterIds = normalizeBrowserReplayFilterIds(input.deviceIds, 'device')
  const outingFilterIds = normalizeBrowserReplayFilterIds(input.outingIds, 'outing')
  const cursor = decodeBrowserReplayTrackCursor(input.cursor)
  const offset = cursor?.direction === 'before'
    ? Math.max(0, cursor.offset - input.trackLimit)
    : cursor?.offset ?? 0
  const objectCursor = decodeBrowserReplayObjectCursor(input.objectCursor)
  const objectOffset = objectCursor?.offset ?? 0
  const positionTracks = state.positions
    .filter((position) =>
      position.mission_id === missionId
      && position.timestamp_source === 'fix'
      && position.received_at != null
      && position.received_at <= selectedTime
      && position.timestamp <= selectedTime
      && (deviceFilterIds === null || deviceFilterIds.includes(position.device_id)),
    )
    .map((position) => ({
      evidence_id: position.source_position_id ?? position.id,
      source_type: 'traccar_fix' as const,
      track_id: position.device_id,
      effective_at: position.timestamp,
      recorded_at: position.received_at!,
      lat: position.lat,
      lon: position.lon,
      elevation: position.altitude,
      accuracy: position.accuracy,
      time_authority: 'fixTime' as const,
      completeness: 'complete' as const,
      sourceOrder: 0 as const,
      stableOrder: position.id,
    }))
  if (cursor !== null && (cursor.replayGeneration !== (input.replayGeneration ?? 0)
    || cursor.eligiblePositionCount !== positionTracks.length)) {
    throw new Error('Mission replay evidence changed while paging. Re-seek the selected time.')
  }
  const missionImportIds = new Set(state.gpxImports
    .filter((entry) => entry.mission_id === missionId
      && (entry.retired_at === null
        || entry.retired_at === undefined
        || entry.retired_at > selectedTime))
    .map((entry) => entry.id))
  const eligibleRevisionByImport = new Map<string, number>()
  for (const point of state.gpxEvidencePoints) {
    if (missionImportIds.has(point.importId) && point.recordedAt <= selectedTime) {
      eligibleRevisionByImport.set(
        point.importId,
        Math.max(eligibleRevisionByImport.get(point.importId) ?? 0, point.revisionSequence),
      )
    }
  }
  const eligibleGpxPoints = state.gpxEvidencePoints.filter((point) =>
    missionImportIds.has(point.importId)
    && point.revisionSequence === eligibleRevisionByImport.get(point.importId)
    && point.recordedAt <= selectedTime,
  )
  const eligibleOutingByImport = new Map<string, string | null>()
  for (const point of eligibleGpxPoints) {
    eligibleOutingByImport.set(point.importId, point.outingId ?? null)
  }
  /** Mirrors the production display-only outing filter inside browser validation. */
  const isSelectedGpxImport = (importId: string) => {
    const outingId = eligibleOutingByImport.get(importId) ?? null
    return outingFilterIds === null || (outingId !== null && outingFilterIds.includes(outingId))
  }
  const gpxTracks = eligibleGpxPoints
    .filter((point) => {
      return point.timestamp !== null && point.timestamp <= selectedTime
        && isSelectedGpxImport(point.importId)
    })
    .map((point) => ({
      evidence_id: `${point.importId}:${point.revisionSequence}:${point.segmentIndex}:${point.pointIndex}`,
      source_type: 'gpx_point' as const,
      track_id: point.importId,
      effective_at: point.timestamp!,
      recorded_at: point.recordedAt,
      lat: point.lat,
      lon: point.lon,
      elevation: point.elevation,
      accuracy: null,
      time_authority: 'gpx_source_time' as const,
      completeness: 'complete' as const,
      sourceOrder: 1 as const,
      stableOrder: `${point.importId}:${String(point.segmentIndex).padStart(8, '0')}:${String(point.pointIndex).padStart(8, '0')}`,
    }))
  const allTracks = [...positionTracks, ...gpxTracks].sort((left, right) =>
    left.effective_at.localeCompare(right.effective_at)
    || left.recorded_at.localeCompare(right.recorded_at)
    || left.sourceOrder - right.sourceOrder
    || left.stableOrder.localeCompare(right.stableOrder)
    || left.evidence_id.localeCompare(right.evidence_id),
  )
  const normalizedReplayContext = {
    missionId,
    selectedTime,
    deviceIds: deviceFilterIds,
    outingIds: outingFilterIds,
    timezone,
    replayGeneration: input.replayGeneration ?? 0,
  }
  if (cursor !== null && cursor.eligibleTrackCount !== allTracks.length) {
    throw new Error('Mission replay evidence changed while paging. Re-seek the selected time.')
  }
  const trackContextHash = await browserReplayCursorContextHash(
    'track', normalizedReplayContext, allTracks.length,
  )
  if (cursor !== null && cursor.contextHash !== trackContextHash) {
    throw new Error('Mission replay cursor context does not match this request.')
  }
  if (objectCursor !== null && (objectCursor.replayGeneration
    !== normalizedReplayContext.replayGeneration || objectCursor.eligibleObjectCount !== 0)) {
    throw new Error('Mission replay evidence changed while paging. Re-seek the selected time.')
  }
  const objectContextHash = objectCursor === null ? null : await browserReplayCursorContextHash(
    'object', normalizedReplayContext, 0,
  )
  if (objectCursor !== null && objectCursor.contextHash !== objectContextHash) {
    throw new Error('Mission replay object cursor context does not match this request.')
  }
  const pageTracks = allTracks.slice(offset, offset + input.trackLimit)
  const tracks = pageTracks.map(projectBrowserReplayTrack)
  const nextOffset = offset + pageTracks.length
  const eligiblePositionCount = positionTracks.length
  const staticGpxPointCount = eligibleGpxPoints.filter((point) =>
    point.timestamp === null && isSelectedGpxImport(point.importId)).length
  const staticGpxEvidence = state.gpxImports
    .filter((entry) => missionImportIds.has(entry.id)
      && (outingFilterIds === null
        || isSelectedGpxImport(entry.id)))
    .flatMap((entry) => {
      const revisionSequence = eligibleRevisionByImport.get(entry.id)
      if (revisionSequence === undefined) return []
      const staticPoints = eligibleGpxPoints.filter((point) =>
        point.importId === entry.id
        && point.revisionSequence === revisionSequence
        && point.timestamp === null)
      const firstStaticPoint = staticPoints[0]
      if (firstStaticPoint === undefined) return []
      return [{
        import_id: entry.id,
        revision_sequence: revisionSequence,
        source_path: entry.source_path,
        file_name: entry.file_name,
        display_name: entry.display_name,
        content_sha256: entry.content_sha256 ?? null,
        timing_class: entry.timing_class ?? 'undated' as const,
        outing_id: eligibleOutingByImport.get(entry.id) ?? null,
        completeness: entry.content_sha256 == null ? 'legacy_baseline' as const : 'complete' as const,
        recorded_at: firstStaticPoint.recordedAt,
        static_point_count: staticPoints.length,
        rejection_count: 0,
      }]
    })
  const allAvailableOutingIds = readBrowserEligibleReplayOutingIds(
    state, missionId, selectedTime,
  )
  const availableOutingIds = allAvailableOutingIds.slice(0, MAX_REPLAY_FILTER_PAGE_LIMIT)
  const availableOutingNextCursor = allAvailableOutingIds.length <= availableOutingIds.length
    ? null
    : encodeBrowserBase64Url(JSON.stringify({
        v: 1, missionId, selectedTime, filterKind: 'outing', search: '',
        lastId: availableOutingIds.at(-1),
      }))
  return {
    missionId,
    selectedTime,
    timezone,
    objects: [],
    totalObjectCount: 0,
    objectTypeCounts: {},
    objectCursor: String(objectOffset),
    nextObjectCursor: null,
    missionLifecycle: readBrowserReplayLifecycle(state.missionEvents, missionId, selectedTime),
    tracks,
    trackCursor: String(offset),
    previousCursor: offset === 0 || pageTracks.length === 0 ? null : encodeBrowserReplayTrackCursor(
      'before', offset, pageTracks[0]!, normalizedReplayContext,
      eligiblePositionCount, allTracks.length, trackContextHash,
    ),
    totalTrackCount: allTracks.length,
    staticGpxPointCount,
    availableDeviceIds: [...new Set(state.positions
      .filter((position) => position.mission_id === missionId
        && position.timestamp_source === 'fix'
        && position.received_at != null
        && position.timestamp <= selectedTime
        && position.received_at <= selectedTime)
      .map((position) => position.device_id))].sort(),
    availableOutingIds,
    availableOutingTotalCount: allAvailableOutingIds.length,
    availableOutingNextCursor,
    deviceFilterIds: deviceFilterIds ?? [],
    outingFilterIds: outingFilterIds ?? [],
    staticGpxEvidence,
    nextCursor: nextOffset < allTracks.length && pageTracks.length > 0
      ? encodeBrowserReplayTrackCursor(
          'after', nextOffset, pageTracks.at(-1)!, normalizedReplayContext,
          eligiblePositionCount, allTracks.length, trackContextHash,
        )
      : null,
    progress: allTracks.length === 0 ? 1 : nextOffset / allTracks.length,
    limitations: [
      {
        code: 'browser_harness_version_history_unavailable',
        message: 'Browser validation cannot claim historical mutable-object versions from operational SQLite.',
      },
      ...(staticGpxPointCount === 0 ? [] : [{
        code: 'undated_gpx_static',
        message: 'Undated GPX points remain static and are excluded from precise replay placement.',
        count: staticGpxPointCount,
      }]),
      ...(availableOutingNextCursor === null ? [] : [{
        code: 'outing_filter_choices_paged',
        message: 'Additional eligible GPX outings are available through bounded filter-choice pages.',
        count: allAvailableOutingIds.length - availableOutingIds.length,
      }]),
    ],
  }
}

/** Reconstructs the browser-validation lifecycle state while retaining its transition evidence. */
function readBrowserReplayLifecycle(
  events: readonly MissionEvent[],
  missionId: string,
  selectedTime: string,
): Exclude<MissionReplayReadResult['missionLifecycle'], undefined> {
  const lifecycleEvents = new Set([
    'mission_created',
    'mission_paused',
    'mission_resumed',
    'mission_finished',
    'mission_finalized',
    'mission_unlocked',
  ])
  const latest = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.mission_id === missionId
      && lifecycleEvents.has(event.event_type)
      && event.timestamp <= selectedTime)
    .sort((left, right) => right.event.timestamp.localeCompare(left.event.timestamp)
      || right.index - left.index)[0]?.event

  return latest === undefined
    ? null
    : { ...latest, state: browserReplayLifecycleStateFromEventType(latest.event_type) }
}

/** Mirrors the packaged replay transition-to-state contract for browser UI conformance. */
function browserReplayLifecycleStateFromEventType(
  eventType: string,
): NonNullable<MissionReplayReadResult['missionLifecycle']>['state'] {
  switch (eventType) {
    case 'mission_created':
    case 'mission_resumed':
      return 'active'
    case 'mission_paused':
      return 'paused'
    case 'mission_finished':
    case 'mission_unlocked':
      return 'finished'
    case 'mission_finalized':
      return 'finalized'
    default:
      return 'unknown'
  }
}

type BrowserReplayOrderRow = {
  readonly effective_at: string
  readonly recorded_at: string
  readonly sourceOrder: 0 | 1
  readonly stableOrder: string
}

function projectBrowserReplayTrack(
  row: MissionReplayReadResult['tracks'][number] & BrowserReplayOrderRow,
): MissionReplayReadResult['tracks'][number] {
  return {
    evidence_id: row.evidence_id,
    source_type: row.source_type,
    track_id: row.track_id,
    effective_at: row.effective_at,
    recorded_at: row.recorded_at,
    lat: row.lat,
    lon: row.lon,
    elevation: row.elevation,
    accuracy: row.accuracy,
    time_authority: row.time_authority,
    completeness: row.completeness,
  }
}

type BrowserReplayCursorContext = {
  readonly missionId: string
  readonly selectedTime: string
  readonly deviceIds: readonly string[] | null
  readonly outingIds: readonly string[] | null
  readonly timezone: string
  readonly replayGeneration: number
}

/** Encodes the same opaque v4 replay-cursor envelope used by packaged Electron. */
function encodeBrowserReplayTrackCursor(
  direction: 'after' | 'before',
  offset: number,
  row: BrowserReplayOrderRow,
  context: BrowserReplayCursorContext,
  eligiblePositionCount: number,
  eligibleTrackCount: number,
  contextHash: string,
): string {
  return encodeBrowserBase64Url(JSON.stringify({
    v: 4,
    kind: 'track',
    direction,
    offset,
    replayGeneration: context.replayGeneration,
    eligiblePositionCount,
    eligibleTrackCount,
    contextHash,
    key: [row.effective_at, row.recorded_at, row.sourceOrder, row.stableOrder],
  }))
}

/** Decodes and validates one production-compatible browser replay cursor. */
function decodeBrowserReplayTrackCursor(value: string | null | undefined): {
  readonly direction: 'after' | 'before'
  readonly offset: number
  readonly replayGeneration: number
  readonly eligiblePositionCount: number
  readonly eligibleTrackCount: number
  readonly contextHash: string
  readonly key: readonly [string, string, 0 | 1, string]
} | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 2_000 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Mission replay cursor is invalid.')
  }
  try {
    const parsed = JSON.parse(decodeBrowserBase64Url(value)) as Record<string, unknown>
    const key = parsed.key
    if (parsed.v !== 4 || parsed.kind !== 'track'
      || (parsed.direction !== 'after' && parsed.direction !== 'before')
      || !Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 0
      || Number(parsed.offset) > MAX_REPLAY_CURSOR_OFFSET || !Array.isArray(key)
      || key.length !== 4 || typeof key[0] !== 'string' || typeof key[1] !== 'string'
      || (key[2] !== 0 && key[2] !== 1) || typeof key[3] !== 'string'
      || !Number.isSafeInteger(parsed.replayGeneration) || Number(parsed.replayGeneration) < 0
      || !Number.isSafeInteger(parsed.eligiblePositionCount)
      || Number(parsed.eligiblePositionCount) < 0
      || !Number.isSafeInteger(parsed.eligibleTrackCount)
      || Number(parsed.eligibleTrackCount) < 0
      || typeof parsed.contextHash !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed.contextHash)) {
      throw new Error('invalid shape')
    }
    return {
      direction: parsed.direction,
      offset: Number(parsed.offset),
      replayGeneration: Number(parsed.replayGeneration),
      eligiblePositionCount: Number(parsed.eligiblePositionCount),
      eligibleTrackCount: Number(parsed.eligibleTrackCount),
      contextHash: parsed.contextHash,
      key: [String(key[0]), String(key[1]), key[2], String(key[3])],
    }
  } catch {
    throw new Error('Mission replay cursor is invalid.')
  }
}

function decodeBrowserReplayObjectCursor(value: string | null | undefined): {
  readonly offset: number
  readonly replayGeneration: number
  readonly eligibleObjectCount: number
  readonly contextHash: string
} | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 2_000 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Mission replay object cursor is invalid.')
  }
  try {
    const parsed = JSON.parse(decodeBrowserBase64Url(value)) as Record<string, unknown>
    if (parsed.v !== 4 || parsed.kind !== 'object'
      || !Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 0
      || Number(parsed.offset) > MAX_REPLAY_CURSOR_OFFSET
      || !Number.isSafeInteger(parsed.replayGeneration) || Number(parsed.replayGeneration) < 0
      || !Number.isSafeInteger(parsed.eligibleObjectCount)
      || Number(parsed.eligibleObjectCount) < 0
      || typeof parsed.contextHash !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed.contextHash)) {
      throw new Error('invalid shape')
    }
    return {
      offset: Number(parsed.offset),
      replayGeneration: Number(parsed.replayGeneration),
      eligibleObjectCount: Number(parsed.eligibleObjectCount),
      contextHash: parsed.contextHash,
    }
  } catch {
    throw new Error('Mission replay object cursor is invalid.')
  }
}

/** Hashes normalized Replay context into the fixed-size token used by both adapters. */
async function browserReplayCursorContextHash(
  kind: 'track' | 'object',
  context: BrowserReplayCursorContext,
  eligibleSnapshotCount: number,
): Promise<string> {
  const payload = new TextEncoder().encode(JSON.stringify({
    kind,
    missionId: context.missionId,
    selectedTime: context.selectedTime,
    deviceIds: context.deviceIds,
    outingIds: context.outingIds,
    timezone: context.timezone,
    replayGeneration: context.replayGeneration,
    eligibleSnapshotCount,
  }))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', payload)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function normalizeBrowserReplayFilterIds(
  value: readonly string[] | undefined,
  label: string,
): readonly string[] | null {
  if (value === undefined) return null
  if (!Array.isArray(value) || value.length > MAX_REPLAY_FILTER_IDS) {
    throw new Error(`Mission replay ${label} filter is invalid.`)
  }
  const normalized = value.map((item) => {
    if (typeof item !== 'string' || item.trim() === '' || item.length > 200) {
      throw new Error(`Mission replay ${label} filter is invalid.`)
    }
    return item.trim()
  })
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right))
}

function encodeBrowserBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function decodeBrowserBase64Url(value: string): string {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(normalized)
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
}

/** Mirrors the packaged marker mutation envelope before browser state work. */
function normalizeBrowserMarkerMutation(input: UpsertMarkerInput): UpsertMarkerInput {
  const markerType = normalizeBrowserEvidenceRequiredText(
    input.type, 'Marker type', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
  )
  if (!['ipp_lkp', 'clue', 'hazard', 'casualty'].includes(markerType)) {
    throw new Error('Marker type is invalid.')
  }
  const lat = normalizeBrowserRequiredFiniteNumber(input.lat, 'Marker latitude')
  const lon = normalizeBrowserRequiredFiniteNumber(input.lon, 'Marker longitude')
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('Marker coordinates are invalid.')
  }
  return {
    id: normalizeBrowserOptionalEvidenceIdentity(input.id, 'Marker identity'),
    mission_id: normalizeBrowserEvidenceRequiredText(
      input.mission_id, 'Marker mission', MAX_SEARCH_OPERATION_ID_LENGTH,
    ),
    type: markerType as UpsertMarkerInput['type'],
    name: normalizeBrowserEvidenceRequiredText(
      input.name, 'Marker name', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    description: normalizeBrowserEvidenceOptionalText(
      input.description, 'Marker description', MAX_SEARCH_OPERATION_NOTES_LENGTH,
    ),
    lat,
    lon,
    irish_grid_e: normalizeBrowserRequiredSafeInteger(input.irish_grid_e, 'Marker ITM easting'),
    irish_grid_n: normalizeBrowserRequiredSafeInteger(input.irish_grid_n, 'Marker ITM northing'),
    display_order: normalizeBrowserRequiredSafeInteger(
      input.display_order, 'Marker display order',
    ),
    subject_category: normalizeBrowserMarkerShortText(input.subject_category, 'subject category'),
    clue_type: normalizeBrowserMarkerShortText(input.clue_type, 'clue type'),
    confidence: normalizeBrowserOptionalFiniteNumber(input.confidence, 'Marker confidence'),
    found_by: normalizeBrowserMarkerShortText(input.found_by, 'found by'),
    hazard_type: normalizeBrowserMarkerShortText(input.hazard_type, 'hazard type'),
    severity: normalizeBrowserMarkerShortText(input.severity, 'severity'),
    condition: normalizeBrowserMarkerShortText(input.condition, 'condition'),
    treatment: normalizeBrowserEvidenceOptionalText(
      input.treatment, 'Marker treatment', MAX_MARKER_TREATMENT_LOG_BYTES,
    ),
    evacuation_priority: normalizeBrowserMarkerShortText(
      input.evacuation_priority, 'evacuation priority',
    ),
    label_size: normalizeBrowserOptionalSafeInteger(input.label_size, 'Marker label size'),
    updated_by: normalizeBrowserMarkerShortText(input.updated_by, 'coordinator'),
    coordinator_ids: normalizeBrowserEvidenceOptionalText(
      input.coordinator_ids, 'Marker coordinator ids', MAX_SEARCH_OPERATION_NOTES_LENGTH,
    ),
    attachment_path: normalizeBrowserEvidenceOptionalText(
      input.attachment_path, 'Marker attachment path', MAX_MUTABLE_EVIDENCE_PATH_LENGTH,
    ),
  }
}

/** Mirrors one optional packaged marker short-text field. */
function normalizeBrowserMarkerShortText(value: unknown, label: string): string | null {
  return normalizeBrowserEvidenceOptionalText(
    value, `Marker ${label}`, MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
  )
}

/** Mirrors the packaged non-search drawing mutation envelope before browser state work. */
function normalizeBrowserDrawingMutation(input: UpsertDrawingInput): UpsertDrawingInput {
  const drawingType = normalizeBrowserEvidenceRequiredText(
    input.type, 'Drawing type', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
  )
  if (!['line', 'range_ring', 'bearing_line', 'search_sector', 'text_label'].includes(drawingType)) {
    throw new Error('Drawing type is invalid.')
  }
  return {
    id: normalizeBrowserOptionalEvidenceIdentity(input.id, 'Drawing identity'),
    mission_id: normalizeBrowserEvidenceRequiredText(
      input.mission_id, 'Drawing mission', MAX_SEARCH_OPERATION_ID_LENGTH,
    ),
    type: drawingType as UpsertDrawingInput['type'],
    name: normalizeBrowserEvidenceRequiredText(
      input.name, 'Drawing name', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    description: normalizeBrowserEvidenceOptionalText(
      input.description, 'Drawing description', MAX_SEARCH_OPERATION_NOTES_LENGTH,
    ),
    color: normalizeBrowserEvidenceOptionalText(
      input.color, 'Drawing colour', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    width: normalizeBrowserOptionalFiniteNumber(input.width, 'Drawing width'),
    distance_m: normalizeBrowserOptionalFiniteNumber(input.distance_m, 'Drawing distance'),
    temporary_measure: normalizeBrowserOptionalBoolean(
      input.temporary_measure, 'Drawing temporary measure',
    ),
    label: normalizeBrowserEvidenceOptionalText(
      input.label, 'Drawing label', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    display_order: normalizeBrowserRequiredSafeInteger(
      input.display_order, 'Drawing display order',
    ),
    geometry_json: normalizeBrowserMutableEvidenceGeometry(input.geometry_json),
    metadata_json: normalizeBrowserOptionalEvidenceJsonText(
      input.metadata_json, 'Drawing metadata', MAX_MUTABLE_EVIDENCE_GEOMETRY_LENGTH,
    ),
  }
}

/** Parses and bounds a non-search drawing coordinate tree without recursive stack growth. */
function normalizeBrowserMutableEvidenceGeometry(value: unknown): string {
  const normalized = normalizeBrowserEvidenceRequiredText(
    value, 'Drawing geometry', MAX_MUTABLE_EVIDENCE_GEOMETRY_LENGTH,
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(normalized)
  } catch {
    throw new Error('Drawing geometry is invalid.')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
    || !('type' in parsed) || typeof parsed.type !== 'string'
    || !('coordinates' in parsed) || !Array.isArray(parsed.coordinates)) {
    throw new Error('Drawing geometry is invalid.')
  }
  const pending: { readonly value: unknown; readonly depth: number }[] = [
    { value: parsed.coordinates, depth: 0 },
  ]
  let coordinateCount = 0
  while (pending.length > 0) {
    const candidate = pending.pop()!
    if (candidate.depth > MAX_MUTABLE_EVIDENCE_NESTING_DEPTH
      || !Array.isArray(candidate.value)) {
      throw new Error('Drawing geometry is invalid.')
    }
    if (candidate.value.length === 0) continue
    if (candidate.value.length >= 2
      && candidate.value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
      const [longitude, latitude] = candidate.value as readonly number[]
      if (latitude! < -90 || latitude! > 90 || longitude! < -180 || longitude! > 180) {
        throw new Error('Drawing geometry is invalid.')
      }
      coordinateCount += 1
      if (coordinateCount > MAX_MUTABLE_EVIDENCE_COORDINATES) {
        throw new Error('Drawing geometry is invalid.')
      }
      continue
    }
    for (const child of candidate.value) {
      if (!Array.isArray(child)) throw new Error('Drawing geometry is invalid.')
      pending.push({ value: child, depth: candidate.depth + 1 })
    }
  }
  return normalized
}

/** Normalizes the complete UI-owned search-area envelope before harness state work. */
function normalizeBrowserSearchAreaDrawing(input: UpsertDrawingInput): UpsertDrawingInput {
  return {
    id: normalizeBrowserOptionalSearchIdentity(input.id, 'Search area identity'),
    mission_id: normalizeBrowserSearchText(
      input.mission_id, 'Search area mission', MAX_SEARCH_OPERATION_ID_LENGTH,
    ),
    type: 'search_area',
    name: normalizeBrowserSearchText(
      input.name, 'Search area name', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    description: normalizeBrowserOptionalSearchText(
      input.description, 'Search area description', MAX_SEARCH_OPERATION_NOTES_LENGTH,
    ),
    color: normalizeBrowserOptionalSearchText(
      input.color, 'Search area colour', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    width: normalizeBrowserOptionalFiniteNumber(input.width, 'Search area width'),
    distance_m: normalizeBrowserOptionalFiniteNumber(
      input.distance_m, 'Search area distance',
    ),
    temporary_measure: normalizeBrowserOptionalBoolean(
      input.temporary_measure, 'Search area temporary-measure flag',
    ),
    label: normalizeBrowserOptionalSearchText(
      input.label, 'Search area label', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    display_order: normalizeBrowserSearchDisplayOrder(input.display_order),
    geometry_json: normalizeBrowserSearchAreaGeometry(input.geometry_json),
    metadata_json: normalizeBrowserOptionalJsonText(
      input.metadata_json,
      'Search area metadata',
      MAX_SEARCH_AREA_GEOMETRY_LENGTH,
    ),
  }
}

/** Retains a unique bounded list of explicit harness evidence identities. */
function normalizeBrowserIds(value: unknown, label: string): readonly string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`)
  if (value.length > MAX_SEARCH_OPERATION_LINK_COUNT) {
    throw new Error(`${label} may contain at most ${MAX_SEARCH_OPERATION_LINK_COUNT} identities.`)
  }
  return [...new Set(value.map((entry) => normalizeBrowserSearchText(
    entry,
    label,
    MAX_SEARCH_OPERATION_ID_LENGTH,
  )))].sort()
}

function normalizeBrowserOptionalIds(
  value: unknown,
  label: string,
): readonly string[] | undefined {
  if (value === undefined || value === null) return undefined
  return normalizeBrowserIds(value, label)
}

/** Normalizes one required bounded Search Operations string. */
function normalizeBrowserSearchText(value: unknown, label: string, maximumLength: number): string {
  if (value === undefined || value === null) throw new Error(`${label} is required.`)
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  if (value.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer.`)
  }
  const normalized = value.trim()
  if (normalized === '') throw new Error(`${label} is required.`)
  if (normalized.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer.`)
  }
  return normalized
}

/** Normalizes one optional bounded Search Operations string. */
function normalizeBrowserOptionalSearchText(
  value: unknown,
  label: string,
  maximumLength: number,
): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  if (value.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer.`)
  }
  const normalized = value.trim()
  if (normalized === '') return null
  if (normalized.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer.`)
  }
  return normalized
}

function normalizeBrowserOptionalSearchIdentity(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return normalizeBrowserSearchText(value, label, MAX_SEARCH_OPERATION_ID_LENGTH)
}

/** Requires one browser evidence string inside the packaged UTF-8 byte envelope. */
function normalizeBrowserEvidenceRequiredText(
  value: unknown,
  label: string,
  maximumBytes: number,
): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  const normalized = value.trim()
  if (normalized === '') throw new Error(`${label} is required.`)
  if (new TextEncoder().encode(normalized).byteLength > maximumBytes) {
    throw new Error(`${label} must be ${maximumBytes} UTF-8 bytes or fewer.`)
  }
  return normalized
}

/** Normalizes one optional browser evidence string inside the packaged UTF-8 byte envelope. */
function normalizeBrowserEvidenceOptionalText(
  value: unknown,
  label: string,
  maximumBytes: number,
): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  const normalized = value.trim()
  if (normalized === '') return null
  if (new TextEncoder().encode(normalized).byteLength > maximumBytes) {
    throw new Error(`${label} must be ${maximumBytes} UTF-8 bytes or fewer.`)
  }
  return normalized
}

function normalizeBrowserOptionalEvidenceIdentity(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return normalizeBrowserEvidenceRequiredText(value, label, MAX_SEARCH_OPERATION_ID_LENGTH)
}

function normalizeBrowserOptionalEvidenceJsonText(
  value: unknown,
  label: string,
  maximumBytes: number,
): string | null {
  const normalized = normalizeBrowserEvidenceOptionalText(value, label, maximumBytes)
  if (normalized === null) return null
  try {
    JSON.parse(normalized)
  } catch {
    throw new Error(`${label} must be valid JSON text.`)
  }
  return normalized
}

function normalizeBrowserOptionalJsonText(
  value: unknown,
  label: string,
  maximumLength: number,
): string | null {
  const normalized = normalizeBrowserOptionalSearchText(value, label, maximumLength)
  if (normalized === null) return null
  try {
    JSON.parse(normalized)
  } catch {
    throw new Error(`${label} must be valid JSON text.`)
  }
  return normalized
}

function normalizeBrowserSearchAreaGeometry(value: unknown): string {
  const normalized = normalizeBrowserSearchText(
    value, 'Search area geometry', MAX_SEARCH_AREA_GEOMETRY_LENGTH,
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(normalized)
  } catch {
    throw new Error('Search area geometry must be valid Polygon JSON text.')
  }
  if (
    typeof parsed !== 'object'
    || parsed === null
    || Array.isArray(parsed)
    || !('type' in parsed)
    || parsed.type !== 'Polygon'
    || !('coordinates' in parsed)
    || !Array.isArray(parsed.coordinates)
  ) {
    throw new Error('Search area geometry must be valid Polygon JSON text.')
  }
  return normalized
}

function normalizeBrowserOptionalFiniteNumber(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`)
  }
  return value
}

function normalizeBrowserRequiredFiniteNumber(value: unknown, label: string): number {
  const normalized = normalizeBrowserOptionalFiniteNumber(value, label)
  if (normalized === null) throw new Error(`${label} is required.`)
  return normalized
}

function normalizeBrowserRequiredSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a finite integer.`)
  }
  return value
}

function normalizeBrowserOptionalSafeInteger(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  return normalizeBrowserRequiredSafeInteger(value, label)
}

function normalizeBrowserOptionalBoolean(value: unknown, label: string): boolean | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`)
  return value
}

function normalizeBrowserSearchDisplayOrder(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error('Search area display order must be a finite integer.')
  }
  return value
}

function normalizeBrowserSearchPassOutcome(value: unknown): SearchPass['outcome'] {
  if (value !== 'full' && value !== 'partial' && value !== 'aborted') {
    throw new Error('Search pass coordinator outcome is invalid.')
  }
  return value
}

function normalizeBrowserOptionalSearchTimestamp(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  const normalized = normalizeBrowserSearchText(
    value, label, MAX_SEARCH_OPERATION_TIMESTAMP_LENGTH,
  )
  return normalizeTrackingIsoTimestamp(normalized, label)
}

function readHarnessState(): BrowserHarnessState {
  if (typeof window === 'undefined') {
    return {
      missions: [],
      devices: [],
      positions: [],
      outings: [],
      missionTeams: [],
      missionParticipants: [],
      groupMembershipEvents: [],
      participantBackfillCheckpoints: [],
      markers: [],
      drawings: [],
      helicopters: [],
      gpxImports: [],
      gpxEvidencePoints: [],
      searchAreas: [],
      searchAssignments: [],
      searchPasses: [],
      missionEvents: [],
      openedPaths: [],
      currentMissionId: null,
      recoverableMissionId: null,
      evidenceLossByMission: {},
    }
  }

  const stored = window.sessionStorage.getItem(BROWSER_HARNESS_STORAGE_KEY)
  if (stored === null) {
    return {
      missions: [],
      devices: [],
      positions: [],
      outings: [],
      missionTeams: [],
      missionParticipants: [],
      groupMembershipEvents: [],
      participantBackfillCheckpoints: [],
      markers: [],
      drawings: [],
      helicopters: [],
      gpxImports: [],
      gpxEvidencePoints: [],
      searchAreas: [],
      searchAssignments: [],
      searchPasses: [],
      missionEvents: [],
      openedPaths: [],
      currentMissionId: null,
      recoverableMissionId: null,
      evidenceLossByMission: {},
    }
  }

  try {
    const parsed = JSON.parse(stored) as Partial<BrowserHarnessState>
    return {
      missions: Array.isArray(parsed.missions) ? parsed.missions : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      outings: Array.isArray(parsed.outings) ? parsed.outings : [],
      missionTeams: Array.isArray(parsed.missionTeams) ? parsed.missionTeams : [],
      missionParticipants: Array.isArray(parsed.missionParticipants)
        ? parsed.missionParticipants
        : [],
      groupMembershipEvents: Array.isArray(parsed.groupMembershipEvents)
        ? parsed.groupMembershipEvents.map((event, index) => ({
            ...event,
            sequence: Number.isSafeInteger(event.sequence) && event.sequence > 0
              ? event.sequence
              : index + 1,
          }))
        : [],
      participantBackfillCheckpoints: Array.isArray(parsed.participantBackfillCheckpoints)
        ? parsed.participantBackfillCheckpoints
        : [],
      markers: Array.isArray(parsed.markers) ? parsed.markers : [],
      drawings: Array.isArray(parsed.drawings) ? parsed.drawings : [],
      helicopters: Array.isArray(parsed.helicopters) ? parsed.helicopters : [],
      gpxImports: Array.isArray(parsed.gpxImports) ? parsed.gpxImports : [],
      gpxEvidencePoints: Array.isArray(parsed.gpxEvidencePoints) ? parsed.gpxEvidencePoints : [],
      searchAreas: Array.isArray(parsed.searchAreas) ? parsed.searchAreas : [],
      searchAssignments: Array.isArray(parsed.searchAssignments) ? parsed.searchAssignments : [],
      searchPasses: Array.isArray(parsed.searchPasses) ? parsed.searchPasses : [],
      missionEvents: Array.isArray(parsed.missionEvents) ? parsed.missionEvents : [],
      openedPaths: Array.isArray(parsed.openedPaths) ? parsed.openedPaths : [],
      currentMissionId:
        typeof parsed.currentMissionId === 'string' ? parsed.currentMissionId : null,
      recoverableMissionId:
        typeof parsed.recoverableMissionId === 'string' ? parsed.recoverableMissionId : null,
      evidenceLossByMission: readBrowserEvidenceLossState(parsed.evidenceLossByMission),
    }
  } catch {
    return {
      missions: [],
      devices: [],
      positions: [],
      outings: [],
      missionTeams: [],
      missionParticipants: [],
      groupMembershipEvents: [],
      participantBackfillCheckpoints: [],
      markers: [],
      drawings: [],
      helicopters: [],
      gpxImports: [],
      gpxEvidencePoints: [],
      searchAreas: [],
      searchAssignments: [],
      searchPasses: [],
      missionEvents: [],
      openedPaths: [],
      currentMissionId: null,
      recoverableMissionId: null,
      evidenceLossByMission: {},
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

/** Locks participant truth before finished-state archival can begin. */
function requireMutableParticipantMission(
  missionId: string,
  missions: readonly Mission[],
): Mission {
  const mission = requireMission(missionId, missions)
  if (mission.status === 'finished' || mission.status === 'finalized') {
    throw new Error('Finished and finalized missions are read-only for participant changes.')
  }
  return mission
}

/** Creates one append-only participant window for the browser validation mirror. */
function createHarnessParticipant(input: {
  readonly missionId: string
  readonly kind: 'device' | 'group'
  readonly deviceId?: string | null
  readonly missionTeamId?: string | null
  readonly traccarGroupId?: string | null
  readonly teamName?: string | null
  readonly effectiveFrom: string
  readonly addedAt: string
  readonly addedBy: string
}): MissionParticipant {
  return {
    id: createId('participant'),
    mission_id: input.missionId,
    kind: input.kind,
    traccar_device_id: input.deviceId ?? null,
    mission_team_id: input.missionTeamId ?? null,
    traccar_group_id: input.traccarGroupId ?? null,
    team_name: input.teamName ?? null,
    provenance: 'explicit',
    effective_from: input.effectiveFrom,
    added_at: input.addedAt,
    added_by: input.addedBy,
    removed_at: null,
    removed_by: null,
  }
}

/** Creates one fixed-window participant-history checkpoint for the browser mirror. */
function createHarnessBackfillCheckpoint(input: {
  readonly missionId: string
  readonly deviceId: string
  readonly windowFrom: string
  readonly windowTo: string
}): ParticipantBackfillCheckpoint {
  return {
    mission_id: input.missionId,
    traccar_device_id: input.deviceId,
    window_from: input.windowFrom,
    window_to: input.windowTo,
    reconciled_until: input.windowFrom,
    completed: input.windowFrom === input.windowTo ? 1 : 0,
    updated_at: input.windowTo,
  }
}

/** Adds only the uncovered suffix while preserving existing fixed checkpoint edges. */
function createHarnessBackfillCoverageCheckpoints(
  existing: readonly ParticipantBackfillCheckpoint[],
  input: {
    readonly missionId: string
    readonly deviceId: string
    readonly windowFrom: string
    readonly windowTo: string
  },
): readonly ParticipantBackfillCheckpoint[] {
  let windowFrom = input.windowFrom
  while (windowFrom < input.windowTo) {
    const checkpoint = existing.find((candidate) =>
      candidate.mission_id === input.missionId &&
      candidate.traccar_device_id === input.deviceId &&
      candidate.window_from === windowFrom)
    if (checkpoint === undefined) {
      return [createHarnessBackfillCheckpoint({ ...input, windowFrom })]
    }
    if (checkpoint.window_to <= windowFrom) {
      throw new Error('Participant backfill window must advance beyond its start.')
    }
    if (checkpoint.window_to >= input.windowTo) return []
    windowFrom = checkpoint.window_to
  }
  const exact = existing.some((candidate) =>
    candidate.mission_id === input.missionId &&
    candidate.traccar_device_id === input.deviceId &&
    candidate.window_from === input.windowFrom)
  return exact ? [] : [createHarnessBackfillCheckpoint(input)]
}

/** Mirrors the production store's active-selection uniqueness checks. */
function assertHarnessInitialParticipantSelection(
  input: SelectMissionParticipantsInput,
  participants: readonly MissionParticipant[],
): void {
  const directDeviceIds = input.devices.map((device) =>
    requireHarnessText(device.traccar_device_id, 'Traccar device id'))
  const selectedGroupIds = input.groups.map((group) =>
    requireHarnessText(group.traccar_group_id, 'Traccar group id'))
  const duplicateDeviceId = firstRepeatedHarnessId(directDeviceIds)
  if (duplicateDeviceId !== null) {
    throw new Error(`Participant device ${duplicateDeviceId} is selected more than once.`)
  }
  const duplicateGroupId = firstRepeatedHarnessId(selectedGroupIds)
  if (duplicateGroupId !== null) {
    throw new Error(`Participant group ${duplicateGroupId} is selected more than once.`)
  }

  const groupMemberDeviceIds = new Set(input.groups.flatMap((group) =>
    group.member_device_ids.map((deviceId) =>
      requireHarnessText(deviceId, 'Traccar device id'))))
  const overlappingDeviceIds = directDeviceIds
    .filter((deviceId) => groupMemberDeviceIds.has(deviceId))
    .sort()
  if (overlappingDeviceIds.length > 0) {
    throw new Error(
      `Participant devices already covered by a selected group must be selected only once: ${overlappingDeviceIds.join(', ')}.`,
    )
  }

  const activeParticipants = participants.filter((participant) =>
    participant.mission_id === input.mission_id && participant.removed_at === null)
  if (directDeviceIds.some((deviceId) => activeParticipants.some((participant) =>
    participant.kind === 'device' && participant.traccar_device_id === deviceId))) {
    throw new Error('Participant is already active for this mission.')
  }
  if (selectedGroupIds.some((groupId) => activeParticipants.some((participant) =>
    participant.kind === 'group' && participant.traccar_group_id === groupId))) {
    throw new Error('Participant is already active for this mission.')
  }
}

/** Returns one repeated browser-harness selection identifier. */
function firstRepeatedHarnessId(values: readonly string[]): string | null {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return null
}

/** Resolves current group coverage for one direct-device add. */
function isHarnessDeviceCoveredByActiveGroup(
  missionId: string,
  deviceId: string,
  participants: readonly MissionParticipant[],
  membershipEvents: readonly GroupMembershipEvent[],
): boolean {
  const activeTeamIds = new Set(participants
    .filter((participant) =>
      participant.mission_id === missionId &&
      participant.kind === 'group' &&
      participant.removed_at === null &&
      participant.mission_team_id !== null)
    .flatMap((participant) =>
      participant.mission_team_id === null ? [] : [participant.mission_team_id]))
  return [...activeTeamIds].some((teamId) =>
    latestHarnessMembershipChange(missionId, teamId, deviceId, membershipEvents) === 'member')
}

/** Resolves whether one group add would overlap an active direct device. */
function harnessGroupCoversActiveDevice(
  missionId: string,
  teamId: string,
  participants: readonly MissionParticipant[],
  membershipEvents: readonly GroupMembershipEvent[],
): boolean {
  return participants.some((participant) =>
    participant.mission_id === missionId &&
    participant.kind === 'device' &&
    participant.removed_at === null &&
    participant.traccar_device_id !== null &&
    latestHarnessMembershipChange(
      missionId,
      teamId,
      participant.traccar_device_id,
      membershipEvents,
    ) === 'member')
}

/** Returns the latest append-only membership state for one team/device pair. */
function latestHarnessMembershipChange(
  missionId: string,
  teamId: string,
  deviceId: string,
  membershipEvents: readonly GroupMembershipEvent[],
): GroupMembershipEvent['change'] | null {
  const latest = membershipEvents
    .filter((event) =>
      event.mission_id === missionId &&
      event.mission_team_id === teamId &&
      event.traccar_device_id === deviceId)
    .toSorted((left, right) =>
      right.observed_at.localeCompare(left.observed_at) || right.sequence - left.sequence)[0]
  return latest?.change ?? null
}

/** Creates append-only membership changes for one complete group observation. */
function createHarnessMembershipObservation(input: {
  readonly missionId: string
  readonly teamId: string
  readonly observedDeviceIds: readonly string[]
  readonly observedAt: string
  readonly previousEvents: readonly GroupMembershipEvent[]
}): readonly GroupMembershipEvent[] {
  const knownDeviceIds = new Set(input.previousEvents
    .filter((event) =>
      event.mission_id === input.missionId && event.mission_team_id === input.teamId)
    .map((event) => event.traccar_device_id))
  const observedDeviceIds = new Set(input.observedDeviceIds.map((deviceId) =>
    requireHarnessText(deviceId, 'Traccar device id')))
  const changes: GroupMembershipEvent[] = []

  for (const deviceId of knownDeviceIds) {
    if (
      !observedDeviceIds.has(deviceId) &&
      latestHarnessMembershipChange(
        input.missionId,
        input.teamId,
        deviceId,
        input.previousEvents,
      ) === 'member'
    ) {
      changes.push(createHarnessMembershipEvent(
        input,
        deviceId,
        'left',
        nextHarnessMembershipSequence([...input.previousEvents, ...changes]),
      ))
    }
  }
  for (const deviceId of observedDeviceIds) {
    if (latestHarnessMembershipChange(
      input.missionId,
      input.teamId,
      deviceId,
      input.previousEvents,
    ) !== 'member') {
      changes.push(createHarnessMembershipEvent(
        input,
        deviceId,
        'member',
        nextHarnessMembershipSequence([...input.previousEvents, ...changes]),
      ))
    }
  }
  return changes
}

/** Creates one browser-harness membership observation row. */
function createHarnessMembershipEvent(
  input: {
    readonly missionId: string
    readonly teamId: string
    readonly observedAt: string
  },
  deviceId: string,
  change: GroupMembershipEvent['change'],
  sequence: number,
): GroupMembershipEvent {
  return {
    id: createId('membership'),
    sequence,
    mission_id: input.missionId,
    mission_team_id: input.teamId,
    traccar_device_id: deviceId,
    change,
    observed_at: input.observedAt,
  }
}

/** Returns the next durable browser-mirror append order. */
function nextHarnessMembershipSequence(
  membershipEvents: readonly GroupMembershipEvent[],
): number {
  return membershipEvents.reduce(
    (maximum, event) => Math.max(maximum, event.sequence),
    0,
  ) + 1
}

/** Validates one participant effective-from boundary against mission and wall clocks. */
function normalizeParticipantEffectiveFrom(
  value: string,
  mission: Mission,
  now: string,
): string {
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    throw new Error('Participant effective-from must be a valid date and time.')
  }
  const normalized = new Date(milliseconds).toISOString()
  if (normalized < mission.start_time) {
    throw new Error('Participant effective-from cannot be before the mission start.')
  }
  if (normalized > now) throw new Error('Participant effective-from cannot be in the future.')
  return normalized
}

/** Requires trimmed text in browser-harness participant inputs. */
function requireHarnessText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required.`)
  return value.trim()
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

/** Prevents browser validation from moving recorded passes outside their outing. */
function assertHarnessRecordedSearchPassesFitOuting(
  outing: Outing,
  assignments: readonly SearchAssignment[],
  passes: readonly SearchPass[],
): void {
  const assignmentIds = new Set(assignments
    .filter((assignment) => assignment.outing_id === outing.id)
    .map((assignment) => assignment.id))
  const outingStartMs = Date.parse(outing.started_at)
  const outingEndMs = outing.ended_at === null ? null : Date.parse(outing.ended_at)
  for (const pass of passes.filter((candidate) => assignmentIds.has(candidate.assignment_id))) {
    const passStartMs = Date.parse(pass.started_at)
    const passEndMs = pass.ended_at === null ? null : Date.parse(pass.ended_at)
    if (outingEndMs !== null && passEndMs === null) {
      throw new Error(
        `Cannot end outing while active search pass ${pass.id} remains; record its pass end first.`,
      )
    }
    if (
      passStartMs < outingStartMs
      || (outingEndMs !== null && passStartMs >= outingEndMs)
      || (outingEndMs !== null && passEndMs !== null && passEndMs > outingEndMs)
    ) {
      throw new Error(
        `Outing boundary change would place recorded search pass ${pass.id} outside its outing.`,
      )
    }
  }
}

/** Mirrors the production assignment-outing pass interval policy. */
function assertHarnessSearchPassWindow(input: {
  readonly mission: Mission
  readonly outing: Outing
  readonly startedAt: string
  readonly endedAt: string | null
  readonly currentTime: string
}): void {
  const startedAtMs = Date.parse(input.startedAt)
  const endedAtMs = input.endedAt === null ? null : Date.parse(input.endedAt)
  const outingStartMs = Date.parse(input.outing.started_at)
  const outingEndMs = input.outing.ended_at === null ? null : Date.parse(input.outing.ended_at)
  const currentTimeMs = Date.parse(input.currentTime)
  if (startedAtMs < Date.parse(input.mission.start_time)) {
    throw new Error('Search pass start cannot be before the mission start.')
  }
  if (startedAtMs < outingStartMs) {
    throw new Error('Search pass start cannot be before its assignment outing start.')
  }
  if (startedAtMs > currentTimeMs) throw new Error('Search pass start cannot be in the future.')
  if (endedAtMs !== null && endedAtMs > currentTimeMs) {
    throw new Error('Search pass end cannot be in the future.')
  }
  if (outingEndMs !== null) {
    if (startedAtMs >= outingEndMs) {
      throw new Error('Search pass start must be before its assignment outing end.')
    }
    if (endedAtMs === null) {
      throw new Error('A pass in an ended outing must have an explicit pass end.')
    }
    if (endedAtMs > outingEndMs) {
      throw new Error('Search pass end cannot be after its assignment outing end.')
    }
  }
}

/** Normalizes one browser validation pass boundary to canonical UTC. */
function normalizeHarnessSearchPassBoundary(value: unknown, label: 'start' | 'end'): string {
  const fieldLabel = `Search pass ${label}`
  const normalized = normalizeBrowserSearchText(
    value,
    fieldLabel,
    MAX_SEARCH_OPERATION_TIMESTAMP_LENGTH,
  )
  return normalizeTrackingIsoTimestamp(normalized, fieldLabel)
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

/** Builds the deterministic mocked desktop manifest used only by Chromium validation. */
function createBrowserCoverageManifest(
  state: BrowserHarnessState,
  missionId: string,
): CoverageManifest {
  requireMission(missionId, state.missions)
  const outings = state.outings
    .filter((outing) => outing.mission_id === missionId)
    .toSorted((left, right) => left.started_at.localeCompare(right.started_at))
  const deviceIds = new Set(
    state.devices.filter((device) => device.mission_id === missionId)
      .map((device) => device.device_id),
  )
  for (const participant of state.missionParticipants) {
    if (
      participant.mission_id === missionId &&
      participant.removed_at === null &&
      participant.kind === 'device' &&
      participant.traccar_device_id !== null
    ) deviceIds.add(participant.traccar_device_id)
  }
  const periods = [
    ...outings.map((outing) => ({
      period_kind: 'outing' as const,
      period_id: outing.id,
    })),
    { period_kind: 'unassigned' as const, period_id: '' },
  ]
  const chunks = [...deviceIds].sort().flatMap((deviceId) => periods.map((period) => {
    const positions = readBrowserCoveragePositions(state, missionId, deviceId, period, outings)
    const revision = positions.length + 1
    return {
      key: { device_id: deviceId, ...period },
      contentRev: revision,
      builtRev: revision,
      fixCount: positions.length,
      exactCount: positions.length,
      fixDigest: positions.map((position) =>
        position.source_position_id ?? position.id).join('\n'),
      minTs: positions[0]?.timestamp ?? null,
      maxTs: positions.at(-1)?.timestamp ?? null,
    }
  }))
  const pendingBackfills = state.participantBackfillCheckpoints.filter(
    (checkpoint) => checkpoint.mission_id === missionId && checkpoint.completed === 0,
  ).length
  return {
    changeSeq: state.positions.filter((position) => position.mission_id === missionId).length +
      outings.length + pendingBackfills,
    enumerated: true,
    pendingInvalidation: false,
    backfillIncomplete: pendingBackfills > 0,
    outings: outings.map((outing) => ({
      id: outing.id,
      label: outing.label,
      started_at: outing.started_at,
      ended_at: outing.ended_at,
    })),
    chunks,
  }
}

/** Allows Chromium coverage tests to hold a real controller load in progress. */
async function waitForBrowserCoverageValidationDelay(): Promise<void> {
  const raw = window.sessionStorage.getItem('sartracker:browser-harness:coverage-delay-ms')
  if (raw === null) return
  const milliseconds = Number(raw)
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 5_000) return
  await new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

/** Materializes a small GeoJSON stand-in for mocked browser validation only. */
function createBrowserCoverageTileCatalog(
  state: BrowserHarnessState,
  missionId: string,
  requestedChunks: readonly {
    readonly key: CoverageManifest['chunks'][number]['key']
    readonly contentRev: number
  }[],
): CoverageTileCatalog {
  const manifest = createBrowserCoverageManifest(state, missionId)
  const outings = state.outings.filter((outing) => outing.mission_id === missionId)
  const requested = new Map(requestedChunks.map((chunk) => [
    `${chunk.key.device_id}\u0000${coveragePeriodKey(chunk.key)}`,
    chunk,
  ]))
  const delivered = manifest.chunks.flatMap((chunk) => {
    const request = requested.get(`${chunk.key.device_id}\u0000${coveragePeriodKey(chunk.key)}`)
    return request?.contentRev === chunk.contentRev
      ? [{ key: chunk.key, contentRev: chunk.contentRev }]
      : []
  })
  const features = manifest.chunks.flatMap((chunk) => {
    if (!requested.has(`${chunk.key.device_id}\u0000${coveragePeriodKey(chunk.key)}`)) return []
    const positions = readBrowserCoveragePositions(
      state,
      missionId,
      chunk.key.device_id,
      chunk.key,
      outings,
    )
    const segmentablePositions = positions.map((position) => {
      const { timestamp_source: timestampSource, ...positionWithoutTimestampSource } = position
      return {
        ...positionWithoutTimestampSource,
        ...(timestampSource === 'fix' ? { timestamp_source: 'fix' as const } : {}),
        cache_age_seconds: null,
        device_cache_stale: false,
      }
    })
    return createTrailSegments(segmentablePositions, 30 * 60 * 1000).map((segment, index) => ({
      type: 'Feature' as const,
      id: `cov:${missionId}:${chunk.key.device_id}:${coveragePeriodKey(chunk.key)}:${index}`,
      geometry: segment.length === 1
        ? { type: 'Point' as const, coordinates: [segment[0]!.lon, segment[0]!.lat] }
        : {
            type: 'LineString' as const,
            coordinates: segment.map((position) => [position.lon, position.lat]),
          },
      properties: {
        device_id: chunk.key.device_id,
        period_kind: chunk.key.period_kind,
        period_id: chunk.key.period_id,
        content_rev: chunk.contentRev,
      },
    }))
  })
  const periodRevisions = new Map<string, number[]>()
  for (const chunk of manifest.chunks) {
    if (!requested.has(`${chunk.key.device_id}\u0000${coveragePeriodKey(chunk.key)}`)) continue
    const periodKey = coveragePeriodKey(chunk.key)
    const revisions = periodRevisions.get(periodKey) ?? []
    revisions.push(chunk.contentRev)
    periodRevisions.set(periodKey, revisions)
  }
  return {
    missionId,
    periods: [...periodRevisions.entries()].map(([periodKey, revisions]) => ({
      periodKey,
      revisionDigest: `browser-${revisions.join('-')}`,
    })),
    delivered,
    browserHarnessGeoJson: { type: 'FeatureCollection', features },
  }
}

function readBrowserCoveragePositions(
  state: BrowserHarnessState,
  missionId: string,
  deviceId: string,
  period: { readonly period_kind: 'outing' | 'unassigned'; readonly period_id: string },
  outings: readonly Outing[],
): readonly Position[] {
  return state.positions
    .filter((position) => position.mission_id === missionId && position.device_id === deviceId)
    .filter((position) => {
      const containing = outings.find((outing) =>
        outing.started_at <= position.timestamp &&
        (outing.ended_at === null || position.timestamp < outing.ended_at))
      return period.period_kind === 'unassigned'
        ? containing === undefined
        : containing?.id === period.period_id
    })
    .toSorted(compareBrowserHarnessPositions)
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

function upsertByStableId<T extends { readonly id: string }>(
  entries: readonly T[],
  next: T,
): readonly T[] {
  return entries.some((entry) => entry.id === next.id)
    ? entries.map((entry) => entry.id === next.id ? next : entry)
    : [...entries, next]
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
