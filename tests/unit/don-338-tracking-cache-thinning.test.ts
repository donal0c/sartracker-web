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

  it('presents a small exact new cache as exact: nothing dropped is recorded explicitly', async () => {
    const breadcrumbs = Array.from({ length: 10 }, (_, index) =>
      fix('device-a', index, START_MS + index * 60_000, 53, -6))
    const restored = await roundTrip({ devices: [], positions: [], breadcrumbs })
    expect(restored.breadcrumbs).toHaveLength(10)
    expect(restored.breadcrumbMetadata?.deviceBudgets).toEqual([
      expect.objectContaining({ deviceId: 'device-a', retained: 10, truncated: false }),
    ])
    renderPanel(restored)
    expect(document.querySelector('[data-testid="breadcrumb-display-summary"]')).toBeNull()
  })

  it('discloses a small cache from the old writer as simplification unknown', () => {
    // The old writer saved an already-simplified live projection unchanged
    // when it was under its cap, so a small old cache may still be simplified.
    const breadcrumbs = Array.from({ length: 10 }, (_, index) =>
      fix('device-a', index, START_MS + index * 60_000, 53, -6))
    const restored = restoreRaw({ breadcrumbs })
    expect(restored.breadcrumbMetadata?.deviceBudgets).toEqual([
      expect.objectContaining({ deviceId: 'device-a', truncated: true, geometryErrorBoundMetres: null }),
    ])
    renderPanel(restored)
    expect(document.querySelector('[data-testid="breadcrumb-display-summary"]')?.textContent)
      .toContain('too complex for a guaranteed display-error bound')
  })

  describe('accepts every record the writer really produces [DON-338]', () => {
    /** Asserts a round trip kept the writer's own record rather than "unknown". */
    async function expectRecordKept(snapshot: TrackingSnapshot): Promise<TrackingSnapshot> {
      const limited = await limitTrackingCacheBreadcrumbs(snapshot.breadcrumbs, {
        metadata: snapshot.breadcrumbMetadata, yieldControl: () => Promise.resolve(),
      })
      const restored = await roundTrip(snapshot)
      expect(restored.breadcrumbMetadata).toEqual(limited.metadata)
      return restored
    }
    const moving = (deviceId: string, count: number, cadenceMs: number) =>
      Array.from({ length: count }, (_, index) =>
        fix(deviceId, index, START_MS + index * cadenceMs, 53 + index * 0.001, -6))

    it('unthinned', async () => {
      const restored = await expectRecordKept({ devices: [], positions: [], breadcrumbs: moving('device-a', 50, 60_000) })
      expect(restored.breadcrumbMetadata?.deviceBudgets[0]).toMatchObject({ truncated: false, retained: 50, sourceRetained: 50, total: 50 })
    })

    it('thinned', async () => {
      const restored = await expectRecordKept({ devices: [], positions: [], breadcrumbs: moving('device-a', 8_000, 3_000) })
      expect(restored.breadcrumbMetadata?.deviceBudgets[0]).toMatchObject({ truncated: true, sourceRetained: 8_000, total: 8_000 })
    })

    it('mandatory points over budget', async () => {
      const restored = await expectRecordKept({ devices: [], positions: [], breadcrumbs: moving('device-a', 5_001, 20 * 60_000) })
      expect(restored.breadcrumbs).toHaveLength(5_001)
      expect(restored.breadcrumbMetadata?.deviceBudgets[0]).toMatchObject({ truncated: false, retained: 5_001 })
    })

    it('live simplification carried through an unthinned cache', async () => {
      const breadcrumbs = moving('device-a', 100, 60_000)
      const restored = await expectRecordKept({ devices: [], positions: [], breadcrumbs, breadcrumbMetadata: {
        totalRetained: 100, totalObserved: 1_000, deviceBudgets: [{
          deviceId: 'device-a', retained: 100, sourceRetained: 1_000, total: 1_000,
          firstTimestamp: breadcrumbs[0]!.timestamp, lastTimestamp: breadcrumbs.at(-1)!.timestamp,
          truncated: true, geometryErrorBoundMetres: 25, targetGeometryErrorSatisfied: true,
        }],
      } })
      expect(restored.breadcrumbMetadata?.deviceBudgets[0]).toMatchObject({ truncated: true, total: 1_000 })
    })

    it('empty cache', async () => {
      const restored = await roundTrip({ devices: [], positions: [], breadcrumbs: [] })
      expect(restored.breadcrumbs).toEqual([])
      expect(restored.breadcrumbMetadata).toBeUndefined()
    })
  })

  it('treats an empty cache as having no trail to disclose', () => {
    expect(restoreRaw({ breadcrumbs: [] }).breadcrumbMetadata).toBeUndefined()
  })

  describe('falls back to simplification unknown when metadata does not match the trail', () => {
    const breadcrumbs = Array.from({ length: 500 }, (_, index) =>
      fix(index % 2 === 0 ? 'device-a' : 'device-b', index, START_MS + index * 60_000, 53, -6))
    const exactBudget = (deviceId: string, trail: readonly NormalizedTrackingPosition[]) => ({
      deviceId, retained: trail.length, sourceRetained: trail.length, total: trail.length,
      firstTimestamp: trail[0]!.timestamp, lastTimestamp: trail.at(-1)!.timestamp,
      truncated: false, geometryErrorBoundMetres: 0, targetGeometryErrorSatisfied: true,
    })
    const trailA = breadcrumbs.filter(({ device_id }) => device_id === 'device-a')
    const trailB = breadcrumbs.filter(({ device_id }) => device_id === 'device-b')
    const consistent = {
      totalRetained: 500, totalObserved: 500,
      deviceBudgets: [exactBudget('device-a', trailA), exactBudget('device-b', trailB)],
    }

    it('accepts consistent exact metadata as exact', () => {
      const restored = restoreRaw({ breadcrumbs, breadcrumb_metadata: consistent })
      expect(restored.breadcrumbMetadata?.deviceBudgets.some(({ truncated }) => truncated)).toBe(false)
    })

    it.each([
      ['no device budgets', { totalRetained: 500, totalObserved: 5_000, deviceBudgets: [] }, breadcrumbs],
      ['a device without a budget', { ...consistent, deviceBudgets: [consistent.deviceBudgets[0]!] }, breadcrumbs],
      ['a budget for a device with no trail', { ...consistent, deviceBudgets: [
        ...consistent.deviceBudgets, { ...consistent.deviceBudgets[0]!, deviceId: 'device-z' }] }, breadcrumbs],
      ['a wrong retained count', { ...consistent, deviceBudgets: [
        { ...consistent.deviceBudgets[0]!, retained: 249 }, consistent.deviceBudgets[1]!] }, breadcrumbs],
      ['a wrong total retained', { ...consistent, totalRetained: 499 }, breadcrumbs],
      ['observed above retained with no truncated device', { ...consistent, totalObserved: 5_000 }, breadcrumbs],
      ['a device total above retained but not truncated', { ...consistent, deviceBudgets: [
        { ...consistent.deviceBudgets[0]!, total: 2_000 }, consistent.deviceBudgets[1]!] }, breadcrumbs],
      ['a wrong first timestamp', { ...consistent, deviceBudgets: [
        { ...consistent.deviceBudgets[0]!, firstTimestamp: trailB[0]!.timestamp }, consistent.deviceBudgets[1]!] }, breadcrumbs],
      ['duplicate fix identities', consistent, [...breadcrumbs.slice(0, 499), breadcrumbs[497]!]],
      // The record itself says fixes were dropped, yet claims nothing was.
      ['an exact claim with more source fixes than retained', { ...consistent, deviceBudgets: [
        { ...consistent.deviceBudgets[0]!, sourceRetained: 5_000 }, consistent.deviceBudgets[1]!] }, breadcrumbs],
      ['source fixes above the known total', { ...consistent, totalObserved: 2_250, deviceBudgets: [
        { ...consistent.deviceBudgets[0]!, sourceRetained: 3_000, total: 2_000, truncated: true,
          geometryErrorBoundMetres: null, targetGeometryErrorSatisfied: false },
        consistent.deviceBudgets[1]!] }, breadcrumbs],
      ['retained above source fixes', { ...consistent, totalObserved: 2_250, deviceBudgets: [
        { ...consistent.deviceBudgets[0]!, sourceRetained: 100, total: 2_000, truncated: true,
          geometryErrorBoundMetres: null, targetGeometryErrorSatisfied: false },
        consistent.deviceBudgets[1]!] }, breadcrumbs],
    ] as const)('%s', (_label, metadata, trail) => {
      const restored = restoreRaw({ breadcrumbs: trail, breadcrumb_metadata: metadata })
      const budgets = restored.breadcrumbMetadata?.deviceBudgets ?? []
      expect(budgets.length).toBeGreaterThan(0)
      expect(budgets.every((budget) => budget.truncated && budget.geometryErrorBoundMetres === null))
        .toBe(true)
    })
  })
})

/** Restores a hand-written cache file, bypassing the writer. */
function restoreRaw(fields: {
  readonly breadcrumbs: readonly NormalizedTrackingPosition[]
  readonly breadcrumb_metadata?: unknown
}): TrackingSnapshot {
  return createCachedTrackingSnapshot(parseTrackingCachePayload(JSON.stringify({
    mission_id: 'mission-a',
    cached_at: new Date(START_MS).toISOString(),
    devices: [],
    positions: [],
    ...fields,
  })))
}

/** Renders the tracking panel over one snapshot. */
function renderPanel(snapshot: TrackingSnapshot): void {
  useTrackingStore.setState({ snapshot })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(React.createElement(TrackingStatusPanel)))
}
