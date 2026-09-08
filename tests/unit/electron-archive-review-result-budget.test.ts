import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { assertArchiveReviewResultBudget, MAX_ARCHIVE_REVIEW_RESULT_BYTES, MAX_ARCHIVE_REVIEW_RESULT_ROWS } = require('../../electron/archive-review-result-budget.cjs') as {
  assertArchiveReviewResultBudget: (value: unknown) => number
  MAX_ARCHIVE_REVIEW_RESULT_BYTES: number
  MAX_ARCHIVE_REVIEW_RESULT_ROWS: number
}

describe('archive Review result boundary', () => {
  it.each([null, true, false, -0, 1e100, 'é🧭\n\t"\\\u0001\ud800', { evidence: ['日本語', 4, null] }])('matches actual UTF-8 JSON sizing %#', (value) => {
    expect(assertArchiveReviewResultBudget(value)).toBe(Buffer.byteLength(JSON.stringify(value)))
  })

  it('accepts the exact byte boundary and rejects the next byte', () => {
    expect(assertArchiveReviewResultBudget('a'.repeat(MAX_ARCHIVE_REVIEW_RESULT_BYTES - 2))).toBe(MAX_ARCHIVE_REVIEW_RESULT_BYTES)
    expect(() => assertArchiveReviewResultBudget('a'.repeat(MAX_ARCHIVE_REVIEW_RESULT_BYTES - 1))).toThrow(/limit/iu)
  })

  it('rejects cycles, prototype-bearing objects, unsafe keys and oversized row arrays', () => {
    const cycle: unknown[] = []
    cycle.push(cycle)
    for (const value of [cycle, new Date(), Object.create(null), { constructor: 'attack' }, JSON.parse('{"__proto__":{}}'), new Array(MAX_ARCHIVE_REVIEW_RESULT_ROWS + 1), NaN, Infinity, undefined]) {
      expect(() => assertArchiveReviewResultBudget(value)).toThrow(/invalid/iu)
    }
  })
})
