/** What asking participant history to retry now achieved (DON-376). */
export type ParticipantHistoryRetryOutcome =
  | { readonly kind: 'started' }
  | { readonly kind: 'unavailable'; readonly reason: string }

/** Said when no tracking connection exists to fetch participant history with. */
export const PARTICIPANT_HISTORY_RETRY_NOT_CONNECTED: ParticipantHistoryRetryOutcome = Object.freeze({
  kind: 'unavailable',
  reason: 'Tracking is not connected. Check the tracking server in Settings.',
})
