import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

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
  }) => Promise<{
    readonly positions: readonly {
      readonly source_position_id: string | null
    }[]
    readonly deviceTotals: readonly {
      readonly device_id: string
      readonly total: number
    }[]
    readonly droppedPositionCount: number
    readonly workerThreadId: number
  }>
}
const { listBreadcrumbPositions } = require('../../electron/breadcrumb-query.cjs') as {
  readonly listBreadcrumbPositions: (
    database: unknown,
    missionId: string,
    perDeviceLimit: number,
  ) => {
    readonly positions: readonly { readonly source_position_id: string | null }[]
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
})
