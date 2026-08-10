import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

import { createBreadcrumbAccumulator } from '../../src/features/tracking/breadcrumb-accumulator'
import { normalizeTraccarPosition } from '../../src/features/tracking/traccar-normalization'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { runBreadcrumbQueryInWorker } = require(
  '../../electron/breadcrumb-query-runner.cjs',
) as {
  readonly runBreadcrumbQueryInWorker: (input: {
    readonly databasePath: string
    readonly missionId: string
    readonly perDeviceLimit: number
    readonly workerPath?: string
    readonly timeoutMs?: number
    readonly signal?: AbortSignal
  }) => Promise<{
    readonly positions: readonly {
      readonly source_position_id: string | null
    }[]
    readonly deviceTotals: readonly {
      readonly device_id: string
      readonly total: number
    }[]
    readonly deviceSelections: readonly {
      readonly device_id: string
      readonly geometryErrorBoundMetres: number | null
      readonly targetGeometryErrorSatisfied: boolean
      readonly timeBucketWidthMs: number | null
      readonly spatialBucketWidthDegrees: number | null
    }[]
    readonly droppedPositionCount: number
    readonly workerThreadId: number
  }>
}
const {
  listBreadcrumbPositions,
  retainCompactPositionRowsAcrossWindow,
} = require('../../electron/breadcrumb-query.cjs') as {
  readonly listBreadcrumbPositions: (
    database: unknown,
    missionId: string,
    perDeviceLimit: number,
  ) => {
    readonly positions: readonly { readonly source_position_id: string | null }[]
    readonly deviceSelections: readonly {
      readonly device_id: string
      readonly geometryErrorBoundMetres: number | null
      readonly targetGeometryErrorSatisfied: boolean
      readonly timeBucketWidthMs: number | null
      readonly spatialBucketWidthDegrees: number | null
    }[]
  }
  readonly retainCompactPositionRowsAcrossWindow: (
    rows: readonly (readonly [number, string | null, string, number, number])[],
    deviceId: string,
    maxPositions: number,
    diagnostics?: { maximumCandidateIdentityCount: number },
  ) => {
    readonly rowIds: readonly number[]
  }
}

describe('breadcrumb restart-query worker boundary [DON-260]', () => {
  let tempDirectory: string | undefined

  afterEach(async () => {
    if (tempDirectory !== undefined) {
      await rm(tempDirectory, { recursive: true, force: true })
    }
  })

  it('selects a deterministic bounded whole-route trail outside the main thread', async () => {
    tempDirectory = await mkdtemp(
      path.join(tmpdir(), 'sartracker-breadcrumb-worker-'),
    )
    const databasePath = path.join(tempDirectory, 'mission-store.sqlite')
    const database = new Database(databasePath)
    database.exec(`
      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source_position_id TEXT,
        name TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        altitude REAL,
        speed REAL,
        battery REAL,
        accuracy REAL,
        source TEXT,
        timestamp TEXT NOT NULL,
        data_origin TEXT NOT NULL
      );
    `)
    const insert = database.prepare(`
      INSERT INTO positions (
        id, mission_id, device_id, source_position_id, lat, lon, timestamp,
        data_origin
      ) VALUES (?, 'mission-1', 'device-1', ?, 52, -9, ?, 'live')
    `)
    const insertAll = database.transaction(() => {
      for (let index = 0; index < 12_000; index += 1) {
        insert.run(
          `local-${index}`,
          String(index + 1),
          new Date(Date.UTC(2026, 6, 28, 0, 0, index)).toISOString(),
        )
      }
    })
    insertAll()
    database.close()

    const result = await runBreadcrumbQueryInWorker({
      databasePath,
      missionId: 'mission-1',
      perDeviceLimit: 5_000,
    })

    expect(result.workerThreadId).toBeGreaterThan(0)
    expect(result.positions.length).toBeLessThanOrEqual(5_000)
    expect(result.positions.at(-1)?.source_position_id).toBe('12000')
    expect(result.deviceTotals).toEqual([
      { device_id: 'device-1', total: 12_000 },
    ])
    expect(result.deviceSelections).toEqual([
      expect.objectContaining({
        device_id: 'device-1',
        targetGeometryErrorSatisfied: true,
      }),
    ])
  })

  it('caps losing selector identity state before materializing only the winning row ids', () => {
    const diagnostics = { maximumCandidateIdentityCount: 0 }
    const baseMs = Date.UTC(2026, 7, 9)
    const rows = Array.from({ length: 50_000 }, (_, index) => [
      index + 1,
      `source-${index}`,
      new Date(baseMs + index * 1_000).toISOString(),
      52 + (index % 2),
      -9 + (index % 2),
    ] as const)

    const selection = retainCompactPositionRowsAcrossWindow(
      rows,
      'device-1',
      5_000,
      diagnostics,
    )

    expect(diagnostics.maximumCandidateIdentityCount).toBeLessThanOrEqual(5_001)
    expect(selection.rowIds.length).toBeLessThanOrEqual(5_000)
  })

  it('fetches selected rows by rowid without rescanning the full mission index', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source_position_id TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        timestamp TEXT NOT NULL,
        data_origin TEXT NOT NULL
      );
      CREATE INDEX idx_positions_mission_device_timestamp
        ON positions(mission_id, device_id, timestamp);
    `)
    const insert = database.prepare(`
      INSERT INTO positions (
        id, mission_id, device_id, source_position_id, lat, lon, timestamp,
        data_origin
      ) VALUES (?, 'mission-1', 'device-1', ?, 52, -9, ?, 'live')
    `)
    database.transaction(() => {
      for (let index = 0; index < 12; index += 1) {
        insert.run(
          `local-${index}`,
          `source-${index}`,
          new Date(Date.UTC(2026, 7, 9, 0, 0, index)).toISOString(),
        )
      }
    })()

    const selectedFetchPlanDetails: string[] = []
    const instrumentedDatabase = {
      prepare: (query: string) => {
        const statement = database.prepare(query)
        if (!query.includes('rowid IN')) {
          return statement
        }
        return {
          all: (...parameters: readonly unknown[]) => {
            selectedFetchPlanDetails.push(
              ...database.prepare(`EXPLAIN QUERY PLAN ${query}`)
                .all(...parameters)
                .map((entry: { readonly detail: string }) => entry.detail),
            )
            return statement.all(...parameters)
          },
        }
      },
    }

    const result = listBreadcrumbPositions(
      instrumentedDatabase,
      'mission-1',
      5,
    )

    expect(result.positions.length).toBeLessThanOrEqual(5)
    expect(selectedFetchPlanDetails.length).toBeGreaterThan(0)
    expect(selectedFetchPlanDetails).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/INTEGER PRIMARY KEY \(rowid=\?\)/u),
      ]),
    )
    expect(selectedFetchPlanDetails.join('\n')).not.toContain(
      'idx_positions_mission_device_timestamp',
    )
    database.close()
  })

  it('preserves duplicate legacy, invalid-row, endpoint, and tie-selection semantics', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source_position_id TEXT,
        name TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        altitude REAL,
        speed REAL,
        battery REAL,
        accuracy REAL,
        source TEXT,
        timestamp TEXT NOT NULL,
        data_origin TEXT NOT NULL
      );
    `)
    const insert = database.prepare(`
      INSERT INTO positions (
        id, mission_id, device_id, source_position_id, lat, lon, timestamp,
        data_origin
      ) VALUES (?, 'mission-1', 'device-1', ?, ?, ?, ?, 'live')
    `)
    const rows = [
      ['invalid-first', 'bad-first', 95, -9, '2026-01-01T00:00:00.000Z'],
      ['legacy-a', null, 52, -9, '2026-01-01T00:00:01.000Z'],
      ['legacy-a-duplicate', null, 52, -9, '2026-01-01T00:00:01.000Z'],
      ['source-10', '10', 52, -9, '2026-01-01T00:00:01.000Z'],
      ['source-2', '2', 53, -8, '2026-01-01T00:00:01.000Z'],
      ...Array.from({ length: 12 }, (_, index) => [
        `local-p${index}`,
        `p${index}`,
        index % 2 === 0 ? 53 : 52,
        index % 2 === 0 ? -8 : -9,
        new Date(Date.parse('2026-01-01T00:00:02.000Z') + index * 1_000).toISOString(),
      ]),
      ['invalid-last', 'bad-last', 52, -999, '2026-01-01T00:01:00.000Z'],
    ] as const
    database.transaction(() => {
      for (const row of rows) {
        insert.run(...row)
      }
    })()

    const result = listBreadcrumbPositions(database, 'mission-1', 5)

    expect(result.positions.map(
      (position: { readonly id: string; readonly source_position_id: string | null }) =>
        position.source_position_id ?? position.id,
    )).toEqual(['legacy-a', 'p4', 'p5', 'p11'])
    expect(result.deviceSelections).toEqual([{
      device_id: 'device-1',
      geometryErrorBoundMetres: 1_638_399.9999999998,
      timeBucketWidthMs: 16_384,
      spatialBucketWidthDegrees: 10.407148313834345,
      targetGeometryErrorSatisfied: false,
    }])
    expect(result.droppedPositionCount).toBe(2)
    database.close()
  })

  it('selects the same route identities in the renderer and persisted restart query', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source_position_id TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        timestamp TEXT NOT NULL,
        data_origin TEXT NOT NULL
      );
    `)
    const insert = database.prepare(`
      INSERT INTO positions (
        id, mission_id, device_id, source_position_id, lat, lon, timestamp,
        data_origin
      ) VALUES (?, 'mission-1', 'device-7', ?, ?, ?, ?, 'live')
    `)
    const baseMs = Date.UTC(2026, 6, 28, 0, 0, 0)
    const fixIntervalMs = 5_000
    const gapDurationMs = 10 * 60 * 1_000
    const fixesIn36Hours = (36 * 60 * 60 * 1_000) / fixIntervalMs
    const totalFixes = fixesIn36Hours - gapDurationMs / fixIntervalMs
    const gapStartsAtIndex = Math.floor(totalFixes / 2)
    const rawPositions = Array.from({ length: totalFixes }, (_, index) => {
      const timestamp = new Date(
        baseMs +
          index * fixIntervalMs +
          (index >= gapStartsAtIndex ? gapDurationMs : 0),
      ).toISOString()
      return {
        id: index + 1,
        deviceId: 7,
        latitude: index === 3_001 ? 52.0018 : 52,
        longitude: index === 3_003 ? -9.6971 : -9.7,
        fixTime: timestamp,
      }
    })
    const insertAll = database.transaction(() => {
      for (const position of rawPositions) {
        insert.run(
          `local-${position.id}`,
          String(position.id),
          position.latitude,
          position.longitude,
          position.fixTime,
        )
      }
    })
    insertAll()

    const rendererIds = createBreadcrumbAccumulator()
      .append(
        rawPositions.map((position) => normalizeTraccarPosition(position, 'live')),
      )
      .positions.map((position) => position.id)
    const restartIds = listBreadcrumbPositions(database, 'mission-1', 5_000).positions.map(
      (position) => position.source_position_id,
    )

    expect(restartIds).toEqual(rendererIds)
    expect(restartIds).toHaveLength(rendererIds.length)
    expect(restartIds.length).toBeLessThanOrEqual(5_000)
    database.close()
  })

  it('keeps a post-canonical append identical to the worker selection', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source_position_id TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        timestamp TEXT NOT NULL,
        data_origin TEXT NOT NULL
      );
    `)
    const insert = database.prepare(`
      INSERT INTO positions (
        id, mission_id, device_id, source_position_id, lat, lon, timestamp,
        data_origin
      ) VALUES (?, 'mission-1', '7', ?, 52, -9.7, ?, 'live')
    `)
    const baseMs = Date.UTC(2026, 6, 28, 0, 0, 0)
    const rawPositions = Array.from({ length: 12_000 }, (_, index) => ({
      id: index + 1,
      deviceId: 7,
      latitude: 52,
      longitude: -9.7,
      fixTime: new Date(baseMs + index * 1_000).toISOString(),
    }))
    database.transaction(() => {
      for (const position of rawPositions) {
        insert.run(
          `local-${position.id}`,
          String(position.id),
          position.fixTime,
        )
      }
    })()

    const initialWorker = listBreadcrumbPositions(database, 'mission-1', 5_000)
    const selectedIds = new Set(
      initialWorker.positions.map((position) => position.source_position_id),
    )
    const normalizedById = new Map(
      rawPositions.map((position) => {
        const normalized = normalizeTraccarPosition(position, 'live')
        return [normalized.id, normalized] as const
      }),
    )
    const selection = initialWorker.deviceSelections[0]!
    const accumulator = createBreadcrumbAccumulator()
    accumulator.reset(
      [...selectedIds].flatMap((id) => {
        const position = id === null ? undefined : normalizedById.get(id)
        return position === undefined ? [] : [position]
      }),
      { '7': rawPositions.length },
      {
        '7': {
          geometryErrorBoundMetres: selection.geometryErrorBoundMetres,
          targetGeometryErrorSatisfied: selection.targetGeometryErrorSatisfied,
          timeBucketWidthMs: selection.timeBucketWidthMs,
          spatialBucketWidthDegrees: selection.spatialBucketWidthDegrees,
        },
      },
    )

    const appendedRaw = {
      id: 12_001,
      deviceId: 7,
      latitude: 52,
      longitude: -9.7,
      fixTime: new Date(baseMs + 11_999 * 1_000 + 1).toISOString(),
    }
    const appended = normalizeTraccarPosition(appendedRaw, 'live')
    const rendererIds = accumulator.append([appended]).positions
    accumulator.compact()
    insert.run('local-12001', '12001', appendedRaw.fixTime)
    const workerIds = listBreadcrumbPositions(database, 'mission-1', 5_000).positions.map(
      (position) => position.source_position_id,
    )

    expect(accumulator.snapshot().positions.map((position) => position.id)).toEqual(
      workerIds,
    )
    expect(rendererIds).toContainEqual(expect.objectContaining({ id: '12001' }))
    expect(workerIds).not.toContain('12000')
    database.close()
  })

  it('does not delegate persisted tie ordering to the host locale [DON-260]', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source_position_id TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        timestamp TEXT NOT NULL,
        data_origin TEXT NOT NULL
      );
      INSERT INTO positions (
        id, mission_id, device_id, source_position_id, lat, lon, timestamp,
        data_origin
      ) VALUES
        ('local-2', 'mission-1', 'device-1', '2', 52, -9, '2026-07-28T10:00:00Z', 'live'),
        ('local-10', 'mission-1', 'device-1', '10', 52, -9, '2026-07-28T10:00:00Z', 'live'),
        ('local-3', 'mission-1', 'device-1', '3', 52, -9, '2026-07-28T10:00:00Z', 'live');
    `)
    const localeCompare = String.prototype.localeCompare
    String.prototype.localeCompare = () => {
      throw new Error('host locale comparator must not be used')
    }

    try {
      expect(
        listBreadcrumbPositions(database, 'mission-1', 2).positions.map(
          (position) => position.source_position_id,
        ),
      ).toEqual(['10', '3'])
    } finally {
      String.prototype.localeCompare = localeCompare
      database.close()
    }
  })

  it('preserves chronological row order when SQLite reverses unordered fetches', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source_position_id TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        timestamp TEXT NOT NULL,
        data_origin TEXT NOT NULL
      );
      INSERT INTO positions (
        id, mission_id, device_id, source_position_id, lat, lon, timestamp,
        data_origin
      ) VALUES
        ('older', 'mission-1', 'device-1', 'same-source', 52, -9,
          '2026-07-28T10:00:00Z', 'live'),
        ('corrected', 'mission-1', 'device-1', 'same-source', 53, -9,
          '2026-07-28T10:00:00Z', 'live');
    `)
    database.pragma('reverse_unordered_selects = ON')

    const result = listBreadcrumbPositions(database, 'mission-1', 5_000)

    expect(result.positions.map(
      (position: { readonly lat: number }) => position.lat,
    )).toEqual([52, 53])
    database.close()
  })

  it('returns the deterministic latest fix when the persisted limit is one [DON-260]', async () => {
    tempDirectory = await mkdtemp(
      path.join(tmpdir(), 'sartracker-breadcrumb-worker-single-'),
    )
    const databasePath = path.join(tempDirectory, 'mission-store.sqlite')
    const database = new Database(databasePath)
    database.exec(`
      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source_position_id TEXT,
        name TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        altitude REAL,
        speed REAL,
        battery REAL,
        accuracy REAL,
        source TEXT,
        timestamp TEXT NOT NULL,
        data_origin TEXT NOT NULL
      );
      INSERT INTO positions (
        id, mission_id, device_id, source_position_id, lat, lon, timestamp,
        data_origin
      ) VALUES
        ('local-2', 'mission-1', 'device-1', '2', 52, -9, '2026-07-28T10:00:00Z', 'live'),
        ('local-10', 'mission-1', 'device-1', '10', 52, -9, '2026-07-28T10:00:00Z', 'live'),
        ('local-3', 'mission-1', 'device-1', '3', 52, -9, '2026-07-28T10:00:00Z', 'live');
    `)
    database.close()

    const result = await runBreadcrumbQueryInWorker({
      databasePath,
      missionId: 'mission-1',
      perDeviceLimit: 1,
      timeoutMs: 100,
    })

    expect(result.positions.map((position) => position.source_position_id)).toEqual([
      '3',
    ])
  })

  it('drops and counts malformed legacy rows without suppressing valid restart history [DON-260]', async () => {
    tempDirectory = await mkdtemp(
      path.join(tmpdir(), 'sartracker-breadcrumb-worker-invalid-time-'),
    )
    const databasePath = path.join(tempDirectory, 'mission-store.sqlite')
    const database = new Database(databasePath)
    database.exec(`
      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source_position_id TEXT,
        name TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        altitude REAL,
        speed REAL,
        battery REAL,
        accuracy REAL,
        source TEXT,
        timestamp TEXT NOT NULL,
        data_origin TEXT NOT NULL
      );
      INSERT INTO positions (
        id, mission_id, device_id, source_position_id, lat, lon, timestamp,
        data_origin
      ) VALUES
        (
          'local-valid', 'mission-1', 'device-1', '1', 52, -9,
          '2026-02-28T10:00:00Z', 'live'
        ),
        (
          'local-invalid-time', 'mission-1', 'device-1', '2', 52, -9,
          '2026-02-30T10:00:00Z', 'live'
        ),
        (
          'local-invalid-coordinate', 'mission-1', 'device-1', '3', 95, -9,
          '2026-02-28T10:02:00Z', 'live'
        );
    `)
    database.close()

    await expect(
      runBreadcrumbQueryInWorker({
        databasePath,
        missionId: 'mission-1',
        perDeviceLimit: 5_000,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        positions: [
          expect.objectContaining({
            source_position_id: '1',
          }),
        ],
        deviceTotals: [{ device_id: 'device-1', total: 3 }],
        droppedPositionCount: 2,
      }),
    )
  })

  it('terminates and reports a breadcrumb worker that stops making progress [DON-260]', async () => {
    tempDirectory = await mkdtemp(
      path.join(tmpdir(), 'sartracker-breadcrumb-worker-timeout-'),
    )
    const workerPath = path.join(tempDirectory, 'hanging-worker.cjs')
    await writeFile(workerPath, 'setInterval(() => {}, 1_000)\n', 'utf8')

    await expect(
      runBreadcrumbQueryInWorker({
        databasePath: path.join(tempDirectory, 'unused.sqlite'),
        missionId: 'mission-1',
        perDeviceLimit: 5_000,
        workerPath,
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/timed out/i)
  })

  it('does not acknowledge canonical results until the worker isolate exits', async () => {
    tempDirectory = await mkdtemp(
      path.join(tmpdir(), 'sartracker-breadcrumb-worker-exit-'),
    )
    const workerPath = path.join(tempDirectory, 'delayed-exit-worker.cjs')
    await writeFile(workerPath, `
      const { parentPort, threadId } = require('node:worker_threads')
      parentPort.postMessage({
        type: 'complete',
        workerThreadId: threadId,
        positions: [],
        deviceTotals: [],
        deviceSelections: [],
        droppedPositionCount: 0,
      })
      setTimeout(() => parentPort.close(), 100)
    `, 'utf8')

    const result = runBreadcrumbQueryInWorker({
      databasePath: path.join(tempDirectory, 'unused.sqlite'),
      missionId: 'mission-1',
      perDeviceLimit: 5_000,
      workerPath,
      timeoutMs: 1_000,
    })

    await expect(Promise.race([
      result.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('worker-running'), 20)),
    ])).resolves.toBe('worker-running')
    await expect(result).resolves.toEqual(
      expect.objectContaining({ positions: [], workerThreadId: expect.any(Number) }),
    )
  })

  it('terminates an unresolved canonical worker when its lifecycle signal aborts', async () => {
    tempDirectory = await mkdtemp(
      path.join(tmpdir(), 'sartracker-breadcrumb-worker-abort-'),
    )
    const workerPath = path.join(tempDirectory, 'unresolved-worker.cjs')
    await writeFile(workerPath, 'setInterval(() => {}, 1_000)\n', 'utf8')
    const controller = new AbortController()
    const result = runBreadcrumbQueryInWorker({
      databasePath: path.join(tempDirectory, 'unused.sqlite'),
      missionId: 'mission-a',
      perDeviceLimit: 5_000,
      workerPath,
      timeoutMs: 10_000,
      signal: controller.signal,
    })

    controller.abort()

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })
})
