import Module from 'node:module'
import path from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const originalLoad = Module._load
const originalPlatform = process.platform
const testUserDataPath = path.join('/tmp', 'sartracker-electron-main-startup-test')

describe('Electron main startup', () => {
  afterEach(() => {
    Module._load = originalLoad
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    })
    vi.restoreAllMocks()
    rmSync(testUserDataPath, { force: true, recursive: true })
    delete process.env.SARTRACKER_ELECTRON_BLOCK_NETWORK
    delete require.cache[require.resolve('../../electron/main.cjs')]
  })

  it('selects GNOME libsecret before Electron safeStorage initializes on Linux', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
    })
    const appendSwitch = vi.fn()
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return createElectronMock(appendSwitch)
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')

    expect(appendSwitch).toHaveBeenCalledWith('password-store', 'gnome-libsecret')
  })

  it('installs the opt-in network block for packaged offline validation', async () => {
    process.env.SARTRACKER_ELECTRON_BLOCK_NETWORK = '1'
    const session = {
      defaultSession: {
        webRequest: {
          onBeforeRequest: vi.fn(),
        },
      },
    }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return createElectronMock(vi.fn(), session, true)
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await Promise.resolve()

    expect(session.defaultSession.webRequest.onBeforeRequest).toHaveBeenCalledWith(
      { urls: ['http://*/*', 'https://*/*'] },
      expect.any(Function),
    )
    const handler = session.defaultSession.webRequest.onBeforeRequest.mock.calls[0][1]
    const callback = vi.fn()
    handler({ url: 'https://tile.openstreetmap.org/1/1/1.png' }, callback)
    expect(callback).toHaveBeenCalledWith({ cancel: true })
  })

  it('quits immediately when another Electron instance already owns the app lock', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    electronMock.app.requestSingleInstanceLock.mockReturnValue(false)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await Promise.resolve()

    expect(electronMock.app.quit).toHaveBeenCalledTimes(1)
    expect(electronMock.app.whenReady).not.toHaveBeenCalled()
    expect(electronMock.BrowserWindow).not.toHaveBeenCalled()
  })

  it('focuses the existing window when a second launch is routed to the running instance', () => {
    const existingWindow = {
      focus: vi.fn(),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
    }
    const electronMock = createElectronMock(vi.fn(), undefined, false, [existingWindow])
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')

    const secondInstanceHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'second-instance',
    )?.[1]
    expect(secondInstanceHandler).toEqual(expect.any(Function))

    secondInstanceHandler()

    expect(existingWindow.restore).toHaveBeenCalledTimes(1)
    expect(existingWindow.focus).toHaveBeenCalledTimes(1)
  })
})

function createElectronMock(
  appendSwitch: ReturnType<typeof vi.fn>,
  session = {
    defaultSession: {
      webRequest: {
        onBeforeRequest: vi.fn(),
      },
    },
  },
  ready = false,
  existingWindows: unknown[] = [],
) {
  const BrowserWindow = vi.fn(function MockBrowserWindow() {
    return {
      loadURL: vi.fn(() => Promise.resolve()),
      webContents: { on: vi.fn() },
    }
  })
  BrowserWindow.getAllWindows = vi.fn(() => existingWindows)
  BrowserWindow.getFocusedWindow = vi.fn(() => null)

  return {
    app: {
      commandLine: { appendSwitch },
      getPath: vi.fn(() => {
        mkdirSync(testUserDataPath, { recursive: true })
        return testUserDataPath
      }),
      getVersion: vi.fn(() => '0.1.0-test'),
      on: vi.fn(),
      quit: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => true),
      setPath: vi.fn(),
      whenReady: vi.fn(() => (ready ? Promise.resolve() : new Promise<never>(() => {}))),
    },
    BrowserWindow,
    crashReporter: { start: vi.fn() },
    dialog: {},
    ipcMain: { handle: vi.fn() },
    safeStorage: {
      decryptString: vi.fn(),
      encryptString: vi.fn(),
      getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
      isEncryptionAvailable: vi.fn(() => true),
    },
    session,
    shell: {
      openExternal: vi.fn(),
      openPath: vi.fn(),
    },
  }
}
