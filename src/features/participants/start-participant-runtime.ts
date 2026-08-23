import type {
  AddMissionParticipantInput,
  GroupMembershipEvent,
  MissionParticipant,
  ParticipantBackfillCheckpoint,
  SelectMissionParticipantsInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type {
  NormalizedTrackingDevice,
  NormalizedTraccarGroup,
} from '../tracking/tracking-types'
import { assessParticipantEnvelope } from './participant-envelope'
import type { ParticipantRuntimeState } from './participant-store'
import { createParticipationScope } from './participation-scope'

type ParticipantStoreBoundary = {
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
    readonly events: readonly Omit<GroupMembershipEvent, 'id' | 'mission_id'>[]
  }) => Promise<readonly GroupMembershipEvent[]>
  readonly listGroupMembershipEvents: (
    missionId: string,
  ) => Promise<readonly GroupMembershipEvent[]>
  readonly listParticipantBackfillCheckpoints: (
    missionId: string,
  ) => Promise<readonly ParticipantBackfillCheckpoint[]>
}

type StartParticipantRuntimeDependencies = {
  readonly participantStore: ParticipantStoreBoundary
  readonly applyRuntime: (runtime: ParticipantRuntimeState) => void
  readonly now?: () => Date
}

export type ParticipantRuntimeController = {
  readonly refreshMission: (missionId: string | null) => Promise<void>
  readonly applyRoster: (
    devices: readonly NormalizedTrackingDevice[],
    observedAt?: string,
  ) => Promise<void>
  readonly applyGroups: (groups: readonly NormalizedTraccarGroup[]) => void
  readonly reportRosterError: (message: string | null) => void
  readonly toggleDraftDevice: (deviceId: string) => void
  readonly toggleDraftGroup: (groupId: string) => void
  readonly clearDraft: () => void
  readonly selectInitialParticipants: (
    missionId: string,
    selectedBy: string,
  ) => Promise<readonly MissionParticipant[]>
  readonly addParticipant: (input: Omit<AddMissionParticipantInput, 'mission_id'>) => Promise<MissionParticipant | null>
  readonly removeParticipant: (
    participantId: string,
    removedBy: string,
    reason?: string,
  ) => Promise<MissionParticipant | null>
  readonly clearMembershipNotices: () => void
}

/** Owns participant hydration, selection, and observation-time group expansion. */
export async function startParticipantRuntime(
  dependencies: StartParticipantRuntimeDependencies,
): Promise<ParticipantRuntimeController> {
  const now = dependencies.now ?? (() => new Date())
  let activeMissionId: string | null = null
  let participants: readonly MissionParticipant[] = []
  let membershipEvents: readonly GroupMembershipEvent[] = []
  let backfillCheckpoints: readonly ParticipantBackfillCheckpoint[] = []
  let availableDevices: readonly NormalizedTrackingDevice[] = []
  let availableGroups: readonly NormalizedTraccarGroup[] = []
  let draftDeviceIds: readonly string[] = []
  let draftGroupIds: readonly string[] = []
  let membershipNotices: readonly string[] = []
  let loading = false
  let saving = false
  let rosterError: string | null = null
  let error: string | null = null
  let refreshToken = 0

  const controller: ParticipantRuntimeController = {
    refreshMission: async (missionId) => {
      const token = ++refreshToken
      activeMissionId = missionId
      error = null
      if (missionId === null) {
        participants = []
        membershipEvents = []
        backfillCheckpoints = []
        loading = false
        publishRuntime()
        return
      }
      loading = true
      publishRuntime()
      try {
        const [nextParticipants, nextEvents, nextCheckpoints] = await Promise.all([
          dependencies.participantStore.listMissionParticipants(missionId),
          dependencies.participantStore.listGroupMembershipEvents(missionId),
          dependencies.participantStore.listParticipantBackfillCheckpoints(missionId),
        ])
        if (token !== refreshToken || activeMissionId !== missionId) return
        participants = nextParticipants
        membershipEvents = nextEvents
        backfillCheckpoints = nextCheckpoints
      } catch (runtimeError) {
        if (token === refreshToken && activeMissionId === missionId) {
          participants = []
          membershipEvents = []
          backfillCheckpoints = []
          error = toErrorMessage(runtimeError)
        }
      } finally {
        if (token === refreshToken && activeMissionId === missionId) {
          loading = false
          publishRuntime()
        }
      }
    },
    applyRoster: async (devices, observedAt = now().toISOString()) => {
      const rosterChanged = !areRostersEquivalent(availableDevices, devices)
      const errorCleared = rosterError !== null
      if (!rosterChanged && !errorCleared) return
      if (rosterChanged) availableDevices = [...devices]
      rosterError = null
      publishRuntime()
      if (!rosterChanged) return
      const missionId = activeMissionId
      if (missionId === null) return

      const changes = collectMembershipChanges(
        participants,
        membershipEvents,
        availableDevices,
        observedAt,
      )
      if (changes.length === 0) return
      try {
        const inserted = await dependencies.participantStore.recordGroupMembershipEvents({
          mission_id: missionId,
          events: changes,
        })
        if (activeMissionId !== missionId || inserted.length === 0) return
        membershipEvents = [...membershipEvents, ...inserted]
        membershipNotices = [
          ...membershipNotices,
          ...inserted.map((event) => membershipNotice(event, participants)),
        ]
        publishRuntime()
      } catch (runtimeError) {
        rosterError = `Group membership could not be recorded: ${toErrorMessage(runtimeError)}`
        publishRuntime()
      }
    },
    applyGroups: (groups) => {
      availableGroups = [...groups]
      rosterError = null
      publishRuntime()
    },
    reportRosterError: (message) => {
      rosterError = message
      publishRuntime()
    },
    toggleDraftDevice: (deviceId) => {
      const device = availableDevices.find((candidate) => candidate.device_id === deviceId)
      if (
        device?.group_id !== null &&
        device?.group_id !== undefined &&
        draftGroupIds.includes(device.group_id)
      ) return
      draftDeviceIds = toggleId(draftDeviceIds, deviceId)
      publishRuntime()
    },
    toggleDraftGroup: (groupId) => {
      const selectingGroup = !draftGroupIds.includes(groupId)
      draftGroupIds = toggleId(draftGroupIds, groupId)
      if (selectingGroup) {
        const coveredDeviceIds = new Set(availableDevices
          .filter((device) => device.group_id === groupId)
          .map((device) => device.device_id))
        draftDeviceIds = draftDeviceIds.filter((deviceId) =>
          !coveredDeviceIds.has(deviceId))
      }
      publishRuntime()
    },
    clearDraft: () => {
      draftDeviceIds = []
      draftGroupIds = []
      publishRuntime()
    },
    selectInitialParticipants: async (missionId, selectedBy) => {
      saving = true
      error = null
      activeMissionId = missionId
      publishRuntime()
      try {
        const selected = await dependencies.participantStore.selectMissionParticipants({
          mission_id: missionId,
          groups: draftGroupIds.map((groupId) => {
            const group = requireGroup(availableGroups, groupId)
            return {
              traccar_group_id: group.group_id,
              name: group.name,
              member_device_ids: availableDevices
                .filter((device) => device.group_id === groupId)
                .map((device) => device.device_id),
            }
          }),
          devices: draftDeviceIds.map((deviceId) => ({ traccar_device_id: deviceId })),
          selected_by: selectedBy,
        })
        draftDeviceIds = []
        draftGroupIds = []
        await controller.refreshMission(missionId)
        return selected
      } catch (runtimeError) {
        error = toErrorMessage(runtimeError)
        publishRuntime()
        return []
      } finally {
        saving = false
        publishRuntime()
      }
    },
    addParticipant: async (input) => mutate(async (missionId) => {
      const participantRef = input.ref
      const observedInput = input.kind === 'group' && typeof participantRef !== 'string'
        ? {
            ...input,
            ref: {
              ...participantRef,
              member_device_ids: availableDevices
                .filter((device) => device.group_id === participantRef.traccar_group_id)
                .map((device) => device.device_id),
            },
          }
        : input
      return dependencies.participantStore.addMissionParticipant({
        mission_id: missionId,
        ...observedInput,
      })
    }),
    removeParticipant: async (participantId, removedBy, reason) => mutate(async (missionId) =>
      dependencies.participantStore.removeMissionParticipant({
        mission_id: missionId,
        participant_id: participantId,
        removed_by: removedBy,
        ...(reason === undefined ? {} : { reason }),
      })),
    clearMembershipNotices: () => {
      membershipNotices = []
      publishRuntime()
    },
  }

  publishRuntime()
  return controller

  async function mutate(
    operation: (missionId: string) => Promise<MissionParticipant>,
  ): Promise<MissionParticipant | null> {
    const missionId = activeMissionId
    if (missionId === null || saving) return null
    saving = true
    error = null
    publishRuntime()
    try {
      const result = await operation(missionId)
      await controller.refreshMission(missionId)
      return result
    } catch (runtimeError) {
      error = toErrorMessage(runtimeError)
      return null
    } finally {
      saving = false
      publishRuntime()
    }
  }

  function publishRuntime(): void {
    const scope = createParticipationScope({ participants, membershipEvents })
    dependencies.applyRuntime({
      activeMissionId,
      participants,
      membershipEvents,
      backfillCheckpoints,
      availableDevices,
      availableGroups,
      draftDeviceIds,
      draftGroupIds,
      membershipNotices,
      scope,
      envelope: assessParticipantEnvelope(scope.activeDeviceIdsAt(now().toISOString())),
      loading,
      saving,
      rosterError,
      error,
    })
  }
}

/** Narrows the optional MissionStore participant surface after boot validation. */
export function hasParticipantStoreBoundary(
  store: Partial<ParticipantStoreBoundary>,
): store is ParticipantStoreBoundary {
  return (
    store.selectMissionParticipants !== undefined &&
    store.addMissionParticipant !== undefined &&
    store.removeMissionParticipant !== undefined &&
    store.listMissionParticipants !== undefined &&
    store.recordGroupMembershipEvents !== undefined &&
    store.listGroupMembershipEvents !== undefined &&
    store.listParticipantBackfillCheckpoints !== undefined
  )
}

function collectMembershipChanges(
  participants: readonly MissionParticipant[],
  events: readonly GroupMembershipEvent[],
  devices: readonly NormalizedTrackingDevice[],
  observedAt: string,
): readonly Omit<GroupMembershipEvent, 'id' | 'mission_id'>[] {
  const changes: Omit<GroupMembershipEvent, 'id' | 'mission_id'>[] = []
  for (const participant of participants) {
    if (
      participant.kind !== 'group' ||
      participant.removed_at !== null ||
      participant.mission_team_id === null ||
      participant.traccar_group_id === null
    ) continue

    const current = new Set(
      devices
        .filter((device) => device.group_id === participant.traccar_group_id)
        .map((device) => device.device_id),
    )
    const latestByDevice = new Map<string, GroupMembershipEvent>()
    for (const event of events) {
      if (event.mission_team_id !== participant.mission_team_id) continue
      const previous = latestByDevice.get(event.traccar_device_id)
      if (
        previous === undefined ||
        event.observed_at > previous.observed_at ||
        (event.observed_at === previous.observed_at && event.id > previous.id)
      ) latestByDevice.set(event.traccar_device_id, event)
    }
    const known = new Set(
      [...latestByDevice.values()]
        .filter((event) => event.change === 'member')
        .map((event) => event.traccar_device_id),
    )
    const candidateIds = [...new Set([...known, ...current])].sort()
    for (const deviceId of candidateIds) {
      if (known.has(deviceId) === current.has(deviceId)) continue
      changes.push({
        mission_team_id: participant.mission_team_id,
        traccar_device_id: deviceId,
        change: current.has(deviceId) ? 'member' : 'left',
        observed_at: observedAt,
      })
    }
  }
  return changes
}

function membershipNotice(
  event: GroupMembershipEvent,
  participants: readonly MissionParticipant[],
): string {
  const teamName = participants.find(
    (participant) => participant.mission_team_id === event.mission_team_id,
  )?.team_name ?? 'selected group'
  const direction = event.change === 'member' ? 'joined' : 'left'
  return `${event.traccar_device_id} ${direction} ${teamName}; mission participation changed from ${event.observed_at}. No earlier evidence was invented.`
}

function requireGroup(
  groups: readonly NormalizedTraccarGroup[],
  groupId: string,
): NormalizedTraccarGroup {
  const group = groups.find((candidate) => candidate.group_id === groupId)
  if (group === undefined) throw new Error(`Selected Traccar group is unavailable: ${groupId}`)
  return group
}

function toggleId(values: readonly string[], id: string): readonly string[] {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id]
}

/** Compares roster identity and discovery metadata without depending on server row order. */
function areRostersEquivalent(
  current: readonly NormalizedTrackingDevice[],
  incoming: readonly NormalizedTrackingDevice[],
): boolean {
  if (current === incoming) return true
  if (current.length !== incoming.length) return false
  const currentById = new Map(current.map((device) => [device.device_id, device]))
  if (currentById.size !== current.length) return false
  return incoming.every((device) => {
    const previous = currentById.get(device.device_id)
    return previous !== undefined &&
      previous.name === device.name &&
      previous.status === device.status &&
      previous.last_seen === device.last_seen &&
      previous.unique_id === device.unique_id &&
      previous.category === device.category &&
      (previous.group_id ?? null) === (device.group_id ?? null)
  })
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
