type OperatorTimeFormatOptions = {
  readonly timeZone?: string
}

/**
 * Formats one canonical UTC instant in the operator's local timezone while
 * retaining an explicit UTC offset and IANA timezone name.
 */
export function formatOperatorLocalTimestamp(
  value: string | null,
  options: OperatorTimeFormatOptions = {},
): string {
  if (value === null) return 'N/A'
  const instant = new Date(value)
  if (!Number.isFinite(instant.getTime())) return 'N/A'

  const timeZone = options.timeZone ?? resolveOperatorTimeZone()
  const parts = new Intl.DateTimeFormat('en-IE', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  const offset = read('timeZoneName') === 'GMT'
    ? 'GMT+00:00'
    : read('timeZoneName')

  return `${read('day')}/${read('month')}/${read('year')}, ${read('hour')}:${read('minute')}:${read('second')} ${offset} (${timeZone})`
}

/** Resolves the operator IANA timezone, falling back to UTC when unavailable. */
export function resolveOperatorTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}
