import { describe, expect, it } from 'vitest'

import {
  assertOwnedProcessCleanup,
  hasOwnedProcessCleanupMarker,
  isOwnedProcessCleanupError,
  ownedProcessCleanupBlocked,
} from '../../scripts/qualification/owned-process-custody.mjs'

describe('owned-process cleanup custody', () => {
  it.each([
    [{ supervisorPid: 123, zeroDescendantsAfterRun: false }, true],
    [{ supervisorPid: 123, zeroDescendantsAfterRun: undefined }, true],
    [{ supervisorPid: 123, zeroDescendantsAfterRun: true }, false],
    [{ supervisorPid: null, zeroDescendantsAfterRun: false }, false],
    [{ supervisorPid: undefined, zeroDescendantsAfterRun: false }, false],
  ])('blocks only a launched supervisor without positive cleanup proof: %j => %s', (execution, expected) => {
    expect(ownedProcessCleanupBlocked(execution)).toBe(expected)
  })

  it('throws a bounded typed error without copying process diagnostics', () => {
    let caught: unknown
    try {
      assertOwnedProcessCleanup({
        supervisorPid: 123,
        zeroDescendantsAfterRun: false,
        stdout: 'private output must not cross the boundary',
      }, 'package.reviewed')
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({
      code: 'OWNED_PROCESS_CLEANUP_BLOCKED',
      adapterId: 'package.reviewed',
      resourceCleanupBlocked: true,
    })
    expect(caught).not.toHaveProperty('stdout')
    expect(isOwnedProcessCleanupError(caught, 'package.reviewed')).toBe(true)
    expect(isOwnedProcessCleanupError(caught, 'suite.source')).toBe(false)
  })

  it('accepts an explicit controller marker while keeping the unavailable result unblocked', () => {
    expect(hasOwnedProcessCleanupMarker({ resourceCleanupBlocked: true })).toBe(true)
    expect(hasOwnedProcessCleanupMarker({ supervisorPid: null, zeroDescendantsAfterRun: false })).toBe(false)
  })
})
