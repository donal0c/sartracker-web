import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

type WatchedFolderStore = {
  readonly loadWatchedGpxFolders: (missionId: unknown) => Promise<{ readonly paths: readonly string[] }>
  readonly saveWatchedGpxFolders: (input: unknown) => Promise<{ readonly paths: readonly string[] }>
}

const { createGpxWatchedFolderStore, WATCHED_FOLDERS_FILE_NAME } = require('../../electron/gpx-watched-folder-store.cjs') as {
  readonly createGpxWatchedFolderStore: (options: { readonly userDataPath: string }) => WatchedFolderStore
  readonly WATCHED_FOLDERS_FILE_NAME: string
}

const directories: string[] = []

async function createUserData(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sartracker-gpx-watch-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('GPX watched-folder store [DON-337]', () => {
  it('keeps a mission\'s watched folders across a restart (a new store on the same profile)', async () => {
    const userDataPath = await createUserData()
    const watchDirectory = path.join(userDataPath, 'field-drop')
    const firstRun = createGpxWatchedFolderStore({ userDataPath })
    await firstRun.saveWatchedGpxFolders({ missionId: 'mission-1', paths: [watchDirectory] })

    const afterRestart = createGpxWatchedFolderStore({ userDataPath })
    await expect(afterRestart.loadWatchedGpxFolders('mission-1')).resolves.toEqual({ paths: [watchDirectory] })
    // Watches belong to one mission; another mission starts with none.
    await expect(afterRestart.loadWatchedGpxFolders('mission-2')).resolves.toEqual({ paths: [] })
  })

  it('saving an empty list forgets the mission\'s watches and leaves other missions alone', async () => {
    const userDataPath = await createUserData()
    const store = createGpxWatchedFolderStore({ userDataPath })
    await store.saveWatchedGpxFolders({ missionId: 'mission-1', paths: ['/drop/a'] })
    await store.saveWatchedGpxFolders({ missionId: 'mission-2', paths: ['/drop/b'] })
    await store.saveWatchedGpxFolders({ missionId: 'mission-1', paths: [] })

    const afterRestart = createGpxWatchedFolderStore({ userDataPath })
    await expect(afterRestart.loadWatchedGpxFolders('mission-1')).resolves.toEqual({ paths: [] })
    await expect(afterRestart.loadWatchedGpxFolders('mission-2')).resolves.toEqual({ paths: ['/drop/b'] })
  })

  it('serialises overlapping saves so the last request wins on disk', async () => {
    const userDataPath = await createUserData()
    const store = createGpxWatchedFolderStore({ userDataPath })
    await Promise.all([
      store.saveWatchedGpxFolders({ missionId: 'mission-1', paths: ['/drop/a'] }),
      store.saveWatchedGpxFolders({ missionId: 'mission-1', paths: ['/drop/a', '/drop/b'] }),
      store.saveWatchedGpxFolders({ missionId: 'mission-2', paths: ['/drop/c'] }),
    ])
    const afterRestart = createGpxWatchedFolderStore({ userDataPath })
    await expect(afterRestart.loadWatchedGpxFolders('mission-1')).resolves.toEqual({ paths: ['/drop/a', '/drop/b'] })
    await expect(afterRestart.loadWatchedGpxFolders('mission-2')).resolves.toEqual({ paths: ['/drop/c'] })
    // No temporary files are left behind.
    expect((await readdir(userDataPath)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('refuses a damaged file loudly and keeps a copy aside before the next save replaces it', async () => {
    const userDataPath = await createUserData()
    const filePath = path.join(userDataPath, WATCHED_FOLDERS_FILE_NAME)
    await writeFile(filePath, '{"version":1,"missions":', 'utf8')
    const store = createGpxWatchedFolderStore({ userDataPath })

    await expect(store.loadWatchedGpxFolders('mission-1')).rejects.toThrow(
      /Saved watched GPX folders could not be read/u,
    )
    await store.saveWatchedGpxFolders({ missionId: 'mission-1', paths: ['/drop/a'] })
    await expect(store.loadWatchedGpxFolders('mission-1')).resolves.toEqual({ paths: ['/drop/a'] })
    const names = await readdir(userDataPath)
    const damagedCopy = names.find((name) => name.startsWith(`${WATCHED_FOLDERS_FILE_NAME}.damaged-`))
    expect(damagedCopy).toBeDefined()
    await expect(readFile(path.join(userDataPath, damagedCopy ?? ''), 'utf8')).resolves.toBe('{"version":1,"missions":')
  })

  it('refuses a file written by a newer version instead of overwriting it', async () => {
    const userDataPath = await createUserData()
    const filePath = path.join(userDataPath, WATCHED_FOLDERS_FILE_NAME)
    await writeFile(filePath, JSON.stringify({ version: 99, missions: {} }), 'utf8')
    const store = createGpxWatchedFolderStore({ userDataPath })
    await expect(store.loadWatchedGpxFolders('mission-1')).rejects.toThrow(/newer version/u)
    await expect(store.saveWatchedGpxFolders({ missionId: 'mission-1', paths: ['/drop/a'] })).rejects.toThrow(/newer version/u)
    await expect(readFile(filePath, 'utf8')).resolves.toContain('"version":99')
  })

  it.each([
    [{ missionId: '', paths: [] }],
    [{ missionId: 'mission-1', paths: 'not-a-list' }],
    [{ missionId: 'mission-1', paths: ['relative/path'] }],
    [{ missionId: 'mission-1', paths: ['/drop/a\u0000b'] }],
    [{ missionId: 'mission-1', paths: Array.from({ length: 51 }, (_, index) => `/drop/${index}`) }],
    [null],
  ])('rejects an invalid save request %#', async (input) => {
    const userDataPath = await createUserData()
    const store = createGpxWatchedFolderStore({ userDataPath })
    await expect(store.saveWatchedGpxFolders(input)).rejects.toThrow(/Watched GPX folders/u)
  })

  it('accepts Windows drive and UNC folders as absolute', async () => {
    const userDataPath = await createUserData()
    const store = createGpxWatchedFolderStore({ userDataPath })
    await store.saveWatchedGpxFolders({ missionId: 'mission-1', paths: ['C:\\Drop', '\\\\server\\share\\gpx'] })
    await expect(store.loadWatchedGpxFolders('mission-1')).resolves.toEqual({ paths: ['C:\\Drop', '\\\\server\\share\\gpx'] })
  })
})

describe('GPX watched-folder store mission keys [DON-337]', () => {
  it('treats a mission id such as __proto__ as an ordinary key', async () => {
    const userDataPath = await createUserData()
    const store = createGpxWatchedFolderStore({ userDataPath })
    await store.saveWatchedGpxFolders({ missionId: '__proto__', paths: ['/drop/a'] })
    const afterRestart = createGpxWatchedFolderStore({ userDataPath })
    await expect(afterRestart.loadWatchedGpxFolders('__proto__')).resolves.toEqual({ paths: ['/drop/a'] })
    await expect(afterRestart.loadWatchedGpxFolders('mission-1')).resolves.toEqual({ paths: [] })
  })
})
