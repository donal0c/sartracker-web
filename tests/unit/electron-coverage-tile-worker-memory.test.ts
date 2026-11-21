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
  for (const z of zooms) {
    for (const tile of tilesCovering(bounds, z)) {
      const bytes = await runner.readTile({
        missionId: MISSION_ID,
        periodKey: period.periodKey,
        revisionDigest: period.revisionDigest,
        ...tile,
      })
      if (bytes !== null && bytes.byteLength > 0) nonEmptyTiles += 1
    }
  }
  expect(failures).toEqual([])
  expect(nonEmptyTiles).toBeGreaterThan(0)
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
    await buildAndSweep(chunks, [12, 14, 16])
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
