import { afterEach, describe, expect, it } from 'vitest'

import {
  createFixtureDatabase,
  createRealCoverageTileRunner,
  generateWanderingFixes,
  lonLatToTile,
  MISSION_ID,
  publishCatalog,
  tilesCovering,
  type ChunkKey,
  type CoverageTileRunner,
  type CoverageWorkerDiagnostics,
  type FixtureDatabase,
  type FixtureFix,
} from '../support/coverage-tile-worker-fixture'

// COV-1 follow-up [DON-338]: the drill-down source cache inside the real
// coverage tile worker must stay bounded for a whole mission. The open
// outing's chunk changes on every poll, so each revision builds a new index.
// The cache charges each coordinate array its entries keep alive exactly once
// (by reference count), never more than its budget after any read, bounds its
// entry count including empty-tile entries, and drops every entry of a
// replaced index. Arrays of an entry's own index are reference counted but
// not charged: the index keeps them alive anyway and is never outlived.

let fixture: FixtureDatabase | undefined
let runner: CoverageTileRunner | undefined

afterEach(async () => {
  await runner?.close()
  runner = undefined
  await fixture?.remove()
  fixture = undefined
})

const START_MS = Date.parse('2026-11-07T08:00:00.000Z')
const CADENCE_MS = 3_000
const REVISIONS = 520
const FIXES_PER_REVISION = 20
const BUDGET_ENTRIES = 16
// The growing trail reaches 10,400 fixes split over four tile quadrants, so
// later revisions' clipped sources exceed this budget on their own and must
// be served uncached.
const BUDGET_POINTS = 1_500
const EMPTY_READS_PER_REVISION = 24
// A z10 tile corner (also a z12 and z14 corner) near 53 N, 6.3 W. A 0.02°
// trail around it is cut into copies at z10 and again at z12 (each wider than
// that level's tile buffer): those copies are what the cache pays for.
const CORNER = (() => {
  const tile = lonLatToTile(-6.3, 53, 10)
  const n = Math.PI * (1 - 2 * tile.y / 1024)
  return { lon: tile.x / 1024 * 360 - 180, lat: Math.atan(Math.sinh(n)) * 180 / Math.PI }
})()
// A compact, unchanging trail in the middle of a z14 tile: its z10, z12 and
// z14 entries all hold the same array of its own index, so evicting one of
// them leaves that array alive through the others.
const COMPACT = { lon: -6.255, lat: 53.012 }
const GROWING: ChunkKey = { device_id: 'device-0', period_kind: 'unassigned', period_id: '' }
const STEADY: ChunkKey = { device_id: 'device-1', period_kind: 'unassigned', period_id: '' }

type Violations = {
  overEntryBudget: number[]
  overPointBudget: number[]
  chargeNotDistinctRetained: number[]
  referenceCountMismatch: number[]
  retiredIndexEntries: number[]
}

/** Records every revision whose cache breaks a bound, miscounts, or keeps an unservable index. */
function recordViolations(violations: Violations, diagnostics: CoverageWorkerDiagnostics, revision: number) {
  if (diagnostics.sourceCacheEntries > BUDGET_ENTRIES) violations.overEntryBudget.push(revision)
  // A hard bound: no exception for a single source larger than the budget.
  if (diagnostics.sourceCachePoints > BUDGET_POINTS) violations.overPointBudget.push(revision)
  // The charge must equal the fixes in the distinct arrays the entries keep
  // alive beyond their own index, recounted from the entries' sources.
  if (diagnostics.sourceCachePoints !== diagnostics.sourceCacheRetainedPoints) {
    violations.chargeNotDistinctRetained.push(revision)
  }
  // Running reference counts must equal a recount over the entries.
  if (diagnostics.sourceCacheReferenceMismatches !== 0) violations.referenceCountMismatch.push(revision)
  const servable = new Set(diagnostics.servableIndexIds)
  if (diagnostics.sourceCacheIndexIds.some((id) => !servable.has(id))) {
    violations.retiredIndexEntries.push(revision)
  }
}

/** Square bounds of half-width `half` degrees around a point. */
function around(point: { lon: number; lat: number }, half: number) {
  return { minLat: point.lat - half, maxLat: point.lat + half, minLon: point.lon - half, maxLon: point.lon + half }
}

describe('whole-history tile worker source cache stays bounded [DON-338 COV-1]', () => {
  it('stays inside its bounds over 520 revisions of one growing chunk with wide empty-tile sweeps', async () => {
    fixture = await createFixtureDatabase()
    const growingFixes: FixtureFix[] = [...generateWanderingFixes({
      deviceId: GROWING.device_id,
      count: REVISIONS * FIXES_PER_REVISION,
      cadenceMs: CADENCE_MS,
      startMs: START_MS,
      centreLat: CORNER.lat,
      centreLon: CORNER.lon,
      boxDegrees: 0.02,
      seed: 7,
    })]
    fixture.insertFixes(generateWanderingFixes({
      deviceId: STEADY.device_id,
      count: 400,
      cadenceMs: CADENCE_MS,
      startMs: START_MS,
      centreLat: COMPACT.lat,
      centreLon: COMPACT.lon,
      boxDegrees: 0.002,
      seed: 11,
    }))
    fixture.setChunkRevision(STEADY, 1)
    const failures: string[] = []
    runner = createRealCoverageTileRunner({
      databasePath: fixture.databasePath,
      cacheDirectory: fixture.cacheDirectory,
      timeoutMs: 60_000,
      tuning: { sourceCacheEntries: BUDGET_ENTRIES, sourceCachePoints: BUDGET_POINTS },
      onFailure: (error) => failures.push(error.message),
    })
    const trails = [around(CORNER, 0.01), around(COMPACT, 0.001)]
    const origin = lonLatToTile(-6.3, 53, 15)
    let previous: { periodKey: string; revisionDigest: string } | null = null
    let maxEntries = 0
    let maxPoints = 0
    const violations: Violations = {
      overEntryBudget: [],
      overPointBudget: [],
      chargeNotDistinctRetained: [],
      referenceCountMismatch: [],
      retiredIndexEntries: [],
    }
    const snapshot = async (revision: number) => {
      const diagnostics = await runner!.readDiagnostics()
      expect(diagnostics.sourceCacheBudgetEntries).toBe(BUDGET_ENTRIES)
      expect(diagnostics.sourceCacheBudgetPoints).toBe(BUDGET_POINTS)
      recordViolations(violations, diagnostics, revision)
      maxEntries = Math.max(maxEntries, diagnostics.sourceCacheEntries)
      maxPoints = Math.max(maxPoints, diagnostics.sourceCachePoints)
    }

    for (let revision = 1; revision <= REVISIONS; revision += 1) {
      fixture.insertFixes(growingFixes.slice((revision - 1) * FIXES_PER_REVISION, revision * FIXES_PER_REVISION))
      fixture.setChunkRevision(GROWING, revision)
      const catalog = await publishCatalog(runner, [
        { key: GROWING, contentRev: revision },
        { key: STEADY, contentRev: 1 },
      ])
      expect(catalog.builds.map((build) => build.fixCount).sort((a, b) => a - b))
        .toEqual([400, revision * FIXES_PER_REVISION].sort((a, b) => a - b))
      // Right after finalize has purged the replaced revision's entries.
      await snapshot(revision)
      const period = catalog.periods[0]!
      const read = (tile: { z: number; x: number; y: number }) => runner!.readTile({
        missionId: MISSION_ID,
        periodKey: period.periodKey,
        revisionDigest: period.revisionDigest,
        ...tile,
      })

      // Tiles on both trails, through every cached level.
      for (const bounds of trails) {
        for (const z of [11, 13, 15, 16]) {
          let drawn = 0
          for (const tile of tilesCovering(bounds, z)) {
            if (((await read(tile))?.byteLength ?? 0) > 0) drawn += 1
          }
          expect(drawn, `revision ${revision} z${z}`).toBeGreaterThan(0)
        }
        await snapshot(revision)
      }
      // A wide sweep of empty tiles: each lies in a different z10 tile, so
      // each adds an empty-tile entry (an empty z10 source ends the drill).
      for (let step = 0; step < EMPTY_READS_PER_REVISION; step += 1) {
        const k = revision * EMPTY_READS_PER_REVISION + step
        const x = (origin.x + 64 * (k + 1)) % (1 << 15)
        const y = origin.y + 64 * (k % 8) - 256
        const bytes = await read({ z: 15, x, y })
        expect(bytes?.byteLength ?? 0).toBe(0)
      }

      // A replaced revision is never served again.
      if (previous !== null) {
        const tile = lonLatToTile(CORNER.lon + 0.0005, CORNER.lat + 0.0005, 16)
        expect(await runner.readTile({ missionId: MISSION_ID, ...previous, ...tile })).toBeNull()
      }
      previous = { periodKey: period.periodKey, revisionDigest: period.revisionDigest }

      await snapshot(revision)
    }

    const summary = (revisions: number[]) => ({ count: revisions.length, first: revisions.slice(0, 3) })
    expect(Object.fromEntries(Object.entries(violations).map(([name, list]) => [name, summary(list)])))
      .toEqual(Object.fromEntries(Object.keys(violations).map((name) => [name, summary([])])))
    expect(failures).toEqual([])
    // Both bounds were actually reached, so the test exercises eviction.
    expect(maxEntries).toBe(BUDGET_ENTRIES)
    expect(maxPoints).toBeGreaterThan(BUDGET_POINTS / 2)
    // Every accounting path ran: evictions, evictions that left a shared array
    // alive through another entry, purges of retired indexes, and oversized
    // sources served without being cached.
    const events = (await runner.readDiagnostics()).sourceCacheEvents
    console.info(`[DON-338 cache events] ${JSON.stringify(events)}; max charged fixes ${maxPoints}`)
    expect(events.evicted).toBeGreaterThan(0)
    expect(events.sharedArrayKeptAlive).toBeGreaterThan(0)
    expect(events.purged).toBeGreaterThan(0)
    expect(events.uncachedOversized).toBeGreaterThan(0)
  }, 240_000)
})
