import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createCoverageTileRunner } = require('../../electron/coverage-tile-runner.cjs') as {
  readonly createCoverageTileRunner: (input: {
    readonly databasePath: string
    readonly cacheDirectory: string
    readonly createWorker?: () => FakeWorker
    readonly onFailure?: (error: Error) => void
  }) => {
    readonly syncCatalog: (
      input: Readonly<Record<string, unknown>>,
      options?: { readonly signal?: AbortSignal },
    ) => Promise<CatalogResult>
    readonly readTile: (input: Readonly<Record<string, unknown>>) => Promise<Uint8Array | null>
    readonly close: () => Promise<void>
  }
}

type CatalogResult = {
  readonly periods: readonly { readonly periodKey: string; readonly revisionDigest: string }[]
  readonly delivered: readonly { readonly key: ChunkKey; readonly contentRev: number }[]
  readonly builds: readonly { readonly key: ChunkKey; readonly contentRev: number; readonly fixCount: number }[]
}

type ChunkKey = {
  readonly device_id: string
  readonly period_kind: 'outing'
  readonly period_id: string
}

let directory: string | undefined
let runner: ReturnType<typeof createCoverageTileRunner> | undefined

afterEach(async () => {
  await runner?.close()
  runner = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('Candidate B coverage tile worker [DON-276]', () => {
  it('serves revision-bound PBF tiles and retains an unrelated period across a chunk bump', async () => {
    const databasePath = await createDatabase()
    runner = createCoverageTileRunner({
      databasePath,
      cacheDirectory: path.join(directory!, 'coverage-tiles'),
    })
    const keyA: ChunkKey = {
      device_id: 'device-a', period_kind: 'outing', period_id: 'outing-a',
    }
    const keyB: ChunkKey = {
      device_id: 'device-b', period_kind: 'outing', period_id: 'outing-b',
    }
    const first = await runner.syncCatalog({
      missionId: 'mission-1',
      chunks: [{ key: keyA, contentRev: 1 }, { key: keyB, contentRev: 1 }],
    })
    expect(first.delivered).toEqual([
      { key: keyA, contentRev: 1 }, { key: keyB, contentRev: 1 },
    ])
    expect(first.builds.map((build) => build.fixCount)).toEqual([2, 2])
    const periodA = first.periods.find((period) => period.periodKey.endsWith('outing-a'))!
    const periodB = first.periods.find((period) => period.periodKey.endsWith('outing-b'))!
    const tileAddress = lonLatToTile(-9.7, 52, 8)
    const firstB = await runner.readTile({
      periodKey: periodB.periodKey,
      revisionDigest: periodB.revisionDigest,
      ...tileAddress,
    })
    expect(ArrayBuffer.isView(firstB)).toBe(true)
    expect(firstB!.byteLength).toBeGreaterThan(0)

    const database = new Database(databasePath)
    database.prepare(`UPDATE coverage_chunks SET content_rev = 2
      WHERE mission_id = 'mission-1' AND device_id = 'device-a'`).run()
    database.close()
    const second = await runner.syncCatalog({
      missionId: 'mission-1',
      chunks: [{ key: keyA, contentRev: 2 }, { key: keyB, contentRev: 1 }],
    })
    const nextPeriodB = second.periods.find((period) => period.periodKey === periodB.periodKey)!

    expect(nextPeriodB).toEqual(periodB)
    await expect(runner.readTile({
      periodKey: periodA.periodKey,
      revisionDigest: periodA.revisionDigest,
      ...tileAddress,
    })).resolves.toBeNull()
    await expect(runner.readTile({
      periodKey: periodB.periodKey,
      revisionDigest: periodB.revisionDigest,
      ...tileAddress,
    })).resolves.toEqual(firstB)
  })

  it('fences a replacement from the terminated worker generation', async () => {
    const workers: FakeWorker[] = []
    runner = createCoverageTileRunner({
      databasePath: '/unused/fenced-worker.sqlite',
      cacheDirectory: '/unused/fenced-worker-cache',
      createWorker: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
    })
    const firstAbort = new AbortController()
    const first = runner.syncCatalog({ missionId: 'mission-1', chunks: [] }, {
      signal: firstAbort.signal,
    })
    firstAbort.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })

    const second = runner.syncCatalog({ missionId: 'mission-1', chunks: [] })
    expect(workers).toHaveLength(2)
    workers[0]!.emit('exit', 1)
    workers[1]!.reply({ periods: [], delivered: [], builds: [] })

    await expect(second).resolves.toEqual({ periods: [], delivered: [], builds: [] })
  })

  it('reports unexpected worker loss to the renderer claim boundary', async () => {
    const onFailure = vi.fn()
    const workers: FakeWorker[] = []
    runner = createCoverageTileRunner({
      databasePath: '/unused/failed-worker.sqlite',
      cacheDirectory: '/unused/failed-worker-cache',
      onFailure,
      createWorker: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
    })
    const request = runner.syncCatalog({ missionId: 'mission-1', chunks: [] })

    workers[0]!.emit('exit', 1)

    await expect(request).rejects.toThrow(/exited with code 1/)
    expect(onFailure).toHaveBeenCalledOnce()
  })
})

class FakeWorker extends EventEmitter {
  readonly messages: Readonly<Record<string, unknown>>[] = []

  postMessage(message: Readonly<Record<string, unknown>>): void {
    this.messages.push(message)
  }

  reply(result: Readonly<Record<string, unknown>>): void {
    const requestId = this.messages.at(-1)?.requestId
    this.emit('message', { requestId, result })
  }

  async terminate(): Promise<number> {
    return 1
  }
}

async function createDatabase(): Promise<string> {
  directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-tiles-'))
  const databasePath = path.join(directory, 'mission-store.sqlite')
  const database = new Database(databasePath)
  database.exec(`
    CREATE TABLE outings (
      id TEXT PRIMARY KEY, mission_id TEXT, started_at TEXT, ended_at TEXT
    );
    CREATE TABLE positions (
      id TEXT PRIMARY KEY, mission_id TEXT, device_id TEXT,
      source_position_id TEXT, timestamp TEXT, lat REAL, lon REAL
    );
    CREATE INDEX idx_positions_mission_device_timestamp
      ON positions(mission_id, device_id, timestamp);
    CREATE TABLE coverage_chunks (
      mission_id TEXT, device_id TEXT, period_kind TEXT, period_id TEXT,
      content_rev INTEGER, built_rev INTEGER,
      PRIMARY KEY (mission_id, device_id, period_kind, period_id)
    );
    INSERT INTO outings VALUES
      ('outing-a', 'mission-1', '2026-08-24T09:00:00.000Z', '2026-08-24T10:00:00.000Z'),
      ('outing-b', 'mission-1', '2026-08-24T10:00:00.000Z', '2026-08-24T11:00:00.000Z');
    INSERT INTO positions VALUES
      ('a-1', 'mission-1', 'device-a', 'source-a-1', '2026-08-24T09:01:00.000Z', 52, -9.7),
      ('a-2', 'mission-1', 'device-a', 'source-a-2', '2026-08-24T09:02:00.000Z', 52.01, -9.71),
      ('b-1', 'mission-1', 'device-b', 'source-b-1', '2026-08-24T10:01:00.000Z', 52, -9.7),
      ('b-2', 'mission-1', 'device-b', 'source-b-2', '2026-08-24T10:02:00.000Z', 52.01, -9.71);
    INSERT INTO coverage_chunks VALUES
      ('mission-1', 'device-a', 'outing', 'outing-a', 1, NULL),
      ('mission-1', 'device-b', 'outing', 'outing-b', 1, NULL);
  `)
  database.close()
  return databasePath
}

function lonLatToTile(lon: number, lat: number, z: number) {
  const scale = 2 ** z
  return {
    z,
    x: Math.floor(((lon + 180) / 360) * scale),
    y: Math.floor(
      ((1 - Math.log(Math.tan(lat * Math.PI / 180) +
        1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2) * scale,
    ),
  }
}
