// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { cursorWindowArbitrary } from './arbitraries'
import {
  WAR_02B_CURSOR_OVERLAP_MS,
  cursorWindowInvariant,
  cursorWindowRequestArithmeticInvariant,
  observeCursorWindow,
} from './cursor-window-probe'
import {
  assertBoundedProperty,
  formatBoundedPropertyFailure,
  runBoundedAsyncProperty,
} from './property-runner'

const CONTROL_NAME = 'DON-228 controlled rebreak: public cursor boundary fault injection'

describe('WAR-02B negative controls', () => {
  it(CONTROL_NAME, async () => {
    const rebreakEnabled = process.env.WAR02B_NEGATIVE_CONTROL === 'cursor-window'
    const result = await runBoundedAsyncProperty(
      CONTROL_NAME,
      cursorWindowArbitrary,
      async (input) => {
        if (!rebreakEnabled) {
          return cursorWindowInvariant(await observeCursorWindow(input))
        }

        const baseline = await observeCursorWindow(input)
        if (!cursorWindowInvariant(baseline)) {
          throw new Error('WAR-02B current cursor oracle is broken before fault injection.')
        }

        const mutated = await observeCursorWindow(input, {
          mutateRequestedFrom: (requestedFromMs) =>
            requestedFromMs + WAR_02B_CURSOR_OVERLAP_MS + 1_000,
        })
        if (!cursorWindowRequestArithmeticInvariant(mutated)) {
          throw new Error('WAR-02B fault injection did not preserve the manager request arithmetic.')
        }
        return cursorWindowInvariant(mutated)
      },
      { numRuns: 25 },
    )

    if (!rebreakEnabled) {
      assertBoundedProperty(CONTROL_NAME, result)
      return
    }

    expect(result.failed).toBe(true)
    expect(result.interrupted).toBe(false)
    expect(result.errorInstance).toBeInstanceOf(Error)
    expect((result.errorInstance as Error).message).toBe('Property failed by returning false')
    const failure = formatBoundedPropertyFailure(CONTROL_NAME, result)
    expect(result.counterexample?.[0]).toBeDefined()
    expect(result.counterexamplePath).toEqual(expect.any(String))
    expect(failure).toContain(`counterexample=${JSON.stringify(result.counterexample?.[0])}`)
    expect(failure).toContain(`replay=seed=${result.seed} path=${result.counterexamplePath}`)
    expect(failure).not.toContain('counterexample=undefined')
    expect(failure).not.toContain('path=<none>')
    assertBoundedProperty(CONTROL_NAME, result)
  }, 130_000)
})
