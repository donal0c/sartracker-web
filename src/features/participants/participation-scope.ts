import type {
  GroupMembershipEvent,
  MissionParticipant,
  ParticipantBackfillCheckpoint,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { TrackingSnapshot } from '../tracking/tracking-types'

export type ParticipationScope = {
  readonly includesAt: (deviceId: string, timestamp: string) => boolean
  readonly firstEvidenceTimestampAtOrAfter: (
    deviceId: string,
    from: string,
    through: string,
  ) => string | null
  readonly activeDeviceIdsAt: (timestamp: string) => readonly string[]
  /** Current-map scope, including newly observed selected-group members awaiting durable audit. */
  readonly operationalDeviceIdsAt: (timestamp: string) => readonly string[]
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
  readonly backfillCheckpoints?: readonly ParticipantBackfillCheckpoint[]
  readonly observedCurrentDeviceIds?: readonly string[]
}): ParticipationScope {
  const directParticipantsByDevice = new Map<string, MissionParticipant[]>()
  const groupParticipantsByTeam = new Map<string, MissionParticipant[]>()
  const membershipEventsByDevice = new Map<string, GroupMembershipEvent[]>()
  const backfillCheckpointsByDevice = new Map<string, ParticipantBackfillCheckpoint[]>()
  const candidateDeviceIds = new Set<string>()
  const observedCurrentDeviceIds = new Set(input.observedCurrentDeviceIds ?? [])

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
  for (const checkpoint of input.backfillCheckpoints ?? []) {
    appendIndexed(backfillCheckpointsByDevice, checkpoint.traccar_device_id, checkpoint)
    candidateDeviceIds.add(checkpoint.traccar_device_id)
  }
  for (const events of membershipEventsByDevice.values()) {
    events.sort((left, right) =>
      right.observed_at.localeCompare(left.observed_at) || right.sequence - left.sequence)
  }

  function includesAt(deviceId: string, timestamp: string): boolean {
    if (directParticipantsByDevice.get(deviceId)?.some(
      (participant) => windowContains(participant, timestamp),
    ) === true) return true
    if (backfillCheckpointsByDevice.get(deviceId)?.some(
      (checkpoint) => checkpoint.window_from <= timestamp && timestamp < checkpoint.window_to,
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

  function firstEvidenceTimestampAtOrAfter(
    deviceId: string,
    from: string,
    through: string,
  ): string | null {
    if (from > through) return null
    const boundaries = new Set<string>([from])
    for (const participant of directParticipantsByDevice.get(deviceId) ?? []) {
      boundaries.add(participant.effective_from)
      if (participant.removed_at !== null) boundaries.add(participant.removed_at)
    }
    for (const checkpoint of backfillCheckpointsByDevice.get(deviceId) ?? []) {
      boundaries.add(checkpoint.window_from)
      boundaries.add(checkpoint.window_to)
    }
    for (const event of membershipEventsByDevice.get(deviceId) ?? []) {
      boundaries.add(event.observed_at)
      for (const participant of groupParticipantsByTeam.get(event.mission_team_id) ?? []) {
        boundaries.add(participant.effective_from)
        if (participant.removed_at !== null) boundaries.add(participant.removed_at)
      }
    }
    for (const boundary of [...boundaries].sort()) {
      if (boundary < from || boundary > through) continue
      if (includesAt(deviceId, boundary)) return boundary
    }
    return null
  }

  function operationalDeviceIdsAt(timestamp: string): readonly string[] {
    return [...new Set([
      ...activeDeviceIdsAt(timestamp),
      ...observedCurrentDeviceIds,
    ])].sort()
  }

  return {
    includesAt,
    firstEvidenceTimestampAtOrAfter,
    activeDeviceIdsAt,
    operationalDeviceIdsAt,
    filterSnapshot: (snapshot, observedAt = new Date().toISOString()) => {
      const activeDeviceIds = new Set(operationalDeviceIdsAt(observedAt))
      const visiblePositions = snapshot.positions.filter((position) =>
        activeDeviceIds.has(position.device_id) ||
        (position.device_cache_stale !== true && includesAt(position.device_id, position.timestamp)))
      const visibleDeviceIds = new Set([
        ...activeDeviceIds,
        ...visiblePositions.map((position) => position.device_id),
      ])
      return {
        ...snapshot,
        devices: snapshot.devices.filter((device) => visibleDeviceIds.has(device.device_id)),
        // Current positions describe where selected participants are now. Their
        // source fix can predate a late selection or observation-time group
        // membership change, so historical evidence windows must not hide them.
        positions: visiblePositions,
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
  backfillCheckpoints: [],
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
