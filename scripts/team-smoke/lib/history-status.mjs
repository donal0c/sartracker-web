/**
 * Reads the participant "Earlier positions" lines (participant-backfill-status)
 * in both the simplified wording (DON-368) and the original one, so the release
 * smoke checks follow what the operator sees. Unit-tested against the rendered
 * panel in tests/unit/participant-controls-section.test.ts.
 */

/**
 * @param {string} status one participant-backfill-status line
 * @returns {boolean} the requested earlier positions have all loaded
 */
export function historyLoaded(status) {
  return /Earlier positions: loaded\b|\bcomplete\b/i.test(status)
}

/**
 * @param {string} status one participant-backfill-status line
 * @returns {boolean} earlier positions are still being fetched (including during an outage)
 */
export function historyStillLoading(status) {
  return /still loading|Earlier positions: loading for|pending|retrying/i.test(status)
}

/**
 * @param {string} status one participant-backfill-status line
 * @returns {boolean} no earlier positions were asked for, so there is nothing to wait for
 */
export function noEarlierHistoryAsked(status) {
  return /no earlier ones asked for|no earlier history requested/i.test(status)
}

/**
 * @param {string} status one participant-backfill-status line
 * @returns {boolean} nothing more to wait for: loaded, or none asked for
 */
export function historySettled(status) {
  return historyLoaded(status) || noEarlierHistoryAsked(status)
}
