/**
 * The question Remove asks before a group or person stops being tracked
 * during a running mission (DON-373). The count is the effect of removing
 * that row on the mission's recording scope, so it agrees with who the
 * runtime actually records: held group members count, and a person still
 * covered by another group or row does not.
 */
import type {
  GroupMembershipEvent,
  MissionParticipant,
  ParticipantBackfillCheckpoint,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { createParticipationScope } from './participation-scope'

/** What removing one participant row would do now, as the runtime sees it. */
export type ParticipantRemovalPreview = {
  /** Devices recorded now that would no longer be recorded after removal. */
  readonly stopsTrackingCount: number
  /**
   * True when the latest Traccar roster was read completely from a live poll
   * and every membership change is saved, so no group member can be missing
   * from the count. False means the count may be low.
   */
  readonly rosterConfirmed: boolean
}

/**
 * Lists the devices recorded at `at` that would stop being recorded if the
 * participant were removed at `at`. Uses the durable recording scope only:
 * a group member seen on the live roster but not yet saved is drawn on the
 * map but not recorded, so it neither counts nor keeps anyone covered.
 * Returns null when the participant is not an active row of this mission.
 */
export function devicesStoppingOnRemoval(input: {
  readonly participants: readonly MissionParticipant[]
  readonly membershipEvents: readonly GroupMembershipEvent[]
  readonly backfillCheckpoints: readonly ParticipantBackfillCheckpoint[]
  readonly participantId: string
  readonly at: string
}): readonly string[] | null {
  const target = input.participants.find((participant) => participant.id === input.participantId)
  if (target === undefined || target.removed_at !== null) return null
  const before = createParticipationScope({
    participants: input.participants,
    membershipEvents: input.membershipEvents,
    backfillCheckpoints: input.backfillCheckpoints,
  }).activeDeviceIdsAt(input.at)
  const after = new Set(createParticipationScope({
    participants: input.participants.map((participant) =>
      participant.id === input.participantId ? { ...participant, removed_at: input.at } : participant),
    membershipEvents: input.membershipEvents,
    backfillCheckpoints: input.backfillCheckpoints,
  }).activeDeviceIdsAt(input.at))
  return before.filter((deviceId) => !after.has(deviceId))
}

/**
 * A preview is only confirmed while tracking is live: when polls fail the
 * roster is the last good one replayed, so a group count may be out of date.
 */
export function previewWhileTracking(
  preview: ParticipantRemovalPreview | null,
  trackingOnline: boolean,
): ParticipantRemovalPreview | null {
  if (preview === null || trackingOnline) return preview
  return { ...preview, rosterConfirmed: false }
}

/**
 * The confirm wording, for example
 * "Stop tracking KMRT (34 people)? Their positions stop being recorded."
 * A group count from an unconfirmed roster is given as "at least"; when it
 * cannot be known at all it is said plainly rather than guessed. Removing a
 * row that tracks nobody on its own says so.
 */
export function removalPromptText(
  label: string,
  kind: 'device' | 'group',
  preview: ParticipantRemovalPreview | null,
): string {
  const consequence = 'Their positions stop being recorded.'
  if (preview === null) return `Stop tracking ${label} (number of people not known)? ${consequence}`
  const count = preview.stopsTrackingCount
  const people = `${count} ${count === 1 ? 'person' : 'people'}`
  if (kind === 'group' && !preview.rosterConfirmed) {
    return count === 0
      ? `Stop tracking ${label} (number of people not known)? ${consequence}`
      : `Stop tracking ${label} (at least ${people})? ${consequence}`
  }
  if (count === 0) {
    return `Remove ${label} from this mission? No one stops being tracked: nobody is tracked only through ${label}.`
  }
  return `Stop tracking ${label} (${people})? ${consequence}`
}
