// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { cursorWindowArbitrary, ingestCaseArbitrary, irishCoordinateArbitrary } from './arbitraries'
import { cursorWindowInvariant, observeCursorWindow } from './cursor-window-probe'
import {
  coordinateRoundTripInvariant,
  loadPositionPolicy,
  positionPolicyInvariant,
} from './property-contracts'
import {
  assertBoundedProperty,
  runBoundedAsyncProperty,
  runBoundedProperty,
} from './property-runner'

const PROBE_BASE_TIME_MS = Date.parse('2026-09-12T10:00:00.000Z')

describe('WAR-02B bounded safety properties', () => {
  it('holds coordinate transform round trips across the Irish envelope', () => {
    const result = runBoundedProperty(
      'coordinate transform round trip',
      irishCoordinateArbitrary,
      coordinateRoundTripInvariant,
      { numRuns: 100 },
    )
    assertBoundedProperty('coordinate transform round trip', result)
    expect(result.numRuns).toBe(100)
  })

  it('holds position-ingest identity and fail-closed conflict decisions', () => {
    const policy = loadPositionPolicy()
    const result = runBoundedProperty(
      'position ingest identity policy',
      ingestCaseArbitrary,
      (input) => positionPolicyInvariant(policy, input),
      { numRuns: 100 },
    )
    assertBoundedProperty('position ingest identity policy', result)
    expect(result.numRuns).toBe(100)
  })

  it('holds inclusive cursor overlap and completed-window bounds through the public poller', async () => {
    const result = await runBoundedAsyncProperty(
      'incremental breadcrumb cursor/window arithmetic',
      cursorWindowArbitrary,
      async (input) => {
        const observation = await observeCursorWindow(input)
        return cursorWindowInvariant(observation) &&
          observation.requestedToMs === PROBE_BASE_TIME_MS + input.pollingGapMs
      },
      { numRuns: 25 },
    )
    assertBoundedProperty('incremental breadcrumb cursor/window arithmetic', result)
    expect(result.numRuns).toBe(25)
  })
})
