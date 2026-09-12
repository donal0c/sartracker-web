// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { cursorWindowArbitrary } from './arbitraries'
import {
  applyCursorWindowRebreak,
  cursorWindowInvariant,
  observeCursorWindow,
} from './cursor-window-probe'
import {
  assertBoundedProperty,
  formatBoundedPropertyFailure,
  runBoundedAsyncProperty,
} from './property-runner'

const CONTROL_NAME = 'DON-228 controlled rebreak: cursor/window skips boundary fixes'

describe('WAR-02B negative controls', () => {
  it(CONTROL_NAME, async () => {
    const result = await runBoundedAsyncProperty(
      CONTROL_NAME,
      cursorWindowArbitrary,
      async (input) => {
        const current = await observeCursorWindow(input)
        // Deliberately reintroduce the historical exclusive +1000 ms cursor advance.
        return cursorWindowInvariant(applyCursorWindowRebreak(current))
      },
      { numRuns: 25 },
    )

    expect(result.failed).toBe(true)
    expect(result.interrupted).toBe(false)
    expect(result.errorInstance).toBeInstanceOf(Error)
    expect((result.errorInstance as Error).message).toBe('Property failed by returning false')

    if (process.env.WAR02B_NEGATIVE_CONTROL === 'cursor-window') {
      assertBoundedProperty(CONTROL_NAME, result)
      return
    }

    expect(formatBoundedPropertyFailure(CONTROL_NAME, result)).toContain(
      'counterexample=',
    )
    expect(formatBoundedPropertyFailure(CONTROL_NAME, result)).toContain(
      'replay=seed=',
    )
  }, 130_000)
})
