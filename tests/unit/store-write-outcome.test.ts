import { describe, expect, it } from 'vitest'

import {
  buildStoreWriteWarnings,
  mergeStoreWriteTotals,
} from '../../src/features/tracking/store-write-outcome'

describe('store write outcome warnings [DON-338]', () => {
  it('uses distinct mission totals so repeat deliveries do not inflate the count', () => {
    const first = mergeStoreWriteTotals(null, 'mission-1', {
      rejectedPositionCount: 1, missionRejectedPositionTotal: 1,
    })
    const repeat = mergeStoreWriteTotals(first, 'mission-1', {
      rejectedPositionCount: 1, missionRejectedPositionTotal: 1,
    })
    expect(repeat).toEqual({ missionId: 'mission-1', rejectedPositionTotal: 1, sourceIdentityConflictTotal: 0 })
  })

  it('falls back to per-call counts when a store reports no mission total, and never goes down', () => {
    const totals = mergeStoreWriteTotals(null, 'mission-1', { sourceIdentityConflictCount: 2 })
    expect(mergeStoreWriteTotals(totals, 'mission-1', {})).toMatchObject({ sourceIdentityConflictTotal: 2 })
  })

  it('starts again for a different mission and shows nothing for another mission', () => {
    const totals = mergeStoreWriteTotals(null, 'mission-1', { missionRejectedPositionTotal: 3 })
    expect(mergeStoreWriteTotals(totals, 'mission-2', {})).toMatchObject({
      missionId: 'mission-2', rejectedPositionTotal: 0,
    })
    expect(buildStoreWriteWarnings(totals, 'mission-2')).toEqual([null, null])
  })

  it('names both problems with counts in operator words', () => {
    const totals = mergeStoreWriteTotals(null, 'mission-1', {
      missionRejectedPositionTotal: 2, missionSourceIdentityConflictTotal: 1,
    })
    const [rejected, reused] = buildStoreWriteWarnings(totals, 'mission-1')
    expect(rejected).toMatchObject({ code: 'mission_storage_rows_rejected' })
    expect(rejected?.text).toMatch(/2 fixes were refused/)
    expect(reused).toMatchObject({ code: 'source_position_id_reused' })
    expect(reused?.text).toMatch(/1 position id was reused/)
  })
})
