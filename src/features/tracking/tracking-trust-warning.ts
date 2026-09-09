/** Recognizes existing critical cache/suspended-refresh messages consistently across views. */
export function isCriticalTrackingTrustWarning(warning: string | null): boolean {
  return warning !== null && /offline mode|live refresh suspended/i.test(warning)
}

/** Projects existing history/retention warnings into the coverage view without changing tracking state. */
export function historyCompletenessWarning(warning: string | null): string | null {
  return warning !== null && /history|breadcrumb/i.test(warning) ? warning : null
}
