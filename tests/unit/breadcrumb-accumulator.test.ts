import { afterEach, describe, expect, it, vi } from 'vitest'

import breadcrumbsFixture from '../fixtures/traccar-breadcrumbs.json'
import {
  COMPARED_POSITION_KEYS,
  accumulateBreadcrumbPositions,
  appendBreadcrumbPositions,
  createBreadcrumbAccumulator,
  createBreadcrumbSegments,
  positionsEqual,
} from '../../src/features/tracking/breadcrumb-accumulator'
import { normalizeTraccarPosition } from '../../src/features/tracking/traccar-normalization'
import type { NormalizedTrackingPosition } from '../../src/features/tracking/tracking-types'

describe('breadcrumb accumulator', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('deduplicates by device and timestamp while keeping chronological order', () => {
    const positions = breadcrumbsFixture.map((position) =>
      normalizeTraccarPosition(position, 'live'),
    )

    const accumulated = appendBreadcrumbPositions([], positions)

    expect(accumulated).toHaveLength(3)
    expect(accumulated[0].timestamp).toBe('2026-04-06T10:00:00.000Z')
    expect(accumulated[2].timestamp).toBe('2026-04-06T10:30:00.000Z')

    const deduplicated = appendBreadcrumbPositions(accumulated, positions)
    expect(deduplicated).toHaveLength(3)
  })

  it('keeps same-second distinct Traccar positions when ids differ [DON-233]', () => {
    const first = normalizeTraccarPosition(
      {
        id: 101,
        deviceId: 7,
        latitude: 52.001,
        longitude: -9.701,
        fixTime: '2026-04-06T10:00:05.000Z',
      },
      'live',
    )
    const second = normalizeTraccarPosition(
      {
        id: 102,
        deviceId: 7,
        latitude: 52.002,
        longitude: -9.702,
        fixTime: '2026-04-06T10:00:05.000Z',
      },
      'live',
    )

    const accumulated = appendBreadcrumbPositions([], [first, second])

    expect(accumulated.map((position) => position.id)).toEqual(['101', '102'])
  })

  it('does not delegate safety-critical tie ordering to the host locale [DON-260]', () => {
    const positions = [102, 101].map((id) =>
      normalizeTraccarPosition(
        {
          id,
          deviceId: 7,
          latitude: 52 + id / 1_000_000,
          longitude: -9 - id / 1_000_000,
          fixTime: '2026-04-06T10:00:05.000Z',
        },
        'live',
      ),
    )
    vi.spyOn(String.prototype, 'localeCompare').mockImplementation(() => {
      throw new Error('host locale comparator must not be used')
    })

    expect(appendBreadcrumbPositions([], positions).map((position) => position.id)).toEqual([
      '101',
      '102',
    ])
  })

  it('does not rebuild breadcrumb history when an incremental poll has no new positions', () => {
    const positions = breadcrumbsFixture.map((position) =>
      normalizeTraccarPosition(position, 'live'),
    )

    expect(appendBreadcrumbPositions(positions, [])).toBe(positions)
  })

  it('does not invalidate the retained snapshot for duplicate-only overlap polls [DON-240]', () => {
    const positions = breadcrumbsFixture.map((position) =>
      normalizeTraccarPosition(position, 'live'),
    )
    const accumulator = createBreadcrumbAccumulator()

    const initial = accumulator.append(positions)
    const overlapOnly = accumulator.append([...positions])

    expect(overlapOnly).toBe(initial)
    expect(overlapOnly.positions).toBe(initial.positions)
    expect(overlapOnly.metadata).toBe(initial.metadata)
    expect(overlapOnly.metadata.totalObserved).toBe(positions.length)
  })

  it('publishes one-device appends within the 200 ms renderer gate at the live history limit [DON-269]', () => {
    const baseTimeMs = Date.parse('2026-08-23T00:00:00.000Z')
    const history = Array.from({ length: 100 }, (_, deviceIndex) =>
      Array.from({ length: 5_000 }, (_, fixIndex): NormalizedTrackingPosition => ({
        id: `${deviceIndex + 1}-${fixIndex}`,
        device_id: String(deviceIndex + 1),
        lat: 52 + deviceIndex * 0.0001,
        lon: -9 - deviceIndex * 0.0001,
        altitude: null,
        speed: null,
        battery: null,
        accuracy: 5,
        timestamp: new Date(baseTimeMs + fixIndex * 60_000).toISOString(),
        source: 'traccar',
        data_origin: 'live',
        cache_age_seconds: null,
        device_cache_stale: false,
      })),
    ).flat()
    const accumulator = createBreadcrumbAccumulator(history)
    accumulator.snapshot()

    const startedAt = performance.now()
    const result = accumulator.append([{
      ...history[4_999]!,
      id: '1-5000',
      timestamp: new Date(baseTimeMs + 5_000 * 60_000).toISOString(),
    }])
    const durationMs = performance.now() - startedAt

    expect(result.positions.length).toBeLessThanOrEqual(500_000)
    expect(result.metadata.totalObserved).toBe(500_001)
    expect(durationMs).toBeLessThan(200)
  })

  it('does not let a noisy device evict another device from the live breadcrumb budget [DON-159]', () => {
    const noisyDeviceBreadcrumbs = Array.from({ length: 25_000 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: 2,
          latitude: 52 + index / 1_000_000,
          longitude: -9.7 - index / 1_000_000,
          fixTime: new Date(Date.UTC(2026, 5, 13, 0, 0, index)).toISOString(),
        },
        'live',
      ),
    )
    const quietDeviceBreadcrumbs = Array.from({ length: 3_280 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: 50_000 + index,
          deviceId: 25,
          latitude: 51.99 + index / 1_000_000,
          longitude: -9.74 - index / 1_000_000,
          fixTime: new Date(Date.UTC(2026, 5, 12, 12, 0, index)).toISOString(),
        },
        'live',
      ),
    )

    const result = accumulateBreadcrumbPositions(
      [],
      [...quietDeviceBreadcrumbs, ...noisyDeviceBreadcrumbs],
    )

    expect(result.positions.some((position) => position.device_id === '25')).toBe(true)
    expect(result.positions.filter((position) => position.device_id === '25')).toHaveLength(3_280)
    expect(result.metadata.deviceBudgets).toContainEqual(
      expect.objectContaining({
        deviceId: '2',
        retained: expect.any(Number),
        total: 25_000,
        firstTimestamp: noisyDeviceBreadcrumbs[0]!.timestamp,
        lastTimestamp: noisyDeviceBreadcrumbs.at(-1)!.timestamp,
        truncated: true,
      }),
    )
    expect(result.metadata.deviceBudgets).toContainEqual(
      expect.objectContaining({
        deviceId: '25',
        retained: 3_280,
        total: 3_280,
        truncated: false,
      }),
    )
    const noisyBudget = result.metadata.deviceBudgets.find(
      (budget) => budget.deviceId === '2',
    )
    expect(noisyBudget?.retained).toBeGreaterThanOrEqual(2_500)
    expect(noisyBudget?.retained).toBeLessThanOrEqual(5_000)
  })

  it('does not re-sort the entire retained history on a steady-state incremental poll [DON-165]', () => {
    // A real incident: one device with a long, already-accumulated trail. Each
    // poll appends only a few fresh fixes. The accumulator must integrate the
    // increment incrementally, not re-sort the whole retained set every poll —
    // otherwise per-poll cost grows with cumulative history (the DON-151 class).
    const baseMs = Date.UTC(2026, 5, 13, 0, 0, 0)
    const existing = Array.from({ length: 4_000 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: 7,
          latitude: 52 + index / 1_000_000,
          longitude: -9.7 - index / 1_000_000,
          fixTime: new Date(baseMs + index * 1_000).toISOString(),
        },
        'live',
      ),
    )
    // Seed the accumulator so `existing` is in the same shape it has across polls.
    const seeded = accumulateBreadcrumbPositions([], existing).positions

    const incoming = Array.from({ length: 5 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: 10_000 + index,
          deviceId: 7,
          latitude: 52.01 + index / 1_000_000,
          longitude: -9.71 - index / 1_000_000,
          fixTime: new Date(baseMs + (4_000 + index) * 1_000).toISOString(),
        },
        'live',
      ),
    )

    const parseSpy = vi.spyOn(Date, 'parse')
    const result = accumulateBreadcrumbPositions(seeded, incoming)
    const parseCalls = parseSpy.mock.calls.length

    // Correctness: increment integrated, no loss, global chronological order
    // preserved (the established contract — see tracking-geojson DON-159 test).
    expect(result.positions).toHaveLength(4_005)
    expect(result.positions.at(-1)!.id).toBe('10004')
    const timestamps = result.positions.map((position) => Date.parse(position.timestamp))
    expect(timestamps).toEqual([...timestamps].sort((left, right) => left - right))

    // Scaling guard: the old implementation called Date.parse inside two
    // O(n log n) sort comparators, so per-poll parse cost grew with the whole
    // retained set times a log factor (~16k calls here). The fix parses each
    // breadcrumb's timestamp at most once per poll — bounded by the combined
    // set size, with no log multiplier. This is the invariant that keeps
    // per-poll cost from scaling with cumulative history.
    expect(parseCalls).toBeLessThanOrEqual(seeded.length + incoming.length)
  })

  it('merges steady-state appends without reparsing retained breadcrumb history [DON-165]', () => {
    const baseMs = Date.UTC(2026, 5, 13, 0, 0, 0)
    const existing = Array.from({ length: 25_000 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: 7,
          latitude: 52 + index / 1_000_000,
          longitude: -9.7 - index / 1_000_000,
          fixTime: new Date(baseMs + index * 1_000).toISOString(),
        },
        'live',
      ),
    )
    const quietDevice = Array.from({ length: 20 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: 100_000 + index,
          deviceId: 25,
          latitude: 52.2 + index / 1_000_000,
          longitude: -9.9 - index / 1_000_000,
          fixTime: new Date(baseMs + index * 2_000).toISOString(),
        },
        'live',
      ),
    )
    const accumulator = createBreadcrumbAccumulator()
    accumulator.reset([...existing, ...quietDevice])

    const incoming = Array.from({ length: 3 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: 200_000 + index,
          deviceId: 7,
          latitude: 52.5 + index / 1_000_000,
          longitude: -9.5 - index / 1_000_000,
          fixTime: new Date(baseMs + (25_000 + index) * 1_000).toISOString(),
        },
        'live',
      ),
    )

    const parseSpy = vi.spyOn(Date, 'parse')
    const result = accumulator.append(incoming)

    expect(parseSpy.mock.calls.length).toBeLessThanOrEqual(incoming.length)
    expect(result.positions.filter((position) => position.device_id === '25')).toHaveLength(20)
    expect(result.metadata.deviceBudgets).toContainEqual(
      expect.objectContaining({
        deviceId: '7',
        retained: expect.any(Number),
        total: 25_003,
        firstTimestamp: existing[0]!.timestamp,
        lastTimestamp: incoming.at(-1)!.timestamp,
        truncated: true,
      }),
    )
    const noisyBudget = result.metadata.deviceBudgets.find(
      (budget) => budget.deviceId === '7',
    )
    expect(noisyBudget?.retained).toBeGreaterThanOrEqual(2_500)
    expect(noisyBudget?.retained).toBeLessThanOrEqual(5_000)
    expect(result.positions.at(-1)!.timestamp).toBe(incoming.at(-1)!.timestamp)
  })

  it('keeps a 14-day append tail bounded after canonical compaction', () => {
    const accumulator = createBreadcrumbAccumulator()
    const startedAtMs = Date.UTC(2026, 6, 1, 0, 0, 0)
    let nextId = 1

    for (let day = 0; day < 14; day += 1) {
      const dailyFixes = Array.from({ length: 1_000 }, (_, index) =>
        normalizeTraccarPosition(
          {
            id: nextId++,
            deviceId: 7,
            latitude: 52 + (day * 1_000 + index) / 1_000_000,
            longitude: -9.7 - (day * 1_000 + index) / 1_000_000,
            fixTime: new Date(
              startedAtMs + day * 24 * 60 * 60 * 1_000 + index * 30_000,
            ).toISOString(),
          },
          'live',
        ),
      )
      accumulator.append(dailyFixes)
      const compacted = accumulator.compact()
      expect(
        compacted.metadata.deviceBudgets.find((budget) => budget.deviceId === '7')
          ?.sourceRetained,
      ).toBeLessThanOrEqual(5_000)
    }

    const settled = accumulator.snapshot()
    expect(settled.metadata.totalObserved).toBe(14_000)
    expect(settled.positions[0]?.timestamp).toBe(
      new Date(startedAtMs).toISOString(),
    )
    expect(settled.positions.at(-1)?.id).toBe('14000')
  })

  it('bounds retained source history while preserving observed breadcrumb totals [DON-235]', () => {
    const baseMs = Date.UTC(2026, 5, 13, 0, 0, 0)
    const highRateBreadcrumbs = Array.from({ length: 12_000 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: 7,
          latitude: 52 + index / 1_000_000,
          longitude: -9.7 - index / 1_000_000,
          fixTime: new Date(baseMs + index * 1_000).toISOString(),
        },
        'live',
      ),
    )
    const accumulator = createBreadcrumbAccumulator()

    const result = accumulator.append(highRateBreadcrumbs)

    expect(result.positions.length).toBeGreaterThanOrEqual(2_500)
    expect(result.positions.length).toBeLessThanOrEqual(5_000)
    expect(result.metadata.totalObserved).toBe(12_000)
    expect(result.metadata.deviceBudgets).toContainEqual(
      expect.objectContaining({
        deviceId: '7',
        retained: result.positions.length,
        sourceRetained: 12_000,
        total: 12_000,
        firstTimestamp: highRateBreadcrumbs[0]!.timestamp,
        lastTimestamp: highRateBreadcrumbs.at(-1)!.timestamp,
        truncated: true,
      }),
    )
  })

  it('preserves a 36-hour route within 25 metres when the render budget is exceeded', () => {
    const fixIntervalMs = 5_000
    const gapDurationMs = 10 * 60 * 1_000
    const fixesIn36Hours = (36 * 60 * 60 * 1_000) / fixIntervalMs
    const fixesOmittedDuringGap = gapDurationMs / fixIntervalMs
    const totalFixes = fixesIn36Hours - fixesOmittedDuringGap
    const gapStartsAtIndex = Math.floor(totalFixes / 2)
    const baseMs = Date.UTC(2026, 6, 28, 0, 0, 0)
    const baseline = Array.from({ length: totalFixes }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: 7,
          latitude: 52,
          longitude: -9.7,
          fixTime: new Date(
            baseMs +
              index * fixIntervalMs +
              (index >= gapStartsAtIndex ? gapDurationMs : 0),
          ).toISOString(),
        },
        'live',
      ),
    )

    // Find an ordinary pair that the current bounded representation omits,
    // without coupling the regression to epoch-specific bucket identities.
    const baselineRetainedIds = new Set(
      createBreadcrumbAccumulator()
        .append(baseline)
        .positions.map((position) => position.id),
    )
    const protectedIds = new Set([
      baseline[0]!.id,
      baseline.at(-1)!.id,
      baseline[gapStartsAtIndex - 1]!.id,
      baseline[gapStartsAtIndex]!.id,
    ])
    const excursionIndex = baseline.findIndex(
      (position, index) =>
        index > 0 &&
        index < baseline.length - 1 &&
        !protectedIds.has(position.id) &&
        !protectedIds.has(baseline[index + 1]!.id) &&
        !baselineRetainedIds.has(position.id) &&
        !baselineRetainedIds.has(baseline[index + 1]!.id),
    )
    expect(excursionIndex).toBeGreaterThan(0)

    const excursionHeightMetres = 200
    const metresPerDegreeLatitude = 111_195
    const completeRoute = baseline.map((position, index) =>
      index === excursionIndex
        ? {
            ...position,
            lat: position.lat + excursionHeightMetres / metresPerDegreeLatitude,
          }
        : position,
    )
    const result = createBreadcrumbAccumulator().append(completeRoute)
    const routeBudget = result.metadata.deviceBudgets[0]
    const retainedIds = new Set(result.positions.map((position) => position.id))
    const excursionErrorMetres = distanceFromPointToRetainedTimeSegmentMetres(
      completeRoute[excursionIndex]!,
      result.positions,
    )

    expect.soft(
      excursionErrorMetres,
      'a bounded route representation must stay within 25m of every raw route vertex',
    ).toBeLessThanOrEqual(25)
    expect.soft(routeBudget?.geometryErrorBoundMetres).toBeLessThanOrEqual(25)
    expect.soft(routeBudget?.targetGeometryErrorSatisfied).toBe(true)
    expect.soft(retainedIds.has(completeRoute[0]!.id), 'first endpoint was dropped').toBe(true)
    expect.soft(
      retainedIds.has(completeRoute.at(-1)!.id),
      'latest endpoint was dropped',
    ).toBe(true)
  })

  it('reports the achieved geometry bound when route complexity exceeds 25 metres', () => {
    const baseMs = Date.UTC(2026, 6, 28, 0, 0, 0)
    const longitudeDelta = 26.6 / (111_195 * Math.cos((52 * Math.PI) / 180))
    const route = Array.from({ length: 6_001 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: 7,
          latitude: 52,
          longitude: -9.7 + (index % 2 === 0 ? 0 : longitudeDelta),
          fixTime: new Date(baseMs + index * 5_000).toISOString(),
        },
        'live',
      ),
    )

    const result = createBreadcrumbAccumulator().append(route)
    const budget = result.metadata.deviceBudgets[0]

    expect(result.positions.length).toBeLessThanOrEqual(5_000)
    expect(budget?.targetGeometryErrorSatisfied).toBe(false)
    expect(budget?.geometryErrorBoundMetres).toBeGreaterThan(25)
    expect(
      distanceFromPointToRetainedTimeSegmentMetres(route[1]!, result.positions),
    ).toBeLessThanOrEqual(budget?.geometryErrorBoundMetres ?? 0)
  })

  it('terminates for more sparse route gaps than the render budget', () => {
    const baseMs = Date.UTC(2026, 6, 28, 0, 0, 0)
    const route = Array.from({ length: 5_001 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: 7,
          latitude: 52,
          longitude: -9.7,
          fixTime: new Date(baseMs + index * 31 * 60 * 1_000).toISOString(),
        },
        'live',
      ),
    )

    const result = createBreadcrumbAccumulator().append(route)

    expect(result.positions.length).toBeLessThanOrEqual(5_000)
    expect(result.positions[0]?.id).toBe('1')
    expect(result.positions.at(-1)?.id).toBe('5001')
  })

  it('preserves revisit ordering instead of drawing a false chord across a loop', () => {
    const baseMs = Date.UTC(2026, 6, 28, 0, 0, 0)
    const baseline = Array.from({ length: 12_000 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: 7,
          latitude: 52,
          longitude: -9.7,
          fixTime: new Date(baseMs + index * 1_000).toISOString(),
        },
        'live',
      ),
    )
    const baselineRetainedIds = new Set(
      createBreadcrumbAccumulator()
        .append(baseline)
        .positions.map((position) => position.id),
    )
    const revisitStartIndex = baseline.findIndex(
      (_, index) =>
        index > 0 &&
        index < baseline.length - 4 &&
        baseline
          .slice(index, index + 4)
          .every((position) => !baselineRetainedIds.has(position.id)),
    )
    expect(revisitStartIndex).toBeGreaterThan(0)

    const metresPerDegreeLatitude = 111_195
    const metresPerDegreeLongitude =
      metresPerDegreeLatitude * Math.cos((52 * Math.PI) / 180)
    const completeRoute = baseline.map((position, index) => {
      if (index === revisitStartIndex) {
        return { ...position, lat: position.lat + 200 / metresPerDegreeLatitude }
      }
      if (index === revisitStartIndex + 2) {
        return { ...position, lon: position.lon + 200 / metresPerDegreeLongitude }
      }
      return position
    })

    const retained = createBreadcrumbAccumulator().append(completeRoute).positions
    const intermediateRevisit = completeRoute[revisitStartIndex + 1]!
    const falseChordErrorMetres = distanceFromPointToRetainedTimeSegmentMetres(
      intermediateRevisit,
      retained,
    )

    expect(
      falseChordErrorMetres,
      'the intermediate A revisit must not be replaced by a B-to-C chord',
    ).toBeLessThanOrEqual(25)
  })

  it('retains the same breadcrumb identities regardless of poll batch boundaries [DON-260]', () => {
    const baseMs = Date.UTC(2026, 6, 28, 0, 0, 0)
    const longitudeDelta = 26.6 / (111_195 * Math.cos((52 * Math.PI) / 180))
    const completeHistory = Array.from({ length: 12_000 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: 7,
          latitude: 52,
          longitude: -9.7 + (index % 2 === 0 ? 0 : longitudeDelta),
          fixTime: new Date(baseMs + index * 5_000).toISOString(),
        },
        'live',
      ),
    )
    const oneBatch = createBreadcrumbAccumulator()
    const manyBatches = createBreadcrumbAccumulator()

    const expected = oneBatch.append(completeHistory)
    for (let offset = 0; offset < completeHistory.length; offset += 1_000) {
      manyBatches.append(completeHistory.slice(offset, offset + 1_000))
    }
    const actual = manyBatches.snapshot()

    expect(actual.positions.map((position) => position.id)).toEqual(
      expected.positions.map((position) => position.id),
    )
    expect(actual.metadata).toEqual(expected.metadata)
  })

  it('does not inflate observed totals when a reconciled history window repeats [DON-260]', () => {
    const baseMs = Date.UTC(2026, 6, 28, 0, 0, 0)
    const history = Array.from({ length: 12_000 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: 7,
          latitude: 52 + index / 1_000_000,
          longitude: -9.7 - index / 1_000_000,
          fixTime: new Date(baseMs + index * 1_000).toISOString(),
        },
        'live',
      ),
    )
    const accumulator = createBreadcrumbAccumulator()

    const first = accumulator.append(history)
    const repeated = accumulator.append(history)

    expect(first.metadata.totalObserved).toBe(12_000)
    expect(repeated.metadata.totalObserved).toBe(12_000)
    expect(repeated.positions.map((position) => position.id)).toEqual(
      first.positions.map((position) => position.id),
    )
  })

  it('resolves persisted restart totals without recounting the reconciliation sweep [DON-260]', () => {
    const baseMs = Date.UTC(2026, 6, 28, 0, 0, 0)
    const history = Array.from({ length: 12_000 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: 7,
          latitude: 52 + index / 1_000_000,
          longitude: -9.7 - index / 1_000_000,
          fixTime: new Date(baseMs + index * 1_000).toISOString(),
        },
        'live',
      ),
    )
    const beforeRestart = createBreadcrumbAccumulator().append(history)
    const afterRestart = createBreadcrumbAccumulator()
    afterRestart.reset(beforeRestart.positions, { '7': 12_000 })

    const reconciled = afterRestart.append(history, {
      resolveObservedBaseline: true,
    })

    expect(reconciled.metadata.totalObserved).toBe(12_000)
    expect(reconciled.positions.map((position) => position.id)).toEqual(
      beforeRestart.positions.map((position) => position.id),
    )
  })

  it('resolves omitted canonical overlap identities while counting genuinely later fixes once [DON-260]', () => {
    const first = createNormalizedPosition(
      'source-first',
      '2026-07-28T10:00:00.000Z',
    )
    const omittedBaseline = createNormalizedPosition(
      'source-omitted',
      '2026-07-28T10:05:00.000Z',
    )
    const canonicalLatest = createNormalizedPosition(
      'source-latest',
      '2026-07-28T10:10:00.000Z',
    )
    const genuinelyLater = createNormalizedPosition(
      'source-new',
      '2026-07-28T10:11:00.000Z',
    )
    const accumulator = createBreadcrumbAccumulator()

    accumulator.reset([first, canonicalLatest], { 'device-1': 3 })
    const mixedOverlap = accumulator.append([
      omittedBaseline,
      genuinelyLater,
    ])

    expect(mixedOverlap.metadata.totalObserved).toBe(4)
    expect(accumulator.append([
      omittedBaseline,
      genuinelyLater,
    ]).metadata.totalObserved).toBe(4)
    expect(accumulator.append([{
      ...omittedBaseline,
      lat: omittedBaseline.lat + 0.0001,
    }]).metadata.totalObserved).toBe(4)

    const restarted = createBreadcrumbAccumulator()
    restarted.reset(
      [first, canonicalLatest, genuinelyLater],
      { 'device-1': 4 },
    )
    expect(restarted.append([
      omittedBaseline,
      genuinelyLater,
    ]).metadata.totalObserved).toBe(4)
  })

  it('restores chronological order when an existing source identity changes timestamp [DON-260]', () => {
    const accumulator = createBreadcrumbAccumulator()
    accumulator.append([
      createNormalizedPosition('position-a', '2026-07-28T10:00:00.000Z'),
      createNormalizedPosition('position-b', '2026-07-28T10:10:00.000Z'),
    ])

    const result = accumulator.append([
      createNormalizedPosition('position-a', '2026-07-28T10:20:00.000Z'),
    ])

    expect(result.positions.map((position) => position.id)).toEqual([
      'position-b',
      'position-a',
    ])
  })

  it('uses source identity as the stable tie-breaker for equal-time fixes [DON-260]', () => {
    const laterIdentityFirst = createBreadcrumbAccumulator().append([
      createNormalizedPosition('position-b', '2026-07-28T10:00:00.000Z'),
      createNormalizedPosition('position-a', '2026-07-28T10:00:00.000Z'),
    ])
    const earlierIdentityFirst = createBreadcrumbAccumulator().append([
      createNormalizedPosition('position-a', '2026-07-28T10:00:00.000Z'),
      createNormalizedPosition('position-b', '2026-07-28T10:00:00.000Z'),
    ])

    expect(laterIdentityFirst.positions.map((position) => position.id)).toEqual([
      'position-a',
      'position-b',
    ])
    expect(laterIdentityFirst.positions.map((position) => position.id)).toEqual(
      earlierIdentityFirst.positions.map((position) => position.id),
    )
  })

  it('upgrades a legacy coordinate identity when the same fix returns with a source id [DON-260]', () => {
    const legacy = createNormalizedPosition('', '2026-07-28T10:00:00.000Z')
    const sourced = createNormalizedPosition(
      'traccar-position-1',
      '2026-07-28T10:00:00.000Z',
    )
    const accumulator = createBreadcrumbAccumulator([legacy])

    const result = accumulator.append([sourced])

    expect(result.positions).toEqual([sourced])
    expect(result.metadata.totalObserved).toBe(1)
  })

  it('segments trails when time gaps exceed the configured threshold', () => {
    const positions = [
      normalizeTraccarPosition(
        {
          id: 1,
          deviceId: 1,
          latitude: 52.0,
          longitude: -9.7,
          fixTime: '2026-04-06T10:00:00.000Z',
        },
        'live',
      ),
      normalizeTraccarPosition(
        {
          id: 2,
          deviceId: 1,
          latitude: 52.0001,
          longitude: -9.7001,
          fixTime: '2026-04-06T10:03:00.000Z',
        },
        'live',
      ),
      normalizeTraccarPosition(
        {
          id: 3,
          deviceId: 1,
          latitude: 52.0002,
          longitude: -9.7002,
          fixTime: '2026-04-06T10:12:00.000Z',
        },
        'live',
      ),
    ]

    const segments = createBreadcrumbSegments(positions, 5 * 60 * 1000)

    expect(segments).toHaveLength(2)
    expect(segments[0]).toHaveLength(2)
    expect(segments[1]).toHaveLength(1)
  })
})

function createNormalizedPosition(
  id: string,
  timestamp: string,
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
    timestamp,
    source: 'traccar',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}

/**
 * Measures local ground distance from a raw route vertex to the retained
 * segment that brackets the vertex in time. Using the contemporaneous segment
 * prevents a later revisit to the same place from masking an earlier false
 * chord elsewhere in the rendered route.
 */
function distanceFromPointToRetainedTimeSegmentMetres(
  point: NormalizedTrackingPosition,
  polyline: readonly NormalizedTrackingPosition[],
): number {
  if (polyline.length === 0) {
    return Number.POSITIVE_INFINITY
  }
  if (polyline.length === 1) {
    return distanceFromPointToSegmentMetres(point, polyline[0]!, polyline[0]!)
  }

  const pointTimestampMs = Date.parse(point.timestamp)
  let before = polyline[0]!
  let after = polyline.at(-1)!
  for (const retained of polyline) {
    const retainedTimestampMs = Date.parse(retained.timestamp)
    if (retainedTimestampMs <= pointTimestampMs) {
      before = retained
    }
    if (retainedTimestampMs >= pointTimestampMs) {
      after = retained
      break
    }
  }
  return distanceFromPointToSegmentMetres(point, before, after)
}

/** Converts a short WGS84 segment to a local tangent plane and projects onto it. */
function distanceFromPointToSegmentMetres(
  point: NormalizedTrackingPosition,
  start: NormalizedTrackingPosition,
  end: NormalizedTrackingPosition,
): number {
  const earthRadiusMetres = 6_371_008.8
  const radiansPerDegree = Math.PI / 180
  const longitudeScale =
    earthRadiusMetres * radiansPerDegree * Math.cos(point.lat * radiansPerDegree)
  const latitudeScale = earthRadiusMetres * radiansPerDegree
  const startX = (start.lon - point.lon) * longitudeScale
  const startY = (start.lat - point.lat) * latitudeScale
  const endX = (end.lon - point.lon) * longitudeScale
  const endY = (end.lat - point.lat) * latitudeScale
  const segmentX = endX - startX
  const segmentY = endY - startY
  const squaredSegmentLength = segmentX * segmentX + segmentY * segmentY
  const projection =
    squaredSegmentLength === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, -(startX * segmentX + startY * segmentY) / squaredSegmentLength),
        )
  return Math.hypot(startX + projection * segmentX, startY + projection * segmentY)
}

describe('positionsEqual field discrimination [DON-240]', () => {
  const base: NormalizedTrackingPosition = {
    id: 'pos-1',
    device_id: 'device-1',
    lat: 52.001,
    lon: -9.701,
    altitude: 120,
    speed: 4.2,
    battery: 88,
    accuracy: 5,
    timestamp: '2026-04-06T10:00:05.000Z',
    timestamp_source: 'fix',
    fix_time_unverified: false,
    source: 'live',
    data_origin: 'live',
    cache_age_seconds: 0,
    device_cache_stale: false,
  }

  // A value of the correct type that is guaranteed to differ from the base value.
  function differentValue(value: unknown): unknown {
    if (typeof value === 'number') return value + 1
    if (typeof value === 'string') return `${value}#changed`
    if (typeof value === 'boolean') return !value
    return 'changed-from-null'
  }

  it('treats an identical position as equal', () => {
    expect(positionsEqual(base, { ...base })).toBe(true)
  })

  it('detects a change in every compared field', () => {
    for (const key of COMPARED_POSITION_KEYS) {
      const mutated = { ...base, [key]: differentValue(base[key]) } as NormalizedTrackingPosition
      expect(positionsEqual(base, mutated), `field ${key} was not discriminated`).toBe(false)
    }
  })

  it('compares exactly the fields present on a normalized position (no field left uncompared)', () => {
    const actualFields = Object.keys(base).sort()
    const comparedFields = [...COMPARED_POSITION_KEYS].sort()
    expect(comparedFields).toEqual(actualFields)
  })
})
