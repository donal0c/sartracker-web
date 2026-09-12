import * as fc from 'fast-check'

import type { NormalizedTrackingPosition } from '../../../../src/features/tracking/tracking-types'

export type IrishCoordinateCase = {
  readonly lat: number
  readonly lon: number
}

const coordinateNumber = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true })

/** Generates finite coordinates inside the deliberately inclusive Irish envelope. */
export const irishCoordinateArbitrary: fc.Arbitrary<IrishCoordinateCase> = fc.record({
  lat: coordinateNumber(51.31, 55.59),
  lon: coordinateNumber(-10.79, -5.81),
})

export type IngestPosition = {
  readonly source_position_id: string
  readonly device_id: string
  readonly name: string
  readonly lat: number
  readonly lon: number
  readonly altitude: number
  readonly speed: number
  readonly battery: number
  readonly accuracy: number
  readonly source: string
  readonly timestamp: string
}

export type IngestCase = {
  readonly kind: 'insert' | 'duplicate' | 'conflict' | 'hash-conflict'
  readonly existing: IngestPosition & { readonly content_hash?: string } | undefined
  readonly incoming: IngestPosition
  readonly expected: 'insert' | 'duplicate' | 'conflict'
}

const timestampPairArbitrary = fc.constantFrom(
  ['2026-09-12T10:00:00.000Z', '2026-09-12T10:00:00+00:00'] as const,
  ['2026-09-12T10:00:00.125Z', '2026-09-12T11:00:00.125+01:00'] as const,
  ['2026-09-12T10:00:00.000Z', '2026-09-12T09:00:00.000-01:00'] as const,
)

const positionArbitrary: fc.Arbitrary<IngestPosition> = fc.record({
  source_position_id: fc.stringMatching(/^source-[a-z0-9]{1,8}$/u),
  device_id: fc.stringMatching(/^device-[a-z0-9]{1,6}$/u),
  name: fc.stringMatching(/^[A-Z][a-z]{0,8}$/u),
  lat: coordinateNumber(51.31, 55.59),
  lon: coordinateNumber(-10.79, -5.81),
  altitude: fc.double({ min: 0, max: 2_000, noNaN: true, noDefaultInfinity: true }),
  speed: fc.double({ min: 0, max: 150, noNaN: true, noDefaultInfinity: true }),
  battery: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  accuracy: fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
  source: fc.constantFrom('osmand', 'gps103', 'test-source'),
  timestamp: fc.constant('2026-09-12T10:00:00.000Z'),
})

/** Generates the insert, idempotent duplicate, content conflict, and hash-integrity cases. */
export const ingestCaseArbitrary: fc.Arbitrary<IngestCase> = fc
  .record({
    kind: fc.constantFrom('insert', 'duplicate', 'conflict', 'hash-conflict' as const),
    base: positionArbitrary,
    timestamps: timestampPairArbitrary,
  })
  .map(({ kind, base, timestamps }) => {
    const incoming = { ...base, timestamp: timestamps[0] }
    if (kind === 'insert') {
      return { kind, existing: undefined, incoming, expected: 'insert' } satisfies IngestCase
    }
    if (kind === 'duplicate') {
      return {
        kind,
        existing: { ...base, timestamp: timestamps[1] },
        incoming,
        expected: 'duplicate',
      } satisfies IngestCase
    }
    if (kind === 'hash-conflict') {
      return {
        kind,
        existing: { ...base, timestamp: timestamps[1], content_hash: `v1:${'0'.repeat(64)}` },
        incoming,
        expected: 'conflict',
      } satisfies IngestCase
    }
    return {
      kind,
      existing: { ...base, timestamp: timestamps[1] },
      incoming: { ...incoming, lat: incoming.lat + 0.01 },
      expected: 'conflict',
    } satisfies IngestCase
  })

export type CursorWindowCase = {
  readonly previousCursorAgeMs: number
  readonly pollingGapMs: number
}

/** Keeps seeded cursors inside the first five-minute request and two-hour bound. */
export const cursorWindowArbitrary: fc.Arbitrary<CursorWindowCase> = fc.record({
  previousCursorAgeMs: fc.integer({ min: 0, max: 4 * 60 * 1000 }),
  pollingGapMs: fc.integer({ min: 5_000, max: 30 * 60 * 1000 }),
})

/** Provides a minimal valid position for the public polling-manager probe. */
export function createProbePosition(timestamp: string): NormalizedTrackingPosition {
  return {
    id: 'war-02b-boundary-fix',
    device_id: 'war-02b-device',
    lat: 52.0599,
    lon: -9.5045,
    altitude: 100,
    speed: 0,
    battery: 90,
    accuracy: 5,
    timestamp,
    timestamp_source: 'fix',
    source: 'war-02b',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}
