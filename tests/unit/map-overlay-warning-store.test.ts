import { afterEach, describe, expect, it } from 'vitest'

import { useMapOverlayWarningStore } from '../../src/features/map/map-overlay-warning-store'
import { createMapOverlaySyncWarning } from '../../src/lib/map-health'

afterEach(() => {
  useMapOverlayWarningStore.setState({ warnings: [] })
})

describe('map overlay warning store', () => {
  it('retains independent family warnings and clears only the recovered registration', () => {
    const markers = createMapOverlaySyncWarning('markers', 'markers')
    const drawings = createMapOverlaySyncWarning('drawings', 'drawings')
    const store = useMapOverlayWarningStore.getState()

    expect(store.raiseWarning(markers)).toBe(true)
    expect(store.raiseWarning(markers)).toBe(false)
    expect(useMapOverlayWarningStore.getState().warnings).toEqual([markers])

    expect(useMapOverlayWarningStore.getState().raiseWarning(drawings)).toBe(true)
    expect(useMapOverlayWarningStore.getState().clearWarning('markers')).toBe(true)
    expect(useMapOverlayWarningStore.getState().warnings).toEqual([drawings])
    expect(useMapOverlayWarningStore.getState().clearWarning('markers')).toBe(false)
  })
})
