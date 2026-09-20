import { createHash } from 'node:crypto'

const FIELDS = Object.freeze(['id', 'device_id', 'source_position_id', 'timestamp', 'lat', 'lon', 'data_origin'])

/** Compare each chunk membership with raw source outing boundaries, independent of production resolution. */
export function validateCoverageRowPeriod(row, key, outings) {
  const matches = outings.filter(outing => outing.started_at <= row.timestamp && (outing.ended_at === null || row.timestamp < outing.ended_at))
  if (matches.length > 1 || key.device_id !== row.device_id
      || key.period_kind !== (matches.length ? 'outing' : 'unassigned')
      || key.period_id !== (matches[0]?.id ?? '')) throw new Error('Coverage row was assigned to the wrong independent source period/device.')
}

/** Independently enforce chronological page order and the non-overlapping earlier-page boundary. */
export function validateExactPageOrder(rows, previousFirst) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Exact page order requires nonempty source rows.')
  for (let index = 1; index < rows.length; index++) {
    if (compareRows(rows[index - 1], rows[index]) >= 0) throw new Error('Exact page order is not strictly chronological.')
  }
  if (previousFirst !== null && compareRows(rows.at(-1), previousFirst) >= 0) throw new Error('Exact earlier page overlaps its predecessor.')
}

/** Compare independently constructed timestamp/device/source keys using code-unit order. */
function compareRows(left, right) {
  const key = row => [row.timestamp, row.device_id, typeof row.source_position_id === 'string' && row.source_position_id.trim()
    ? `source:${row.source_position_id.trim()}` : `local:${row.id}`]
  const a = key(left); const b = key(right)
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1
  }
  return 0
}

/** Compare streamed raw package rows with a separately opened, immutable source oracle. */
export function createPagingOracle({ expectedCount, lookup }) {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || expectedCount > 4_000_000
      || typeof lookup !== 'function') throw new Error('Paging source oracle is invalid or exceeds the reviewed four-million-row bound.')
  const seen = new Set()
  const digest = createHash('sha256')
  return {
    /** Accept one bounded raw page, rejecting repeats across all earlier pages. */
    accept(rows) {
      if (!Array.isArray(rows) || rows.length > 10_000) throw new Error('Paging page exceeds its reviewed bound.')
      for (const row of rows) {
        if (typeof row?.id !== 'string' || row.id.length > 512 || seen.has(row.id)) throw new Error('Paging duplicate or invalid source identity.')
        const source = lookup(row.id)
        if (!source || FIELDS.some(field => row[field] !== source[field])
            || !Number.isFinite(row.lat) || Math.abs(row.lat) > 90
            || !Number.isFinite(row.lon) || Math.abs(row.lon) > 180) throw new Error('Paging row differs from independent source coordinates or identity.')
        seen.add(row.id)
        if (seen.size > expectedCount) throw new Error('Paging returned more rows than the independent source.')
        digest.update(JSON.stringify(FIELDS.map(field => row[field])) + '\n')
      }
    },
    /** Require complete source membership before returning an observed sequence digest. */
    finish() {
      if (seen.size !== expectedCount) throw new Error('Paging incomplete: source rows are missing.')
      return { passed: true, count: seen.size, sequenceSha256: digest.digest('hex') }
    },
  }
}
