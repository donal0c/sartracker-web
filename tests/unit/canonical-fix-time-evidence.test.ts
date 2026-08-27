import { describe, expect, it } from 'vitest'

import { filterCanonicalFixTimeEvidenceSnapshot } from '../../src/features/tracking/canonical-fix-time-evidence'
import type { NormalizedTrackingPosition, TrackingSnapshot } from '../../src/features/tracking/tracking-types'

describe('canonical fix-time evidence boundary [DON-267] [SAR-QA-021]', () => {
  it('excludes time-unverified current and history rows without hiding current safety visibility', () => {
    const verified = position('verified', 'fix', false)
    const unverifiedDevice = position('device-fallback', 'device', true)
    const unverifiedServer = position('server-fallback', 'server', true)
    const operationalSnapshot: TrackingSnapshot = {
      devices: [],
      positions: [verified, unverifiedDevice, unverifiedServer],
      breadcrumbs: [verified, unverifiedDevice],
      rawBreadcrumbsForPersistence: [verified, unverifiedServer],
    }

    const evidenceSnapshot = filterCanonicalFixTimeEvidenceSnapshot(operationalSnapshot)

    expect(operationalSnapshot.positions.map(({ id }) => id)).toEqual([
      'verified',
      'device-fallback',
      'server-fallback',
    ])
    expect(evidenceSnapshot.positions.map(({ id }) => id)).toEqual(['verified'])
    expect(evidenceSnapshot.breadcrumbs.map(({ id }) => id)).toEqual(['verified'])
    expect(evidenceSnapshot.rawBreadcrumbsForPersistence?.map(({ id }) => id))
      .toEqual(['verified'])
  })
})

function position(
  id: string,
  timestampSource: 'fix' | 'device' | 'server',
  fixTimeUnverified: boolean,
): NormalizedTrackingPosition {
  return {
    id,
    device_id: 'device-1',
    lat: 52,
    lon: -9.7,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp: '2026-08-22T15:10:17.000Z',
    timestamp_source: timestampSource,
    fix_time_unverified: fixTimeUnverified,
    source: 'traccar',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}
