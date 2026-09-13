import { describe, expect, it } from 'vitest'
import { mergeDeferredTrackingCache } from '../../src/features/tracking/merge-deferred-tracking-cache'
import { normalizeTraccarPosition } from '../../src/features/tracking/traccar-normalization'
import positions from '../fixtures/traccar-positions.json'
import type { TrackingSnapshot } from '../../src/features/tracking/tracking-types'

describe('deferred tracking cache presentation merge', () => {
  it('prefers provider current coordinates over cached coordinates without comparing different source clocks', () => {
    const cachedPosition = { ...normalizeTraccarPosition(positions[0]!, 'cache'), lat: 52.1 }
    const livePosition = { ...cachedPosition, lat: 53.2, timestamp: '2026-01-01T00:00:00.000Z', data_origin: 'live' as const }
    const cached: TrackingSnapshot = { devices: [], positions: [cachedPosition], breadcrumbs: [] }
    const live: TrackingSnapshot = { devices: [], positions: [livePosition], breadcrumbs: [] }
    expect(mergeDeferredTrackingCache(cached, live).positions).toEqual([livePosition])
  })

  it('unions distinct cached fixes, replaces overlapping fixes and keeps cached rows out of persistence', () => {
    const cachedFix = { ...normalizeTraccarPosition(positions[0]!, 'cache'), id: 'overlap', lat: 52.1 }
    const cachedOnly = { ...cachedFix, id: 'cache-only', timestamp: '2026-01-01T00:00:00.000Z' }
    const liveFix = { ...cachedFix, lat: 53.2, data_origin: 'live' as const }
    const result = mergeDeferredTrackingCache(
      { devices: [], positions: [], breadcrumbs: [cachedFix, cachedOnly] },
      { devices: [], positions: [], breadcrumbs: [liveFix], rawBreadcrumbsForPersistence: [liveFix],
        breadcrumbMetadata: { totalObserved: 1, totalRetained: 1, deviceBudgets: [] } },
    )
    expect(result.breadcrumbs).toEqual([cachedOnly, liveFix])
    expect(result.rawBreadcrumbsForPersistence).toEqual([liveFix])
    expect(result.breadcrumbMetadata).toBeUndefined()
  })
})
