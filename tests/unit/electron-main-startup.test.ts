import Module from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_APP_SETTINGS } from '../../src/features/settings/settings-types'

const require = createRequire(import.meta.url)
const originalLoad = Module._load
const originalPlatform = process.platform
const originalProcessListeners = {
  uncaughtException: new Set(process.listeners('uncaughtException')),
  unhandledRejection: new Set(process.listeners('unhandledRejection')),
}
const testUserDataPath = path.join(
  os.tmpdir(),
  `sartracker-electron-main-startup-test-${process.pid}-${process.env.VITEST_WORKER_ID ?? '0'}`,
)

describe('Electron main startup', () => {
  afterEach(() => {
    Module._load = originalLoad
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    })
    vi.restoreAllMocks()
    removeTestProcessListeners('uncaughtException')
    removeTestProcessListeners('unhandledRejection')
    rmSync(testUserDataPath, { force: true, recursive: true })
    delete process.env.SARTRACKER_ELECTRON_BLOCK_NETWORK
    delete process.env.ELECTRON_RENDERER_URL
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

  it('rejects oversized mission creation payloads at the direct main IPC boundary', async () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    const handler = electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:mission-store:create-mission',
    )?.[1]
    const sender = electronMock.BrowserWindow.mock.results[0]?.value.webContents
    expect(handler).toBeTypeOf('function')

    expect(() => handler({ sender, senderFrame: { url: 'http://localhost:5173/' } }, {
      name: 'Bounded direct IPC mission',
      notes: 'x'.repeat(64 * 1024 * 1024),
    })).toThrow(/notes|invalid|bound/iu)
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
    await vi.waitFor(() => {
      expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(1)
    })

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

  it('blocks an allowed renderer reload until the runtime drain is acknowledged', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    const createdWindow = electronMock.BrowserWindow.mock.results[0]?.value
    createdWindow.webContents.getURL.mockReturnValue('http://localhost:5173/')
    const navigationHandler = createdWindow.webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'will-navigate',
    )?.[1]
    const navigationEvent = { preventDefault: vi.fn() }

    navigationHandler(navigationEvent, 'http://localhost:5173/')

    expect(navigationEvent.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(createdWindow.webContents.send).toHaveBeenCalledOnce())
    expect(createdWindow.loadURL).toHaveBeenCalledOnce()
    const [, request] = createdWindow.webContents.send.mock.calls[0]
    const acknowledgementHandler = electronMock.ipcMain.on.mock.calls.find(
      ([channel]) => channel === 'sartracker:app-runtime-teardown-ready',
    )?.[1]
    acknowledgementHandler(
      { sender: createdWindow.webContents },
      { requestId: request.requestId, ok: true },
    )
    await vi.waitFor(() => expect(createdWindow.loadURL).toHaveBeenCalledTimes(2))
    expect(createdWindow.loadURL).toHaveBeenLastCalledWith('http://localhost:5173/')
  })

  it('turns an unguarded Electron reload into a drained reload', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    const createdWindow = electronMock.BrowserWindow.mock.results[0]?.value
    const unloadHandler = createdWindow.webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'will-prevent-unload',
    )?.[1]
    const firstUnloadEvent = { preventDefault: vi.fn() }

    unloadHandler(firstUnloadEvent)
    expect(firstUnloadEvent.preventDefault).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(createdWindow.webContents.send).toHaveBeenCalledOnce())
    const [, request] = createdWindow.webContents.send.mock.calls[0]
    const acknowledgementHandler = electronMock.ipcMain.on.mock.calls.find(
      ([channel]) => channel === 'sartracker:app-runtime-teardown-ready',
    )?.[1]
    acknowledgementHandler(
      { sender: createdWindow.webContents },
      { requestId: request.requestId, ok: true },
    )
    await vi.waitFor(() => expect(createdWindow.webContents.reload).toHaveBeenCalledOnce())

    const permittedUnloadEvent = { preventDefault: vi.fn() }
    unloadHandler(permittedUnloadEvent)
    expect(permittedUnloadEvent.preventDefault).toHaveBeenCalledOnce()
  })

  it('revokes an unload grant when an allowed navigation replacement fails', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const sessionManager = archiveReviewSessionManagerStub()
    const rendererTeardownCoordinator = rendererTeardownCoordinatorStub()
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './archive-review-sessions.cjs') {
        return { createArchiveReviewSessionManager: vi.fn(() => sessionManager) }
      }
      if (request === './archive-review-ipc.cjs') {
        return { registerArchiveReviewIpcHandlers: vi.fn() }
      }
      if (request === './renderer-teardown-coordinator.cjs') {
        return { createRendererTeardownCoordinator: vi.fn(() => rendererTeardownCoordinator) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    const createdWindow = electronMock.BrowserWindow.mock.results[0]?.value
    createdWindow.webContents.getURL.mockReturnValue('http://localhost:5173/')
    createdWindow.loadURL.mockRejectedValueOnce(new Error('replacement load failed'))
    const navigationHandler = createdWindow.webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'will-navigate',
    )?.[1]
    navigationHandler({ preventDefault: vi.fn() }, 'http://localhost:5173/')
    await vi.waitFor(() => expect(electronMock.dialog.showErrorBox).toHaveBeenCalled())

    const unloadHandler = createdWindow.webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'will-prevent-unload',
    )?.[1]
    const laterUnload = { preventDefault: vi.fn() }
    unloadHandler(laterUnload)

    expect(laterUnload.preventDefault).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(sessionManager.closeForSender).toHaveBeenCalledTimes(2))
  })

  it('revokes an unload grant when the drained Electron reload call throws', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const sessionManager = archiveReviewSessionManagerStub()
    const rendererTeardownCoordinator = rendererTeardownCoordinatorStub()
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './archive-review-sessions.cjs') {
        return { createArchiveReviewSessionManager: vi.fn(() => sessionManager) }
      }
      if (request === './archive-review-ipc.cjs') {
        return { registerArchiveReviewIpcHandlers: vi.fn() }
      }
      if (request === './renderer-teardown-coordinator.cjs') {
        return { createRendererTeardownCoordinator: vi.fn(() => rendererTeardownCoordinator) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    const createdWindow = electronMock.BrowserWindow.mock.results[0]?.value
    createdWindow.webContents.reload.mockImplementationOnce(() => {
      throw new Error('reload failed')
    })
    const unloadHandler = createdWindow.webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'will-prevent-unload',
    )?.[1]
    unloadHandler({ preventDefault: vi.fn() })
    await vi.waitFor(() => expect(electronMock.dialog.showErrorBox).toHaveBeenCalled())

    const laterUnload = { preventDefault: vi.fn() }
    unloadHandler(laterUnload)

    expect(laterUnload.preventDefault).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(sessionManager.closeForSender).toHaveBeenCalledTimes(2))
  })

  it('closes sender-owned archive review plaintext before allowed navigation replacement [DON-253]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    let releaseArchiveCleanup: (() => void) | undefined
    const archiveCleanup = new Promise<void>((resolve) => {
      releaseArchiveCleanup = resolve
    })
    const sessionManager = {
      ...archiveReviewSessionManagerStub(),
      closeForSender: vi.fn(() => archiveCleanup),
    }
    const rendererTeardownCoordinator = {
      prepare: vi.fn(async () => undefined),
      markRendererUnavailable: vi.fn(async () => undefined),
      markRendererAvailable: vi.fn(async () => undefined),
      ensureUnexpectedRendererLossFenced: vi.fn(async () => undefined),
      dispose: vi.fn(),
    }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './archive-review-sessions.cjs') {
        return { createArchiveReviewSessionManager: vi.fn(() => sessionManager) }
      }
      if (request === './archive-review-ipc.cjs') {
        return { registerArchiveReviewIpcHandlers: vi.fn() }
      }
      if (request === './renderer-teardown-coordinator.cjs') {
        return { createRendererTeardownCoordinator: vi.fn(() => rendererTeardownCoordinator) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    const createdWindow = electronMock.BrowserWindow.mock.results[0]?.value
    createdWindow.webContents.getURL.mockReturnValue('http://localhost:5173/')
    const navigationHandler = createdWindow.webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'will-navigate',
    )?.[1]
    const navigationEvent = { preventDefault: vi.fn() }

    navigationHandler(navigationEvent, 'http://localhost:5173/')

    expect(navigationEvent.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(sessionManager.closeForSender).toHaveBeenCalledWith(1))
    expect(createdWindow.loadURL).toHaveBeenCalledOnce()
    expect(rendererTeardownCoordinator.markRendererAvailable).toHaveBeenCalledOnce()

    releaseArchiveCleanup?.()
    await vi.waitFor(() => expect(createdWindow.loadURL).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => {
      expect(rendererTeardownCoordinator.markRendererAvailable).toHaveBeenCalledTimes(2)
    })
  })

  it('blocks and reports a renderer reload when sender archive cleanup fails [DON-253]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const sessionManager = {
      ...archiveReviewSessionManagerStub(),
      closeForSender: vi.fn().mockRejectedValue(Object.assign(
        new Error('archive cleanup failed'),
        { code: 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED' },
      )),
    }
    const rendererTeardownCoordinator = {
      prepare: vi.fn(async () => undefined),
      markRendererUnavailable: vi.fn(async () => undefined),
      markRendererAvailable: vi.fn(async () => undefined),
      ensureUnexpectedRendererLossFenced: vi.fn(async () => undefined),
      dispose: vi.fn(),
    }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './archive-review-sessions.cjs') {
        return { createArchiveReviewSessionManager: vi.fn(() => sessionManager) }
      }
      if (request === './archive-review-ipc.cjs') {
        return { registerArchiveReviewIpcHandlers: vi.fn() }
      }
      if (request === './renderer-teardown-coordinator.cjs') {
        return { createRendererTeardownCoordinator: vi.fn(() => rendererTeardownCoordinator) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    const createdWindow = electronMock.BrowserWindow.mock.results[0]?.value
    const unloadHandler = createdWindow.webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'will-prevent-unload',
    )?.[1]

    unloadHandler({ preventDefault: vi.fn() })

    await vi.waitFor(() => expect(sessionManager.closeForSender).toHaveBeenCalledWith(1))
    await vi.waitFor(() => {
      expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
        'SAR Tracker could not close safely',
        expect.stringMatching(/decrypted archive-review working copy.*may remain/iu),
      )
    })
    expect(createdWindow.webContents.reload).not.toHaveBeenCalled()
    expect(rendererTeardownCoordinator.markRendererAvailable).toHaveBeenCalledOnce()
  })

  it('keeps a renderer-crash replacement unavailable until sender archive cleanup completes [DON-253]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    let releaseArchiveCleanup: (() => void) | undefined
    const archiveCleanup = new Promise<void>((resolve) => {
      releaseArchiveCleanup = resolve
    })
    const sessionManager = {
      ...archiveReviewSessionManagerStub(),
      closeForSender: vi.fn(() => archiveCleanup),
    }
    const rendererTeardownCoordinator = {
      prepare: vi.fn(async () => undefined),
      markRendererUnavailable: vi.fn(async () => undefined),
      markRendererAvailable: vi.fn(async () => undefined),
      ensureUnexpectedRendererLossFenced: vi.fn(async () => undefined),
      dispose: vi.fn(),
    }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './archive-review-sessions.cjs') {
        return { createArchiveReviewSessionManager: vi.fn(() => sessionManager) }
      }
      if (request === './archive-review-ipc.cjs') {
        return { registerArchiveReviewIpcHandlers: vi.fn() }
      }
      if (request === './renderer-teardown-coordinator.cjs') {
        return { createRendererTeardownCoordinator: vi.fn(() => rendererTeardownCoordinator) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    const createdWindow = electronMock.BrowserWindow.mock.results[0]?.value
    const rendererGoneHandler = createdWindow.webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'render-process-gone',
    )?.[1]

    rendererGoneHandler({}, { reason: 'oom', exitCode: 137 })
    await vi.waitFor(() => expect(sessionManager.closeForSender).toHaveBeenCalledWith(1))
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    const activateHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'activate',
    )?.[1]
    const activation = Promise.resolve(activateHandler())
    await Promise.resolve()

    expect(electronMock.BrowserWindow).toHaveBeenCalledOnce()
    expect(rendererTeardownCoordinator.markRendererAvailable).toHaveBeenCalledOnce()

    releaseArchiveCleanup?.()
    await activation
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(2))
    expect(rendererTeardownCoordinator.markRendererAvailable).toHaveBeenCalledTimes(2)
  })

  it('destroys a crashed WebContents before its same-window reload can outrun archive cleanup [DON-253]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    let releaseArchiveCleanup: (() => void) | undefined
    const archiveCleanup = new Promise<void>((resolve) => {
      releaseArchiveCleanup = resolve
    })
    const sessionManager = {
      ...archiveReviewSessionManagerStub(),
      closeForSender: vi.fn(() => archiveCleanup),
    }
    const rendererTeardownCoordinator = rendererTeardownCoordinatorStub()
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './archive-review-sessions.cjs') {
        return { createArchiveReviewSessionManager: vi.fn(() => sessionManager) }
      }
      if (request === './archive-review-ipc.cjs') {
        return { registerArchiveReviewIpcHandlers: vi.fn() }
      }
      if (request === './renderer-teardown-coordinator.cjs') {
        return { createRendererTeardownCoordinator: vi.fn(() => rendererTeardownCoordinator) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    const createdWindow = electronMock.BrowserWindow.mock.results[0]?.value
    const rendererGoneHandler = createdWindow.webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'render-process-gone',
    )?.[1]

    rendererGoneHandler({}, { reason: 'oom', exitCode: 137 })

    expect(createdWindow.destroy).toHaveBeenCalledOnce()
    expect(createdWindow.loadURL).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(sessionManager.closeForSender).toHaveBeenCalledWith(1))
    expect(createdWindow.webContents.reload).not.toHaveBeenCalled()
    releaseArchiveCleanup?.()
  })

  it('retries transient archive cleanup after renderer crash before opening a replacement [DON-253]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const cleanupFailure = Object.assign(new Error('archive cleanup audit unavailable'), {
      code: 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED',
    })
    const sessionManager = {
      ...archiveReviewSessionManagerStub(),
      closeForSender: vi.fn()
        .mockRejectedValueOnce(cleanupFailure)
        .mockResolvedValueOnce(undefined),
    }
    const rendererTeardownCoordinator = {
      prepare: vi.fn(async () => undefined),
      markRendererUnavailable: vi.fn(async () => undefined),
      markRendererAvailable: vi.fn(async () => undefined),
      ensureUnexpectedRendererLossFenced: vi.fn(async () => undefined),
      dispose: vi.fn(),
    }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './archive-review-sessions.cjs') {
        return { createArchiveReviewSessionManager: vi.fn(() => sessionManager) }
      }
      if (request === './archive-review-ipc.cjs') {
        return { registerArchiveReviewIpcHandlers: vi.fn() }
      }
      if (request === './renderer-teardown-coordinator.cjs') {
        return { createRendererTeardownCoordinator: vi.fn(() => rendererTeardownCoordinator) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    const createdWindow = electronMock.BrowserWindow.mock.results[0]?.value
    const rendererGoneHandler = createdWindow.webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'render-process-gone',
    )?.[1]
    rendererGoneHandler({}, { reason: 'oom', exitCode: 137 })
    await vi.waitFor(() => expect(sessionManager.closeForSender).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(electronMock.dialog.showErrorBox).toHaveBeenCalled())

    electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    const activateHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'activate',
    )?.[1]
    await activateHandler()

    expect(sessionManager.closeForSender).toHaveBeenCalledTimes(2)
    expect(sessionManager.closeForSender).toHaveBeenNthCalledWith(2, 1)
    expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(2)
    expect(rendererTeardownCoordinator.markRendererAvailable).toHaveBeenCalledTimes(2)
  })

  it('keeps the window open until the renderer drain is acknowledged without racing a reload', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    const createdWindow = electronMock.BrowserWindow.mock.results[0]?.value
    const closeHandler = createdWindow.on.mock.calls.find(
      ([eventName]) => eventName === 'close',
    )?.[1]
    const closeEvent = { preventDefault: vi.fn() }

    closeHandler(closeEvent)
    expect(closeEvent.preventDefault).toHaveBeenCalledOnce()
    expect(createdWindow.close).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(createdWindow.webContents.send).toHaveBeenCalledOnce())
    const unloadHandler = createdWindow.webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'will-prevent-unload',
    )?.[1]
    const blockedUnloadEvent = { preventDefault: vi.fn() }
    unloadHandler(blockedUnloadEvent)
    expect(blockedUnloadEvent.preventDefault).not.toHaveBeenCalled()
    expect(createdWindow.webContents.reload).not.toHaveBeenCalled()
    const [, request] = createdWindow.webContents.send.mock.calls[0]
    const acknowledgementHandler = electronMock.ipcMain.on.mock.calls.find(
      ([channel]) => channel === 'sartracker:app-runtime-teardown-ready',
    )?.[1]
    acknowledgementHandler(
      { sender: createdWindow.webContents },
      { requestId: request.requestId, ok: true },
    )

    await vi.waitFor(() => expect(createdWindow.close).toHaveBeenCalledOnce())
    expect(createdWindow.webContents.reload).not.toHaveBeenCalled()
    const permittedCloseEvent = { preventDefault: vi.fn() }
    closeHandler(permittedCloseEvent)
    expect(permittedCloseEvent.preventDefault).not.toHaveBeenCalled()
    const permittedUnloadEvent = { preventDefault: vi.fn() }
    unloadHandler(permittedUnloadEvent)
    expect(permittedUnloadEvent.preventDefault).toHaveBeenCalledOnce()
  })

  it('registers sender-owned Mission Review read and cancellation channels [DON-251]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())

    const channels = electronMock.ipcMain.handle.mock.calls.map(([channel]) => channel)
    expect(channels).toContain('sartracker:mission-store:read-mission-review')
    expect(channels).toContain('sartracker:mission-store:cancel-mission-review-read')
  })

  it('sweeps archive-review plaintext before opening the renderer and registers only explicit review channels [DON-252]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    let releaseStartupSweep: (() => void) | undefined
    const startupSweep = new Promise<void>((resolve) => {
      releaseStartupSweep = resolve
    })
    const sessionManager = {
      ...archiveReviewSessionManagerStub(),
      sweepStartup: vi.fn(() => startupSweep),
    }
    const createArchiveReviewSessionManager = vi.fn(() => sessionManager)
    const registerArchiveReviewIpcHandlers = vi.fn()
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './archive-review-sessions.cjs') {
        return { createArchiveReviewSessionManager }
      }
      if (request === './archive-review-ipc.cjs') {
        return { registerArchiveReviewIpcHandlers }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')

    await vi.waitFor(() => expect(createArchiveReviewSessionManager).toHaveBeenCalledOnce())
    expect(sessionManager.sweepStartup).toHaveBeenCalledOnce()
    expect(electronMock.BrowserWindow).not.toHaveBeenCalled()

    const managerOptions = createArchiveReviewSessionManager.mock.calls[0][0]
    expect(managerOptions).toMatchObject({
      archiveDirectory: path.join(testUserDataPath, 'archives'),
      reviewRoot: path.join(testUserDataPath, 'archive-review'),
      registry: {
        issueReviewTicket: expect.any(Function),
        recordReviewOpened: expect.any(Function),
        recordReviewClosed: expect.any(Function),
        recordReviewMutationDenied: expect.any(Function),
      },
      openRestoredAttachment: expect.any(Function),
    })

    releaseStartupSweep?.()
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    expect(registerArchiveReviewIpcHandlers).toHaveBeenCalledWith({
      ipcMain: electronMock.ipcMain,
      channels: {
        open: 'sartracker:archive-review:open',
        close: 'sartracker:archive-review:close',
        cancel: 'sartracker:archive-review:cancel',
        read: 'sartracker:archive-review:read',
        mutationDenied: 'sartracker:archive-review:mutation-denied',
      },
      sessionManager,
      validateIpcSender: expect.any(Function),
    })
  })

  it('joins and sweeps archive-review sessions before a clean app exit [DON-252]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    let releaseReviewClose: (() => void) | undefined
    const reviewClose = new Promise<void>((resolve) => {
      releaseReviewClose = resolve
    })
    const sessionManager = {
      ...archiveReviewSessionManagerStub(),
      prepareClose: vi.fn(() => reviewClose),
    }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './archive-review-sessions.cjs') {
        return { createArchiveReviewSessionManager: vi.fn(() => sessionManager) }
      }
      if (request === './archive-review-ipc.cjs') {
        return { registerArchiveReviewIpcHandlers: vi.fn() }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => {
      expect(electronMock.app.on).toHaveBeenCalledWith('before-quit', expect.any(Function))
    })
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    const beforeQuitHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'before-quit',
    )?.[1]

    beforeQuitHandler({ preventDefault: vi.fn() })

    await vi.waitFor(() => expect(sessionManager.prepareClose).toHaveBeenCalledOnce())
    expect(electronMock.app.exit).not.toHaveBeenCalled()
    releaseReviewClose?.()
    await vi.waitFor(() => expect(electronMock.app.exit).toHaveBeenCalledWith(0))
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
    let recordHandlerCall: (typeof electronMock.ipcMain.handle.mock.calls)[number] | undefined
    await vi.waitFor(() => {
      recordHandlerCall = electronMock.ipcMain.handle.mock.calls.find(
        ([channel]) => channel === 'sartracker:record-diagnostic-event',
      )
      expect(recordHandlerCall).toBeDefined()
    })
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
    await vi.waitFor(() => expect(electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:record-diagnostic-event',
    )?.[1]).toEqual(expect.any(Function)))

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
    await vi.waitFor(() => expect(electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:traccar-http-request',
    )?.[1]).toEqual(expect.any(Function)))

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
    await vi.waitFor(() => expect(electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:traccar-http-request',
    )?.[1]).toEqual(expect.any(Function)))

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
    await vi.waitFor(() => expect(electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:save-app-settings',
    )?.[1]).toEqual(expect.any(Function)))

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
    await vi.waitFor(() => expect(electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:record-diagnostic-event',
    )?.[1]).toEqual(expect.any(Function)))

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
    let releaseEvidenceFence: (() => void) | undefined
    const markRendererUnavailable = vi.fn(() => new Promise<void>((resolve) => {
      releaseEvidenceFence = resolve
    }))
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock
      }
      if (request === './renderer-teardown-coordinator.cjs') {
        return {
          createRendererTeardownCoordinator: () => ({
            prepare: vi.fn(),
            markRendererUnavailable,
            markRendererAvailable: vi.fn(),
            dispose: vi.fn(),
          }),
        }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(processOn.mock.calls
      .filter(([eventName]) => eventName === 'uncaughtException')
      .map(([, listener]) => listener)
      .find((listener) => String(listener).includes('handleFatalMainProcessError')),
    ).toEqual(expect.any(Function)))

    const uncaughtHandler = processOn.mock.calls
      .filter(([eventName]) => eventName === 'uncaughtException')
      .map(([, listener]) => listener)
      .find((listener) => String(listener).includes('handleFatalMainProcessError')) as
      | ((error: Error) => Promise<void>)
      | undefined
    expect(uncaughtHandler).toEqual(expect.any(Function))

    void uncaughtHandler?.(new Error('fatal token=secret-token'))
    await vi.waitFor(() => {
      expect(
        readFileSync(path.join(testUserDataPath, 'logs', 'runtime.log'), 'utf8'),
      ).toContain('uncaught_exception')
      expect(markRendererUnavailable).toHaveBeenCalledOnce()
    })
    expect(electronMock.app.relaunch).not.toHaveBeenCalled()
    expect(electronMock.app.exit).not.toHaveBeenCalled()
    releaseEvidenceFence?.()
    await vi.waitFor(() => expect(electronMock.app.exit).toHaveBeenCalledWith(1))

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

  it('does not relaunch a fatal runtime when the durable evidence fence fails', async () => {
    const processOn = vi.spyOn(process, 'on').mockImplementation(() => process)
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const markRendererUnavailable = vi.fn().mockRejectedValue(
      new Error('mission store unavailable'),
    )
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './renderer-teardown-coordinator.cjs') {
        return {
          createRendererTeardownCoordinator: () => ({
            prepare: vi.fn(),
            markRendererUnavailable,
            markRendererAvailable: vi.fn(),
            dispose: vi.fn(),
          }),
        }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    let uncaughtHandler: ((error: Error) => void) | undefined
    await vi.waitFor(() => {
      uncaughtHandler = processOn.mock.calls
        .filter(([eventName]) => eventName === 'uncaughtException')
        .map(([, listener]) => listener)
        .find((listener) => String(listener).includes('handleFatalMainProcessError')) as
      | ((error: Error) => void)
      | undefined
      expect(uncaughtHandler).toBeDefined()
    })

    uncaughtHandler?.(new Error('fatal persistence fault'))

    await vi.waitFor(() => {
      expect(markRendererUnavailable).toHaveBeenCalledOnce()
      expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
        'SAR Tracker could not restart safely',
        expect.stringContaining('kept the current process open'),
      )
    })
    expect(electronMock.app.relaunch).not.toHaveBeenCalled()
    expect(electronMock.app.exit).not.toHaveBeenCalled()
  })

  it('fences every unfinalized mission before opening after an unclean shutdown', async () => {
    mkdirSync(path.join(testUserDataPath, 'crashes'), { recursive: true })
    writeFileSync(
      path.join(testUserDataPath, 'crashes', 'crash-log.json'),
      JSON.stringify([{
        ts: '2026-08-26T14:00:00.000Z',
        kind: 'uncaughtException',
        summary: 'previous fatal runtime',
      }]),
      'utf8',
    )
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    let releaseEvidenceFence: (() => void) | undefined
    const markRendererUnavailable = vi.fn(() => new Promise<void>((resolve) => {
      releaseEvidenceFence = resolve
    }))
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './renderer-teardown-coordinator.cjs') {
        return {
          createRendererTeardownCoordinator: () => ({
            prepare: vi.fn(),
            markRendererUnavailable,
            markRendererAvailable: vi.fn(),
            dispose: vi.fn(),
          }),
        }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')

    await vi.waitFor(() => expect(markRendererUnavailable).toHaveBeenCalledOnce())
    expect(electronMock.BrowserWindow).not.toHaveBeenCalled()
    releaseEvidenceFence?.()
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
  })

  it('turns an unclean restart into a durable mission completeness blocker', async () => {
    const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
      readonly createElectronMissionStore: (input: { readonly userDataPath: string }) => {
        readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
        readonly close: () => void
      }
    }
    mkdirSync(testUserDataPath, { recursive: true })
    const seedStore = createElectronMissionStore({ userDataPath: testUserDataPath })
    const mission = await seedStore.createMission({ name: 'Unclean restart evidence' })
    seedStore.close()
    const { createCrashLog } = require('../../electron/crash-log.cjs') as {
      readonly createCrashLog: (input: { readonly userDataPath: string }) => {
        readonly markSessionStart: () => Promise<void>
      }
    }
    await createCrashLog({ userDataPath: testUserDataPath }).markSessionStart()
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    const healthHandler = electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:mission-store:get-ingest-evidence-health',
    )?.[1]

    await expect(healthHandler(createPackagedSenderEvent(), mission.id)).resolves.toMatchObject({
      state: 'critical',
      reason: 'renderer_pending_evidence_lost',
    })
  })

  it('reserves interrupted cleanup before review IPC without waiting for row batches', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const order: string[] = []
    const sessionManager = {
      ...archiveReviewSessionManagerStub(),
      sweepStartup: vi.fn(async () => { order.push('plaintext-sweep') }),
    }
    const cleanupCompletion = new Promise<void>(() => undefined)
    const startInterruptedMissionCleanupRecovery = vi.fn(async () => {
      order.push('cleanup-recovery-started')
      return { started: true, count: 1, completion: cleanupCompletion }
    })
    const registerArchiveReviewIpcHandlers = vi.fn(() => {
      order.push('review-ipc-registered')
    })
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './archive-review-sessions.cjs') {
        return { createArchiveReviewSessionManager: vi.fn(() => sessionManager) }
      }
      if (request === './archive-cleanup-startup.cjs') {
        return { startInterruptedMissionCleanupRecovery }
      }
      if (request === './archive-review-ipc.cjs') return { registerArchiveReviewIpcHandlers }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())

    expect(startInterruptedMissionCleanupRecovery).toHaveBeenCalledWith(expect.objectContaining({
      missionStore: expect.any(Object),
      sessionManager,
      onFailure: expect.any(Function),
    }))
    expect(order).toEqual([
      'plaintext-sweep',
      'cleanup-recovery-started',
      'review-ipc-registered',
    ])
  })

  it('refuses an incompatible mission-store schema without entering a relaunch loop [DON-260]', async () => {
    const startupError = new Error(
      'Cannot open mission store created by newer mission store schema 6; this build supports schema 5.',
    )
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock
      }
      if (request === './mission-store.cjs') {
        return {
          createElectronMissionStore: vi.fn(() => {
            throw startupError
          }),
        }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')

    await vi.waitFor(() => {
      expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
        'SAR Tracker could not start',
        expect.stringContaining(startupError.message),
      )
      expect(electronMock.app.exit).toHaveBeenCalledWith(1)
    })

    expect(electronMock.app.relaunch).not.toHaveBeenCalled()
    const crashLog = readFileSync(
      path.join(testUserDataPath, 'crashes', 'crash-log.json'),
      'utf8',
    )
    const runtimeLog = readFileSync(path.join(testUserDataPath, 'logs', 'runtime.log'), 'utf8')
    expect(crashLog).toContain('"kind": "startupFailure"')
    expect(crashLog).toContain(startupError.message)
    expect(runtimeLog).toContain('"event":"startup_failure"')
    expect(runtimeLog).not.toContain('unhandled_rejection')
  })

  it('keeps arbitrary startup-failure detail out of the operator dialog [DON-260]', async () => {
    const startupError = new Error(
      'Could not open /home/fieldoperator/mission-store.sqlite token=private-startup-token',
    )
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock
      }
      if (request === './mission-store.cjs') {
        return {
          createElectronMissionStore: vi.fn(() => {
            throw startupError
          }),
        }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')

    await vi.waitFor(() => {
      expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
        'SAR Tracker could not start',
        'SAR Tracker could not open its operational data safely. The fault was recorded and the application will now close. Preserve the profile and contact support before retrying.',
      )
      expect(electronMock.app.exit).toHaveBeenCalledWith(1)
    })

    expect(electronMock.app.relaunch).not.toHaveBeenCalled()
    const crashLog = readFileSync(
      path.join(testUserDataPath, 'crashes', 'crash-log.json'),
      'utf8',
    )
    expect(crashLog).not.toContain('fieldoperator')
    expect(crashLog).not.toContain('private-startup-token')
    expect(crashLog).toContain('[redacted]')
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
    await vi.waitFor(() => {
      expect(electronMock.app.on).toHaveBeenCalledWith('before-quit', expect.any(Function))
    })

    const beforeQuitHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'before-quit',
    )?.[1]
    const event = { preventDefault: vi.fn() }
    const createdWindow = electronMock.BrowserWindow.mock.results[0]?.value
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([createdWindow])
    beforeQuitHandler(event)
    await vi.waitFor(() => expect(createdWindow.webContents.send).toHaveBeenCalledOnce())
    expect(electronMock.app.exit).not.toHaveBeenCalled()
    const [, request] = createdWindow.webContents.send.mock.calls[0]
    const acknowledgementHandler = electronMock.ipcMain.on.mock.calls.find(
      ([channel]) => channel === 'sartracker:app-runtime-teardown-ready',
    )?.[1]
    acknowledgementHandler(
      { sender: createdWindow.webContents },
      { requestId: request.requestId, ok: true },
    )
    await vi.waitFor(() => {
      expect(electronMock.app.exit).toHaveBeenCalledWith(0)
    })

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(
      readFileSync(path.join(testUserDataPath, 'crashes', 'last-clean-exit'), 'utf8'),
    ).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('does not mark a renderer-crash session clean until its evidence fence is durable [DON-276]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    let releaseEvidenceFence: (() => void) | undefined
    const evidenceFence = new Promise<void>((resolve) => {
      releaseEvidenceFence = resolve
    })
    const markRendererUnavailable = vi.fn(() => evidenceFence)
    const ensureUnexpectedRendererLossFenced = vi.fn(() => evidenceFence)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './renderer-teardown-coordinator.cjs') {
        return {
          createRendererTeardownCoordinator: () => ({
            prepare: vi.fn(),
            markRendererUnavailable,
            markRendererAvailable: vi.fn(),
            ensureUnexpectedRendererLossFenced,
            dispose: vi.fn(),
          }),
        }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => {
      expect(electronMock.app.on).toHaveBeenCalledWith('before-quit', expect.any(Function))
    })
    const createdWindow = electronMock.BrowserWindow.mock.results[0]?.value
    const rendererGoneHandler = createdWindow.webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'render-process-gone',
    )?.[1]
    rendererGoneHandler({}, { reason: 'oom', exitCode: 137 })
    await vi.waitFor(() => expect(markRendererUnavailable).toHaveBeenCalledOnce())

    electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    const beforeQuitHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'before-quit',
    )?.[1]
    beforeQuitHandler({ preventDefault: vi.fn() })

    await vi.waitFor(() => expect(ensureUnexpectedRendererLossFenced).toHaveBeenCalledOnce())
    expect(electronMock.app.exit).not.toHaveBeenCalledWith(0)
    releaseEvidenceFence?.()
    await vi.waitFor(() => expect(electronMock.app.exit).toHaveBeenCalledWith(0))
  })

  it('refuses app quit when neither renderer drain nor durable fallback succeeds', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const prepare = vi.fn(async () => {
      throw new Error('database unavailable')
    })
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './renderer-teardown-coordinator.cjs') {
        return {
          createRendererTeardownCoordinator: () => ({
            prepare,
            markRendererUnavailable: vi.fn(),
            markRendererAvailable: vi.fn(),
            ensureUnexpectedRendererLossFenced: vi.fn(),
            dispose: vi.fn(),
          }),
        }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => {
      expect(electronMock.app.on).toHaveBeenCalledWith('before-quit', expect.any(Function))
    })
    const createdWindow = electronMock.BrowserWindow.mock.results[0]?.value
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([createdWindow])
    const beforeQuitHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'before-quit',
    )?.[1]
    beforeQuitHandler({ preventDefault: vi.fn() })

    await vi.waitFor(() => {
      expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
        'SAR Tracker could not close safely',
        expect.stringContaining('kept the current process open'),
      )
    })
    expect(electronMock.app.exit).not.toHaveBeenCalled()
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
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())

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

  it('refuses macOS renderer recreation when the prior crash fence still cannot become durable [DON-276]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    const ensureUnexpectedRendererLossFenced = vi.fn().mockRejectedValue(
      new Error('marker storage unavailable'),
    )
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './renderer-teardown-coordinator.cjs') {
        return {
          createRendererTeardownCoordinator: () => ({
            prepare: vi.fn(),
            markRendererUnavailable: vi.fn(),
            markRendererAvailable: vi.fn(),
            ensureUnexpectedRendererLossFenced,
            dispose: vi.fn(),
          }),
        }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    const activateHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'activate',
    )?.[1]

    await expect(activateHandler()).resolves.toBeUndefined()
    expect(electronMock.BrowserWindow).toHaveBeenCalledOnce()
    expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      'SAR Tracker could not restore safely',
      expect.stringContaining('kept the replacement window closed'),
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

function removeTestProcessListeners(
  eventName: 'uncaughtException' | 'unhandledRejection',
): void {
  for (const listener of process.listeners(eventName)) {
    if (!originalProcessListeners[eventName].has(listener)) {
      process.removeListener(eventName, listener)
    }
  }
}

/** Provides the closed archive-review manager shape used by main lifecycle tests. */
function archiveReviewSessionManagerStub() {
  return {
    acquireCleanupLease: vi.fn(() => ({ missionId: 'mission-1', release: vi.fn() })),
    cancel: vi.fn(),
    close: vi.fn(),
    closeForSender: vi.fn(async () => undefined),
    open: vi.fn(),
    hasReviewActivity: vi.fn(() => false),
    prepareClose: vi.fn(),
    read: vi.fn(),
    sweepStartup: vi.fn(async () => undefined),
  }
}

/** Provides an immediately acknowledged renderer-teardown coordinator. */
function rendererTeardownCoordinatorStub() {
  return {
    prepare: vi.fn(async () => undefined),
    markRendererUnavailable: vi.fn(async () => undefined),
    markRendererAvailable: vi.fn(async () => undefined),
    ensureUnexpectedRendererLossFenced: vi.fn(async () => undefined),
    dispose: vi.fn(),
  }
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
      close: vi.fn(),
      destroy: vi.fn(),
      loadURL: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      webContents: {
        getURL: vi.fn(() => ''),
        id: 1,
        isDestroyed: vi.fn(() => false),
        on: vi.fn(),
        once: vi.fn(),
        reload: vi.fn(),
        send: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
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
    ipcMain: { handle: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
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
