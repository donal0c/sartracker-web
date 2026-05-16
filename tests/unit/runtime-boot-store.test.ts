import { describe, expect, it } from 'vitest'

import {
  getRuntimeBootState,
  markRuntimeBootFailed,
  markRuntimeBootReady,
  markRuntimeBooting,
} from '../../src/features/runtime/runtime-boot-store'

describe('runtime boot store', () => {
  it('moves from booting to ready with no stale error', () => {
    markRuntimeBootFailed(new Error('Previous failure.'))

    markRuntimeBooting()
    markRuntimeBootReady()

    expect(getRuntimeBootState()).toEqual({
      phase: 'ready',
      error: null,
    })
  })

  it('records a clear failure message for startup exceptions', () => {
    markRuntimeBooting()

    markRuntimeBootFailed(new Error('SQLite mission store unavailable.'))

    expect(getRuntimeBootState()).toEqual({
      phase: 'failed',
      error: 'SQLite mission store unavailable.',
    })
  })

  it('uses a safe fallback message for unknown startup failures', () => {
    markRuntimeBootFailed(undefined)

    expect(getRuntimeBootState()).toEqual({
      phase: 'failed',
      error: 'Runtime startup failed before the application became operational.',
    })
  })
})
