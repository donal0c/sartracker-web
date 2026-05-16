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

  it('ignores stale boot completions from older startup attempts', () => {
    const firstBoot = markRuntimeBooting()
    const secondBoot = markRuntimeBooting()

    markRuntimeBootFailed(new Error('older startup failed'), firstBoot)

    expect(getRuntimeBootState()).toEqual({
      phase: 'booting',
      error: null,
    })

    markRuntimeBootReady(secondBoot)

    expect(getRuntimeBootState()).toEqual({
      phase: 'ready',
      error: null,
    })
  })

  it('does not let a late success override a failed boot for the same attempt', () => {
    const boot = markRuntimeBooting()

    markRuntimeBootFailed(new Error('startup timed out'), boot)
    markRuntimeBootReady(boot)

    expect(getRuntimeBootState()).toEqual({
      phase: 'failed',
      error: 'startup timed out',
    })
  })
})
