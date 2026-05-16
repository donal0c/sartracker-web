import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyAppRuntimeController,
  clearAppRuntimeControllerForTest,
  getAppRuntimeController,
} from '../../src/features/runtime/app-runtime-controller'

describe('app runtime controller registry', () => {
  beforeEach(() => {
    clearAppRuntimeControllerForTest()
  })

  afterEach(() => {
    clearAppRuntimeControllerForTest()
    vi.restoreAllMocks()
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

  it('installs the next controller when previous disposal throws', async () => {
    const previousDispose = vi.fn(() => {
      throw new Error('previous cleanup failed')
    })
    const nextReloadSettings = vi.fn(async () => undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    applyAppRuntimeController({
      reloadSettings: vi.fn(async () => undefined),
      dispose: previousDispose,
    })

    expect(() =>
      applyAppRuntimeController({
        reloadSettings: nextReloadSettings,
        dispose: vi.fn(),
      }),
    ).not.toThrow()

    await getAppRuntimeController()?.reloadSettings({ forceConnect: true })

    expect(previousDispose).toHaveBeenCalledTimes(1)
    expect(nextReloadSettings).toHaveBeenCalledWith({ forceConnect: true })
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to dispose previous app runtime controller during replacement.',
      expect.any(Error),
    )
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

  it('clears the active controller even when active disposal throws', () => {
    const dispose = vi.fn(() => {
      throw new Error('active cleanup failed')
    })

    applyAppRuntimeController({
      reloadSettings: vi.fn(async () => undefined),
      dispose,
    })

    const controller = getAppRuntimeController()
    expect(() => controller?.dispose()).toThrow('active cleanup failed')
    expect(() => controller?.dispose()).not.toThrow()

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(getAppRuntimeController()).toBeNull()
  })
})
