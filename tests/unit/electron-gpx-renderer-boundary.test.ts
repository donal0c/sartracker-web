import { createRequire } from 'node:module'

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  compactGpxDisplayGeometry,
  listGpxImportProjectionPage,
  listGpxImportRevisionProjectionPage,
  packGpxRendererPage,
} = require('../../electron/gpx-renderer-boundary.cjs') as {
  readonly compactGpxDisplayGeometry: (geometryJson: string) => string
  readonly packGpxRendererPage: (
    rows: readonly Readonly<Record<string, unknown>>[],
    options?: { readonly limit?: number; readonly byteLimit?: number },
  ) => {
    readonly entries: readonly Readonly<Record<string, unknown>>[]
    readonly hasMore: boolean
  }
  readonly listGpxImportProjectionPage: (
    db: TestDatabase,
    input: { readonly missionId: string; readonly cursor?: string; readonly limit?: number },
  ) => { readonly entries: readonly Readonly<Record<string, unknown>>[]; readonly nextCursor: string | null }
  readonly listGpxImportRevisionProjectionPage: (
    db: TestDatabase,
    input: { readonly importId: string; readonly cursor?: string; readonly limit?: number },
  ) => { readonly entries: readonly Readonly<Record<string, unknown>>[]; readonly nextCursor: string | null }
}

const Database = require('better-sqlite3') as new (path: string) => TestDatabase

type TestDatabase = {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => {
    readonly run: (...params: readonly unknown[]) => unknown
  }
  readonly close: () => void
}

describe('GPX renderer containment boundary [DON-274]', () => {
  it('builds a bounded display geometry without mutating exact source-point evidence', () => {
    const coordinates = Array.from({ length: 120_000 }, (_unused, index) => [
      -9.7 + index / 10_000_000,
      52 + index / 10_000_000,
    ])
    const exactGeometry = JSON.stringify({ type: 'MultiLineString', coordinates: [coordinates] })

    const displayGeometry = compactGpxDisplayGeometry(exactGeometry)
    const parsed = JSON.parse(displayGeometry) as {
      readonly coordinates: readonly (readonly (readonly number[])[])[]
    }

    expect(Buffer.byteLength(displayGeometry, 'utf8')).toBeLessThanOrEqual(384 * 1024)
    expect(parsed.coordinates[0]?.[0]).toEqual(coordinates[0])
    expect(parsed.coordinates[0]?.at(-1)).toEqual(coordinates.at(-1))
    expect(parsed.coordinates[0]?.length).toBeLessThan(coordinates.length)
    expect(coordinates).toHaveLength(120_000)
  })

  it('packs projected imports into a strict response-byte budget and signals continuation', () => {
    const rows = Array.from({ length: 20 }, (_unused, index) => ({
      id: `gpx-${index.toString().padStart(2, '0')}`,
      mission_id: 'mission-1',
      display_name: `Track ${index}`,
      geometry_json: JSON.stringify({
        type: 'MultiLineString',
        coordinates: [[[-9.7, 52], [-9.71, 52.01]]],
      }),
      metadata_json: JSON.stringify({ note: 'x'.repeat(1_500) }),
    }))

    const page = packGpxRendererPage(rows, { limit: 20, byteLimit: 8 * 1024 })

    expect(page.entries.length).toBeGreaterThan(0)
    expect(page.entries.length).toBeLessThan(rows.length)
    expect(page.hasMore).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThanOrEqual(8 * 1024)
  })

  it('rejects exact retained bytes from renderer projections', () => {
    expect(() => packGpxRendererPage([{
      id: 'gpx-unsafe',
      source_bytes_base64: 'c2Vuc2l0aXZl',
      geometry_json: '{"type":"MultiLineString","coordinates":[]}',
    }])).toThrow(/renderer projection/i)
  })

  it('keyset-pages projected imports and revisions without retained bytes', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE gpx_track_imports (
        id TEXT PRIMARY KEY, mission_id TEXT, source_path TEXT, file_name TEXT,
        display_name TEXT, geometry_json TEXT, metadata_json TEXT,
        content_sha256 TEXT, source_bytes_base64 TEXT, timing_class TEXT,
        outing_id TEXT, revision_sequence INTEGER, retired_at TEXT,
        retired_by TEXT, import_state TEXT, imported_at TEXT, updated_at TEXT
      );
      CREATE TABLE gpx_import_revisions (
        id TEXT PRIMARY KEY, mission_id TEXT, import_id TEXT,
        revision_sequence INTEGER, content_sha256 TEXT,
        source_bytes_base64 TEXT, source_path TEXT, file_name TEXT,
        display_name TEXT, geometry_json TEXT, metadata_json TEXT,
        timing_class TEXT, outing_id TEXT, import_state TEXT,
        completeness TEXT, recorded_at TEXT, audit_event_id TEXT
      );
    `)
    const geometry = '{"type":"MultiLineString","coordinates":[]}'
    for (let index = 0; index < 3; index += 1) {
      const id = `gpx-${index}`
      db.prepare(`INSERT INTO gpx_track_imports VALUES (
        ?, 'mission-1', ?, ?, ?, ?, NULL, ?, 'retained-bytes', 'fully_dated',
        NULL, 1, NULL, NULL, 'complete', ?, ?
      )`).run(
        id,
        `/field/${id}.gpx`,
        `${id}.gpx`,
        `Track ${index}`,
        geometry,
        `sha-${index}`,
        `2026-08-27T10:0${index}:00.000Z`,
        `2026-08-27T10:0${index}:00.000Z`,
      )
      db.prepare(`INSERT INTO gpx_import_revisions VALUES (
        ?, 'mission-1', ?, ?, ?, 'retained-bytes', ?, ?, ?, ?, NULL,
        'fully_dated', NULL, 'complete', 'complete', ?, ?
      )`).run(
        `revision-${index}`,
        id,
        index + 1,
        `sha-${index}`,
        `/field/${id}.gpx`,
        `${id}.gpx`,
        `Track ${index}`,
        geometry,
        `2026-08-27T10:0${index}:00.000Z`,
        `event-${index}`,
      )
    }

    const first = listGpxImportProjectionPage(db, { missionId: 'mission-1', limit: 2 })
    const second = listGpxImportProjectionPage(db, {
      missionId: 'mission-1', cursor: first.nextCursor ?? undefined, limit: 2,
    })
    const revisions = listGpxImportRevisionProjectionPage(db, { importId: 'gpx-0', limit: 10 })

    expect(first.entries).toHaveLength(2)
    expect(second.entries).toHaveLength(1)
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(second.nextCursor).toBeNull()
    expect(JSON.stringify({ first, second, revisions })).not.toContain('retained-bytes')
    expect(revisions.entries[0]).not.toHaveProperty('geometry_json')
    db.close()
  })

  it('exposes only paged GPX reads and small presentation writes through preload', () => {
    const preload = readFileSync('electron/preload.cjs', 'utf8')
    const main = readFileSync('electron/main.cjs', 'utf8')

    expect(preload).toContain("listGpxImportPage: 'sartracker:mission-store:list-gpx-import-page'")
    expect(preload).toContain("listGpxImportRevisionPage: 'sartracker:mission-store:list-gpx-import-revision-page'")
    expect(preload).toContain("updateGpxImportPresentation: 'sartracker:mission-store:update-gpx-import-presentation'")
    expect(preload).not.toContain('upsertGpxImport:')
    expect(preload).not.toContain('listGpxImports:')
    expect(preload).not.toContain('listGpxImportRevisions:')
    expect(preload).not.toContain('readGpxFiles(')
    expect(preload).not.toContain('listGpxDirectoryFiles(')
    expect(main).not.toContain("'sartracker:read-gpx-files'")
    expect(main).not.toContain("'sartracker:list-gpx-directory-files'")
  })
})
