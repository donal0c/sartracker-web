import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

type Handler = (event: unknown, ...args: unknown[]) => unknown
type Listing = { readonly paths: readonly string[]; readonly omittedCount: number }
type FileSystem = {
  readonly chooseGpxDirectoryPath: () => Promise<string | null>
  readonly listWatchedGpxDirectoryPaths: (directoryPath: string) => Promise<Listing>
  readonly assertWatchableGpxDirectory: (directoryPath: string) => void
  readonly restoreWatchedGpxDirectory: (directoryPath: string) => void
}

const { createElectronFileSystem } = require('../../electron/file-system.cjs') as {
  readonly createElectronFileSystem: (options: unknown) => FileSystem
}
const { createGpxWatchedFolderStore } = require('../../electron/gpx-watched-folder-store.cjs') as {
  readonly createGpxWatchedFolderStore: (options: { readonly userDataPath: string }) => unknown
}
const { registerGpxWatchedFolderHandlers } = require('../../electron/gpx-watched-folder-ipc.cjs') as {
  readonly registerGpxWatchedFolderHandlers: (options: unknown) => void
}

type Bridge = {
  readonly chooseGpxDirectoryPath: () => Promise<string | null>
  readonly loadWatchedGpxFolders: (missionId: string) => Promise<{ readonly paths: readonly string[] }>
  readonly saveWatchedGpxFolders: (input: unknown) => Promise<{ readonly paths: readonly string[] }>
}

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

/**
 * Starts one "app run": a fresh main-process file system, store and handlers on
 * the same profile, reached through the real sandboxed preload.
 */
function startAppRun(userDataPath: string, chosenDirectory: string | null) {
  const handlers = new Map<string, Handler>()
  const fileSystem = createElectronFileSystem({
    userDataPath,
    dialog: { showOpenDialog: async () => ({ canceled: chosenDirectory === null, filePaths: chosenDirectory === null ? [] : [chosenDirectory] }) },
    shell: {},
    getBrowserWindow: () => null,
  })
  handlers.set('sartracker:choose-gpx-directory-path', () => fileSystem.chooseGpxDirectoryPath())
  registerGpxWatchedFolderHandlers({
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
    validateIpcSender: () => undefined,
    watchedFolderStore: createGpxWatchedFolderStore({ userDataPath }),
    fileSystem,
  })
  let bridge: Bridge | undefined
  runInNewContext(readFileSync('electron/preload.cjs', 'utf8'), {
    process: { platform: 'linux' },
    TextEncoder,
    require: (specifier: string) => {
      if (specifier !== 'electron') throw new Error(`Sandboxed preload cannot require ${specifier}.`)
      return {
        contextBridge: { exposeInMainWorld: (_name: string, exposed: Bridge) => { bridge = exposed } },
        ipcRenderer: {
          invoke: async (channel: string, ...args: unknown[]) => {
            const handler = handlers.get(channel)
            if (handler === undefined) throw new Error(`No handler for ${channel}`)
            // Electron structured-clones IPC arguments.
            return await handler({}, ...args.map((arg) => structuredClone(arg)))
          },
          on: () => undefined,
          removeListener: () => undefined,
          send: () => undefined,
        },
      }
    },
    window: { addEventListener: () => undefined },
  })
  if (bridge === undefined) throw new Error('Preload did not expose a bridge.')
  return { bridge, fileSystem }
}

describe('watched GPX folders through IPC across a restart [DON-337]', () => {
  it('saves a chosen folder, and after a restart re-allows it so new files can be listed', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-watch-profile-'))
    const dropDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-watch-drop-'))
    directories.push(userDataPath, dropDirectory)

    const firstRun = startAppRun(userDataPath, dropDirectory)
    await expect(firstRun.bridge.chooseGpxDirectoryPath()).resolves.toBe(dropDirectory)
    await firstRun.bridge.saveWatchedGpxFolders({ missionId: 'mission-1', paths: [dropDirectory] })

    // Restart: nothing is allowed until the mission's saved watches are loaded.
    const secondRun = startAppRun(userDataPath, null)
    await expect(secondRun.fileSystem.listWatchedGpxDirectoryPaths(dropDirectory)).rejects.toThrow(/allowed/u)
    await expect(secondRun.bridge.loadWatchedGpxFolders('mission-1')).resolves.toEqual({ paths: [dropDirectory] })

    await writeFile(path.join(dropDirectory, 'after-restart.gpx'), '<gpx/>')
    const listing = await secondRun.fileSystem.listWatchedGpxDirectoryPaths(dropDirectory)
    expect(listing.paths).toEqual([path.join(dropDirectory, 'after-restart.gpx')])
  })

  it('refuses to save a folder the operator never chose, so the renderer cannot widen file access', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-watch-profile-'))
    const elsewhere = await mkdtemp(path.join(tmpdir(), 'sartracker-watch-elsewhere-'))
    directories.push(userDataPath, elsewhere)
    await mkdir(path.join(elsewhere, 'nested'))

    const run = startAppRun(userDataPath, null)
    await expect(run.bridge.saveWatchedGpxFolders({ missionId: 'mission-1', paths: [elsewhere] }))
      .rejects.toThrow(/not under an allowed/u)
    const afterRestart = startAppRun(userDataPath, null)
    await expect(afterRestart.bridge.loadWatchedGpxFolders('mission-1')).resolves.toEqual({ paths: [] })
  })

  it('rejects malformed requests in the preload before they reach the main process', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-watch-profile-'))
    directories.push(userDataPath)
    const run = startAppRun(userDataPath, null)
    expect(() => run.bridge.saveWatchedGpxFolders({ missionId: 'mission-1', paths: 'nope' })).toThrow(/invalid/u)
    expect(() => run.bridge.saveWatchedGpxFolders({ missionId: '', paths: [] })).toThrow(/Mission id is invalid/u)
    expect(() => run.bridge.loadWatchedGpxFolders('x'.repeat(201))).toThrow(/Mission id is invalid/u)
  })
})
