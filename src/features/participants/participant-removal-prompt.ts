/**
 * The question Remove asks before a group or person stops being tracked
 * during a running mission (DON-373). Kept out of the component so the
 * wording and the people count are one tested rule.
 */

/** The parts of a mission participant the removal question needs. */
export type RemovalPromptParticipant = {
  readonly kind: 'device' | 'group'
  readonly traccar_group_id?: string | null
}

/** A Traccar device as far as counting group members goes. */
export type RemovalPromptDevice = {
  readonly group_id?: string | null
}

/**
 * How many people stop being tracked if this participant is removed, or
 * `null` when that cannot be known honestly (no group id, or the Traccar
 * device list could not be read). A single device is always one person.
 * Group members are counted the same way as the Start picker counts them.
 */
export function removalPeopleCount(
  participant: RemovalPromptParticipant,
  devices: readonly RemovalPromptDevice[],
  catalogueReadable: boolean,
): number | null {
  if (participant.kind === 'device') return 1
  const groupId = participant.traccar_group_id ?? null
  if (groupId === null || !catalogueReadable) return null
  return devices.filter((device) => device.group_id === groupId).length
}

/**
 * The confirm wording, for example
 * "Stop tracking KMRT (34 people)? Their positions stop being recorded."
 * An unknown count is said plainly rather than guessed.
 */
export function removalPromptText(label: string, peopleCount: number | null): string {
  const people = peopleCount === null
    ? 'number of people not known'
    : `${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}`
  return `Stop tracking ${label} (${people})? Their positions stop being recorded.`
}
