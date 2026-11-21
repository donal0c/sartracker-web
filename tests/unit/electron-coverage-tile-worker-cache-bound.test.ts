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
// outing's chunk changes on every poll, so each revision builds a new index;
// the cache must charge what each entry really retains (a compact trail's
// clipped source is the same array as its parent's), bound its entry count
// including empty-tile entries, and drop every entry of a replaced index.

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
// The trail grows to 10,400 fixes, so from about revision 250 its clipped
// sources exceed this budget on their own and must be served uncached.
const BUDGET_POINTS = 5_000
const EMPTY_READS_PER_REVISION = 24
const KEY: ChunkKey = { device_id: 'device-0', period_kind: 'unassigned', period_id: '' }

type Violations = {
  overEntryBudget: number[]
  overPointBudget: number[]
  chargeNotRetained: number[]
  retiredIndexEntries: number[]
}

/** Records every revision whose cache breaks a bound or keeps an unservable index. */
function recordViolations(violations: Violations, diagnostics: CoverageWorkerDiagnostics, revision: number) {
  if (diagnostics.sourceCacheEntries > BUDGET_ENTRIES) violations.overEntryBudget.push(revision)
  // A hard bound: no exception for a single source larger than the budget.
  if (diagnostics.sourceCachePoints > BUDGET_POINTS) {
    violations.overPointBudget.push(revision)
  }
  // The charge must be what entries actually keep alive, shared arrays included.
  if (diagnostics.sourceCachePoints !== diagnostics.sourceCacheRetainedPoints) {
    violations.chargeNotRetained.push(revision)
  }
  const servable = new Set(diagnostics.servableIndexIds)
  if (diagnostics.sourceCacheIndexIds.some((id) => !servable.has(id))) {
    violations.retiredIndexEntries.push(revision)
  }
}

describe('whole-history tile worker source cache stays bounded [DON-338 COV-1]', () => {
  it('stays inside its bounds over 520 revisions of one growing chunk with wide empty-tile sweeps', async () => {
    fixture = await createFixtureDatabase()
    const allFixes: FixtureFix[] = [...generateWanderingFixes({
      deviceId: KEY.device_id,
      count: REVISIONS * FIXES_PER_REVISION,
      cadenceMs: CADENCE_MS,
      startMs: START_MS,
      centreLat: 53,
      centreLon: -6.3,
      // Compact: the whole trail sits inside one z14 tile, so clipped sources
      // at z10/12/14 are the parent's own arrays.
      boxDegrees: 0.002,
      seed: 7,
    })]
    const failures: string[] = []
    runner = createRealCoverageTileRunner({
      databasePath: fixture.databasePath,
      cacheDirectory: fixture.cacheDirectory,
      timeoutMs: 60_000,
      tuning: { sourceCacheEntries: BUDGET_ENTRIES, sourceCachePoints: BUDGET_POINTS },
      onFailure: (error) => failures.push(error.message),
    })
    const trailBounds = { minLat: 52.998, maxLat: 53.002, minLon: -6.302, maxLon: -6.298 }
    const origin = lonLatToTile(-6.3, 53, 15)
    let previous: { periodKey: string; revisionDigest: string } | null = null
    let maxEntries = 0
    let maxPoints = 0
    let maxIndexIds = 0
    const violations: Violations = {
      overEntryBudget: [], overPointBudget: [], chargeNotRetained: [], retiredIndexEntries: [],
    }
    const snapshot = async (revision: number) => {
      const diagnostics = await runner!.readDiagnostics()
      expect(diagnostics.sourceCacheBudgetEntries).toBe(BUDGET_ENTRIES)
      expect(diagnostics.sourceCacheBudgetPoints).toBe(BUDGET_POINTS)
      recordViolations(violations, diagnostics, revision)
      maxEntries = Math.max(maxEntries, diagnostics.sourceCacheEntries)
      maxPoints = Math.max(maxPoints, diagnostics.sourceCachePoints)
      maxIndexIds = Math.max(maxIndexIds, diagnostics.sourceCacheIndexIds.length)
    }

    for (let revision = 1; revision <= REVISIONS; revision += 1) {
      fixture.insertFixes(allFixes.slice((revision - 1) * FIXES_PER_REVISION, revision * FIXES_PER_REVISION))
      fixture.setChunkRevision(KEY, revision)
      const catalog = await publishCatalog(runner, [{ key: KEY, contentRev: revision }])
      expect(catalog.builds[0]!.fixCount).toBe(revision * FIXES_PER_REVISION)
      const period = catalog.periods[0]!
      const read = (tile: { z: number; x: number; y: number }) => runner!.readTile({
        missionId: MISSION_ID,
        periodKey: period.periodKey,
        revisionDigest: period.revisionDigest,
        ...tile,
      })

      // Tiles on the trail, through every cached level.
      for (const z of [11, 13, 15, 16]) {
        let drawn = 0
        for (const tile of tilesCovering(trailBounds, z)) {
          if (((await read(tile))?.byteLength ?? 0) > 0) drawn += 1
        }
        expect(drawn, `revision ${revision} z${z}`).toBeGreaterThan(0)
      }
      await snapshot(revision)
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
        expect(await runner.readTile({ missionId: MISSION_ID, ...previous, z: 16, ...lonLatToTile(-6.3, 53, 16) }))
          .toBeNull()
      }
      previous = { periodKey: period.periodKey, revisionDigest: period.revisionDigest }

      await snapshot(revision)
    }

    const summary = (revisions: number[]) => ({ count: revisions.length, first: revisions.slice(0, 3) })
    expect({
      overEntryBudget: summary(violations.overEntryBudget),
      overPointBudget: summary(violations.overPointBudget),
      chargeNotRetained: summary(violations.chargeNotRetained),
      retiredIndexEntries: summary(violations.retiredIndexEntries),
    }).toEqual({
      overEntryBudget: summary([]),
      overPointBudget: summary([]),
      chargeNotRetained: summary([]),
      retiredIndexEntries: summary([]),
    })
    expect(failures).toEqual([])
    // Both bounds were actually reached, so the test exercises eviction.
    expect(maxEntries).toBe(BUDGET_ENTRIES)
    expect(maxPoints).toBeGreaterThan(BUDGET_POINTS / 2)
    expect(maxIndexIds).toBe(1)
  }, 180_000)
})
