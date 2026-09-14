import { afterEach, describe, expect, it } from 'vitest'

import { useMapTargetStore } from '../../src/features/map/map-target-store'

describe('map target store', () => {
  afterEach(() => {
    useMapTargetStore.setState(useMapTargetStore.getInitialState())
  })

  it('keeps request IDs unique after a completed target has been cleared [AUD-06]', () => {
    const store = useMapTargetStore.getState()

    store.queueTarget(52.274681, -9.530912, 'First target')
    const firstTarget = useMapTargetStore.getState().activeTarget
    expect(firstTarget).not.toBeNull()

    store.clearPendingTarget(firstTarget!.id)
    store.clearActiveTarget(firstTarget!.id)
    store.queueTarget(52.275681, -9.531912, 'Second target')

    const secondTarget = useMapTargetStore.getState().activeTarget
    expect(secondTarget).not.toBeNull()
    expect(secondTarget!.id).toBeGreaterThan(firstTarget!.id)
  })
})
