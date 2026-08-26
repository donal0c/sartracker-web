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
  readonly missionEvents: readonly MissionEvent[]
  readonly openedPaths: readonly string[]
  readonly currentMissionId: string | null
  readonly recoverableMissionId: string | null
  readonly evidenceLossByMission: BrowserEvidenceLossByMission
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
      missionTeams: [],
      missionParticipants: [],
      groupMembershipEvents: [],
      participantBackfillCheckpoints: [],
      markers: [],
      drawings: [],
      helicopters: [],
      gpxImports: [],
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
    const segmentablePositions = positions.map((position) => ({
      ...position,
      cache_age_seconds: null,
      device_cache_stale: false,
    }))
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
