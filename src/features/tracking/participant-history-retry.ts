/** What asking participant history to retry now achieved (DON-376). */
export type ParticipantHistoryRetryOutcome =
  /** A fetch starts now (or right after the one already running). */
  | { readonly kind: 'started'; readonly unfetchableDeviceCount: number }
  /** Nothing is left to fetch: every earlier track has loaded. */
  | { readonly kind: 'complete' }
  /** No fetch can start; the reason is in words a volunteer can act on. */
  | { readonly kind: 'unavailable'; readonly reason: string }

/** Said when no tracking connection exists to fetch participant history with. */
export const PARTICIPANT_HISTORY_RETRY_NOT_CONNECTED: ParticipantHistoryRetryOutcome = Object.freeze({
  kind: 'unavailable',
  reason: 'Tracking is not connected. Check the tracking server in Settings.',
})
