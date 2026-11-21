import { afterEach, describe, expect, it } from 'vitest'

import {
  createFixtureDatabase,
  createRealCoverageTileRunner,
  digestFixes,
  generateWanderingFixes,
  MISSION_ID,
  publishCatalog,
  tilesCovering,
  type ChunkKey,
  type CoverageTileRunner,
  type CoverageWorkerDiagnostics,
  type FaultInjection,
  type FixtureDatabase,
  type FixtureFix,
} from '../support/coverage-tile-worker-fixture'

// COV-1 [DON-338]: the whole-history (purple) line is built by the real coverage
// tile worker under the production mission-worker heap limit (128 MB). These
// cases run that real worker at realistic long-mission scale. Before the fix
// one device x 180,000 fixes ran out of memory while building, and 34 devices x
// 18,000 fixes ran out of memory during a zoomed-in sweep.

let fixture: FixtureDatabase | undefined
let runner: CoverageTileRunner | undefined

afterEach(async () => {
  await runner?.close()
  runner = undefined
  await fixture?.remove()
  fixture = undefined
})

// Healthy ~10 ms/tile on this dense 34-device box (same as before round 2);
// churn measured ~100 ms/tile.
const WARM_Z16_LIMIT_MS = 35
const START_MS = Date.parse('2026-11-07T08:00:00.000Z')

/** Seeds devices x fixes (unassigned period) and returns per-device fixes. */
async function seedMission(devices: number, fixesPerDevice: number, cadenceMs: number) {
  fixture = await createFixtureDatabase()
  const chunks: { key: ChunkKey; contentRev: number; expected: { count: number; digest: string } }[] = []
  for (let device = 0; device < devices; device += 1) {
    const deviceId = `device-${device}`
    const fixes: FixtureFix[] = [...generateWanderingFixes({
      deviceId,
      count: fixesPerDevice,
      cadenceMs,
      startMs: START_MS,
      centreLat: 53 + (device % 6) * 0.004,
      centreLon: -6.3 + Math.floor(device / 6) * 0.006,
      boxDegrees: 0.012,
      seed: device + 1,
    })]
    fixture.insertFixes(fixes)
    const key: ChunkKey = { device_id: deviceId, period_kind: 'unassigned', period_id: '' }
    fixture.setChunkRevision(key, 1)
    chunks.push({ key, contentRev: 1, expected: { count: fixes.length, digest: digestFixes(fixes) } })
  }
  return chunks
}

/** Builds the catalog and reads every tile of the mission area at each zoom. */
async function buildAndSweep(
  chunks: Awaited<ReturnType<typeof seedMission>>,
  zooms: readonly number[],
) {
  const failures: string[] = []
  runner = createRealCoverageTileRunner({
    databasePath: fixture!.databasePath,
    cacheDirectory: fixture!.cacheDirectory,
    timeoutMs: 60_000,
    onFailure: (error) => failures.push(error.message),
  })
  const catalog = await publishCatalog(runner, chunks.map(({ key, contentRev }) => ({ key, contentRev })))
  expect(catalog.builds.map((build) => build.fixCount))
    .toEqual(chunks.map((chunk) => chunk.expected.count))
  expect(catalog.builds.map((build) => build.fixDigest))
    .toEqual(chunks.map((chunk) => chunk.expected.digest))
  const period = catalog.periods[0]!
  const bounds = { minLat: 52.99, maxLat: 53.03, minLon: -6.31, maxLon: -6.26 }
  let nonEmptyTiles = 0
  const timings: Record<string, { tiles: number; ms: number }> = {}
  for (const z of zooms) {
    const started = performance.now()
    let tiles = 0
    for (const tile of tilesCovering(bounds, z)) {
      tiles += 1
      const bytes = await runner.readTile({
        missionId: MISSION_ID,
        periodKey: period.periodKey,
        revisionDigest: period.revisionDigest,
        ...tile,
      })
      if (bytes !== null && bytes.byteLength > 0) nonEmptyTiles += 1
    }
    timings[z in timings ? `${z} again` : z] = { tiles, ms: performance.now() - started }
  }
  expect(failures).toEqual([])
  expect(nonEmptyTiles).toBeGreaterThan(0)
  return timings
}

describe('whole-history tile worker memory at mission scale [DON-338 COV-1]', () => {
  it('builds and serves one device x 200,000 fixes at 3 s cadence', async () => {
    const chunks = await seedMission(1, 200_000, 3_000)
    await buildAndSweep(chunks, [0, 8, 12, 14, 16])
  }, 120_000)

  it('builds and serves 34 devices x 18,000 fixes at 3 s cadence through a z16 sweep', async () => {
    const chunks = await seedMission(34, 18_000, 3_000)
    await buildAndSweep(chunks, [10, 12, 14, 16])
  }, 120_000)

  it('builds and serves 34 devices x 24 h at 2 s cadence (43,200 fixes each) through a z16 sweep', async () => {
    const chunks = await seedMission(34, 43_200, 2_000)
    const timings = await buildAndSweep(chunks, [12, 14, 16, 16])
    const report = Object.entries(timings).map(([label, { tiles, ms }]) =>
      `${label} ${tiles} tiles ${Math.round(ms)} ms (${(ms / tiles).toFixed(1)} ms/tile)`)
    console.info(`[DON-338 sweep] ${report.join('; ')}`)
    // Responsiveness guard: the second z16 pass re-reads tiles whose drill-down
    // sources are cached. Healthy, that is a few ms per tile; when the source
    // cache churned (round 2) every read re-drilled every chunk. The limit
    // leaves wide headroom for a loaded machine yet fails on churn.
    const warm = timings['16 again']!
    expect(warm.ms / warm.tiles).toBeLessThan(WARM_Z16_LIMIT_MS)
  }, 180_000)
})

describe('whole-history tile worker death is loud and recoverable [DON-338 COV-1]', () => {
  it('reports running out of memory in operator words and rebuilds on a fresh worker', async () => {
    const chunks = await seedMission(1, 100, 3_000)
    const failures: (Error & { code?: string })[] = []
    const faultInjection: FaultInjection = { exhaustHeapOnSync: true }
    runner = createRealCoverageTileRunner({
      databasePath: fixture!.databasePath,
      cacheDirectory: fixture!.cacheDirectory,
      faultInjection,
      onFailure: (error) => failures.push(error),
    })
    const descriptors = chunks.map(({ key, contentRev }) => ({ key, contentRev }))

    const failed = runner.syncCatalog({ missionId: MISSION_ID, chunks: descriptors })
    await expect(failed).rejects.toMatchObject({
      code: 'coverage-worker-out-of-memory',
      message: expect.stringMatching(/ran out of memory.*whole-history line.*not shown/u),
    })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ code: 'coverage-worker-out-of-memory' })

    faultInjection.exhaustHeapOnSync = false
    const catalog = await publishCatalog(runner, descriptors)
    expect(catalog.builds[0]!.fixCount).toBe(100)
    const period = catalog.periods[0]!
    const bytes = await runner.readTile({
      missionId: MISSION_ID,
      periodKey: period.periodKey,
      revisionDigest: period.revisionDigest,
      z: 0,
      x: 0,
      y: 0,
    })
    expect(bytes!.byteLength).toBeGreaterThan(0)
    expect(failures).toHaveLength(1)
  }, 60_000)
})

describe('whole-history tile worker memory stays flat over a long mission [DON-338 COV-1]', () => {
  it('keeps the heap flat over 300 revisions of the open chunk at 34 devices x 18,000 fixes', async () => {
    const revisions = 300
    const fixesPerRevision = 20
    const chunks = await seedMission(34, 18_000, 3_000)
    // Device 0's open chunk keeps growing after its first 18,000 fixes.
    const growth: FixtureFix[] = [...generateWanderingFixes({
      deviceId: 'device-0',
      count: 18_000 + revisions * fixesPerRevision,
      cadenceMs: 3_000,
      startMs: START_MS,
      centreLat: 53,
      centreLon: -6.3,
      boxDegrees: 0.012,
      seed: 1,
    })].slice(18_000)
    const failures: string[] = []
    runner = createRealCoverageTileRunner({
      databasePath: fixture!.databasePath,
      cacheDirectory: fixture!.cacheDirectory,
      timeoutMs: 60_000,
      onFailure: (error) => failures.push(error.message),
    })
    const descriptors = chunks.map(({ key, contentRev }) => ({ key, contentRev }))
    let catalog = await publishCatalog(runner, descriptors)
    const bounds = { minLat: 52.99, maxLat: 53.03, minLon: -6.31, maxLon: -6.26 }
    const sweep = [12, 14, 16].flatMap((z) => tilesCovering(bounds, z))
    const samples: CoverageWorkerDiagnostics[] = []
    let cursor = 0

    for (let revision = 2; revision <= revisions + 1; revision += 1) {
      fixture!.insertFixes(growth.slice((revision - 2) * fixesPerRevision, (revision - 1) * fixesPerRevision))
      fixture!.setChunkRevision(descriptors[0]!.key, revision)
      descriptors[0] = { key: descriptors[0]!.key, contentRev: revision }
      catalog = await publishCatalog(runner, descriptors)
      const period = catalog.periods[0]!
      for (let read = 0; read < 24; read += 1) {
        const tile = sweep[cursor % sweep.length]!
        cursor += 1
        await runner.readTile({
          missionId: MISSION_ID,
          periodKey: period.periodKey,
          revisionDigest: period.revisionDigest,
          ...tile,
        })
      }
      samples.push(await runner.readDiagnostics())
    }

    expect(catalog.builds.reduce((sum, build) => sum + build.fixCount, 0))
      .toBe(34 * 18_000 + revisions * fixesPerRevision)
    expect(failures).toEqual([])
    const window = (from: number) => samples.slice(from, from + 30)
    // Retained coordinates live in Float64Arrays outside the V8 heap, so a
    // leak of old revisions shows in external memory, not in used heap.
    const median = (list: readonly CoverageWorkerDiagnostics[], read: (sample: CoverageWorkerDiagnostics) => number) => {
      const sorted = list.map(read).sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)]!
    }
    const medianHeap = (list: readonly CoverageWorkerDiagnostics[]) => median(list, (sample) => sample.usedHeapBytes)
    const medianExternal = (list: readonly CoverageWorkerDiagnostics[]) =>
      median(list, (sample) => sample.externalBytes ?? Number.NaN)
    const mb = (bytes: number) => Math.round(bytes / 1024 / 1024 * 10) / 10
    const start = medianHeap(window(0))
    const middle = medianHeap(window(Math.floor(revisions / 2) - 15))
    const end = medianHeap(window(revisions - 30))
    const peak = Math.max(...samples.map((sample) => sample.usedHeapBytes))
    const externalStart = medianExternal(window(0))
    const externalMiddle = medianExternal(window(Math.floor(revisions / 2) - 15))
    const externalEnd = medianExternal(window(revisions - 30))
    console.info(`[DON-338 soak] used heap MB start ${mb(start)} middle ${mb(middle)} end ${mb(end)} peak ${mb(peak)}; ` +
      `external MB start ${mb(externalStart)} middle ${mb(externalMiddle)} end ${mb(externalEnd)}; ` +
      `cache entries end ${samples.at(-1)!.sourceCacheEntries}, fixes end ${samples.at(-1)!.sourceCachePoints}`)
    for (const sample of samples) {
      const servable = new Set(sample.servableIndexIds)
      expect(sample.sourceCacheIndexIds.filter((id) => !servable.has(id))).toEqual([])
      expect(sample.sourceCacheEntries).toBeLessThanOrEqual(sample.sourceCacheBudgetEntries)
      expect(sample.sourceCachePoints).toBe(sample.sourceCacheRetainedPoints)
    }
    // Flat, not climbing: the late heap is within 16 MB of the early heap.
    expect(end - start).toBeLessThan(16 * 1024 * 1024)
    expect(middle - start).toBeLessThan(16 * 1024 * 1024)
    expect(externalEnd - externalMiddle).toBeLessThan(16 * 1024 * 1024)
    expect(externalEnd - externalStart).toBeLessThan(32 * 1024 * 1024)
  }, 300_000)
})
