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
    const upsertGpxImport = vi.fn().mockImplementation(async (input) => ({
      ...imports.find((entry) => entry.id === input.id),
      ...input,
      metadata_json: input.metadata_json ?? null,
      imported_at: '2026-04-11T10:00:00.000Z',
      updated_at: '2026-04-11T10:05:00.000Z',
    }))
    const controller = await startGpxRuntime({
      gpxStore: {
        listGpxImports: vi.fn().mockResolvedValue(imports),
        upsertGpxImport,
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

    expect(upsertGpxImport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'gpx-1',
        mission_id: 'mission-1',
        source_path: '/tracks/alpha.gpx',
        display_name: 'Alpha Route',
        geometry_json: imports[0]!.geometry_json,
        metadata_json: JSON.stringify({ trackCount: 1, pointCount: 2, color: '#F032E6' }),
      }),
    )
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
})

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
