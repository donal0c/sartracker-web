import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyAppRuntimeController,
  clearAppRuntimeControllerForTest,
  getAppRuntimeController,
} from '../../src/features/runtime/app-runtime-controller'

describe('app runtime controller registry', () => {
  beforeEach(async () => {
    await clearAppRuntimeControllerForTest()
  })

  afterEach(async () => {
    await clearAppRuntimeControllerForTest()
    vi.restoreAllMocks()
  })

  it('disposes the previous controller before replacing it', async () => {
    const previousDispose = vi.fn()
    const nextDispose = vi.fn()
    const events: string[] = []

    await applyAppRuntimeController({
      reloadSettings: vi.fn(async () => undefined),
      dispose: async () => {
        events.push('previous-dispose')
        previousDispose()
      },
    })
    await applyAppRuntimeController({
      reloadSettings: vi.fn(async () => undefined),
      dispose: async () => {
        events.push('next-dispose')
        nextDispose()
      },
    })

    expect(events).toEqual(['previous-dispose'])
    expect(previousDispose).toHaveBeenCalledTimes(1)
    expect(nextDispose).not.toHaveBeenCalled()
  })

  it('does not install a replacement until asynchronous disposal completes', async () => {
    let finishPreviousDisposal: (() => void) | undefined
    await applyAppRuntimeController({
      reloadSettings: vi.fn(async () => undefined),
      dispose: () => new Promise<void>((resolve) => {
        finishPreviousDisposal = resolve
      }),
    })
    const previousController = getAppRuntimeController()
    const nextReloadSettings = vi.fn(async () => undefined)

    const replacement = applyAppRuntimeController({
      reloadSettings: nextReloadSettings,
      dispose: vi.fn(),
    })

    await vi.waitFor(() => expect(finishPreviousDisposal).toBeTypeOf('function'))
    expect(finishPreviousDisposal).toBeTypeOf('function')
    expect(getAppRuntimeController()).toBe(previousController)
    finishPreviousDisposal?.()
    await replacement
    expect(getAppRuntimeController()).not.toBe(previousController)
    await getAppRuntimeController()?.reloadSettings()
    expect(nextReloadSettings).toHaveBeenCalledOnce()
  })

  it('serializes concurrent replacements through each controller disposal', async () => {
    const events: string[] = []
    let finishInitialDisposal: (() => void) | undefined
    await applyAppRuntimeController({
      reloadSettings: vi.fn(async () => undefined),
      dispose: () => new Promise<void>((resolve) => {
        events.push('initial-dispose')
        finishInitialDisposal = resolve
      }),
    })
    const firstReplacementReload = vi.fn(async () => undefined)
    const secondReplacementReload = vi.fn(async () => undefined)

    const firstReplacement = applyAppRuntimeController({
      reloadSettings: firstReplacementReload,
      dispose: vi.fn(async () => {
        events.push('first-replacement-dispose')
      }),
    })
    const secondReplacement = applyAppRuntimeController({
      reloadSettings: secondReplacementReload,
      dispose: vi.fn(async () => undefined),
    })
    await vi.waitFor(() => expect(finishInitialDisposal).toBeTypeOf('function'))
    finishInitialDisposal?.()

    await Promise.all([firstReplacement, secondReplacement])
    await getAppRuntimeController()?.reloadSettings()

    expect(events).toEqual(['initial-dispose', 'first-replacement-dispose'])
    expect(firstReplacementReload).not.toHaveBeenCalled()
    expect(secondReplacementReload).toHaveBeenCalledOnce()
  })

  it('does not install the next controller when previous disposal fails', async () => {
    const previousDispose = vi.fn(async () => {
      throw new Error('previous cleanup failed')
    })
    const nextReloadSettings = vi.fn(async () => undefined)

    await applyAppRuntimeController({
      reloadSettings: vi.fn(async () => undefined),
      dispose: previousDispose,
    })

    await expect(
      applyAppRuntimeController({
        reloadSettings: nextReloadSettings,
        dispose: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow('previous cleanup failed')

    expect(previousDispose).toHaveBeenCalledTimes(1)
    expect(nextReloadSettings).not.toHaveBeenCalled()
    expect(getAppRuntimeController()).toBeNull()
  })

  it('makes controller disposal idempotent', async () => {
    const dispose = vi.fn(async () => undefined)

    await applyAppRuntimeController({
      reloadSettings: vi.fn(async () => undefined),
      dispose,
    })

    const controller = getAppRuntimeController()
    await controller?.dispose()
    await controller?.dispose()

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(getAppRuntimeController()).toBeNull()
  })

  it('clears the active controller even when active disposal fails', async () => {
    const dispose = vi.fn(async () => {
      throw new Error('active cleanup failed')
    })

    await applyAppRuntimeController({
      reloadSettings: vi.fn(async () => undefined),
      dispose,
    })

    const controller = getAppRuntimeController()
    await expect(controller?.dispose()).rejects.toThrow('active cleanup failed')
    await expect(controller?.dispose()).rejects.toThrow('active cleanup failed')

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(getAppRuntimeController()).toBeNull()
  })
})
