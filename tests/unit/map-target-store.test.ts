import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMapTargetStore } from '../../src/features/map/map-target-store'

const REQUEST_LIFETIME_MS = 30_000
const ATTACHED_LIFETIME_MS = 8_000

describe('map target store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    const activeTarget = useMapTargetStore.getState().activeTarget
    if (activeTarget !== null) {
      useMapTargetStore.getState().clearActiveTarget(activeTarget.id)
    }
    useMapTargetStore.setState(useMapTargetStore.getInitialState())
    vi.useRealTimers()
  })

  it('expires an accepted target after 30 seconds when it never attaches [AUD-06]', () => {
    useMapTargetStore.getState().queueTarget(52.274681, -9.530912, 'Unattached target')
    const target = useMapTargetStore.getState().activeTarget

    expect(target).toMatchObject({
      expiresAt: REQUEST_LIFETIME_MS,
      attached: false,
    })
    expect(useMapTargetStore.getState().isTargetCurrent(target!.id)).toBe(true)

    vi.advanceTimersByTime(REQUEST_LIFETIME_MS - 1)
    expect(useMapTargetStore.getState().isTargetCurrent(target!.id)).toBe(true)

    vi.advanceTimersByTime(1)
    expect(useMapTargetStore.getState().isTargetCurrent(target!.id)).toBe(false)
    expect(useMapTargetStore.getState().activeTarget).toBeNull()
  })

  it('caps an attached target at the original request deadline', () => {
    useMapTargetStore.getState().queueTarget(52.274681, -9.530912, 'Near-deadline target')
    const target = useMapTargetStore.getState().activeTarget!

    vi.advanceTimersByTime(25_000)
    useMapTargetStore.getState().markTargetAttached(target.id)

    expect(useMapTargetStore.getState().activeTarget).toMatchObject({
      id: target.id,
      expiresAt: REQUEST_LIFETIME_MS,
      attached: true,
    })

    vi.advanceTimersByTime(4_999)
    expect(useMapTargetStore.getState().isTargetCurrent(target.id)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(useMapTargetStore.getState().isTargetCurrent(target.id)).toBe(false)
    expect(useMapTargetStore.getState().activeTarget).toBeNull()
  })

  it('keeps a replacement target alive when an older target timer fires', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined)

    try {
      useMapTargetStore.getState().queueTarget(52.274681, -9.530912, 'First target')
      const firstTarget = useMapTargetStore.getState().activeTarget!
      useMapTargetStore.getState().markTargetAttached(firstTarget.id)

      vi.advanceTimersByTime(5_000)
      useMapTargetStore.getState().queueTarget(52.275681, -9.531912, 'Second target')
      const secondTarget = useMapTargetStore.getState().activeTarget!
      useMapTargetStore.getState().markTargetAttached(secondTarget.id)

      // The first target's attachment deadline is due now. Its id-guarded
      // callback must not clear the newer request.
      vi.advanceTimersByTime(ATTACHED_LIFETIME_MS - 5_000)

      expect(useMapTargetStore.getState().activeTarget).toMatchObject({
        id: secondTarget.id,
        label: 'Second target',
      })
      expect(useMapTargetStore.getState().isTargetCurrent(firstTarget.id)).toBe(false)
    } finally {
      clearTimeoutSpy.mockRestore()
    }
  })

  it('clears an expired target when checked after a suspended clock jump', () => {
    useMapTargetStore.getState().queueTarget(52.274681, -9.530912, 'Suspended target')
    const target = useMapTargetStore.getState().activeTarget!

    // Move wall-clock time forward without running the scheduled callback.
    vi.setSystemTime(REQUEST_LIFETIME_MS + 1)

    expect(useMapTargetStore.getState().isTargetCurrent(target.id)).toBe(false)
    expect(useMapTargetStore.getState().activeTarget).toBeNull()
  })

  it('does not extend the attached lifetime when attachment is reported again', () => {
    useMapTargetStore.getState().queueTarget(52.274681, -9.530912, 'Repeated attachment')
    const target = useMapTargetStore.getState().activeTarget!

    useMapTargetStore.getState().markTargetAttached(target.id)
    vi.advanceTimersByTime(4_000)
    useMapTargetStore.getState().markTargetAttached(target.id)

    expect(useMapTargetStore.getState().activeTarget).toMatchObject({
      id: target.id,
      expiresAt: ATTACHED_LIFETIME_MS,
      attached: true,
    })

    vi.advanceTimersByTime(ATTACHED_LIFETIME_MS - 4_000)
    expect(useMapTargetStore.getState().isTargetCurrent(target.id)).toBe(false)
    expect(useMapTargetStore.getState().activeTarget).toBeNull()
  })

  it('keeps request IDs unique and protects the current target from stale clears', () => {
    useMapTargetStore.getState().queueTarget(52.274681, -9.530912, 'First target')
    const firstTarget = useMapTargetStore.getState().activeTarget!
    useMapTargetStore.getState().queueTarget(52.275681, -9.531912, 'Second target')
    const secondTarget = useMapTargetStore.getState().activeTarget!

    useMapTargetStore.getState().clearActiveTarget(firstTarget.id)

    expect(secondTarget.id).toBeGreaterThan(firstTarget.id)
    expect(useMapTargetStore.getState().activeTarget).toMatchObject({
      id: secondTarget.id,
      label: 'Second target',
    })
  })
})
