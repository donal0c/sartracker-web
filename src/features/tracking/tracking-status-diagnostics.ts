// Fixed identifiers for the tracking warnings the poller can show. A status
// breadcrumb names the problem with these, never with the warning text: some
// warnings list device names (which are team members' names and may contain
// any character), and during a history catch-up that list shrinks as each
// device finishes, which is one problem, not twenty [DON-321].

/**
 * The two warnings that embed device names, each matched whole up to its
 * fixed ending, so a device named like another warning is never read as one.
 * Known limit: a device name that itself contains that ending can still
 * mislabel the breadcrumb (diagnostics only; names are never recorded).
 * Problem codes emitted at the warning source would remove it.
 */
const NAMED_TRACKING_WARNINGS: readonly (readonly [id: string, pattern: RegExp])[] = [
  ['history_incomplete', /Breadcrumb history incomplete for [\s\S]*?; (?:retrying while )?current fixes remain live\./gu],
  ['history_reconciling', /Breadcrumb history is reconciling for [\s\S]*?; current fixes remain live\./gu],
]

/** Warnings with fixed text, matched once the named ones are taken out. */
const KNOWN_TRACKING_WARNINGS: readonly (readonly [id: string, pattern: RegExp])[] = [
  ['auth_failed', /TRACKING AUTHENTICATION FAILED/u],
  ['connection_restored', /CONNECTION RESTORED/u],
  ['history_loading', /loading breadcrumb history/u],
  ['history_refresh_failed', /BREADCRUMB HISTORY REFRESH FAILED/u],
  ['history_rows_rejected', /BREADCRUMB EVIDENCE WARNING/u],
  ['history_storage_failed', /Breadcrumb history could not be loaded from mission storage/u],
  ['mission_paused', /Live refresh suspended while mission is paused/u],
  ['mission_recovery', /Resume mission to reconnect/u],
  ['mission_waiting', /Waiting for an active mission/u],
  ['offline_last_known', /OFFLINE MODE — showing last known positions/u],
  ['offline_no_positions', /OFFLINE MODE — no current positions/u],
  ['positions_rejected', /POSITION DATA REJECTED/u],
  ['roster_refreshing', /refreshing device roster/u],
  ['roster_unavailable', /DEVICE ROSTER UNAVAILABLE/u],
]

/** What a status breadcrumb records about the warning shown. */
export type TrackingWarningDiagnostic = {
  /** Sorted problem identifiers joined by "+", or "unclassified". */
  readonly warning: string
  /** Distinguishes unrecognised warnings without recording their text. */
  readonly warningDigest?: string
}

/**
 * Describes the shown warning for a diagnostic breadcrumb and its dedupe key.
 *
 * @param warning the operator-facing warning, or null when none is shown
 * @returns fixed problem identifiers (plus a digest when unrecognised), or null
 */
export function describeTrackingWarningForDiagnostics(warning: string | null): TrackingWarningDiagnostic | null {
  if (warning === null) return null
  // Take out the name-bearing warnings first; only fixed text is left to read.
  let rest = warning
  const ids: string[] = []
  for (const [id, pattern] of NAMED_TRACKING_WARNINGS) {
    const stripped = rest.replace(pattern, ' ')
    if (stripped !== rest) ids.push(id)
    rest = stripped
  }
  ids.push(...KNOWN_TRACKING_WARNINGS.filter(([, pattern]) => pattern.test(rest)).map(([id]) => id))
  if (ids.length > 0) return { warning: [...ids].sort().join('+') }
  return { warning: 'unclassified', warningDigest: digest(warning) }
}

/** FNV-1a 32-bit digest as 8 hex digits. */
function digest(text: string): string {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
