import type { NormalizedTrackingPosition } from './tracking-types'
import type { TrackingWarningCode } from './tracking-warnings'

/**
 * How long a person with a current position may have too few positions on
 * record before the tracking line says their not-moving warning is off. A
 * phone reporting every 15-60 s has its second position well within this, so
 * only a trail that is not being recorded reaches it [DON-384].
 */
export const STATIONARY_CHECK_OFF_GRACE_MS = 2 * 60_000

/** A reason the trail is not being recorded that the app can see. */
export type StationaryCheckOffCause = 'history' | 'storage' | 'fixTime'

/** How many people have their not-moving warning off, and the causes seen. */
export type StationaryCheckOffSummary = {
  readonly count: number
  readonly causes: readonly StationaryCheckOffCause[]
}

/** Runtime warnings meaning the Traccar trail history is not arriving. */
const HISTORY_CODES: ReadonlySet<TrackingWarningCode> = new Set<TrackingWarningCode>([
  'history_refresh_failed',
  'participant_history_unavailable',
])

/** Runtime warnings meaning fetched trail positions are not being kept. */
const STORAGE_CODES: ReadonlySet<TrackingWarningCode> = new Set<TrackingWarningCode>([
  'history_storage_failed',
  'mission_storage_failed',
  'mission_storage_rows_rejected',
  'persisted_breadcrumbs_dropped',
])

const CAUSE_ORDER: readonly StationaryCheckOffCause[] = ['history', 'storage', 'fixTime']

const CAUSE_WORDS: Readonly<Record<StationaryCheckOffCause, string>> = {
  history: 'tracking history could not be fetched',
  storage: 'trail positions are not being saved',
  fixTime: 'position times are not verified',
}

/**
 * Updates when each person's not-moving check went off. Only a person who has a
 * current position and whose check has too few positions on record is timed;
 * the first time is kept until the check works again or the position goes.
 *
 * @param previous when each person's check went off, from the last update
 * @param evaluations each person's stationary evaluation state
 * @param positions the current positions
 * @param nowMs the time of this update
 * @returns when each affected person's check went off
 */
export function trackStationaryCheckOffSince(
  previous: Readonly<Record<string, number>>,
  evaluations: Readonly<Record<string, { readonly state: string }>>,
  positions: readonly NormalizedTrackingPosition[],
  nowMs: number,
): Record<string, number> {
  const withPosition = new Set(positions.map((position) => position.device_id))
  const next: Record<string, number> = {}
  for (const [deviceId, evaluation] of Object.entries(evaluations)) {
    if (evaluation.state !== 'insufficient-data' || !withPosition.has(deviceId)) continue
    next[deviceId] = previous[deviceId] ?? nowMs
  }
  return next
}

/**
 * Counts the people whose not-moving warning has been off for the grace period
 * and still have a current position, and names the causes the app can see.
 *
 * @param input when each check went off, the current positions, the time, and the runtime health
 * @returns the count and the causes, in the order history, storage, fix time
 */
export function summarizeStationaryCheckOff(input: {
  readonly sinceByDevice: Readonly<Record<string, number>>
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly nowMs: number
  readonly warningCodes: readonly TrackingWarningCode[] | undefined
  readonly evidenceState: string
  readonly coverageStatus: string
}): StationaryCheckOffSummary {
  const positionByDevice = new Map(input.positions.map((position) => [position.device_id, position]))
  const affected = Object.entries(input.sinceByDevice)
    .filter(([deviceId, since]) => positionByDevice.has(deviceId) &&
      input.nowMs - since >= STATIONARY_CHECK_OFF_GRACE_MS)
    .map(([deviceId]) => deviceId)
  if (affected.length === 0) return { count: 0, causes: [] }
  const codes = input.warningCodes ?? []
  const seen = new Set<StationaryCheckOffCause>()
  if (input.coverageStatus === 'error' || codes.some((code) => HISTORY_CODES.has(code))) seen.add('history')
  if (input.evidenceState !== 'healthy' || codes.some((code) => STORAGE_CODES.has(code))) seen.add('storage')
  if (affected.some((deviceId) => positionByDevice.get(deviceId)?.fix_time_unverified === true)) seen.add('fixTime')
  return { count: affected.length, causes: CAUSE_ORDER.filter((cause) => seen.has(cause)) }
}

/**
 * Words for the tracking line, or null when everyone's check works.
 *
 * @param summary the people affected and the causes seen
 * @returns one plain line naming how many people and why
 */
export function describeStationaryCheckOff(summary: StationaryCheckOffSummary): string | null {
  if (summary.count === 0) return null
  const who = `${summary.count} ${summary.count === 1 ? 'person' : 'people'}`
  const cause = summary.causes.length === 0
    ? ''
    : ` (cause: ${summary.causes.map((entry) => CAUSE_WORDS[entry]).join('; ')})`
  return `Not-moving warnings are off for ${who}: their trail is not being recorded${cause}`
}
