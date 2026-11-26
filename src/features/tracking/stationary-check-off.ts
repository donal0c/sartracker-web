import type { NormalizedTrackingPosition } from './tracking-types'
import type { TrackingWarningCode } from './tracking-warnings'

/**
 * The shortest time a person with a live position may have fewer than two
 * kept trail positions before the tracking line says their not-moving warning
 * is off [DON-384]. The real wait is never shorter than two refreshes; see
 * {@link stationaryCheckOffGraceMs}.
 */
export const STATIONARY_CHECK_OFF_GRACE_MS = 2 * 60_000

/** A reason the trail may not be recorded that the app can see. */
export type StationaryCheckOffCause = 'history' | 'incomplete' | 'storage' | 'fixTime'

/** How many people have their not-moving warning off, and the possible causes seen. */
export type StationaryCheckOffSummary = {
  readonly count: number
  readonly causes: readonly StationaryCheckOffCause[]
}

/** Runtime warnings meaning the Traccar trail history request failed. */
const HISTORY_CODES: ReadonlySet<TrackingWarningCode> = new Set<TrackingWarningCode>([
  'history_refresh_failed',
  'participant_history_unavailable',
])

/** Runtime warnings meaning new trail positions are not being written to the mission record. */
const STORAGE_CODES: ReadonlySet<TrackingWarningCode> = new Set<TrackingWarningCode>([
  'mission_storage_failed',
  'mission_storage_rows_rejected',
  'evidence_backpressure',
])

const CAUSE_ORDER: readonly StationaryCheckOffCause[] = ['history', 'incomplete', 'storage', 'fixTime']

const CAUSE_WORDS: Readonly<Record<StationaryCheckOffCause, string>> = {
  history: 'tracking history could not be fetched',
  incomplete: 'trail history is incomplete',
  storage: 'trail positions are not being saved',
  fixTime: 'position times are not verified',
}

/**
 * A clock that never jumps when the laptop's wall clock is corrected, so the
 * grace period is real elapsed time.
 *
 * @returns elapsed milliseconds on a monotonic clock
 */
export function checkOffClockNow(): number {
  return performance.now()
}

/**
 * How long to wait before saying someone's not-moving warning is off: two
 * minutes, or two refreshes when tracking refreshes less often, so a routine
 * gap between refreshes never raises it.
 *
 * @param pollIntervalMs the configured tracking refresh interval
 * @returns the grace period in milliseconds
 */
export function stationaryCheckOffGraceMs(pollIntervalMs: number): number {
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) return STATIONARY_CHECK_OFF_GRACE_MS
  return Math.max(STATIONARY_CHECK_OFF_GRACE_MS, 2 * pollIntervalMs)
}

/**
 * Updates when each person's trail was first seen short of two kept positions.
 * Only a person with a live current position is timed, because a position from
 * the saved cache says nothing about whether the trail is being recorded now.
 * The first time is kept until a second position is kept or the live position goes.
 *
 * @param previous when each person was first seen short, from the last update
 * @param keptFixCountByDevice how many distinct trail positions are kept for each person checked
 * @param positions the current positions
 * @param nowMs the monotonic time of this update
 * @param excluded people not to time: a position not confirmed by the current
 *   connection ("Last known")
 * @returns when each affected person was first seen short
 */
export function trackStationaryCheckOffSince(
  previous: Readonly<Record<string, number>>,
  keptFixCountByDevice: ReadonlyMap<string, number>,
  positions: readonly NormalizedTrackingPosition[],
  nowMs: number,
  excluded: ReadonlySet<string> = new Set(),
): Record<string, number> {
  const withLivePosition = new Set(positions
    .filter((position) => position.data_origin === 'live')
    .map((position) => position.device_id))
  const next: Record<string, number> = {}
  for (const [deviceId, kept] of keptFixCountByDevice) {
    if (kept >= 2 || !withLivePosition.has(deviceId) || excluded.has(deviceId)) continue
    next[deviceId] = previous[deviceId] ?? nowMs
  }
  return next
}

/**
 * Counts the people whose trail has stayed short of two kept positions for the
 * grace period while the mission is running and tracking is connected, and names
 * the possible causes the app can see.
 *
 * @param input when each person was first seen short, the current positions, the
 *   monotonic time, the grace period, when the running-and-connected gate last
 *   opened (null while closed), and the runtime warning codes
 * @returns the count and the possible causes, in a fixed order
 */
export function summarizeStationaryCheckOff(input: {
  readonly sinceByDevice: Readonly<Record<string, number>>
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly nowMs: number
  readonly graceMs: number
  readonly gateOpenedAtMs: number | null
  readonly warningCodes: readonly TrackingWarningCode[] | undefined
  /**
   * People whose not-moving warning is showing: they are left out of the count
   * while it shows, but their clock keeps running so a brief warning cannot
   * restart the wait.
   */
  readonly stationaryShown?: ReadonlySet<string>
}): StationaryCheckOffSummary {
  const gate = input.gateOpenedAtMs
  if (gate === null) return { count: 0, causes: [] }
  const liveByDevice = new Map(input.positions
    .filter((position) => position.data_origin === 'live')
    .map((position) => [position.device_id, position]))
  const affected = Object.entries(input.sinceByDevice)
    .filter(([deviceId, since]) => liveByDevice.has(deviceId) && input.stationaryShown?.has(deviceId) !== true &&
      input.nowMs - Math.max(since, gate) >= input.graceMs)
    .map(([deviceId]) => deviceId)
  if (affected.length === 0) return { count: 0, causes: [] }
  const codes = input.warningCodes ?? []
  const seen = new Set<StationaryCheckOffCause>()
  if (codes.some((code) => HISTORY_CODES.has(code))) seen.add('history')
  if (codes.includes('history_incomplete')) seen.add('incomplete')
  if (codes.some((code) => STORAGE_CODES.has(code))) seen.add('storage')
  if (affected.some((deviceId) => liveByDevice.get(deviceId)?.fix_time_unverified === true)) seen.add('fixTime')
  return { count: affected.length, causes: CAUSE_ORDER.filter((cause) => seen.has(cause)) }
}

/**
 * When the next person not yet counted becomes due, for the headline's timer.
 *
 * @param sinceByDevice when each person was first seen short
 * @param gateOpenedAtMs when the running-and-connected gate last opened, or null
 * @param graceMs the grace period
 * @param nowMs the monotonic time held by the headline
 * @returns the monotonic due time, or null when nobody is pending
 */
export function nextStationaryCheckOffDue(
  sinceByDevice: Readonly<Record<string, number>>,
  gateOpenedAtMs: number | null,
  graceMs: number,
  nowMs: number,
): number | null {
  if (gateOpenedAtMs === null) return null
  const pending = Object.values(sinceByDevice)
    .map((since) => Math.max(since, gateOpenedAtMs) + graceMs)
    .filter((due) => due > nowMs)
  return pending.length === 0 ? null : Math.min(...pending)
}

/**
 * Words for the tracking line, or null when everyone's check works.
 *
 * @param summary the people affected and the possible causes seen
 * @returns one plain line naming how many people and why
 */
export function describeStationaryCheckOff(summary: StationaryCheckOffSummary): string | null {
  if (summary.count === 0) return null
  const who = `${summary.count} ${summary.count === 1 ? 'person' : 'people'}`
  const cause = summary.causes.length === 0
    ? ''
    : ` (possible cause: ${summary.causes.map((entry) => CAUSE_WORDS[entry]).join('; ')})`
  return `Not-moving warnings are off for ${who}: their trail is not being recorded${cause}`
}
