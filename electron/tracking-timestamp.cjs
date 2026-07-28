const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/iu

/** Returns whether a value is an explicit, calendar-valid ISO 8601 date-time. */
function isStrictTrackingTimestamp(value) {
  const match =
    typeof value === 'string'
      ? value.trim().match(ISO_DATE_TIME_PATTERN)
      : null
  if (match === null) {
    return false
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[7] === undefined ? 0 : Number(match[7])
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth =
    month === 2
      ? leapYear ? 29 : 28
      : [4, 6, 9, 11].includes(month) ? 30 : 31

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 14 &&
    offsetMinute <= 59 &&
    (offsetHour < 14 || offsetMinute === 0) &&
    !Number.isNaN(Date.parse(value))
  )
}

module.exports = {
  isStrictTrackingTimestamp,
}
