/**
 * What the WAR-06 mission-boundary probe may treat as observed on the map
 * (DON-353). Kept apart from the probe so the rules are unit-tested.
 *
 * A map reading is one of these states:
 * - `ready`: the tracking source was read and the renderer reported tracking
 *   shown on the map, so its device points are exactly the tracking snapshot's
 *   positions. Only these count as proof, and only with both counts present.
 * - `hidden`: the source was read, but tracking is hidden on the map, which
 *   feeds the map an empty snapshot (use-map-overlays.ts), so a zero proves
 *   nothing.
 * - `unconfirmed`: the source was read, but the renderer did not say whether
 *   tracking is shown.
 * - `pending`: the source was read, but an update to it was queued or in
 *   progress before or after the read. MapLibre applies updates
 *   asynchronously and getData() returns the old payload until then, so the
 *   renderer can already report tracking shown while the source still holds
 *   the empty stand-in.
 * - `failed`: the tracking source reported an error during this observation.
 *   A rejected worker update leaves loaded() true and the old payload in
 *   place, so nothing read from the source afterwards can be trusted. This
 *   never happens in a healthy run, so it fails the probe with the error text.
 * - `uncaptured`: the renderer is not reporting the tracking source's errors
 *   (window.__SARTRACKER_TRACKING_SOURCE_ERRORS__, written by
 *   src/features/map/tracking-source-error-report.ts from the moment the map
 *   is created), so a failed update could go unseen.
 * - `not-drawn`: no map or no tracking source.
 * - `unreadable`: the source exists but could not be read, or the read threw.
 *
 * Any drawn device point counts towards the maxima whatever the state: a
 * point on the map is a leak whether or not visibility was confirmed.
 *
 * The map may take a while to start, so startup is measured apart and the
 * probe waits for a ready reading before acting. From the first ready reading
 * on, anything but a ready reading is missing evidence. A read captures the map
 * at some instant between when it starts (`at`) and when it completes
 * (`doneAt`), so the blind stretch between two ready readings runs from the
 * earlier one's start to the later one's completion, and the stretch after the
 * last one counts too.
 */

/** Longest stretch the probe may go without seeing the map before a leak counts as unproven. */
export const MAX_UNOBSERVED_GAP_MS = 2_000

/**
 * Reads the map's tracking source in the renderer, with whether tracking is
 * shown on the map. A reading is ready only if the source had no update
 * pending both before and after the read, the same source was there
 * throughout, and the renderer reported tracking shown both times.
 * Self-contained, because Playwright sends its source text to the page.
 *
 * @returns {Promise<{ state: 'ready' | 'hidden' | 'unconfirmed' | 'pending', fixes: number, cache: number, attention: number }
 *   | { state: 'not-drawn' | 'unreadable', reason: string }>} the reading
 */
export async function readTrackingSourceInPage() {
  // The renderer's own report of the tracking source's errors since the map
  // was created. Any entry fails the reading; a missing report is blind.
  const failed = () => {
    const errors = window.__SARTRACKER_TRACKING_SOURCE_ERRORS__
    return Array.isArray(errors) && errors.length > 0
      ? { state: 'failed', reason: `the tracking source reported an error: ${errors[0]}`, errors: [...errors] }
      : null
  }
  const map = window.__SARTRACKER_MAP__
  if (map === undefined || map === null) return failed() ?? { state: 'not-drawn', reason: 'no map' }
  if (failed() !== null) return failed()
  if (!Array.isArray(window.__SARTRACKER_TRACKING_SOURCE_ERRORS__)) {
    return { state: 'uncaptured', reason: 'the renderer is not reporting tracking-source errors, so a failed update could be missed' }
  }
  const source = map.getSource('tracking')
  if (source === undefined || source === null) return { state: 'not-drawn', reason: 'no tracking source' }
  // Read before and after the data, so a change while reading cannot confirm
  // data drawn under the other setting or before a pending update landed.
  const settled = () => typeof source.loaded === 'function' && source.loaded() === true
  const settledBefore = settled()
  const visibleBefore = window.__SARTRACKER_TRACKING_VISIBLE__
  let data
  try {
    data = typeof source.getData === 'function'
      ? await source.getData()
      : typeof source.serialize === 'function' ? source.serialize()?.data : undefined
  } catch (error) {
    return { state: 'unreadable', reason: String(error?.message ?? error).slice(0, 200) }
  }
  if (data === undefined || data === null || !Array.isArray(data.features)) {
    return { state: 'unreadable', reason: 'the tracking source has no feature list' }
  }
  if (failed() !== null) return failed()
  const settledAfter = settled()
  const visibleAfter = window.__SARTRACKER_TRACKING_VISIBLE__
  if (map.getSource('tracking') !== source) return { state: 'unreadable', reason: 'the tracking source was replaced during the read' }
  const points = data.features.filter((feature) => feature?.properties?.featureKind === 'device')
  const counts = {
    fixes: points.length,
    cache: points.filter((feature) => feature.properties.dataOrigin === 'cache').length,
    attention: points.filter((feature) => feature.properties.attention === true).length,
  }
  if (visibleBefore === false || visibleAfter === false) return { state: 'hidden', reason: 'tracking is hidden on the map', ...counts }
  if (visibleBefore !== true || visibleAfter !== true) {
    return { state: 'unconfirmed', reason: 'the renderer did not report whether tracking is shown', ...counts }
  }
  if (!settledBefore || !settledAfter) {
    return { state: 'pending', reason: 'an update to the tracking source was pending, so it may still hold old data', ...counts }
  }
  return { state: 'ready', ...counts }
}

/**
 * Reduces one continuous observation to counts and its longest blind stretch.
 *
 * @param {ReadonlyArray<{ state?: string, at?: number, doneAt?: number,
 *   currentFixCount?: number | null, cachedDeviceCount?: number | null,
 *   mapAttentionCount?: number | null, stationaryAttention?: string, warning?: string } | null | undefined>} samples
 *   the readings, in any order
 * @param {{ startedAt: number, endedAt: number, actionStartedAt?: number }} window
 *   when the observation began and ended, and when the observed action began
 * @param {string} [actionWarning] a warning the observed action itself returned
 * @param {string} [discardWarning] the warning text that counts as a discard sighting
 */
export function summarizeSurfaceSamples(samples, window, actionWarning = '', discardWarning = '') {
  if (!Number.isFinite(window?.startedAt) || !Number.isFinite(window?.endedAt) || window.endedAt < window.startedAt) {
    throw new Error('The observation has no valid start and end, so its blind stretches cannot be measured.')
  }
  const counted = (sample) => Number.isFinite(sample.currentFixCount) && Number.isFinite(sample.cachedDeviceCount)
  const valid = samples.filter((sample) => sample !== null && sample !== undefined)
  const timed = valid.filter((sample) => Number.isFinite(sample.at) && Number.isFinite(sample.doneAt) && sample.doneAt >= sample.at)
  const ready = timed.filter((sample) => sample.state === 'ready' && counted(sample))
    .sort((left, right) => left.at - right.at)
  const first = ready[0]
  let longestGapMs = window.endedAt - window.startedAt
  if (first !== undefined) {
    longestGapMs = 0
    let lastSeenFrom = first.at
    for (const sample of ready) {
      longestGapMs = Math.max(longestGapMs, sample.doneAt - lastSeenFrom)
      lastSeenFrom = Math.max(lastSeenFrom, sample.at)
    }
    longestGapMs = Math.max(longestGapMs, window.endedAt - lastSeenFrom)
  }
  const drawn = valid.filter(counted)
  const ofState = (state) => timed.filter((sample) => sample.state === state).length
  const warningSeen = (text) => discardWarning !== '' && (text ?? '').includes(discardWarning)
  return {
    sampleCount: valid.length,
    readableCount: ready.length,
    invalidCount: timed.filter((sample) => sample.state === 'ready' && !counted(sample)).length,
    hiddenCount: ofState('hidden'),
    unconfirmedCount: ofState('unconfirmed'),
    pendingCount: ofState('pending'),
    uncapturedCount: ofState('uncaptured'),
    trackingSourceErrors: [...new Set(valid.filter((sample) => sample.state === 'failed')
      .map((sample) => sample.map?.reason ?? sample.reason ?? 'the tracking source reported an error'))],
    notDrawnCount: ofState('not-drawn'),
    notDrawnAfterReadyCount: first === undefined ? 0 : timed.filter((sample) => sample.state === 'not-drawn' && sample.at > first.at).length,
    unreadableCount: ofState('unreadable'),
    untimedCount: valid.length - timed.length,
    startupMs: first === undefined ? null : first.doneAt - window.startedAt,
    readyBeforeAction: first !== undefined && (!Number.isFinite(window.actionStartedAt) || first.doneAt <= window.actionStartedAt),
    longestGapMs,
    window: { startedAt: window.startedAt, actionStartedAt: window.actionStartedAt ?? null, endedAt: window.endedAt },
    first: valid[0] ?? null,
    last: valid.at(-1) ?? null,
    maxCurrentFixCount: drawn.length === 0 ? null : Math.max(...drawn.map((sample) => sample.currentFixCount)),
    maxCachedDeviceCount: drawn.length === 0 ? null : Math.max(...drawn.map((sample) => sample.cachedDeviceCount)),
    discardWarningObserved: warningSeen(actionWarning) || valid.some((sample) => warningSeen(sample.warning)),
    attentionObserved: valid.some((sample) => (sample.stationaryAttention ?? '') !== '' || (sample.mapAttentionCount ?? 0) > 0),
  }
}

const TRACKING_GROUP_NODE_ID = 'group:tracking'
const TRACKING_DEVICES_LAYER_NODE_ID = 'layer:tracking:devices'

/**
 * Names the saved layer-catalog entries that hide tracking positions: the
 * Tracking group, the Location layer, or one person's location under it.
 * Evidence only: the probe proves visibility from the renderer on every
 * reading, because loading the catalog changes it without a click.
 *
 * @param {ReadonlyArray<{ nodeId: string, parentNodeId?: string | null, isVisible: boolean }>} entries
 *   the mission's saved layer-catalog entries, as the layer catalog IPC returns them
 * @returns {string[]} the hiding entries' node ids
 */
export function trackingNodesHiddenInCatalog(entries) {
  for (const entry of entries) {
    if (typeof entry?.nodeId !== 'string' || typeof entry.isVisible !== 'boolean') {
      throw new Error(`A saved layer-catalog entry cannot be read (${JSON.stringify(entry).slice(0, 200)}), so tracking visibility is unknown.`)
    }
  }
  return entries
    .filter((entry) => !entry.isVisible)
    .filter((entry) => entry.nodeId === TRACKING_GROUP_NODE_ID
      || entry.nodeId === TRACKING_DEVICES_LAYER_NODE_ID
      || entry.parentNodeId === TRACKING_DEVICES_LAYER_NODE_ID)
    .map((entry) => entry.nodeId)
}
