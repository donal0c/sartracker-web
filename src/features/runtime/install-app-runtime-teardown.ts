import { disposeAppRuntimeController } from './app-runtime-controller'

type AppRuntimeTeardownRequest = {
  readonly requestId: string
  readonly reason: string
}

type AppRuntimeTeardownBridge = {
  readonly onAppRuntimeTeardownRequested: (
    listener: (input: AppRuntimeTeardownRequest) => void,
  ) => () => void
  readonly acknowledgeAppRuntimeTeardown: (input: {
    readonly requestId: string
    readonly ok: boolean
  }) => void
}

type InstallAppRuntimeTeardownDependencies = {
  readonly bridge?: AppRuntimeTeardownBridge
  readonly bootstrapPromise: Promise<void>
  readonly disposeAppRuntime?: () => Promise<void>
}

/**
 * Installs the renderer half of the main-owned bounded teardown handshake.
 */
export function installAppRuntimeTeardown(
  dependencies: InstallAppRuntimeTeardownDependencies,
): () => void {
  const bridge = dependencies.bridge ?? window.sartrackerElectron
  const onAppRuntimeTeardownRequested = bridge?.onAppRuntimeTeardownRequested
  const acknowledgeAppRuntimeTeardown = bridge?.acknowledgeAppRuntimeTeardown
  if (onAppRuntimeTeardownRequested === undefined || acknowledgeAppRuntimeTeardown === undefined) {
    return () => undefined
  }
  const teardownBridge: AppRuntimeTeardownBridge = {
    onAppRuntimeTeardownRequested,
    acknowledgeAppRuntimeTeardown,
  }
  const disposeAppRuntime = dependencies.disposeAppRuntime ?? disposeAppRuntimeController
  return teardownBridge.onAppRuntimeTeardownRequested((input) => {
    void acknowledgeAfterCleanup({
      bridge: teardownBridge,
      input,
      bootstrapPromise: dependencies.bootstrapPromise,
      disposeAppRuntime,
    })
  })
}

/** Acknowledges success only after bootstrap and the evidence drain settle. */
async function acknowledgeAfterCleanup(input: {
  readonly bridge: AppRuntimeTeardownBridge
  readonly input: AppRuntimeTeardownRequest
  readonly bootstrapPromise: Promise<void>
  readonly disposeAppRuntime: () => Promise<void>
}): Promise<void> {
  let ok = false
  try {
    await input.bootstrapPromise
    await input.disposeAppRuntime()
    ok = true
  } catch (error) {
    console.error('App runtime teardown could not drain renderer evidence.', error)
  }
  input.bridge.acknowledgeAppRuntimeTeardown({
    requestId: input.input.requestId,
    ok,
  })
}
