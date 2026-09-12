import * as fc from 'fast-check'
import { createHash } from 'node:crypto'

import type { NormalizedTrackingPosition } from '../../../../src/features/tracking/tracking-types'

export type IrishCoordinateCase = {
  readonly lat: number
  readonly lon: number
}

const coordinateNumber = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true })

/** Supplies exact corner cases for the inclusive production Irish envelope. */
export const irishCoordinateBoundaryCases: readonly IrishCoordinateCase[] = [
  { lat: 51.3, lon: -10.8 },
  { lat: 51.3, lon: -5.8 },
  { lat: 55.6, lon: -10.8 },
  { lat: 55.6, lon: -5.8 },
]

/** Generates finite coordinates inside the inclusive production Irish envelope. */
export const irishCoordinateArbitrary: fc.Arbitrary<IrishCoordinateCase> = fc.record({
  lat: coordinateNumber(51.3, 55.6),
  lon: coordinateNumber(-10.8, -5.8),
})

export type CoordinateGoldenAnchorCase = {
  readonly easting: number
  readonly northing: number
  readonly lat: number
  readonly lon: number
  readonly toleranceDegrees: number
}

/** Supplies independent published TM65/WGS84 anchors rather than self-derived round trips. */
export const coordinateGoldenAnchorCases: readonly CoordinateGoldenAnchorCase[] = [
  {
    easting: 99_842,
    northing: 104_015,
    lat: 52.179337,
    lon: -9.464944,
    toleranceDegrees: 1e-5,
  },
  {
    easting: 80_269,
    northing: 84_392,
    lat: 51.99917,
    lon: -9.74406,
    toleranceDegrees: 1e-5,
  },
]

/** Generates independent published TM65/WGS84 anchors. */
export const coordinateGoldenAnchorArbitrary: fc.Arbitrary<CoordinateGoldenAnchorCase> = fc.constantFrom(
  ...coordinateGoldenAnchorCases,
)

export type CoordinateValidationCase =
  | { readonly kind: 'wgs84'; readonly lat: number; readonly lon: number }
  | { readonly kind: 'itm'; readonly easting: number; readonly northing: number }
  | { readonly kind: 'itm-format'; readonly easting: number; readonly northing: number }

/** Supplies representative rejection inputs, including non-finite values. */
export const coordinateValidationCases: readonly CoordinateValidationCase[] = [
  { kind: 'wgs84', lat: Number.NaN, lon: -9 },
  { kind: 'wgs84', lat: Number.POSITIVE_INFINITY, lon: -9 },
  { kind: 'wgs84', lat: 95, lon: -9 },
  { kind: 'wgs84', lat: 52, lon: -190 },
  { kind: 'wgs84', lat: 50, lon: -9 },
  { kind: 'itm', easting: Number.NaN, northing: 600_000 },
  { kind: 'itm', easting: 390_000, northing: 600_000 },
  { kind: 'itm', easting: 760_000, northing: 600_000 },
  { kind: 'itm', easting: 600_000, northing: Number.POSITIVE_INFINITY },
  { kind: 'itm', easting: 600_000, northing: 490_000 },
  { kind: 'itm-format', easting: 0, northing: 0 },
  { kind: 'itm-format', easting: 528_318, northing: 361_130 },
]

/** Generates representative rejection inputs, including non-finite values. */
export const coordinateValidationArbitrary: fc.Arbitrary<CoordinateValidationCase> = fc.constantFrom(
  ...coordinateValidationCases,
)

export type IngestPosition = {
  readonly source_position_id?: string
  readonly device_id: string
  readonly name?: string
  readonly lat: number
  readonly lon: number
  readonly altitude?: number
  readonly speed?: number
  readonly battery?: number
  readonly accuracy?: number
  readonly source?: string
  readonly timestamp: string
}

export type IngestCase = {
  readonly kind:
    | 'insert'
    | 'duplicate'
    | 'conflict'
    | 'hash-conflict'
    | 'matching-hash'
    | 'unknown-hash-prefix'
    | 'timestamp-conflict'
    | 'optional-fields'
    | 'field-conflict'
    | 'tiny-coordinate-conflict'
  readonly existing: IngestPosition & { readonly content_hash?: string } | undefined
  readonly incoming: IngestPosition
  readonly expected: 'insert' | 'duplicate' | 'conflict'
}

const timestampPairArbitrary = fc.constantFrom(
  ['2026-09-12T10:00:00+00:00', '2026-09-12T10:00:00.000Z'] as const,
  ['2026-09-12T11:00:00.125+01:00', '2026-09-12T10:00:00.125Z'] as const,
  ['2026-09-12T09:00:00.000-01:00', '2026-09-12T10:00:00.000Z'] as const,
)

const positionArbitrary: fc.Arbitrary<Required<IngestPosition>> = fc.record({
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

/** Mirrors the canonical identity hash independently for generated matching-hash fixtures. */
function independentContentHash(position: IngestPosition): string {
  const payload = {
    source_position_id: position.source_position_id ?? null,
    device_id: position.device_id,
    name: position.name ?? null,
    lat: position.lat,
    lon: position.lon,
    altitude: position.altitude ?? null,
    speed: position.speed ?? null,
    battery: position.battery ?? null,
    accuracy: position.accuracy ?? null,
    source: position.source ?? null,
    timestamp: new Date(Date.parse(position.timestamp)).toISOString(),
  }
  const canonicalJson = JSON.stringify(payload)
  return `v1:${createHash('sha256').update(canonicalJson, 'utf8').digest('hex')}`
}

/** Builds an input that exercises the canonicalizer's null-coalescing optional fields. */
function withoutOptionalFields(position: IngestPosition): IngestPosition {
  return {
    device_id: position.device_id,
    lat: position.lat,
    lon: position.lon,
    timestamp: position.timestamp,
  }
}

const conflictFieldArbitrary = fc.constantFrom(
  'source_position_id',
  'device_id',
  'name',
  'lat',
  'lon',
  'altitude',
  'speed',
  'battery',
  'accuracy',
  'source',
  'timestamp',
)

/** Changes one canonical identity field while preserving a valid generated fixture. */
function mutateField(position: Required<IngestPosition>, field: string): IngestPosition {
  switch (field) {
    case 'source_position_id': return { ...position, source_position_id: `${position.source_position_id}-changed` }
    case 'device_id': return { ...position, device_id: `${position.device_id}-changed` }
    case 'name': return { ...position, name: `${position.name} changed` }
    case 'lat': return { ...position, lat: position.lat + 0.01 }
    case 'lon': return { ...position, lon: position.lon + 0.01 }
    case 'altitude': return { ...position, altitude: position.altitude + 1 }
    case 'speed': return { ...position, speed: position.speed + 1 }
    case 'battery': return { ...position, battery: position.battery + 1 }
    case 'accuracy': return { ...position, accuracy: position.accuracy + 1 }
    case 'source': return { ...position, source: `${position.source}-changed` }
    case 'timestamp': return { ...position, timestamp: '2026-09-12T10:00:01.000Z' }
    default: return position
  }
}

/** Generates insert, identity, conflict, optional-field, and hash-integrity cases. */
export const ingestCaseArbitrary: fc.Arbitrary<IngestCase> = fc
  .record({
    kind: fc.constantFrom(
      'insert',
      'duplicate',
      'conflict',
      'hash-conflict',
      'matching-hash',
      'unknown-hash-prefix',
      'timestamp-conflict',
      'optional-fields',
      'field-conflict',
      'tiny-coordinate-conflict',
    ),
    base: positionArbitrary,
    timestamps: timestampPairArbitrary,
    conflictField: conflictFieldArbitrary,
  })
  .map(({ kind, base, timestamps, conflictField }) => {
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
    if (kind === 'matching-hash') {
      const existing = { ...base, timestamp: timestamps[1] }
      return {
        kind,
        existing: { ...existing, content_hash: independentContentHash(existing) },
        incoming,
        expected: 'duplicate',
      } satisfies IngestCase
    }
    if (kind === 'unknown-hash-prefix') {
      const existing = { ...base, timestamp: timestamps[1] }
      return {
        kind,
        existing: {
          ...existing,
          content_hash: `v2:${independentContentHash(existing).slice(3)}`,
        },
        incoming,
        expected: 'duplicate',
      } satisfies IngestCase
    }
    if (kind === 'timestamp-conflict') {
      return {
        kind,
        existing: { ...base, timestamp: '2026-09-12T10:00:01.000Z' },
        incoming,
        expected: 'conflict',
      } satisfies IngestCase
    }
    if (kind === 'optional-fields') {
      return {
        kind,
        existing: withoutOptionalFields({ ...base, timestamp: timestamps[1] }),
        incoming: withoutOptionalFields(incoming),
        expected: 'duplicate',
      } satisfies IngestCase
    }
    if (kind === 'field-conflict') {
      return {
        kind,
        existing: { ...base, timestamp: timestamps[1] },
        incoming: mutateField(base, conflictField),
        expected: 'conflict',
      } satisfies IngestCase
    }
    if (kind === 'tiny-coordinate-conflict') {
      return {
        kind,
        existing: { ...base, timestamp: timestamps[1] },
        incoming: { ...incoming, lat: incoming.lat + 0.000001 },
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

/** Extends cursor ages beyond two hours so the recent-window clamp is exercised. */
export const cursorWindowExtendedArbitrary: fc.Arbitrary<CursorWindowCase> = fc.record({
  previousCursorAgeMs: fc.integer({ min: 0, max: 4 * 60 * 60 * 1000 }),
  pollingGapMs: fc.integer({ min: 5_000, max: 4 * 60 * 60 * 1000 }),
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
