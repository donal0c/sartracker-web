import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (file: string) => {
  exec: (sql: string) => void
  prepare: (sql: string) => { run: (...values: unknown[]) => void }
  transaction: (body: () => void) => () => void
  close: () => void
}

/** One synthetic accepted fix, in store column terms. */
export type FixtureFix = {
  readonly id: string
  readonly sourcePositionId: string | null
  readonly deviceId: string
  readonly timestamp: string
  readonly lat: number
  readonly lon: number
}

export type FixtureOuting = {
  readonly id: string
  readonly startedAt: string
  readonly endedAt: string | null
}

export type ChunkKey = {
  readonly device_id: string
  readonly period_kind: 'outing' | 'unassigned'
  readonly period_id: string
}

export type TileAddress = { readonly z: number; readonly x: number; readonly y: number }

/** A temporary mission database with the columns the coverage tile worker reads. */
export type FixtureDatabase = {
  readonly directory: string
  readonly databasePath: string
  readonly cacheDirectory: string
  /** Inserts fixes in one transaction. */
  readonly insertFixes: (fixes: Iterable<FixtureFix>) => void
  /** Sets (or creates) a chunk's ledger revision. */
  readonly setChunkRevision: (key: ChunkKey, contentRev: number) => void
  readonly remove: () => Promise<void>
}

/** Creates an empty mission database in a fresh temporary directory. */
export async function createFixtureDatabase(
  outings: readonly FixtureOuting[] = [],
): Promise<FixtureDatabase> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-worker-'))
  const databasePath = path.join(directory, 'mission-store.sqlite')
  const database = new Database(databasePath)
  database.exec(`
    CREATE TABLE outings (id TEXT PRIMARY KEY, mission_id TEXT, started_at TEXT, ended_at TEXT);
    CREATE TABLE positions (
      id TEXT PRIMARY KEY, mission_id TEXT, device_id TEXT, source_position_id TEXT,
      timestamp TEXT, lat REAL, lon REAL,
      timestamp_source TEXT NOT NULL DEFAULT 'fix', data_origin TEXT NOT NULL DEFAULT 'live'
    );
    CREATE INDEX idx_positions_mission_device_timestamp
      ON positions(mission_id, device_id, timestamp);
    CREATE TABLE coverage_chunks (
      mission_id TEXT, device_id TEXT, period_kind TEXT, period_id TEXT,
      content_rev INTEGER, built_rev INTEGER,
      PRIMARY KEY (mission_id, device_id, period_kind, period_id)
    );
  `)
  const insertOuting = database.prepare('INSERT INTO outings VALUES (?, ?, ?, ?)')
  for (const outing of outings) {
    insertOuting.run(outing.id, MISSION_ID, outing.startedAt, outing.endedAt)
  }
  database.close()
  return {
    directory,
    databasePath,
    cacheDirectory: path.join(directory, 'coverage-tiles'),
    insertFixes: (fixes) => {
      const writer = new Database(databasePath)
      const insert = writer.prepare(`INSERT INTO positions
        (id, mission_id, device_id, source_position_id, timestamp, lat, lon)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
      writer.transaction(() => {
        for (const fix of fixes) {
          insert.run(fix.id, MISSION_ID, fix.deviceId, fix.sourcePositionId,
            fix.timestamp, fix.lat, fix.lon)
        }
      })()
      writer.close()
    },
    setChunkRevision: (key, contentRev) => {
      const writer = new Database(databasePath)
      writer.prepare(`INSERT INTO coverage_chunks VALUES (?, ?, ?, ?, ?, NULL)
        ON CONFLICT (mission_id, device_id, period_kind, period_id)
        DO UPDATE SET content_rev = excluded.content_rev`)
        .run(MISSION_ID, key.device_id, key.period_kind, key.period_id, contentRev)
      writer.close()
    },
    remove: () => rm(directory, { recursive: true, force: true }),
  }
}

export const MISSION_ID = 'mission-1'

/**
 * Deterministic walk that stays inside a box of about `boxDegrees` around a
 * centre, so a dense day of fixes covers few tiles (the worst case per tile).
 */
export function* generateWanderingFixes(input: {
  readonly deviceId: string
  readonly count: number
  readonly cadenceMs: number
  readonly startMs: number
  readonly centreLat: number
  readonly centreLon: number
  readonly boxDegrees: number
  readonly seed: number
  readonly idPrefix?: string
}): Generator<FixtureFix> {
  let seed = input.seed
  const random = () => (seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647
  let lat = input.centreLat
  let lon = input.centreLon
  const half = input.boxDegrees / 2
  for (let index = 0; index < input.count; index += 1) {
    lat += (random() - 0.5) * 0.00008
    lon += (random() - 0.5) * 0.00012
    if (Math.abs(lat - input.centreLat) > half) lat = input.centreLat + Math.sign(lat - input.centreLat) * half
    if (Math.abs(lon - input.centreLon) > half) lon = input.centreLon + Math.sign(lon - input.centreLon) * half
    const prefix = input.idPrefix ?? input.deviceId
    yield {
      id: `${prefix}-${String(index).padStart(7, '0')}`,
      sourcePositionId: `source-${prefix}-${index}`,
      deviceId: input.deviceId,
      timestamp: new Date(input.startMs + index * input.cadenceMs).toISOString(),
      lat,
      lon,
    }
  }
}

/** The worker's accepted-fix digest over ordered fixes (coverage-query identity). */
export function digestFixes(fixes: readonly FixtureFix[]): string {
  const digest = createHash('sha256')
  fixes.forEach((fix, index) => {
    if (index > 0) digest.update('\n')
    digest.update(fix.sourcePositionId === null ? `stored:${fix.id}` : `source:${fix.sourcePositionId}`)
  })
  return digest.digest('hex')
}

/** Slippy-map tile containing a coordinate. */
export function lonLatToTile(lon: number, lat: number, z: number): TileAddress {
  const scale = 2 ** z
  const radians = lat * Math.PI / 180
  return {
    z,
    x: Math.floor(((lon + 180) / 360) * scale),
    y: Math.floor(((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale),
  }
}

/** Every tile at zoom z inside the bounding box of the given fixes. */
export function tilesCovering(
  bounds: { readonly minLat: number; readonly maxLat: number; readonly minLon: number; readonly maxLon: number },
  z: number,
): TileAddress[] {
  const topLeft = lonLatToTile(bounds.minLon, bounds.maxLat, z)
  const bottomRight = lonLatToTile(bounds.maxLon, bounds.minLat, z)
  const tiles: TileAddress[] = []
  for (let x = topLeft.x; x <= bottomRight.x; x += 1) {
    for (let y = topLeft.y; y <= bottomRight.y; y += 1) tiles.push({ z, x, y })
  }
  return tiles
}

export type CatalogResult = {
  readonly stageId: string
  readonly periods: readonly { readonly periodKey: string; readonly revisionDigest: string }[]
  readonly builds: readonly {
    readonly key: ChunkKey
    readonly contentRev: number
    readonly fixCount: number
    readonly fixDigest: string
    readonly minTs: string | null
    readonly maxTs: string | null
  }[]
}

export type FaultInjection = { exhaustHeapOnSync?: boolean }

export type CoverageTileRunner = {
  readonly syncCatalog: (input: {
    readonly missionId: string
    readonly chunks: readonly { readonly key: ChunkKey; readonly contentRev: number }[]
  }) => Promise<CatalogResult>
  readonly commitCatalog: (input: { readonly stageId: string }) => Promise<boolean>
  readonly finalizeCatalog: (input: { readonly stageId: string }) => Promise<boolean>
  readonly readTile: (input: {
    readonly missionId: string
    readonly periodKey: string
    readonly revisionDigest: string
    readonly z: number
    readonly x: number
    readonly y: number
  }) => Promise<Uint8Array | null>
  readonly close: () => Promise<void>
}

/** Starts the production runner, which spawns the real worker under the mission heap limit. */
export function createRealCoverageTileRunner(input: {
  readonly databasePath: string
  readonly cacheDirectory: string
  readonly onFailure?: (error: Error & { code?: string }) => void
  readonly faultInjection?: FaultInjection
  readonly tuning?: { readonly sourceCachePoints?: number }
  readonly timeoutMs?: number
}): CoverageTileRunner {
  const { createCoverageTileRunner } = require('../../electron/coverage-tile-runner.cjs') as {
    readonly createCoverageTileRunner: (options: typeof input) => CoverageTileRunner
  }
  return createCoverageTileRunner(input)
}

/** Syncs, commits and finalizes one catalog, returning its result. */
export async function publishCatalog(
  runner: CoverageTileRunner,
  chunks: readonly { readonly key: ChunkKey; readonly contentRev: number }[],
): Promise<CatalogResult> {
  const result = await runner.syncCatalog({ missionId: MISSION_ID, chunks })
  await runner.commitCatalog({ stageId: result.stageId })
  await runner.finalizeCatalog({ stageId: result.stageId })
  return result
}
