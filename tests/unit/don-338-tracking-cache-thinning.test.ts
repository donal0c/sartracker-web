import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { TrackingStatusPanel } from '../../src/components/tracking-status-panel'
import { createBreadcrumbSegments } from '../../src/features/tracking/breadcrumb-accumulator'
import {
  createCachedTrackingSnapshot,
  limitTrackingCacheBreadcrumbs,
  parseTrackingCachePayload,
  serializeTrackingCachePayload,
} from '../../src/features/tracking/tracking-cache-payload'
import { useTrackingStore } from '../../src/features/tracking/tracking-store'
import type {
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from '../../src/features/tracking/tracking-types'

// LIV-4 at the cache boundary [DON-338]: the restart cache thins trails with
// the live line's rule. It never invents a >30-minute break, never hides a real
// one, keeps every device's first and last fix, and a restored thinned trail
// is disclosed as simplified rather than presented as exact.

const GAP_MS = 30 * 60 * 1000
const START_MS = Date.parse('2026-11-07T08:00:00.000Z')

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root !== null) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  useTrackingStore.setState(useTrackingStore.getInitialState())
})

/** Builds one synthetic fix (no real mission data). */
function fix(
  deviceId: string,
  index: number,
  timestampMs: number,
  lat: number,
  lon: number,
): NormalizedTrackingPosition {
  return {
    id: `${deviceId}-${index}`,
    device_id: deviceId,
    lat,
    lon,
    altitude: null,
    speed: null,
    course: null,
    accuracy: null,
    battery: null,
    timestamp: new Date(timestampMs).toISOString(),
    received_at: new Date(timestampMs).toISOString(),
    data_origin: 'live',
  } as NormalizedTrackingPosition
}

/** Writes, reads and restores the cache exactly as the runtime does. */
async function roundTrip(snapshot: TrackingSnapshot): Promise<TrackingSnapshot> {
  const limited = await limitTrackingCacheBreadcrumbs(snapshot.breadcrumbs, {
    metadata: snapshot.breadcrumbMetadata,
    yieldControl: () => Promise.resolve(),
  })
  const contents = serializeTrackingCachePayload({
    mission_id: 'mission-a',
    cached_at: new Date(START_MS).toISOString(),
    devices: snapshot.devices,
    positions: snapshot.positions,
    breadcrumbs: limited.breadcrumbs,
    ...(limited.metadata === undefined ? {} : { breadcrumb_metadata: limited.metadata }),
  })
  return createCachedTrackingSnapshot(parseTrackingCachePayload(contents))
}

/** Break boundaries as [first, last] timestamps of every drawn segment. */
function segmentBounds(
  positions: readonly NormalizedTrackingPosition[],
): readonly (readonly [string, string])[] {
  return createBreadcrumbSegments(positions, GAP_MS)
    .map((segment) => [segment[0]!.timestamp, segment.at(-1)!.timestamp] as const)
}

/** Groups a trail by device, preserving order. */
function byDevice(
  positions: readonly NormalizedTrackingPosition[],
): Map<string, NormalizedTrackingPosition[]> {
  const grouped = new Map<string, NormalizedTrackingPosition[]>()
  for (const position of positions) {
    const trail = grouped.get(position.device_id) ?? []
    trail.push(position)
    grouped.set(position.device_id, trail)
  }
  return grouped
}

/** Asserts the restored trail breaks exactly where the source trail does. */
function expectSameBreaks(
  source: readonly NormalizedTrackingPosition[],
  restored: readonly NormalizedTrackingPosition[],
): void {
  const sourceByDevice = byDevice(source)
  const restoredByDevice = byDevice(restored)
  expect([...restoredByDevice.keys()].sort()).toEqual([...sourceByDevice.keys()].sort())
  for (const [deviceId, sourceTrail] of sourceByDevice) {
    const restoredTrail = restoredByDevice.get(deviceId)!
    expect(restoredTrail[0]!.timestamp).toBe(sourceTrail[0]!.timestamp)
    expect(restoredTrail.at(-1)!.timestamp).toBe(sourceTrail.at(-1)!.timestamp)
    expect(segmentBounds(restoredTrail)).toEqual(segmentBounds(sourceTrail))
  }
}

describe('tracking cache thinning keeps the live line truthful [DON-338]', () => {
  it('does not invent a break in one device with 5,001 fixes 20 minutes apart', async () => {
    const breadcrumbs = Array.from({ length: 5_001 }, (_, index) =>
      fix('device-a', index, START_MS + index * 20 * 60 * 1000,
        53 + index * 0.001, -6 + (index % 7) * 0.001))
    const restored = await roundTrip({ devices: [], positions: [], breadcrumbs })

    expectSameBreaks(breadcrumbs, restored.breadcrumbs)
    expect(segmentBounds(restored.breadcrumbs)).toHaveLength(1)
  })

  it('keeps every break, first and last fix for 34 devices with thousands of fixes, and discloses simplification', async () => {
    const breadcrumbs: NormalizedTrackingPosition[] = []
    for (let device = 0; device < 34; device += 1) {
      const deviceId = `device-${String(device).padStart(2, '0')}`
      let timestampMs = START_MS + device * 1_000
      let lat = 53 + device * 0.01
      let lon = -6
      for (let index = 0; index < 3_000; index += 1) {
        // A real silence of two hours per device, at a device-specific point,
        // and a long standstill that is not a silence.
        timestampMs += index === 700 + device * 20 ? 2 * 60 * 60 * 1000 : 2 * 60 * 1000
        const standing = index >= 1_500 && index < 1_800
        if (!standing) {
          lat += ((index * 7 + device) % 5 - 2) * 0.0004
          lon += ((index * 3 + device) % 5 - 2) * 0.0004
        }
        breadcrumbs.push(fix(deviceId, index, timestampMs, lat, lon))
      }
    }
    breadcrumbs.sort((left, right) => left.timestamp.localeCompare(right.timestamp))

    const restored = await roundTrip({ devices: [], positions: [], breadcrumbs })

    expectSameBreaks(breadcrumbs, restored.breadcrumbs)
    expect(restored.breadcrumbs.length).toBeLessThan(breadcrumbs.length)
    const metadata = restored.breadcrumbMetadata
    expect(metadata).toBeDefined()
    expect(metadata!.totalRetained).toBe(restored.breadcrumbs.length)
    expect(metadata!.totalObserved).toBeGreaterThanOrEqual(breadcrumbs.length)
    expect(metadata!.deviceBudgets).toHaveLength(34)
    expect(metadata!.deviceBudgets.every((budget) => budget.truncated)).toBe(true)

    useTrackingStore.setState({ snapshot: restored })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(React.createElement(TrackingStatusPanel)))
    const summary = document.querySelector('[data-testid="breadcrumb-display-summary"]')
    expect(summary?.textContent).toContain('Trail display simplified')
    expect(summary?.textContent).toContain(
      `${restored.breadcrumbs.length.toLocaleString()} of at least ${breadcrumbs.length.toLocaleString()} known fixes`,
    )
    expect(summary?.textContent).not.toContain('bounded to 25 metres')
  })

  it('discloses a cache written by the old uniform sampler as simplified', () => {
    const breadcrumbs = Array.from({ length: 5_000 }, (_, index) =>
      fix('device-a', index, START_MS + index * 60_000, 53, -6))
    const restored = createCachedTrackingSnapshot(parseTrackingCachePayload(
      serializeTrackingCachePayload({
        mission_id: 'mission-a',
        cached_at: new Date(START_MS).toISOString(),
        devices: [],
        positions: [],
        breadcrumbs,
      }),
    ))
    expect(restored.breadcrumbMetadata?.deviceBudgets[0]).toMatchObject({
      deviceId: 'device-a', truncated: true, geometryErrorBoundMetres: null,
    })
  })

  it('presents a small exact cache as exact', () => {
    const breadcrumbs = Array.from({ length: 10 }, (_, index) =>
      fix('device-a', index, START_MS + index * 60_000, 53, -6))
    const restored = createCachedTrackingSnapshot(parseTrackingCachePayload(
      serializeTrackingCachePayload({
        mission_id: 'mission-a',
        cached_at: new Date(START_MS).toISOString(),
        devices: [],
        positions: [],
        breadcrumbs,
      }),
    ))
    expect(restored.breadcrumbMetadata).toBeUndefined()
    expect(restored.breadcrumbs).toHaveLength(10)
  })
})
