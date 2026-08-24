import { describe, expect, it } from 'vitest'

import {
  applyOutingController,
  applyOutingRuntime,
  useOutingStore,
} from '../../src/features/outings/outing-store'

describe('outing store [DON-270]', () => {
  it('publishes runtime state and the controller independently', () => {
    const controller = { refreshMission: async () => undefined } as never

    applyOutingRuntime({
      activeMissionId: 'mission-1',
      outings: [],
      fixSummary: null,
      loading: true,
      saving: false,
      error: null,
    })
    applyOutingController(controller)

    expect(useOutingStore.getState()).toMatchObject({
      activeMissionId: 'mission-1',
      loading: true,
      controller,
    })
  })
})
