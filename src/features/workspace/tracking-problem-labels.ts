import type { TrackingWarningCode } from '../tracking/tracking-warnings'

/**
 * How urgent each kind of problem is; lower shows first, so when the bar is
 * narrow the words that are cut to "+N more" are the least urgent. A person's
 * own safety comes first, then whether positions arrive at all, then the
 * mission record, then trail history, then the local cache.
 */
export const PROBLEM_RANK = {
  /** The map is not drawing the latest positions, for everyone at once [DON-357]. */
  mapNotUpdating: 5,
  stale: 10,
  notMoving: 11,
  rejected: 12,
  conflicting: 13,
  unverified: 14,
  hidden: 15,
  notMovingNoted: 16,
  connection: 20,
  roster: 23,
  unclassified: 26,
  record: 30,
  recordNoted: 39,
  history: 40,
  cache: 50,
} as const

/** The problem word for a saved tracking password or token that must be entered again. */
export const CREDENTIAL_REENTRY_WORD = 'Re-enter password'

/** The problem word for damaged saved settings that must be entered again (M-47). */
export const SETTINGS_REENTRY_WORD = 'Re-enter settings'

/** A short problem word and how urgent it is. */
export type RankedProblem = { readonly word: string; readonly rank: number }

/**
 * Short words for each runtime warning, shown first in the top bar so a
 * problem never hides behind the ellipsis of a long sentence. Null means the
 * warning only reassures or reports progress, so it may be cut short.
 */
const WARNING_LABELS: Readonly<Record<TrackingWarningCode, RankedProblem | null>> = {
  auth_failed: { word: 'Tracking login failed', rank: PROBLEM_RANK.connection },
  connection_restored: null,
  history_incomplete: { word: 'History incomplete', rank: PROBLEM_RANK.history + 2 },
  history_loading: null,
  history_reconciling: null,
  history_recheck_behind: { word: 'History recheck behind', rank: PROBLEM_RANK.history + 4 },
  history_refresh_failed: { word: 'History failed', rank: PROBLEM_RANK.history },
  history_rows_rejected: { word: 'History rows rejected', rank: PROBLEM_RANK.history + 3 },
  history_storage_failed: { word: 'History not saved', rank: PROBLEM_RANK.history + 1 },
  mission_paused: null,
  mission_recovery: null,
  mission_waiting: null,
  offline_last_known: { word: 'Offline', rank: PROBLEM_RANK.connection },
  offline_no_positions: { word: 'Offline, no positions', rank: PROBLEM_RANK.connection },
  positions_rejected: { word: 'Positions rejected', rank: PROBLEM_RANK.rejected },
  roster_refreshing: null,
  roster_unavailable: { word: 'Roster unavailable', rank: PROBLEM_RANK.roster },
  tracking_not_configured: { word: 'Not configured', rank: PROBLEM_RANK.connection + 3 },
  tracking_credentials_unreadable: { word: CREDENTIAL_REENTRY_WORD, rank: PROBLEM_RANK.connection },
  tracking_settings_unreadable: { word: SETTINGS_REENTRY_WORD, rank: PROBLEM_RANK.connection },
  tracking_reconnecting: { word: 'Reconnecting', rank: PROBLEM_RANK.connection + 2 },
  tracking_reconnect_failed: { word: 'Reconnect failed', rank: PROBLEM_RANK.connection + 1 },
  evidence_custody_unsettled: { word: 'Record unsettled', rank: PROBLEM_RANK.record + 2 },
  evidence_backpressure: { word: 'Record behind', rank: PROBLEM_RANK.record + 3 },
  persisted_breadcrumbs_dropped: { word: 'Trail points dropped', rank: PROBLEM_RANK.record + 4 },
  cache_update_failed: { word: 'Cache not updated', rank: PROBLEM_RANK.cache },
  cache_mission_mismatch: { word: 'Cache from another mission', rank: PROBLEM_RANK.cache + 1 },
  cache_unreadable: { word: 'Cache unreadable', rank: PROBLEM_RANK.cache + 2 },
  cached_operational_data: { word: 'Showing cached data', rank: PROBLEM_RANK.cache + 3 },
  mission_storage_failed: { word: 'Not saved', rank: PROBLEM_RANK.record },
  mission_storage_rows_rejected: { word: 'Fixes not saved', rank: PROBLEM_RANK.record + 1 },
  source_position_id_reused: { word: 'Position IDs reused', rank: PROBLEM_RANK.record + 5 },
  participant_scope: { word: 'People scope', rank: PROBLEM_RANK.roster + 1 },
  unclassified: { word: 'Tracking warning', rank: PROBLEM_RANK.unclassified },
}

/**
 * Turns a status warning's codes into ranked short problem words, without
 * repeats. A warning with no codes, or with a code this build does not know,
 * is still a problem: it is named, never dropped.
 *
 * @param warning the status warning text, or null when there is none
 * @param codes the problem codes the runtime assigned to that warning
 * @returns the ranked problem words; empty when every part only reassures
 */
export function rankTrackingWarning(
  warning: string | null,
  codes: readonly TrackingWarningCode[] | undefined,
): RankedProblem[] {
  if (warning === null) return []
  const known = codes !== undefined && codes.length > 0 ? codes : (['unclassified'] as const)
  const ranked: RankedProblem[] = []
  for (const code of known) {
    const label = code in WARNING_LABELS ? WARNING_LABELS[code] : WARNING_LABELS.unclassified
    if (label !== null && !ranked.some((entry) => entry.word === label.word)) ranked.push(label)
  }
  return ranked
}

/**
 * The short problem words for a status warning, in the runtime's order.
 *
 * @param warning the status warning text, or null when there is none
 * @param codes the problem codes the runtime assigned to that warning
 * @returns the short problem words; empty when every part only reassures
 */
export function labelTrackingWarning(
  warning: string | null,
  codes: readonly TrackingWarningCode[] | undefined,
): string[] {
  return rankTrackingWarning(warning, codes).map((entry) => entry.word)
}
