import { describe, expect, it, vi } from 'vitest'

import { installAppRuntimeTeardown } from '../../src/features/runtime/install-app-runtime-teardown'

describe('app runtime teardown bridge', () => {
  it('waits for runtime bootstrap and disposal before acknowledging main-process teardown', async () => {
    let listener: ((input: { readonly requestId: string; readonly reason: string }) => void) | undefined
    let finishBootstrap: (() => void) | undefined
    const bootstrapPromise = new Promise<void>((resolve) => {
      finishBootstrap = resolve
    })
    const disposeAppRuntime = vi.fn(async () => undefined)
    const acknowledge = vi.fn()
    const bridge = {
      onAppRuntimeTeardownRequested: vi.fn((nextListener) => {
        listener = nextListener
        return vi.fn()
      }),
      acknowledgeAppRuntimeTeardown: acknowledge,
    }

    installAppRuntimeTeardown({ bridge, bootstrapPromise, disposeAppRuntime })
    listener?.({ requestId: 'request-1', reason: 'app_quit' })
    await Promise.resolve()
    expect(disposeAppRuntime).not.toHaveBeenCalled()
    expect(acknowledge).not.toHaveBeenCalled()

    finishBootstrap?.()
    await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledOnce())
    expect(disposeAppRuntime).toHaveBeenCalledOnce()
    expect(acknowledge).toHaveBeenCalledWith({ requestId: 'request-1', ok: true })
  })

  it('returns a negative acknowledgement when runtime cleanup fails', async () => {
    let listener: ((input: { readonly requestId: string; readonly reason: string }) => void) | undefined
    const acknowledge = vi.fn()
    installAppRuntimeTeardown({
      bridge: {
        onAppRuntimeTeardownRequested: (nextListener) => {
          listener = nextListener
          return vi.fn()
        },
        acknowledgeAppRuntimeTeardown: acknowledge,
      },
      bootstrapPromise: Promise.resolve(),
      disposeAppRuntime: vi.fn(async () => {
        throw new Error('rejection evidence drain failed')
      }),
    })

    listener?.({ requestId: 'request-2', reason: 'renderer_reload' })

    await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledOnce())
    expect(acknowledge).toHaveBeenCalledWith({ requestId: 'request-2', ok: false })
  })
})
