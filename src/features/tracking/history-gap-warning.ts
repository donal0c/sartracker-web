import type { BreadcrumbHistoryGap } from './breadcrumb-history-reconciler'
import { resolveOperatorTimeZone } from './operator-time'

// Operator wording for breadcrumb history that Traccar could not supply at any
// window size [DON-338]. The text names the device and the local time range
// missing from the map, stays bounded however many gaps exist, and always says
// how many more there are rather than dropping them.

const MAX_NAMED_GAP_RANGES = 3
const MAX_NAMED_DEVICES = 5
const MINUTE_MS = 60_000

/**
 * Whether history retries are running. While live tracking is suspended
 * (mission paused or in recovery) nothing is retried, and the text must not
 * claim otherwise.
 */
export type HistoryRetryState = 'retrying' | 'suspended'

/**
 * The clause that ends a history warning, saying truthfully whether the
 * missing history is being retried.
 *
 * @param retry whether retries are running
 * @param whileRetrying the clause used while retries run, e.g. "still retrying"
 * @returns the clause without leading or trailing punctuation
 */
export function historyRetryClause(retry: HistoryRetryState, whileRetrying: string): string {
  return retry === 'retrying' ? whileRetrying : 'retries resume when live tracking resumes'
}

/**
 * Formats a missing time range in the operator's local clock (24-hour, as the
 * rest of the app). The start is rounded down and the end up to the minute,
 * so the text never claims less is missing than really is. The date is shown
 * only when the range is not today or crosses midnight. When the UTC offset
 * differs between the two ends (a clock change inside the range), both times
 * carry their offset, so "01:50–01:10" never appears to run backwards.
 *
 * @param fromIso range start (UTC ISO instant)
 * @param toIso range end (UTC ISO instant)
 * @param nowMs the current time, which decides what "today" is
 * @param timeZone IANA zone; defaults to the operator's
 * @returns e.g. "10:05–10:35", "20/11/2026 23:50–21/11/2026 00:20" or
 *   "01:50 (UTC+1)–01:10 (UTC+0)"
 */
export function formatOperatorClockRange(
  fromIso: string,
  toIso: string,
  nowMs: number,
  timeZone: string = resolveOperatorTimeZone(),
): string {
  const fromMs = Math.floor(Date.parse(fromIso) / MINUTE_MS) * MINUTE_MS
  const toMs = Math.ceil(Date.parse(toIso) / MINUTE_MS) * MINUTE_MS
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return `${fromIso}–${toIso}`
  }
  const clock = new Intl.DateTimeFormat('en-IE', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const day = new Intl.DateTimeFormat('en-IE', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  const fromDay = day.format(fromMs)
  const toDay = day.format(toMs)
  const fromOffset = formatUtcOffset(fromMs, timeZone)
  const toOffset = formatUtcOffset(toMs, timeZone)
  const showOffsets = fromOffset !== toOffset
  const fromClock = showOffsets ? `${clock.format(fromMs)} (${fromOffset})` : clock.format(fromMs)
  const toClock = showOffsets ? `${clock.format(toMs)} (${toOffset})` : clock.format(toMs)
  if (fromDay !== toDay) {
    return `${fromDay} ${fromClock}–${toDay} ${toClock}`
  }
  if (fromDay !== day.format(nowMs)) {
    return `${fromDay} ${fromClock}–${toClock}`
  }
  return `${fromClock}–${toClock}`
}

/**
 * Formats a zone's UTC offset at one instant, e.g. "UTC+1", "UTC+0" or
 * "UTC+5:30".
 *
 * @param instantMs the instant
 * @param timeZone IANA zone
 * @returns the offset label
 */
function formatUtcOffset(instantMs: number, timeZone: string): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(instantMs)
    .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  // "GMT" (zero offset) or "GMT+01:00" / "GMT-03:30".
  const match = /^GMT(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2})$/u.exec(name)
  if (match?.groups === undefined) return name === 'GMT' ? 'UTC+0' : name
  const hours = Number(match.groups.hours)
  const minutes = match.groups.minutes === '00' ? '' : `:${match.groups.minutes}`
  return `UTC${match.groups.sign}${hours}${minutes}`
}

/**
 * Describes unfetchable history ranges in one plain sentence a volunteer can
 * act on. Names at most three ranges, then counts the rest.
 *
 * @param gaps merged gaps ordered by device then time, as the reconciler publishes them
 * @param nowMs the current time
 * @param timeZone IANA zone; defaults to the operator's
 * @param retry whether retries are running; decides the closing clause
 * @returns the warning sentence, or null when there are no gaps
 */
export function describeHistoryGapsForOperator(
  gaps: readonly BreadcrumbHistoryGap[],
  nowMs: number,
  timeZone: string = resolveOperatorTimeZone(),
  retry: HistoryRetryState = 'retrying',
): string | null {
  if (gaps.length === 0) return null
  const verb = gaps.length === 1 ? 'is' : 'are'
  return `Breadcrumb history incomplete for ${nameRangesBounded(gaps, nowMs, timeZone)} could not be loaded from Traccar and ${verb} missing from the map; ${historyRetryClause(retry, 'still retrying')}.`
}

/** One device time range named to the operator. */
type NamedDeviceRange = {
  readonly deviceId: string
  readonly deviceName: string
  readonly from: string
  readonly to: string
}

/**
 * Names device time ranges in local clock time: at most three ranges,
 * grouped by device, then a count of the rest (never dropped silently).
 *
 * @param ranges ranges ordered by device then time
 * @param nowMs the current time
 * @param timeZone IANA zone
 * @returns e.g. "Alpha: 09:00–09:10, 10:05–10:35; Bravo: 11:00–11:20; and 2 more ranges"
 */
function nameRangesBounded(
  ranges: readonly NamedDeviceRange[],
  nowMs: number,
  timeZone: string,
): string {
  const shown = ranges.slice(0, MAX_NAMED_GAP_RANGES)
  const pieces: { readonly deviceId: string; readonly name: string; readonly ranges: string[] }[] = []
  for (const entry of shown) {
    const range = formatOperatorClockRange(entry.from, entry.to, nowMs, timeZone)
    const last = pieces.at(-1)
    if (last !== undefined && last.deviceId === entry.deviceId) {
      last.ranges.push(range)
    } else {
      pieces.push({ deviceId: entry.deviceId, name: entry.deviceName, ranges: [range] })
    }
  }
  const remaining = ranges.length - shown.length
  const named = pieces.map((piece) => `${piece.name}: ${piece.ranges.join(', ')}`).join('; ')
  const more = remaining > 0
    ? `; and ${remaining} more ${remaining === 1 ? 'range' : 'ranges'}`
    : ''
  return `${named}${more}`
}

/**
 * Describes re-check ranges that are running behind: late-uploaded positions
 * in them may not be on the map yet. Names at most three ranges [DON-338].
 *
 * @param backlog re-check ranges still to be re-read, ordered by device then time
 * @param nowMs the current time
 * @param timeZone IANA zone; defaults to the operator's
 * @param retry whether the re-check is running or suspended with live tracking
 * @returns the warning sentence, or null when nothing is behind
 */
export function describeRecheckBacklogForOperator(
  backlog: readonly NamedDeviceRange[],
  nowMs: number,
  timeZone: string = resolveOperatorTimeZone(),
  retry: HistoryRetryState = 'retrying',
): string | null {
  if (backlog.length === 0) return null
  const times = backlog.length === 1 ? 'that time' : 'those times'
  const continues = retry === 'retrying'
    ? 'The re-check continues by itself.'
    : 'The re-check continues when live tracking resumes.'
  return `Breadcrumb history re-check is running behind for ${nameRangesBounded(backlog, nowMs, timeZone)}; late-uploaded positions from ${times} may not be on the map yet. ${continues}`
}

/**
 * Joins device names for a warning, naming at most five and counting the rest.
 *
 * @param names device names in display order
 * @returns e.g. "A, B, C, D, E and 2 more"
 */
export function listNamesBounded(names: readonly string[]): string {
  if (names.length <= MAX_NAMED_DEVICES) return names.join(', ')
  return `${names.slice(0, MAX_NAMED_DEVICES).join(', ')} and ${names.length - MAX_NAMED_DEVICES} more`
}
