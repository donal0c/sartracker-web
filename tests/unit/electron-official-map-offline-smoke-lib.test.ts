import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildOfficialMapPackageSettings,
  buildSafeEvidenceSummary,
  findFirstMbtilesTile,
  sanitizeEvidenceText,
} from '../../build/electron-official-map-offline-smoke-lib.js'

const tempRoots: string[] = []

describe('electron official map offline smoke helpers', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('builds ready official package settings from MBTiles metadata', () => {
    const root = createTempRoot()
    const packagePath = path.join(root, 'private', 'reeks-standard-60km-z16.mbtiles')
    createMbtilesPackage(packagePath)

    const settings = buildOfficialMapPackageSettings({
      mapId: 'official_discovery_topo',
      packagePath,
      now: new Date('2026-06-05T12:00:00Z'),
    })

    expect(settings).toMatchObject({
      sourceType: 'mbtiles',
      mapId: 'official_discovery_topo',
      packagePath,
      status: 'ready',
      bounds: [-10.175460623443264, 51.73001713921637, -9.334212588012356, 52.27002059777089],
      minZoom: 16,
      maxZoom: 16,
      tileCount: 1,
      tileFormat: 'png',
      verifiedAt: '2026-06-05T12:00:00.000Z',
    })
    expect(settings.id).toMatch(/^official_discovery_topo-[a-f0-9]{12}$/u)
  })

  it('finds a requestable XYZ tile from an MBTiles package', () => {
    const root = createTempRoot()
    const packagePath = path.join(root, 'reeks.mbtiles')
    createMbtilesPackage(packagePath)

    expect(findFirstMbtilesTile(packagePath)).toEqual({
      z: 16,
      x: 31068,
      y: 21682,
    })
  })

  it('redacts private filesystem paths from evidence summaries', () => {
    const privatePackagePath =
      '/Users/donalocallaghan/SARTracker-private-map-assets/don-103-mbtiles-spike/packages/reeks-standard-60km-z16.mbtiles'
    const summary = buildSafeEvidenceSummary({
      appPath: '/Applications/SAR Tracker Electron Validation.app/Contents/MacOS/SAR Tracker Electron Validation',
      diagnosticsReport: `official map package path ${privatePackagePath}`,
      packagePath: privatePackagePath,
      platform: 'darwin',
      tile: { z: 16, x: 31068, y: 21682 },
      tileBytes: 822,
    })

    expect(JSON.stringify(summary)).not.toContain(privatePackagePath)
    expect(summary.packageBasename).toBe('reeks-standard-60km-z16.mbtiles')
    expect(summary.diagnosticsReport).toContain('[redacted-map-package-path]')
  })

  it('sanitizes path-like private map package text', () => {
    expect(
      sanitizeEvidenceText(
        'opened C:\\Users\\donal\\SARTracker-private-map-assets\\packages\\reeks.mbtiles and /home/donal/private/reeks.mbtiles',
      ),
    ).toBe(
      'opened [redacted-map-package-path] and [redacted-map-package-path]',
    )
  })
})

function createTempRoot(): string {
  const root = path.join(tmpdir(), `sartracker-official-map-smoke-${process.pid}-${tempRoots.length}`)
  rmSync(root, { force: true, recursive: true })
  mkdirSync(root, { recursive: true })
  tempRoots.push(root)
  return root
}

function createMbtilesPackage(packagePath: string): void {
  mkdirSync(path.dirname(packagePath), { recursive: true })
  const db = new Database(packagePath)
  db.exec(`
    CREATE TABLE metadata (name TEXT, value TEXT);
    CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
  `)
  db.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)').run(
    'bounds',
    '-10.175460623443264,51.73001713921637,-9.334212588012356,52.27002059777089',
  )
  db.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)').run('minzoom', '16')
  db.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)').run('maxzoom', '16')
  db.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)').run('format', 'png')
  db.prepare(
    'INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
  ).run(16, 31068, 43853, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  db.close()
}
