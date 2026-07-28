import { describe, expect, it } from 'vitest'
import { createBreadcrumbIdentityIndex } from '../../src/features/tracking/breadcrumb-identity-index'
import type { NormalizedTrackingPosition } from '../../src/features/tracking/tracking-types'

function position(
  id: string,
  overrides: Partial<NormalizedTrackingPosition> = {},
): NormalizedTrackingPosition {
  return {
    id,
    device_id: 'device-1',
    lat: 52,
    lon: -9,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp: '2026-07-28T12:00:00.000Z',
    source: 'gps',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
    ...overrides,
  }
}

describe('breadcrumb identity index', () => {
  it('adds, detects, and deletes positive numeric source identities exactly', () => {
    const index = createBreadcrumbIdentityIndex()
    const first = position('9007199254740000')
    const second = position('9007199254740001')

    expect(index.add(first)).toBe(true)
    expect(index.add(first)).toBe(false)
    expect(index.has(first)).toBe(true)
    expect(index.has(second)).toBe(false)
    expect(index.delete(first)).toBe(true)
    expect(index.has(first)).toBe(false)
    expect(index.delete(first)).toBe(false)
  })

  it('keeps legacy coordinate identities distinct and exact', () => {
    const index = createBreadcrumbIdentityIndex()
    const first = position('', { lat: 52.1 })
    const duplicate = position('', { lat: 52.1 })
    const distinct = position('', { lat: 52.100001 })

    expect(index.add(first)).toBe(true)
    expect(index.add(duplicate)).toBe(false)
    expect(index.has(distinct)).toBe(false)
    expect(index.add(distinct)).toBe(true)
  })

  it('uses compact sparse bit blocks for a fourteen-day interleaved source-id span', () => {
    const index = createBreadcrumbIdentityIndex()
    const positionsPerDevice = 60 * 24 * 14

    for (let sequence = 0; sequence < positionsPerDevice; sequence += 1) {
      index.add(position(String(5_000_000_000 + sequence * 32)))
    }

    const stats = index.getStorageStats()
    expect(stats.identityCount).toBe(positionsPerDevice)
    expect(stats.fallbackIdentityCount).toBe(0)
    expect(stats.numericBlockBytes).toBeLessThan(2_000_000)
    expect(index.has(position(String(5_000_000_000 + (positionsPerDevice - 1) * 32)))).toBe(
      true,
    )
  })
})
