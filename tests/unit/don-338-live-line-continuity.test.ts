import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import { createBreadcrumbAccumulator } from '../../src/features/tracking/breadcrumb-accumulator'
import {
  createBreadcrumbFeatureCollection,
  DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS,
} from '../../src/features/tracking/tracking-geojson'
import type { NormalizedTrackingPosition } from '../../src/features/tracking/tracking-types'

// LIV-4 [DON-338]: the live trail line is thinned to 5,000 points per device.
// Thinning must never invent a break (a standstill is not a silence), must keep
// every real >30-minute silence as exactly one break, and must keep the first
// and last fix of the route.

const require = createRequire(import.meta.url)
const {
  BREADCRUMB_LINE_GAP_THRESHOLD_MS: PERSISTED_GAP_THRESHOLD_MS,
  retainCompactPositionRowsAcrossWindow,
} = require('../../electron/breadcrumb-query.cjs') as {
  readonly BREADCRUMB_LINE_GAP_THRESHOLD_MS: number
  readonly retainCompactPositionRowsAcrossWindow: (
    rows: readonly (readonly [number, string | null, string, number, number])[],
    deviceId: string,
    maxPositions: number,
  ) => { readonly rowIds: readonly number[] }
}

const START_MS = Date.parse('2026-11-07T08:00:00.000Z')
const CADENCE_MS = 3_000
const DEVICE_ID = 'device-a'

type RouteFix = { readonly timestampMs: number; readonly lat: number; readonly lon: number }

/** Builds one fix in the shape the live accumulator receives. */
function toPosition(fix: RouteFix, index: number): NormalizedTrackingPosition {
  return {
    id: String(index + 1),
    device_id: DEVICE_ID,
    lat: fix.lat,
    lon: fix.lon,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp: new Date(fix.timestampMs).toISOString(),
    timestamp_source: 'fix',
    fix_time_unverified: false,
    source: 'traccar',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}

/**
 * A walk, a pause, and a second walk, reported every 3 seconds. `silenceMs`
 * inserts a real reporting gap before the pause; `standstillFixes` is the
 * number of 3-second fixes spent standing still (jitter under a metre).
 */
function buildRoute(options: {
  readonly walkFixes: number
  readonly standstillFixes: number
  readonly silenceMs?: number
}): RouteFix[] {
  const fixes: RouteFix[] = []
  let timestampMs = START_MS
  const stepDegrees = 1e-5 // roughly one metre per fix
  for (let index = 0; index < options.walkFixes; index += 1) {
    fixes.push({
      timestampMs,
      lat: 54 + Math.sin(index / 300) * 2e-3,
      lon: -6 + index * stepDegrees,
    })
    timestampMs += CADENCE_MS
  }
  timestampMs += options.silenceMs ?? 0
  const pauseLon = -6 + options.walkFixes * stepDegrees
  for (let index = 0; index < options.standstillFixes; index += 1) {
    fixes.push({
      timestampMs,
      lat: 54.000001 + (index % 2) * 2e-6,
      lon: pauseLon + (index % 3) * 2e-6,
    })
    timestampMs += CADENCE_MS
  }
  for (let index = 0; index < options.walkFixes; index += 1) {
    fixes.push({
      timestampMs,
      lat: 54 + index * stepDegrees,
      lon: pauseLon + Math.sin(index / 300) * 2e-3,
    })
    timestampMs += CADENCE_MS
  }
  return fixes
}

/** Counts how many separate line pieces the live line draws for the retained fixes. */
function countDrawnSegments(positions: readonly NormalizedTrackingPosition[]): number {
  return createBreadcrumbFeatureCollection(
    { devices: [], positions: [], breadcrumbs: positions },
    DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS,
  ).features.length
}

/** Counts real >30-minute gaps in the stored fixes. */
function countSourceGaps(fixes: readonly RouteFix[]): number {
  let gaps = 0
  for (let index = 1; index < fixes.length; index += 1) {
    if (
      fixes[index]!.timestampMs - fixes[index - 1]!.timestampMs >
      DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS
    ) {
      gaps += 1
    }
  }
  return gaps
}

/** Runs the accumulator the way live polling does: batches, then compaction. */
function accumulateLive(positions: readonly NormalizedTrackingPosition[]) {
  const accumulator = createBreadcrumbAccumulator()
  const batch = 6_000
  let result = accumulator.snapshot()
  for (let offset = 0; offset < positions.length; offset += batch) {
    accumulator.ingest(positions.slice(offset, offset + batch))
    result = accumulator.compact()
  }
  return result
}

/** Runs the persisted (restart) projection and returns the selected fixes in order. */
function selectPersisted(fixes: readonly RouteFix[], maxPositions = 5_000) {
  const rows = fixes.map((fix, index) => [
    index + 1,
    String(index + 1),
    new Date(fix.timestampMs).toISOString(),
    fix.lat,
    fix.lon,
  ] as const)
  const selection = retainCompactPositionRowsAcrossWindow(rows, DEVICE_ID, maxPositions)
  return [...selection.rowIds]
    .sort((left, right) => left - right)
    .map((rowId) => toPosition(fixes[rowId - 1]!, rowId - 1))
}

describe('[DON-338] LIV-4 live trail line continuity under thinning', () => {
  it('uses the same 30-minute break rule in the persisted projection as in the live line', () => {
    expect(PERSISTED_GAP_THRESHOLD_MS).toBe(DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS)
  })

  it('draws a 45-minute standstill reported every 3 seconds as one unbroken line', () => {
    const fixes = buildRoute({ walkFixes: 15_000, standstillFixes: 900 })
    const positions = fixes.map(toPosition)
    expect(countSourceGaps(fixes)).toBe(0)

    const live = accumulateLive(positions)
    expect(live.positions.length).toBeLessThanOrEqual(5_000)
    expect(countDrawnSegments(live.positions)).toBe(1)

    const singleSnapshot = createBreadcrumbAccumulator(positions).snapshot()
    expect(singleSnapshot.positions.length).toBeLessThanOrEqual(5_000)
    expect(countDrawnSegments(singleSnapshot.positions)).toBe(1)

    const persisted = selectPersisted(fixes)
    expect(persisted.length).toBeLessThanOrEqual(5_000)
    expect(countDrawnSegments(persisted)).toBe(1)
  })

  it('breaks exactly once at a real 31-minute silence', () => {
    const fixes = buildRoute({
      walkFixes: 15_000,
      standstillFixes: 900,
      silenceMs: 31 * 60 * 1000,
    })
    const positions = fixes.map(toPosition)
    expect(countSourceGaps(fixes)).toBe(1)

    expect(countDrawnSegments(accumulateLive(positions).positions)).toBe(2)
    expect(countDrawnSegments(createBreadcrumbAccumulator(positions).snapshot().positions)).toBe(2)
    expect(countDrawnSegments(selectPersisted(fixes))).toBe(2)
  })

  it('breaks exactly once at a real 31-minute silence while standing still', () => {
    // The silence falls inside the standstill: same spot before and after.
    const before = buildRoute({ walkFixes: 15_000, standstillFixes: 450 })
    const walkStart = 15_000 + 450
    const fixes = before.map((fix, index) =>
      index >= walkStart - 225 ? { ...fix, timestampMs: fix.timestampMs + 31 * 60 * 1000 } : fix,
    )
    const positions = fixes.map(toPosition)
    expect(countSourceGaps(fixes)).toBe(1)

    expect(countDrawnSegments(accumulateLive(positions).positions)).toBe(2)
    expect(countDrawnSegments(createBreadcrumbAccumulator(positions).snapshot().positions)).toBe(2)
    expect(countDrawnSegments(selectPersisted(fixes))).toBe(2)
  })

  it.each([
    ['over 5,000 fixes', 3_000],
    ['over 25,000 fixes', 13_000],
  ])('keeps the first and last fix with %s', (_label, walkFixes) => {
    const fixes = buildRoute({ walkFixes, standstillFixes: 900 })
    const positions = fixes.map(toPosition)
    expect(positions.length).toBeGreaterThan(walkFixes === 3_000 ? 5_000 : 25_000)

    for (const retained of [
      accumulateLive(positions).positions,
      createBreadcrumbAccumulator(positions).snapshot().positions,
      selectPersisted(fixes),
    ]) {
      expect(retained.length).toBeLessThanOrEqual(5_000)
      expect(retained[0]?.timestamp).toBe(positions[0]!.timestamp)
      expect(retained.at(-1)?.timestamp).toBe(positions.at(-1)!.timestamp)
      expect(countDrawnSegments(retained)).toBe(1)
    }
  })
})
