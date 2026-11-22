/**
 * What the WAR-06 mission-boundary probe may treat as observed on the map
 * (DON-353). Kept apart from the probe so the rules are unit-tested.
 *
 * A map reading is one of three states:
 * - `ready`: the tracking source was read, so its device points are exactly
 *   what the map draws. With tracking unfiltered (trackingNodesHiddenInCatalog,
 *   readPeopleLocationTick) they
 *   also equal the tracking snapshot's positions. Only these count as proof.
 * - `not-drawn`: no map or no tracking source yet. Nothing is drawn right now,
 *   which says nothing about the snapshot, so it is never a proven zero; it
 *   only means the map was not blind at that moment.
 * - `unreadable`: the source exists but could not be read, or the read threw.
 *
 * A read captures the map at some instant between when it starts (`at`) and
 * when it completes (`doneAt`), so the blind stretch between two readings is
 * measured from the earlier one's start to the later one's completion, and the
 * stretches before the first and after the last reading count too.
 */

import { openWorkspacePanel, plainClick } from './workspace-panels.mjs'

/** Longest stretch the probe may go without seeing the map before a leak counts as unproven. */
export const MAX_UNOBSERVED_GAP_MS = 2_000

/**
 * Reads the map's tracking source in the renderer. Self-contained, because
 * Playwright sends its source text to the page.
 *
 * @returns {Promise<{ state: 'ready', fixes: number, cache: number, attention: number }
 *   | { state: 'not-drawn' | 'unreadable', reason: string }>} the reading
 */
export async function readTrackingSourceInPage() {
  const map = window.__SARTRACKER_MAP__
  if (map === undefined || map === null) return { state: 'not-drawn', reason: 'no map' }
  const source = map.getSource('tracking')
  if (source === undefined || source === null) return { state: 'not-drawn', reason: 'no tracking source' }
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
  return {
    state: 'ready',
    fixes: points.length,
    cache: points.filter((feature) => feature.properties.dataOrigin === 'cache').length,
    attention: points.filter((feature) => feature.properties.attention === true).length,
  }
}

/**
 * Reduces one continuous observation to counts and its longest blind stretch.
 *
 * @param {ReadonlyArray<{ state?: string, at?: number, doneAt?: number,
 *   currentFixCount?: number | null, cachedDeviceCount?: number | null,
 *   mapAttentionCount?: number | null, stationaryAttention?: string, warning?: string } | null | undefined>} samples
 *   the readings, in any order
 * @param {{ startedAt: number, endedAt: number }} window when the observation began and ended
 * @param {string} [actionWarning] a warning the observed action itself returned
 * @param {string} [discardWarning] the warning text that counts as a discard sighting
 */
export function summarizeSurfaceSamples(samples, window, actionWarning = '', discardWarning = '') {
  if (!Number.isFinite(window?.startedAt) || !Number.isFinite(window?.endedAt) || window.endedAt < window.startedAt) {
    throw new Error('The observation has no valid start and end, so its blind stretches cannot be measured.')
  }
  const valid = samples.filter((sample) => sample !== null && sample !== undefined)
  const timed = valid.filter((sample) => Number.isFinite(sample.at) && Number.isFinite(sample.doneAt) && sample.doneAt >= sample.at)
  const ready = timed.filter((sample) => sample.state === 'ready')
  const seen = timed.filter((sample) => sample.state === 'ready' || sample.state === 'not-drawn')
    .sort((left, right) => left.at - right.at)
  let longestGapMs = 0
  let lastSeenFrom = window.startedAt
  for (const sample of seen) {
    longestGapMs = Math.max(longestGapMs, sample.doneAt - lastSeenFrom)
    lastSeenFrom = Math.max(lastSeenFrom, sample.at)
  }
  longestGapMs = Math.max(longestGapMs, window.endedAt - lastSeenFrom)
  const warningSeen = (text) => discardWarning !== '' && (text ?? '').includes(discardWarning)
  return {
    sampleCount: valid.length,
    readableCount: ready.length,
    notDrawnCount: timed.filter((sample) => sample.state === 'not-drawn').length,
    unreadableCount: valid.length - seen.length,
    untimedCount: valid.length - timed.length,
    longestGapMs,
    window: { startedAt: window.startedAt, endedAt: window.endedAt },
    first: valid[0] ?? null,
    last: valid.at(-1) ?? null,
    maxCurrentFixCount: ready.length === 0 ? null : Math.max(...ready.map((sample) => sample.currentFixCount ?? 0)),
    maxCachedDeviceCount: ready.length === 0 ? null : Math.max(...ready.map((sample) => sample.cachedDeviceCount ?? 0)),
    discardWarningObserved: warningSeen(actionWarning) || valid.some((sample) => warningSeen(sample.warning)),
    attentionObserved: valid.some((sample) => (sample.stationaryAttention ?? '') !== '' || (sample.mapAttentionCount ?? 0) > 0),
  }
}

const TRACKING_GROUP_NODE_ID = 'group:tracking'
const TRACKING_DEVICES_LAYER_NODE_ID = 'layer:tracking:devices'

/**
 * Names the saved layer-catalog entries that hide tracking positions: the
 * Tracking group, the Location layer, or one person's location under it.
 * When tracking is hidden the map is fed an empty snapshot, and a hidden
 * person is left out, so the source can read 0 while positions exist
 * (use-map-overlays.ts).
 *
 * @param {ReadonlyArray<{ node_id: string, parent_node_id?: string | null, is_visible: number | boolean }>} entries
 *   the mission's saved layer-catalog entries
 * @returns {string[]} the hiding entries' node ids
 */
export function trackingNodesHiddenInCatalog(entries) {
  return entries
    .filter((entry) => entry.is_visible === 0 || entry.is_visible === false)
    .filter((entry) => entry.node_id === TRACKING_GROUP_NODE_ID
      || entry.node_id === TRACKING_DEVICES_LAYER_NODE_ID
      || entry.parent_node_id === TRACKING_DEVICES_LAYER_NODE_ID)
    .map((entry) => entry.node_id)
}

/**
 * Reads the People panel's "Everyone · Location" tick, where the operator
 * shows or hides positions in the new layout (Tracking is no longer listed in
 * Layers). It is ticked, not mixed, only when every person's location is shown.
 *
 * @param {import('playwright').Page} page the app window
 * @param {{ click?: import('./workspace-panels.mjs').OperatorClick, timeoutMs?: number }} [options]
 * @returns {Promise<{ everyoneShown: boolean, mixed: boolean }>}
 */
export async function readPeopleLocationTick(page, { click = plainClick, timeoutMs = 15_000 } = {}) {
  await openWorkspacePanel(page, 'people', { click, timeoutMs })
  const tick = page.getByTestId('ws-all-positions')
  try {
    await tick.waitFor({ state: 'visible', timeout: timeoutMs })
  } catch {
    throw new Error(`The People panel's Everyone Location tick did not appear within ${timeoutMs} ms.`)
  }
  const mixed = (await tick.getAttribute('aria-checked')) === 'mixed'
  return { everyoneShown: !mixed && await tick.isChecked(), mixed }
}
