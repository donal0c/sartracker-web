// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createFixturePlan,
  fieldShapeFix,
  FIELD_COUNT_LIMITS,
} from '../../build/seed-mission-store-lib.js'
import { generateMissionStoreFixture } from '../../build/seed-mission-store-runtime.js'
import { trailGapFindings } from '../../scripts/team-smoke/lib/whole-trail.mjs'
import { createBreadcrumbAccumulator } from '../../src/features/tracking/breadcrumb-accumulator'
import { createBreadcrumbFeatureCollection } from '../../src/features/tracking/tracking-geojson'
import type { NormalizedTrackingPosition, TrackingSnapshot } from '../../src/features/tracking/tracking-types'

/**
 * DON-338 / SAR-FIELD-002 scale regressions. No earlier test put more than
 * 10,000 fixes on one device, so every count limit (10,000-dot page, 5,000
 * live breadcrumbs per device, 30-minute line break, 128 MB tile worker) went
 * untested at field scale. Each test here drives a real code path with the
 * field-shape fixtures and asserts what the operator would see: every stored
 * fix on a drawn line.
 *
 * Three of these (LIV-1, LIV-4, COV-1) were red before the DON-338 fixes.
 */

const require = createRequire(import.meta.url)
const { createCoverageTileRunner } = require('../../electron/coverage-tile-runner.cjs') as {
  readonly createCoverageTileRunner: (input: {
    readonly databasePath: string
    readonly cacheDirectory: string
    readonly timeoutMs?: number
    readonly onFailure?: (error: Error) => void
  }) => CoverageTileRunner
}
const { VectorTile } = require('@mapbox/vector-tile') as {
  readonly VectorTile: new (pbf: unknown) => {
    readonly layers: Record<string, {
      readonly length: number
      readonly feature: (index: number) => {
        readonly properties: Record<string, unknown>
        readonly toGeoJSON: (x: number, y: number, z: number) => { readonly geometry: { readonly type: string, readonly coordinates: unknown } }
      }
    } | undefined>
  }
}
const PbfModule = require('pbf') as { readonly default?: new (bytes: Uint8Array) => unknown } & (new (bytes: Uint8Array) => unknown)
const Pbf = PbfModule.default ?? PbfModule

type CoverageTileRunner = {
  readonly syncCatalog: (payload: unknown) => Promise<{
    readonly stageId: string
    readonly periods: readonly { readonly periodKey: string, readonly revisionDigest: string }[]
  }>
  readonly commitCatalog: (payload: unknown) => Promise<unknown>
  readonly readTile: (payload: unknown) => Promise<Uint8Array | null>
  readonly close: () => Promise<void>
}
type StoredFix = { readonly deviceId: string, readonly lat: number, readonly lon: number, readonly time: number }
type Drawn = Record<string, { lines: number[][][], points: number[][] }>

const LINE_BREAK_MS = FIELD_COUNT_LIMITS.lineBreakMs
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('[DON-338] trails at field scale stay whole', () => {
  it('live line: 25,000 fixes with a 45-minute gap and a late-uploaded block draw every fix, breaking only at the gap', () => {
    const plan = createFixturePlan('field-trail-25k')
    const fixes = planFixes(plan, 0)
    const accumulator = createBreadcrumbAccumulator()
    // Poll-sized batches, in arrival order: prompt fixes first, the late block two hours on.
    const arrival = [...fixes].sort((a, b) => Date.parse(a.received) - Date.parse(b.received))
    for (let offset = 0; offset < arrival.length; offset += 100) {
      accumulator.ingest(arrival.slice(offset, offset + 100).map((fix) => fix.position))
      accumulator.compact()
    }
    const trail = accumulator.compact()
    const lines = createBreadcrumbFeatureCollection(snapshotOf(trail.positions, trail.metadata), LINE_BREAK_MS)
    const drawn = drawnFromLines(lines.features)

    expect(trailGapFindings(drawn, fixes.map((fix) => fix.stored), { layer: 'live trail' })).toEqual([])
    // The only gap over 30 minutes is the real one after fix 9,000.
    expect(lines.features).toHaveLength(2)
  })

  // LIV-4: before the fix the live-line simplifier thinned a long standstill
  // so the retained fixes either side were more than 30 minutes apart, and the
  // line broke although the searcher reported throughout.
  it('live line: a 45-minute standstill inside a 42,700-fix trail does not split the line [LIV-4]', () => {
    const start = Date.parse('2026-01-10T06:00:00.000Z')
    const positions: NormalizedTrackingPosition[] = []
    let time = start
    const add = (lat: number, lon: number) => {
      positions.push(livePosition('7001', String(positions.length + 1), lat, lon, time))
      time += 1_000
    }
    for (let i = 0; i < 20_000; i += 1) add(53 + Math.sin(i / 300) * 0.002, -6.4 + i * 0.000015)
    const standLon = -6.4 + 20_000 * 0.000015
    for (let i = 0; i < 2_700; i += 1) add(53.000001, standLon + 0.0000001)
    for (let i = 0; i < 20_000; i += 1) add(53 + i * 0.000015, standLon + Math.sin(i / 300) * 0.002)

    const accumulator = createBreadcrumbAccumulator()
    for (let offset = 0; offset < positions.length; offset += 500) {
      accumulator.ingest(positions.slice(offset, offset + 500))
      accumulator.compact()
    }
    const trail = accumulator.compact()
    const lines = createBreadcrumbFeatureCollection(snapshotOf(trail.positions, trail.metadata), LINE_BREAK_MS)
    expect(lines.features).toHaveLength(1)
  })

  it('whole-history tiles: one device with 25,000 stored fixes draws every fix', async () => {
    const directory = await scratchDirectory()
    const fixture = await generateMissionStoreFixture({ preset: 'field-trail-25k', outputPath: path.join(directory, 'store.sqlite') })
    const drawn = await drawCoverage(fixture.outputPath, directory)
    expect(drawn.failures).toEqual([])
    expect(trailGapFindings(drawn.lines, drawn.stored, { layer: 'whole-history line', toleranceMetres: 60 })).toEqual([])
  }, 120_000)

  it('whole-history tiles: 34 devices (one with 14,400 fixes) draw every fix of every device', async () => {
    const directory = await scratchDirectory()
    const fixture = await generateMissionStoreFixture({ preset: 'field-34-devices', outputPath: path.join(directory, 'store.sqlite') })
    const drawn = await drawCoverage(fixture.outputPath, directory)
    expect(drawn.failures).toEqual([])
    expect(new Set(drawn.stored.map((fix) => fix.deviceId)).size).toBe(34)
    expect(trailGapFindings(drawn.lines, drawn.stored, { layer: 'whole-history line', toleranceMetres: 60 })).toEqual([])
  }, 180_000)

  // COV-1: before the fix the tile worker's 128 MB heap ran out building one
  // device with 180,000 fixes, so the whole-history line never completed.
  it('whole-history tiles: one device with 180,000 stored fixes builds without running out of memory [COV-1]', async () => {
    const directory = await scratchDirectory()
    const databasePath = path.join(directory, 'store.sqlite')
    writeMinimalCoverageStore(databasePath, 180_000)
    const failures: string[] = []
    const runner = createCoverageTileRunner({
      databasePath,
      cacheDirectory: path.join(directory, 'cache'),
      timeoutMs: 60_000,
      onFailure: (error) => failures.push(error.message),
    })
    try {
      const result = await runner.syncCatalog({
        missionId: 'm1',
        chunks: [{ key: { device_id: '7001', period_kind: 'unassigned', period_id: '' }, contentRev: 1 }],
      })
      expect(result.periods).toHaveLength(1)
      expect(failures).toEqual([])
    } finally {
      await runner.close()
    }
  }, 120_000)
})

/** Every fix of one field-shape device, as stored and as polled. */
function planFixes(plan: ReturnType<typeof createFixturePlan>, deviceIndex: number) {
  const device = plan.fieldDevices[deviceIndex]
  return Array.from({ length: device.fixCount }, (_, index) => {
    const fix = fieldShapeFix(plan, deviceIndex, index)
    const time = Date.parse(fix.timestamp)
    return {
      received: fix.receivedAt as string,
      stored: { deviceId: fix.deviceId, lat: fix.lat, lon: fix.lon, time } satisfies StoredFix,
      position: livePosition(fix.deviceId, fix.sourcePositionId, fix.lat, fix.lon, time),
    }
  })
}

function livePosition(deviceId: string, id: string, lat: number, lon: number, time: number): NormalizedTrackingPosition {
  return {
    id,
    device_id: deviceId,
    lat,
    lon,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp: new Date(time).toISOString(),
    source: 'traccar',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}

function snapshotOf(
  breadcrumbs: TrackingSnapshot['breadcrumbs'],
  breadcrumbMetadata: TrackingSnapshot['breadcrumbMetadata'],
): TrackingSnapshot {
  return { devices: [], positions: [], breadcrumbs, breadcrumbMetadata }
}

function drawnFromLines(features: readonly { readonly geometry: { readonly coordinates: number[][] }, readonly properties: unknown }[]): Drawn {
  const drawn: Drawn = {}
  for (const feature of features) {
    const deviceId = String((feature.properties as { deviceId?: string }).deviceId)
    const entry = (drawn[deviceId] ??= { lines: [], points: [] })
    entry.lines.push(feature.geometry.coordinates)
  }
  return drawn
}

async function scratchDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sartracker-don-338-scale-'))
  directories.push(directory)
  return directory
}

/**
 * Builds the whole-history tiles for every device in a stored mission with the
 * production tile runner and worker, then reads back every z10 tile over the
 * route as the map would.
 */
async function drawCoverage(databasePath: string, directory: string) {
  const db = new Database(databasePath, { readonly: true })
  const missionId = (db.prepare('SELECT id FROM missions LIMIT 1').get() as { id: string }).id
  const chunks = (db.prepare('SELECT device_id, period_kind, period_id, content_rev FROM coverage_chunks WHERE mission_id = ?')
    .all(missionId) as { device_id: string, period_kind: string, period_id: string, content_rev: number }[])
    .map((row) => ({ key: { device_id: row.device_id, period_kind: row.period_kind, period_id: row.period_id }, contentRev: row.content_rev }))
  const stored = (db.prepare('SELECT device_id, lat, lon, timestamp FROM positions WHERE mission_id = ?').raw()
    .all(missionId) as [string, number, number, string][])
    .map(([deviceId, lat, lon, timestamp]) => ({ deviceId: String(deviceId), lat, lon, time: Date.parse(timestamp) }))
  db.close()

  const failures: string[] = []
  const runner = createCoverageTileRunner({
    databasePath,
    cacheDirectory: path.join(directory, 'cache'),
    timeoutMs: 60_000,
    onFailure: (error) => failures.push(error.message),
  })
  const lines: Drawn = {}
  try {
    const result = await runner.syncCatalog({ missionId, chunks })
    await runner.commitCatalog({ stageId: result.stageId })
    const zoom = 10
    const bounds = stored.reduce((box, fix) => ({
      west: Math.min(box.west, fix.lon), east: Math.max(box.east, fix.lon),
      south: Math.min(box.south, fix.lat), north: Math.max(box.north, fix.lat),
    }), { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity })
    const [minX, maxX] = [lonToTile(bounds.west, zoom), lonToTile(bounds.east, zoom)]
    const [minY, maxY] = [latToTile(bounds.north, zoom), latToTile(bounds.south, zoom)]
    for (const period of result.periods) {
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          const bytes = await runner.readTile({ missionId, periodKey: period.periodKey, revisionDigest: period.revisionDigest, z: zoom, x, y })
          if (bytes === null || bytes.length === 0) continue
          const layer = new VectorTile(new Pbf(bytes)).layers.coverage
          for (let index = 0; index < (layer?.length ?? 0); index += 1) {
            const feature = layer!.feature(index)
            const deviceId = String(feature.properties.device_id)
            const geometry = feature.toGeoJSON(x, y, zoom).geometry
            const entry = (lines[deviceId] ??= { lines: [], points: [] })
            if (geometry.type === 'LineString') entry.lines.push(geometry.coordinates as number[][])
            else if (geometry.type === 'MultiLineString') entry.lines.push(...(geometry.coordinates as number[][][]))
            else if (geometry.type === 'Point') entry.points.push(geometry.coordinates as number[])
            else if (geometry.type === 'MultiPoint') entry.points.push(...(geometry.coordinates as number[][]))
          }
        }
      }
    }
  } finally {
    await runner.close()
  }
  return { stored, lines, failures }
}

/** The tables the tile worker reads, holding one device's synthetic trail. */
function writeMinimalCoverageStore(databasePath: string, fixCount: number): void {
  const db = new Database(databasePath)
  db.exec(`CREATE TABLE positions (id TEXT PRIMARY KEY, mission_id TEXT, device_id TEXT, source_position_id TEXT,
      timestamp TEXT, lat REAL, lon REAL, data_origin TEXT, timestamp_source TEXT);
    CREATE INDEX idx_positions_mission_device_timestamp ON positions(mission_id, device_id, timestamp);
    CREATE TABLE outings (id TEXT PRIMARY KEY, mission_id TEXT, label TEXT, started_at TEXT, ended_at TEXT);
    CREATE TABLE coverage_chunks (mission_id TEXT, device_id TEXT, period_kind TEXT, period_id TEXT, content_rev INTEGER,
      PRIMARY KEY (mission_id, device_id, period_kind, period_id));`)
  const insert = db.prepare('INSERT INTO positions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const start = Date.parse('2026-01-10T06:00:00.000Z')
  db.transaction(() => {
    for (let index = 0; index < fixCount; index += 1) {
      insert.run(`p-${index}`, 'm1', '7001', String(index), new Date(start + (index + 1) * 3_000).toISOString(),
        53 + index * 0.000002, -6.4 + 0.002 * Math.sin(index / 400), 'live', 'fix')
    }
    db.prepare("INSERT INTO coverage_chunks VALUES ('m1', '7001', 'unassigned', '', 1)").run()
  })()
  db.close()
}

function lonToTile(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom)
}

function latToTile(lat: number, zoom: number): number {
  const radians = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** zoom)
}
