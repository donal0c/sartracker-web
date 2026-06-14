import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppRuntimeController } from '../../src/features/runtime/app-runtime-controller'
import { bootstrapAppRuntime } from '../../src/features/runtime/bootstrap-app-runtime'
import {
  getRuntimeBootState,
  markRuntimeBootFailed,
  markRuntimeBootReady,
  markRuntimeBooting,
} from '../../src/features/runtime/runtime-boot-store'

describe('bootstrap app runtime', () => {
  afterEach(() => {
    vi.useRealTimers()
    markRuntimeBooting()
  })

  it('marks desktop startup ready only after applying the runtime controller', async () => {
    const controller = createController()
    const events: string[] = []

    await bootstrapAppRuntime({
      registerServiceWorker: vi.fn(async () => {
        events.push('service-worker')
      }),
      shouldEnableMissionBrowserHarness: vi.fn(() => false),
      startAppRuntime: vi.fn(async () => {
        events.push('start-runtime')
        return controller
      }),
      startMissionBrowserHarness: vi.fn(),
      applyAppRuntimeController: vi.fn(() => {
        events.push('apply-controller')
      }),
      markRuntimeBooting: vi.fn(() => {
        events.push('booting')
      }),
      markRuntimeBootReady: vi.fn(() => {
        events.push('ready')
      }),
      markRuntimeBootFailed: vi.fn(),
    })

    expect(events).toEqual([
      'booting',
      'service-worker',
      'start-runtime',
      'apply-controller',
      'ready',
    ])
  })

  it('uses the browser harness runtime as the ready boundary in hosted mode', async () => {
    const startAppRuntime = vi.fn()
    const startMissionBrowserHarness = vi.fn(async () => undefined)
    const markRuntimeBootReady = vi.fn()

    await bootstrapAppRuntime({
      registerServiceWorker: vi.fn(async () => undefined),
      shouldEnableMissionBrowserHarness: vi.fn(() => true),
      startAppRuntime,
      startMissionBrowserHarness,
      applyAppRuntimeController: vi.fn(),
      markRuntimeBooting: vi.fn(),
      markRuntimeBootReady,
      markRuntimeBootFailed: vi.fn(),
    })

    expect(startAppRuntime).not.toHaveBeenCalled()
    expect(startMissionBrowserHarness).toHaveBeenCalledTimes(1)
    expect(markRuntimeBootReady).toHaveBeenCalledTimes(1)
  })

  it('marks startup failed when runtime initialization throws', async () => {
    const error = new Error('mission database locked')
    const markRuntimeBootFailed = vi.fn()

    await bootstrapAppRuntime({
      registerServiceWorker: vi.fn(async () => undefined),
      shouldEnableMissionBrowserHarness: vi.fn(() => false),
      startAppRuntime: vi.fn(async () => {
        throw error
      }),
      startMissionBrowserHarness: vi.fn(),
      applyAppRuntimeController: vi.fn(),
      markRuntimeBooting: vi.fn(),
      markRuntimeBootReady: vi.fn(),
      markRuntimeBootFailed,
    })

    expect(markRuntimeBootFailed).toHaveBeenCalledWith(error, undefined)
  })

  it('marks startup failed when no operational controller is available outside hosted harness mode', async () => {
    const markRuntimeBootFailed = vi.fn()

    await bootstrapAppRuntime({
      registerServiceWorker: vi.fn(async () => undefined),
      shouldEnableMissionBrowserHarness: vi.fn(() => false),
      startAppRuntime: vi.fn(async () => null),
      startMissionBrowserHarness: vi.fn(),
      applyAppRuntimeController: vi.fn(),
      markRuntimeBooting: vi.fn(),
      markRuntimeBootReady: vi.fn(),
      markRuntimeBootFailed,
    })

    expect(markRuntimeBootFailed).toHaveBeenCalledWith(expect.any(Error), undefined)
    expect((markRuntimeBootFailed.mock.calls[0]?.[0] as Error).message).toContain(
      'No operational runtime controller',
    )
  })

  it('surfaces a stuck booting state through the runtime boot watchdog', async () => {
    vi.useFakeTimers()
    let resolveStartup: ((controller: AppRuntimeController | null) => void) | null = null

    const boot = bootstrapAppRuntime({
      registerServiceWorker: vi.fn(async () => undefined),
      shouldEnableMissionBrowserHarness: vi.fn(() => false),
      startAppRuntime: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveStartup = resolve
          }),
      ),
      startMissionBrowserHarness: vi.fn(),
      applyAppRuntimeController: vi.fn(),
      markRuntimeBooting,
      markRuntimeBootReady,
      markRuntimeBootFailed,
    })

    await Promise.resolve()
    vi.advanceTimersByTime(30_000)

    expect(getRuntimeBootState()).toEqual({
      phase: 'failed',
      error:
        'Runtime startup is taking longer than expected. Reload SAR Tracker from a clean runtime; if this repeats, capture the fault message before operational use.',
    })

    resolveStartup?.(createController())
    await boot

    expect(getRuntimeBootState().phase).toBe('failed')
  })
})

function createController(): AppRuntimeController {
  return {
    reloadSettings: vi.fn(async () => undefined),
    dispose: vi.fn(),
  }
}
