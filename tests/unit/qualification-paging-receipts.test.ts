import { describe, expect, it } from 'vitest'
import { createPagingOracle, validateExactPageOrder, validateCoverageRowPeriod } from '../../scripts/qualification/paging-receipts.mjs'

const rows = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, device_id: 'd',
  source_position_id: `s${i}`, timestamp: `2026-09-19T10:00:0${i}.000Z`, lat: 52 + i / 1000,
  lon: -9, data_origin: 'live' }))
/** Independent tiny source is a calibration oracle, never field evidence. */
function oracle() {
  return createPagingOracle({ expectedCount: 3, lookup: (id: string) => rows.find(row => row.id === id) })
}
describe('streamed package paging oracle', () => {
  it('uses half-open independent outing intervals and rejects a wrong device or ambiguous source', () => {
    const outings = [{ id: 'o', started_at: rows[0].timestamp, ended_at: rows[2].timestamp }]
    const key = { device_id: 'd', period_kind: 'outing', period_id: 'o' }
    expect(() => validateCoverageRowPeriod(rows[0], key, outings)).not.toThrow()
    expect(() => validateCoverageRowPeriod(rows[2], key, outings)).toThrow(/period/i)
    expect(() => validateCoverageRowPeriod(rows[2], { ...key, period_kind: 'unassigned', period_id: '' }, outings)).not.toThrow()
    expect(() => validateCoverageRowPeriod(rows[0], { ...key, device_id: 'other' }, outings)).toThrow(/device/i)
    expect(() => validateCoverageRowPeriod(rows[0], key, [...outings, ...outings])).toThrow(/period/i)
  })
  it('rejects reordered and overlapping exact pages even when membership is correct', () => {
    expect(() => validateExactPageOrder(rows, null)).not.toThrow()
    expect(() => validateExactPageOrder([...rows].reverse(), null)).toThrow(/order/i)
    expect(() => validateExactPageOrder(rows.slice(0, 2), rows[2])).not.toThrow()
    expect(() => validateExactPageOrder(rows.slice(1), rows[1])).toThrow(/overlap/i)
  })
  it('compares every raw field and completes only after all source identities arrived', () => {
    const check = oracle()
    check.accept(rows.slice(0, 2)); check.accept(rows.slice(2))
    expect(check.finish()).toMatchObject({ count: 3, passed: true })
  })
  it('rejects duplicate, missing and substituted rows rather than trusting counts', () => {
    const duplicate = oracle(); duplicate.accept(rows.slice(0, 1))
    expect(() => duplicate.accept(rows.slice(0, 1))).toThrow(/duplicate/i)
    const missing = oracle(); missing.accept(rows.slice(1))
    expect(() => missing.finish()).toThrow(/incomplete/i)
    expect(() => oracle().accept([{ ...rows[0], lat: 53 }])).toThrow(/source/i)
    expect(() => oracle().accept([{ ...rows[0], id: 'unknown' }])).toThrow(/source/i)
  })
  it('bounds each incoming page and rejects invalid coordinates', () => {
    expect(() => oracle().accept(Array(10001).fill(rows[0]))).toThrow(/page/i)
    expect(() => oracle().accept([{ ...rows[0], lon: Infinity }])).toThrow(/source|coordinate/i)
  })
})
