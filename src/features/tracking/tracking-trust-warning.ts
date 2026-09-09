/** Recognizes existing critical cache/suspended-refresh messages consistently across views. */
export function isCriticalTrackingTrustWarning(warning: string | null): boolean {
  return warning !== null && /offline mode|live refresh suspended/i.test(warning)
}
