import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import {
  formatITMCoordinates,
  itmToWgs84,
  tm65ToWgs84,
  wgs84ToITM,
  wgs84ToTM65,
} from '../../../../src/lib/coordinates'
import { loadIsolatedCommonJs } from '../war-02a/isolated-commonjs'
import type {
  CoordinateGoldenAnchorCase,
  CoordinateValidationCase,
  IrishCoordinateCase,
  IngestCase,
} from './arbitraries'

export type PositionPolicy = {
  readonly canonicalizeAcceptedPosition: (input: Record<string, unknown>) => {
    readonly payload: Record<string, unknown>
    readonly canonicalJson: string
    readonly contentHash: string
  }
  readonly classifyPositionIngest: (input: {
    readonly existing: Record<string, unknown> | undefined
    readonly incoming: Record<string, unknown>
  }) => {
    readonly decision: 'insert' | 'duplicate' | 'conflict'
    readonly contentHash: string
  }
}

const positionPolicyFile = fileURLToPath(
  new URL('../../../../electron/position-ingest-policy.cjs', import.meta.url),
)

/** Loads the exact checkout's ingest policy without changing the process module cache. */
export function loadPositionPolicy(mutation?: { readonly from: string; readonly to: string }): PositionPolicy {
  return loadIsolatedCommonJs<PositionPolicy>(positionPolicyFile, {}, mutation)
}

/** Checks the round-trip precision and displayability of one Irish coordinate. */
export function coordinateRoundTripInvariant(input: IrishCoordinateCase): boolean {
  const itm = wgs84ToITM(input.lat, input.lon)
  const tm65 = wgs84ToTM65(input.lat, input.lon)
  const [itmLat, itmLon] = itmToWgs84(itm[0], itm[1])
  const [tm65Lat, tm65Lon] = tm65ToWgs84(tm65[0], tm65[1])
  const formatted = formatITMCoordinates(itm[0], itm[1])
  const formattedParts = formatted.split(', ').map(Number)
  return (
    formattedParts.length === 2 &&
    formattedParts[0] === Math.round(itm[0]) &&
    formattedParts[1] === Math.round(itm[1]) &&
    Math.abs(itmLat - input.lat) < 1e-7 &&
    Math.abs(itmLon - input.lon) < 1e-7 &&
    Math.abs(tm65Lat - input.lat) < 1e-7 &&
    Math.abs(tm65Lon - input.lon) < 1e-7
  )
}

/** Checks both directions of a published TM65/WGS84 anchor independent of self-inversion. */
export function coordinateGoldenAnchorInvariant(input: CoordinateGoldenAnchorCase): boolean {
  const [reverseLat, reverseLon] = tm65ToWgs84(input.easting, input.northing)
  const [forwardEasting, forwardNorthing] = wgs84ToTM65(input.lat, input.lon)
  return (
    Math.abs(reverseLat - input.lat) <= input.toleranceDegrees &&
    Math.abs(reverseLon - input.lon) <= input.toleranceDegrees &&
    Math.round(forwardEasting) === input.easting &&
    Math.round(forwardNorthing) === input.northing
  )
}

/** Confirms that every generated invalid coordinate is rejected by the relevant boundary. */
export function coordinateValidationInvariant(input: CoordinateValidationCase): boolean {
  try {
    if (input.kind === 'wgs84-itm') {
      wgs84ToITM(input.lat, input.lon)
    } else if (input.kind === 'wgs84-tm65') {
      wgs84ToTM65(input.lat, input.lon)
    } else if (input.kind === 'itm') {
      itmToWgs84(input.easting, input.northing)
    } else {
      formatITMCoordinates(input.easting, input.northing)
    }
    return false
  } catch {
    return true
  }
}

/** Independently computes the immutable position identity hash for the property oracle. */
function independentContentHash(input: IngestCase['incoming']): {
  readonly payload: Record<string, unknown>
  readonly canonicalJson: string
  readonly contentHash: string
} {
  const payload = {
    source_position_id: input.source_position_id ?? null,
    device_id: input.device_id,
    name: input.name ?? null,
    lat: input.lat,
    lon: input.lon,
    altitude: input.altitude ?? null,
    speed: input.speed ?? null,
    battery: input.battery ?? null,
    accuracy: input.accuracy ?? null,
    source: input.source ?? null,
    timestamp: new Date(Date.parse(input.timestamp)).toISOString(),
  }
  const canonicalJson = JSON.stringify(payload)
  return {
    payload,
    canonicalJson,
    contentHash: `v1:${createHash('sha256').update(canonicalJson, 'utf8').digest('hex')}`,
  }
}

/** Checks the ingest decision and canonical hash for one generated case. */
export function positionPolicyInvariant(
  policy: PositionPolicy,
  input: IngestCase,
): boolean {
  const canonicalIncoming = policy.canonicalizeAcceptedPosition(
    input.incoming as Record<string, unknown>,
  )
  const expectedIncoming = independentContentHash(input.incoming)
  const result = policy.classifyPositionIngest({
    existing: input.existing as Record<string, unknown> | undefined,
    incoming: input.incoming as Record<string, unknown>,
  })
  return (
    result.decision === input.expected &&
    canonicalIncoming.canonicalJson === expectedIncoming.canonicalJson &&
    canonicalIncoming.contentHash === expectedIncoming.contentHash &&
    result.contentHash === expectedIncoming.contentHash &&
    canonicalIncoming.payload.source_position_id === expectedIncoming.payload.source_position_id &&
    canonicalIncoming.payload.timestamp === expectedIncoming.payload.timestamp
  )
}
