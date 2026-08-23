import type {
  GroupMembershipEvent,
  MissionParticipant,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { TrackingSnapshot } from '../tracking/tracking-types'

export type ParticipationScope = {
  readonly includesAt: (deviceId: string, timestamp: string) => boolean
  readonly activeDeviceIdsAt: (timestamp: string) => readonly string[]
  readonly filterSnapshot: (snapshot: TrackingSnapshot) => TrackingSnapshot
}

/**
 * Builds an immutable in-memory participation policy. No per-fix store query is
 * needed: direct windows and append-only group observations are evaluated here.
 */
export function createParticipationScope(input: {
  readonly participants: readonly MissionParticipant[]
  readonly membershipEvents: readonly GroupMembershipEvent[]
}): ParticipationScope {
  const participants = [...input.participants]
  const membershipEvents = [...input.membershipEvents]

  function includesAt(deviceId: string, timestamp: string): boolean {
    const direct = participants.some((participant) =>
      participant.kind === 'device' &&
      participant.traccar_device_id === deviceId &&
      windowContains(participant, timestamp))
    if (direct) return true

    return participants.some((participant) => {
      if (
        participant.kind !== 'group' ||
        participant.mission_team_id === null ||
        !windowContains(participant, timestamp)
      ) {
        return false
      }
      const latest = membershipEvents
        .filter((event) =>
          event.mission_team_id === participant.mission_team_id &&
          event.traccar_device_id === deviceId &&
          event.observed_at <= timestamp)
        .toSorted((left, right) =>
          right.observed_at.localeCompare(left.observed_at) || right.id.localeCompare(left.id))[0]
      return latest?.change === 'member'
    })
  }

  function activeDeviceIdsAt(timestamp: string): readonly string[] {
    const candidates = new Set<string>()
    for (const participant of participants) {
      if (participant.traccar_device_id !== null) candidates.add(participant.traccar_device_id)
    }
    for (const event of membershipEvents) candidates.add(event.traccar_device_id)
    return [...candidates].filter((deviceId) => includesAt(deviceId, timestamp)).sort()
  }

  return {
    includesAt,
    activeDeviceIdsAt,
    filterSnapshot: (snapshot) => {
      const referenceTimestamp = latestSnapshotTimestamp(snapshot) ?? new Date().toISOString()
      const activeDeviceIds = new Set(activeDeviceIdsAt(referenceTimestamp))
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

function latestSnapshotTimestamp(snapshot: TrackingSnapshot): string | null {
  const timestamps = [...snapshot.positions, ...snapshot.breadcrumbs].map(
    (position) => position.timestamp,
  )
  return timestamps.length === 0 ? null : timestamps.sort().at(-1) ?? null
}
