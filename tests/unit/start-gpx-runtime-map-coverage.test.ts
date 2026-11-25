import { describe, expect, it, vi } from 'vitest'

import { startGpxRuntime, type GpxRuntimeState } from '../../src/features/gpx/start-gpx-runtime'
import type { GpxTrackImport } from '../../src/infrastructure/mission-store/tauri-mission-store'

function storedImport(id: string, revision = 1): GpxTrackImport {
  return {
    id,
    mission_id: 'mission-1',
    source_path: `/watch/${id}.gpx`,
    file_name: `${id}.gpx`,
    display_name: id,
    geometry_json: '{"type":"MultiLineString","coordinates":[[[-9.7,52],[-9.71,52.01]]]}',
    metadata_json: null,
    revision_sequence: revision,
    imported_at: '2026-11-21T10:00:00.000Z',
    updated_at: '2026-11-21T10:00:00.000Z',
  }
}

function lastRuntime(applyRuntime: ReturnType<typeof vi.fn>): GpxRuntimeState {
  return applyRuntime.mock.calls.at(-1)?.[0] as GpxRuntimeState
}

const thirty = Array.from({ length: 30 }, (_unused, index) => storedImport(`team-${String(index).padStart(2, '0')}`))

/** A store whose list pages hold 25 and whose map projection holds every import. */
function pagedStore(imports: readonly GpxTrackImport[], overrides: Record<string, unknown> = {}) {
  return {
    listGpxImports: vi.fn().mockRejectedValue(new Error('unbounded API must not be called')),
    listGpxImportPage: vi.fn().mockImplementation(async ({ cursor }: { readonly cursor?: string }) => (
      cursor === undefined
        ? { entries: imports.slice(0, 25), nextCursor: imports.length > 25 ? 'page-2' : null }
        : { entries: imports.slice(25), nextCursor: null }
    )),
    listGpxMapProjectionPage: vi.fn().mockImplementation(async ({ cursor }: { readonly cursor?: string }) => (
      cursor === undefined
        ? { entries: imports.slice(0, 20), undrawn: [], totalActive: imports.length, truncated: false, nextCursor: imports.length > 20 ? 'map-2' : null }
        : { entries: imports.slice(20), undrawn: [], totalActive: imports.length, truncated: false, nextCursor: null }
    )),
    listGpxImportIssues: vi.fn().mockResolvedValue({ entries: [], nextCursor: null }),
    upsertGpxImport: vi.fn(),
    deleteGpxImport: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

/**
 * A store whose second map page waits until the test releases it, and whose saves change what
 * later pages serve, like the real store.
 */
function heldMapStore() {
  const stored = new Map(thirty.map((entry) => [entry.id, entry]))
  const heldPages: (() => void)[] = []
  let pageHeld: () => void = () => undefined
  let nextPageHeld = new Promise<void>((resolve) => { pageHeld = resolve })
  const current = () => [...stored.values()]
  const store = pagedStore(thirty, {
    listGpxMapProjectionPage: vi.fn().mockImplementation(async ({ cursor }: { readonly cursor?: string }) => {
      if (cursor === undefined) {
        return { entries: current().slice(0, 20), undrawn: [], totalActive: 30, truncated: false, nextCursor: 'map-2' }
      }
      await new Promise<void>((resolve) => {
        heldPages.push(resolve)
        pageHeld()
        nextPageHeld = new Promise<void>((next) => { pageHeld = next })
      })
      return { entries: current().slice(20), undrawn: [], totalActive: 30, truncated: false, nextCursor: null }
    }),
    updateGpxImportPresentation: vi.fn().mockImplementation(async (input: { readonly id: string; readonly metadata_json: string }) => {
      const updated = { ...stored.get(input.id)!, metadata_json: input.metadata_json }
      stored.set(input.id, updated)
      return updated
    }),
    assignGpxImportToOuting: vi.fn().mockImplementation(async (input: { readonly import_id: string; readonly outing_id: string }) => {
      const updated = { ...stored.get(input.import_id)!, outing_id: input.outing_id }
      stored.set(input.import_id, updated)
      return updated
    }),
  })
  return {
    store,
    /** Resolves once the next second map page is waiting. */
    pageHeld: () => nextPageHeld,
    heldCount: () => heldPages.length,
    /** Releases the oldest held page, or every held page. */
    releaseOldest: () => heldPages.shift()?.(),
    releaseAll: () => { while (heldPages.length > 0) heldPages.shift()?.() },
  }
}

describe('GPX runtime map coverage and watched rescans [DON-350]', () => {
  it('draws every active import, not only the visible list page [M-87]', async () => {
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({ gpxStore: pagedStore(thirty), applyRuntime })
    await controller.refreshMission('mission-1')

    const runtime = lastRuntime(applyRuntime)
    expect(runtime.imports).toHaveLength(25)
    expect(runtime.mapImports.map((entry) => entry.id)).toEqual(thirty.map((entry) => entry.id))
    expect(runtime.mapImportTotal).toBe(30)
    expect(runtime.mapCoverageNotice).toBeNull()
  })

  it('a map read still in flight does not put back a colour the operator just saved [DON-350] [review]', async () => {
    const applyRuntime = vi.fn()
    const held = heldMapStore()
    const controller = await startGpxRuntime({ gpxStore: held.store, applyRuntime })
    const waiting = held.pageHeld()
    const refreshing = controller.refreshMission('mission-1')
    await waiting

    // Page one of the held read already holds team-00 with its old presentation.
    const saving = controller.updateImportColor('team-00', '#2563eb')
    await vi.waitFor(() => expect(held.store.updateGpxImportPresentation).toHaveBeenCalledTimes(1))
    held.releaseAll()
    const saved = await saving
    await refreshing
    held.releaseAll()

    const runtime = lastRuntime(applyRuntime)
    expect(runtime.imports.find((entry) => entry.id === 'team-00')?.metadata_json).toBe(saved?.metadata_json)
    expect(runtime.mapImports.find((entry) => entry.id === 'team-00')?.metadata_json).toBe(saved?.metadata_json)
    expect(runtime.mapImports).toHaveLength(30)
  })

  it('a map read still in flight does not put back an outing the operator just assigned [DON-350] [review]', async () => {
    const applyRuntime = vi.fn()
    const held = heldMapStore()
    const controller = await startGpxRuntime({ gpxStore: held.store, applyRuntime })
    const waiting = held.pageHeld()
    const refreshing = controller.refreshMission('mission-1')
    await waiting

    const assigning = controller.assignImportToOuting('team-01', 'outing-7')
    await vi.waitFor(() => expect(held.store.assignGpxImportToOuting).toHaveBeenCalledTimes(1))
    held.releaseAll()
    await assigning
    await refreshing
    held.releaseAll()

    const runtime = lastRuntime(applyRuntime)
    expect(runtime.mapImports.find((entry) => entry.id === 'team-01')?.outing_id).toBe('outing-7')
    expect(runtime.mapImports).toHaveLength(30)
  })

  it('saves that keep arriving during a map read do not keep the map blank [DON-350] [review]', async () => {
    const applyRuntime = vi.fn()
    const held = heldMapStore()
    const controller = await startGpxRuntime({ gpxStore: held.store, applyRuntime })
    const waiting = held.pageHeld()
    const refreshing = controller.refreshMission('mission-1')
    await waiting

    const colours = ['#111111', '#222222', '#333333', '#444444', '#555555']
    const saves = colours.map((colour) => controller.updateImportColor('team-00', colour))
    await vi.waitFor(() => expect(held.store.updateGpxImportPresentation).toHaveBeenCalledTimes(colours.length))
    // Only the first read is let through; any read the saves started stays held.
    held.releaseOldest()
    await refreshing

    const runtime = lastRuntime(applyRuntime)
    expect(runtime.mapImports).toHaveLength(30)
    expect(runtime.mapImports.find((entry) => entry.id === 'team-00')?.metadata_json)
      .toBe(runtime.imports.find((entry) => entry.id === 'team-00')?.metadata_json)
    expect(runtime.mapImports.find((entry) => entry.id === 'team-00')?.metadata_json).toContain('#555555'.toUpperCase())
    held.releaseAll()
    await Promise.all(saves)
  })

  it('tells the operator by name when a track cannot be drawn, and when the track cap is reached [M-87]', async () => {
    const applyRuntime = vi.fn()
    const store = pagedStore(thirty.slice(0, 3), {
      listGpxMapProjectionPage: vi.fn().mockResolvedValue({
        entries: thirty.slice(0, 2),
        undrawn: [{ id: 'team-02', display_name: 'team-02', reason: 'Too many separate track segments to draw within the map budget.' }],
        totalActive: 600,
        truncated: true,
        nextCursor: null,
      }),
    })
    const controller = await startGpxRuntime({ gpxStore: store, applyRuntime })
    await controller.refreshMission('mission-1')

    const runtime = lastRuntime(applyRuntime)
    expect(runtime.mapImports).toHaveLength(2)
    expect(runtime.mapImportTotal).toBe(600)
    expect(runtime.mapCoverageNotice).toContain('Map shows 2 of 600 imported GPX tracks')
    expect(runtime.mapCoverageNotice).toContain('team-02')
  })

  it('keeps the last map and says so when the map read fails [M-87]', async () => {
    const applyRuntime = vi.fn()
    const listGpxMapProjectionPage = vi.fn()
      .mockResolvedValueOnce({ entries: thirty.slice(0, 3), undrawn: [], totalActive: 3, truncated: false, nextCursor: null })
      .mockRejectedValueOnce(new Error('database busy'))
    const controller = await startGpxRuntime({
      gpxStore: pagedStore(thirty.slice(0, 3), { listGpxMapProjectionPage }),
      applyRuntime,
    })
    await controller.refreshMission('mission-1')
    await controller.refreshMission('mission-1')

    const runtime = lastRuntime(applyRuntime)
    expect(runtime.mapImports).toHaveLength(3)
    expect(runtime.mapCoverageNotice).toMatch(/not refreshed[\s\S]*Reason: database busy\./u)
    // The operational warning leads, so the two-line map notice shows it; the technical reason follows [DON-369].
    expect(runtime.mapCoverageNotice).toMatch(
      /^GPX map not refreshed: it still shows the 3 tracks from the last successful read; newer imports may be missing\./u,
    )
    expect(runtime.mapCoverageNotice?.indexOf('database busy')).toBeGreaterThan(
      runtime.mapCoverageNotice?.indexOf('newer imports may be missing') ?? Number.POSITIVE_INFINITY,
    )
  })

  it('keeps the operator on list page 2 when a rescan finds only unchanged files [M-37]', async () => {
    const applyRuntime = vi.fn()
    const importGpxEvidencePaths = vi.fn()
      // An older store re-reports a known import at the same revision; that is not new.
      .mockResolvedValueOnce({ imports: [{ id: 'team-01', revision_sequence: 1 }], unchanged: [], failures: [], dispatchDurationMs: 1 })
      .mockResolvedValue({ imports: [], unchanged: thirty.map((entry) => entry.source_path), failures: [], dispatchDurationMs: 1 })
    const store = pagedStore(thirty, { importGpxEvidencePaths })
    const controller = await startGpxRuntime({
      gpxStore: store,
      watchSource: { listDirectoryFiles: vi.fn(), listDirectoryPaths: vi.fn().mockResolvedValue(thirty.map((entry) => entry.source_path)) },
      applyRuntime,
    })
    await controller.refreshMission('mission-1')
    await controller.loadNextImports()
    expect(lastRuntime(applyRuntime).importPageNumber).toBe(2)
    await controller.addWatchedDirectory('/watch')
    await controller.rescanWatchedDirectories()
    await controller.rescanWatchedDirectories()

    const runtime = lastRuntime(applyRuntime)
    expect(runtime.importPageNumber).toBe(2)
    expect(runtime.imports.map((entry) => entry.id)).toEqual(thirty.slice(25).map((entry) => entry.id))
  })

  it('a genuinely revised import still refreshes the list and the map [M-37]', async () => {
    const applyRuntime = vi.fn()
    const importGpxEvidencePaths = vi.fn().mockResolvedValue({
      imports: [{ id: 'team-01', revision_sequence: 2 }], unchanged: [], failures: [], dispatchDurationMs: 1,
    })
    const store = pagedStore(thirty, { importGpxEvidencePaths })
    const controller = await startGpxRuntime({ gpxStore: store, applyRuntime })
    await controller.refreshMission('mission-1')
    await controller.loadNextImports()
    store.listGpxMapProjectionPage.mockClear()
    await controller.importPaths(['/watch/team-01.gpx'])

    expect(lastRuntime(applyRuntime).importPageNumber).toBe(1)
    expect(store.listGpxMapProjectionPage).toHaveBeenCalled()
  })

  it('one watched folder that cannot be listed does not stop the others [M-40]', async () => {
    const applyRuntime = vi.fn()
    const listWatchedDirectoryPaths = vi.fn().mockImplementation(async (directory: string) => {
      if (directory === '/watch-big') throw new Error('Folder could not be read.')
      return { paths: ['/watch-small/one.gpx'], omittedCount: 0 }
    })
    const importGpxEvidencePaths = vi.fn().mockResolvedValue({ imports: [{ id: 'one' }], unchanged: [], failures: [], dispatchDurationMs: 1 })
    const controller = await startGpxRuntime({
      gpxStore: pagedStore([], { importGpxEvidencePaths }),
      watchSource: { listDirectoryFiles: vi.fn(), listDirectoryPaths: vi.fn(), listWatchedDirectoryPaths },
      applyRuntime,
    })
    await controller.refreshMission('mission-1')
    await expect(controller.addWatchedDirectory('/watch-big')).resolves.toMatchObject({ outcome: 'failed' })
    expect(lastRuntime(applyRuntime).error).toContain('/watch-big')
    await controller.addWatchedDirectory('/watch-small')
    importGpxEvidencePaths.mockClear()

    const result = await controller.rescanWatchedDirectories()
    expect(importGpxEvidencePaths).toHaveBeenCalledWith(expect.objectContaining({ paths: ['/watch-small/one.gpx'] }))
    expect(result).toMatchObject({ outcome: 'imported', failures: [expect.objectContaining({ fileName: '/watch-big' })] })
    expect(lastRuntime(applyRuntime).error).toContain('/watch-big')
  })

  it('imports a watched folder of more than 100 files in bounded chunks and names what it skipped [M-40]', async () => {
    const applyRuntime = vi.fn()
    const paths = Array.from({ length: 250 }, (_unused, index) => `/watch/track-${index}.gpx`)
    const importGpxEvidencePaths = vi.fn().mockResolvedValue({ imports: [], unchanged: [], failures: [], dispatchDurationMs: 1 })
    const controller = await startGpxRuntime({
      gpxStore: pagedStore([], { importGpxEvidencePaths }),
      watchSource: {
        listDirectoryFiles: vi.fn(),
        listDirectoryPaths: vi.fn().mockRejectedValue(new Error('This folder contains more than 100 GPX files.')),
        listWatchedDirectoryPaths: vi.fn().mockResolvedValue({ paths, omittedCount: 7 }),
      },
      applyRuntime,
    })
    await controller.refreshMission('mission-1')
    await controller.addWatchedDirectory('/watch')

    const chunks = importGpxEvidencePaths.mock.calls.map(([input]) => (input as { readonly paths: readonly string[] }).paths)
    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 50])
    expect(chunks.flat()).toEqual(paths)
    expect(lastRuntime(applyRuntime).error).toContain('more than 1000 GPX files')
    expect(lastRuntime(applyRuntime).importing).toBe(false)
  })

  it('keeps an earlier folder\'s omitted-files warning after a later folder imports [M-40] [review P2]', async () => {
    const applyRuntime = vi.fn()
    const listWatchedDirectoryPaths = vi.fn().mockImplementation(async (directory: string) => (
      directory === '/watch-big'
        ? { paths: ['/watch-big/a.gpx'], omittedCount: 5 }
        : { paths: ['/watch-small/b.gpx'], omittedCount: 0 }
    ))
    const importGpxEvidencePaths = vi.fn().mockResolvedValue({ imports: [], unchanged: ['x'], failures: [], dispatchDurationMs: 1 })
    const controller = await startGpxRuntime({
      gpxStore: pagedStore([], { importGpxEvidencePaths }),
      watchSource: { listDirectoryFiles: vi.fn(), listDirectoryPaths: vi.fn(), listWatchedDirectoryPaths },
      applyRuntime,
    })
    await controller.refreshMission('mission-1')
    await controller.addWatchedDirectory('/watch-big')
    await controller.addWatchedDirectory('/watch-small')
    await controller.rescanWatchedDirectories()

    expect(lastRuntime(applyRuntime).error).toContain('/watch-big holds more than 1000 GPX files')
  })

  it('when a middle chunk of a large watched folder fails, says what imported, what failed and what was not tried [M-40] [coordinator 1]', async () => {
    const applyRuntime = vi.fn()
    const paths = Array.from({ length: 250 }, (_unused, index) => `/watch/track-${index}.gpx`)
    const importGpxEvidencePaths = vi.fn()
      .mockResolvedValueOnce({ imports: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], unchanged: [], failures: [], dispatchDurationMs: 1 })
      .mockRejectedValueOnce(new Error('GPX evidence import worker stopped responding for 120 s and was stopped. 37 of 100 GPX files were imported before it stopped; 63 are listed as import issues for review.'))
      .mockResolvedValue({ imports: [], unchanged: [], failures: [], dispatchDurationMs: 1 })
    const controller = await startGpxRuntime({
      gpxStore: pagedStore([], { importGpxEvidencePaths }),
      watchSource: {
        listDirectoryFiles: vi.fn(),
        listDirectoryPaths: vi.fn(),
        listWatchedDirectoryPaths: vi.fn().mockResolvedValue({ paths, omittedCount: 7 }),
      },
      applyRuntime,
    })
    await controller.refreshMission('mission-1')
    await expect(controller.addWatchedDirectory('/watch')).rejects.toThrow(/stopped responding/u)

    // Stops after the failed chunk: a stalled worker is likely to stall again.
    expect(importGpxEvidencePaths).toHaveBeenCalledTimes(2)
    const error = lastRuntime(applyRuntime).error ?? ''
    expect(error).toContain('37 of 100 GPX files were imported')
    expect(error).toContain('Of 250 GPX files in this import, 100 finished before the stop (3 imported or updated); 50 were not tried.')
    // The over-limit warning survives the failure.
    expect(error).toContain('/watch holds more than 1000 GPX files')
    expect(lastRuntime(applyRuntime).importing).toBe(false)
  })

  it('a watched rescan whose import throws still names the folder\'s omitted files [M-40] [coordinator 1]', async () => {
    const applyRuntime = vi.fn()
    const importGpxEvidencePaths = vi.fn()
      .mockResolvedValueOnce({ imports: [], unchanged: [], failures: [], dispatchDurationMs: 1 })
      .mockRejectedValue(new Error('Import worker crashed.'))
    const controller = await startGpxRuntime({
      gpxStore: pagedStore([], { importGpxEvidencePaths }),
      watchSource: {
        listDirectoryFiles: vi.fn(),
        listDirectoryPaths: vi.fn(),
        listWatchedDirectoryPaths: vi.fn().mockResolvedValue({ paths: ['/watch/a.gpx'], omittedCount: 4 }),
      },
      applyRuntime,
    })
    await controller.refreshMission('mission-1')
    await controller.addWatchedDirectory('/watch')
    await controller.rescanWatchedDirectories()
    const error = lastRuntime(applyRuntime).error ?? ''
    expect(error).toContain('Import worker crashed')
    expect(error).toContain('/watch holds more than 1000 GPX files')
  })

  it('re-reads the list, issues and map when a native import is stopped part way [M-36]', async () => {
    const applyRuntime = vi.fn()
    const importGpxEvidencePaths = vi.fn().mockRejectedValue(new Error(
      'GPX evidence import worker stopped responding for 120 s and was stopped. 1 of 3 GPX files were imported before it stopped; 2 are listed as import issues for review.',
    ))
    const issue = { id: 'issue-1', file_name: 'two.gpx', reason: 'Import was interrupted.' }
    const listGpxImportIssues = vi.fn()
      .mockResolvedValueOnce({ entries: [], nextCursor: null })
      .mockResolvedValue({ entries: [issue], nextCursor: null })
    const store = pagedStore(thirty.slice(0, 1), { importGpxEvidencePaths, listGpxImportIssues })
    const controller = await startGpxRuntime({ gpxStore: store, applyRuntime })
    await controller.refreshMission('mission-1')
    store.listGpxImportPage.mockClear()
    store.listGpxMapProjectionPage.mockClear()

    await expect(controller.importPaths(['/a/one.gpx', '/a/two.gpx', '/a/three.gpx'])).rejects.toThrow(/stopped responding/u)

    const runtime = lastRuntime(applyRuntime)
    expect(store.listGpxImportPage).toHaveBeenCalled()
    expect(store.listGpxMapProjectionPage).toHaveBeenCalled()
    expect(runtime.importIssues).toEqual([issue])
    expect(runtime.importing).toBe(false)
    expect(runtime.error).toContain('1 of 3 GPX files were imported')
  })
})
