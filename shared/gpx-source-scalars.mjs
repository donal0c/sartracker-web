const STRICT_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u
const EXPLICIT_ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/u

/** Parses one non-empty finite decimal without JavaScript's empty-string coercion. */
export function parseGpxDecimal(source) {
  if (typeof source !== 'string') return null
  const normalized = source.trim()
  if (normalized === '' || !STRICT_DECIMAL.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

/** Parses a full, calendar-valid ISO date-time carrying Z or an explicit offset. */
export function parseExplicitGpxTimestamp(source) {
  if (typeof source !== 'string') return null
  const normalized = source.trim()
  const match = EXPLICIT_ISO_TIMESTAMP.exec(normalized)
  if (match === null) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[7] === undefined ? 0 : Number(match[7])
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8])
  if (
    month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)
    || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59
  ) return null
  const epoch = Date.parse(normalized)
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : null
}

/** Returns the exact Gregorian day count without Date's year-0-to-99 remapping. */
function daysInMonth(year, month) {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leap ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}
