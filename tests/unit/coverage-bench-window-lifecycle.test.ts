import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  attachRendererTeardown,
  readRendererRssBytes,
  sendWorkerEvent,
} = require('../../tools/coverage-renderer-bench/window-lifecycle.cjs') as {
  readonly attachRendererTeardown: (
    window: FakeWindow,
    onDestroyed: () => void,
  ) => void
  readonly readRendererRssBytes: (
    window: FakeWindow | null,
    getAppMetrics: () => readonly AppMetric[],
  ) => number
  readonly sendWorkerEvent: (window: FakeWindow | null, message: unknown) => boolean
}

interface AppMetric {
  readonly pid: number
  readonly memory?: { readonly workingSetSize?: number }
}

class FakeWebContents extends EventEmitter {
  destroyed = false
  throwOnAccess = false
  readonly send = vi.fn()

  isDestroyed(): boolean {
    if (this.throwOnAccess) throw new TypeError('Object has been destroyed')
    return this.destroyed
  }

  getOSProcessId(): number {
    if (this.throwOnAccess) throw new TypeError('Object has been destroyed')
    return 42
  }
}

class FakeWindow extends EventEmitter {
  destroyed = false
  throwOnAccess = false
  readonly webContents = new FakeWebContents()

  isDestroyed(): boolean {
    if (this.throwOnAccess) throw new TypeError('Object has been destroyed')
    return this.destroyed
  }
}

describe('coverage benchmark renderer lifecycle [DON-273]', () => {
  it('detaches immediately when the window or renderer is destroyed', () => {
    const window = new FakeWindow()
    const onDestroyed = vi.fn()
    attachRendererTeardown(window, onDestroyed)

    window.webContents.emit('destroyed')
    window.emit('closed')

    expect(onDestroyed).toHaveBeenCalledTimes(1)
  })

  it('returns zero when renderer destruction races an RSS sample', () => {
    const window = new FakeWindow()
    window.webContents.throwOnAccess = true

    expect(readRendererRssBytes(window, () => [{
      pid: 42,
      memory: { workingSetSize: 128 },
    }])).toBe(0)
  })

  it('drops a worker event when renderer destruction races delivery', () => {
    const window = new FakeWindow()
    window.webContents.throwOnAccess = true

    expect(sendWorkerEvent(window, { type: 'progress' })).toBe(false)
    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})
