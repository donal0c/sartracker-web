import { describe, expect, it } from 'vitest'

import type { CoverageState } from '../../src/features/tracking/coverage-controller'
import {
  selectCoverageCatalogForMission,
  selectCoverageStateForMission,
} from '../../src/features/tracking/mission-coverage-scope'

describe('mission coverage scope [DON-275]', () => {
  it('returns active coverage only for its owning mission', () => {
    const state = activeState()

    expect(selectCoverageStateForMission(state, 'mission-1')).toBe(state)
    expect(selectCoverageStateForMission(state, 'mission-2')).toEqual({ status: 'inactive' })
    expect(selectCoverageStateForMission(state, null)).toEqual({ status: 'inactive' })
  })

  it('returns a catalog only for its owning mission', () => {
    const state = activeState()

    expect(selectCoverageCatalogForMission(state, 'mission-1')).toBe(state.tileCatalog)
    expect(selectCoverageCatalogForMission(state, 'mission-2')).toBeNull()
    expect(selectCoverageCatalogForMission(state, null)).toBeNull()
  })
})

function activeState(): Exclude<CoverageState, { readonly status: 'inactive' }> {
  return {
    status: 'complete',
    missionId: 'mission-1',
    rendererGeneration: 'renderer-1',
    changeSeq: 1,
    latestObservedChangeSeq: 1,
    manifest: null,
    tileCatalog: {
      missionId: 'mission-1',
      activationId: 'activation-1',
      periods: [],
      delivered: [],
    },
    delivered: {},
    deliveredFixCount: 10,
    totalFixCount: 10,
  }
}
