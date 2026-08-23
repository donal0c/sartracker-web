import type {
  GroupMembershipEvent,
  MissionParticipant,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { TrackingSnapshot } from '../tracking/tracking-types'

export type ParticipationScope = {
  readonly includesAt: (deviceId: string, timestamp: string) => boolean
  readonly activeDeviceIdsAt: (timestamp: string) => readonly string[]
  readonly filterSnapshot: (
    snapshot: TrackingSnapshot,
    observedAt?: string,
  ) => TrackingSnapshot
  readonly filterEvidenceSnapshot: (
    snapshot: TrackingSnapshot,
    observedAt?: string,
  ) => TrackingSnapshot
}

/**
 * Builds an immutable in-memory participation policy. No per-fix store query is
 * needed: direct windows and append-only group observations are evaluated here.
 */
export function createParticipationScope(input: {
  readonly participants: readonly MissionParticipant[]
  readonly membershipEvents: readonly GroupMembershipEvent[]
}): ParticipationScope {
  const directParticipantsByDevice = new Map<string, MissionParticipant[]>()
  const groupParticipantsByTeam = new Map<string, MissionParticipant[]>()
  const membershipEventsByDevice = new Map<string, GroupMembershipEvent[]>()
  const candidateDeviceIds = new Set<string>()

  for (const participant of input.participants) {
    if (participant.kind === 'device' && participant.traccar_device_id !== null) {
      appendIndexed(directParticipantsByDevice, participant.traccar_device_id, participant)
      candidateDeviceIds.add(participant.traccar_device_id)
    } else if (participant.kind === 'group' && participant.mission_team_id !== null) {
      appendIndexed(groupParticipantsByTeam, participant.mission_team_id, participant)
    }
  }
  for (const event of input.membershipEvents) {
    appendIndexed(membershipEventsByDevice, event.traccar_device_id, event)
    candidateDeviceIds.add(event.traccar_device_id)
  }
  for (const events of membershipEventsByDevice.values()) {
    events.sort((left, right) =>
      right.observed_at.localeCompare(left.observed_at) || right.id.localeCompare(left.id))
  }

  function includesAt(deviceId: string, timestamp: string): boolean {
    if (directParticipantsByDevice.get(deviceId)?.some(
      (participant) => windowContains(participant, timestamp),
    ) === true) return true

    const resolvedTeams = new Set<string>()
    for (const event of membershipEventsByDevice.get(deviceId) ?? []) {
      if (event.observed_at > timestamp || resolvedTeams.has(event.mission_team_id)) continue
      resolvedTeams.add(event.mission_team_id)
      if (
        event.change === 'member' &&
        groupParticipantsByTeam.get(event.mission_team_id)?.some(
          (participant) => windowContains(participant, timestamp),
        ) === true
      ) return true
    }
    return false
  }

  function activeDeviceIdsAt(timestamp: string): readonly string[] {
    return [...candidateDeviceIds].filter((deviceId) => includesAt(deviceId, timestamp)).sort()
  }

  return {
    includesAt,
    activeDeviceIdsAt,
    filterSnapshot: (snapshot, observedAt = new Date().toISOString()) => {
      const activeDeviceIds = new Set(activeDeviceIdsAt(observedAt))
      return {
        ...snapshot,
        devices: snapshot.devices.filter((device) => activeDeviceIds.has(device.device_id)),
        // Current positions describe where selected participants are now. Their
        // source fix can predate a late selection or observation-time group
        // membership change, so historical evidence windows must not hide them.
        positions: snapshot.positions.filter((position) =>
          activeDeviceIds.has(position.device_id)),
        breadcrumbs: snapshot.breadcrumbs.filter((position) =>
          includesAt(position.device_id, position.timestamp)),
        ...(snapshot.rawBreadcrumbsForPersistence === undefined
          ? {}
          : {
              rawBreadcrumbsForPersistence: snapshot.rawBreadcrumbsForPersistence.filter(
                (position) => includesAt(position.device_id, position.timestamp),
              ),
        }),
      }
    },
    filterEvidenceSnapshot: (snapshot, observedAt = new Date().toISOString()) => {
      const activeDeviceIds = new Set(activeDeviceIdsAt(observedAt))
      return {
        ...snapshot,
        devices: snapshot.devices.filter((device) => activeDeviceIds.has(device.device_id)),
        positions: snapshot.positions.filter((position) =>
          includesAt(position.device_id, position.timestamp)),
        breadcrumbs: snapshot.breadcrumbs.filter((position) =>
          includesAt(position.device_id, position.timestamp)),
        ...(snapshot.rawBreadcrumbsForPersistence === undefined
          ? {}
          : {
              rawBreadcrumbsForPersistence: snapshot.rawBreadcrumbsForPersistence.filter(
                (position) => includesAt(position.device_id, position.timestamp),
              ),
            }),
      }
    },
  }
}

/** Empty fail-closed scope used before participant state is hydrated. */
export const EMPTY_PARTICIPATION_SCOPE = createParticipationScope({
  participants: [],
  membershipEvents: [],
})

function windowContains(participant: MissionParticipant, timestamp: string): boolean {
  return (
    participant.effective_from <= timestamp &&
    (participant.removed_at === null || timestamp < participant.removed_at)
  )
}

/** Appends one value to a construction-time immutable-scope index. */
function appendIndexed<T>(index: Map<string, T[]>, key: string, value: T): void {
  const values = index.get(key) ?? []
  values.push(value)
  index.set(key, values)
}
