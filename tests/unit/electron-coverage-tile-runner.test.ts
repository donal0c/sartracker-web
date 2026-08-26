import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createCoverageTileCatalog } = require('../../electron/coverage-tile-catalog.cjs') as {
  readonly createCoverageTileCatalog: (input: {
    readonly missionId: string
    readonly chunks: readonly { readonly key: ChunkKey; readonly contentRev: number }[]
  }) => {
    readonly periods: readonly {
      readonly periodKey: string
      readonly revisionDigest: string
      readonly contributors: readonly string[]
    }[]
  }
}
const { createCoverageTileRunner } = require('../../electron/coverage-tile-runner.cjs') as {
  readonly createCoverageTileRunner: (input: {
    readonly databasePath: string
    readonly cacheDirectory: string
    readonly timeoutMs?: number
    readonly createWorker?: () => FakeWorker
    readonly onFailure?: (error: Error) => void
    readonly faultInjection?: {
      readonly failCatalogCommitOnce?: boolean
      readonly chunkBuildDelayMs?: number
      readonly catalogResponseDelayMs?: number
      readonly tileWriteDelayMs?: number
    }
  }) => {
    readonly syncCatalog: (
      input: Readonly<Record<string, unknown>>,
      options?: { readonly signal?: AbortSignal },
    ) => Promise<CatalogResult>
    readonly commitCatalog: (input: { readonly stageId: string }) => Promise<boolean>
    readonly finalizeCatalog: (input: { readonly stageId: string }) => Promise<boolean>
    readonly discardCatalog: (input: { readonly stageId: string }) => Promise<boolean>
    readonly readTile: (
      input: Readonly<Record<string, unknown>>,
      options?: { readonly signal?: AbortSignal },
    ) => Promise<Uint8Array | null>
    readonly close: () => Promise<void>
  }
}

type CatalogResult = {
  readonly stageId: string
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
  it('removes interrupted temporary tile writes and remains usable', async () => {
    const databasePath = await createDatabase()
    const cacheDirectory = path.join(directory!, 'coverage-tiles')
    runner = createCoverageTileRunner({
      databasePath,
      cacheDirectory,
      faultInjection: { tileWriteDelayMs: 100 },
    })
    const key: ChunkKey = {
      device_id: 'device-a', period_kind: 'outing', period_id: 'outing-a',
    }
    const catalog = await runner.syncCatalog({
      missionId: 'mission-1', chunks: [{ key, contentRev: 1 }],
    })
    await runner.commitCatalog({ stageId: catalog.stageId })
    await runner.finalizeCatalog({ stageId: catalog.stageId })
    const period = catalog.periods[0]!
    const controller = new AbortController()
    const request = runner.readTile({
      missionId: 'mission-1', periodKey: period.periodKey,
      revisionDigest: period.revisionDigest, ...lonLatToTile(-9.7, 52, 8),
    }, { signal: controller.signal })

    await vi.waitFor(async () => {
      expect((await listFiles(cacheDirectory)).some((entry) => entry.endsWith('.tmp'))).toBe(true)
    })
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(async () => {
      expect((await listFiles(cacheDirectory)).filter((entry) => entry.endsWith('.tmp'))).toEqual([])
    })
    expect((await listFiles(cacheDirectory)).filter((entry) => entry.endsWith('.pbf'))).toEqual([])

    const recovered = await runner.readTile({
      missionId: 'mission-1', periodKey: period.periodKey,
      revisionDigest: period.revisionDigest, ...lonLatToTile(-9.7, 52, 8),
    })
    expect(ArrayBuffer.isView(recovered)).toBe(true)
  })

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
    await runner.commitCatalog({ stageId: first.stageId })
    await runner.finalizeCatalog({ stageId: first.stageId })
    expect(first.delivered).toEqual([
      { key: keyA, contentRev: 1 }, { key: keyB, contentRev: 1 },
    ])
    expect(first.builds.map((build) => build.fixCount)).toEqual([2, 2])
    const periodA = first.periods.find((period) => period.periodKey.endsWith('outing-a'))!
    const periodB = first.periods.find((period) => period.periodKey.endsWith('outing-b'))!
    const tileAddress = lonLatToTile(-9.7, 52, 8)
    const firstA = await runner.readTile({
      missionId: 'mission-1',
      periodKey: periodA.periodKey,
      revisionDigest: periodA.revisionDigest,
      ...tileAddress,
    })
    const firstB = await runner.readTile({
      missionId: 'mission-1',
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
    const nextPeriodA = second.periods.find((period) => period.periodKey === periodA.periodKey)!
    await expect(runner.readTile({
      missionId: 'mission-1',
      periodKey: periodA.periodKey,
      revisionDigest: periodA.revisionDigest,
      ...tileAddress,
    })).resolves.toEqual(firstA)
    const stagedA = await runner.readTile({
      missionId: 'mission-1',
      periodKey: nextPeriodA.periodKey,
      revisionDigest: nextPeriodA.revisionDigest,
      ...tileAddress,
    })
    expect(ArrayBuffer.isView(stagedA)).toBe(true)
    expect(stagedA!.byteLength).toBeGreaterThan(0)
    await runner.commitCatalog({ stageId: second.stageId })
    const nextPeriodB = second.periods.find((period) => period.periodKey === periodB.periodKey)!

    expect(nextPeriodB).toEqual(periodB)
    await expect(runner.readTile({
      missionId: 'mission-1',
      periodKey: periodA.periodKey,
      revisionDigest: periodA.revisionDigest,
      ...tileAddress,
    })).resolves.toEqual(firstA)
    await runner.finalizeCatalog({ stageId: second.stageId })
    await expect(runner.readTile({
      missionId: 'mission-1',
      periodKey: periodA.periodKey,
      revisionDigest: periodA.revisionDigest,
      ...tileAddress,
    })).resolves.toBeNull()
    await expect(runner.readTile({
      missionId: 'mission-1',
      periodKey: periodB.periodKey,
      revisionDigest: periodB.revisionDigest,
      ...tileAddress,
    })).resolves.toEqual(firstB)
  })

  it('rolls a committed backend catalog back when renderer activation is superseded', async () => {
    const databasePath = await createDatabase()
    runner = createCoverageTileRunner({
      databasePath,
      cacheDirectory: path.join(directory!, 'coverage-rollback'),
    })
    const keyA: ChunkKey = {
      device_id: 'device-a', period_kind: 'outing', period_id: 'outing-a',
    }
    const first = await runner.syncCatalog({
      missionId: 'mission-1', chunks: [{ key: keyA, contentRev: 1 }],
    })
    await runner.commitCatalog({ stageId: first.stageId })
    await runner.finalizeCatalog({ stageId: first.stageId })
    const priorPeriod = first.periods[0]!
    const tileAddress = lonLatToTile(-9.7, 52, 8)
    const priorTile = await runner.readTile({
      missionId: 'mission-1',
      periodKey: priorPeriod.periodKey,
      revisionDigest: priorPeriod.revisionDigest,
      ...tileAddress,
    })
    const database = new Database(databasePath)
    database.prepare(`UPDATE coverage_chunks SET content_rev = 2
      WHERE mission_id = 'mission-1' AND device_id = 'device-a'`).run()
    database.close()

    const second = await runner.syncCatalog({
      missionId: 'mission-1', chunks: [{ key: keyA, contentRev: 2 }],
    })
    await runner.commitCatalog({ stageId: second.stageId })
    await runner.discardCatalog({ stageId: second.stageId })

    await expect(runner.readTile({
      missionId: 'mission-1',
      periodKey: priorPeriod.periodKey,
      revisionDigest: priorPeriod.revisionDigest,
      ...tileAddress,
    })).resolves.toEqual(priorTile)
    await expect(runner.readTile({
      missionId: 'mission-1',
      periodKey: second.periods[0]!.periodKey,
      revisionDigest: second.periods[0]!.revisionDigest,
      ...tileAddress,
    })).resolves.toBeNull()
  })

  it('treats repeated activation of the current stage as idempotent', async () => {
    const databasePath = await createDatabase()
    runner = createCoverageTileRunner({
      databasePath,
      cacheDirectory: path.join(directory!, 'coverage-idempotent-activation'),
    })
    const staged = await runner.syncCatalog({ missionId: 'mission-1', chunks: [] })

    await expect(runner.commitCatalog({ stageId: staged.stageId })).resolves.toBe(true)
    await expect(runner.commitCatalog({ stageId: staged.stageId })).resolves.toBe(true)
    await expect(runner.finalizeCatalog({ stageId: staged.stageId })).resolves.toBe(true)
    await expect(runner.finalizeCatalog({ stageId: staged.stageId })).resolves.toBe(true)
    await expect(runner.syncCatalog({ missionId: 'mission-1', chunks: [] }))
      .resolves.toMatchObject({ stageId: expect.any(String) })
  })

  it('serves retained tiles while a later catalog is still building', async () => {
    const databasePath = await createDatabase()
    runner = createCoverageTileRunner({
      databasePath,
      cacheDirectory: path.join(directory!, 'coverage-concurrent-read'),
      faultInjection: { chunkBuildDelayMs: 100 },
    })
    const keyA: ChunkKey = {
      device_id: 'device-a', period_kind: 'outing', period_id: 'outing-a',
    }
    const first = await runner.syncCatalog({
      missionId: 'mission-1', chunks: [{ key: keyA, contentRev: 1 }],
    })
    await runner.commitCatalog({ stageId: first.stageId })
    await runner.finalizeCatalog({ stageId: first.stageId })
    const period = first.periods[0]!
    const tileAddress = lonLatToTile(-9.7, 52, 8)
    const database = new Database(databasePath)
    database.prepare(`UPDATE coverage_chunks SET content_rev = 2
      WHERE mission_id = 'mission-1' AND device_id = 'device-a'`).run()
    database.close()

    const build = runner.syncCatalog({
      missionId: 'mission-1', chunks: [{ key: keyA, contentRev: 2 }],
    })
    const retainedRead = runner.readTile({
      missionId: 'mission-1',
      periodKey: period.periodKey,
      revisionDigest: period.revisionDigest,
      ...tileAddress,
    })

    await expect(Promise.race([
      retainedRead.then(() => 'tile'),
      build.then(() => 'build'),
    ])).resolves.toBe('tile')
    const staged = await build
    await runner.discardCatalog({ stageId: staged.stageId })
  })

  it('never reuses an activation token after the tile worker restarts', async () => {
    const databasePath = await createDatabase()
    runner = createCoverageTileRunner({
      databasePath,
      cacheDirectory: path.join(directory!, 'coverage-token-generation'),
    })
    const first = await runner.syncCatalog({ missionId: 'mission-1', chunks: [] })
    await runner.discardCatalog({ stageId: first.stageId })
    await runner.close()

    runner = createCoverageTileRunner({
      databasePath,
      cacheDirectory: path.join(directory!, 'coverage-token-generation'),
    })
    const replacement = await runner.syncCatalog({ missionId: 'mission-1', chunks: [] })

    expect(replacement.stageId).not.toBe(first.stageId)
  })

  it('accepts cleanup for a lost generation when no replacement stage exists', async () => {
    const databasePath = await createDatabase()
    const cacheDirectory = path.join(directory!, 'coverage-lost-generation-cleanup')
    runner = createCoverageTileRunner({ databasePath, cacheDirectory })
    const lost = await runner.syncCatalog({ missionId: 'mission-1', chunks: [] })
    await runner.close()

    runner = createCoverageTileRunner({ databasePath, cacheDirectory })
    await expect(runner.discardCatalog({ stageId: lost.stageId })).resolves.toBe(true)
    await expect(runner.syncCatalog({ missionId: 'mission-1', chunks: [] }))
      .resolves.toMatchObject({ stageId: expect.any(String) })
  })

  it('settles predecessor finalization after its worker generation is lost', async () => {
    const databasePath = await createDatabase()
    const cacheDirectory = path.join(directory!, 'coverage-lost-generation-finalization')
    runner = createCoverageTileRunner({ databasePath, cacheDirectory })
    const lost = await runner.syncCatalog({ missionId: 'mission-1', chunks: [] })
    await runner.commitCatalog({ stageId: lost.stageId })
    await runner.close()

    runner = createCoverageTileRunner({ databasePath, cacheDirectory })
    await expect(runner.finalizeCatalog({ stageId: lost.stageId })).resolves.toBe(true)
    const replacement = await runner.syncCatalog({ missionId: 'mission-1', chunks: [] })
    await expect(runner.finalizeCatalog({ stageId: lost.stageId }))
      .rejects.toThrow(/activation is no longer current/i)
    await runner.discardCatalog({ stageId: replacement.stageId })
  })

  it('cancels one request without destroying the shared worker generation', async () => {
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
    expect(workers).toHaveLength(1)
    expect(workers[0]!.messages).toContainEqual({
      type: 'cancel-request',
      targetRequestId: 1,
    })
    workers[0]!.reply({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000007-1',
      periods: [], delivered: [], builds: [],
    })

    await expect(second).resolves.toEqual({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000007-1',
      periods: [], delivered: [], builds: [],
    })
  })

  it('keeps renderer payload fields from overriding the worker request envelope', async () => {
    const worker = new FakeWorker()
    runner = createCoverageTileRunner({
      databasePath: '/unused-envelope-worker.sqlite',
      cacheDirectory: '/unused-envelope-worker-cache',
      createWorker: () => worker,
    })

    const request = runner.readTile({
      requestId: 'renderer-controlled',
      type: 'close',
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing-a',
      revisionDigest: 'revision-1',
      z: 0,
      x: 0,
      y: 0,
    })

    expect(worker.messages).toContainEqual(expect.objectContaining({
      requestId: 1,
      type: 'read-tile',
    }))
    worker.reply({ bytes: [] })
    await expect(request).resolves.toEqual({ bytes: [] })
  })

  it('rejects duplicate catalog descriptors before cloning them to the worker', async () => {
    const worker = new FakeWorker()
    runner = createCoverageTileRunner({
      databasePath: '/unused-envelope-worker.sqlite',
      cacheDirectory: '/unused-envelope-worker-cache',
      timeoutMs: 10,
      createWorker: () => worker,
    })
    const descriptor = {
      key: { device_id: 'device-a', period_kind: 'outing', period_id: 'outing-a' },
      contentRev: 1,
    }

    await expect(Promise.resolve().then(() => runner!.syncCatalog({
      missionId: 'mission-1', chunks: [descriptor, descriptor],
    }))).rejects.toThrow(/duplicate.*coverage.*key/i)
    expect(worker.messages).toEqual([])
  })

  it('rejects a worker period digest that is not derived from requested contributors', async () => {
    const onFailure = vi.fn()
    const workers: FakeWorker[] = []
    runner = createCoverageTileRunner({
      databasePath: '/unused-result-digest-worker.sqlite',
      cacheDirectory: '/unused-result-digest-worker-cache',
      onFailure,
      createWorker: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
    })
    const key: ChunkKey = {
      device_id: 'device-a', period_kind: 'outing', period_id: 'outing-a',
    }
    const priorDescriptor = { key, contentRev: 1 }
    const descriptor = { key, contentRev: 2 }
    const priorPeriod = createCoverageTileCatalog({
      missionId: 'mission-1', chunks: [priorDescriptor],
    }).periods[0]!
    const currentPeriod = createCoverageTileCatalog({
      missionId: 'mission-1', chunks: [descriptor],
    }).periods[0]!
    const build = {
      ...descriptor,
      fixCount: 0,
      fixDigest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      minTs: null,
      maxTs: null,
    }

    const forged = runner.syncCatalog({ missionId: 'mission-1', chunks: [descriptor] })
    workers[0]!.reply({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000008-1',
      periods: [{ ...currentPeriod, revisionDigest: priorPeriod.revisionDigest }],
      delivered: [descriptor],
      builds: [build],
    })

    await expect(forged).rejects.toThrow(/catalog worker result/i)
    expect(workers[0]!.terminationCount).toBe(1)
    expect(onFailure).toHaveBeenCalledOnce()

    const retry = runner.syncCatalog({ missionId: 'mission-1', chunks: [descriptor] })
    expect(workers).toHaveLength(2)
    workers[1]!.reply({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000009-1',
      periods: [currentPeriod],
      delivered: [descriptor],
      builds: [build],
    })
    await expect(retry).resolves.toMatchObject({ periods: [currentPeriod] })
  })

  it('replaces a worker that returns a malformed staged catalog result', async () => {
    const onFailure = vi.fn()
    const workers: FakeWorker[] = []
    runner = createCoverageTileRunner({
      databasePath: '/unused-result-worker.sqlite',
      cacheDirectory: '/unused-result-worker-cache',
      onFailure,
      createWorker: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
    })
    const descriptor = {
      key: { device_id: 'device-a', period_kind: 'outing', period_id: 'outing-a' },
      contentRev: 1,
    }
    const request = runner.syncCatalog({ missionId: 'mission-1', chunks: [descriptor] })
    const build = {
      ...descriptor,
      fixCount: 0,
      fixDigest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      minTs: null,
      maxTs: null,
    }
    const period = createCoverageTileCatalog({
      missionId: 'mission-1', chunks: [descriptor],
    }).periods[0]!

    workers[0]!.reply({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000001-1',
      periods: [period],
      delivered: [descriptor],
      builds: [build, build],
    })

    await expect(request).rejects.toThrow(/catalog worker result/i)
    expect(workers[0]!.terminationCount).toBe(1)
    expect(onFailure).toHaveBeenCalledOnce()

    const retry = runner.syncCatalog({ missionId: 'mission-1', chunks: [descriptor] })
    expect(workers).toHaveLength(2)
    workers[1]!.reply({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000002-1',
      periods: [period],
      delivered: [descriptor],
      builds: [build],
    })
    await expect(retry).resolves.toMatchObject({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000002-1',
    })
  })

  it('keeps the finalized catalog readable after cancelling a replacement build', async () => {
    const databasePath = await createDatabase()
    runner = createCoverageTileRunner({
      databasePath,
      cacheDirectory: path.join(directory!, 'coverage-cancel-retained'),
      faultInjection: { chunkBuildDelayMs: 100 },
    })
    const keyA: ChunkKey = {
      device_id: 'device-a', period_kind: 'outing', period_id: 'outing-a',
    }
    const keyB: ChunkKey = {
      device_id: 'device-b', period_kind: 'outing', period_id: 'outing-b',
    }
    const retained = await runner.syncCatalog({
      missionId: 'mission-1', chunks: [{ key: keyA, contentRev: 1 }],
    })
    await runner.commitCatalog({ stageId: retained.stageId })
    await runner.finalizeCatalog({ stageId: retained.stageId })

    const abortController = new AbortController()
    const replacement = runner.syncCatalog({
      missionId: 'mission-1',
      chunks: [{ key: keyA, contentRev: 1 }, { key: keyB, contentRev: 1 }],
    }, { signal: abortController.signal })
    await new Promise((resolve) => setTimeout(resolve, 25))
    abortController.abort()

    await expect(replacement).rejects.toMatchObject({ name: 'AbortError' })
    const retainedTile = await runner.readTile({
      missionId: 'mission-1',
      periodKey: retained.periods[0]!.periodKey,
      revisionDigest: retained.periods[0]!.revisionDigest,
      ...lonLatToTile(-9.7, 52, 8),
    })
    expect(retainedTile).not.toBeNull()
    expect(retainedTile!.byteLength).toBeGreaterThan(0)
    await expect(runner.syncCatalog({
      missionId: 'mission-1', chunks: [{ key: keyA, contentRev: 1 }],
    })).resolves.toMatchObject({ stageId: expect.any(String) })
  })

  it('discards a completed stage when cancellation wins the response race', async () => {
    const databasePath = await createDatabase()
    runner = createCoverageTileRunner({
      databasePath,
      cacheDirectory: path.join(directory!, 'coverage-cancel-response-race'),
      faultInjection: { catalogResponseDelayMs: 100 },
    })
    const abortController = new AbortController()
    const staged = runner.syncCatalog({ missionId: 'mission-1', chunks: [] }, {
      signal: abortController.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    abortController.abort()

    await expect(staged).rejects.toMatchObject({ name: 'AbortError' })
    await expect(runner.syncCatalog({ missionId: 'mission-1', chunks: [] }))
      .resolves.toMatchObject({ stageId: expect.any(String) })
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

  it.each([
    ['error', new Error('worker exploded')],
    ['exit', 0],
  ] as const)('reports an unexpected worker %s event even without a non-zero exit', async (event, detail) => {
    const onFailure = vi.fn()
    const workers: FakeWorker[] = []
    runner = createCoverageTileRunner({
      databasePath: '/unused-unexpected-worker.sqlite',
      cacheDirectory: '/unused-unexpected-worker-cache',
      onFailure,
      createWorker: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
    })
    const request = runner.syncCatalog({ missionId: 'mission-1', chunks: [] })

    workers[0]!.emit(event, detail)

    await expect(request).rejects.toThrow(/coverage tile worker/i)
    expect(onFailure).toHaveBeenCalledOnce()
  })

  it('reports shared worker loss when any tile request times out', async () => {
    const onFailure = vi.fn()
    runner = createCoverageTileRunner({
      databasePath: '/unused-timeout-worker.sqlite',
      cacheDirectory: '/unused-timeout-worker-cache',
      timeoutMs: 1,
      onFailure,
      createWorker: () => new FakeWorker(),
    })

    await expect(runner.readTile({
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing-a',
      revisionDigest: 'revision-1',
      z: 8,
      x: 121,
      y: 83,
    })).rejects.toThrow(/timed out/i)

    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/timed out/i),
    }))
  })

  it('retries predecessor finalization on a replacement worker after timeout', async () => {
    const workers: FakeWorker[] = []
    runner = createCoverageTileRunner({
      databasePath: '/unused-finalization-timeout-worker.sqlite',
      cacheDirectory: '/unused-finalization-timeout-worker-cache',
      timeoutMs: 5,
      createWorker: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
    })
    const staged = runner.syncCatalog({ missionId: 'mission-1', chunks: [] })
    workers[0]!.reply({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000001-1',
      periods: [], delivered: [], builds: [],
    })
    const catalog = await staged
    const commit = runner.commitCatalog({ stageId: catalog.stageId })
    workers[0]!.reply(true)
    await commit

    await expect(runner.finalizeCatalog({ stageId: catalog.stageId }))
      .rejects.toThrow(/timed out/i)
    expect(workers[0]!.terminationCount).toBe(1)

    const retry = runner.finalizeCatalog({ stageId: catalog.stageId })
    expect(workers).toHaveLength(2)
    workers[1]!.reply(true)
    await expect(retry).resolves.toBe(true)
  })

  it('returns a valid empty PBF for a current tile with no intersecting geometry', async () => {
    const databasePath = await createDatabase()
    runner = createCoverageTileRunner({
      databasePath,
      cacheDirectory: path.join(directory!, 'coverage-empty-tiles'),
    })
    const keyA: ChunkKey = {
      device_id: 'device-a', period_kind: 'outing', period_id: 'outing-a',
    }
    const catalog = await runner.syncCatalog({
      missionId: 'mission-1', chunks: [{ key: keyA, contentRev: 1 }],
    })
    await runner.commitCatalog({ stageId: catalog.stageId })
    await runner.finalizeCatalog({ stageId: catalog.stageId })
    const period = catalog.periods[0]!

    const empty = await runner.readTile({
      missionId: 'mission-1',
      periodKey: period.periodKey,
      revisionDigest: period.revisionDigest,
      z: 8,
      x: 0,
      y: 0,
    })

    expect(ArrayBuffer.isView(empty)).toBe(true)
    expect(empty).toHaveLength(0)
  })

  it('rejects non-integer tile coordinates before resolving a cache path', async () => {
    const databasePath = await createDatabase()
    const cacheDirectory = path.join(directory!, 'coverage-coordinate-fence')
    runner = createCoverageTileRunner({ databasePath, cacheDirectory })
    const key: ChunkKey = {
      device_id: 'device-a', period_kind: 'outing', period_id: 'outing-a',
    }
    const catalog = await runner.syncCatalog({
      missionId: 'mission-1', chunks: [{ key, contentRev: 1 }],
    })
    await runner.commitCatalog({ stageId: catalog.stageId })
    await runner.finalizeCatalog({ stageId: catalog.stageId })

    await expect(runner.readTile({
      missionId: 'mission-1',
      periodKey: catalog.periods[0]!.periodKey,
      revisionDigest: catalog.periods[0]!.revisionDigest,
      z: 0,
      x: '0/../../../../../escaped',
      y: 0,
    })).rejects.toThrow(/tile coordinate/i)

    expect(await listFiles(directory!)).not.toContain('escaped')
  })

  it('never serves a current revision to a request from another mission', async () => {
    const databasePath = await createDatabase()
    runner = createCoverageTileRunner({
      databasePath,
      cacheDirectory: path.join(directory!, 'coverage-mission-fence'),
    })
    const keyA: ChunkKey = {
      device_id: 'device-a', period_kind: 'outing', period_id: 'outing-a',
    }
    const catalog = await runner.syncCatalog({
      missionId: 'mission-1', chunks: [{ key: keyA, contentRev: 1 }],
    })
    await runner.commitCatalog({ stageId: catalog.stageId })
    await runner.finalizeCatalog({ stageId: catalog.stageId })

    await expect(runner.readTile({
      missionId: 'mission-2',
      periodKey: catalog.periods[0]!.periodKey,
      revisionDigest: catalog.periods[0]!.revisionDigest,
      ...lonLatToTile(-9.7, 52, 8),
    })).resolves.toBeNull()
  })

  it('clears a failed commit stage so the next catalog retry can proceed', async () => {
    const databasePath = await createDatabase()
    runner = createCoverageTileRunner({
      databasePath,
      cacheDirectory: path.join(directory!, 'coverage-commit-failure'),
      faultInjection: { failCatalogCommitOnce: true },
    })
    const keyA: ChunkKey = {
      device_id: 'device-a', period_kind: 'outing', period_id: 'outing-a',
    }
    const first = await runner.syncCatalog({
      missionId: 'mission-1', chunks: [{ key: keyA, contentRev: 1 }],
    })

    await expect(runner.commitCatalog({ stageId: first.stageId }))
      .rejects.toThrow(/injected.*commit/i)
    await expect(runner.syncCatalog({
      missionId: 'mission-1', chunks: [{ key: keyA, contentRev: 1 }],
    })).resolves.toMatchObject({ stageId: expect.any(String) })
  })
})

class FakeWorker extends EventEmitter {
  readonly messages: Readonly<Record<string, unknown>>[] = []
  terminationCount = 0

  postMessage(message: Readonly<Record<string, unknown>>): void {
    this.messages.push(message)
  }

  reply(result: Readonly<Record<string, unknown>>): void {
    const requestId = this.messages.at(-1)?.requestId
    this.emit('message', { requestId, result })
  }

  async terminate(): Promise<number> {
    this.terminationCount += 1
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

async function listFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { recursive: true }).catch(() => [])
  return entries.map(String)
}
