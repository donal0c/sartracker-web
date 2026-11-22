import Module from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_APP_SETTINGS } from '../../src/features/settings/settings-types'

const require = createRequire(import.meta.url)
const originalLoad = Module._load
const originalPlatform = process.platform
const originalProcessListeners = {
  uncaughtException: new Set(process.listeners('uncaughtException')),
  unhandledRejection: new Set(process.listeners('unhandledRejection')),
}
let testUserDataPathSequence = 0
let testUserDataPath = createTestUserDataPath()
let startupProcessExit: ReturnType<typeof vi.spyOn>
let originalElectronVersion: PropertyDescriptor | undefined

describe('Electron main startup', () => {
  beforeEach(() => {
    originalElectronVersion = Object.getOwnPropertyDescriptor(process.versions, 'electron')
    startupProcessExit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })

  afterEach(() => {
    Module._load = originalLoad
    if (originalElectronVersion === undefined) {
      Reflect.deleteProperty(process.versions, 'electron')
    } else {
      Object.defineProperty(process.versions, 'electron', originalElectronVersion)
    }
    vi.useRealTimers()
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    })
    vi.restoreAllMocks()
    removeTestProcessListeners('uncaughtException')
    removeTestProcessListeners('unhandledRejection')
    rmSync(testUserDataPath, { force: true, recursive: true })
    testUserDataPath = createTestUserDataPath()
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

  it('applies the remembered software-rendering choice before Electron is ready [DON-288]', () => {
    mkdirSync(testUserDataPath, { recursive: true })
    writeFileSync(
      path.join(testUserDataPath, 'gpu-rendering-preference.json'),
      JSON.stringify({ version: 1, softwareRendering: true, chosenAt: '2026-10-01T12:00:00.000Z' }),
    )
    const appendSwitch = vi.fn()
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return createElectronMock(appendSwitch)
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')

    expect(appendSwitch).toHaveBeenCalledWith('ignore-gpu-blocklist')
  })

  it('leaves the GPU blocklist in force when software rendering was never chosen [DON-288]', () => {
    const appendSwitch = vi.fn()
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return createElectronMock(appendSwitch)
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')

    expect(appendSwitch).not.toHaveBeenCalledWith('ignore-gpu-blocklist')
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
    await vi.waitFor(() => expect(
      session.defaultSession.webRequest.onBeforeRequest,
    ).toHaveBeenCalled())

    expect(session.defaultSession.webRequest.onBeforeRequest).toHaveBeenCalledWith(
      { urls: ['http://*/*', 'https://*/*'] },
      expect.any(Function),
    )
    const handler = session.defaultSession.webRequest.onBeforeRequest.mock.calls[0][1]
    const callback = vi.fn()
    handler({ url: 'https://tile.openstreetmap.org/1/1/1.png' }, callback)
    expect(callback).toHaveBeenCalledWith({ cancel: true })
  })

  it('injects a cwd-bound Electron utility-process factory into the mission store', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const utility = { pid: 42 }
    electronMock.utilityProcess.fork.mockReturnValue(utility)
    let missionStoreInput: Record<string, unknown> | undefined
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './mission-store.cjs') {
        return {
          createElectronMissionStore: vi.fn((input: Record<string, unknown>) => {
            missionStoreInput = input
            throw new Error('stop after archive correction utility injection')
          }),
        }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(missionStoreInput).toBeDefined())
    const createUtilityProcess = missionStoreInput?.createArchiveCorrectionUtilityProcess as
      ((input: Readonly<Record<string, string>>) => unknown)

    expect(createUtilityProcess({
      modulePath: '/app/electron/archive-correction-worker.cjs',
      cwd: '/profile/database',
      serviceName: 'SAR Tracker archive correction',
    })).toBe(utility)
    expect(electronMock.utilityProcess.fork).toHaveBeenCalledWith(
      '/app/electron/archive-correction-worker.cjs',
      [],
      {
        cwd: '/profile/database',
        serviceName: 'SAR Tracker archive correction',
        stdio: 'ignore',
        allowLoadingUnsignedLibraries: false,
      },
    )
  })

  it('keeps operational window timers active when minimized', async () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load
    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    expect(electronMock.BrowserWindow.mock.calls[0]?.[0].webPreferences.backgroundThrottling).toBe(false)
  })

  it.each([
    { previous: 'a clean quit', activeSession: false, expected: false },
    { previous: 'a crash or power loss', activeSession: true, expected: true },
  ])('reports $previous as the previous session, not the running one [DON-284]', async ({ activeSession, expected }) => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    const crashDir = path.join(testUserDataPath, 'crashes')
    mkdirSync(crashDir, { recursive: true })
    writeFileSync(path.join(crashDir, 'last-clean-exit'), '2026-10-01T10:00:00.000Z')
    if (activeSession) writeFileSync(path.join(crashDir, 'active-session'), '2026-10-01T11:00:00.000Z')
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    const handler = electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:read-crash-recovery-state',
    )?.[1]
    const sender = electronMock.BrowserWindow.mock.results[0]?.value.webContents

    // This session's own start marker exists now; it must not count as a crash.
    expect(readdirSync(crashDir)).toContain('active-session')
    await expect(handler({ sender, senderFrame: { url: 'http://localhost:5173/' } }))
      .resolves.toMatchObject({ uncleanShutdown: expected })
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
    for (const fields of [{ notes: 'hidden\u0000control' }, { start_time: '2026-09-09\u0000' }]) {
      expect(() => handler({ sender, senderFrame: { url: 'http://localhost:5173/' } }, {
        name: 'Control check', ...fields,
      })).toThrow(/notes|start time|invalid/iu)
    }
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
    const logs = createInMemoryStartupLogs()
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
      if (request === './crash-log.cjs') {
        return { ...originalLoad(request, parent, isMain), createCrashLog: () => logs.crashLog }
      }
      if (request === './runtime-log.cjs') {
        return { ...originalLoad(request, parent, isMain), createRuntimeLog: () => logs.runtimeLog }
      }
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
    const logs = createInMemoryStartupLogs()
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
      if (request === './crash-log.cjs') {
        return { ...originalLoad(request, parent, isMain), createCrashLog: () => logs.crashLog }
      }
      if (request === './runtime-log.cjs') {
        return { ...originalLoad(request, parent, isMain), createRuntimeLog: () => logs.runtimeLog }
      }
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

    // The automatic crash recovery [M-45] retries the cleanup before it opens
    // the replacement window.
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(2))
    expect(sessionManager.closeForSender).toHaveBeenCalledTimes(2)
    expect(sessionManager.closeForSender.mock.invocationCallOrder[1])
      .toBeLessThan(rendererTeardownCoordinator.markRendererAvailable.mock.invocationCallOrder[1] ?? Infinity)
    expect(sessionManager.closeForSender).toHaveBeenNthCalledWith(2, 1)
    expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(2)
    expect(rendererTeardownCoordinator.markRendererAvailable).toHaveBeenCalledTimes(2)
  })

  it('finishes closing a hung map window once the operator chooses Close now [DON-361]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    electronMock.dialog.showMessageBox.mockResolvedValue({ response: 1 })
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    // The coordinator captures setTimeout when main starts, so fake it first.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      require('../../electron/main.cjs')
      await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
      const createdWindow = electronMock.BrowserWindow.mock.results[0]?.value
      electronMock.BrowserWindow.fromWebContents.mockImplementation(
        (contents: unknown) => (contents === createdWindow.webContents ? createdWindow : null),
      )
      const closeHandler = createdWindow.on.mock.calls.find(
        ([eventName]: [string]) => eventName === 'close',
      )?.[1]
      closeHandler({ preventDefault: vi.fn() })
      await vi.waitFor(() => expect(createdWindow.webContents.send).toHaveBeenCalledOnce())
      // The renderer never acknowledges: alive but stuck.
      await vi.advanceTimersByTimeAsync(15_000)
      await vi.waitFor(() => expect(electronMock.dialog.showMessageBox).toHaveBeenCalledWith(
        createdWindow,
        expect.objectContaining({ title: 'SAR Tracker is not responding' }),
      ))
      await vi.waitFor(() => expect(createdWindow.close).toHaveBeenCalledOnce())
    } finally {
      vi.useRealTimers()
    }
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

  it('holds a refused quit, never reopens the session, and exits once the backup settles [DON-331]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const realStore = require('../../electron/mission-store.cjs') as {
      readonly createElectronMissionStore: (options: unknown) => Record<string, unknown> & {
        readonly prepareClose: () => Promise<void>
      }
    }
    let releaseSettle: (() => void) | undefined
    const settled = new Promise<void>((resolve) => { releaseSettle = resolve })
    const refusal = Object.assign(new Error('A mission evidence worker did not exit within the safe shutdown deadline.'), {
      name: 'ShutdownRefusedError', code: 'SHUTDOWN_DEADLINE_EXCEEDED', backupInProgress: true,
    })
    const prepareClose = vi.fn()
    const whenShutdownSettled = vi.fn(() => settled)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './mission-store.cjs') {
        return {
          ...realStore,
          createElectronMissionStore: (options: unknown) => {
            const store = realStore.createElectronMissionStore(options)
            prepareClose
              .mockImplementationOnce(async () => {
                await store.prepareClose()
                throw refusal
              })
              .mockImplementation(() => store.prepareClose())
            return { ...store, prepareClose, whenShutdownSettled }
          },
        }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => {
      expect(electronMock.app.on).toHaveBeenCalledWith('before-quit', expect.any(Function))
    })
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    const handler = (eventName: string) => electronMock.app.on.mock.calls.find(([name]) => name === eventName)?.[1]

    handler('before-quit')({ preventDefault: vi.fn() })

    await vi.waitFor(() => expect(electronMock.dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      title: 'SAR Tracker is finishing a backup',
      message: expect.stringContaining('will close by itself'),
    })))
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
    expect(whenShutdownSettled).toHaveBeenCalledOnce()

    // A second quit or launch must not restart teardown or open a window on the closed session.
    const windowsBefore = electronMock.BrowserWindow.mock.calls.length
    handler('before-quit')({ preventDefault: vi.fn() })
    handler('second-instance')()
    await Promise.resolve()
    expect(prepareClose).toHaveBeenCalledOnce()
    // Each of them repeats why the app is still open.
    expect(electronMock.dialog.showMessageBox).toHaveBeenCalledTimes(3)
    expect(electronMock.BrowserWindow.mock.calls.length).toBe(windowsBefore)
    expect(electronMock.app.exit).not.toHaveBeenCalled()

    releaseSettle?.()
    await vi.waitFor(() => expect(electronMock.app.exit).toHaveBeenCalledWith(0))
    expect(prepareClose).toHaveBeenCalledTimes(2)
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
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

  /** Loads main with a configured Traccar provider and returns its proxy handler. */
  async function loadConfiguredTraccarProxy(): Promise<(event: unknown, input: unknown) => Promise<unknown>> {
    seedSettings({
      dataSource: {
        providerType: 'traccar_http',
        baseUrl: 'https://traccar.example.test',
        authMode: 'basic',
        email: 'operator',
      },
    })
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
    return electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:traccar-http-request',
    )?.[1]
  }

  it('stops reading an unsized Traccar reply as soon as it passes the size limit [DON-338]', async () => {
    let pulledChunks = 0
    const megabyte = new Uint8Array(1024 * 1024).fill(0x20)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulledChunks += 1
        if (pulledChunks > 50) controller.close()
        else controller.enqueue(megabyte)
      },
    }), { status: 200 }))
    const traccarHandler = await loadConfiguredTraccarProxy()

    await expect(traccarHandler(createPackagedSenderEvent(), {
      url: 'https://traccar.example.test/api/positions',
      method: 'GET',
      headers: {},
      timeoutMs: null,
    })).rejects.toThrow(/Traccar response is too large/)
    // 5 MiB limit: the reader stops within a chunk or two of it, not at 50 MiB.
    expect(pulledChunks).toBeLessThanOrEqual(8)
  })

  it('reports a Traccar proxy timeout in words the history catch-up can act on [DON-338]', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('This operation was aborted', 'AbortError'))
      }, { once: true })
    }))
    const traccarHandler = await loadConfiguredTraccarProxy()

    await expect(traccarHandler(createPackagedSenderEvent(), {
      url: 'https://traccar.example.test/api/positions',
      method: 'GET',
      headers: {},
      timeoutMs: 50,
    })).rejects.toThrow('Traccar request timed out after 50 ms.')
  })

  it('runs failed imports inside the official map mutation guard [DON-7]', async () => {
    const officialMapProxy = { close: vi.fn(), fetchOfficialMapTile: vi.fn(), invalidateSettings: vi.fn(),
      withPackageMutation: vi.fn((operation: () => Promise<unknown>) => operation()) }
    const importPackage = vi.fn(async () => {
      expect(officialMapProxy.withPackageMutation).toHaveBeenCalledOnce()
      throw new Error('Synthetic import failure')
    })
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './official-map-proxy.cjs') return { createElectronOfficialMapProxy: () => officialMapProxy }
      if (request === './file-system.cjs') return { createElectronFileSystem: () => ({ importOfficialMapPackage: importPackage }) }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load
    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:import-official-map-package',
    )?.[1]).toEqual(expect.any(Function)))
    const handler = electronMock.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'sartracker:import-official-map-package',
    )?.[1]
    await expect(handler(createPackagedSenderEvent(), {sourcePath: 'synthetic'})).rejects.toThrow('Synthetic import failure')
    expect(officialMapProxy.withPackageMutation).toHaveBeenCalledOnce()
  })

  it('guards map settings changes without interrupting unrelated saves [DON-7]', async () => {
    const officialMapProxy = {
      close: vi.fn(),
      fetchOfficialMapTile: vi.fn(),
      invalidateSettings: vi.fn(),
      withPackageMutation: vi.fn((operation: () => Promise<unknown>) => operation()),
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

    expect(officialMapProxy.withPackageMutation).not.toHaveBeenCalled()
    await saveSettingsHandler(createPackagedSenderEvent(), {
      ...DEFAULT_APP_SETTINGS,
      officialMaps: {
        ...DEFAULT_APP_SETTINGS.officialMaps,
        sourceType: 'mapgenie_file',
        sourcePath: '/synthetic-missing-provider.json',
      },
    })
    expect(officialMapProxy.withPackageMutation).toHaveBeenCalledOnce()
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

  it('shows the fatal error and exits when crash evidence recording rejects', async () => {
    const processOn = vi.spyOn(process, 'on').mockImplementation(() => process)
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      markSessionStart: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
      recordDurably: vi.fn().mockRejectedValue(
        new Error('startup evidence utility process exited'),
      ),
    }
    const runtimeLog = {
      append: vi.fn(async () => undefined),
      readRecent: vi.fn(async () => []),
    }
    const markRendererUnavailable = vi.fn(async () => undefined)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './crash-log.cjs') return { createCrashLog: () => crashLog }
      if (request === './runtime-log.cjs') return { createRuntimeLog: () => runtimeLog }
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
    let unhandledRejectionHandler: ((reason: unknown) => void) | undefined
    await vi.waitFor(() => {
      unhandledRejectionHandler = processOn.mock.calls
        .filter(([eventName]) => eventName === 'unhandledRejection')
        .map(([, listener]) => listener)
        .find((listener) => String(listener).includes('handleFatalMainProcessError')) as
        | ((reason: unknown) => void)
        | undefined
      expect(unhandledRejectionHandler).toBeDefined()
    })

    unhandledRejectionHandler?.(new Error('fatal runtime fault'))

    await vi.waitFor(() => expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      'SAR Tracker runtime fault',
      expect.stringContaining('fault details may not have been saved'),
    ))
    expect(crashLog.recordDurably).toHaveBeenCalledOnce()
    expect(crashLog.record).not.toHaveBeenCalled()
    expect(markRendererUnavailable).toHaveBeenCalledOnce()
    expect(electronMock.app.relaunch).toHaveBeenCalledOnce()
    expect(electronMock.app.exit).toHaveBeenCalledWith(1)
  })

  it.each([
    { terminationError: null, expectedTitle: 'SAR Tracker runtime fault', relaunches: true },
    {
      terminationError: new Error('evidence writer could not be reaped'),
      expectedTitle: 'SAR Tracker could not restart safely',
      relaunches: false,
    },
  ])('bounds a stalled fatal evidence write and respects writer exit: $expectedTitle', async ({
    terminationError,
    expectedTitle,
    relaunches,
  }) => {
    Object.defineProperty(process.versions, 'electron', {
      configurable: true,
      value: '42.0.0',
    })
    const processOn = vi.spyOn(process, 'on').mockImplementation(() => process)
    let releaseWindowLoad!: () => void
    const windowLoad = new Promise<void>((resolve) => { releaseWindowLoad = resolve })
    const loadWindow = vi.fn(() => windowLoad)
    const electronMock = createElectronMock(vi.fn(), undefined, true, [], loadWindow)
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      markSessionStart: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
      recordDurably: vi.fn(() => new Promise<void>(() => {})),
    }
    const runtimeLog = {
      append: vi.fn(async () => undefined),
      readRecent: vi.fn(async () => []),
    }
    const markRendererUnavailable = vi.fn(async () => undefined)
    const startupEvidenceService = {
      crashLog,
      runtimeLog,
      ready: Promise.resolve(),
      close: vi.fn(async () => undefined),
      terminate: vi.fn(async () => {
        if (terminationError !== null) throw terminationError
      }),
    }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './startup-evidence-service.cjs') {
        return { createStartupEvidenceService: () => startupEvidenceService }
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
    let unhandledRejectionHandler: ((reason: unknown) => void) | undefined
    await vi.waitFor(() => {
      unhandledRejectionHandler = processOn.mock.calls
        .filter(([eventName]) => eventName === 'unhandledRejection')
        .map(([, listener]) => listener)
        .find((listener) => String(listener).includes('handleFatalMainProcessError')) as
        | ((reason: unknown) => void)
        | undefined
      expect(unhandledRejectionHandler).toBeDefined()
    })

    // Crash capture is installed before asynchronous store/window startup finishes.
    // Do not advance the startup watchdog while real filesystem work is pending.
    await vi.waitFor(() => expect(loadWindow).toHaveBeenCalledOnce())
    expect(electronMock.BrowserWindow.mock.results[0]?.value.show).not.toHaveBeenCalled()
    expect(crashLog.recordDurably).not.toHaveBeenCalled()
    releaseWindowLoad()
    await vi.waitFor(() => {
      expect(crashLog.record).not.toHaveBeenCalled()
      expect(electronMock.app.on).toHaveBeenCalledWith('before-quit', expect.any(Function))
      expect(electronMock.BrowserWindow.mock.results[0]?.value.show).toHaveBeenCalledOnce()
    })
    expect(electronMock.app.exit).not.toHaveBeenCalled()
    vi.useFakeTimers()
    unhandledRejectionHandler?.(new Error('fatal runtime fault'))
    await vi.advanceTimersByTimeAsync(0)
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(9_999)
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    await vi.waitFor(() => expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      expectedTitle,
      relaunches
        ? expect.stringContaining('fault details may not have been saved')
        : expect.stringContaining('diagnostic writer could not be stopped'),
    ))
    expect(startupEvidenceService.terminate).toHaveBeenCalledOnce()
    expect(markRendererUnavailable).toHaveBeenCalledOnce()
    if (relaunches) {
      expect(electronMock.app.relaunch).toHaveBeenCalledOnce()
      expect(electronMock.app.exit).toHaveBeenCalledWith(1)
    } else {
      expect(electronMock.app.relaunch).not.toHaveBeenCalled()
      expect(electronMock.app.exit).not.toHaveBeenCalled()
    }
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

  it('bounds a stalled fatal renderer evidence fence and keeps the process open', async () => {
    vi.useFakeTimers()
    Object.defineProperty(process.versions, 'electron', {
      configurable: true,
      value: '42.0.0',
    })
    const processOn = vi.spyOn(process, 'on').mockImplementation(() => process)
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const heldFence = new Promise<void>(() => {})
    const markRendererUnavailable = vi.fn(() => heldFence)
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      markSessionStart: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
      recordDurably: vi.fn(async () => undefined),
    }
    const runtimeLog = {
      append: vi.fn(async () => undefined),
      appendDurable: vi.fn(async () => undefined),
      readRecent: vi.fn(async () => []),
    }
    const startupEvidenceService = {
      crashLog,
      runtimeLog,
      ready: Promise.resolve(),
      close: vi.fn(async () => undefined),
      terminate: vi.fn(async () => undefined),
    }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './startup-evidence-service.cjs') {
        return { createStartupEvidenceService: () => startupEvidenceService }
      }
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({ initialize: vi.fn(async () => undefined) }) }
      }
      if (request === './renderer-teardown-coordinator.cjs') {
        return {
          createRendererTeardownCoordinator: () => ({
            prepare: vi.fn(),
            markRendererUnavailable,
            markRendererAvailable: vi.fn(async () => undefined),
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
    // Let startup finish first: the 10 s advance below must exercise only the
    // fatal fence bound, not a startup-stage watchdog on a slow runner.
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalled())

    uncaughtHandler?.(new Error('fatal runtime fault'))
    await vi.advanceTimersByTimeAsync(0)
    expect(markRendererUnavailable).toHaveBeenCalledOnce()
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(9_999)
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    await vi.waitFor(() => expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      'SAR Tracker could not restart safely',
      expect.stringContaining('could not be marked safely'),
    ))
    expect(electronMock.app.relaunch).not.toHaveBeenCalled()
    expect(electronMock.app.exit).not.toHaveBeenCalled()
  })

  it('keeps a withheld fatal relaunch and the held lock when a later fault arrives', async () => {
    vi.useFakeTimers()
    Object.defineProperty(process.versions, 'electron', { configurable: true, value: '42.0.0' })
    const processOn = vi.spyOn(process, 'on').mockImplementation(() => process)
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      markSessionStart: vi.fn(async () => undefined),
      markCleanExit: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
      recordDurably: vi.fn(() => new Promise<void>(() => {})),
    }
    const runtimeLog = { append: vi.fn(async () => undefined), readRecent: vi.fn(async () => []) }
    const startupEvidenceService = {
      crashLog,
      runtimeLog,
      ready: Promise.resolve(),
      close: vi.fn(async () => undefined),
      terminate: vi.fn().mockRejectedValue(new Error('evidence writer could not be reaped')),
    }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './startup-evidence-service.cjs') {
        return { createStartupEvidenceService: () => startupEvidenceService }
      }
      if (request === './renderer-teardown-coordinator.cjs') {
        return { createRendererTeardownCoordinator: () => rendererTeardownCoordinatorStub() }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    const fatalHandler = await findFatalHandler(processOn, 'unhandledRejection')
    await vi.waitFor(() => {
      expect(electronMock.app.on).toHaveBeenCalledWith('before-quit', expect.any(Function))
    })

    fatalHandler(new Error('first fatal fault'))
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.waitFor(() => expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      'SAR Tracker could not restart safely',
      expect.stringContaining('diagnostic writer could not be stopped'),
    ))

    // The helper is now mid-terminate: every later write fails immediately.
    crashLog.recordDurably.mockRejectedValue(new Error('Startup evidence utility process is not available.'))
    fatalHandler(new Error('second fatal fault'))
    await vi.advanceTimersByTimeAsync(10_000)

    expect(startupEvidenceService.terminate).toHaveBeenCalledOnce()
    expect(electronMock.app.relaunch).not.toHaveBeenCalled()
    expect(electronMock.app.exit).not.toHaveBeenCalled()

    // Neither an ordinary quit nor a second launch may release the held lock.
    const beforeQuitHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'before-quit',
    )?.[1]
    const quitEvent = { preventDefault: vi.fn() }
    beforeQuitHandler(quitEvent)
    await vi.advanceTimersByTimeAsync(0)
    expect(quitEvent.preventDefault).toHaveBeenCalledOnce()
    expect(crashLog.markCleanExit).not.toHaveBeenCalled()
    expect(electronMock.app.exit).not.toHaveBeenCalled()
    const secondInstanceHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'second-instance',
    )?.[1]
    electronMock.dialog.showErrorBox.mockClear()
    secondInstanceHandler()
    expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      'SAR Tracker could not restart safely',
      expect.stringContaining('diagnostic writer could not be stopped'),
    )
  })

  it('handles concurrent fatal faults with one response and one relaunch', async () => {
    const processOn = vi.spyOn(process, 'on').mockImplementation(() => process)
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './renderer-teardown-coordinator.cjs') {
        return { createRendererTeardownCoordinator: () => rendererTeardownCoordinatorStub() }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    const fatalHandler = await findFatalHandler(processOn, 'unhandledRejection')

    fatalHandler(new Error('first fatal fault'))
    fatalHandler(new Error('second fatal fault'))
    await vi.waitFor(() => expect(electronMock.app.exit).toHaveBeenCalledWith(1))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(electronMock.app.relaunch).toHaveBeenCalledOnce()
    expect(electronMock.app.exit).toHaveBeenCalledOnce()
    expect(electronMock.dialog.showErrorBox).toHaveBeenCalledOnce()
    expect(readFileSync(path.join(testUserDataPath, 'crashes', 'crash-log.json'), 'utf8'))
      .toContain('second fatal fault')
  })

  it('does not mark a session clean when quitting after a withheld fatal relaunch', async () => {
    const processOn = vi.spyOn(process, 'on').mockImplementation(() => process)
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const coordinator = rendererTeardownCoordinatorStub()
    coordinator.markRendererUnavailable.mockRejectedValue(new Error('mission store unavailable'))
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './renderer-teardown-coordinator.cjs') {
        return { createRendererTeardownCoordinator: () => coordinator }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    const fatalHandler = await findFatalHandler(processOn, 'uncaughtException')
    await vi.waitFor(() => {
      expect(electronMock.app.on).toHaveBeenCalledWith('before-quit', expect.any(Function))
    })
    fatalHandler(new Error('fatal persistence fault'))
    await vi.waitFor(() => expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      'SAR Tracker could not restart safely',
      expect.stringContaining('kept the current process open'),
    ))

    electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    const beforeQuitHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'before-quit',
    )?.[1]
    beforeQuitHandler({ preventDefault: vi.fn() })

    await vi.waitFor(() => expect(electronMock.app.exit).toHaveBeenCalledWith(0))
    expect(electronMock.app.relaunch).not.toHaveBeenCalled()
    expect(() => readFileSync(path.join(testUserDataPath, 'crashes', 'last-clean-exit'), 'utf8'))
      .toThrow(/ENOENT/u)
    expect(readFileSync(path.join(testUserDataPath, 'crashes', 'active-session'), 'utf8'))
      .toMatch(/^\d{4}-\d{2}-\d{2}T/u)
  })

  it('still exits when the clean-exit marker cannot be written, leaving the session unclean', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const { crashLog, runtimeLog } = createInMemoryStartupLogs()
    crashLog.markCleanExit.mockRejectedValue(
      Object.assign(new Error('Startup evidence utility process is not available.'), {
        code: 'ERR_SARTRACKER_EVIDENCE_WORKER',
      }),
    )
    const startupEvidenceService = {
      crashLog,
      runtimeLog,
      ready: Promise.resolve(),
      close: vi.fn(async () => undefined),
      terminate: vi.fn(async () => undefined),
    }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './startup-evidence-service.cjs') {
        return { createStartupEvidenceService: () => startupEvidenceService }
      }
      if (request === './renderer-teardown-coordinator.cjs') {
        return { createRendererTeardownCoordinator: () => rendererTeardownCoordinatorStub() }
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

    await vi.waitFor(() => expect(electronMock.app.exit).toHaveBeenCalledWith(0))
    expect(crashLog.markCleanExit).toHaveBeenCalledOnce()
    expect(runtimeLog.append).toHaveBeenCalledWith(expect.objectContaining({
      event: 'clean_exit_marker_unavailable',
    }))
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('keeps the process and lock when the evidence writer cannot be stopped at quit', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const { crashLog, runtimeLog } = createInMemoryStartupLogs()
    const startupEvidenceService = {
      crashLog,
      runtimeLog,
      ready: Promise.resolve(),
      close: vi.fn().mockRejectedValue(new Error('Startup evidence utility process could not be reaped.')),
      terminate: vi.fn(async () => undefined),
    }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './startup-evidence-service.cjs') {
        return { createStartupEvidenceService: () => startupEvidenceService }
      }
      if (request === './renderer-teardown-coordinator.cjs') {
        return { createRendererTeardownCoordinator: () => rendererTeardownCoordinatorStub() }
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

    await vi.waitFor(() => expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      'SAR Tracker could not close safely',
      expect.stringContaining('diagnostic writer could not be confirmed stopped'),
    ))
    expect(electronMock.app.exit).not.toHaveBeenCalled()
    beforeQuitHandler({ preventDefault: vi.fn() })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(startupEvidenceService.close).toHaveBeenCalledOnce()
    expect(electronMock.app.exit).not.toHaveBeenCalled()
  })

  it('reports saved crash evidence when only the runtime log write stays pending', async () => {
    vi.useFakeTimers()
    Object.defineProperty(process.versions, 'electron', { configurable: true, value: '42.0.0' })
    const processOn = vi.spyOn(process, 'on').mockImplementation(() => process)
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const startupRuntimeLog = { append: vi.fn(async () => undefined), readRecent: vi.fn(async () => []) }
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      markSessionStart: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
      recordDurably: vi.fn(async () => undefined),
    }
    const startupEvidenceService = {
      crashLog,
      runtimeLog: startupRuntimeLog,
      ready: Promise.resolve(),
      close: vi.fn(async () => undefined),
      terminate: vi.fn(async () => undefined),
    }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './startup-evidence-service.cjs') {
        return { createStartupEvidenceService: () => startupEvidenceService }
      }
      if (request === './renderer-teardown-coordinator.cjs') {
        return { createRendererTeardownCoordinator: () => rendererTeardownCoordinatorStub() }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    const fatalHandler = await findFatalHandler(processOn, 'unhandledRejection')
    await vi.waitFor(() => {
      expect(electronMock.app.on).toHaveBeenCalledWith('before-quit', expect.any(Function))
    })
    startupRuntimeLog.append.mockImplementation(() => new Promise<undefined>(() => {}))

    fatalHandler(new Error('fatal runtime fault'))
    await vi.advanceTimersByTimeAsync(10_000)

    await vi.waitFor(() => expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      'SAR Tracker runtime fault',
      expect.stringContaining('Crash evidence was saved'),
    ))
    expect(startupEvidenceService.terminate).toHaveBeenCalledOnce()
    expect(electronMock.app.relaunch).toHaveBeenCalledOnce()
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

  it.each([
    ['blocks a mission whose renderer held evidence', true, true, { state: 'critical', reason: 'renderer_pending_evidence_lost' }],
    ['leaves a mission healthy when nothing was held (Eamonn, 13.5)', false, true, { state: 'healthy', reason: null }],
    ['stays conservative for a profile last run by 13.5 (no marker protocol)', false, false, { state: 'critical', reason: 'renderer_pending_evidence_lost' }],
  ] as const)('after an unclean restart, %s [DON-318]', async (_name, held, protocol, expected) => {
    const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
      readonly createElectronMissionStore: (input: { readonly userDataPath: string }) => {
        readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
        readonly setRendererEvidencePending: (input: {
          readonly mission_id: string
          readonly pending: boolean
        }) => Promise<void>
        readonly establishRendererEvidenceProtocol: () => Promise<void>
        readonly close: () => void
      }
    }
    mkdirSync(testUserDataPath, { recursive: true })
    const seedStore = createElectronMissionStore({ userDataPath: testUserDataPath })
    const mission = await seedStore.createMission({ name: 'Unclean restart evidence' })
    if (protocol) await seedStore.establishRendererEvidenceProtocol()
    if (held) await seedStore.setRendererEvidencePending({ mission_id: mission.id, pending: true })
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

    await expect(healthHandler(createPackagedSenderEvent(), mission.id)).resolves.toMatchObject(expected)
  })

  it('reserves interrupted cleanup before review IPC without waiting for row batches', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const order: string[] = []
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      markSessionStart: vi.fn(async () => undefined),
      readRecent: vi.fn(async () => []),
      record: vi.fn(async () => undefined),
    }
    const runtimeLog = {
      append: vi.fn(async () => undefined),
      readRecent: vi.fn(async () => []),
    }
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
      if (request === './crash-log.cjs') {
        return { ...originalLoad(request, parent, isMain), createCrashLog: () => crashLog }
      }
      if (request === './runtime-log.cjs') {
        return { ...originalLoad(request, parent, isMain), createRuntimeLog: () => runtimeLog }
      }
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

  it('explains an unwritable profile instead of exiting silently as a duplicate launch [DON-285]', async () => {
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const setPath = vi.fn()
    Object.assign(electronMock.app, { setPath })
    const createElectronMissionStore = vi.fn()
    // Keep the temporary profile inside this test's own folder.
    const temporaryProfile = path.join(testUserDataPath, 'temporary-profile')
    vi.spyOn(require('node:fs'), 'mkdtempSync').mockImplementation(() => {
      mkdirSync(temporaryProfile, { recursive: true })
      return temporaryProfile
    })
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './profile-writability.cjs') {
        const actual = originalLoad(request, parent, isMain)
        return {
          ...actual,
          checkProfileWritable: () => ({ writable: false, code: 'EACCES' }),
          removeStaleTemporaryProfiles: vi.fn(),
        }
      }
      if (request === './mission-store.cjs') return { createElectronMissionStore }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')

    await vi.waitFor(() => {
      expectStartupFailureWindow(electronMock, expect.stringContaining('cannot write to its data folder'))
      expect(startupProcessExit).toHaveBeenCalledWith(1)
    })
    expectStartupFailureWindow(electronMock, expect.stringContaining(testUserDataPath))
    // Chromium needs a writable profile even to show the message; the team's
    // profile itself is left untouched.
    expect(setPath).toHaveBeenCalledWith('userData', temporaryProfile)
    expect(electronMock.app.requestSingleInstanceLock).toHaveBeenCalled()
    expect(createElectronMissionStore).not.toHaveBeenCalled()
    expect(electronMock.app.relaunch).not.toHaveBeenCalled()
  })

  it('still explains an unwritable profile when no temporary folder can be made either [DON-285]', () => {
    const electronMock = createElectronMock(vi.fn(), undefined, false)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './profile-writability.cjs') {
        const actual = originalLoad(request, parent, isMain)
        return {
          ...actual,
          checkProfileWritable: () => ({ writable: false, code: 'ENOSPC' }),
          removeStaleTemporaryProfiles: vi.fn(),
        }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load
    vi.spyOn(require('node:fs'), 'mkdtempSync').mockImplementation(() => {
      throw Object.assign(new Error('no space'), { code: 'ENOSPC' })
    })

    require('../../electron/main.cjs')

    expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      'SAR Tracker cannot start',
      expect.stringMatching(/disk is full/iu),
    )
    expect(electronMock.app.exit).toHaveBeenCalledWith(1)
    expect(electronMock.app.requestSingleInstanceLock).not.toHaveBeenCalled()
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
      expectStartupFailureWindow(electronMock, expect.stringContaining(startupError.message))
      expect(startupProcessExit).toHaveBeenCalledWith(1)
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

  it('reports the timed-out startup step when startup diagnostics remain held', async () => {
    vi.useFakeTimers()
    const held = new Promise<never>(() => {})
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const crashLog = { hadUncleanShutdown: vi.fn(async () => false), record: vi.fn(async () => undefined) }
    const runtimeLog = { append: vi.fn(async () => undefined) }
    const createRuntimeLog = vi.fn(() => runtimeLog)
    const createCrashLog = vi.fn(() => crashLog)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './crash-log.cjs') return { createCrashLog }
      if (request === './runtime-log.cjs') return { createRuntimeLog }
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({ initialize: () => held }) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(10_000)

    expectStartupFailureWindow(
      electronMock,
      expect.stringMatching(/storage diagnostics initialization.*10 seconds.*does not mean the mission data is damaged/iu),
    )
    expect(startupProcessExit).toHaveBeenCalledWith(1)
    expect(createCrashLog).toHaveBeenCalledTimes(1)
    expect(createRuntimeLog).toHaveBeenCalledTimes(1)
  })

  it('waits for dismissal of the startup fault window before exiting', async () => {
    vi.useFakeTimers()
    const held = new Promise<never>(() => {})
    const electronMock = createElectronMock(vi.fn(), undefined, true, [], undefined, undefined, false)
    const crashLog = { hadUncleanShutdown: vi.fn(async () => false), record: vi.fn(async () => undefined) }
    const runtimeLog = { append: vi.fn(async () => undefined) }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './crash-log.cjs') return { createCrashLog: () => crashLog }
      if (request === './runtime-log.cjs') return { createRuntimeLog: () => runtimeLog }
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({ initialize: () => held }) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.advanceTimersByTimeAsync(10_000)

    expectStartupFailureWindow(
      electronMock,
      expect.stringMatching(/storage diagnostics initialization.*10 seconds/iu),
    )
    expect(startupProcessExit).not.toHaveBeenCalled()

    const failureWindow = electronMock.BrowserWindow.mock.results[0]?.value
    const closeHandler = failureWindow?.once.mock.calls.find(([eventName]) => eventName === 'closed')?.[1]
    closeHandler?.()
    await vi.waitFor(() => expect(startupProcessExit).toHaveBeenCalledWith(1))

    expect(runtimeLog.append).toHaveBeenCalledWith({
      level: 'error',
      event: 'startup_failure_dialog_closed',
      fields: {},
    })
    expect(startupProcessExit).toHaveBeenCalledWith(1)
  })

  it('routes an app quit request during a startup fault through the dismissal path', async () => {
    vi.useFakeTimers()
    const held = new Promise<never>(() => {})
    const electronMock = createElectronMock(vi.fn(), undefined, true, [], undefined, undefined, false)
    const crashLog = { hadUncleanShutdown: vi.fn(async () => false), record: vi.fn(async () => undefined) }
    const runtimeLog = { append: vi.fn(async () => undefined) }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './crash-log.cjs') return { createCrashLog: () => crashLog }
      if (request === './runtime-log.cjs') return { createRuntimeLog: () => runtimeLog }
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({ initialize: () => held }) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.advanceTimersByTimeAsync(10_000)
    expectStartupFailureWindow(electronMock, expect.stringMatching(/10 seconds/iu))

    const beforeQuitHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'before-quit',
    )?.[1]
    expect(beforeQuitHandler).toEqual(expect.any(Function))
    const quitEvent = { preventDefault: vi.fn() }
    beforeQuitHandler(quitEvent)

    // Cmd+Q must not skip the evidence wait: it closes the fault window, and
    // the ordinary dismissal path then settles evidence and exits.
    expect(quitEvent.preventDefault).toHaveBeenCalledOnce()
    const failureWindow = electronMock.BrowserWindow.mock.results[0]?.value
    expect(failureWindow.close).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(startupProcessExit).toHaveBeenCalledWith(1))
    expect(runtimeLog.append).toHaveBeenCalledWith({
      level: 'error',
      event: 'startup_failure_dialog_closed',
      fields: {},
    })
  })

  it('bounds stuck evidence writes after the operator closes the startup fault window', async () => {
    vi.useFakeTimers()
    const held = new Promise<never>(() => {})
    const electronMock = createElectronMock(vi.fn(), undefined, true, [], undefined, undefined, false)
    const crashLog = { hadUncleanShutdown: vi.fn(async () => false), record: vi.fn(async () => undefined) }
    const runtimeLog = { append: vi.fn(() => held) }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './crash-log.cjs') return { createCrashLog: () => crashLog }
      if (request === './runtime-log.cjs') return { createRuntimeLog: () => runtimeLog }
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({ initialize: () => held }) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.advanceTimersByTimeAsync(10_000)
    expectStartupFailureWindow(electronMock, expect.stringMatching(/storage diagnostics initialization/iu))
    expect(startupProcessExit).not.toHaveBeenCalled()

    const faultWindow = electronMock.BrowserWindow.mock.results[0]?.value
    const closeListener = electronMock.ipcMain.on.mock.calls.find(
      ([channel]) => channel === 'sartracker:startup-failure-close',
    )?.[1]
    closeListener?.({ sender: faultWindow.webContents })
    expect(faultWindow.close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(9_999)
    expect(startupProcessExit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(startupProcessExit).toHaveBeenCalledWith(1)
    expect(electronMock.ipcMain.removeListener).toHaveBeenCalledWith(
      'sartracker:startup-failure-close',
      closeListener,
    )
  })

  it('keeps the single-instance process open when a startup writer cannot be reaped', async () => {
    vi.useFakeTimers()
    const held = new Promise<never>(() => {})
    const electronMock = createElectronMock(vi.fn(), undefined, true, [], undefined, undefined, false)
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      record: vi.fn(() => held),
    }
    const runtimeLog = { append: vi.fn(() => held) }
    const startupEvidenceService = {
      crashLog,
      runtimeLog,
      ready: Promise.resolve(),
      close: vi.fn(async () => undefined),
      terminate: vi.fn().mockRejectedValue(new Error('writer exit was not confirmed')),
    }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './startup-evidence-service.cjs') {
        return { createStartupEvidenceService: () => startupEvidenceService }
      }
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({ initialize: () => held }) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.advanceTimersByTimeAsync(10_000)
    expectStartupFailureWindow(electronMock, expect.stringMatching(/10 seconds/iu))
    expect(startupProcessExit).not.toHaveBeenCalled()

    const failureWindow = electronMock.BrowserWindow.mock.results[0]?.value
    const closeListener = electronMock.ipcMain.on.mock.calls.find(
      ([channel]) => channel === 'sartracker:startup-failure-close',
    )?.[1]
    closeListener?.({ sender: failureWindow.webContents })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(startupEvidenceService.terminate).not.toHaveBeenCalled()
    expect(startupProcessExit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    await vi.waitFor(() => expect(startupEvidenceService.terminate).toHaveBeenCalledOnce())
    expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      'SAR Tracker could not close safely',
      expect.stringContaining('diagnostic writer could not be confirmed stopped'),
    )
    expect(startupProcessExit).not.toHaveBeenCalled()
    expect(electronMock.app.exit).not.toHaveBeenCalled()
    expect(electronMock.app.quit).not.toHaveBeenCalled()

    // A second launch routed here must see why nothing opens, not a silent no-op.
    electronMock.dialog.showErrorBox.mockClear()
    const secondInstanceHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'second-instance',
    )?.[1]
    secondInstanceHandler()
    expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      'SAR Tracker could not close safely',
      expect.stringContaining('Do not launch another copy'),
    )
  })

  it('bounds a crash-record write only after it remains pending for the evidence deadline', async () => {
    vi.useFakeTimers()
    const heldCrashWrite = new Promise<never>(() => {})
    const startupError = new Error('mission store could not initialize')
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      markSessionStart: vi.fn(async () => undefined),
      record: vi.fn(() => heldCrashWrite),
    }
    const runtimeLog = { append: vi.fn(async () => undefined) }
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({ initialize: vi.fn(async () => undefined) }) }
      }
      if (request === './crash-log.cjs') return { createCrashLog: () => crashLog }
      if (request === './runtime-log.cjs') return { createRuntimeLog: () => runtimeLog }
      if (request === './mission-store.cjs') {
        return { createElectronMissionStore: vi.fn(() => { throw startupError }) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.advanceTimersByTimeAsync(0)
    expectStartupFailureWindow(electronMock, expect.stringMatching(/contact support/iu))
    expect(startupProcessExit).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(9_999)
    expect(startupProcessExit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(crashLog.record).toHaveBeenCalledOnce()
    expect(startupProcessExit).toHaveBeenCalledWith(1)
  })

  it('uses Electron error reporting for a readiness rejection before application logs exist', async () => {
    const readinessError = new Error(
      'Could not open /home/fieldoperator/profile token=private-startup-token',
    )
    const electronMock = createElectronMock(vi.fn())
    electronMock.app.whenReady.mockRejectedValue(readinessError)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(startupProcessExit).toHaveBeenCalledWith(1))

    expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      'SAR Tracker could not start',
      expect.stringMatching(/could not open its operational data safely/iu),
    )
    // Before ready, the profile path is looked up once for the GPU preference
    // [DON-288] and the writability probe [DON-285], which removes its probe
    // file; no application log is created before readiness.
    expect(electronMock.app.getPath.mock.calls).toEqual([['userData']])
    expect(readdirSync(testUserDataPath)).toEqual([])
  })

  it('opens the normal window after a 3.5-second readiness delay without a post-shell timeout', async () => {
    vi.useFakeTimers()
    let monotonicNow = 0
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow)
    let resolveReady: () => void = () => {
      throw new Error('Electron readiness was not released by the test.')
    }
    const readiness = new Promise<void>((resolve) => {
      resolveReady = resolve
    })
    const electronMock = createElectronMock(
      vi.fn(),
      undefined,
      true,
      [],
      undefined,
      () => { monotonicNow = 10_500 },
    )
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      markSessionStart: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    }
    const runtimeLog = { append: vi.fn(async () => undefined) }
    electronMock.app.whenReady.mockReturnValue(readiness)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './crash-log.cjs') return { createCrashLog: () => crashLog }
      if (request === './runtime-log.cjs') return { createRuntimeLog: () => runtimeLog }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.advanceTimersByTimeAsync(3_500)
    monotonicNow = 3_500
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
    resolveReady()
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    const window = electronMock.BrowserWindow.mock.results[0]?.value
    expect(window.show).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(electronMock.app.on).toHaveBeenCalledWith(
      'before-quit',
      expect.any(Function),
    ))

    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
    expect(electronMock.app.exit).not.toHaveBeenCalled()
  })

  it('starts the 10-second watchdog after readiness, excluding module-load and readiness delay', async () => {
    vi.useFakeTimers()
    let monotonicNow = 0
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow)
    let resolveReady: () => void = () => {
      throw new Error('Electron readiness was not released by the test.')
    }
    const readiness = new Promise<void>((resolve) => {
      resolveReady = resolve
    })
    const held = new Promise<never>(() => {})
    const initializeDiagnostics = vi.fn(() => held)
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    electronMock.app.whenReady.mockReturnValue(readiness)
    const crashLog = { hadUncleanShutdown: vi.fn(async () => false), record: vi.fn(async () => undefined) }
    const runtimeLog = { append: vi.fn(async () => undefined) }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './crash-log.cjs') return { createCrashLog: () => crashLog }
      if (request === './runtime-log.cjs') return { createRuntimeLog: () => runtimeLog }
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({ initialize: initializeDiagnostics }) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await Promise.resolve()
    monotonicNow = 3_500
    resolveReady()
    await vi.advanceTimersByTimeAsync(0)
    expect(initializeDiagnostics).toHaveBeenCalledOnce()

    monotonicNow = 13_499
    await vi.advanceTimersByTimeAsync(9_999)
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
    monotonicNow = 13_500
    await vi.advanceTimersByTimeAsync(1)

    expectStartupFailureWindow(
      electronMock,
      expect.stringMatching(/storage diagnostics initialization.*10 seconds/iu),
    )
    expect(runtimeLog.append).toHaveBeenCalledWith(expect.objectContaining({
      event: 'startup_failure',
      fields: expect.objectContaining({
        stage: 'storage diagnostics initialization',
        timeoutMs: 10_000,
      }),
    }))
    await Promise.resolve()
    expect(startupProcessExit).toHaveBeenCalledWith(1)
  })

  it('keeps activation and window-close events from bypassing the startup fault response', async () => {
    vi.useFakeTimers()
    const held = new Promise<never>(() => {})
    const initializeDiagnostics = vi.fn(() => held)
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      record: vi.fn(async () => undefined),
    }
    const runtimeLog = { append: vi.fn(async () => undefined) }
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './crash-log.cjs') return { createCrashLog: () => crashLog }
      if (request === './runtime-log.cjs') return { createRuntimeLog: () => runtimeLog }
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({ initialize: initializeDiagnostics }) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.waitFor(() => expect(initializeDiagnostics).toHaveBeenCalledOnce())
    const activateHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'activate',
    )?.[1]
    const allWindowsClosedHandler = electronMock.app.on.mock.calls.find(
      ([eventName]) => eventName === 'window-all-closed',
    )?.[1]

    await activateHandler()
    allWindowsClosedHandler()

    expect(electronMock.BrowserWindow).not.toHaveBeenCalled()
    expect(electronMock.app.quit).not.toHaveBeenCalled()
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10_000)

    expectStartupFailureWindow(
      electronMock,
      expect.stringMatching(/storage diagnostics initialization.*10 seconds/iu),
    )
    expect(startupProcessExit).toHaveBeenCalledWith(1)
  })

  it('does not start the pre-window watchdog until Electron is ready', async () => {
    vi.useFakeTimers()
    let monotonicNow = 0
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow)
    let resolveReady: () => void = () => {
      throw new Error('Electron readiness was not released by the test.')
    }
    const readiness = new Promise<void>((resolve) => {
      resolveReady = resolve
    })
    const startupError = new Error('test startup stopped after readiness')
    const initializeDiagnostics = vi.fn(async () => undefined)
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    electronMock.app.whenReady.mockReturnValue(readiness)
    electronMock.app.isReady.mockReturnValue(false)
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      markSessionStart: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    }
    const runtimeLog = { append: vi.fn(async () => undefined) }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({ initialize: initializeDiagnostics }) }
      }
      if (request === './mission-store.cjs') {
        return { createElectronMissionStore: vi.fn(() => { throw startupError }) }
      }
      if (request === './crash-log.cjs') return { createCrashLog: () => crashLog }
      if (request === './runtime-log.cjs') return { createRuntimeLog: () => runtimeLog }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await Promise.resolve()
    monotonicNow = 20_000
    await vi.advanceTimersByTimeAsync(20_000)

    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
    expect(electronMock.app.exit).not.toHaveBeenCalled()
    expect(initializeDiagnostics).not.toHaveBeenCalled()

    monotonicNow = 20_001
    electronMock.app.isReady.mockReturnValue(true)
    resolveReady()
    await vi.advanceTimersByTimeAsync(0)

    expectStartupFailureWindow(
      electronMock,
      expect.stringMatching(/could not open its operational data safely/iu),
    )
    expect(initializeDiagnostics).toHaveBeenCalledOnce()
    expect(startupProcessExit).toHaveBeenCalledWith(1)
  })

  it('starts independent diagnostics and crash-state reads in parallel', async () => {
    vi.useFakeTimers()
    let releaseDiagnostics: (() => void) | undefined
    const diagnosticsInitialization = new Promise<void>((resolve) => {
      releaseDiagnostics = resolve
    })
    const startupError = new Error('stop after startup state inspection')
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      markSessionStart: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    }
    const runtimeLog = { append: vi.fn(async () => undefined) }
    const initializeDiagnostics = vi.fn(() => diagnosticsInitialization)
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './crash-log.cjs') return { createCrashLog: () => crashLog }
      if (request === './runtime-log.cjs') return { createRuntimeLog: () => runtimeLog }
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({ initialize: initializeDiagnostics }) }
      }
      if (request === './mission-store.cjs') {
        return { createElectronMissionStore: vi.fn(() => { throw startupError }) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.advanceTimersByTimeAsync(0)

    expect(initializeDiagnostics).toHaveBeenCalledOnce()
    expect(crashLog.hadUncleanShutdown).toHaveBeenCalledOnce()
    releaseDiagnostics?.()
    await vi.advanceTimersByTimeAsync(0)
    expectStartupFailureWindow(
      electronMock,
      expect.stringMatching(/could not open its operational data safely/iu),
    )
  })

  it('attributes a synchronous SQLite store constructor that returns after the shared deadline', async () => {
    vi.useFakeTimers()
    let monotonicNow = 0
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow)
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      markSessionStart: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    }
    const runtimeLog = { append: vi.fn(async () => undefined) }
    const missionStoreFactory = vi.fn(() => {
      monotonicNow = 10_001
      return {
        info: vi.fn(async () => ({ schema_version: 1 })),
        getActiveMission: vi.fn(async () => null),
      }
    })
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './crash-log.cjs') return { createCrashLog: () => crashLog }
      if (request === './runtime-log.cjs') return { createRuntimeLog: () => runtimeLog }
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({
          initialize: vi.fn(async () => undefined),
          recordRestart: vi.fn(async () => undefined),
        }) }
      }
      if (request === './mission-store.cjs') {
        return { createElectronMissionStore: missionStoreFactory }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.advanceTimersByTimeAsync(0)

    expect(missionStoreFactory).toHaveBeenCalledOnce()
    expectStartupFailureWindow(
      electronMock,
      expect.stringMatching(/mission store open and migration.*10 seconds/iu),
    )
    expect(startupProcessExit).toHaveBeenCalledWith(1)
  })

  it('applies the same watchdog to a later active-mission read', async () => {
    vi.useFakeTimers()
    let monotonicNow = 0
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow)
    const held = new Promise<never>(() => {})
    const initializeDiagnostics = vi.fn(async () => undefined)
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      markSessionStart: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    }
    const runtimeLog = { append: vi.fn(async () => undefined) }
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    const createCrashLog = vi.fn(() => crashLog)
    const createRuntimeLog = vi.fn(() => runtimeLog)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './runtime-log.cjs') return { createRuntimeLog }
      if (request === './crash-log.cjs') return { createCrashLog }
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({ initialize: initializeDiagnostics }) }
      }
      if (request === './mission-store.cjs') {
        return { createElectronMissionStore: () => ({
          info: vi.fn(async () => ({ schema_version: 1 })),
          getActiveMission: vi.fn(() => held),
        }) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.advanceTimersByTimeAsync(0)
    monotonicNow = 10_000
    await vi.advanceTimersByTimeAsync(10_000)

    expect(initializeDiagnostics).toHaveBeenCalledOnce()
    expectStartupFailureWindow(
      electronMock,
      expect.stringMatching(/active mission lookup.*10 seconds/iu),
    )
    await Promise.resolve()
    expect(startupProcessExit).toHaveBeenCalledWith(1)
    expect(createCrashLog).toHaveBeenCalledTimes(1)
    expect(createRuntimeLog).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['operational window content load', 'load'],
    ['operational renderer availability fence', 'fence'],
    // DON-354: the page loads but its script never mounts the first screen.
    ['map screen start', 'mount'],
  ] as const)('keeps the operational window hidden when %s times out', async (heldStage, heldStep) => {
    const holdLoad = heldStep === 'load'
    vi.useFakeTimers()
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    const held = new Promise<never>(() => {})
    const electronMock = createElectronMock(
      vi.fn(), undefined, true, [], holdLoad ? () => held : undefined,
      undefined, undefined, heldStep !== 'mount',
    )
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      markSessionStart: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    }
    const runtimeLog = { append: vi.fn(async () => undefined) }
    const storageDiagnostics = {
      initialize: vi.fn(async () => undefined),
      configurePolling: vi.fn(async () => undefined),
      configureStore: vi.fn(async () => undefined),
      recordRestart: vi.fn(async () => undefined),
      readSupportSnapshot: vi.fn(async () => ({})),
    }
    const missionStore = new Proxy({
      info: vi.fn(async () => ({ schema_version: 1 })),
      getActiveMission: vi.fn(async () => null),
    }, {
      get(target, property) {
        if (property === 'then') return undefined
        if (property in target) return target[property as keyof typeof target]
        return vi.fn(async () => undefined)
      },
    })
    const proxyFactory = () => new Proxy({}, {
      get(_target, property) {
        if (property === 'then') return undefined
        return vi.fn(async () => undefined)
      },
    })
    const settingsStore = {
      loadRuntimeBootstrapSettings: vi.fn(async () => ({ trackingPollIntervalMs: 10_000 })),
      loadAppSettings: vi.fn(async () => ({ missionDefaults: { adminRoster: [] } })),
    }
    const rendererTeardownCoordinator = {
      markRendererUnavailable: vi.fn(async () => undefined),
      markRendererAvailable: heldStep === 'fence' ? vi.fn(() => held) : vi.fn(async () => undefined),
      prepare: vi.fn(async () => undefined),
      ensureUnexpectedRendererLossFenced: vi.fn(async () => undefined),
      dispose: vi.fn(),
    }
    const archiveReviewSessionManager = {
      sweepStartup: vi.fn(async () => undefined),
      closeForSender: vi.fn(async () => undefined),
      hasReviewActivity: vi.fn(() => false),
      open: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      read: vi.fn(async () => undefined),
      recordMutationDenied: vi.fn(async () => undefined),
      acquireCleanupLease: vi.fn(async () => ({ release: vi.fn() })),
      beginCorrectionSnapshotUse: vi.fn(async () => ({ release: vi.fn() })),
      completeCorrectionSnapshot: vi.fn(async () => undefined),
      prepareClose: vi.fn(async () => undefined),
      dispose: vi.fn(),
    }
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './startup-watchdog.cjs') return originalLoad(request, parent, isMain)
      if (request === './runtime-log.cjs') return { createRuntimeLog: () => runtimeLog }
      if (request === './crash-log.cjs') {
        return { createCrashLog: () => crashLog, isRendererFaultReason: () => false }
      }
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => storageDiagnostics }
      }
      if (request === './settings-store.cjs') {
        return { createElectronSettingsStore: () => settingsStore }
      }
      if (request === './mission-store.cjs') {
        return { createElectronMissionStore: () => missionStore }
      }
      if (request === './renderer-teardown-coordinator.cjs') {
        return { createRendererTeardownCoordinator: () => rendererTeardownCoordinator }
      }
      if (request === './runtime-files.cjs') {
        return { createElectronRuntimeFiles: proxyFactory }
      }
      if (request === './file-system.cjs') {
        return { createElectronFileSystem: proxyFactory }
      }
      if (request === './archive-review-sessions.cjs') {
        return { createArchiveReviewSessionManager: () => archiveReviewSessionManager }
      }
      if (request === './archive-cleanup-startup.cjs') {
        return { startInterruptedMissionCleanupRecovery: async () => ({ completion: Promise.resolve() }) }
      }
      if (request === './official-map-proxy.cjs') {
        return { createElectronOfficialMapProxy: proxyFactory }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await vi.advanceTimersByTimeAsync(0)
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledOnce())
    expect(electronMock.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({ show: false }),
    )
    await vi.advanceTimersByTimeAsync(10_000)

    expectStartupFailureWindow(
      electronMock,
      heldStep === 'mount'
        ? expect.stringMatching(/map screen did not start within 10 seconds.*Reinstall SAR Tracker/su)
        : expect.stringMatching(new RegExp(`${heldStage}.*10 seconds`, 'iu')),
    )
    expect(startupProcessExit).toHaveBeenCalledWith(1)
    expect(electronMock.BrowserWindow.mock.results[0]?.value.show).not.toHaveBeenCalled()
  })

  it('keeps the C01 response deadline bounded when the wall clock moves backwards', async () => {
    vi.useFakeTimers()
    let wallClockMovedBackwards = false
    let monotonicNow = 0
    const originalDateNow = Date.now.bind(Date)
    vi.spyOn(Date, 'now').mockImplementation(() =>
      originalDateNow() - (wallClockMovedBackwards ? 60_000 : 0),
    )
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow)
    const held = new Promise<never>(() => {})
    const crashLog = {
      hadUncleanShutdown: vi.fn(() => held),
      record: vi.fn(async () => undefined),
    }
    const runtimeLog = { append: vi.fn(async () => undefined) }
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({
          initialize: () => new Promise((resolve) => setTimeout(() => {
            monotonicNow = 2_500
            wallClockMovedBackwards = true
            resolve(undefined)
          }, 2_500)),
        }) }
      }
      if (request === './crash-log.cjs') return { createCrashLog: () => crashLog }
      if (request === './runtime-log.cjs') return { createRuntimeLog: () => runtimeLog }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(2_500)
    expect(crashLog.hadUncleanShutdown).toHaveBeenCalledOnce()
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
    monotonicNow = 10_000
    await vi.advanceTimersByTimeAsync(7_500)

    expectStartupFailureWindow(
      electronMock,
      expect.stringMatching(/previous crash-state inspection.*10 seconds/iu),
    )
    expect(runtimeLog.append).toHaveBeenCalledWith(expect.objectContaining({
      event: 'startup_failure',
      fields: expect.objectContaining({
        stage: 'previous crash-state inspection',
        timeoutMs: 10_000,
      }),
    }))
    expect(startupProcessExit).toHaveBeenCalledWith(1)
  })

  it('shows the C01 startup fault before blocked crash and runtime log writes settle', async () => {
    vi.useFakeTimers()
    let releaseHeld: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve
    })
    const crashLog = {
      hadUncleanShutdown: vi.fn(() => held),
      record: vi.fn(() => held),
    }
    const runtimeLog = { append: vi.fn(() => held) }
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({ initialize: vi.fn(async () => undefined) }) }
      }
      if (request === './crash-log.cjs') return { createCrashLog: () => crashLog }
      if (request === './runtime-log.cjs') return { createRuntimeLog: () => runtimeLog }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(crashLog.hadUncleanShutdown).toHaveBeenCalledOnce()
    expect(crashLog.record).toHaveBeenCalledOnce()
    expect(runtimeLog.append).toHaveBeenCalled()
    expectStartupFailureWindow(
      electronMock,
      expect.stringMatching(/previous crash-state inspection.*10 seconds/iu),
    )
    await vi.advanceTimersByTimeAsync(300)
    expect(startupProcessExit).not.toHaveBeenCalled()
    releaseHeld?.()
    await vi.waitFor(() => expect(startupProcessExit).toHaveBeenCalledWith(1))
  })

  it('exits after the bounded wait when startup failure evidence writes stay held', async () => {
    vi.useFakeTimers()
    const held = new Promise<void>(() => {})
    const startupError = new Error('SQLITE_BUSY: mission store startup lock is held.')
    const crashLog = {
      hadUncleanShutdown: vi.fn(async () => false),
      markSessionStart: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    }
    const runtimeLog = { append: vi.fn(() => held) }
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './storage-diagnostics.cjs') {
        return { createStorageDiagnostics: () => ({ initialize: vi.fn(async () => undefined) }) }
      }
      if (request === './crash-log.cjs') return { createCrashLog: () => crashLog }
      if (request === './runtime-log.cjs') return { createRuntimeLog: () => runtimeLog }
      if (request === './mission-store.cjs') {
        return { createElectronMissionStore: vi.fn(() => { throw startupError }) }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(9_999)

    expectStartupFailureWindow(
      electronMock,
      expect.stringMatching(/preserve the profile and contact support/iu),
    )
    expect(crashLog.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'startupFailure',
      summary: expect.stringContaining(startupError.message),
    }))
    expect(electronMock.app.exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(startupProcessExit).toHaveBeenCalledWith(1)
    expect(electronMock.app.exit).not.toHaveBeenCalled()
  })

  it('identifies non-regular startup evidence without claiming mission data is corrupt', async () => {
    const startupError = Object.assign(
      new Error('Startup storage evidence path is not a regular file.'),
      { code: 'ERR_SARTRACKER_NON_REGULAR_FILE' },
    )
    const runtimeLog = { append: vi.fn(async () => undefined) }
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './mission-store.cjs') {
        return { createElectronMissionStore: vi.fn(() => { throw startupError }) }
      }
      if (request === './runtime-log.cjs') {
        return { ...originalLoad(request, parent, isMain), createRuntimeLog: () => runtimeLog }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')

    await vi.waitFor(() => {
      expectStartupFailureWindow(
        electronMock,
        expect.stringMatching(/startup evidence file safely.*No mission-data corruption was confirmed/iu),
      )
      expect(runtimeLog.append).toHaveBeenCalledWith(expect.objectContaining({
        event: 'startup_failure',
        fields: expect.objectContaining({ code: 'ERR_SARTRACKER_NON_REGULAR_FILE' }),
      }))
      expect(startupProcessExit).toHaveBeenCalledWith(1)
    })
  })

  it('keeps utility-process bootstrap failure visible without main-process crash-log I/O', async () => {
    Object.defineProperty(process.versions, 'electron', {
      configurable: true,
      value: '40.0.0',
    })
    const electronMock = createElectronMock(vi.fn(), undefined, true)
    electronMock.utilityProcess.fork.mockImplementation(() => {
      throw new Error('could not start utility process')
    })
    const createCrashLog = vi.fn(() => { throw new Error('main-process crash log must not be opened') })
    Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
      if (request === 'electron') return electronMock
      if (request === './crash-log.cjs') {
        return { createCrashLog, isRendererFaultReason: vi.fn() }
      }
      return originalLoad(request, parent, isMain)
    }) as typeof Module._load

    require('../../electron/main.cjs')

    await vi.waitFor(() => {
      expectStartupFailureWindow(
        electronMock,
        expect.stringMatching(/could not safely initialize its isolated startup evidence writer.*No mission-data corruption was confirmed/iu),
      )
      expect(electronMock.app.exit).toHaveBeenCalledWith(1)
    })
    expect(createCrashLog).not.toHaveBeenCalled()
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
      expectStartupFailureWindow(
        electronMock,
        'SAR Tracker could not open its operational data safely. Preserve the profile and contact support before retrying. The application will now close.',
      )
      expect(startupProcessExit).toHaveBeenCalledWith(1)
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
    // The refusal schedules its diagnostic asynchronously. Observe that write
    // before teardown removes the profile that owns it.
    await vi.waitFor(() => {
      expect(readFileSync(path.join(testUserDataPath, 'logs', 'runtime.log'), 'utf8'))
        .toContain('renderer_restore_blocked')
    })
  })

  describe('renderer crash recovery [M-45]', () => {
    /** Loads main with in-memory logs and returns the first window's crash handler. */
    async function loadWithRendererCrash(
      platform: NodeJS.Platform,
      sessionManager?: ReturnType<typeof archiveReviewSessionManagerStub>,
    ) {
      Object.defineProperty(process, 'platform', { value: platform })
      const processOn = vi.spyOn(process, 'on')
      const electronMock = createElectronMock(vi.fn(), undefined, true)
      const logs = createInMemoryStartupLogs()
      const coordinator = rendererTeardownCoordinatorStub()
      Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
        if (request === 'electron') return electronMock
        if (request === './crash-log.cjs') {
          return { ...originalLoad(request, parent, isMain), createCrashLog: () => logs.crashLog }
        }
        if (request === './runtime-log.cjs') {
          return { ...originalLoad(request, parent, isMain), createRuntimeLog: () => logs.runtimeLog }
        }
        if (request === './renderer-teardown-coordinator.cjs') {
          return { createRendererTeardownCoordinator: () => coordinator }
        }
        if (sessionManager !== undefined && request === './archive-review-sessions.cjs') {
          return { createArchiveReviewSessionManager: vi.fn(() => sessionManager) }
        }
        if (sessionManager !== undefined && request === './archive-review-ipc.cjs') {
          return { registerArchiveReviewIpcHandlers: vi.fn() }
        }
        return originalLoad(request, parent, isMain)
      }) as typeof Module._load
      require('../../electron/main.cjs')
      await vi.waitFor(() => {
        expect(electronMock.app.on).toHaveBeenCalledWith('before-quit', expect.any(Function))
      })
      const handlerFor = (eventName: string) => electronMock.app.on.mock.calls.find(
        ([name]) => name === eventName,
      )?.[1]
      const crashWindow = (index: number) => {
        const window = electronMock.BrowserWindow.mock.results[index]?.value
        return window.webContents.on.mock.calls.find(
          ([eventName]: [string]) => eventName === 'render-process-gone',
        )?.[1] as (event: unknown, details: { reason: string, exitCode: number }) => void
      }
      electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
      return { electronMock, logs, coordinator, handlerFor, crashWindow, processOn }
    }

    /** A promise the test settles by hand, to hold a recovery step open. */
    function deferred() {
      let resolve: () => void = () => undefined
      const promise = new Promise<void>((settle) => { resolve = settle })
      return { promise, resolve }
    }

    /** Counts the "map window reopened" notices shown so far. */
    function reopenNotices(electronMock: ReturnType<typeof createElectronMock>) {
      return electronMock.dialog.showMessageBox.mock.calls.filter(
        (args: Array<{ title?: string }>) => args.some((arg) => arg?.title === 'SAR Tracker map window reopened'),
      ).length
    }

    it('does not reopen the window when a quit starts while recovery waits on its fences [DON-359]', async () => {
      const { electronMock, logs, coordinator, handlerFor, crashWindow } =
        await loadWithRendererCrash('linux')
      const fence = deferred()
      coordinator.ensureUnexpectedRendererLossFenced.mockImplementation(() => fence.promise)

      crashWindow(0)({}, { reason: 'crashed', exitCode: 11 })
      await vi.waitFor(() => expect(coordinator.ensureUnexpectedRendererLossFenced).toHaveBeenCalled())
      handlerFor('before-quit')({ preventDefault: vi.fn() })
      fence.resolve()

      await vi.waitFor(() => expect(electronMock.app.exit).toHaveBeenCalledWith(0))
      await new Promise((settle) => setTimeout(settle, 20))
      expect(electronMock.BrowserWindow).toHaveBeenCalledOnce()
      expect(reopenNotices(electronMock)).toBe(0)
      expect(logs.runtimeLog.append).toHaveBeenCalledWith(expect.objectContaining({
        event: 'renderer_window_recovery_cancelled',
      }))
    })

    it('does not reopen the window when a fatal fault starts while recovery waits [DON-359]', async () => {
      const { electronMock, coordinator, crashWindow, processOn } =
        await loadWithRendererCrash('linux')
      const fence = deferred()
      coordinator.ensureUnexpectedRendererLossFenced.mockImplementation(() => fence.promise)

      crashWindow(0)({}, { reason: 'crashed', exitCode: 11 })
      await vi.waitFor(() => expect(coordinator.ensureUnexpectedRendererLossFenced).toHaveBeenCalled())
      const fatal = await findFatalHandler(processOn, 'uncaughtException')
      fatal(new Error('fatal during recovery'))
      fence.resolve()

      await vi.waitFor(() => expect(electronMock.app.exit).toHaveBeenCalledWith(1))
      await new Promise((settle) => setTimeout(settle, 20))
      expect(electronMock.BrowserWindow).toHaveBeenCalledOnce()
      expect(reopenNotices(electronMock)).toBe(0)
    })

    it('restores again when the replacement crashes before it is ready, with one notice [DON-359]', async () => {
      const { electronMock, logs, coordinator, crashWindow } = await loadWithRendererCrash('linux')
      const firstReplacementReady = deferred()
      coordinator.markRendererAvailable
        .mockImplementationOnce(() => firstReplacementReady.promise)

      crashWindow(0)({}, { reason: 'crashed', exitCode: 11 })
      await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(coordinator.markRendererAvailable).toHaveBeenCalled())
      crashWindow(1)({}, { reason: 'oom', exitCode: 137 })
      firstReplacementReady.resolve()

      await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(3))
      await vi.waitFor(() => expect(reopenNotices(electronMock)).toBe(1))
      await new Promise((settle) => setTimeout(settle, 20))
      expect(reopenNotices(electronMock)).toBe(1)
      const windows = electronMock.BrowserWindow.mock.results.map((result) => result.value)
      expect(windows.filter((window) => !window.isDestroyed())).toHaveLength(1)
      expect(windows[2].isDestroyed()).toBe(false)
      expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
      expect(logs.runtimeLog.append).toHaveBeenCalledWith(expect.objectContaining({
        event: 'renderer_window_recovery_superseded',
      }))
    })

    it('keeps a newer crash\'s archive cleanup fence when an older restore finishes [DON-359]', async () => {
      const secondSenderCleanup = deferred()
      const sessionManager = {
        ...archiveReviewSessionManagerStub(),
        closeForSender: vi.fn((senderId: number) =>
          (senderId === 2 ? secondSenderCleanup.promise : Promise.resolve())),
      }
      const { electronMock, coordinator, crashWindow } = await loadWithRendererCrash('linux', sessionManager)
      const firstReplacementReady = deferred()
      coordinator.markRendererAvailable
        .mockImplementationOnce(() => firstReplacementReady.promise)
      await vi.waitFor(() => expect(crashWindow(0)).toBeTypeOf('function'))

      crashWindow(0)({}, { reason: 'crashed', exitCode: 11 })
      await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(2))
      // Each window has its own renderer, so its archive plaintext has its own sender.
      electronMock.BrowserWindow.mock.results[1]!.value.webContents.id = 2
      await vi.waitFor(() => expect(coordinator.markRendererAvailable).toHaveBeenCalled())
      crashWindow(1)({}, { reason: 'oom', exitCode: 137 })
      expect(sessionManager.closeForSender).toHaveBeenCalledWith(2)
      firstReplacementReady.resolve()

      await new Promise((settle) => setTimeout(settle, 50))
      // The second sender's plaintext is not swept yet: no window may open.
      expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(2)
      expect(reopenNotices(electronMock)).toBe(0)

      secondSenderCleanup.resolve()
      await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(3))
      await vi.waitFor(() => expect(reopenNotices(electronMock)).toBe(1))
    })

    it('reopens the map window on Linux with a notice instead of quitting silently', async () => {
      const { electronMock, logs, coordinator, handlerFor, crashWindow } =
        await loadWithRendererCrash('linux')

      crashWindow(0)({}, { reason: 'oom', exitCode: 137 })
      handlerFor('window-all-closed')()

      expect(electronMock.app.quit).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(2))
      expect(coordinator.ensureUnexpectedRendererLossFenced).toHaveBeenCalled()
      await vi.waitFor(() => expect(electronMock.dialog.showMessageBox).toHaveBeenCalledWith(
        electronMock.BrowserWindow.mock.results[1]?.value,
        expect.objectContaining({
          type: 'warning',
          message: expect.stringContaining('ran out of memory'),
          detail: expect.stringContaining('check that tracking is live'),
        }),
      ))
      expect(logs.runtimeLog.append).toHaveBeenCalledWith(expect.objectContaining({
        event: 'renderer_window_recovered',
        fields: expect.objectContaining({ reason: 'oom' }),
      }))
    })

    it('never records a renderer-crash session as a clean exit, even after recovery', async () => {
      const { electronMock, logs, handlerFor, crashWindow } = await loadWithRendererCrash('linux')

      crashWindow(0)({}, { reason: 'crashed', exitCode: 11 })
      await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(2))
      handlerFor('before-quit')({ preventDefault: vi.fn() })

      await vi.waitFor(() => expect(electronMock.app.exit).toHaveBeenCalledWith(0))
      expect(logs.crashLog.markCleanExit).not.toHaveBeenCalled()
    })

    it('does not reopen a window when the crash happens during an app quit', async () => {
      const { electronMock, logs, handlerFor, crashWindow } = await loadWithRendererCrash('linux')

      handlerFor('before-quit')({ preventDefault: vi.fn() })
      crashWindow(0)({}, { reason: 'crashed', exitCode: 11 })

      await vi.waitFor(() => expect(electronMock.app.exit).toHaveBeenCalledWith(0))
      expect(electronMock.BrowserWindow).toHaveBeenCalledOnce()
      expect(logs.crashLog.markCleanExit).not.toHaveBeenCalled()
    })

    it('stops reopening after repeated crashes and says so before closing', async () => {
      const { electronMock, logs, crashWindow } = await loadWithRendererCrash('linux')

      for (let attempt = 0; attempt < 3; attempt += 1) {
        crashWindow(attempt)({}, { reason: 'crashed', exitCode: 11 })
        await vi.waitFor(() =>
          expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(attempt + 2))
      }
      crashWindow(3)({}, { reason: 'crashed', exitCode: 11 })

      await vi.waitFor(() => expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
        'SAR Tracker map window keeps crashing',
        expect.stringContaining('Start SAR Tracker again'),
      ))
      expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(4)
      await vi.waitFor(() => expect(electronMock.app.quit).toHaveBeenCalled())
      expect(logs.runtimeLog.append).toHaveBeenCalledWith(expect.objectContaining({
        event: 'renderer_window_recovery_limit_reached',
      }))
    })

    it('also reopens the window on macOS without waiting for a dock click', async () => {
      const { electronMock, crashWindow } = await loadWithRendererCrash('darwin')

      crashWindow(0)({}, { reason: 'killed', exitCode: 9 })

      await vi.waitFor(() => expect(electronMock.BrowserWindow).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(electronMock.dialog.showMessageBox).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: expect.stringContaining('was stopped') }),
      ))
    })
  })

  describe('fatal fault relaunch target [M-46]', () => {
    afterEach(() => {
      delete process.env.APPIMAGE
    })

    /** Triggers the fatal handler and waits for the exit decision. */
    async function triggerFatal() {
      const processOn = vi.spyOn(process, 'on').mockImplementation(() => process)
      const electronMock = createElectronMock(vi.fn(), undefined, true)
      Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
        if (request === 'electron') return electronMock
        return originalLoad(request, parent, isMain)
      }) as typeof Module._load
      require('../../electron/main.cjs')
      const handler = await findFatalHandler(processOn, 'uncaughtException')
      handler(new Error('fatal'))
      await vi.waitFor(() => expect(electronMock.app.exit).toHaveBeenCalledWith(1))
      return electronMock
    }

    it('relaunches the AppImage file itself after a fatal fault', async () => {
      process.env.APPIMAGE = '/home/team/SAR-Tracker.AppImage'

      const electronMock = await triggerFatal()

      expect(electronMock.app.relaunch).toHaveBeenCalledWith({
        execPath: '/home/team/SAR-Tracker.AppImage',
        args: process.argv.slice(1),
      })
    })

    it('writes the relaunch decision to the runtime log before exiting [DON-359]', async () => {
      const processOn = vi.spyOn(process, 'on').mockImplementation(() => process)
      const electronMock = createElectronMock(vi.fn(), undefined, true)
      const logs = createInMemoryStartupLogs()
      const order: string[] = []
      logs.runtimeLog.append.mockImplementation(async (entry: { event: string }) => {
        await Promise.resolve()
        order.push(entry.event)
      })
      electronMock.app.exit.mockImplementation(() => { order.push('exit') })
      Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
        if (request === 'electron') return electronMock
        if (request === './runtime-log.cjs') {
          return { ...originalLoad(request, parent, isMain), createRuntimeLog: () => logs.runtimeLog }
        }
        return originalLoad(request, parent, isMain)
      }) as typeof Module._load
      require('../../electron/main.cjs')
      const handler = await findFatalHandler(processOn, 'uncaughtException')
      handler(new Error('fatal'))
      await vi.waitFor(() => expect(order).toContain('exit'))

      expect(order.indexOf('fatal_relaunch_requested')).toBeGreaterThanOrEqual(0)
      expect(order.indexOf('fatal_relaunch_requested')).toBeLessThan(order.indexOf('exit'))
    })

    it('relaunches the current executable when not running from an AppImage', async () => {
      delete process.env.APPIMAGE

      const electronMock = await triggerFatal()

      expect(electronMock.app.relaunch).toHaveBeenCalledWith()
    })
  })

  describe('hung renderer escalation [M-48]', () => {
    /** Loads main and returns the escalation hook it gave the teardown coordinator. */
    async function loadWithCapturedEscalation(response: number) {
      const electronMock = createElectronMock(vi.fn(), undefined, true)
      electronMock.dialog.showMessageBox.mockResolvedValue({ response })
      const logs = createInMemoryStartupLogs()
      let dependencies: { onDrainOverdue?: (input: unknown) => Promise<string> } | undefined
      Module._load = ((request: string, parent: NodeJS.Module | null, isMain: boolean) => {
        if (request === 'electron') return electronMock
        if (request === './crash-log.cjs') {
          return { ...originalLoad(request, parent, isMain), createCrashLog: () => logs.crashLog }
        }
        if (request === './runtime-log.cjs') {
          return { ...originalLoad(request, parent, isMain), createRuntimeLog: () => logs.runtimeLog }
        }
        if (request === './renderer-teardown-coordinator.cjs') {
          return {
            createRendererTeardownCoordinator: (input: typeof dependencies) => {
              dependencies = input
              return rendererTeardownCoordinatorStub()
            },
          }
        }
        return originalLoad(request, parent, isMain)
      }) as typeof Module._load
      require('../../electron/main.cjs')
      await vi.waitFor(() => expect(dependencies?.onDrainOverdue).toEqual(expect.any(Function)))
      return { electronMock, logs, onDrainOverdue: dependencies!.onDrainOverdue! }
    }

    it('asks the operator to wait or close now, attached to the map window, and closes now on request', async () => {
      const { electronMock, logs, onDrainOverdue } = await loadWithCapturedEscalation(1)
      const signal = new AbortController().signal
      const owner = { isDestroyed: () => false }
      const webContents = {}
      electronMock.BrowserWindow.fromWebContents.mockImplementation(
        (contents: unknown) => (contents === webContents ? owner : null),
      )

      await expect(onDrainOverdue({ requestId: 'r1', reason: 'app_quit', webContents, signal }))
        .resolves.toBe('abandon')

      // A parent window makes the macOS dialog asynchronous, so the signal can close it [DON-361].
      expect(electronMock.dialog.showMessageBox).toHaveBeenCalledWith(owner, expect.objectContaining({
        type: 'warning',
        title: 'SAR Tracker is not responding',
        buttons: ['Wait', 'Close now'],
        defaultId: 0,
        cancelId: 0,
        signal,
        detail: expect.stringContaining('possibly missing'),
      }))
      await vi.waitFor(() => {
        expect(logs.runtimeLog.append).toHaveBeenCalledWith(expect.objectContaining({
          event: 'renderer_drain_overdue',
          fields: expect.objectContaining({ reason: 'app_quit' }),
        }))
        expect(logs.runtimeLog.append).toHaveBeenCalledWith(expect.objectContaining({
          event: 'renderer_drain_abandoned',
        }))
      })
    })

    it('offers Reload now, not Close now, when a reload is waiting [DON-361]', async () => {
      const { electronMock, onDrainOverdue } = await loadWithCapturedEscalation(1)

      await expect(onDrainOverdue({
        requestId: 'r1', reason: 'renderer_reload', webContents: {}, signal: new AbortController().signal,
      })).resolves.toBe('abandon')

      const options = electronMock.dialog.showMessageBox.mock.calls.at(-1)?.at(-1) as {
        message: string, detail: string, buttons: string[]
      }
      expect(options.buttons).toEqual(['Wait', 'Reload now'])
      expect(options.message).toContain('cannot reload yet')
      expect(`${options.message} ${options.detail}`).not.toMatch(/close/iu)
    })

    it('logs a failed question and shows a fallback once, while still blocking the close [DON-361]', async () => {
      const { electronMock, logs, onDrainOverdue } = await loadWithCapturedEscalation(0)
      electronMock.dialog.showMessageBox.mockRejectedValue(new TypeError('dialog unavailable'))
      const input = { requestId: 'r1', reason: 'window_close', webContents: {}, signal: new AbortController().signal }

      await expect(onDrainOverdue(input)).resolves.toBe('wait')
      await expect(onDrainOverdue(input)).resolves.toBe('wait')

      expect(electronMock.dialog.showErrorBox).toHaveBeenCalledOnce()
      expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
        'SAR Tracker is not responding',
        expect.stringContaining('possibly missing'),
      )
      await vi.waitFor(() => expect(logs.runtimeLog.append).toHaveBeenCalledWith(expect.objectContaining({
        level: 'error',
        event: 'renderer_drain_escalation_failed',
        fields: expect.objectContaining({ requestId: 'r1', name: 'TypeError' }),
      })))
    })

    it('keeps waiting when the operator chooses Wait', async () => {
      const { onDrainOverdue } = await loadWithCapturedEscalation(0)

      await expect(onDrainOverdue({
        requestId: 'r1', reason: 'window_close', webContents: {}, signal: new AbortController().signal,
      })).resolves.toBe('wait')
    })

    it('records when the map window stops and starts responding', async () => {
      const { electronMock, logs } = await loadWithCapturedEscalation(0)
      const window = electronMock.BrowserWindow.mock.results[0]?.value
      const handlerFor = (eventName: string) => window.on.mock.calls.find(
        ([name]: [string]) => name === eventName,
      )?.[1] as () => void

      handlerFor('unresponsive')()
      handlerFor('responsive')()

      await vi.waitFor(() => {
        expect(logs.runtimeLog.append).toHaveBeenCalledWith(expect.objectContaining({
          level: 'warn', event: 'renderer_unresponsive',
        }))
        expect(logs.runtimeLog.append).toHaveBeenCalledWith(expect.objectContaining({
          event: 'renderer_responsive',
        }))
      })
    })
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
    beginCorrectionSnapshotUse: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(),
    closeForSender: vi.fn(async () => undefined),
    completeCorrectionSnapshot: vi.fn(),
    open: vi.fn(),
    hasReviewActivity: vi.fn(() => false),
    prepareClose: vi.fn(),
    read: vi.fn(),
    sweepStartup: vi.fn(async () => undefined),
  }
}

/** Provides an immediately acknowledged renderer-teardown coordinator. */
/** Returns the main-process fatal handler registered for one process event. */
async function findFatalHandler(
  processOn: ReturnType<typeof vi.spyOn>,
  eventName: 'uncaughtException' | 'unhandledRejection',
): Promise<(error: unknown) => void> {
  let handler: ((error: unknown) => void) | undefined
  await vi.waitFor(() => {
    handler = processOn.mock.calls
      .filter(([name]: unknown[]) => name === eventName)
      .map(([, listener]: unknown[]) => listener)
      .find((listener: unknown) => String(listener).includes('handleFatalMainProcessError')) as
      | ((error: unknown) => void)
      | undefined
    expect(handler).toBeDefined()
  })
  return handler as (error: unknown) => void
}

function rendererTeardownCoordinatorStub() {
  return {
    prepare: vi.fn(async () => undefined),
    markRendererUnavailable: vi.fn(async () => undefined),
    markRendererAvailable: vi.fn(async () => undefined),
    ensureUnexpectedRendererLossFenced: vi.fn(async () => undefined),
    dispose: vi.fn(),
  }
}

/** Provides in-memory log adapters for renderer-fault cleanup tests. */
function createInMemoryStartupLogs() {
  return {
    crashLog: {
      hadUncleanShutdown: vi.fn(async () => false),
      markSessionStart: vi.fn(async () => undefined),
      markCleanExit: vi.fn(async () => undefined),
      readRecent: vi.fn(async () => []),
      record: vi.fn(async () => undefined),
    },
    runtimeLog: {
      append: vi.fn(async () => undefined),
      readRecent: vi.fn(async () => []),
    },
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
  windowLoadURL: () => Promise<unknown> = () => Promise.resolve(),
  windowShow: () => void = () => undefined,
  startupFailureWindowClosesOnShow = true,
  rendererMounts = true,
) {
  const BrowserWindow = vi.fn(function MockBrowserWindow(options: { title?: string } = {}) {
    let closeHandler: (() => void) | undefined
    let destroyed = false
    return {
      close: vi.fn(() => closeHandler?.()),
      destroy: vi.fn(() => { destroyed = true }),
      isDestroyed: vi.fn(() => destroyed),
      loadURL: vi.fn(() => options.title === 'SAR Tracker could not start'
        ? Promise.resolve()
        : windowLoadURL()),
      on: vi.fn(),
      once: vi.fn((eventName: string, handler: () => void) => {
        if (eventName === 'closed') closeHandler = handler
      }),
      show: vi.fn(() => {
        windowShow()
        if (options.title === 'SAR Tracker could not start' && startupFailureWindowClosesOnShow) {
          closeHandler?.()
        }
      }),
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
  BrowserWindow.fromWebContents = vi.fn(() => null)
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
      isReady: vi.fn(() => ready),
      on: vi.fn(),
      quit: vi.fn(),
      relaunch: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => true),
      setPath: vi.fn(),
      whenReady: vi.fn(() => (ready ? Promise.resolve() : new Promise<never>(() => {}))),
    },
    BrowserWindow,
    crashReporter: { start: vi.fn() },
    dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn(async () => ({ response: 0 })) },
    ipcMain: {
      handle: vi.fn(),
      // A healthy renderer confirms its first screen mounted [DON-354].
      on: vi.fn((channel: string, handler: (event: { sender: { id: number } }) => void) => {
        if (rendererMounts && channel === 'sartracker:renderer-mounted') {
          queueMicrotask(() => handler({ sender: { id: 1 } }))
        }
      }),
      removeListener: vi.fn(),
    },
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
    utilityProcess: {
      fork: vi.fn(),
    },
  }
}

/** Asserts the isolated operator window and its escaped startup message. */
function expectStartupFailureWindow(
  electronMock: ReturnType<typeof createElectronMock>,
  expectedMessage: unknown,
) {
  expect(electronMock.BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
    title: 'SAR Tracker could not start',
    show: false,
    resizable: false,
    webPreferences: expect.objectContaining({ contextIsolation: true, nodeIntegration: false, sandbox: true }),
  }))
  const failureWindow = electronMock.BrowserWindow.mock.results
    .map((result) => result.value)
    .find((window) => window.loadURL.mock.calls.some(([url]) => typeof url === 'string' && url.startsWith('data:text/html')))
  expect(failureWindow).toBeDefined()
  const pageUrl = failureWindow?.loadURL.mock.calls.find(
    ([url]) => typeof url === 'string' && url.startsWith('data:text/html'),
  )?.[0] as string
  const page = decodeURIComponent(pageUrl.slice(pageUrl.indexOf(',') + 1))
  const messageMatches = typeof expectedMessage === 'string'
    ? page.includes(expectedMessage)
    : expectedMessage !== null
      && typeof expectedMessage === 'object'
      && 'asymmetricMatch' in expectedMessage
      && typeof expectedMessage.asymmetricMatch === 'function'
      && expectedMessage.asymmetricMatch(page)
  expect(messageMatches).toBe(true)
}

/** Returns a distinct profile directory for each startup test invocation. */
function createTestUserDataPath() {
  testUserDataPathSequence += 1
  return path.join(
    os.tmpdir(),
    `sartracker-electron-main-startup-test-${process.pid}-${process.env.VITEST_WORKER_ID ?? '0'}-${testUserDataPathSequence}`,
  )
}
