import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as (new (filename: string) => {
  readonly close: () => void
  readonly exec: (sql: string) => void
  readonly pragma: (sql: string, options?: { readonly simple?: boolean }) => unknown
  readonly prepare: (sql: string) => {
    readonly run: (...params: readonly unknown[]) => unknown
  }
})

type MetadataStatement = {
  readonly iterate: (...params: readonly unknown[]) => Iterable<Record<string, unknown>>
}

type InstrumentableDatabase = {
  readonly prototype: {
    prepare: (sql: string, ...params: readonly unknown[]) => MetadataStatement
  }
}

const observedMetadataPayloadBytes: number[] = []
const instrumentableDatabase = Database as unknown as InstrumentableDatabase
const originalPrepare = instrumentableDatabase.prototype.prepare
instrumentableDatabase.prototype.prepare = function prepare(this: object, sql, ...params) {
  const statement = originalPrepare.call(this, sql, ...params)
  if (!/\bFROM\s+metadata\b/iu.test(sql)) return statement
  return new Proxy(statement, {
    get(target, property, receiver) {
      if (property !== 'iterate') return Reflect.get(target, property, receiver)
      return (...iterateParams: readonly unknown[]) => {
        const rows = target.iterate(...iterateParams)
        return (function* observeRows() {
          for (const row of rows) {
            const value = row.value
            observedMetadataPayloadBytes.push(
              typeof value === 'string'
                ? Buffer.byteLength(value, 'utf8')
                : value instanceof Uint8Array
                  ? value.byteLength
                  : 0,
            )
            yield row
          }
        }())
      }
    },
  })
}

const {
  inspectOfficialMapPackage,
  isPackageIdentityCurrent,
  readPackageIdentity,
  verifyPackageAttestation,
} = (await import(
  '../../electron/official-map-package.cjs'
)) as {
  readonly inspectOfficialMapPackage: (packagePath: string, options: {
    readonly decodeTile?: (bytes: Uint8Array, format: string) => boolean | Promise<boolean>
    readonly now?: Date | (() => Date)
  }) => Promise<{
    readonly bounds: readonly [number, number, number, number]
    readonly minZoom: number
    readonly maxZoom: number
    readonly tileCount: number
    readonly tileFormat: string
    readonly sizeBytes: number
    readonly createdAt: string
    readonly verifiedAt: string
    readonly attestation: {
      readonly version: 1
      readonly sha256: string
      readonly identity: string
      readonly schemaVersion?: number
      readonly decoderPolicy?: string
    }
  }>
  readonly readPackageIdentity: (packagePath: string) => string
  readonly isPackageIdentityCurrent: (packagePath: string, attestation: unknown) => boolean
  readonly verifyPackageAttestation: (packagePath: string, attestation: unknown) => Promise<boolean>
}

const temporaryDirectories: string[] = []

describe('official map package attestation', () => {
  afterEach(async () => {
    while (temporaryDirectories.length > 0) {
      const directory = temporaryDirectories.pop()
      if (directory !== undefined) {
        await rm(directory, { force: true, recursive: true })
      }
    }
  })

  it('exports the bounded package inspection and identity API', () => {
    expect(typeof inspectOfficialMapPackage).toBe('function')
    expect(typeof readPackageIdentity).toBe('function')
    expect(typeof isPackageIdentityCurrent).toBe('function')
  })

  it('attests every decodable tile and returns a path-free hash identity', async () => {
    const packagePath = await createPackage({ format: 'png', tileBytes: Buffer.from('tile') })
    const decodeTile = vi.fn().mockResolvedValue(true)

    const result = await inspectOfficialMapPackage(packagePath, {
      decodeTile,
      now: new Date('2026-09-13T12:34:56.000Z'),
    })

    expect(result).toMatchObject({
      bounds: [-10.25, 51.85, -9.45, 52.35],
      minZoom: 12,
      maxZoom: 12,
      tileCount: 1,
      tileFormat: 'png',
      verifiedAt: '2026-09-13T12:34:56.000Z',
      attestation: {
        version: 1,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        identity: expect.any(String),
      },
    })
    expect(result.sizeBytes).toBeGreaterThan(0)
    expect(result.createdAt).toEqual(expect.any(String))
    expect(decodeTile).toHaveBeenCalledOnce()
    expect(decodeTile).toHaveBeenCalledWith(Buffer.from('tile'), 'png')
    expect(JSON.stringify(result)).not.toContain(packagePath)
    expect(isPackageIdentityCurrent(packagePath, result.attestation)).toBe(true)
  })

  it('fails closed when a decoder is absent or rejects a tile', async () => {
    const packagePath = await createPackage({ format: 'jpeg', tileBytes: Buffer.from('tile') })

    await expect(inspectOfficialMapPackage(packagePath, {})).rejects.toThrow()
    await expect(
      inspectOfficialMapPackage(packagePath, { decodeTile: () => false }),
    ).rejects.toThrow()
  })

  it('rejects duplicate addresses, invalid metadata and SQLite sidecars', async () => {
    const duplicatePath = await createPackage({ duplicate: true })
    await expect(
      inspectOfficialMapPackage(duplicatePath, { decodeTile: () => true }),
    ).rejects.toThrow()

    const invalidPath = await createPackage({ format: 'gif' })
    await expect(
      inspectOfficialMapPackage(invalidPath, { decodeTile: () => true }),
    ).rejects.toThrow()

    const sidecarPath = `${invalidPath}-wal`
    await writeFile(sidecarPath, 'sidecar')
    expect(() => readPackageIdentity(invalidPath)).toThrow()
    await expect(
      inspectOfficialMapPackage(invalidPath, { decodeTile: () => true }),
    ).rejects.toThrow()
  })

  it('rejects WAL packages before readonly inspection creates SQLite sidecars', async () => {
    const packagePath = await createPackage()
    const database = new Database(packagePath)
    database.pragma('journal_mode = WAL', { simple: true })
    database.close()
    await rm(`${packagePath}-wal`, { force: true })
    await rm(`${packagePath}-shm`, { force: true })
    await expect(readdir(path.dirname(packagePath))).resolves.toEqual([path.basename(packagePath)])

    await expect(
      inspectOfficialMapPackage(packagePath, { decodeTile: () => true }),
    ).rejects.toThrow('Official map package uses SQLite WAL mode.')
    await expect(readdir(path.dirname(packagePath))).resolves.toEqual([path.basename(packagePath)])
  })

  it('rejects oversized payloads before passing bytes to the decoder', async () => {
    const packagePath = await createPackage({ tileBytes: Buffer.alloc(4 * 1024 * 1024 + 1) })
    const decodeTile = vi.fn().mockReturnValue(true)

    await expect(
      inspectOfficialMapPackage(packagePath, { decodeTile }),
    ).rejects.toThrow()
    expect(decodeTile).not.toHaveBeenCalled()
  })

  it('bounds metadata payload materialization before rejecting an oversized value', async () => {
    observedMetadataPayloadBytes.length = 0
    const packagePath = await createPackage({ metadataValue: 'x'.repeat(1024 * 1024) })
    const decodeTile = vi.fn().mockReturnValue(true)

    await expect(
      inspectOfficialMapPackage(packagePath, { decodeTile }),
    ).rejects.toThrow()
    expect(decodeTile).not.toHaveBeenCalled()
    expect(observedMetadataPayloadBytes.length).toBeGreaterThan(0)
    expect(Math.max(...observedMetadataPayloadBytes)).toBeLessThanOrEqual(64 * 1024)
  })

  it('fails closed for an identity that no longer matches the package', async () => {
    const packagePath = await createPackage({ tileBytes: Buffer.from('tile') })
    const attestation = await inspectOfficialMapPackage(packagePath, { decodeTile: () => true })
    await chmod(packagePath, 0o600)
    await writeFile(packagePath, Buffer.from('replacement package bytes'))

    expect(isPackageIdentityCurrent(packagePath, attestation.attestation)).toBe(false)
    expect(isPackageIdentityCurrent(packagePath, null)).toBe(false)
  })

  it('rehashes a current package before accepting its attestation', async () => {
    const packagePath = await createPackage({ tileBytes: Buffer.from('tile') })
    const attestation = (await inspectOfficialMapPackage(packagePath, { decodeTile: () => true })).attestation

    await expect(verifyPackageAttestation(packagePath, attestation)).resolves.toBe(true)
    await expect(
      verifyPackageAttestation(packagePath, { ...attestation, sha256: 'b'.repeat(64) }),
    ).resolves.toBe(false)

    const packageBytes = await import('node:fs/promises').then(({ readFile }) => readFile(packagePath))
    await writeFile(packagePath, Buffer.alloc(packageBytes.byteLength, 0x42))
    await expect(verifyPackageAttestation(packagePath, attestation)).resolves.toBe(false)
  })
})

async function createPackage(options: {
  readonly format?: string
  readonly tileBytes?: Uint8Array
  readonly duplicate?: boolean
  readonly metadataValue?: string
} = {}): Promise<string> {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-official-map-package-'))
  temporaryDirectories.push(temporaryDirectory)
  const packagePath = path.join(temporaryDirectory, 'package.mbtiles')
  const database = new Database(packagePath)
  try {
    database.exec(`
      CREATE TABLE metadata (name TEXT NOT NULL, value TEXT NOT NULL);
      CREATE TABLE tiles (
        zoom_level INTEGER NOT NULL,
        tile_column INTEGER NOT NULL,
        tile_row INTEGER NOT NULL,
        tile_data BLOB NOT NULL
      );
    `)
    const insertMetadata = database.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)')
    insertMetadata.run('format', options.format ?? 'png')
    insertMetadata.run('bounds', '-10.25,51.85,-9.45,52.35')
    insertMetadata.run('minzoom', '12')
    insertMetadata.run('maxzoom', '12')
    if (options.metadataValue !== undefined) insertMetadata.run('description', options.metadataValue)
    const insertTile = database.prepare(
      'INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
    )
    insertTile.run(12, 1935, 2743, Buffer.from(options.tileBytes ?? Buffer.from('tile')))
    if (options.duplicate === true) {
      insertTile.run(12, 1935, 2743, Buffer.from('duplicate'))
    }
  } finally {
    database.close()
  }
  return packagePath
}
