import { describe, expect, it } from 'vitest'

import { selectNewestKnownFixes } from '../../src/features/tracking/newest-known-fix'
import { createDeviceFeatureCollection } from '../../src/features/tracking/tracking-geojson'
import type { NormalizedTrackingPosition } from '../../src/features/tracking/tracking-types'

function fix(
  id: string,
  timestamp: string,
  overrides: Partial<NormalizedTrackingPosition> = {},
): NormalizedTrackingPosition {
  return {
    id,
    device_id: '1',
    lat: 52.1,
    lon: -9.7,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp,
    source: null,
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
    ...overrides,
  }
}

describe('selectNewestKnownFixes', () => {
  it('uses a breadcrumb that is newer than the latest position', () => {
    const position = fix('p1', '2026-10-02T10:00:00.000Z')
    const newer = fix('b2', '2026-10-02T10:00:30.000Z', { lat: 52.2 })
    const result = selectNewestKnownFixes([position], [fix('b1', '2026-10-01T10:00:00.000Z'), newer])
    expect(result).toEqual([{ ...newer, device_cache_stale: false }])
  })

  it('never moves the marker backwards to an older breadcrumb', () => {
    const position = fix('p1', '2026-10-02T10:00:00.000Z')
    const result = selectNewestKnownFixes([position], [fix('b0', '2026-10-02T09:59:00.000Z')])
    expect(result).toEqual([position])
  })

  it('keeps the current position when timestamps are equal', () => {
    const position = fix('p1', '2026-10-02T10:00:00.000Z')
    const same = fix('b1', '2026-10-02T10:00:00.000Z', { lat: 53 })
    expect(selectNewestKnownFixes([position], [same])).toEqual([position])
  })

  it('rejects breadcrumbs with invalid coordinates or timestamps', () => {
    const position = fix('p1', '2026-10-02T10:00:00.000Z')
    const bad = [
      fix('b1', '2026-10-02T11:00:00.000Z', { lat: Number.NaN }),
      fix('b2', '2026-10-02T11:00:00.000Z', { lon: Number.POSITIVE_INFINITY }),
      fix('b3', '2026-10-02T11:00:00.000Z', { lat: 91 }),
      fix('b4', '2026-10-02T11:00:00.000Z', { lon: -181 }),
      fix('b5', 'not-a-time', { lat: 52.5 }),
    ]
    expect(selectNewestKnownFixes([position], bad)).toEqual([position])
  })

  it('does not choose an invalid current position over a valid breadcrumb', () => {
    const position = fix('p1', '2026-10-02T10:00:00.000Z', { lat: Number.NaN })
    const good = fix('b1', '2026-10-02T09:00:00.000Z')
    expect(selectNewestKnownFixes([position], [good])).toEqual([good])
  })

  it('passes an invalid position through unchanged when no breadcrumb is usable', () => {
    const position = fix('p1', '2026-10-02T10:00:00.000Z', { lat: Number.NaN })
    expect(selectNewestKnownFixes([position], [])).toEqual([position])
  })

  it('never lets a newer breadcrumb clear a stale or cached position [safety]', () => {
    const position = fix('p1', '2026-10-02T10:00:00.000Z', {
      device_cache_stale: true,
      data_origin: 'cache',
      cache_age_seconds: 900,
    })
    const newer = fix('b2', '2026-10-02T10:00:30.000Z', { lat: 52.2 })
    const [chosen] = selectNewestKnownFixes([position], [newer])
    expect(chosen?.lat).toBe(52.2)
    expect(chosen?.timestamp).toBe(newer.timestamp)
    expect(chosen?.device_cache_stale).toBe(true)
    expect(chosen?.data_origin).toBe('cache')
    expect(chosen?.cache_age_seconds).toBe(900)
  })

  it('keeps devices separate and does not add markers for devices without a position', () => {
    const p1 = fix('p1', '2026-10-02T10:00:00.000Z')
    const b2 = fix('b2', '2026-10-02T12:00:00.000Z', { device_id: '2' })
    expect(selectNewestKnownFixes([p1], [b2])).toEqual([p1])
  })
})

describe('device features at the newest known fix', () => {
  it('draws the marker and timestamp from the newer breadcrumb but keeps the position stale flag', () => {
    const position = fix('p1', '2026-10-02T10:00:00.000Z', { device_cache_stale: true })
    const newer = fix('b2', '2026-10-02T10:00:30.000Z', { lat: 52.2, lon: -9.8 })
    const collection = createDeviceFeatureCollection({
      devices: [],
      positions: [position],
      breadcrumbs: [newer],
    })
    const feature = collection.features[0]
    expect(feature?.geometry.coordinates).toEqual([-9.8, 52.2])
    expect(feature?.properties.timestamp).toBe(newer.timestamp)
    expect(feature?.properties.sourcePositionId).toBe('b2')
    expect(feature?.properties.stale).toBe(true)
  })
})
