// Tracking warnings carry a fixed problem code from the place they are built,
// next to the operator text. Diagnostics read the codes and never parse the
// text: some warnings list device names (any characters at all), so reading a
// problem back out of the text could be fooled by a name [DON-327].

/** Fixed identifiers for every problem the tracking runtime can warn about. */
export type TrackingWarningCode =
  | 'auth_failed'
  | 'connection_restored'
  | 'history_incomplete'
  | 'history_loading'
  | 'history_reconciling'
  | 'history_refresh_failed'
  | 'history_rows_rejected'
  | 'history_storage_failed'
  | 'mission_paused'
  | 'mission_recovery'
  | 'mission_waiting'
  | 'offline_last_known'
  | 'offline_no_positions'
  | 'positions_rejected'
  | 'roster_refreshing'
  | 'roster_unavailable'
  | 'tracking_not_configured'
  | 'tracking_reconnecting'
  | 'tracking_reconnect_failed'
  | 'evidence_custody_unsettled'
  | 'persisted_breadcrumbs_dropped'
  | 'cache_update_failed'
  | 'cache_mission_mismatch'
  | 'cache_unreadable'
  | 'cached_operational_data'
  | 'mission_storage_failed'
  | 'participant_scope'
  /** A warning that reached the status without a code: reported, never dropped. */
  | 'unclassified'

/** One operator warning with the problem code assigned where it was built. */
export type TrackingWarning = {
  readonly code: TrackingWarningCode
  readonly text: string
}

/** The status fields a set of warnings produces. */
export type TrackingWarningFields = {
  readonly warning: string | null
  readonly warningCodes: readonly TrackingWarningCode[]
}

/**
 * Joins warnings into the operator text (unchanged: single spaces) and the
 * matching problem codes, without hiding any of them.
 *
 * @param warnings the active warnings in display order; null entries are skipped
 * @returns the combined text (null when none) and the codes in the same order
 */
export function combineTrackingWarnings(
  ...warnings: readonly (TrackingWarning | null)[]
): TrackingWarningFields {
  const active = warnings.filter((warning): warning is TrackingWarning => warning !== null)
  return {
    warning: active.length === 0 ? null : active.map((entry) => entry.text).join(' '),
    warningCodes: active.map((entry) => entry.code),
  }
}

/**
 * Adds further warnings after a status's own, keeping every code. A status
 * warning that arrived without codes is kept as `unclassified`, never dropped.
 *
 * @param base the status warning text and its codes (if any)
 * @param extras warnings to append in display order; null entries are skipped
 * @returns the combined text and codes
 */
export function appendTrackingWarnings(
  base: { readonly warning: string | null; readonly warningCodes?: readonly TrackingWarningCode[] | undefined },
  ...extras: readonly (TrackingWarning | null)[]
): TrackingWarningFields {
  const baseCodes: readonly TrackingWarningCode[] = base.warning === null
    ? []
    : base.warningCodes !== undefined && base.warningCodes.length > 0 ? base.warningCodes : ['unclassified']
  const added = combineTrackingWarnings(...extras)
  const texts = [base.warning, added.warning].filter((text): text is string => text !== null)
  return {
    warning: texts.length === 0 ? null : texts.join(' '),
    warningCodes: [...baseCodes, ...added.warningCodes],
  }
}
