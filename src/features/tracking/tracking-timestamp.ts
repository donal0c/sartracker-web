const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/iu

/**
 * Validates and canonicalizes one explicit ISO 8601 date-time.
 *
 * Date-only and timezone-free strings are rejected because JavaScript would
 * otherwise guess missing mission-time information.
 */
export function normalizeTrackingIsoTimestamp(
  value: unknown,
  label: string,
): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a valid ISO8601 timestamp.`)
  }

  const timestamp = value.trim()
  const match = timestamp.match(ISO_DATE_TIME_PATTERN)
  if (match === null || !hasValidCalendarAndClock(match)) {
    throw new Error(`${label} must be a valid ISO8601 timestamp.`)
  }

  const parsed = Date.parse(timestamp)
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} must be a valid ISO8601 timestamp.`)
  }

  return new Date(parsed).toISOString()
}

function hasValidCalendarAndClock(match: RegExpMatchArray): boolean {
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[7] === undefined ? 0 : Number(match[7])
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8])

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 14 &&
    offsetMinute <= 59 &&
    (offsetHour < 14 || offsetMinute === 0)
  )
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leapYear ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}
