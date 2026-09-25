import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const startupFailureWindow = require('../../electron/startup-failure-window.cjs') as {
  createStartupFailureDataUrl: (message: string) => string
  showStartupFailureWindow: (input: {
    BrowserWindow: new (options: Record<string, unknown>) => StartupFailureWindowStub
    message: string
  }) => Promise<void>
}

type StartupFailureWindowStub = {
  destroy: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
}

describe('startup failure window', () => {
  it('renders the operator message as escaped text in a self-contained document', () => {
    const url = startupFailureWindow.createStartupFailureDataUrl('<img src=x onerror=alert(1)> & preserve')
    const document = decodeURIComponent(url.slice(url.indexOf(',') + 1))

    expect(url).toMatch(/^data:text\/html;charset=utf-8,/u)
    expect(document).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; preserve')
    expect(document).not.toContain('<img src=x')
    expect(document).toContain('Content-Security-Policy')
    expect(document).toContain('Close and exit')
  })

  it('shows the window after its page loads and resolves only after it closes', async () => {
    const { BrowserWindow, window } = createWindowHarness()
    let closeHandler: (() => void) | undefined
    window.once.mockImplementation((event: string, handler: () => void) => {
      if (event === 'closed') closeHandler = handler
    })

    const closed = startupFailureWindow.showStartupFailureWindow({
      BrowserWindow,
      message: 'Preserve the profile and contact support.',
    })
    await vi.waitFor(() => expect(window.show).toHaveBeenCalledOnce())

    expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      title: 'SAR Tracker could not start',
      show: false,
      resizable: false,
      webPreferences: expect.objectContaining({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      }),
    }))
    expect(window.loadURL).toHaveBeenCalledWith(expect.stringMatching(/^data:text\/html/u))
    let resolved = false
    void closed.then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)

    closeHandler?.()
    await expect(closed).resolves.toBeUndefined()
  })

  it('rejects when the local fault page cannot load', async () => {
    const { BrowserWindow, window } = createWindowHarness()
    const loadError = new Error('local fault page failed')
    window.loadURL.mockRejectedValue(loadError)

    await expect(startupFailureWindow.showStartupFailureWindow({
      BrowserWindow,
      message: 'Preserve the profile and contact support.',
    })).rejects.toBe(loadError)
    expect(window.destroy).toHaveBeenCalledOnce()
  })
})

/** Creates a constructable BrowserWindow mock and its one window instance. */
function createWindowHarness() {
  const window: StartupFailureWindowStub = {
    destroy: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    once: vi.fn(),
    show: vi.fn(),
  }
  const BrowserWindow = vi.fn(function MockBrowserWindow() { return window }) as unknown as new (
    options: Record<string, unknown>,
  ) => StartupFailureWindowStub
  return { BrowserWindow, window }
}
