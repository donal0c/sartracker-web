// @vitest-environment node
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  coordinateGoldenAnchorCases,
  coordinateValidationCases,
  cursorWindowArbitrary,
  cursorWindowExtendedArbitrary,
  irishCoordinateBoundaryCases,
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

  it('holds every independent TM65 datum anchor', () => {
    for (const [index, anchor] of coordinateGoldenAnchorCases.entries()) {
      const result = runBoundedProperty(
        `TM65 datum golden anchor ${index + 1}`,
        fc.constant(anchor),
        coordinateGoldenAnchorInvariant,
        { numRuns: 1 },
      )
      assertBoundedProperty(`TM65 datum golden anchor ${index + 1}`, result)
      expect(result.numRuns).toBe(1)
    }
    expect(coordinateGoldenAnchorCases).toHaveLength(2)
  })

  it('exercises every coordinate rejection case, including ITM formatting', () => {
    for (const [index, input] of coordinateValidationCases.entries()) {
      const result = runBoundedProperty(
        `coordinate input validation ${index + 1}`,
        fc.constant(input),
        coordinateValidationInvariant,
        { numRuns: 1 },
      )
      assertBoundedProperty(`coordinate input validation ${index + 1}`, result)
      expect(result.numRuns).toBe(1)
    }
    expect(coordinateValidationCases).toHaveLength(12)
  })

  it('holds coordinate round trips at every inclusive Irish envelope boundary', () => {
    for (const [index, input] of irishCoordinateBoundaryCases.entries()) {
      const result = runBoundedProperty(
        `coordinate envelope boundary ${index + 1}`,
        fc.constant(input),
        coordinateRoundTripInvariant,
        { numRuns: 1 },
      )
      assertBoundedProperty(`coordinate envelope boundary ${index + 1}`, result)
      expect(result.numRuns).toBe(1)
    }
    expect(irishCoordinateBoundaryCases).toHaveLength(4)
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
