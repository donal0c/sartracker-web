import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('renderer teardown wiring', () => {
  it('exposes the bounded main-to-renderer drain handshake through preload', () => {
    const preload = readFileSync('electron/preload.cjs', 'utf8')

    expect(preload).toContain("'sartracker:app-runtime-teardown-requested'")
    expect(preload).toContain("'sartracker:app-runtime-teardown-ready'")
    expect(preload).toContain('onAppRuntimeTeardownRequested(listener)')
    expect(preload).toContain('acknowledgeAppRuntimeTeardown(input)')
    expect(preload).toContain("window.addEventListener('beforeunload'")
  })

  it('installs the teardown bridge around the real desktop bootstrap promise', () => {
    const entry = readFileSync('src/main.tsx', 'utf8')

    expect(entry).toContain('const runtimeBootstrapPromise = bootstrapAppRuntime()')
    expect(entry).toContain('installAppRuntimeTeardown({')
    expect(entry).toContain('bootstrapPromise: runtimeBootstrapPromise')
  })

  it('marks unexpected renderer-process loss from the main process', () => {
    const main = readFileSync('electron/main.cjs', 'utf8')

    expect(main).toContain('rendererTeardownCoordinator.markRendererUnavailable()')
  })
})
