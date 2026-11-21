import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createFixtureDatabase,
  createRealCoverageTileRunner,
  generateWanderingFixes,
  lonLatToTile,
  MISSION_ID,
  publishCatalog,
  type ChunkKey,
  type CoverageTileRunner,
  type FixtureDatabase,
  type FixtureFix,
  type FixtureOuting,
  type TileAddress,
} from '../support/coverage-tile-worker-fixture'

// DON-338 golden identity for the whole-history (purple) line. The worker was
// rewritten for memory (COV-1): rows stream instead of being materialized,
// each chunk has its own index instead of one index per period, drilled tiles
// are no longer cached in the index, and retained sources are compacted. None
// of that may change a single drawn feature: a break invented at an internal
// boundary is exactly the DON-338 field failure. Every tile here must be
// byte-identical to the pre-change algorithm below (reference), whose only
// deliberate change is COV-5: a line too short to survive simplification at a
// zoom is now drawn as a dot at its first fix instead of vanishing.

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (file: string, options: object) => {
  close: () => void
}
const geojsonvt = (require('geojson-vt') as { default: (data: object, options: object) => LegacyIndex }).default
const vtpbf = require('vt-pbf') as {
  fromGeojsonVt: (layers: Record<string, { features: unknown[] }>, options: object) => Uint8Array
}
const { createTrailSegments } = require('../../electron/coverage-trail-segmentation.cjs') as {
  createTrailSegments: (rows: readonly LegacyRow[], gapMs: number) => LegacyRow[][]
}
const { createAcceptedPositionIdentity, createCoverageRowsQuery } = require('../../electron/coverage-query.cjs') as {
  createAcceptedPositionIdentity: (row: LegacyRow) => string
  createCoverageRowsQuery: (database: unknown, missionId: string, key: ChunkKey) => {
    statement: { iterate: (...params: unknown[]) => Iterable<LegacyRow> }
    params: unknown[]
  }
}
const { createChunkKey, createPeriodKey } = require('../../electron/coverage-tile-catalog.cjs') as {
  createChunkKey: (key: ChunkKey) => string
  createPeriodKey: (key: ChunkKey) => string
}

type LegacyRow = { id: string; source_position_id: string | null; timestamp: string; lat: number; lon: number }
type LegacyFeature = {
  type: 'Feature'
  id: string
  geometry: { type: 'Point'; coordinates: number[] } | { type: 'LineString'; coordinates: number[][] }
  properties: Record<string, unknown>
}
type LegacyIndex = { getTile: (z: number, x: number, y: number) => { features: unknown[] } | null }
type Descriptor = { readonly key: ChunkKey; readonly contentRev: number }

const GAP_MS = 30 * 60 * 1000
const BASE_MS = Date.parse('2026-08-24T09:00:00.000Z')
const iso = (offsetMs: number) => new Date(BASE_MS + offsetMs).toISOString()
const MINUTE = 60_000

let fixture: FixtureDatabase | undefined
let runner: CoverageTileRunner | undefined

afterEach(async () => {
  await runner?.close()
  runner = undefined
  await fixture?.remove()
  fixture = undefined
})

/** Pre-change chunk materialization, verbatim in behaviour (coverage-tile-worker before DON-338). */
function legacyMaterialize(key: ChunkKey, contentRev: number) {
  const database = new Database(fixture!.databasePath, { readonly: true })
  try {
    const query = createCoverageRowsQuery(database, MISSION_ID, key)
    const rows = [...query.statement.iterate(...query.params)]
    const chunkKey = createChunkKey(key)
    const digest = createHash('sha256')
    rows.forEach((row, index) => {
      if (index > 0) digest.update('\n')
      digest.update(createAcceptedPositionIdentity(row))
    })
    const features: LegacyFeature[] = createTrailSegments(rows, GAP_MS).map((segment, index) => ({
      type: 'Feature',
      id: `${chunkKey}:${contentRev}:${index}`,
      geometry: segment.length === 1
        ? { type: 'Point', coordinates: [segment[0]!.lon, segment[0]!.lat] }
        : { type: 'LineString', coordinates: segment.map((row) => [row.lon, row.lat]) },
      properties: {
        chunk_key: chunkKey,
        device_id: key.device_id,
        period_kind: key.period_kind,
        period_id: key.period_id,
        content_rev: contentRev,
      },
    }))
    return {
      fixCount: rows.length,
      fixDigest: digest.digest('hex'),
      minTs: rows[0]?.timestamp ?? null,
      maxTs: rows.at(-1)?.timestamp ?? null,
      features,
    }
  } finally {
    database.close()
  }
}

/** Pre-change period index: one geojson-vt index over every chunk feature, in chunk order. */
function legacyPeriodIndex(features: readonly LegacyFeature[]): LegacyIndex | null {
  if (features.length === 0) return null
  return geojsonvt({ type: 'FeatureCollection', features }, {
    maxZoom: 16,
    indexMaxZoom: 8,
    indexMaxPoints: 100_000,
    tolerance: 3,
    buffer: 64,
    lineMetrics: false,
    promoteId: null,
  })
}

/**
 * COV-5 expectation, stated independently of the worker: geojson-vt drops a
 * whole line below zoom 16 when its Web Mercator length is under 3 px of a
 * 4096 extent; such a line must appear as a dot at its first fix, in every
 * tile whose 64-unit buffered extent holds that fix, after the indexed features.
 */
function expectedShortLineDots(features: readonly LegacyFeature[], tile: TileAddress) {
  if (tile.z >= 16) return []
  const project = ([lon, lat]: readonly number[]) => {
    const sin = Math.sin(lat! * Math.PI / 180)
    const y = 0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI
    return [lon! / 360 + 0.5, y < 0 ? 0 : y > 1 ? 1 : y] as const
  }
  const scale = 2 ** tile.z
  const tolerance = 3 / (scale * 4096)
  const buffer = 64 / 4096
  const dots = []
  for (const feature of features) {
    if (feature.geometry.type !== 'LineString') continue
    const points = feature.geometry.coordinates.map(project)
    let length = 0
    for (let index = 1; index < points.length; index += 1) {
      length += Math.sqrt((points[index]![0] - points[index - 1]![0]) ** 2 +
        (points[index]![1] - points[index - 1]![1]) ** 2)
    }
    if (!(length < tolerance)) continue
    const tileX = points[0]![0] * scale - tile.x
    const tileY = points[0]![1] * scale - tile.y
    if (tileX < -buffer || tileX > 1 + buffer || tileY < -buffer || tileY > 1 + buffer) continue
    dots.push({
      geometry: [[Math.round(4096 * tileX), Math.round(4096 * tileY)]],
      type: 1,
      tags: feature.properties,
      id: feature.id,
    })
  }
  return dots
}

/** Reference tile bytes exactly as the worker's readTile returns them. */
function referenceTileBytes(index: LegacyIndex | null, features: readonly LegacyFeature[], tile: TileAddress) {
  if (index === null) return Buffer.alloc(0)
  const legacy = index.getTile(tile.z, tile.x, tile.y)
  const dots = expectedShortLineDots(features, tile)
  if (legacy === null && dots.length === 0) return Buffer.alloc(0)
  return Buffer.from(vtpbf.fromGeojsonVt(
    { coverage: { features: [...(legacy?.features ?? []), ...dots] } },
    { version: 2, extent: 4096 },
  ))
}

/** Tiles holding any fix at every zoom, plus their neighbours from z10 (buffers, empty tiles). */
function tilesTouchedBy(fixes: readonly FixtureFix[]): TileAddress[] {
  const seen = new Map<string, TileAddress>()
  for (let z = 0; z <= 16; z += 1) {
    for (const fix of fixes) {
      const tile = lonLatToTile(fix.lon, fix.lat, z)
      const ring = z >= 10 ? 1 : 0
      for (let dx = -ring; dx <= ring; dx += 1) {
        for (let dy = -ring; dy <= ring; dy += 1) {
          const address = { z, x: tile.x + dx, y: tile.y + dy }
          seen.set(`${address.z}/${address.x}/${address.y}`, address)
        }
      }
    }
  }
  return [...seen.values()]
}

/**
 * Mirrors the worker's chunk order rule: a surviving chunk keeps its place,
 * removed chunks leave, new chunks join at the end in request order.
 */
function nextChunkOrder(prior: readonly string[], descriptors: readonly Descriptor[]) {
  const desired = descriptors.map((descriptor) => createChunkKey(descriptor.key))
  const kept = prior.filter((key) => desired.includes(key))
  return [...kept, ...desired.filter((key) => !kept.includes(key))]
}

/**
 * Publishes each step on the real worker and compares every build summary and
 * every touched tile of every period with the reference.
 */
async function expectGoldenIdentity(input: {
  readonly fixes: () => readonly FixtureFix[]
  readonly steps: readonly { readonly before?: () => void; readonly chunks: readonly Descriptor[] }[]
  readonly sourceCachePoints?: number
}) {
  const failures: string[] = []
  runner = createRealCoverageTileRunner({
    databasePath: fixture!.databasePath,
    cacheDirectory: fixture!.cacheDirectory,
    timeoutMs: 60_000,
    onFailure: (error) => failures.push(error.message),
    ...(input.sourceCachePoints === undefined ? {} : { tuning: { sourceCachePoints: input.sourceCachePoints } }),
  })
  let order: string[] = []
  let comparedTiles = 0
  for (const step of input.steps) {
    step.before?.()
    for (const descriptor of step.chunks) fixture!.setChunkRevision(descriptor.key, descriptor.contentRev)
    order = nextChunkOrder(order, step.chunks)
    const catalog = await publishCatalog(runner, step.chunks)
    const legacy = new Map(step.chunks.map((descriptor) => [
      createChunkKey(descriptor.key),
      { descriptor, ...legacyMaterialize(descriptor.key, descriptor.contentRev) },
    ]))
    expect(catalog.builds.map(({ key, fixCount, fixDigest, minTs, maxTs }) =>
      ({ key, fixCount, fixDigest, minTs, maxTs }))).toEqual(step.chunks.map((descriptor) => {
      const chunk = legacy.get(createChunkKey(descriptor.key))!
      return {
        key: descriptor.key,
        fixCount: chunk.fixCount,
        fixDigest: chunk.fixDigest,
        minTs: chunk.minTs,
        maxTs: chunk.maxTs,
      }
    }))
    const tiles = tilesTouchedBy(input.fixes())
    for (const period of catalog.periods) {
      const features = order
        .map((key) => legacy.get(key)!)
        .filter((chunk) => createPeriodKey(chunk.descriptor.key) === period.periodKey)
        .flatMap((chunk) => chunk.features)
      const index = legacyPeriodIndex(features)
      for (const tile of tiles) {
        const actual = await runner.readTile({
          missionId: MISSION_ID,
          periodKey: period.periodKey,
          revisionDigest: period.revisionDigest,
          ...tile,
        })
        const expected = referenceTileBytes(index, features, tile)
        if (!Buffer.from(actual!).equals(expected)) {
          throw new Error(`Tile ${tile.z}/${tile.x}/${tile.y} of ${period.periodKey} differs from the reference.`)
        }
        comparedTiles += 1
      }
    }
  }
  expect(failures).toEqual([])
  return comparedTiles
}

const unassigned = (deviceId: string): ChunkKey => ({ device_id: deviceId, period_kind: 'unassigned', period_id: '' })
const outing = (deviceId: string, outingId: string): ChunkKey => ({ device_id: deviceId, period_kind: 'outing', period_id: outingId })

/** A hand-placed fix. */
function fix(deviceId: string, index: number, offsetMs: number, lat: number, lon: number): FixtureFix {
  return {
    id: `${deviceId}-${String(index).padStart(7, '0')}`,
    sourcePositionId: `source-${deviceId}-${index}`,
    deviceId,
    timestamp: iso(offsetMs),
    lat,
    lon,
  }
}

/** Seeds one shape and returns all of its fixes. */
async function seed(fixes: readonly FixtureFix[], outings: readonly FixtureOuting[] = []) {
  fixture = await createFixtureDatabase(outings)
  fixture.insertFixes(fixes)
  return fixes
}

describe('whole-history line is unchanged by the memory rewrite [DON-338 COV-1 golden]', () => {
  for (const sourceCachePoints of [undefined, 0]) {
    const label = sourceCachePoints === undefined ? 'default source cache' : 'source cache evicting every entry'

    it(`matches the reference for single fixes, short and long lines, gaps and ties (${label})`, async () => {
      const fixes = await seed([
        fix('lone', 0, 0, 52.1, -9.7),
        fix('pair', 0, 0, 52.1, -9.7),
        fix('pair', 1, MINUTE, 52.11, -9.69),
        // Exactly 30 min joins; 30 min + 1 ms breaks; a lone fix between two long gaps.
        fix('gaps', 0, 0, 52.2, -9.6),
        fix('gaps', 1, MINUTE, 52.201, -9.601),
        fix('gaps', 2, MINUTE + GAP_MS, 52.202, -9.602),
        fix('gaps', 3, MINUTE + 2 * GAP_MS + 1, 52.203, -9.603),
        fix('gaps', 4, MINUTE + 2 * GAP_MS + 2, 52.204, -9.604),
        fix('gaps', 5, 4 * GAP_MS, 52.205, -9.605),
        fix('gaps', 6, 6 * GAP_MS, 52.206, -9.606),
        fix('gaps', 7, 6 * GAP_MS + MINUTE, 52.207, -9.607),
        // Identical timestamps are ordered by stored id.
        fix('gaps', 8, 6 * GAP_MS + MINUTE, 52.208, -9.608),
        fix('gaps', 9, 6 * GAP_MS + 2 * MINUTE, 52.209, -9.609),
      ])
      const chunks = ['lone', 'pair', 'gaps'].map((device) => ({ key: unassigned(device), contentRev: 1 }))
      const compared = await expectGoldenIdentity({ fixes: () => fixes, steps: [{ chunks }], sourceCachePoints })
      expect(compared).toBeGreaterThan(100)
    }, 60_000)

    it(`matches the reference across outing and unassigned periods with several devices (${label})`, async () => {
      const outings: FixtureOuting[] = [
        { id: 'outing-1', startedAt: iso(0), endedAt: iso(120 * MINUTE) },
        { id: 'outing-2', startedAt: iso(120 * MINUTE), endedAt: null },
      ]
      const all: FixtureFix[] = []
      for (const [deviceIndex, device] of ['a', 'b', 'c'].entries()) {
        let lat = 52.3 + deviceIndex * 0.002
        for (let index = 0; index < 400; index += 1) {
          lat += 0.00003
          all.push(fix(device, index, -60 * MINUTE + index * 45_000, lat, -9.5 + index * 0.00004))
        }
      }
      const fixes = await seed(all, outings)
      const chunks: Descriptor[] = [
        { key: unassigned('a'), contentRev: 1 },
        { key: outing('a', 'outing-1'), contentRev: 1 },
        { key: outing('b', 'outing-1'), contentRev: 1 },
        { key: outing('a', 'outing-2'), contentRev: 1 },
        { key: unassigned('b'), contentRev: 1 },
        { key: outing('b', 'outing-2'), contentRev: 1 },
        { key: outing('c', 'outing-2'), contentRev: 1 },
        { key: outing('c', 'outing-1'), contentRev: 1 },
        { key: unassigned('c'), contentRev: 1 },
      ]
      await expectGoldenIdentity({ fixes: () => fixes, steps: [{ chunks }], sourceCachePoints })
    }, 60_000)

    it(`matches the reference through incremental rebuilds, additions and removals (${label})`, async () => {
      const wander = (device: string, count: number, startIndex: number, startMs: number, seedValue: number) =>
        [...generateWanderingFixes({
          deviceId: device, count, cadenceMs: 5_000, startMs: BASE_MS + startMs,
          centreLat: 52.4, centreLon: -9.4, boxDegrees: 0.01, seed: seedValue,
          idPrefix: `${device}-${startIndex}`,
        })]
      const all = [
        ...wander('a', 500, 0, 0, 1),
        ...wander('b', 500, 0, 0, 2),
        ...wander('c', 500, 0, 0, 3),
      ]
      const fixes = await seed(all)
      const additions = [
        ...wander('b', 150, 1, 500 * 5_000, 4),
        ...wander('b', 50, 2, 500 * 5_000 + 150 * 5_000 + GAP_MS + 1, 5),
      ]
      const late = wander('d', 300, 0, 0, 6)
      await expectGoldenIdentity({
        fixes: () => [...all, ...additions, ...late],
        sourceCachePoints,
        steps: [
          { chunks: ['a', 'b', 'c'].map((device) => ({ key: unassigned(device), contentRev: 1 })) },
          {
            before: () => fixture!.insertFixes(additions),
            chunks: [
              { key: unassigned('a'), contentRev: 1 },
              { key: unassigned('b'), contentRev: 2 },
              { key: unassigned('c'), contentRev: 1 },
            ],
          },
          {
            before: () => fixture!.insertFixes(late),
            chunks: [
              { key: unassigned('b'), contentRev: 2 },
              { key: unassigned('c'), contentRev: 1 },
              { key: unassigned('d'), contentRev: 1 },
            ],
          },
        ],
      })
      expect(fixes.length).toBe(1_500)
    }, 60_000)
  }

  // geojson-vt stops pre-building an index at 100,000 points per tile. Per-chunk
  // indexes cross that threshold at different totals than one period-wide
  // index did, so test one under, exactly at and one over, in one chunk and
  // split across two chunks of the same period.
  for (const total of [99_999, 100_000, 100_001]) {
    it(`matches the reference with ${total} fixes in one chunk`, async () => {
      const fixes = await seed([...generateWanderingFixes({
        deviceId: 'big', count: total, cadenceMs: 3_000, startMs: BASE_MS,
        centreLat: 52.5, centreLon: -9.3, boxDegrees: 0.004, seed: 7,
      })])
      await expectGoldenIdentity({
        fixes: () => fixes,
        steps: [{ chunks: [{ key: unassigned('big'), contentRev: 1 }] }],
      })
    }, 120_000)

    it(`matches the reference with ${total} fixes split across two chunks of one period`, async () => {
      const fixes = await seed([
        ...generateWanderingFixes({
          deviceId: 'first', count: 50_000, cadenceMs: 3_000, startMs: BASE_MS,
          centreLat: 52.5, centreLon: -9.3, boxDegrees: 0.004, seed: 8,
        }),
        ...generateWanderingFixes({
          deviceId: 'second', count: total - 50_000, cadenceMs: 3_000, startMs: BASE_MS,
          centreLat: 52.501, centreLon: -9.301, boxDegrees: 0.004, seed: 9,
        }),
      ])
      await expectGoldenIdentity({
        fixes: () => fixes,
        sourceCachePoints: total === 100_000 ? 0 : undefined,
        steps: [{
          chunks: [
            { key: unassigned('first'), contentRev: 1 },
            { key: unassigned('second'), contentRev: 1 },
          ],
        }],
      })
    }, 120_000)
  }
})

describe('short lines stay visible below the closest zoom [DON-338 COV-5]', () => {
  it('draws a line too short to simplify as a dot at its first fix instead of dropping it', async () => {
    const standing = Array.from({ length: 50 }, (_, index) =>
      fix('standing', index, index * 5_000, 52.6 + (index % 3) * 0.0000001, -9.2 + (index % 2) * 0.0000001))
    const fixes = await seed([
      ...standing,
      fix('walker', 0, 0, 52.6, -9.21),
      fix('walker', 1, 600_000, 52.61, -9.2),
    ])
    const chunks = [{ key: unassigned('standing'), contentRev: 1 }, { key: unassigned('walker'), contentRev: 1 }]
    runner = createRealCoverageTileRunner({ databasePath: fixture!.databasePath, cacheDirectory: fixture!.cacheDirectory })
    for (const descriptor of chunks) fixture!.setChunkRevision(descriptor.key, 1)
    const catalog = await publishCatalog(runner, chunks)
    const period = catalog.periods[0]!
    const features = chunks.flatMap((descriptor) => legacyMaterialize(descriptor.key, 1).features)
    const index = legacyPeriodIndex(features)!
    const standingLineId = features.find((feature) => feature.properties.device_id === 'standing')!.id

    const zoomed = lonLatToTile(-9.2, 52.6, 12)
    const legacyZoomed = index.getTile(zoomed.z, zoomed.x, zoomed.y) as { features: { id: string; type: number }[] }
    // Before COV-5 the standing device's line simply vanished at zoom 12.
    expect(legacyZoomed.features.some((feature) => feature.id === standingLineId)).toBe(false)
    const dots = expectedShortLineDots(features, zoomed)
    expect(dots.map((dot) => dot.id)).toEqual([standingLineId])
    const actual = await runner.readTile({
      missionId: MISSION_ID, periodKey: period.periodKey, revisionDigest: period.revisionDigest, ...zoomed,
    })
    expect(Buffer.from(actual!).equals(referenceTileBytes(index, features, zoomed))).toBe(true)
    expect(Buffer.from(actual!).equals(Buffer.from(vtpbf.fromGeojsonVt(
      { coverage: { features: legacyZoomed.features } }, { version: 2, extent: 4096 },
    )))).toBe(false)

    // At the closest zoom the line itself is drawn and no dot is added.
    const closest = lonLatToTile(-9.2, 52.6, 16)
    const legacyClosest = index.getTile(closest.z, closest.x, closest.y) as { features: { id: string; type: number }[] }
    expect(legacyClosest.features.find((feature) => feature.id === standingLineId)?.type).toBe(2)
    expect(expectedShortLineDots(features, closest)).toEqual([])
    const closestActual = await runner.readTile({
      missionId: MISSION_ID, periodKey: period.periodKey, revisionDigest: period.revisionDigest, ...closest,
    })
    expect(Buffer.from(closestActual!).equals(referenceTileBytes(index, features, closest))).toBe(true)
    expect(fixes).toHaveLength(52)
  }, 60_000)
})
