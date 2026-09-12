// @vitest-environment node
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  formatBoundedPropertyFailure,
  runBoundedProperty,
  WAR_02B_MAX_RUNS,
} from './property-runner'

describe('WAR-02B bounded property runner', () => {
  it('retains deterministic seed, shrink path, counterexample, and replay data', () => {
    const result = runBoundedProperty(
      'runner failure fixture',
      fc.constant({ value: 'fixed' }),
      () => false,
      { seed: 77, numRuns: 1 },
    )

    const failure = formatBoundedPropertyFailure('runner failure fixture', result)
    expect(result.failed).toBe(true)
    expect(failure).toContain('seed=77')
    expect(failure).toContain('path=')
    expect(failure).toContain('counterexample=')
    expect(failure).toContain('replay=seed=77 path=')
  })

  it('rejects an unbounded CI run request', () => {
    expect(() => runBoundedProperty(
      'runner budget fixture',
      fc.constant(1),
      () => true,
      { numRuns: WAR_02B_MAX_RUNS + 1 },
    )).toThrow(`numRuns must be an integer from 1 to ${WAR_02B_MAX_RUNS}`)
  })
})
