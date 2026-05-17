import { describe, expect, it } from 'vitest'

import { findNearestGpxImportId } from '../../src/features/gpx/gpx-hit-testing'
import type { GpxTrackImport } from '../../src/infrastructure/mission-store/tauri-mission-store'

const projectingMap = {
  project: ({ lng, lat }: { lng: number; lat: number }) => ({ x: lng * 10, y: lat * 10 }),
} as never

describe('findNearestGpxImportId', () => {
  it('selects the nearest GPX track segment within the selection radius', () => {
    const importId = findNearestGpxImportId(
      projectingMap,
      { x: 110, y: 110 },
      [
        createMultiLineImport('track-near', [[[10, 10], [12, 12]]]),
        createMultiLineImport('track-far', [[[20, 20], [21, 21]]]),
      ],
    )

    expect(importId).toBe('track-near')
  })

  it('returns null when no GPX track is within the selection radius', () => {
    const importId = findNearestGpxImportId(
      projectingMap,
      { x: 300, y: 300 },
      [createMultiLineImport('track-far', [[[10, 10], [12, 12]]])],
    )

    expect(importId).toBeNull()
  })

  it('walks every line string in a MultiLineString geometry', () => {
    const importId = findNearestGpxImportId(
      projectingMap,
      { x: 152, y: 152 },
      [
        createMultiLineImport('multi-track', [
          [[10, 10], [12, 12]],
          [[15, 15], [16, 16]],
        ]),
      ],
    )

    expect(importId).toBe('multi-track')
  })

  it('prefers the closer GPX track when multiple candidates fall within the radius', () => {
    const importId = findNearestGpxImportId(
      projectingMap,
      { x: 110, y: 110 },
      [
        createMultiLineImport('track-far', [[[10, 13], [12, 13]]]),
        createMultiLineImport('track-near', [[[10, 11], [12, 11]]]),
      ],
    )

    expect(importId).toBe('track-near')
  })

  it('gracefully handles GPX imports with malformed geometry_json', () => {
    const importId = findNearestGpxImportId(
      projectingMap,
      { x: 110, y: 110 },
      [
        { ...createMultiLineImport('broken', [[[10, 10], [12, 12]]]), geometry_json: '{not-json' },
        createMultiLineImport('track-near', [[[10, 11], [12, 11]]]),
      ],
    )

    expect(importId).toBe('track-near')
  })

  it('ignores GPX imports whose geometry is not a MultiLineString', () => {
    const importId = findNearestGpxImportId(
      projectingMap,
      { x: 110, y: 110 },
      [
        {
          ...createMultiLineImport('not-a-line', [[[10, 10], [12, 12]]]),
          geometry_json: JSON.stringify({ type: 'Point', coordinates: [11, 11] }),
        },
      ],
    )

    expect(importId).toBeNull()
  })

  it('ignores degenerate line strings that do not have at least two points', () => {
    const importId = findNearestGpxImportId(
      projectingMap,
      { x: 110, y: 110 },
      [createMultiLineImport('degenerate', [[[11, 11]]])],
    )

    expect(importId).toBeNull()
  })
})

function createMultiLineImport(
  id: string,
  lineStrings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
): GpxTrackImport {
  return {
    id,
    mission_id: 'mission-1',
    source_path: `/tmp/${id}.gpx`,
    file_name: `${id}.gpx`,
    display_name: id,
    geometry_json: JSON.stringify({
      type: 'MultiLineString',
      coordinates: lineStrings.map((line) => line.map(([lng, lat]) => [lng, lat])),
    }),
    metadata_json: null,
    imported_at: '2026-04-10T10:00:00.000Z',
    updated_at: '2026-04-10T10:00:00.000Z',
  }
}
