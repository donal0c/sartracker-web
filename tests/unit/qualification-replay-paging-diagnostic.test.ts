import { describe, expect, it } from 'vitest'
import { createReplayPagingDiagnosticCollector } from '../../scripts/qualification/replay-paging-diagnostic.mjs'

const record = { guard: 'eligible-position-count', expected: 480000, observed: 480001 }
const line = `sartracker-replay-paging-guard=${JSON.stringify(record)}\n`
const failure = 'Mission replay evidence changed while paging. Re-seek the selected time.'

describe('failure-only replay paging diagnostic collector', () => {
  it('accepts a bounded record split at every byte boundary without retaining stderr', () => {
    for (let split = 0; split <= line.length; split++) {
      const collector = createReplayPagingDiagnosticCollector()
      collector.accept(Buffer.from('private stderr canary\n'))
      collector.accept(Buffer.from(line.slice(0, split)))
      collector.accept(Buffer.from(line.slice(split)))
      expect(collector.forFailure(failure)).toEqual(record)
      expect(collector.forFailure(null)).toBeNull()
      expect(collector.forFailure('unrelated failure')).toBeNull()
      expect(JSON.stringify(collector)).not.toContain('private')
    }
  })

  it.each([
    'sartracker-replay-paging-guard={broken}\n',
    `sartracker-replay-paging-guard=${JSON.stringify({ ...record, missionId: 'private' })}\n`,
    `sartracker-replay-paging-guard=${JSON.stringify({ ...record, observed: -1 })}\n`,
    `sartracker-replay-paging-guard=${' '.repeat(10000)}${JSON.stringify(record)}\n`,
    `private prefix ${line}`,
    line.trimEnd(),
  ])('rejects malformed, private, oversized and incomplete lines', input => {
    const collector = createReplayPagingDiagnosticCollector()
    collector.accept(Buffer.from(input))
    expect(collector.forFailure(failure)).toBeNull()
  })

  it('fails closed on duplicate records and recovers after an oversized unrelated line', () => {
    const collector = createReplayPagingDiagnosticCollector()
    collector.accept(Buffer.from('x'.repeat(1000000) + '\n' + line))
    expect(collector.forFailure(failure)).toEqual(record)
    collector.accept(Buffer.from(line))
    expect(collector.forFailure(failure)).toBeNull()
  })
})
