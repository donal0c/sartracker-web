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
    // Cached rows with no simplification record are disclosed as unknown [DON-338].
    expect(result.breadcrumbMetadata?.deviceBudgets.every((budget) => budget.truncated)).toBe(true)
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
  describe('keeps the simplified notice when either side is simplified [DON-338]', () => {
    const base = normalizeTraccarPosition(positions[0]!, 'cache')
    const deviceId = base.device_id
    const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString()
    const cachedTrail = Array.from({ length: 10 }, (_, index) =>
      ({ ...base, id: `cached-${index}`, timestamp: at(index) }))
    const liveTrail = Array.from({ length: 100 }, (_, index) =>
      ({ ...base, id: `live-${index}`, timestamp: at(100 + index), data_origin: 'live' as const }))
    const budget = (retained: number, total: number, truncated: boolean, bound: number | null) => ({
      deviceId, retained, sourceRetained: retained, total, firstTimestamp: null, lastTimestamp: null,
      truncated, geometryErrorBoundMetres: bound, targetGeometryErrorSatisfied: !truncated || (bound !== null && bound <= 25),
    })
    const exactCache: TrackingSnapshot = { devices: [], positions: [], breadcrumbs: cachedTrail,
      breadcrumbMetadata: { totalRetained: 10, totalObserved: 10, deviceBudgets: [budget(10, 10, false, 0)] } }
    const simplifiedCache: TrackingSnapshot = { ...exactCache,
      breadcrumbMetadata: { totalRetained: 10, totalObserved: 400, deviceBudgets: [budget(10, 400, true, null)] } }
    const simplifiedLive: TrackingSnapshot = { devices: [], positions: [], breadcrumbs: liveTrail,
      breadcrumbMetadata: { totalRetained: 100, totalObserved: 1_000, deviceBudgets: [budget(100, 1_000, true, 25)] } }
    const exactLive: TrackingSnapshot = { ...simplifiedLive,
      breadcrumbMetadata: { totalRetained: 100, totalObserved: 100, deviceBudgets: [budget(100, 100, false, 0)] } }

    it('exact cache with simplified live history', () => {
      const result = mergeDeferredTrackingCache(exactCache, simplifiedLive)
      expect(result.breadcrumbMetadata).toMatchObject({ totalRetained: 110, totalObserved: 1_000 })
      expect(result.breadcrumbMetadata?.deviceBudgets).toEqual([expect.objectContaining({
        deviceId, retained: 110, total: 1_000, truncated: true, geometryErrorBoundMetres: 25,
      })])
    })

    it('simplified cache with exact live history', () => {
      const result = mergeDeferredTrackingCache(simplifiedCache, exactLive)
      expect(result.breadcrumbMetadata?.deviceBudgets).toEqual([expect.objectContaining({
        deviceId, retained: 110, truncated: true, geometryErrorBoundMetres: null,
      })])
    })

    it('both sides simplified', () => {
      const result = mergeDeferredTrackingCache(simplifiedCache, simplifiedLive)
      expect(result.breadcrumbMetadata?.deviceBudgets).toEqual([expect.objectContaining({
        deviceId, retained: 110, total: 1_000, truncated: true, geometryErrorBoundMetres: null,
      })])
    })

    it('both sides exact shows no notice', () => {
      const result = mergeDeferredTrackingCache(exactCache, exactLive)
      expect(result.breadcrumbMetadata?.deviceBudgets.some(({ truncated }) => truncated) ?? false).toBe(false)
    })

    it('a cached trail with no metadata at all is disclosed as simplification unknown', () => {
      const result = mergeDeferredTrackingCache({ ...exactCache, breadcrumbMetadata: undefined }, exactLive)
      expect(result.breadcrumbMetadata?.deviceBudgets).toEqual([expect.objectContaining({
        deviceId, truncated: true, geometryErrorBoundMetres: null,
      })])
    })
  })
})
