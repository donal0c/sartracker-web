import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSyntheticRasterTilePng } from '../../build/electron-official-map-qualification-smoke-lib.js'
import { createPrivateMapPublicBinding, inspectPrivateMapTiles, validatePrivateMapReceipt } from '../../scripts/qualification/private-map-receipt.mjs'
import { bindPrivateMapInput } from '../../scripts/qualification/private-map-input.mjs'
import { hashCandidateFile } from '../../scripts/qualification/candidate-artifacts.mjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { PNG } = require('pngjs')

/** Build a small independent map input for decoder and receipt rejection tests. */
function fixture() {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)')
  db.prepare('INSERT INTO tiles VALUES (12, 1935, 2743, ?)').run(createSyntheticRasterTilePng('a'))
  return db
}

/** Make one strictly sanitized receipt, separate from the synthetic fault matrix. */
function receipt() {
  return {
    schema: 'sartracker-private-offline-map-v1',
    runtime: { isPackaged: true, executableSha256: 'a'.repeat(64), asarSha256: 'b'.repeat(64) },
    map: { sha256: 'c'.repeat(64), bytes: 4096, tileCount: 1, decodedTileCount: 1, minZoom: 12, maxZoom: 12 },
    observations: { providerDisabled: true, networkBlocked: true, externalMapRequests: 0,
      servedTileMatchesSource: true, servedTileDecoded: true, sourceLoaded: true, renderFrameObserved: true, targetViewConfirmed: true,
      viewComplete: true, fieldReady: true, viewTotalTiles: 1, viewUsableTiles: 1, privateInputUnchanged: true },
    custody: { privateBytesRetained: false, privateScreenshotsRetained: false },
    process: { exitCode: 0, signal: null },
  }
}
const binding = { executableSha256: 'a'.repeat(64), asarSha256: 'b'.repeat(64), mapSha256: 'c'.repeat(64), mapBytes: 4096,
  tileCount: 1, minZoom: 12, maxZoom: 12 }

describe('private offline-map qualification [DON-254]', () => {
  it('exports only the closed candidate binding and component digest without private custody fields', () => {
    const input = { definitionDigest: '1'.repeat(64), attemptId: 'attempt-1', sourceSha: '2'.repeat(40), sourceTree: '3'.repeat(40),
      version: '0.1.0-beta.13', proofMode: 'ci-appimage', artifactSha256: '4'.repeat(64), executableSha256: '5'.repeat(64),
      asarSha256: '6'.repeat(64), mapSha256: '7'.repeat(64), mapBytes: 4096, rawReportSha256: '8'.repeat(64),
      path: '/private/canary-map', coordinates: [52, -9], tileBytes: 'private-tile-canary', runtimePath: '/private/runtime' }
    const publicBinding = createPrivateMapPublicBinding(input)
    expect(publicBinding).toMatchObject({ artifactSha256: input.artifactSha256, executableSha256: input.executableSha256,
      sourceSha: input.sourceSha, definitionDigest: input.definitionDigest, rawReportSha256: input.rawReportSha256,
      qualificationEligible: false })
    expect(JSON.stringify(publicBinding)).not.toMatch(/canary|coordinates|runtimePath|\/private/u)
    expect(Object.keys(publicBinding)).toHaveLength(15)
  })
  it('adds exact-package private supplements while retaining both synthetic fault-matrix bindings', () => {
    const plan = JSON.parse(readFileSync('docs/assurance/qualification-campaign-plan.json', 'utf8'))
    const rows = plan.bindings as Array<Record<string, unknown>>
    for (const [variantId, proofMode] of [['private-offline-map-appimage', 'ci-appimage'], ['private-offline-map-installed', 'installed-deb']]) {
      expect(rows).toContainEqual(expect.objectContaining({ contractId: 'C15', variantId, proofMode, mandatory: true }))
    }
    expect(rows).toContainEqual(expect.objectContaining({ contractId: 'C15', variantId: 'official-offline-map', proofMode: 'installed-deb' }))
    expect(rows).toContainEqual(expect.objectContaining({ contractId: 'C15', variantId: 'official-offline-map-appimage', proofMode: 'ci-appimage' }))
  })
  it('decodes each real PNG row independently and keeps tile selection out of public facts', () => {
    const db = fixture()
    try {
      const result = inspectPrivateMapTiles(db)
      expect(result.facts).toEqual({ tileCount: 1, decodedTileCount: 1, minZoom: 12, maxZoom: 12 })
      expect(result.target).toMatchObject({ z: 12, x: 1935, y: 1352 })
      expect(result.target.sha256).toMatch(/^[a-f0-9]{64}$/u)
    } finally { db.close() }
  })
  it.each(['invalid-image', 'duplicate-coordinate', 'out-of-range'])('rejects %s source rows', (kind) => {
    const db = fixture()
    try {
      if (kind === 'invalid-image') db.prepare('UPDATE tiles SET tile_data = ?').run(Buffer.from('not PNG'))
      if (kind === 'duplicate-coordinate') db.exec('INSERT INTO tiles SELECT * FROM tiles')
      if (kind === 'out-of-range') db.exec('UPDATE tiles SET tile_column = 999999')
      expect(() => inspectPrivateMapTiles(db)).toThrow()
    } finally { db.close() }
  })
  it.each(['truncated', 'crc', 'dimensions', 'alpha', 'oversized'])('rejects %s PNG data independently', (kind) => {
    const db = fixture()
    try {
      let bytes = Buffer.from(createSyntheticRasterTilePng('a'))
      if (kind === 'truncated') bytes = bytes.subarray(0, 40)
      if (kind === 'crc') bytes[29] ^= 1
      if (kind === 'dimensions') bytes.writeUInt32BE(1024, 16)
      if (kind === 'alpha') bytes = PNG.sync.write({ width: 256, height: 256, data: Buffer.alloc(256 * 256 * 4) })
      if (kind === 'oversized') bytes = Buffer.concat([bytes, Buffer.alloc(4 * 1024 * 1024 + 1 - bytes.length)])
      db.prepare('UPDATE tiles SET tile_data = ?').run(bytes)
      expect(() => inspectPrivateMapTiles(db)).toThrow(kind === 'oversized' ? /PRIVATE_MAP_PNG_HEADER_INVALID/u : /PRIVATE_MAP_PNG/u)
    } finally { db.close() }
  })
  it('accepts partially transparent edge tiles with visible content, matching the documented native policy', () => {
    const db = fixture()
    try {
      const data = Buffer.alloc(256 * 256 * 4)
      data[3] = 128
      db.prepare('UPDATE tiles SET tile_data = ?').run(PNG.sync.write({ width: 256, height: 256, data }))
      expect(inspectPrivateMapTiles(db).facts.decodedTileCount).toBe(1)
    } finally { db.close() }
  })
  it('requires the exact private role, hash and closed standalone source', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'private-map-binding-'))
    try {
      const filename = path.join(root, 'input.mbtiles')
      const db = new Database(filename)
      db.exec('CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)')
      db.prepare('INSERT INTO tiles VALUES (12, 1935, 2743, ?)').run(createSyntheticRasterTilePng('a'))
      db.close()
      const identity = await hashCandidateFile(filename)
      await expect(bindPrivateMapInput({ 'private-map': identity })).resolves.toMatchObject({ tileCount: 1, sha256: identity.sha256 })
      await expect(bindPrivateMapInput({})).rejects.toThrow(/private-map input/u)
      await expect(bindPrivateMapInput({ 'private-map': { ...identity, sha256: 'd'.repeat(64) } })).rejects.toThrow(/identity changed/u)
      await writeFile(`${filename}-wal`, 'uncheckpointed')
      await expect(bindPrivateMapInput({ 'private-map': identity })).rejects.toThrow(/sidecar|standalone/iu)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('admits only the exact map and observed packaged runtime', () => {
    expect(validatePrivateMapReceipt(receipt(), binding).passed).toBe(true)
    for (const key of ['executableSha256', 'asarSha256', 'mapSha256'] as const) {
      expect(validatePrivateMapReceipt(receipt(), { ...binding, [key]: 'd'.repeat(64) }).passed).toBe(false)
    }
    expect(validatePrivateMapReceipt(receipt(), { ...binding, mapBytes: 999 }).passed).toBe(false)
    expect(validatePrivateMapReceipt(receipt(), { ...binding, tileCount: 2 }).passed).toBe(false)
    expect(validatePrivateMapReceipt(receipt(), { ...binding, minZoom: undefined }).passed).toBe(false)
  })
  it.each(['providerDisabled', 'networkBlocked', 'servedTileMatchesSource', 'servedTileDecoded', 'sourceLoaded',
    'renderFrameObserved', 'targetViewConfirmed', 'viewComplete', 'fieldReady', 'privateInputUnchanged'] as const)('rejects absent %s evidence', (key) => {
    const value = receipt(); value.observations[key] = false
    expect(validatePrivateMapReceipt(value, binding).passed).toBe(false)
  })
  it('rejects partial decode, incomplete view, external requests, abnormal exit and private fields', () => {
    const cases = [
      { ...receipt(), map: { ...receipt().map, decodedTileCount: 0 } },
      { ...receipt(), observations: { ...receipt().observations, viewUsableTiles: 0 } },
      { ...receipt(), observations: { ...receipt().observations, externalMapRequests: 1 } },
      { ...receipt(), process: { exitCode: 1, signal: null } },
      { ...receipt(), map: { ...receipt().map, path: '/private/map.mbtiles' } },
      { ...receipt(), observations: { ...receipt().observations, coordinates: [1, 2] } },
      { ...receipt(), custody: { privateBytesRetained: true, privateScreenshotsRetained: false } },
    ]
    for (const value of cases) expect(validatePrivateMapReceipt(value, binding).passed).toBe(false)
  })
})
