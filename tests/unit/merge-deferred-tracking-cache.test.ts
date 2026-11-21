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
  it('keeps a simplified cached trail disclosed as simplified after merging live rows [DON-338]', () => {
    const cachedFix = { ...normalizeTraccarPosition(positions[0]!, 'cache'), id: 'cached', timestamp: '2026-01-01T00:00:00.000Z' }
    const liveFix = { ...cachedFix, id: 'live', timestamp: '2026-01-01T01:00:00.000Z', data_origin: 'live' as const }
    const deviceId = cachedFix.device_id
    const result = mergeDeferredTrackingCache(
      { devices: [], positions: [], breadcrumbs: [cachedFix], breadcrumbMetadata: {
        totalObserved: 40, totalRetained: 1, deviceBudgets: [{
          deviceId, retained: 1, sourceRetained: 40, total: 40, firstTimestamp: cachedFix.timestamp,
          lastTimestamp: cachedFix.timestamp, truncated: true, geometryErrorBoundMetres: null,
          targetGeometryErrorSatisfied: false,
        }],
      } },
      { devices: [], positions: [], breadcrumbs: [liveFix] },
    )
    expect(result.breadcrumbMetadata).toMatchObject({ totalRetained: 2, totalObserved: 40 })
    expect(result.breadcrumbMetadata?.deviceBudgets).toEqual([expect.objectContaining({
      deviceId, retained: 2, total: 40, truncated: true, geometryErrorBoundMetres: null,
      targetGeometryErrorSatisfied: false,
    })])
  })
})
