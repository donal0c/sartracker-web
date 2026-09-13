'use strict'

const BREADCRUMB_QUERY_TRANSPORT_VERSION = 1
const MAX_BREADCRUMB_FRAME_CODE_UNITS = 32_768
const MAX_BREADCRUMB_RECORD_CODE_UNITS = 16_384
const STRING_FRAGMENT_CODE_UNITS = 1_024

/** Encodes scalar SQLite rows without JSON's non-finite-number coercion. */
function encodeRecord(kind, value) {
  const exceptionalNumbers = []
  const encoded = Object.fromEntries(Object.entries(value).map(([key, scalar]) => {
    if (typeof scalar === 'number' && (!Number.isFinite(scalar) || Object.is(scalar, -0))) {
      exceptionalNumbers.push([key, Object.is(scalar, -0) ? '-0' : String(scalar)])
      return [key, null]
    }
    if (scalar !== null && !['string', 'number', 'boolean'].includes(typeof scalar)) {
      throw new Error('Breadcrumb query contains an unsupported non-scalar storage value.')
    }
    return [key, scalar]
  }))
  return JSON.stringify({ kind, value: encoded,
    ...(exceptionalNumbers.length === 0 ? {} : { exceptionalNumbers }) }) + '\n'
}

/** Emits bounded parse records, including arbitrarily long stored string values. */
function* encodeRow(kind, row) {
  const entries = Object.entries(row)
  const worstCaseUnits = entries.reduce((total, [key, value]) =>
    total + key.length * 6 + (typeof value === 'string' ? value.length * 6 : 64) + 64, 128)
  if (worstCaseUnits < MAX_BREADCRUMB_RECORD_CODE_UNITS) {
    yield encodeRecord(kind, row)
    return
  }
  yield JSON.stringify({ kind: 'rowStart', rowKind: kind, fieldCount: entries.length }) + '\n'
  for (const [key, value] of entries) {
    if (key.length > 1_024) throw new Error('Breadcrumb storage column name exceeds the wire schema bound.')
    if (typeof value === 'string') {
      yield JSON.stringify({ kind: 'stringStart', key, length: value.length }) + '\n'
      for (let offset = 0; offset < value.length; offset += STRING_FRAGMENT_CODE_UNITS) {
        yield JSON.stringify({ kind: 'stringChunk', offset, value: value.slice(offset, offset + STRING_FRAGMENT_CODE_UNITS) }) + '\n'
      }
    } else {
      yield encodeRecord('field', { [key]: value })
    }
  }
  yield JSON.stringify({ kind: 'rowEnd' }) + '\n'
}

/** Iterates bounded wire frames while retaining only one encoded row of overhead. */
function* encodeBreadcrumbFrames(result) {
  let payload = ''
  for (const [kind, rows] of [
    ['position', result.positions], ['deviceTotal', result.deviceTotals],
    ['deviceSelection', result.deviceSelections],
  ]) {
    for (const row of rows) {
      for (const record of encodeRow(kind, row)) {
      let offset = 0
      while (offset < record.length) {
        const count = Math.min(MAX_BREADCRUMB_FRAME_CODE_UNITS - payload.length, record.length - offset)
        payload += record.slice(offset, offset + count)
        offset += count
        if (payload.length === MAX_BREADCRUMB_FRAME_CODE_UNITS) {
          yield { payload, done: false }
          payload = ''
        }
      }
      }
    }
  }
  yield { payload, done: true }
}

module.exports = { BREADCRUMB_QUERY_TRANSPORT_VERSION, MAX_BREADCRUMB_FRAME_CODE_UNITS,
  MAX_BREADCRUMB_RECORD_CODE_UNITS, encodeRecord, encodeBreadcrumbFrames }
