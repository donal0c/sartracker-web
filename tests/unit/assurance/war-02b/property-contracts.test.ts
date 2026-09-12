// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  coordinateGoldenAnchorArbitrary,
  coordinateValidationArbitrary,
  cursorWindowArbitrary,
  cursorWindowExtendedArbitrary,
  ingestCaseArbitrary,
  irishCoordinateArbitrary,
} from './arbitraries'
import {
  cursorWindowBoundsInvariant,
  cursorWindowInvariant,
  observeCursorWindow,
} from './cursor-window-probe'
import {
  coordinateGoldenAnchorInvariant,
  coordinateRoundTripInvariant,
  coordinateValidationInvariant,
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

  it('holds the independent TM65 datum anchor', () => {
    const result = runBoundedProperty(
      'TM65 datum golden anchor',
      coordinateGoldenAnchorArbitrary,
      coordinateGoldenAnchorInvariant,
      { numRuns: 1 },
    )
    assertBoundedProperty('TM65 datum golden anchor', result)
  })

  it('exercises coordinate rejection branches with non-finite and out-of-range inputs', () => {
    const result = runBoundedProperty(
      'coordinate input validation',
      coordinateValidationArbitrary,
      coordinateValidationInvariant,
      { numRuns: 8 },
    )
    assertBoundedProperty('coordinate input validation', result)
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

  it('holds the exact cursor arithmetic across the recent-window clamp boundary', async () => {
    const result = await runBoundedAsyncProperty(
      'bounded breadcrumb cursor/window arithmetic',
      cursorWindowExtendedArbitrary,
      async (input) => cursorWindowBoundsInvariant(await observeCursorWindow(input)),
      { numRuns: 25 },
    )
    assertBoundedProperty('bounded breadcrumb cursor/window arithmetic', result)
    expect(result.numRuns).toBe(25)
  })
})
