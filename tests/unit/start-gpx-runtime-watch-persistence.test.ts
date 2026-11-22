import { describe, expect, it, vi } from 'vitest'

import {
  startGpxRuntime,
  type GpxRuntimeState,
  type GpxWatchedFolderStoreBoundary,
} from '../../src/features/gpx/start-gpx-runtime'

/** An in-memory stand-in for the main-process store, shared across "restarts". */
function createSavedWatches(initial: Record<string, readonly string[]> = {}) {
  const saved = new Map<string, readonly string[]>(Object.entries(initial))
  const store: GpxWatchedFolderStoreBoundary = {
    loadWatchedFolders: vi.fn(async (missionId: string) => ({ paths: saved.get(missionId) ?? [], warning: null })),
    saveWatchedFolders: vi.fn(async (missionId: string, paths: readonly string[]) => {
      saved.set(missionId, [...paths])
    }),
  }
  return { saved, store }
}

async function startRuntime(options: {
  readonly watchedFolderStore?: GpxWatchedFolderStoreBoundary
  readonly listWatchedDirectoryPaths?: (path: string) => Promise<{ paths: readonly string[]; omittedCount: number }>
  readonly importGpxEvidencePaths?: ReturnType<typeof vi.fn>
}) {
  let latest: GpxRuntimeState | null = null
  const importGpxEvidencePaths = options.importGpxEvidencePaths
    ?? vi.fn(async (input: { readonly paths: readonly string[] }) => ({
      imports: input.paths.map((path) => ({ id: `gpx:${path}` })),
      dispatchDurationMs: 1,
    }))
  const controller = await startGpxRuntime({
    gpxStore: {
      listGpxImports: vi.fn().mockResolvedValue([]),
      upsertGpxImport: vi.fn(),
      deleteGpxImport: vi.fn(),
      importGpxEvidencePaths,
    },
    watchSource: {
      listDirectoryFiles: vi.fn(),
      listWatchedDirectoryPaths: options.listWatchedDirectoryPaths
        ?? vi.fn(async () => ({ paths: [], omittedCount: 0 })),
    },
    ...(options.watchedFolderStore !== undefined ? { watchedFolderStore: options.watchedFolderStore } : {}),
    applyRuntime: (runtime) => { latest = runtime },
  })
  return { controller, importGpxEvidencePaths, state: () => latest as GpxRuntimeState | null }
}

describe('watched GPX folders survive a restart [DON-337]', () => {
  it('saves a new watch for the mission and restores it when the mission opens after a restart', async () => {
    const { saved, store } = createSavedWatches()
    const before = await startRuntime({ watchedFolderStore: store })
    await before.controller.refreshMission('mission-1')
    await before.controller.addWatchedDirectory('/field/drop')
    expect(saved.get('mission-1')).toEqual(['/field/drop'])

    // Restart: a new runtime with the same saved list and a new file in the folder.
    const after = await startRuntime({
      watchedFolderStore: store,
      listWatchedDirectoryPaths: vi.fn(async () => ({ paths: ['/field/drop/new.gpx'], omittedCount: 0 })),
    })
    await after.controller.refreshMission('mission-1')
    expect(after.state()?.watchedDirectories).toEqual(['/field/drop'])
    expect(after.state()?.watchNotice).toEqual({
      tone: 'resumed',
      message: 'Resumed watching 1 folder saved for this mission. New GPX files there will import automatically.',
    })
    expect(after.state()?.watchResumePending).toBe(true)

    // The bridge scans the resumed watch once; the new file imports.
    await expect(after.controller.resumeWatchedDirectories()).resolves.toMatchObject({ outcome: 'imported' })
    expect(after.importGpxEvidencePaths).toHaveBeenCalledWith({
      missionId: 'mission-1',
      paths: ['/field/drop/new.gpx'],
      skipRetiredSources: true,
    })
    expect(after.state()?.watchResumePending).toBe(false)
    // A second resume call does nothing.
    await expect(after.controller.resumeWatchedDirectories()).resolves.toEqual({ outcome: 'empty', imports: [] })
  })

  it('keeps watches per mission: another mission opens with none', async () => {
    const { store } = createSavedWatches({ 'mission-1': ['/field/drop'] })
    const runtime = await startRuntime({ watchedFolderStore: store })
    await runtime.controller.refreshMission('mission-2')
    expect(runtime.state()?.watchedDirectories).toEqual([])
    expect(runtime.state()?.watchNotice).toBeNull()
    await runtime.controller.refreshMission('mission-1')
    expect(runtime.state()?.watchedDirectories).toEqual(['/field/drop'])
  })

  it('forgets a removed watch so it does not come back after a restart', async () => {
    const { saved, store } = createSavedWatches({ 'mission-1': ['/field/a', '/field/b'] })
    const runtime = await startRuntime({ watchedFolderStore: store })
    await runtime.controller.refreshMission('mission-1')
    runtime.controller.removeWatchedDirectory('/field/a')
    await vi.waitFor(() => expect(saved.get('mission-1')).toEqual(['/field/b']))
  })

  it('says plainly when a resumed folder cannot be opened, and keeps it listed', async () => {
    const { store } = createSavedWatches({ 'mission-1': ['/media/usb/drop'] })
    const runtime = await startRuntime({
      watchedFolderStore: store,
      listWatchedDirectoryPaths: vi.fn(async () => {
        throw new Error("Error invoking remote method 'sartracker:list-watched-gpx-directory-paths': Error: GPX watch directory was not found: /media/usb/drop")
      }),
    })
    await runtime.controller.refreshMission('mission-1')
    await expect(runtime.controller.resumeWatchedDirectories()).resolves.toMatchObject({ outcome: 'failed' })
    expect(runtime.state()?.watchedDirectories).toEqual(['/media/usb/drop'])
    expect(runtime.state()?.error).toBe(
      'Watched folder /media/usb/drop could not be opened: GPX watch directory was not found: /media/usb/drop. New GPX files there are not being imported. Reconnect the folder or drive and press Rescan Watches, or remove it from Watched Folders.',
    )
  })

  it('warns that nothing is watched when the saved list cannot be loaded', async () => {
    const store: GpxWatchedFolderStoreBoundary = {
      loadWatchedFolders: vi.fn().mockRejectedValue(new Error(
        "Error invoking remote method 'sartracker:load-watched-gpx-folders': Error: Saved watched GPX folders could not be read: the file is damaged.",
      )),
      saveWatchedFolders: vi.fn().mockResolvedValue(undefined),
    }
    const runtime = await startRuntime({ watchedFolderStore: store })
    await runtime.controller.refreshMission('mission-1')
    expect(runtime.state()?.watchedDirectories).toEqual([])
    expect(runtime.state()?.watchNotice).toEqual({
      tone: 'problem',
      message: 'Watched folders saved for this mission could not be loaded, so none are being watched: Saved watched GPX folders could not be read: the file is damaged. Add them again with Watch Folder.',
    })
    // A later successful save clears the warning.
    await runtime.controller.addWatchedDirectory('/field/drop')
    expect(runtime.state()?.watchNotice).toBeNull()
  })

  it('warns that a new watch will be forgotten after a restart when it cannot be saved', async () => {
    const store: GpxWatchedFolderStoreBoundary = {
      loadWatchedFolders: vi.fn().mockResolvedValue({ paths: [], warning: null }),
      saveWatchedFolders: vi.fn().mockRejectedValue(new Error('Disk full.')),
    }
    const runtime = await startRuntime({ watchedFolderStore: store })
    await runtime.controller.refreshMission('mission-1')
    await runtime.controller.addWatchedDirectory('/field/drop')
    expect(runtime.state()?.watchedDirectories).toEqual(['/field/drop'])
    expect(runtime.state()?.watchNotice).toEqual({
      tone: 'problem',
      message: 'The watched folder list could not be saved: Disk full. The folder is watched now but will be forgotten after a restart; choose it again with Watch Folder to retry saving.',
    })
  })

  it('does not apply saved watches that arrive after the mission changed', async () => {
    let releaseLoad: (paths: readonly string[]) => void = () => undefined
    const store: GpxWatchedFolderStoreBoundary = {
      loadWatchedFolders: vi.fn().mockImplementationOnce(() => new Promise((resolve) => { releaseLoad = (paths) => resolve({ paths, warning: null }) }))
        .mockResolvedValue({ paths: [], warning: null }),
      saveWatchedFolders: vi.fn().mockResolvedValue(undefined),
    }
    const runtime = await startRuntime({ watchedFolderStore: store })
    const first = runtime.controller.refreshMission('mission-1')
    await runtime.controller.refreshMission('mission-2')
    releaseLoad(['/field/mission-1-only'])
    await first
    expect(runtime.state()?.activeMissionId).toBe('mission-2')
    expect(runtime.state()?.watchedDirectories).toEqual([])
  })

  it('saves the restored folders too when a folder is added while restoration is still loading [review]', async () => {
    const saved = new Map<string, readonly string[]>([['mission-1', ['/field/a']]])
    let releaseLoad: () => void = () => undefined
    const store: GpxWatchedFolderStoreBoundary = {
      loadWatchedFolders: vi.fn(() => new Promise<{ paths: readonly string[]; warning: null }>((resolve) => {
        releaseLoad = () => resolve({ paths: saved.get('mission-1') ?? [], warning: null })
      })),
      saveWatchedFolders: vi.fn(async (missionId: string, paths: readonly string[]) => { saved.set(missionId, [...paths]) }),
    }
    const runtime = await startRuntime({ watchedFolderStore: store })
    const opening = runtime.controller.refreshMission('mission-1')
    await vi.waitFor(() => expect(store.loadWatchedFolders).toHaveBeenCalled())
    const adding = runtime.controller.addWatchedDirectory('/field/b')
    releaseLoad()
    await Promise.all([opening, adding])
    expect(runtime.state()?.watchedDirectories).toEqual(['/field/a', '/field/b'])
    expect(saved.get('mission-1')).toEqual(['/field/a', '/field/b'])
  })

  it('retries the save when the operator chooses an already watched folder after a failed save [review]', async () => {
    const saved = new Map<string, readonly string[]>()
    const store: GpxWatchedFolderStoreBoundary = {
      loadWatchedFolders: vi.fn().mockResolvedValue({ paths: [], warning: null }),
      saveWatchedFolders: vi.fn()
        .mockRejectedValueOnce(new Error('Disk full.'))
        .mockImplementation(async (missionId: string, paths: readonly string[]) => { saved.set(missionId, [...paths]) }),
    }
    const runtime = await startRuntime({ watchedFolderStore: store })
    await runtime.controller.refreshMission('mission-1')
    await runtime.controller.addWatchedDirectory('/field/drop')
    expect(runtime.state()?.watchNotice?.tone).toBe('problem')
    await runtime.controller.addWatchedDirectory('/field/drop')
    expect(store.saveWatchedFolders).toHaveBeenCalledTimes(2)
    expect(saved.get('mission-1')).toEqual(['/field/drop'])
    expect(runtime.state()?.watchNotice).toBeNull()
    expect(runtime.state()?.watchedDirectories).toEqual(['/field/drop'])
  })

  it('says when saved watches were restored from the backup copy [review]', async () => {
    const store: GpxWatchedFolderStoreBoundary = {
      loadWatchedFolders: vi.fn().mockResolvedValue({
        paths: ['/field/drop'],
        warning: 'The saved watched-folder list was damaged or missing and was restored from its backup copy. Check the Watched Folders list.',
      }),
      saveWatchedFolders: vi.fn().mockResolvedValue(undefined),
    }
    const runtime = await startRuntime({ watchedFolderStore: store })
    await runtime.controller.refreshMission('mission-1')
    expect(runtime.state()?.watchedDirectories).toEqual(['/field/drop'])
    expect(runtime.state()?.watchNotice).toEqual({
      tone: 'problem',
      message: 'Resumed watching 1 folder saved for this mission. New GPX files there will import automatically. The saved watched-folder list was damaged or missing and was restored from its backup copy. Check the Watched Folders list.',
    })
  })
})
