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

  it('loads GPX renderer projections through bounded pages instead of the unbounded evidence API [DON-274]', async () => {
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
    expect(listGpxImportPage).toHaveBeenNthCalledWith(1, {
      missionId: 'mission-1', limit: 25,
    })
    expect(listGpxImportPage).toHaveBeenNthCalledWith(2, {
      missionId: 'mission-1', cursor: 'page-2', limit: 25,
    })
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ imports }))
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
