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
 * shown on the map. Self-contained, because Playwright sends its source text
 * to the page.
 *
 * @returns {Promise<{ state: 'ready' | 'hidden' | 'unconfirmed', fixes: number, cache: number, attention: number }
 *   | { state: 'not-drawn' | 'unreadable', reason: string }>} the reading
 */
export async function readTrackingSourceInPage() {
  const map = window.__SARTRACKER_MAP__
  if (map === undefined || map === null) return { state: 'not-drawn', reason: 'no map' }
  const source = map.getSource('tracking')
  if (source === undefined || source === null) return { state: 'not-drawn', reason: 'no tracking source' }
  // Read before the data, so a change while reading cannot confirm data drawn
  // under the other setting.
  const visible = window.__SARTRACKER_TRACKING_VISIBLE__
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
  const points = data.features.filter((feature) => feature?.properties?.featureKind === 'device')
  const counts = {
    fixes: points.length,
    cache: points.filter((feature) => feature.properties.dataOrigin === 'cache').length,
    attention: points.filter((feature) => feature.properties.attention === true).length,
  }
  if (visible === true && window.__SARTRACKER_TRACKING_VISIBLE__ === true) return { state: 'ready', ...counts }
  if (visible === false) return { state: 'hidden', reason: 'tracking is hidden on the map', ...counts }
  return { state: 'unconfirmed', reason: 'the renderer did not report whether tracking is shown', ...counts }
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
