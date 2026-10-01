/**
 * Live-recording watch: proves fixes keep arriving WHILE something is set or
 * happening, not only that backfill made the mission complete afterwards
 * (DON-299 classes 2-3). Backfill hides pauses, so end-of-run completeness
 * alone cannot show that recording kept going [DON-315, DON-316].
 */

import { delay } from './app.mjs'
import { NotTested } from './results.mjs'
import { missionFixes } from './store.mjs'

/** Mock fix spacing (see mock-traccar.mjs). */
const STEP_SECONDS = 10

/**
 * The default lag limit: the app polls every 30 s and the mock steps every
 * 10 s, so a recording mission is at most ~4 fixes behind; 6 allows one slow
 * poll without hiding a stopped one.
 */
export const LIVE_LAG_LIMIT_STEPS = 6

/**
 * The app stores new fixes on every 30 s poll while recording. Silence is
 * judged by its provable lower bound (from the sample that saw one advance to
 * the last sample before the next), so a skipped read never inflates it; more
 * than 40 s means recording stopped, even if an early batch kept the lag
 * inside its limit.
 */
const MAX_SILENCE_MS = 40_000

/**
 * Turns store samples into findings. Each sample holds, per device, the
 * provider's latest index and the latest stored index (null: nothing stored).
 * Samples inside the grace period (the first poll after a relaunch) are
 * ignored. A device fails if it falls more than `maxLagSteps` behind, or goes
 * provably longer than 40 s without a new stored fix. The samples must cover the whole
 * watch (no gap over `maxSampleGapMs` at its start, middle or end, and a
 * readable span longer than the silence limit); otherwise
 * it is missing evidence: NotTested, never a pass and never a product FAIL.
 *
 * @param {{atMs: number, latest: Record<string, number>, stored: Record<string, number | null>}[]} samples
 * @param {{label: string, maxLagSteps: number, graceMs: number, durationMs: number, maxSampleGapMs: number}} options
 * @returns {string[]}
 */
export function liveLagFindings(samples, { label, maxLagSteps, graceMs, durationMs, maxSampleGapMs }) {
  const counted = samples.filter((sample) => sample.atMs >= graceMs)
  const times = counted.map((sample) => sample.atMs)
  const edges = [graceMs, ...times, durationMs]
  // The readable span must also outlast the silence limit, or a full stop
  // between the edges could not be told apart from a healthy store.
  const covered = counted.length > 0 && times.at(-1) - times[0] > MAX_SILENCE_MS
    && edges.every((at, index) => index === 0 || at - edges[index - 1] <= maxSampleGapMs)
  if (!covered) {
    const read = counted.length === 0 ? 'nothing' : `${times[0] / 1000}-${times.at(-1) / 1000} s`
    throw new NotTested(`while ${label}, store samples did not cover the watch (read ${read} of ${graceMs / 1000}-${durationMs / 1000} s)`)
  }
  const findings = []
  for (const device of Object.keys(counted[0].stored)) {
    if (counted.some((sample) => sample.stored[device] === null)) {
      findings.push(`while ${label}, device ${device} had no stored fixes`)
      continue
    }
    const worstLag = Math.max(...counted.map((sample) => Math.max(0, sample.latest[device] - sample.stored[device])))
    if (worstLag > maxLagSteps) {
      findings.push(`while ${label}, device ${device} fell ${worstLag} fixes (${worstLag * STEP_SECONDS} s) behind the provider (limit ${maxLagSteps})`)
    }
    let lastAdvanceAt = counted[0].atMs
    let longestSilence = 0
    for (let index = 1; index < counted.length; index += 1) {
      const advanced = counted[index].stored[device] > counted[index - 1].stored[device]
      // An advance seen at sample k happened after sample k-1: only the time
      // up to k-1 is certainly silent. Without an advance, up to k is.
      const certainlySilentUntil = advanced ? counted[index - 1].atMs : counted[index].atMs
      longestSilence = Math.max(longestSilence, certainlySilentUntil - lastAdvanceAt)
      if (advanced) lastAdvanceAt = counted[index].atMs
    }
    if (longestSilence > MAX_SILENCE_MS) {
      findings.push(`while ${label}, device ${device} stopped recording: no new stored fix for at least ${longestSilence / 1000} s (limit ${MAX_SILENCE_MS / 1000} s)`)
    }
  }
  return findings
}

/**
 * Polls `read` (stored ids) until every id is stored or `timeoutMs` passes.
 * Resolves false only when the store was readable throughout (no gap between
 * successful reads over `maxReadGapMs`); otherwise the absence is unproven and
 * it throws NotTested. Non-busy read errors propagate as tool errors.
 *
 * @param {{ids: readonly number[], read: () => Iterable<number>, timeoutMs: number, intervalMs?: number, maxReadGapMs?: number}} options
 * @returns {Promise<boolean>}
 */
export async function waitForStoredIds({ ids, read, timeoutMs, intervalMs = 5000, maxReadGapMs = 15_000 }) {
  const startedAt = Date.now()
  let lastReadAt = startedAt
  let longestReadGap = 0
  while (Date.now() - startedAt < timeoutMs) {
    await delay(intervalMs)
    try {
      const stored = new Set(read())
      longestReadGap = Math.max(longestReadGap, Date.now() - lastReadAt)
      lastReadAt = Date.now()
      if (ids.every((id) => stored.has(id))) return true
    } catch (error) {
      if (!isRetryableStoreRead(error)) throw error
    }
  }
  longestReadGap = Math.max(longestReadGap, Date.now() - lastReadAt)
  if (longestReadGap > maxReadGapMs) {
    throw new NotTested(`the store could not be read for ${Math.round(longestReadGap / 1000)} s while waiting for ${ids.length} fixes`)
  }
  return false
}

/**
 * True for a read that failed only because the app held the store at that
 * moment; anything else is a tool or fixture fault and must surface.
 *
 * @param {unknown} error
 */
export function isRetryableStoreRead(error) {
  const code = typeof error === 'object' && error !== null ? error.code : undefined
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED'
}

/**
 * Samples the store every `sampleMs` for `durationMs` and returns findings for
 * any watched device that stopped recording. A busy store skips one sample;
 * any other read error propagates as a tool error (NOT TESTED). Watches must
 * count at least 60 s after the grace period so a full stop is seen.
 *
 * @param {{mock: {latestIndexFor: (deviceId: number) => number}, profile: string, missionName: string, devices: number[], label: string, durationMs: number, graceMs?: number, sampleMs?: number, maxLagSteps?: number}} options
 * @returns {Promise<string[]>}
 */
export async function watchLiveRecording({
  mock, profile, missionName, devices, label, durationMs,
  graceMs = 0, sampleMs = 10_000, maxLagSteps = LIVE_LAG_LIMIT_STEPS,
}) {
  const startedAt = Date.now()
  const samples = []
  while (Date.now() - startedAt < durationMs) {
    await delay(sampleMs)
    let fixes
    try {
      fixes = missionFixes(profile, missionName)
    } catch (error) {
      if (isRetryableStoreRead(error)) continue
      throw error
    }
    const latestStored = new Map()
    for (const fix of fixes) {
      const device = Math.floor(fix.sourcePositionId / 1_000_000)
      latestStored.set(device, Math.max(latestStored.get(device) ?? -1, fix.sourcePositionId % 1_000_000))
    }
    const latest = {}
    const stored = {}
    for (const device of devices) {
      latest[device] = mock.latestIndexFor(device)
      stored[device] = latestStored.get(device) ?? null
    }
    samples.push({ atMs: Date.now() - startedAt, latest, stored })
  }
  // One skipped (busy) sample is allowed; a longer hole is missing evidence.
  return liveLagFindings(samples, { label, maxLagSteps, graceMs, durationMs, maxSampleGapMs: sampleMs * 2.5 })
}
