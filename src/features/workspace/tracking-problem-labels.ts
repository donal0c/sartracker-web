import type { TrackingWarningCode } from '../tracking/tracking-warnings'

/**
 * Short words for each runtime warning, shown first in the top bar so a
 * problem never hides behind the ellipsis of a long sentence. Null means the
 * warning only reassures or reports progress, so it may be cut short.
 */
const WARNING_LABELS: Readonly<Record<TrackingWarningCode, string | null>> = {
  auth_failed: 'Tracking login failed',
  connection_restored: null,
  history_incomplete: 'History incomplete',
  history_loading: null,
  history_reconciling: null,
  history_recheck_behind: 'History recheck behind',
  history_refresh_failed: 'History failed',
  history_rows_rejected: 'History rows rejected',
  history_storage_failed: 'History not saved',
  mission_paused: null,
  mission_recovery: null,
  mission_waiting: null,
  offline_last_known: 'Offline',
  offline_no_positions: 'Offline, no positions',
  positions_rejected: 'Positions rejected',
  roster_refreshing: null,
  roster_unavailable: 'Roster unavailable',
  tracking_not_configured: 'Not configured',
  tracking_reconnecting: 'Reconnecting',
  tracking_reconnect_failed: 'Reconnect failed',
  evidence_custody_unsettled: 'Record unsettled',
  evidence_backpressure: 'Record behind',
  persisted_breadcrumbs_dropped: 'Trail points dropped',
  cache_update_failed: 'Cache not updated',
  cache_mission_mismatch: 'Cache from another mission',
  cache_unreadable: 'Cache unreadable',
  cached_operational_data: 'Showing cached data',
  mission_storage_failed: 'Not saved',
  mission_storage_rows_rejected: 'Fixes not saved',
  source_position_id_reused: 'Position IDs reused',
  participant_scope: 'People scope',
  unclassified: 'Tracking warning',
}

/**
 * Turns a status warning's codes into short problem words, in order and
 * without repeats. A warning with no codes is still a problem: it is named,
 * never dropped.
 *
 * @param warning the status warning text, or null when there is none
 * @param codes the problem codes the runtime assigned to that warning
 * @returns the short problem words; empty when every part only reassures
 */
export function labelTrackingWarning(
  warning: string | null,
  codes: readonly TrackingWarningCode[] | undefined,
): string[] {
  if (warning === null) return []
  const known = codes !== undefined && codes.length > 0 ? codes : (['unclassified'] as const)
  const labels: string[] = []
  for (const code of known) {
    // A code this build does not know is still a problem, so it is named.
    const label = code in WARNING_LABELS ? WARNING_LABELS[code] : 'Tracking warning'
    if (label !== null && !labels.includes(label)) labels.push(label)
  }
  return labels
}
