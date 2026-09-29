/**
 * Where a participant added during a mission starts contributing evidence.
 *
 * A mission started with a lookback only fetches earlier provider history for
 * participants whose effective time reaches back into that window. Adding a
 * participant after Start therefore needs an explicit coordinator decision:
 * there is no silent default, because "now" discards the lookback while
 * "mission start" could attribute a genuine late joiner's earlier travel.
 */
export type ParticipantHistoryStart = 'mission-start' | 'now' | 'custom'

export type ParticipantEffectiveFromResolution =
  | { readonly ok: true; readonly effectiveFrom: string | undefined }
  | { readonly ok: false; readonly message: string }

/**
 * Resolves the coordinator's history-start choice into the participant store's
 * optional `effective_from`. `undefined` means the store stamps the add time.
 * The store remains the authority that rejects times before mission start.
 */
export function resolveParticipantEffectiveFrom(input: {
  readonly choice: ParticipantHistoryStart | null
  readonly missionStartTime: string | null
  readonly customLocalDateTime: string
}): ParticipantEffectiveFromResolution {
  switch (input.choice) {
    case null:
      return {
        ok: false,
        message: 'Choose where this participant’s history starts: from mission start, from now, or a custom time.',
      }
    case 'mission-start':
      if (input.missionStartTime === null || !Number.isFinite(Date.parse(input.missionStartTime))) {
        return {
          ok: false,
          message: 'Mission start time is unavailable. Choose From now or enter a custom time.',
        }
      }
      return { ok: true, effectiveFrom: input.missionStartTime }
    case 'now':
      return { ok: true, effectiveFrom: undefined }
    case 'custom': {
      const local = input.customLocalDateTime.trim()
      const parsed = local === '' ? Number.NaN : new Date(local).getTime()
      if (!Number.isFinite(parsed)) {
        return { ok: false, message: 'Enter a valid custom history start time.' }
      }
      return { ok: true, effectiveFrom: new Date(parsed).toISOString() }
    }
  }
}

/** True when the participant's evidence window starts before the moment it was added. */
export function participantRequestedEarlierHistory(participant: {
  readonly effective_from: string
  readonly added_at: string
}): boolean {
  return Date.parse(participant.effective_from) < Date.parse(participant.added_at)
}
