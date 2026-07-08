import Module from 'node:module'
import path from 'node:path'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_APP_SETTINGS } from '../../src/features/settings/settings-types'

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

  it('denies unexpected navigation and renderer-opened windows [DON-236]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const createdWindow = electronMock.BrowserWindow.mock.results[0]?.value
    expect(createdWindow.webContents.on).toHaveBeenCalledWith('will-navigate', expect.any(Function))
    expect(createdWindow.webContents.setWindowOpenHandler).toHaveBeenCalledWith(expect.any(Function))

    const navigationHandler = createdWindow.webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'will-navigate',
    )?.[1]
    const navigationEvent = { preventDefault: vi.fn() }
    navigationHandler(navigationEvent, 'https://evil.example/')
    expect(navigationEvent.preventDefault).toHaveBeenCalledTimes(1)

    const openHandler = createdWindow.webContents.setWindowOpenHandler.mock.calls[0][0]
    expect(openHandler({ url: 'https://evil.example/' })).toEqual({ action: 'deny' })
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

  it('records renderer diagnostic events without throwing once the app is ready [DON-226]', async () => {
    // Regression: the record-diagnostic-event IPC handler referenced an
    // out-of-scope `runtimeLog`, so every renderer diagnostic event threw
    // `ReferenceError: runtimeLog is not defined` in the packaged main process,
    // silently breaking the DON-226 incident breadcrumbs. The handler must be
    // wired to the real runtime log and append the renderer event.
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    // Let the whenReady() bootstrap chain register IPC handlers.
    await new Promise((resolve) => setTimeout(resolve, 50))

    const recordHandlerCall = electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:record-diagnostic-event',
    )
    expect(recordHandlerCall).toBeDefined()
    const recordHandler = recordHandlerCall?.[1] as (
      event: unknown,
      input: unknown,
    ) => unknown

    const senderEvent = createPackagedSenderEvent()
    let recordResult: unknown
    expect(() => {
      recordResult = recordHandler(senderEvent, {
        level: 'info',
        event: 'basemap_changed',
        category: 'map',
        ts: '2026-06-23T10:00:00.000Z',
        fields: { basemapId: 'osm' },
      })
    }).not.toThrow()

    // The handler appends to the runtime log asynchronously; await it so the
    // file write settles before afterEach removes the shared test userData dir
    // (otherwise rmSync races the in-flight write and throws ENOTEMPTY on CI).
    await expect(Promise.resolve(recordResult)).resolves.toBeUndefined()
  })

  it('rejects IPC from arbitrary file renderers outside the packaged app index [DON-236]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const recordHandler = electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:record-diagnostic-event',
    )?.[1]

    expect(() =>
      recordHandler(
        { senderFrame: { url: 'file:///tmp/compromised-index.html' }, sender: {} },
        { event: 'test' },
      ),
    ).toThrow(/Blocked Electron IPC request/)
  })

  it('rejects Traccar proxy requests outside the configured provider origin [DON-236]', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('unexpected', { status: 200 }))
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const traccarHandler = electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:traccar-http-request',
    )?.[1]

    await expect(
      traccarHandler(createPackagedSenderEvent(), {
        url: 'https://evil.example/api/devices',
        method: 'GET',
        headers: {},
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/configured Traccar provider/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('allows configured Traccar proxy requests and rejects oversized responses [DON-236]', async () => {
    seedSettings({
      dataSource: {
        providerType: 'traccar_http',
        baseUrl: 'https://kmrtsar.eu',
        authMode: 'basic',
        email: 'sean',
      },
    })
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
      .mockResolvedValueOnce(
        new Response('too large', {
          status: 200,
          headers: { 'content-length': String(6 * 1024 * 1024) },
        }),
      )
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const traccarHandler = electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:traccar-http-request',
    )?.[1]

    await expect(
      traccarHandler(createPackagedSenderEvent(), {
        url: 'https://kmrtsar.eu/api/devices',
        method: 'GET',
        headers: {},
        timeoutMs: 1000,
      }),
    ).resolves.toMatchObject({ status: 200, body: '[]' })
    await expect(
      traccarHandler(createPackagedSenderEvent(), {
        url: 'https://kmrtsar.eu/api/positions',
        method: 'GET',
        headers: {},
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/too large/)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('invalidates the official map tile cache after saving settings [DON-240]', async () => {
    const officialMapProxy = {
      close: vi.fn(),
      fetchOfficialMapTile: vi.fn(),
      invalidateSettings: vi.fn(),
    }
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock
      }
      if (request === './official-map-proxy.cjs') {
        return { createElectronOfficialMapProxy: vi.fn(() => officialMapProxy) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const saveSettingsHandler = electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:save-app-settings',
    )?.[1]
    await saveSettingsHandler(createPackagedSenderEvent(), {
      ...DEFAULT_APP_SETTINGS,
      dataSource: {
        ...DEFAULT_APP_SETTINGS.dataSource,
        providerType: 'none',
      },
    })

    expect(officialMapProxy.invalidateSettings).toHaveBeenCalledOnce()
  })

  it('keeps renderer diagnostic fields from overriding app-owned metadata [DON-237]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const recordHandler = electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:record-diagnostic-event',
    )?.[1]
    await recordHandler(createPackagedSenderEvent(), {
      event: 'basemap_changed',
      category: 'map',
      ts: '2026-07-06T10:00:00.000Z',
      fields: {
        category: 'spoofed',
        rendererTimestamp: 'spoofed',
        token: 'secret-token',
      },
    })

    const runtimeLog = readFileSync(path.join(testUserDataPath, 'logs', 'runtime.log'), 'utf8')
    expect(runtimeLog).toContain('"category":"map"')
    expect(runtimeLog).toContain('"rendererTimestamp":"2026-07-06T10:00:00.000Z"')
    expect(runtimeLog).not.toContain('spoofed')
    expect(runtimeLog).not.toContain('secret-token')
  })

  it('flushes fatal main-process errors before relaunching and exiting [DON-236]', async () => {
    const processOn = vi
      .spyOn(process, 'on')
      .mockImplementation(() => process)
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const uncaughtHandler = processOn.mock.calls
      .filter(([eventName]) => eventName === 'uncaughtException')
      .map(([, listener]) => listener)
      .find((listener) => String(listener).includes('handleFatalMainProcessError')) as
      | ((error: Error) => Promise<void>)
      | undefined
    expect(uncaughtHandler).toEqual(expect.any(Function))

    await uncaughtHandler?.(new Error('fatal token=secret-token'))
    await new Promise((resolve) => setTimeout(resolve, 50))

    const crashLog = readFileSync(
      path.join(testUserDataPath, 'crashes', 'crash-log.json'),
      'utf8',
    )
    const runtimeLog = readFileSync(path.join(testUserDataPath, 'logs', 'runtime.log'), 'utf8')
    expect(crashLog).toContain('uncaughtException')
    expect(crashLog).not.toContain('secret-token')
    expect(runtimeLog).toContain('uncaught_exception')
    expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      'SAR Tracker runtime fault',
      expect.stringContaining('fatal runtime fault'),
    )
    expect(electronMock.app.relaunch).toHaveBeenCalledTimes(1)
    expect(electronMock.app.exit).toHaveBeenCalledWith(1)
  })

  it('flushes the clean-exit marker before quitting [DON-236]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const beforeQuitHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'before-quit',
    )?.[1]
    const event = { preventDefault: vi.fn() }
    beforeQuitHandler(event)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(
      readFileSync(path.join(testUserDataPath, 'crashes', 'last-clean-exit'), 'utf8'),
    ).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(electronMock.app.exit).toHaveBeenCalledWith(0)
  })

  it('keeps crash and runtime logging wired when macOS activate recreates a window [DON-236]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const activateHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'activate',
    )?.[1]
    await activateHandler()

    const recreatedWindow = electronMock.BrowserWindow.mock.results[1]?.value
    expect(recreatedWindow.webContents.on).toHaveBeenCalledWith(
      'render-process-gone',
      expect.any(Function),
    )
  })
})

function createPackagedSenderEvent() {
  return {
    senderFrame: { url: pathToFileURL(path.join(process.cwd(), 'dist', 'index.html')).toString() },
    sender: {},
  }
}

function seedSettings(settings: Record<string, unknown>) {
  mkdirSync(testUserDataPath, { recursive: true })
  writeFileSync(path.join(testUserDataPath, 'settings.json'), JSON.stringify(settings), 'utf8')
}

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
      webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn() },
    }
  })
  BrowserWindow.getAllWindows = vi.fn(() => existingWindows)
  BrowserWindow.getFocusedWindow = vi.fn(() => null)

  return {
    app: {
      commandLine: { appendSwitch },
      exit: vi.fn(),
      getPath: vi.fn(() => {
        mkdirSync(testUserDataPath, { recursive: true })
        return testUserDataPath
      }),
      getVersion: vi.fn(() => '0.1.0-test'),
      on: vi.fn(),
      quit: vi.fn(),
      relaunch: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => true),
      setPath: vi.fn(),
      whenReady: vi.fn(() => (ready ? Promise.resolve() : new Promise<never>(() => {}))),
    },
    BrowserWindow,
    crashReporter: { start: vi.fn() },
    dialog: { showErrorBox: vi.fn() },
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
