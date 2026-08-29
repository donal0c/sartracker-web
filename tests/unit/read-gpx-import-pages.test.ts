import { describe, expect, it, vi } from 'vitest'

import { readGpxImportProjectionPage } from '../../src/features/gpx/read-gpx-import-pages'

describe('readGpxImportProjectionPage', () => {
  it('reads only one bounded page and preserves the continuation cursor [DON-274]', async () => {
    const entry = {
      id: 'gpx-1', mission_id: 'mission-1', source_path: '/field/track.gpx',
      file_name: 'track.gpx', display_name: 'Track',
      geometry_json: '{"type":"MultiLineString","coordinates":[]}', metadata_json: null,
      imported_at: '2026-08-28T10:00:00.000Z', updated_at: '2026-08-28T10:00:00.000Z',
    }
    const listGpxImportPage = vi.fn().mockResolvedValue({
      entries: [entry],
      nextCursor: 'next-page',
    })

    await expect(readGpxImportProjectionPage({
      listGpxImports: vi.fn().mockRejectedValue(new Error('must not drain legacy list')),
      listGpxImportPage,
    }, 'mission-1')).resolves.toEqual({ entries: [entry], nextCursor: 'next-page' })
    expect(listGpxImportPage).toHaveBeenCalledOnce()
  })

  it('rejects retained source bytes before publishing the page', async () => {
    await expect(readGpxImportProjectionPage({
      listGpxImports: vi.fn(),
      listGpxImportPage: vi.fn().mockResolvedValue({
        entries: [{ source_bytes_base64: 'retained-secret' }],
        nextCursor: null,
      }),
    // Deliberately malformed data verifies the runtime boundary.
    } as never, 'mission-1')).rejects.toThrow(/retained source bytes/i)
  })
})
