/**
 * Pure safety predicates shared by exact-artifact release smoke scripts.
 */

const RECONCILIATION_WARNING =
  /(?:current fixes loaded; loading breadcrumb history|breadcrumb history (?:is reconciling|incomplete|could not be loaded)|breadcrumb reconciliation failed)/iu

/**
 * Returns whether tracking status still reports incomplete or failed
 * breadcrumb history reconciliation.
 *
 * @param {string} statusText
 * @returns {boolean}
 */
export function hasBreadcrumbReconciliationWarning(statusText) {
  return RECONCILIATION_WARNING.test(statusText)
}

/**
 * Compares complete filename, byte-size, and SHA-256 snapshots.
 *
 * @param {Record<string, {bytes: number, sha256: string}>} before
 * @param {Record<string, {bytes: number, sha256: string}>} after
 * @returns {boolean}
 */
export function fileSnapshotsMatch(before, after) {
  const beforeNames = Object.keys(before).sort()
  const afterNames = Object.keys(after).sort()
  if (beforeNames.length !== afterNames.length) {
    return false
  }
  for (let index = 0; index < beforeNames.length; index += 1) {
    const name = beforeNames[index]
    if (name !== afterNames[index]) {
      return false
    }
    if (
      before[name].bytes !== after[name].bytes ||
      before[name].sha256 !== after[name].sha256
    ) {
      return false
    }
  }
  return true
}
