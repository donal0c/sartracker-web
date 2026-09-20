import { describe, expect, it } from 'vitest'
import { selectPagingSource } from '../../scripts/qualification/paging-source.mjs'

/** A metadata query stub isolates source-selection rules; file-oracle tests use SQLite. */
function source(missions: { id: string; positionCount: number }[]) {
  return { prepare: () => ({ all: () => missions }) }
}
describe('reviewed paging fixture mission inventory', () => {
  it('preserves the aggregate 960k envelope while naming the generator legacy rows', () => {
    const result = selectPagingSource(source([{ id: 'main', positionCount: 959988 },
      { id: 'fixture-mission-legacy-no-outings', positionCount: 12 }]), 'C07')
    expect(result).toMatchObject({ primary: { id: 'main', positionCount: 959988 },
      fixturePositionCount: 960000, legacyPositionCount: 12 })
  })
  it('rejects unreviewed extra missions and a changed legacy workload', () => {
    expect(() => selectPagingSource(source([{ id: 'main', positionCount: 960000 }, { id: 'other', positionCount: 12 }]), 'C08')).toThrow(/unreviewed/i)
    expect(() => selectPagingSource(source([{ id: 'main', positionCount: 960000 },
      { id: 'fixture-mission-legacy-no-outings', positionCount: 13 }]), 'C08')).toThrow(/unreviewed/i)
  })
})
