const DUBLIN_TIME_ZONE = 'Europe/Dublin'
const LOCAL_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u

type LocalTimeParts = {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly millisecond: number
}

/** Parses an explicit Europe/Dublin wall time and rejects DST gaps or overlaps. */
export function parseDublinDateTimeLocal(value: string): string {
  const parts = parseLocalParts(value)
  const wallClockEpoch = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  )
  const matches = [0, 60]
    .map((offsetMinutes) => new Date(wallClockEpoch - offsetMinutes * 60_000))
    .filter((candidate) => localPartsEqual(readDublinParts(candidate), parts))

  if (matches.length === 0) {
    throw new Error('That Europe/Dublin local time does not exist because the clock moves forward.')
  }
  if (matches.length > 1) {
    throw new Error('That Europe/Dublin local time occurs twice because the clock moves back; choose an unambiguous time.')
  }
  return matches[0]!.toISOString()
}

/** Formats one UTC instant for a Europe/Dublin datetime-local control. */
export function formatDublinDateTimeLocal(value: string): string {
  const instant = new Date(value)
  if (!Number.isFinite(instant.getTime())) return ''
  const parts = readDublinParts(instant)
  const fraction = pad(parts.millisecond, 3).replace(/0+$/u, '')
  const local = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
  return fraction === '' ? local : `${local}.${fraction}`
}

/** Parses and validates the numeric fields of a datetime-local value. */
function parseLocalParts(value: string): LocalTimeParts {
  const match = LOCAL_TIME_PATTERN.exec(value)
  if (match === null) throw new Error('Enter a complete Europe/Dublin date and time.')
  const parts: LocalTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
    millisecond: Number((match[7] ?? '').padEnd(3, '0')),
  }
  const roundTrip = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  ))
  if (
    roundTrip.getUTCFullYear() !== parts.year
    || roundTrip.getUTCMonth() + 1 !== parts.month
    || roundTrip.getUTCDate() !== parts.day
    || roundTrip.getUTCHours() !== parts.hour
    || roundTrip.getUTCMinutes() !== parts.minute
    || roundTrip.getUTCSeconds() !== parts.second
  ) {
    throw new Error('Enter a valid Europe/Dublin date and time.')
  }
  return parts
}

/** Reads deterministic Europe/Dublin date fields for one instant. */
function readDublinParts(value: Date): LocalTimeParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: DUBLIN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  })
  const fields = new Map(formatter.formatToParts(value).map((part) => [part.type, part.value]))
  return {
    year: Number(fields.get('year')),
    month: Number(fields.get('month')),
    day: Number(fields.get('day')),
    hour: Number(fields.get('hour')),
    minute: Number(fields.get('minute')),
    second: Number(fields.get('second')),
    millisecond: Number(fields.get('fractionalSecond')),
  }
}

/** Compares two wall-clock values exactly. */
function localPartsEqual(left: LocalTimeParts, right: LocalTimeParts): boolean {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second
    && left.millisecond === right.millisecond
}

/** Pads one integer for a datetime-local field. */
function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}
