import Module from 'node:module'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const originalLoad = Module._load
const originalPlatform = process.platform

describe('Electron main startup', () => {
  afterEach(() => {
    Module._load = originalLoad
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    })
    vi.restoreAllMocks()
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
})

function createElectronMock(appendSwitch: ReturnType<typeof vi.fn>) {
  return {
    app: {
      commandLine: { appendSwitch },
      getPath: vi.fn(() => path.join('/tmp', 'sartracker-user-data')),
      on: vi.fn(),
      quit: vi.fn(),
      setPath: vi.fn(),
      whenReady: vi.fn(() => new Promise<never>(() => {})),
    },
    BrowserWindow: vi.fn(),
    dialog: {},
    ipcMain: { handle: vi.fn() },
    safeStorage: {
      decryptString: vi.fn(),
      encryptString: vi.fn(),
      getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
      isEncryptionAvailable: vi.fn(() => true),
    },
    shell: {
      openExternal: vi.fn(),
      openPath: vi.fn(),
    },
  }
}
