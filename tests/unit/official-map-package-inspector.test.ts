import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (filename: string) => {
  readonly close: () => void
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => {
    readonly run: (...params: readonly unknown[]) => unknown
  }
}

const { inspectOfficialMapPackageInWorker } = (await import(
  '../../electron/official-map-package-inspector.cjs'
)) as {
  readonly inspectOfficialMapPackageInWorker: (packagePath: string, options: {
    readonly decodeTile: (bytes: Uint8Array, format: string) => boolean | Promise<boolean>
    readonly now?: Date | (() => Date)
    readonly timeoutMs?: number
    readonly handshakeTimeoutMs?: number
    readonly workerPath?: string
    readonly signal?: AbortSignal
  }) => Promise<{
    readonly tileCount: number
    readonly tileFormat: string
    readonly verifiedAt: string
    readonly attestation: {
      readonly version: 1
      readonly schemaVersion: 1
      readonly decoderPolicy: string
      readonly sha256: string
      readonly identity: string
    }
  }>
}

const temporaryDirectories: string[] = []

describe('official map package worker inspector', () => {
  afterEach(async () => {
    while (temporaryDirectories.length > 0) {
      const directory = temporaryDirectories.pop()
      if (directory !== undefined) {
        await rm(directory, { force: true, recursive: true })
      }
    }
  })

  it('runs SQLite inspection in a worker and delivers one bounded tile at a time', async () => {
    const packagePath = await createPackage(2)
    let activeDecodes = 0
    let maximumActiveDecodes = 0
    const formats: string[] = []

    const result = await inspectOfficialMapPackageInWorker(packagePath, {
      decodeTile: async (bytes, format) => {
        expect(bytes.byteLength).toBeGreaterThan(0)
        activeDecodes += 1
        maximumActiveDecodes = Math.max(maximumActiveDecodes, activeDecodes)
        formats.push(format)
        await new Promise((resolve) => setTimeout(resolve, 2))
        activeDecodes -= 1
        return true
      },
      now: new Date('2026-09-13T12:34:56.000Z'),
    })

    expect(result).toMatchObject({
      tileCount: 2,
      tileFormat: 'png',
      verifiedAt: '2026-09-13T12:34:56.000Z',
      attestation: {
        version: 1,
        schemaVersion: 1,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        identity: expect.any(String),
      },
    })
    expect(formats).toEqual(['png', 'png'])
    expect(maximumActiveDecodes).toBe(1)
  })

  it('rejects decoder failure without exposing paths or raw worker errors', async () => {
    const packagePath = await createPackage()

    await expect(
      inspectOfficialMapPackageInWorker(packagePath, { decodeTile: () => false }),
    ).rejects.toThrow(/decoder|verification/iu)
    await expect(
      inspectOfficialMapPackageInWorker(packagePath, {
        decodeTile: () => { throw new Error(`private decoder path: ${packagePath}`) },
      }),
    ).rejects.not.toThrow(packagePath)
  })

  it('fails closed for worker startup errors and handshake timeouts', async () => {
    const packagePath = await createPackage()
    const missingWorker = path.join(temporaryDirectories[0] ?? os.tmpdir(), 'missing-worker.cjs')

    await expect(
      inspectOfficialMapPackageInWorker(packagePath, {
        decodeTile: () => true,
        workerPath: missingWorker,
      }),
    ).rejects.not.toThrow(missingWorker)

    await expect(
      inspectOfficialMapPackageInWorker(packagePath, {
        decodeTile: () => new Promise<boolean>(() => undefined),
        timeoutMs: 25,
      }),
    ).rejects.toThrow(/timed out|verification/iu)
  })

  it('does not resolve a valid result while the worker remains alive', async () => {
    const packagePath = await createPackage()
    const workerPath = await createStubWorker(`
      parentPort.postMessage({ type: 'ready' })
      parentPort.postMessage({ type: 'result', result: ${JSON.stringify(VALID_RESULT)} })
      setInterval(() => {}, 1000)
    `)
    const inspection = inspectOfficialMapPackageInWorker(packagePath, {
      decodeTile: () => true,
      workerPath,
      timeoutMs: 40,
    })

    await expect(Promise.race([
      inspection.then(() => 'resolved'),
      delay(15).then(() => 'pending'),
    ])).resolves.toBe('pending')
    await expect(inspection).rejects.toThrow(/timed out/iu)
  })

  it('waits for a clean worker exit after validating the result', async () => {
    const packagePath = await createPackage()
    const workerPath = await createStubWorker(`
      parentPort.postMessage({ type: 'ready' })
      parentPort.postMessage({ type: 'result', result: ${JSON.stringify(VALID_RESULT)} })
      setTimeout(() => process.exit(0), 20)
    `)

    await expect(inspectOfficialMapPackageInWorker(packagePath, {
      decodeTile: () => true,
      workerPath,
      timeoutMs: 200,
    })).resolves.toMatchObject({ tileCount: 1 })
  })

  it('rejects a result sent before the worker handshake', async () => {
    const packagePath = await createPackage()
    const workerPath = await createStubWorker(`
      parentPort.postMessage({ type: 'result', result: ${JSON.stringify(VALID_RESULT)} })
      parentPort.postMessage({ type: 'ready' })
    `)

    await expect(inspectOfficialMapPackageInWorker(packagePath, {
      decodeTile: () => true,
      workerPath,
    })).rejects.toThrow(/protocol/iu)
  })

  it('rejects a result while a tile decode is in flight', async () => {
    const packagePath = await createPackage()
    const workerPath = await createStubWorker(`
      parentPort.postMessage({ type: 'ready' })
      parentPort.postMessage({
        type: 'tile',
        requestId: 1,
        format: 'png',
        bytes: Buffer.from('tile'),
      })
      parentPort.postMessage({ type: 'result', result: ${JSON.stringify(VALID_RESULT)} })
    `)

    await expect(inspectOfficialMapPackageInWorker(packagePath, {
      decodeTile: () => new Promise<boolean>(() => undefined),
      workerPath,
      timeoutMs: 200,
    })).rejects.toThrow(/protocol/iu)
  })

  it('rejects duplicate results and abnormal exits after a result', async () => {
    const packagePath = await createPackage()
    const duplicateWorker = await createStubWorker(`
      parentPort.postMessage({ type: 'ready' })
      parentPort.postMessage({ type: 'result', result: ${JSON.stringify(VALID_RESULT)} })
      parentPort.postMessage({ type: 'result', result: ${JSON.stringify(VALID_RESULT)} })
    `)
    await expect(inspectOfficialMapPackageInWorker(packagePath, {
      decodeTile: () => true,
      workerPath: duplicateWorker,
    })).rejects.toThrow(/protocol/iu)

    const abnormalWorker = await createStubWorker(`
      parentPort.postMessage({ type: 'ready' })
      parentPort.postMessage({ type: 'result', result: ${JSON.stringify(VALID_RESULT)} })
      setTimeout(() => process.exit(1), 10)
    `)
    await expect(inspectOfficialMapPackageInWorker(packagePath, {
      decodeTile: () => true,
      workerPath: abnormalWorker,
    })).rejects.toThrow(/verification worker failed/iu)
  })

  it('rejects result envelopes with unknown fields or an unsupported decoder policy', async () => {
    const packagePath = await createPackage()
    const workerPath = await createStubWorker(`
      parentPort.postMessage({ type: 'ready' })
      parentPort.postMessage({
        type: 'result',
        result: { ...${JSON.stringify(VALID_RESULT)}, unexpected: true },
      })
    `)
    await expect(inspectOfficialMapPackageInWorker(packagePath, {
      decodeTile: () => true,
      workerPath,
    })).rejects.toThrow(/protocol/iu)
  })

  it('sanitizes oversized or path-bearing worker errors', async () => {
    const packagePath = await createPackage()
    const workerPath = await createStubWorker(`
      parentPort.postMessage({ type: 'ready' })
      parentPort.postMessage({
        type: 'error',
        message: 'Official map package ${packagePath}',
      })
    `)
    await expect(inspectOfficialMapPackageInWorker(packagePath, {
      decodeTile: () => true,
      workerPath,
    })).rejects.toThrow('Official map package verification failed.')

    const longMessageWorker = await createStubWorker(`
      parentPort.postMessage({ type: 'ready' })
      parentPort.postMessage({
        type: 'error',
        message: 'Official map package ${'a'.repeat(260)}.',
      })
    `)
    await expect(inspectOfficialMapPackageInWorker(packagePath, {
      decodeTile: () => true,
      workerPath: longMessageWorker,
    })).rejects.toThrow('Official map package verification failed.')
  })

  it('aborts and tears down a live worker', async () => {
    const packagePath = await createPackage()
    const workerPath = await createStubWorker(`
      parentPort.postMessage({ type: 'ready' })
      setInterval(() => {}, 1000)
    `)
    const controller = new AbortController()
    const inspection = inspectOfficialMapPackageInWorker(packagePath, {
      decodeTile: () => true,
      workerPath,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 10)
    await expect(inspection).rejects.toThrow(/cancelled/iu)
  })
})

const VALID_RESULT = {
  bounds: [-10, 51, -9, 52],
  minZoom: 12,
  maxZoom: 12,
  tileCount: 1,
  tileFormat: 'png',
  sizeBytes: 4,
  createdAt: '2026-09-13T12:34:56.000Z',
  verifiedAt: '2026-09-13T12:34:56.000Z',
  attestation: {
    version: 1,
    schemaVersion: 1,
    decoderPolicy: 'native-raster-256-or-512-opaque-v1',
    sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    identity: '1:2:3:4:5',
  },
} as const

async function createStubWorker(body: string): Promise<string> {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-official-map-stub-'))
  temporaryDirectories.push(temporaryDirectory)
  const workerPath = path.join(temporaryDirectory, 'stub-worker.cjs')
  await writeFile(workerPath, `'use strict'\nconst { parentPort } = require('node:worker_threads')\n${body}\n`, 'utf8')
  return workerPath
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function createPackage(tileCount = 1): Promise<string> {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-official-map-worker-'))
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
    insertMetadata.run('format', 'png')
    insertMetadata.run('bounds', '-10.25,51.85,-9.45,52.35')
    insertMetadata.run('minzoom', '12')
    insertMetadata.run('maxzoom', '12')
    const insertTile = database.prepare(
      'INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
    )
    for (let index = 0; index < tileCount; index += 1) {
      insertTile.run(12, 1935 + index, 2743, Buffer.from(`tile-${index}`))
    }
  } finally {
    database.close()
  }
  return packagePath
}
