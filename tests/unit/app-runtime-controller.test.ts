import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyAppRuntimeController,
  clearAppRuntimeControllerForTest,
  getAppRuntimeController,
} from '../../src/features/runtime/app-runtime-controller'

describe('app runtime controller registry', () => {
  beforeEach(() => {
    clearAppRuntimeControllerForTest()
  })

  it('disposes the previous controller before replacing it', () => {
    const previousDispose = vi.fn()
    const nextDispose = vi.fn()
    const events: string[] = []

    applyAppRuntimeController({
      reloadSettings: vi.fn(async () => undefined),
      dispose: () => {
        events.push('previous-dispose')
        previousDispose()
      },
    })
    applyAppRuntimeController({
      reloadSettings: vi.fn(async () => undefined),
      dispose: () => {
        events.push('next-dispose')
        nextDispose()
      },
    })

    expect(events).toEqual(['previous-dispose'])
    expect(previousDispose).toHaveBeenCalledTimes(1)
    expect(nextDispose).not.toHaveBeenCalled()
  })

  it('makes controller disposal idempotent', () => {
    const dispose = vi.fn()

    applyAppRuntimeController({
      reloadSettings: vi.fn(async () => undefined),
      dispose,
    })

    const controller = getAppRuntimeController()
    controller?.dispose()
    controller?.dispose()

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(getAppRuntimeController()).toBeNull()
  })
})
