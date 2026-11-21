import { createRequire } from 'node:module'

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  compactGpxDisplayGeometry,
  listGpxImportProjectionPage,
  listGpxImportRevisionProjectionPage,
  listGpxMapProjectionPage,
  MAP_TOTAL_BYTE_BUDGET,
  packGpxRendererPage,
} = require('../../electron/gpx-renderer-boundary.cjs') as {
  readonly MAP_TOTAL_BYTE_BUDGET: number
  readonly listGpxMapProjectionPage: (
    db: TestDatabase,
    input: { readonly missionId: string; readonly cursor?: string },
  ) => {
    readonly entries: readonly Readonly<Record<string, unknown>>[]
    readonly nextCursor: string | null
    readonly totalActive: number
    readonly undrawn: readonly { readonly id: string; readonly display_name: string; readonly reason: string }[]
    readonly truncated: boolean
  }
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

  it('rejects import and revision cursors outside the context that issued them', () => {
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
      INSERT INTO gpx_track_imports VALUES
        ('mission-1-a', 'mission-1', '/field/a.gpx', 'a.gpx', 'Track A',
          '{"type":"MultiLineString","coordinates":[]}', NULL, 'sha-a', NULL,
          'fully_dated', NULL, 2, NULL, NULL, 'complete',
          '2026-08-27T10:00:00.000Z', '2026-08-27T10:00:00.000Z'),
        ('mission-1-b', 'mission-1', '/field/b.gpx', 'b.gpx', 'Track B',
          '{"type":"MultiLineString","coordinates":[]}', NULL, 'sha-b', NULL,
          'fully_dated', NULL, 1, NULL, NULL, 'complete',
          '2026-08-27T10:01:00.000Z', '2026-08-27T10:01:00.000Z'),
        ('mission-2-a', 'mission-2', '/field/c.gpx', 'c.gpx', 'Track C',
          '{"type":"MultiLineString","coordinates":[]}', NULL, 'sha-c', NULL,
          'fully_dated', NULL, 1, NULL, NULL, 'complete',
          '2026-08-27T10:02:00.000Z', '2026-08-27T10:02:00.000Z');
      INSERT INTO gpx_import_revisions VALUES
        ('revision-a-1', 'mission-1', 'mission-1-a', 1, 'sha-a1', NULL,
          '/field/a.gpx', 'a.gpx', 'Track A',
          '{"type":"MultiLineString","coordinates":[]}', NULL, 'fully_dated',
          NULL, 'complete', 'complete', '2026-08-27T10:00:00.000Z', 'event-a-1'),
        ('revision-a-2', 'mission-1', 'mission-1-a', 2, 'sha-a2', NULL,
          '/field/a.gpx', 'a.gpx', 'Track A',
          '{"type":"MultiLineString","coordinates":[]}', NULL, 'fully_dated',
          NULL, 'complete', 'complete', '2026-08-27T10:01:00.000Z', 'event-a-2'),
        ('revision-b-1', 'mission-1', 'mission-1-b', 1, 'sha-b1', NULL,
          '/field/b.gpx', 'b.gpx', 'Track B',
          '{"type":"MultiLineString","coordinates":[]}', NULL, 'fully_dated',
          NULL, 'complete', 'complete', '2026-08-27T10:00:00.000Z', 'event-b-1'),
        ('revision-b-2', 'mission-1', 'mission-1-b', 2, 'sha-b2', NULL,
          '/field/b.gpx', 'b.gpx', 'Track B',
          '{"type":"MultiLineString","coordinates":[]}', NULL, 'fully_dated',
          NULL, 'complete', 'complete', '2026-08-27T10:01:00.000Z', 'event-b-2'),
        ('revision-c-1', 'mission-2', 'mission-2-a', 1, 'sha-c1', NULL,
          '/field/c.gpx', 'c.gpx', 'Track C',
          '{"type":"MultiLineString","coordinates":[]}', NULL, 'fully_dated',
          NULL, 'complete', 'complete', '2026-08-27T10:02:00.000Z', 'event-c-1');
    `)

    const importCursor = listGpxImportProjectionPage(db, {
      missionId: 'mission-1', limit: 1,
    }).nextCursor
    const revisionCursor = listGpxImportRevisionProjectionPage(db, {
      importId: 'mission-1-a', limit: 1,
    }).nextCursor

    expect(importCursor).toEqual(expect.any(String))
    expect(revisionCursor).toEqual(expect.any(String))
    expect(() => listGpxImportProjectionPage(db, {
      missionId: 'mission-2', cursor: importCursor ?? undefined, limit: 1,
    })).toThrow('GPX renderer page cursor is invalid.')
    expect(() => listGpxImportRevisionProjectionPage(db, {
      importId: 'mission-1-b', cursor: revisionCursor ?? undefined, limit: 1,
    })).toThrow('GPX renderer page cursor is invalid.')
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

  describe('map projection covers every imported track [DON-350] [M-87]', () => {
    const SCHEMA = `
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
    `

    /** A day-long track at 1-2 s logging with 10-decimal coordinates, already display-compacted to 384 KiB. */
    function largeTrackGeometry(seed: number): string {
      const coordinates = Array.from({ length: 10_800 }, (_unused, index) => [
        Number((-9.7 + seed / 100 + index / 1_000_000).toFixed(10)) + 0.0000000001,
        Number((52 + seed / 100 + index / 1_000_000).toFixed(10)) + 0.0000000001,
      ])
      return compactGpxDisplayGeometry(JSON.stringify({ type: 'MultiLineString', coordinates: [coordinates] }))
    }

    function seedImports(db: TestDatabase, geometries: readonly string[], retiredIndexes: readonly number[] = []) {
      geometries.forEach((geometry, index) => {
        const id = `gpx-${String(index).padStart(3, '0')}`
        const at = new Date(Date.UTC(2026, 7, 27, 10, 0, index)).toISOString()
        db.prepare(`INSERT INTO gpx_track_imports VALUES (
          ?, 'mission-1', ?, ?, ?, ?, NULL, ?, 'retained-bytes', 'fully_dated',
          NULL, 1, ?, NULL, 'complete', ?, ?
        )`).run(id, `/field/${id}.gpx`, `${id}.gpx`, `Team ${id}`, geometry, `sha-${index}`,
          retiredIndexes.includes(index) ? at : null, at, at)
        db.prepare(`INSERT INTO gpx_import_revisions VALUES (
          ?, 'mission-1', ?, 1, ?, 'retained-bytes', ?, ?, ?, ?, NULL,
          'fully_dated', NULL, 'complete', 'complete', ?, ?
        )`).run(`revision-${id}`, id, `sha-${index}`, `/field/${id}.gpx`, `${id}.gpx`, `Team ${id}`,
          geometry, at, `event-${id}`)
      })
    }

    function drainMap(db: TestDatabase) {
      const entries: Readonly<Record<string, unknown>>[] = []
      const undrawn: { readonly id: string }[] = []
      let cursor: string | undefined
      let totalActive = 0
      let truncated = false
      for (let pages = 0; pages < 1_000; pages += 1) {
        const page = listGpxMapProjectionPage(db, { missionId: 'mission-1', ...(cursor === undefined ? {} : { cursor }) })
        expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThanOrEqual(1024 * 1024)
        entries.push(...page.entries)
        undrawn.push(...page.undrawn)
        totalActive = page.totalActive
        truncated ||= page.truncated
        if (page.nextCursor === null) return { entries, undrawn, totalActive, truncated }
        cursor = page.nextCursor
      }
      throw new Error('Map projection did not terminate.')
    }

    it('draws all six large team tracks although one list page holds only a few', () => {
      const db = new Database(':memory:')
      db.exec(SCHEMA)
      seedImports(db, Array.from({ length: 6 }, (_unused, index) => largeTrackGeometry(index)))

      const listPage = listGpxImportProjectionPage(db, { missionId: 'mission-1' })
      expect(listPage.entries.length).toBeLessThan(6)

      const map = drainMap(db)
      expect(map.entries.map((entry) => entry.id)).toEqual(
        Array.from({ length: 6 }, (_unused, index) => `gpx-${String(index).padStart(3, '0')}`))
      expect(map.totalActive).toBe(6)
      expect(map.undrawn).toEqual([])
      expect(map.truncated).toBe(false)
      expect(JSON.stringify(map)).not.toContain('retained-bytes')
      const drawnBytes = map.entries.reduce((sum, entry) => sum + Buffer.byteLength(String(entry.geometry_json), 'utf8'), 0)
      expect(drawnBytes).toBeLessThanOrEqual(MAP_TOTAL_BYTE_BUDGET)
      db.close()
    })

    it('shares the mission-wide budget across many tracks and keeps every endpoint', () => {
      const db = new Database(':memory:')
      db.exec(SCHEMA)
      const geometries = Array.from({ length: 40 }, (_unused, index) => largeTrackGeometry(index))
      seedImports(db, geometries, [39])

      const map = drainMap(db)
      expect(map.entries).toHaveLength(39)
      expect(map.totalActive).toBe(39)
      const drawnBytes = map.entries.reduce((sum, entry) => sum + Buffer.byteLength(String(entry.geometry_json), 'utf8'), 0)
      expect(drawnBytes).toBeLessThanOrEqual(MAP_TOTAL_BYTE_BUDGET)
      const first = JSON.parse(String(map.entries[0]!.geometry_json)) as { coordinates: number[][][] }
      const source = JSON.parse(geometries[0]!) as { coordinates: number[][][] }
      expect(first.coordinates[0]![0]).toEqual(source.coordinates[0]![0])
      expect(first.coordinates[0]!.at(-1)).toEqual(source.coordinates[0]!.at(-1))
      db.close()
    })

    it('reports tracks beyond the map cap as not drawn rather than dropping them silently', () => {
      const db = new Database(':memory:')
      db.exec(SCHEMA)
      const tiny = '{"type":"MultiLineString","coordinates":[[[-9.7,52],[-9.71,52.01]]]}'
      seedImports(db, Array.from({ length: 520 }, () => tiny))

      const map = drainMap(db)
      expect(map.totalActive).toBe(520)
      expect(map.entries).toHaveLength(512)
      expect(map.truncated).toBe(true)
      db.close()
    })

    it('names a track it cannot draw instead of leaving it silently off the map', () => {
      const db = new Database(':memory:')
      db.exec(SCHEMA)
      // Thousands of two-point segments cannot be thinned without hiding whole segments.
      const fragmented = JSON.stringify({
        type: 'MultiLineString',
        coordinates: Array.from({ length: 20_000 }, (_unused, index) => [
          [-9.7 + index / 100_000, 52], [-9.7 + index / 100_000, 52.0001],
        ]),
      })
      seedImports(db, [...Array.from({ length: 30 }, (_unused, index) => largeTrackGeometry(index)), fragmented])

      const map = drainMap(db)
      expect(map.totalActive).toBe(31)
      expect(map.entries).toHaveLength(30)
      expect(map.undrawn).toEqual([expect.objectContaining({ id: 'gpx-030', display_name: 'Team gpx-030' })])
      db.close()
    })
  })
})
