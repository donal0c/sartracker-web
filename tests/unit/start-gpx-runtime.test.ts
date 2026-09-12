import { describe, expect, it, vi } from 'vitest'

import { startGpxRuntime } from '../../src/features/gpx/start-gpx-runtime'
import type { GpxTrackImport } from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('startGpxRuntime', () => {
  it('imports files for the active mission and skips path duplicates', async () => {
    const applyRuntime = vi.fn()
    const upsertImport = vi.fn().mockImplementation(async (input) => ({
      id: input.id ?? `gpx-${input.display_name}`,
      mission_id: input.mission_id,
      source_path: input.source_path,
      file_name: input.file_name,
      display_name: input.display_name,
      geometry_json: input.geometry_json,
      metadata_json: input.metadata_json ?? null,
      imported_at: '2026-04-11T10:00:00.000Z',
      updated_at: '2026-04-11T10:00:00.000Z',
    }))

    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports: vi.fn().mockResolvedValue([]),
        upsertGpxImport: upsertImport,
        deleteGpxImport: vi.fn(),
      },
      applyRuntime,
    })

    await controller.refreshMission('mission-1')
    await controller.importFiles([
      createImportFile('/tracks/alpha.gpx', 'alpha.gpx'),
      createImportFile('/tracks/alpha.gpx', 'alpha-copy.gpx'),
    ])

    expect(upsertImport).toHaveBeenCalledTimes(1)
    expect(upsertImport).toHaveBeenCalledWith(
      expect.objectContaining({
        mission_id: 'mission-1',
        source_path: '/tracks/alpha.gpx',
        display_name: 'alpha',
      }),
    )
  })

  it('rescans watched directories and imports only newly discovered GPX paths', async () => {
    const applyRuntime = vi.fn()
    const listDirectoryFiles = vi
      .fn()
      .mockResolvedValueOnce([createImportFile('/watch/a.gpx', 'a.gpx')])
      .mockResolvedValueOnce([
        createImportFile('/watch/a.gpx', 'a.gpx'),
        createImportFile('/watch/b.gpx', 'b.gpx'),
      ])
    const upsertImport = vi.fn().mockImplementation(async (input) => ({
      id: input.id ?? `gpx-${input.display_name}`,
      mission_id: input.mission_id,
      source_path: input.source_path,
      file_name: input.file_name,
      display_name: input.display_name,
      geometry_json: input.geometry_json,
      metadata_json: input.metadata_json ?? null,
      imported_at: '2026-04-11T10:00:00.000Z',
      updated_at: '2026-04-11T10:00:00.000Z',
    }))

    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports: vi.fn().mockResolvedValue([]),
        upsertGpxImport: upsertImport,
        deleteGpxImport: vi.fn(),
      },
      watchSource: {
        listDirectoryFiles,
      },
      applyRuntime,
    })

    await controller.refreshMission('mission-1')
    await controller.addWatchedDirectory('/watch')
    await controller.rescanWatchedDirectories()

    expect(upsertImport).toHaveBeenCalledTimes(2)
    expect(listDirectoryFiles).toHaveBeenCalledTimes(2)
    expect(upsertImport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source_path: '/watch/b.gpx',
        display_name: 'b',
      }),
    )
  })

  it('rescans an already-watched directory when selected again [DON-274]', async () => {
    const listDirectoryPaths = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['/watch/retry.gpx'])
    const importGpxEvidencePaths = vi.fn().mockResolvedValue({
      imports: [{ id: 'gpx-retry' }], failures: [], dispatchDurationMs: 1,
    })
    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports: vi.fn().mockResolvedValue([]), upsertGpxImport: vi.fn(), deleteGpxImport: vi.fn(),
        importGpxEvidencePaths,
      },
      watchSource: { listDirectoryFiles: vi.fn(), listDirectoryPaths },
      applyRuntime: vi.fn(),
    })
    await controller.refreshMission('mission-1')
    await expect(controller.addWatchedDirectory('/watch')).resolves.toEqual({ outcome: 'empty', imports: [] })
    await expect(controller.addWatchedDirectory('/watch')).resolves.toEqual({
      outcome: 'imported', imports: [{ id: 'gpx-retry' }],
    })
    expect(listDirectoryPaths).toHaveBeenCalledTimes(2)
    expect(importGpxEvidencePaths).toHaveBeenCalledOnce()
  })

  it('aggregates a failed watched directory without losing later imports [DON-274]', async () => {
    const listDirectoryPaths = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['/watch/bad.gpx'])
      .mockResolvedValueOnce(['/watch/good.gpx'])
    const importGpxEvidencePaths = vi.fn()
      .mockResolvedValueOnce({
        imports: [], failures: [{ sourcePath: '/watch/bad.gpx', reason: 'bad GPX' }], dispatchDurationMs: 1,
      })
      .mockResolvedValueOnce({
        imports: [{ id: 'gpx-good' }], failures: [], dispatchDurationMs: 1,
      })
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports: vi.fn().mockResolvedValue([]), upsertGpxImport: vi.fn(), deleteGpxImport: vi.fn(),
        importGpxEvidencePaths,
      },
      watchSource: { listDirectoryFiles: vi.fn(), listDirectoryPaths },
      applyRuntime,
    })
    await controller.refreshMission('mission-1')
    await controller.addWatchedDirectory('/watch-one')
    await controller.addWatchedDirectory('/watch-two')

    await expect(controller.rescanWatchedDirectories()).resolves.toEqual({
      outcome: 'imported',
      imports: [{ id: 'gpx-good' }],
      failures: [{ fileName: 'bad.gpx', reason: 'bad GPX' }],
    })
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      importing: false,
      error: expect.stringContaining('could not be imported during this rescan'),
    }))
  })

  it('reports native path import as unavailable instead of an empty success [DON-274]', async () => {
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({
      gpxStore: { listGpxImports: vi.fn().mockResolvedValue([]), upsertGpxImport: vi.fn(), deleteGpxImport: vi.fn() },
      applyRuntime,
    })
    await controller.refreshMission('mission-1')

    await expect(controller.importPaths(['/tracks/unavailable.gpx'])).resolves.toEqual({
      outcome: 'failed',
      imports: [],
      failures: [{ fileName: 'GPX path import', reason: 'Native GPX path import is unavailable in this runtime.' }],
    })
  })

  it('loads persisted imports for the selected mission', async () => {
    const imports: readonly GpxTrackImport[] = [
      {
        id: 'gpx-1',
        mission_id: 'mission-1',
        source_path: '/tracks/alpha.gpx',
        file_name: 'alpha.gpx',
        display_name: 'Alpha Route',
        geometry_json: '{"type":"MultiLineString","coordinates":[]}',
        metadata_json: null,
        imported_at: '2026-04-11T10:00:00.000Z',
        updated_at: '2026-04-11T10:00:00.000Z',
      },
    ]

    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports: vi.fn().mockResolvedValue(imports),
        upsertGpxImport: vi.fn(),
        deleteGpxImport: vi.fn(),
      },
      applyRuntime,
    })

    await controller.refreshMission('mission-1')

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeMissionId: 'mission-1',
        imports,
      }),
    )
  })

  it('keeps one GPX projection page in renderer state and replaces it on explicit pagination [DON-274]', async () => {
    const imports = [
      createStoredImport('gpx-a', 'mission-1'),
      createStoredImport('gpx-b', 'mission-1'),
      createStoredImport('gpx-c', 'mission-1'),
    ]
    const listGpxImports = vi.fn().mockRejectedValue(new Error('unbounded API must not be called'))
    const listGpxImportPage = vi
      .fn()
      .mockResolvedValueOnce({ entries: imports.slice(0, 2), nextCursor: 'page-2' })
      .mockResolvedValueOnce({ entries: imports.slice(2), nextCursor: null })
      .mockResolvedValueOnce({ entries: imports.slice(0, 2), nextCursor: 'page-2' })
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports,
        listGpxImportPage,
        upsertGpxImport: vi.fn(),
        deleteGpxImport: vi.fn(),
      },
      applyRuntime,
    })

    await controller.refreshMission('mission-1')

    expect(listGpxImports).not.toHaveBeenCalled()
    expect(listGpxImportPage).toHaveBeenCalledTimes(1)
    expect(listGpxImportPage).toHaveBeenCalledWith({
      missionId: 'mission-1', limit: 25,
    })
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      imports: imports.slice(0, 2),
      importPageNumber: 1,
      hasMoreImports: true,
      loadingMoreImports: false,
    }))

    await controller.loadNextImports()

    expect(listGpxImportPage).toHaveBeenNthCalledWith(2, {
      missionId: 'mission-1', cursor: 'page-2', limit: 25,
    })
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      imports: imports.slice(2),
      importPageNumber: 2,
      hasMoreImports: false,
      loadingMoreImports: false,
    }))

    await controller.returnToFirstImports()

    expect(listGpxImportPage).toHaveBeenNthCalledWith(3, {
      missionId: 'mission-1', limit: 25,
    })
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      imports: imports.slice(0, 2),
      importPageNumber: 1,
      hasMoreImports: true,
    }))
  })

  it('publishes persisted GPX import failures after restart without exposing retained bytes or paths [DON-274]', async () => {
    const applyRuntime = vi.fn()
    const listGpxImportIssues = vi.fn().mockResolvedValue({
      entries: [{
        batch_id: 'batch-interrupted',
        file_name: 'team-track.gpx',
        reason: 'Import was interrupted after source bytes were retained.',
        recorded_at: '2026-08-27T10:00:00.000Z',
      }],
      nextCursor: null,
    })
    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports: vi.fn().mockResolvedValue([]),
        listGpxImportIssues,
        upsertGpxImport: vi.fn(),
        deleteGpxImport: vi.fn(),
      },
      applyRuntime,
    })

    await controller.refreshMission('mission-1')

    expect(listGpxImportIssues).toHaveBeenCalledWith({ missionId: 'mission-1', limit: 100 })
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      importIssues: [expect.objectContaining({ file_name: 'team-track.gpx' })],
      error: expect.stringMatching(/1 persisted GPX import issue/i),
    }))
    expect(JSON.stringify(applyRuntime.mock.calls)).not.toContain('source_bytes_base64')
    expect(JSON.stringify(applyRuntime.mock.calls)).not.toContain('/private/')
  })

  it('makes bounded issue truncation explicit and refreshes sanitized issues after an import [DON-274]', async () => {
    const issue = {
      batch_id: 'batch-101',
      file_name: 'failed-track.gpx',
      reason: 'GPX source exceeds the evidence import safety limit.',
      recorded_at: '2026-08-27T10:00:00.000Z',
    }
    const listGpxImportIssues = vi.fn().mockResolvedValue({
      entries: [issue],
      nextCursor: 'more-retained-issues',
    })
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports: vi.fn().mockResolvedValue([]),
        listGpxImportIssues,
        importGpxEvidencePaths: vi.fn().mockResolvedValue({
          imports: [],
          failures: [{ sourcePath: '/private/oversized.gpx', reason: 'oversized' }],
          dispatchDurationMs: 1,
        }),
        upsertGpxImport: vi.fn(),
        deleteGpxImport: vi.fn(),
      },
      applyRuntime,
    })

    await controller.refreshMission('mission-1')
    await controller.importPaths(['/private/oversized.gpx'])

    expect(listGpxImportIssues).toHaveBeenCalledTimes(2)
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      importIssues: [issue],
      hasMoreImportIssues: true,
      error: expect.stringMatching(/additional retained GPX import issues/i),
    }))
    expect(JSON.stringify(applyRuntime.mock.calls.at(-1))).not.toContain('/private/oversized.gpx')
  })

  it('reports a successful native import even when its projection is beyond the visible page [DON-274]', async () => {
    const visible = createStoredImport('gpx-visible', 'mission-1')
    const listGpxImportPage = vi.fn().mockResolvedValue({
      entries: [visible],
      nextCursor: 'more-imports',
    })
    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports: vi.fn().mockRejectedValue(new Error('unbounded API must not be called')),
        listGpxImportPage,
        importGpxEvidencePaths: vi.fn().mockResolvedValue({
          imports: [{ id: 'gpx-new-beyond-page' }],
          failures: [],
          dispatchDurationMs: 1,
        }),
        upsertGpxImport: vi.fn(),
        deleteGpxImport: vi.fn(),
      },
      applyRuntime: vi.fn(),
    })
    await controller.refreshMission('mission-1')

    await expect(controller.importPaths(['/field/zulu.gpx'])).resolves.toMatchObject({
      outcome: 'imported', imports: [{ id: 'gpx-new-beyond-page' }],
    })
  })

  it('updates one imported GPX colour while preserving the track geometry and metadata', async () => {
    const imports: readonly GpxTrackImport[] = [
      {
        id: 'gpx-1',
        mission_id: 'mission-1',
        source_path: '/tracks/alpha.gpx',
        file_name: 'alpha.gpx',
        display_name: 'Alpha Route',
        geometry_json: '{"type":"MultiLineString","coordinates":[[[-9.7,52],[-9.71,52.01]]]}',
        metadata_json: '{"trackCount":1,"pointCount":2}',
        imported_at: '2026-04-11T10:00:00.000Z',
        updated_at: '2026-04-11T10:00:00.000Z',
      },
      {
        id: 'gpx-2',
        mission_id: 'mission-1',
        source_path: '/tracks/bravo.gpx',
        file_name: 'bravo.gpx',
        display_name: 'Bravo Route',
        geometry_json: '{"type":"MultiLineString","coordinates":[[[-9.8,52],[-9.81,52.01]]]}',
        metadata_json: null,
        imported_at: '2026-04-11T10:00:00.000Z',
        updated_at: '2026-04-11T10:00:00.000Z',
      },
    ]
    const applyRuntime = vi.fn()
    const updateGpxImportPresentation = vi.fn().mockImplementation(async (input) => ({
      ...imports.find((entry) => entry.id === input.id),
      metadata_json: input.metadata_json,
      imported_at: '2026-04-11T10:00:00.000Z',
      updated_at: '2026-04-11T10:05:00.000Z',
    }))
    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports: vi.fn().mockResolvedValue(imports),
        upsertGpxImport: vi.fn(),
        updateGpxImportPresentation,
        deleteGpxImport: vi.fn(),
      },
      applyRuntime,
    })

    await controller.refreshMission('mission-1')
    const colourController = controller as typeof controller & {
      updateImportColor?: (importId: string, color: string) => Promise<GpxTrackImport | null>
    }
    expect(colourController.updateImportColor).toBeTypeOf('function')
    await colourController.updateImportColor?.('gpx-1', '#F032E6')

    expect(updateGpxImportPresentation).toHaveBeenCalledWith(
      {
        id: 'gpx-1',
        mission_id: 'mission-1',
        metadata_json: JSON.stringify({ trackCount: 1, pointCount: 2, color: '#F032E6' }),
      },
    )
    expect(JSON.stringify(updateGpxImportPresentation.mock.calls)).not.toContain('coordinates')
    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        imports: [
          expect.objectContaining({
            id: 'gpx-1',
            metadata_json: JSON.stringify({ trackCount: 1, pointCount: 2, color: '#F032E6' }),
          }),
          expect.objectContaining({ id: 'gpx-2' }),
        ],
      }),
    )
  })

  it('settles a successful import across a same-mission outing refresh [AUD-05]', async () => {
    let resolveImport: ((value: { imports: readonly { id: string }[]; dispatchDurationMs: number }) => void) | undefined
    const imported = createStoredImport('gpx-a', 'mission-a')
    const listGpxImports = vi.fn().mockResolvedValue([])
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({
      gpxStore: { listGpxImports, upsertGpxImport: vi.fn(), deleteGpxImport: vi.fn(),
        importGpxEvidencePaths: () => new Promise((resolve) => { resolveImport = resolve }) },
      applyRuntime,
    })
    await controller.refreshMission('mission-a')
    const pending = controller.importPaths(['/tracks/a.gpx'])
    await controller.refreshMission('mission-a')
    listGpxImports.mockResolvedValue([imported])
    resolveImport?.({ imports: [{ id: imported.id }], dispatchDurationMs: 1 })
    await expect(pending).resolves.toMatchObject({ outcome: 'imported', imports: [{ id: imported.id }] })
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ importing: false, imports: [imported] }))
  })

  it('does not let an older outing refresh overwrite a completed import [AUD-05]', async () => {
    let resolveRefresh: ((value: readonly ReturnType<typeof createStoredImport>[]) => void) | undefined
    const imported = createStoredImport('gpx-a', 'mission-a')
    const listGpxImports = vi.fn().mockResolvedValue([])
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({
      gpxStore: { listGpxImports, upsertGpxImport: vi.fn(), deleteGpxImport: vi.fn(),
        importGpxEvidencePaths: vi.fn().mockResolvedValue({ imports: [{ id: imported.id }], dispatchDurationMs: 1 }) },
      applyRuntime,
    })
    await controller.refreshMission('mission-a')
    listGpxImports.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    const refresh = controller.refreshMission('mission-a')
    await vi.waitFor(() => expect(resolveRefresh).toBeDefined())
    listGpxImports.mockResolvedValue([imported])
    await controller.importPaths(['/tracks/a.gpx'])
    resolveRefresh?.([])
    await refresh
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ importing: false, imports: [imported] }))
  })

  it('retains the settled import error when an older outing refresh fails [DON-274]', async () => {
    let rejectRefresh: ((reason: Error) => void) | undefined
    const listGpxImports = vi.fn().mockResolvedValue([])
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({ gpxStore: {
      listGpxImports, upsertGpxImport: vi.fn(), deleteGpxImport: vi.fn(),
      importGpxEvidencePaths: vi.fn().mockRejectedValue(new Error('Import failed: source could not be retained.')),
    }, applyRuntime })
    await controller.refreshMission('mission-a')
    listGpxImports.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRefresh = reject }))
    const refresh = controller.refreshMission('mission-a')
    await vi.waitFor(() => expect(rejectRefresh).toBeDefined())
    await expect(controller.importPaths(['/tracks/a.gpx'])).rejects.toThrow('source could not be retained')
    rejectRefresh?.(new Error('Outing refresh unavailable.'))
    await refresh
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      importing: false, loading: false,
      error: expect.stringContaining('Import failed: source could not be retained.'),
    }))
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      error: expect.stringContaining('Outing refresh unavailable.'),
    }))
  })

  it('retains a newer import error when an older outing refresh succeeds [DON-274]', async () => {
    let resolveRefresh: ((value: readonly GpxTrackImport[]) => void) | undefined
    const listGpxImports = vi.fn().mockResolvedValue([])
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({ gpxStore: {
      listGpxImports, upsertGpxImport: vi.fn(), deleteGpxImport: vi.fn(),
      importGpxEvidencePaths: vi.fn().mockRejectedValue(new Error('Import transport unavailable.')),
    }, applyRuntime })
    await controller.refreshMission('mission-a')
    listGpxImports.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    const refresh = controller.refreshMission('mission-a')
    await vi.waitFor(() => expect(resolveRefresh).toBeDefined())

    await expect(controller.importPaths(['/tracks/a.gpx'])).rejects.toThrow('Import transport unavailable')
    resolveRefresh?.([])
    await refresh

    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      importing: false,
      error: 'Import transport unavailable.',
    }))
  })

  it('does not release another import when directory enumeration fails [DON-274]', async () => {
    let rejectScan: (error: Error) => void = () => { throw new Error('No scan') }
    let finishImport: (value: { imports: []; dispatchDurationMs: number }) => void = () => { throw new Error('No import') }
    const listDirectoryPaths = vi.fn().mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectScan = reject }))
    const importGpxEvidencePaths = vi.fn(() => new Promise<{ imports: []; dispatchDurationMs: number }>((resolve) => { finishImport = resolve }))
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({ gpxStore: {
      listGpxImports: vi.fn().mockResolvedValue([]), upsertGpxImport: vi.fn(), deleteGpxImport: vi.fn(),
      importGpxEvidencePaths,
    }, watchSource: { listDirectoryFiles: vi.fn(), listDirectoryPaths }, applyRuntime })
    await controller.refreshMission('mission-a')
    await controller.addWatchedDirectory('/watch')
    const scan = controller.rescanWatchedDirectories()
    const importing = controller.importPaths(['/tracks/a.gpx'])
    rejectScan(new Error('Directory unavailable'))
    await scan
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ importing: true }))
    await expect(controller.importPaths(['/tracks/b.gpx'])).resolves.toMatchObject({ outcome: 'refused' })
    expect(importGpxEvidencePaths).toHaveBeenCalledOnce()
    finishImport({ imports: [], dispatchDurationMs: 1 })
    await importing
  })

  it('retains a newer import failure when an older page rejects [DON-274]', async () => {
    let rejectPage: (error: Error) => void = () => { throw new Error('No page') }
    const listGpxImportPage = vi.fn().mockResolvedValueOnce({ entries: [], nextCursor: 'next' })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPage = reject }))
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({ gpxStore: {
      listGpxImports: vi.fn(), listGpxImportPage, upsertGpxImport: vi.fn(), deleteGpxImport: vi.fn(),
      importGpxEvidencePaths: vi.fn().mockRejectedValue(new Error('Import transport failed')),
    }, applyRuntime })
    await controller.refreshMission('mission-a')
    const page = controller.loadNextImports()
    await vi.waitFor(() => expect(listGpxImportPage).toHaveBeenCalledTimes(2))
    await expect(controller.importPaths(['/tracks/a.gpx'])).rejects.toThrow('Import transport failed')
    rejectPage(new Error('Page unavailable'))
    await page
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ error: expect.stringContaining('Import transport failed') }))
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ error: expect.stringContaining('Page unavailable') }))
  })

  it('keeps the first import busy when another caller attempts admission [AUD-05]', async () => {
    let resolveImport: ((value: { imports: readonly { id: string }[]; dispatchDurationMs: number }) => void) | undefined
    const applyRuntime = vi.fn()
    const importGpxEvidencePaths = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveImport = resolve }))
    const controller = await startGpxRuntime({ gpxStore: {
      listGpxImports: vi.fn().mockResolvedValue([]), upsertGpxImport: vi.fn(), deleteGpxImport: vi.fn(), importGpxEvidencePaths,
    }, applyRuntime })
    await controller.refreshMission('mission-a')
    const pending = controller.importPaths(['/tracks/a.gpx'])
    await expect(controller.importPaths(['/tracks/b.gpx'])).resolves.toEqual({ outcome: 'refused', imports: [] })
    expect(importGpxEvidencePaths).toHaveBeenCalledOnce()
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ importing: true, error: expect.stringContaining('Retry after it finishes') }))
    resolveImport?.({ imports: [], dispatchDurationMs: 1 })
    await pending
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ importing: false, error: null }))
  })

  it('returns an explicit refusal, clears the transient notice at settlement, and admits the next import [DON-274]', async () => {
    let resolveFirst: ((value: { imports: readonly { id: string }[]; dispatchDurationMs: number }) => void) | undefined
    const importGpxEvidencePaths = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce({ imports: [{ id: 'gpx-next' }], failures: [], dispatchDurationMs: 1 })
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({ gpxStore: {
      listGpxImports: vi.fn().mockResolvedValue([]), upsertGpxImport: vi.fn(), deleteGpxImport: vi.fn(), importGpxEvidencePaths,
    }, applyRuntime })
    await controller.refreshMission('mission-a')

    const first = controller.importPaths(['/tracks/first.gpx'])
    await vi.waitFor(() => expect(importGpxEvidencePaths).toHaveBeenCalledOnce())
    await expect(controller.importPaths(['/tracks/refused.gpx'])).resolves.toEqual({
      outcome: 'refused', imports: [],
    })
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      importing: true,
      error: expect.stringContaining('Another GPX import is in progress'),
    }))

    resolveFirst?.({ imports: [], dispatchDurationMs: 1 })
    await expect(first).resolves.toEqual({ outcome: 'empty', imports: [] })
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ importing: false, error: null }))

    await expect(controller.importPaths(['/tracks/next.gpx'])).resolves.toEqual({
      outcome: 'imported', imports: [{ id: 'gpx-next' }],
    })
    expect(importGpxEvidencePaths).toHaveBeenCalledTimes(2)
  })

  it('returns an explicit refusal when a watched rescan overlaps an active import [DON-274]', async () => {
    let resolveImport: ((value: { imports: readonly { id: string }[]; dispatchDurationMs: number }) => void) | undefined
    const importGpxEvidencePaths = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveImport = resolve }),
    )
    const listDirectoryPaths = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue(['/watch/a.gpx'])
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({ gpxStore: {
      listGpxImports: vi.fn().mockResolvedValue([]), upsertGpxImport: vi.fn(), deleteGpxImport: vi.fn(), importGpxEvidencePaths,
    }, watchSource: { listDirectoryFiles: vi.fn(), listDirectoryPaths }, applyRuntime })
    await controller.refreshMission('mission-a')
    await controller.addWatchedDirectory('/watch')
    const first = controller.importPaths(['/tracks/first.gpx'])
    await vi.waitFor(() => expect(importGpxEvidencePaths).toHaveBeenCalledOnce())

    await expect(controller.rescanWatchedDirectories()).resolves.toEqual({
      outcome: 'refused', imports: [],
    })
    expect(listDirectoryPaths).toHaveBeenCalledOnce()

    resolveImport?.({ imports: [], dispatchDurationMs: 1 })
    await first
  })

  it('continues a renderer batch after one file fails and reports the failed file [DON-274]', async () => {
    const upsertGpxImport = vi.fn().mockImplementation(async (input) => ({
      id: input.id ?? `gpx-${input.display_name}`,
      mission_id: input.mission_id,
      source_path: input.source_path,
      file_name: input.file_name,
      display_name: input.display_name,
      geometry_json: input.geometry_json,
      metadata_json: input.metadata_json ?? null,
      imported_at: '2026-04-11T10:00:00.000Z',
      updated_at: '2026-04-11T10:00:00.000Z',
    }))
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({ gpxStore: {
      listGpxImports: vi.fn().mockResolvedValue([]), upsertGpxImport, deleteGpxImport: vi.fn(),
    }, applyRuntime })
    await controller.refreshMission('mission-a')

    const failed = createImportFile('/tracks/bad.gpx', 'bad.gpx')
    const imported = await controller.importFiles([
      { ...failed, contents: '<gpx><trk>' },
      createImportFile('/tracks/good.gpx', 'good.gpx'),
    ])

    expect(imported).toEqual({
      outcome: 'imported',
      imports: [expect.objectContaining({ id: 'gpx-good' })],
      failures: [{ fileName: 'bad.gpx', reason: expect.any(String) }],
    })
    expect(upsertGpxImport).toHaveBeenCalledOnce()
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      importing: false,
      error: expect.stringContaining('bad.gpx'),
    }))
  })

  it('does not let a delayed page restore a deleted import [DON-274]', async () => {
    let resolvePage: ((value: { entries: GpxTrackImport[]; nextCursor: null }) => void) | undefined
    const existing = createStoredImport('gpx-delete', 'mission-a')
    const listGpxImportPage = vi.fn()
      .mockResolvedValueOnce({ entries: [existing], nextCursor: 'page-2' })
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePage = resolve }))
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({ gpxStore: {
      listGpxImports: vi.fn(), listGpxImportPage, upsertGpxImport: vi.fn(),
      deleteGpxImport: vi.fn().mockResolvedValue(true),
    }, applyRuntime })
    await controller.refreshMission('mission-a')

    const page = controller.loadNextImports()
    await vi.waitFor(() => expect(resolvePage).toBeDefined())
    await expect(controller.deleteImport(existing.id)).resolves.toBe(true)
    resolvePage?.({ entries: [existing], nextCursor: null })
    await page

    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ imports: [] }))
  })

  it('does not let a same-mission refresh restore a deleted import [DON-274]', async () => {
    let resolveRefresh: ((value: { entries: GpxTrackImport[]; nextCursor: null }) => void) | undefined
    const existing = createStoredImport('gpx-delete-refresh', 'mission-a')
    const listGpxImportPage = vi.fn()
      .mockResolvedValueOnce({ entries: [existing], nextCursor: null })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({ gpxStore: {
      listGpxImports: vi.fn(), listGpxImportPage, upsertGpxImport: vi.fn(),
      deleteGpxImport: vi.fn().mockResolvedValue(true),
    }, applyRuntime })
    await controller.refreshMission('mission-a')

    const refresh = controller.refreshMission('mission-a')
    await vi.waitFor(() => expect(resolveRefresh).toBeDefined())
    await expect(controller.deleteImport(existing.id)).resolves.toBe(true)
    resolveRefresh?.({ entries: [existing], nextCursor: null })
    await refresh

    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ imports: [] }))
  })

  it('does not cancel a held page when a native import settles with failures only [DON-274]', async () => {
    let resolvePage: ((value: { entries: GpxTrackImport[]; nextCursor: null }) => void) | undefined
    const existing = createStoredImport('gpx-failed-page', 'mission-a')
    const listGpxImportPage = vi.fn()
      .mockResolvedValueOnce({ entries: [existing], nextCursor: 'page-2' })
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePage = resolve }))
      .mockResolvedValue({ entries: [existing], nextCursor: 'page-2' })
    const importGpxEvidencePaths = vi.fn().mockResolvedValue({
      imports: [],
      failures: [{ sourcePath: '/tracks/failed.gpx', reason: 'invalid GPX' }],
      dispatchDurationMs: 1,
    })
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({ gpxStore: {
      listGpxImports: vi.fn(), listGpxImportPage, upsertGpxImport: vi.fn(),
      deleteGpxImport: vi.fn(), importGpxEvidencePaths,
    }, applyRuntime })
    await controller.refreshMission('mission-a')

    const page = controller.loadNextImports()
    await vi.waitFor(() => expect(resolvePage).toBeDefined())
    const importResult = await controller.importPaths(['/tracks/failed.gpx'])
    expect(importResult).toMatchObject({ outcome: 'failed', imports: [] })
    resolvePage?.({ entries: [existing], nextCursor: null })
    await page

    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      imports: [existing], importPageNumber: 2, loadingMoreImports: false,
    }))
  })

  it('does not let an older page overwrite a settled import [B-BROAD-02]', async () => {
    let resolvePage: ((value: { entries: GpxTrackImport[]; nextCursor: null }) => void) | undefined
    const imported = createStoredImport('new-import', 'mission-a')
    const listGpxImportPage = vi.fn().mockResolvedValue({ entries: [], nextCursor: 'page-2' })
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({ gpxStore: {
      listGpxImports: vi.fn(), listGpxImportPage, upsertGpxImport: vi.fn(), deleteGpxImport: vi.fn(),
      importGpxEvidencePaths: vi.fn().mockResolvedValue({ imports: [imported], dispatchDurationMs: 1 }),
    }, applyRuntime })
    await controller.refreshMission('mission-a')
    listGpxImportPage.mockImplementationOnce(() => new Promise((resolve) => { resolvePage = resolve }))
    const page = controller.loadNextImports()
    await vi.waitFor(() => expect(resolvePage).toBeDefined())
    listGpxImportPage.mockResolvedValue({ entries: [imported], nextCursor: null })
    await controller.importPaths(['/new.gpx'])
    resolvePage?.({ entries: [], nextCursor: null })
    await page
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ imports: [imported], importPageNumber: 1, loadingMoreImports: false }))
  })

  it.each([false, true])('settles import failure across outing refresh, returned-to-mission=%s [AUD-05]', async (switchAway) => {
    let rejectImport: ((reason: Error) => void) | undefined
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({
      gpxStore: { listGpxImports: vi.fn().mockResolvedValue([]), upsertGpxImport: vi.fn(), deleteGpxImport: vi.fn(),
        importGpxEvidencePaths: () => new Promise((_resolve, reject) => { rejectImport = reject }) }, applyRuntime,
    })
    await controller.refreshMission('mission-a')
    const pending = controller.importPaths(['/tracks/a.gpx'])
    if (switchAway) await controller.refreshMission('mission-b')
    await controller.refreshMission('mission-a')
    const assertion = switchAway ? expect(pending).resolves.toMatchObject({ outcome: 'stale', imports: [] }) : expect(pending).rejects.toThrow('disk failure')
    rejectImport?.(new Error('disk failure'))
    await assertion
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ importing: false, error: switchAway ? null : 'disk failure' }))
  })

  it('does not publish a completed path import after the active mission changes [DON-274]', async () => {
    let resolveImport: ((value: { imports: readonly { id: string }[]; dispatchDurationMs: number }) => void) | undefined
    const importGpxEvidencePaths = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveImport = resolve }),
    )
    const missionAImport = createStoredImport('gpx-a', 'mission-a')
    const missionBImport = createStoredImport('gpx-b', 'mission-b')
    const listGpxImports = vi.fn().mockImplementation(async (missionId: string) =>
      missionId === 'mission-a' ? [missionAImport] : [missionBImport])
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports,
        upsertGpxImport: vi.fn(),
        deleteGpxImport: vi.fn(),
        importGpxEvidencePaths,
      },
      applyRuntime,
    })
    await controller.refreshMission('mission-a')

    const pendingImport = controller.importPaths(['/tracks/a.gpx'])
    await vi.waitFor(() => expect(importGpxEvidencePaths).toHaveBeenCalledOnce())
    await controller.refreshMission('mission-b')
    resolveImport?.({ imports: [{ id: missionAImport.id }], dispatchDurationMs: 1 })
    await pendingImport

    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      activeMissionId: 'mission-b',
      imports: [missionBImport],
      importing: false,
    }))
  })

  it('discards watched-directory paths enumerated for a mission that is no longer active [DON-274]', async () => {
    let resolvePaths: ((paths: readonly string[]) => void) | undefined
    const listDirectoryPaths = vi.fn().mockImplementation(
      () => new Promise<readonly string[]>((resolve) => { resolvePaths = resolve }),
    )
    const importGpxEvidencePaths = vi.fn().mockResolvedValue({
      imports: [],
      failures: [],
      dispatchDurationMs: 1,
    })
    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports: vi.fn().mockResolvedValue([]),
        upsertGpxImport: vi.fn(),
        deleteGpxImport: vi.fn(),
        importGpxEvidencePaths,
      },
      watchSource: {
        listDirectoryFiles: vi.fn(),
        listDirectoryPaths,
      },
      applyRuntime: vi.fn(),
    })
    await controller.refreshMission('mission-a')

    const pendingEnumeration = controller.addWatchedDirectory('/mission-a-watch')
    await vi.waitFor(() => expect(listDirectoryPaths).toHaveBeenCalledOnce())
    await controller.refreshMission('mission-b')
    resolvePaths?.(['/mission-a-watch/alpha.gpx'])
    await pendingEnumeration

    expect(importGpxEvidencePaths).not.toHaveBeenCalled()
  })

  it('discards rescanned paths when the mission changes during directory enumeration [DON-274]', async () => {
    let resolveRescan: ((paths: readonly string[]) => void) | undefined
    const listDirectoryPaths = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise<readonly string[]>((resolve) => {
        resolveRescan = resolve
      }))
    const importGpxEvidencePaths = vi.fn().mockResolvedValue({
      imports: [],
      failures: [],
      dispatchDurationMs: 1,
    })
    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports: vi.fn().mockResolvedValue([]),
        upsertGpxImport: vi.fn(),
        deleteGpxImport: vi.fn(),
        importGpxEvidencePaths,
      },
      watchSource: {
        listDirectoryFiles: vi.fn(),
        listDirectoryPaths,
      },
      applyRuntime: vi.fn(),
    })
    await controller.refreshMission('mission-a')
    await controller.addWatchedDirectory('/mission-a-watch')

    const pendingRescan = controller.rescanWatchedDirectories()
    await vi.waitFor(() => expect(listDirectoryPaths).toHaveBeenCalledTimes(2))
    await controller.refreshMission('mission-b')
    resolveRescan?.(['/mission-a-watch/alpha.gpx'])
    await pendingRescan

    expect(importGpxEvidencePaths).not.toHaveBeenCalled()
  })

  it('does not publish a completed renderer-file import after the active mission changes [DON-274]', async () => {
    let resolveUpsert: ((value: GpxTrackImport) => void) | undefined
    const missionAImport = createStoredImport('gpx-a', 'mission-a')
    const missionBImport = createStoredImport('gpx-b', 'mission-b')
    const upsertGpxImport = vi.fn().mockImplementation(
      () => new Promise<GpxTrackImport>((resolve) => { resolveUpsert = resolve }),
    )
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports: vi.fn().mockImplementation(async (missionId: string) =>
          missionId === 'mission-b' ? [missionBImport] : []),
        upsertGpxImport,
        deleteGpxImport: vi.fn(),
      },
      applyRuntime,
    })
    await controller.refreshMission('mission-a')

    const pendingImport = controller.importFiles([createImportFile('/tracks/a.gpx', 'a.gpx')])
    await vi.waitFor(() => expect(upsertGpxImport).toHaveBeenCalledOnce())
    await controller.refreshMission('mission-b')
    resolveUpsert?.(missionAImport)
    await pendingImport

    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      activeMissionId: 'mission-b',
      imports: [missionBImport],
      importing: false,
    }))
  })

  it('replaces a same-path GPX revision in renderer state instead of duplicating its identity [DON-274]', async () => {
    const existing = { ...createStoredImport('gpx-a', 'mission-a'), content_sha256: 'old-hash' }
    const revised = {
      ...existing,
      display_name: 'Revised track',
      content_sha256: 'new-hash',
      revision_sequence: 2,
    }
    const applyRuntime = vi.fn()
    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports: vi.fn().mockResolvedValue([existing]),
        upsertGpxImport: vi.fn().mockResolvedValue(revised),
        deleteGpxImport: vi.fn(),
      },
      applyRuntime,
    })
    await controller.refreshMission('mission-a')

    await controller.importFiles([createImportFile(existing.source_path, existing.file_name)])

    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      imports: [revised],
    }))
  })
})

function createStoredImport(id: string, missionId: string): GpxTrackImport {
  return {
    id,
    mission_id: missionId,
    source_path: `/tracks/${id}.gpx`,
    file_name: `${id}.gpx`,
    display_name: id,
    geometry_json: '{"type":"MultiLineString","coordinates":[]}',
    metadata_json: null,
    imported_at: '2026-04-11T10:00:00.000Z',
    updated_at: '2026-04-11T10:00:00.000Z',
  }
}

function createImportFile(sourcePath: string, fileName: string) {
  return {
    sourcePath,
    fileName,
    contents: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="vitest">
  <trk>
    <name>${fileName}</name>
    <trkseg>
      <trkpt lat="52.0000" lon="-9.7000"></trkpt>
      <trkpt lat="52.0100" lon="-9.7100"></trkpt>
    </trkseg>
  </trk>
</gpx>`,
  }
}
