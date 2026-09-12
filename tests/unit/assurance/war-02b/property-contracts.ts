import { fileURLToPath } from 'node:url'

import {
  formatITMCoordinates,
  itmToWgs84,
  tm65ToWgs84,
  wgs84ToITM,
  wgs84ToTM65,
} from '../../../../src/lib/coordinates'
import { loadIsolatedCommonJs } from '../war-02a/isolated-commonjs'
import type { IrishCoordinateCase, IngestCase } from './arbitraries'

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
  formatITMCoordinates(itm[0], itm[1])
  return (
    Math.abs(itmLat - input.lat) < 1e-7 &&
    Math.abs(itmLon - input.lon) < 1e-7 &&
    Math.abs(tm65Lat - input.lat) < 1e-7 &&
    Math.abs(tm65Lon - input.lon) < 1e-7
  )
}

/** Checks the ingest decision and canonical hash for one generated case. */
export function positionPolicyInvariant(
  policy: PositionPolicy,
  input: IngestCase,
): boolean {
  const canonicalIncoming = policy.canonicalizeAcceptedPosition(
    input.incoming as Record<string, unknown>,
  )
  const result = policy.classifyPositionIngest({
    existing: input.existing as Record<string, unknown> | undefined,
    incoming: input.incoming as Record<string, unknown>,
  })
  const expectedTimestamp = new Date(Date.parse(input.incoming.timestamp)).toISOString()
  return (
    result.decision === input.expected &&
    result.contentHash === canonicalIncoming.contentHash &&
    canonicalIncoming.payload.source_position_id === input.incoming.source_position_id &&
    canonicalIncoming.payload.timestamp === expectedTimestamp
  )
}
