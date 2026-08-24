import { beforeEach, describe, expect, it } from 'vitest'

import {
  applyCoverageController,
  applyCoverageState,
  resetCoverageStore,
  useCoverageStore,
} from '../../src/features/tracking/coverage-store'

describe('coverage store [DON-276]', () => {
  beforeEach(() => resetCoverageStore())

  it('publishes mission-keyed state and clears it fail-closed', () => {
    applyCoverageState({
      status: 'partial', missionId: 'mission-1', rendererGeneration: 'r1',
      changeSeq: 2, latestObservedChangeSeq: 2, manifest: null,
      delivered: {}, deliveredFixCount: 0, totalFixCount: 10,
    })
    const controller = { stop: () => undefined }
    applyCoverageController(controller as never)

    expect(useCoverageStore.getState()).toMatchObject({
      state: { missionId: 'mission-1', status: 'partial' }, controller,
    })

    resetCoverageStore()
    expect(useCoverageStore.getState()).toMatchObject({
      state: { status: 'inactive' }, controller: null,
    })
  })
})
