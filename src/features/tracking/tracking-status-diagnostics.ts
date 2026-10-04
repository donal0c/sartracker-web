// A status breadcrumb names the shown tracking warning with the fixed problem
// codes assigned where the warning is built (see tracking-warnings.ts), never
// by reading its text: some warnings list device names (team members' names,
// which may contain any character), and during a history catch-up that list
// shrinks as each device finishes, which is one problem, not twenty
// [DON-321][DON-327].

import type { TrackingConnectionStatus } from './tracking-types'

/** What a status breadcrumb records about the warning shown. */
export type TrackingWarningDiagnostic = {
  /** Sorted, de-duplicated problem codes joined by "+", or "unclassified". */
  readonly warning: string
  /** Distinguishes unrecognised warnings without recording their text. */
  readonly warningDigest?: string
}

/**
 * Describes the shown warning for a diagnostic breadcrumb and its dedupe key.
 * A warning with no codes (or one coded `unclassified`) is still reported, as
 * "unclassified" with a digest, so a new uncoded warning is never invisible.
 *
 * @param status the status carrying the operator warning and its problem codes
 * @returns problem codes (plus a digest when unclassified), or null when no warning is shown
 */
export function describeTrackingWarningForDiagnostics(
  status: Pick<TrackingConnectionStatus, 'warning' | 'warningCodes'>,
): TrackingWarningDiagnostic | null {
  if (status.warning === null) return null
  const codes = [...new Set(status.warningCodes ?? [])]
  if (codes.length === 0 || codes.includes('unclassified')) {
    return { warning: 'unclassified', warningDigest: digest(status.warning) }
  }
  return { warning: codes.sort().join('+') }
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
