import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

type ExactBreadcrumbDot = {
  readonly id: string
  readonly source_position_id: string | null
  readonly device_id: string
  readonly lat: number
  readonly lon: number
  readonly timestamp: string
  readonly data_origin: 'live' | 'cache'
}

type ExactBreadcrumbDotPage = {
  readonly positions: readonly ExactBreadcrumbDot[]
  readonly totalPositionCount: number
  readonly pagePositionCount: number
  readonly fromTimestamp: string | null
  readonly toTimestamp: string | null
  readonly hasEarlier: boolean
  readonly hasLater: boolean
  readonly earlierCursor: string | null
  readonly laterCursor: string | null
}

type ExactBreadcrumbDotQuery = (
  database: unknown,
  input: {
    readonly missionId: string
    readonly activeDeviceIds: readonly string[]
    readonly limit: number
    readonly cursor?: string | null
    readonly direction: 'earlier' | 'later' | 'latest'
    readonly signal?: AbortSignal
  },
) => ExactBreadcrumbDotPage

type ExactBreadcrumbDotQueryModule = {
  readonly listExactBreadcrumbDotPage: ExactBreadcrumbDotQuery
}

type BreadcrumbLineQueryModule = {
  listBreadcrumbPositions: (
    database: unknown,
    missionId: string,
    perDeviceLimit: number,
  ) => { readonly positions: readonly { readonly source_position_id: string | null }[] }
}

type PageQueryObservation = {
  readonly method: 'all' | 'iterate'
  readonly sql: string
  readonly parameters: readonly unknown[]
  readonly planDetails: readonly string[]
  rowsMaterialized: number
}

const exactDotQueryPath = '../../electron/breadcrumb-dot-query.cjs'
const lineQueryPath = '../../electron/breadcrumb-query.cjs'
let tempDirectory: string | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  if (tempDirectory !== undefined) {
    await rm(tempDirectory, { recursive: true, force: true })
    tempDirectory = undefined
  }
})

describe('exact SQLite-backed breadcrumb dots', () => {
  it('excludes stored rows whose authoritative fixTime provenance is unproved [DON-267] [SAR-QA-021]', () => {
    const database = createDatabase(':memory:')
    database.prepare('INSERT INTO missions (id, start_time) VALUES (?, ?)')
      .run('mission-provenance', '2026-08-22T00:00:00.000Z')
    database.prepare('INSERT INTO devices (id, mission_id, device_id) VALUES (?, ?, ?)')
      .run('device-row', 'mission-provenance', 'device-1')
    const insert = database.prepare(`INSERT INTO positions (
      id, mission_id, device_id, source_position_id, lat, lon, timestamp,
      data_origin, timestamp_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    insert.run(
      'canonical', 'mission-provenance', 'device-1', 'source-canonical',
      52, -9, '2026-08-22T15:10:17.000Z', 'live', 'fix',
    )
    insert.run(
      'legacy-unproved', 'mission-provenance', 'device-1', 'source-legacy',
      52.1, -9.1, '2026-08-22T15:11:17.000Z', 'live', null,
    )

    const page = loadExactDotQuery()(database, {
      missionId: 'mission-provenance',
      activeDeviceIds: ['device-1'],
      limit: 10_000,
      direction: 'latest',
    })
    expect(page.totalPositionCount).toBe(1)
    expect(page.positions.map((position) => position.id)).toEqual(['canonical'])
    database.close()
  })

  it('excludes pre-mission current fixes from exact history while retaining in-window fixes', () => {
    const database = createDatabase(':memory:')
    const missionStart = '2026-08-08T19:48:56.767Z'
    ensureMission(database, 'mission-lookback', missionStart)
    for (const deviceId of ['device-stale', 'device-in-window', 'device-target']) {
      ensureDevice(database, 'mission-lookback', deviceId)
    }
    const insert = database.prepare(`
      INSERT INTO positions (
        id, mission_id, device_id, source_position_id,
        lat, lon, timestamp, data_origin
      ) VALUES (?, 'mission-lookback', ?, ?, ?, ?, ?, 'live')
    `)
    insert.run(
      'stale-current-local',
      'device-stale',
      'stale-current-source',
      52.1,
      -9.1,
      '2026-06-14T12:10:59.256Z',
    )
    insert.run(
      'in-window-current-local',
      'device-in-window',
      'in-window-current-source',
      52.2,
      -9.2,
      '2026-08-09T00:55:26.000Z',
    )
    insert.run(
      'history-local',
      'device-target',
      'history-source',
      52.3,
      -9.3,
      '2026-08-08T20:00:33.000Z',
    )

    const page = loadExactDotQuery()(database, {
      missionId: 'mission-lookback',
      activeDeviceIds: [],
      limit: 10_000,
      direction: 'latest',
    })

    expect(page.totalPositionCount).toBe(2)
    expect(page.positions.map((position) => position.source_position_id)).toEqual([
      'history-source',
      'in-window-current-source',
    ])
    expect(page.positions.map((position) => position.source_position_id))
      .not.toContain('stale-current-source')
    database.close()
  })

  it('returns every one of the 8,941 field fixes with exact identity, time, and coordinates', () => {
    const database = createDatabase(':memory:')
    const expected = insertTrack(database, {
      missionId: 'mission-field',
      deviceId: 'device-7',
      count: 8_941,
      sourceIdOffset: 70_000,
    })

    const page = loadExactDotQuery()(database, {
      missionId: 'mission-field',
      activeDeviceIds: ['device-7'],
      limit: 10_000,
      direction: 'latest',
    })

    expect(page).toMatchObject({
      totalPositionCount: 8_941,
      pagePositionCount: 8_941,
      fromTimestamp: expected[0]?.timestamp,
      toTimestamp: expected.at(-1)?.timestamp,
      hasEarlier: false,
      hasLater: false,
      earlierCursor: null,
      laterCursor: null,
    })
    expect(page.positions).toEqual(expected)
    expect(new Set(page.positions.map((position) => position.source_position_id)).size)
      .toBe(8_941)
    database.close()
  })

  it('pages cap plus one as exact, non-overlapping keyset pages whose union is source truth', () => {
    const database = createDatabase(':memory:')
    const expected = insertInterleavedTracks(database, 10_001)
    const query = loadExactDotQuery()

    const latest = query(database, {
      missionId: 'mission-paged',
      activeDeviceIds: ['device-a', 'device-b'],
      limit: 10_000,
      direction: 'latest',
    })

    expect(latest).toMatchObject({
      totalPositionCount: 10_001,
      pagePositionCount: 10_000,
      hasEarlier: true,
      hasLater: false,
    })
    expect(latest.earlierCursor).not.toBeNull()
    const earlier = query(database, {
      missionId: 'mission-paged',
      activeDeviceIds: ['device-a', 'device-b'],
      limit: 10_000,
      cursor: latest.earlierCursor,
      direction: 'earlier',
    })
    expect(earlier).toMatchObject({
      totalPositionCount: 10_001,
      pagePositionCount: 1,
      hasEarlier: false,
      hasLater: true,
    })

    const union = [...earlier.positions, ...latest.positions]
    expect(union).toEqual(expected)
    expect(new Set(union.map((position) => position.id)).size).toBe(10_001)
    const expectedIds = new Set(expected.map((position) => position.id))
    expect(union.every((position) => expectedIds.has(position.id))).toBe(true)

    expect(earlier.laterCursor).not.toBeNull()
    const returnedLatest = query(database, {
      missionId: 'mission-paged',
      activeDeviceIds: ['device-a', 'device-b'],
      limit: 10_000,
      cursor: earlier.laterCursor,
      direction: 'later',
    })
    expect(returnedLatest.positions).toEqual(latest.positions)
    expect(returnedLatest).toMatchObject({
      pagePositionCount: 10_000,
      hasEarlier: true,
      hasLater: false,
    })
    database.close()
  })

  it('uses stable durable identity for same-device fixes with equal timestamps', () => {
    const database = createDatabase(':memory:')
    ensureMission(database, 'mission-ties', '2026-08-10T09:00:00.000Z')
    ensureDevice(database, 'mission-ties', 'device-1')
    const insert = database.prepare(`
      INSERT INTO positions (
        id, mission_id, device_id, source_position_id,
        lat, lon, timestamp, data_origin
      ) VALUES (?, 'mission-ties', 'device-1', ?, ?, ?, ?, 'live')
    `)
    const timestamp = '2026-08-10T10:00:00.000Z'
    for (const [index, sourceId] of ['source-z', 'source-a', 'source-m'].entries()) {
      insert.run(
        `local-${index}`,
        sourceId,
        52 + index / 10_000,
        -9 - index / 10_000,
        timestamp,
      )
    }
    const query = loadExactDotQuery()
    const latest = query(database, {
      missionId: 'mission-ties',
      activeDeviceIds: ['device-1'],
      limit: 2,
      direction: 'latest',
    })
    const earlier = query(database, {
      missionId: 'mission-ties',
      activeDeviceIds: ['device-1'],
      limit: 2,
      cursor: latest.earlierCursor,
      direction: 'earlier',
    })

    expect(latest.positions.map((position) => position.source_position_id)).toEqual([
      'source-m',
      'source-z',
    ])
    expect([...earlier.positions, ...latest.positions].map(
      (position) => position.source_position_id,
    )).toEqual(['source-a', 'source-m', 'source-z'])
    database.close()
  })

  it('k-way merges one indexed lazy iterator per device with bounded row materialization', () => {
    const database = createDatabase(':memory:')
    const deviceIds = ['device-a', 'device-b', 'device-c', 'device-d'] as const
    const expected = deviceIds.flatMap((deviceId, deviceIndex) =>
      insertTrack(database, {
        missionId: 'mission-k-way',
        deviceId,
        count: 13,
        sourceIdOffset: 130_000 + deviceIndex * 1_000,
        intervalMs: 5_000,
        timestampOffsetMs: deviceIndex * 1_250,
      }),
    ).sort(compareExactDots)
    const instrumentation = createPageQueryInstrumentation(database)
    const query = loadExactDotQuery()
    const pageLimit = 7
    const chronologicalPages: ExactBreadcrumbDot[][] = []
    let cursor: string | null = null
    let direction: 'latest' | 'earlier' = 'latest'

    while (true) {
      const observationStart = instrumentation.observations.length
      const materializedBefore = instrumentation.totalRowsMaterialized()
      const page = query(instrumentation.database, {
        missionId: 'mission-k-way',
        activeDeviceIds: deviceIds,
        limit: pageLimit,
        cursor,
        direction,
      })
      const pageObservations = instrumentation.observations.slice(observationStart)

      expect(page.positions.length).toBeLessThanOrEqual(pageLimit)
      expect(instrumentation.totalRowsMaterialized() - materializedBefore)
        .toBeLessThanOrEqual(pageLimit + deviceIds.length)
      expect(pageObservations).toHaveLength(deviceIds.length)
      expect(pageObservations.map((observation) => observation.method))
        .toEqual(deviceIds.map(() => 'iterate'))
      expect(new Set(pageObservations.map(getObservedDeviceId))).toEqual(
        new Set(deviceIds),
      )
      for (const observation of pageObservations) {
        expect(observation.sql).toMatch(/mission_id\s*=\s*\?\s+AND\s+device_id\s*=\s*\?/iu)
        expect(observation.sql).not.toMatch(/device_id\s+IN\s*\(/iu)
        expect(observation.planDetails).toEqual(expect.arrayContaining([
          expect.stringContaining('idx_positions_mission_device_timestamp'),
        ]))
        expect(observation.planDetails.join('\n')).not.toMatch(/SCAN positions/iu)
      }

      chronologicalPages.unshift([...page.positions])
      if (!page.hasEarlier) {
        break
      }
      expect(page.earlierCursor).not.toBeNull()
      cursor = page.earlierCursor
      direction = 'earlier'
    }

    const union = chronologicalPages.flat()
    expect(union).toEqual(expected)
    expect(new Set(union.map((position) => position.id)).size).toBe(expected.length)
    expect(instrumentation.observations.some((observation) => observation.method === 'all'))
      .toBe(false)
    database.close()
  })

  it('rejects malformed and context-mismatched cursors instead of crossing mission or device truth', () => {
    const database = createDatabase(':memory:')
    insertTrack(database, {
      missionId: 'mission-a',
      deviceId: 'device-a',
      count: 10_001,
      sourceIdOffset: 60_000,
    })
    insertTrack(database, {
      missionId: 'mission-b',
      deviceId: 'device-b',
      count: 4,
      sourceIdOffset: 80_000,
    })
    const query = loadExactDotQuery()
    const first = query(database, {
      missionId: 'mission-a',
      activeDeviceIds: ['device-a'],
      limit: 10_000,
      direction: 'latest',
    })
    expect(first.earlierCursor).not.toBeNull()
    const cursorWithMismatchedBoundaryDevice = Buffer.from(
      JSON.stringify({
        ...JSON.parse(
          Buffer.from(first.earlierCursor!, 'base64url').toString('utf8'),
        ) as Record<string, unknown>,
        deviceId: 'device-not-selected',
      }),
      'utf8',
    ).toString('base64url')

    for (const input of [
      {
        missionId: 'mission-a',
        activeDeviceIds: ['device-a'],
        cursor: 'not-a-valid-exact-dot-cursor',
      },
      {
        missionId: 'mission-b',
        activeDeviceIds: ['device-b'],
        cursor: first.earlierCursor,
      },
      {
        missionId: 'mission-a',
        activeDeviceIds: ['device-b'],
        cursor: first.earlierCursor,
      },
      {
        missionId: 'mission-a',
        activeDeviceIds: ['device-a'],
        cursor: cursorWithMismatchedBoundaryDevice,
      },
    ] as const) {
      expect(() => query(database, {
        ...input,
        limit: 10_000,
        direction: 'earlier',
      })).toThrow(/cursor|mission|device|context/iu)
    }
    database.close()
  })

  it('filters exact pages to the active-device set without per-device starvation', () => {
    const database = createDatabase(':memory:')
    const activeA = insertTrack(database, {
      missionId: 'mission-active',
      deviceId: 'device-a',
      count: 4,
      sourceIdOffset: 10_000,
      intervalMs: 10_000,
    })
    const activeB = insertTrack(database, {
      missionId: 'mission-active',
      deviceId: 'device-b',
      count: 4,
      sourceIdOffset: 20_000,
      intervalMs: 10_000,
      timestampOffsetMs: 5_000,
    })
    insertTrack(database, {
      missionId: 'mission-active',
      deviceId: 'inactive-device',
      count: 12,
      sourceIdOffset: 30_000,
    })

    const page = loadExactDotQuery()(database, {
      missionId: 'mission-active',
      activeDeviceIds: ['device-b', 'device-a'],
      limit: 10_000,
      direction: 'latest',
    })

    expect(page.totalPositionCount).toBe(8)
    expect(page.positions).toEqual(
      [...activeA, ...activeB].sort(compareExactDots),
    )
    expect(page.positions.map((position) => position.device_id)).not.toContain(
      'inactive-device',
    )
    database.close()
  })

  it('treats an empty active-device selection as all mission devices, while a nonempty list filters', () => {
    const database = createDatabase(':memory:')
    const deviceA = insertTrack(database, {
      missionId: 'mission-default-all',
      deviceId: 'device-a',
      count: 3,
      sourceIdOffset: 110_000,
    })
    const deviceB = insertTrack(database, {
      missionId: 'mission-default-all',
      deviceId: 'device-b',
      count: 2,
      sourceIdOffset: 120_000,
      timestampOffsetMs: 2_500,
    })
    const query = loadExactDotQuery()

    const allMissionDevices = query(database, {
      missionId: 'mission-default-all',
      activeDeviceIds: [],
      limit: 10_000,
      direction: 'latest',
    })
    expect(allMissionDevices.positions).toEqual(
      [...deviceA, ...deviceB].sort(compareExactDots),
    )
    expect(allMissionDevices.totalPositionCount).toBe(5)

    const selectedDevice = query(database, {
      missionId: 'mission-default-all',
      activeDeviceIds: ['device-b'],
      limit: 10_000,
      direction: 'latest',
    })
    expect(selectedDevice.positions).toEqual(deviceB)
    expect(selectedDevice.totalPositionCount).toBe(2)
    database.close()
  })

  it('resolves an empty device selection from the mission roster without grouping all positions', () => {
    const database = createDatabase(':memory:')
    const deviceA = insertTrack(database, {
      missionId: 'mission-roster',
      deviceId: 'device-a',
      count: 4,
      sourceIdOffset: 310_000,
    })
    const deviceB = insertTrack(database, {
      missionId: 'mission-roster',
      deviceId: 'device-b',
      count: 4,
      sourceIdOffset: 320_000,
    })
    ensureDevice(database, 'mission-roster', 'device-with-no-fixes')
    ensureDevice(database, 'mission-roster', 'device-with-pre-start-fix')
    database.prepare(`
      INSERT INTO positions (
        id, mission_id, device_id, source_position_id,
        lat, lon, timestamp, data_origin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'live')
    `).run(
      'pre-start-local',
      'mission-roster',
      'device-with-pre-start-fix',
      'pre-start-source',
      52.1,
      -9.1,
      '2026-08-07T23:59:59.000Z',
    )
    insertTrack(database, {
      missionId: 'other-mission',
      deviceId: 'other-device',
      count: 3,
      sourceIdOffset: 330_000,
    })
    const preparedSql: string[] = []
    const observedDatabase = {
      transaction: <T>(operation: () => T) => database.transaction(operation),
      prepare: (sql: string) => {
        preparedSql.push(sql)
        if (/SELECT\s+(?:DISTINCT\s+)?device_id\s+FROM\s+positions/iu.test(sql)) {
          throw new Error('Exact pagination resolved devices from the positions table.')
        }
        return database.prepare(sql)
      },
    }

    const page = loadExactDotQuery()(observedDatabase, {
      missionId: 'mission-roster',
      activeDeviceIds: [],
      limit: 10_000,
      direction: 'latest',
    })

    expect(page.positions).toEqual([...deviceA, ...deviceB].sort(compareExactDots))
    expect(page.totalPositionCount).toBe(8)
    const rosterSql = preparedSql.find((sql) =>
      /SELECT\s+device_id\s+FROM\s+devices[\s\S]*mission_id\s*=\s*\?/iu.test(sql),
    )
    expect(rosterSql).toBeDefined()
    const rosterPlan = database.prepare(`EXPLAIN QUERY PLAN ${rosterSql}`).all(
      'mission-roster',
    ) as { readonly detail: string }[]
    expect(rosterPlan.map((entry) => entry.detail).join('\n')).toMatch(
      /SEARCH\s+devices\s+USING\s+COVERING\s+INDEX/iu,
    )
    database.close()
  })

  it('reopens with the corrected durable fix once and does not revive its duplicate', async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-exact-dots-'))
    const databasePath = path.join(tempDirectory, 'mission-store.sqlite')
    let database = createDatabase(databasePath)
    const [original] = insertTrack(database, {
      missionId: 'mission-restart',
      deviceId: 'device-1',
      count: 1,
      sourceIdOffset: 1_000,
    })
    database.prepare(
      `UPDATE positions SET lat = ?, lon = ?
       WHERE mission_id = ? AND device_id = ? AND source_position_id = ?`,
    ).run(53.1234567, -8.7654321, 'mission-restart', 'device-1', original?.source_position_id)
    database.prepare(
      `INSERT OR IGNORE INTO positions (
         id, mission_id, device_id, source_position_id, lat, lon, timestamp, data_origin
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'duplicate-local-id',
      'mission-restart',
      'device-1',
      original?.source_position_id,
      54,
      -7,
      original?.timestamp,
      'live',
    )
    database.close()

    database = createDatabase(databasePath, false)
    const page = loadExactDotQuery()(database, {
      missionId: 'mission-restart',
      activeDeviceIds: ['device-1'],
      limit: 10_000,
      direction: 'latest',
    })

    expect(page.positions).toEqual([
      expect.objectContaining({
        source_position_id: original?.source_position_id,
        lat: 53.1234567,
        lon: -8.7654321,
      }),
    ])
    expect(page.totalPositionCount).toBe(1)
    database.close()
  })

  it('returns count, page, and navigation from one SQLite read snapshot during a concurrent commit', async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-exact-snapshot-'))
    const databasePath = path.join(tempDirectory, 'mission-store.sqlite')
    const setup = createDatabase(databasePath)
    const [initial] = insertTrack(setup, {
      missionId: 'mission-snapshot',
      deviceId: 'device-1',
      count: 1,
      sourceIdOffset: 900_000,
    })
    setup.pragma('journal_mode = WAL')
    setup.close()

    const reader = createDatabase(databasePath, false)
    const writer = createDatabase(databasePath, false)
    let concurrentCommitInjected = false
    const observedDatabase = {
      transaction: <T>(operation: () => T) => reader.transaction(operation),
      prepare: (sql: string) => {
        const statement = reader.prepare(sql)
        return {
          all: (...parameters: readonly unknown[]) => statement.all(...parameters),
          iterate: (...parameters: readonly unknown[]) => statement.iterate(...parameters),
          get: (...parameters: readonly unknown[]) => {
            const result = statement.get(...parameters)
            if (!concurrentCommitInjected && /COUNT\(\*\)/u.test(sql)) {
              concurrentCommitInjected = true
              writer.prepare(`
                INSERT INTO positions (
                  id, mission_id, device_id, source_position_id,
                  lat, lon, timestamp, data_origin
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                'concurrent-local-id',
                'mission-snapshot',
                'device-1',
                '900001',
                52.2,
                -9.2,
                new Date(Date.parse(initial!.timestamp) + 5_000).toISOString(),
                'live',
              )
            }
            return result
          },
        }
      },
    }

    const page = loadExactDotQuery()(observedDatabase, {
      missionId: 'mission-snapshot',
      activeDeviceIds: [],
      limit: 10_000,
      direction: 'latest',
    })

    expect(concurrentCommitInjected).toBe(true)
    expect(page.totalPositionCount).toBe(page.pagePositionCount)
    expect(page.hasEarlier).toBe(false)
    expect(page.hasLater).toBe(false)
    reader.close()
    writer.close()
  })

  it('fails cancellation closed without returning line representatives', () => {
    const database = createDatabase(':memory:')
    insertTrack(database, {
      missionId: 'mission-cancelled',
      deviceId: 'device-1',
      count: 8_941,
      sourceIdOffset: 40_000,
    })
    const lineQuery = require(lineQueryPath) as BreadcrumbLineQueryModule
    const lineSelector = vi.spyOn(lineQuery, 'listBreadcrumbPositions')
    const controller = new AbortController()
    controller.abort()

    expect(() => loadExactDotQuery()(database, {
      missionId: 'mission-cancelled',
      activeDeviceIds: ['device-1'],
      limit: 10_000,
      direction: 'latest',
      signal: controller.signal,
    })).toThrow(expect.objectContaining({ name: 'AbortError' }))
    expect(lineSelector).not.toHaveBeenCalled()
    database.close()
  })

  it('never invokes the bounded line selector and leaves its projection unchanged', () => {
    const database = createDatabase(':memory:')
    insertTrack(database, {
      missionId: 'mission-separate-sources',
      deviceId: 'device-1',
      count: 8_941,
      sourceIdOffset: 50_000,
    })
    const lineQuery = require(lineQueryPath) as BreadcrumbLineQueryModule
    const before = lineQuery.listBreadcrumbPositions(
      database,
      'mission-separate-sources',
      5_000,
    ).positions.map((position) => position.source_position_id)
    const lineSelector = vi.spyOn(lineQuery, 'listBreadcrumbPositions')

    const dots = loadExactDotQuery(true)(database, {
      missionId: 'mission-separate-sources',
      activeDeviceIds: ['device-1'],
      limit: 10_000,
      direction: 'latest',
    })

    expect(dots.positions).toHaveLength(8_941)
    expect(lineSelector).not.toHaveBeenCalled()
    lineSelector.mockRestore()
    const after = lineQuery.listBreadcrumbPositions(
      database,
      'mission-separate-sources',
      5_000,
    ).positions.map((position) => position.source_position_id)
    expect(after).toEqual(before)
    expect(after.length).toBeLessThanOrEqual(5_000)
    database.close()
  })
})

function loadExactDotQuery(fresh = false): ExactBreadcrumbDotQuery {
  try {
    if (fresh) {
      delete require.cache[require.resolve(exactDotQueryPath)]
    }
    const module = require(exactDotQueryPath) as Partial<ExactBreadcrumbDotQueryModule>
    if (typeof module.listExactBreadcrumbDotPage !== 'function') {
      throw new Error('listExactBreadcrumbDotPage is not exported')
    }
    return module.listExactBreadcrumbDotPage
  } catch (error) {
    throw new Error(
      'Exact breadcrumb dots require electron/breadcrumb-dot-query.cjs#listExactBreadcrumbDotPage; line representatives are not an allowed fallback.',
      { cause: error },
    )
  }
}

function createDatabase(databasePath: string, initialize = true) {
  const database = new Database(databasePath)
  if (initialize) {
    database.exec(`
      CREATE TABLE missions (
        id TEXT PRIMARY KEY,
        start_time TEXT NOT NULL
      );
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        UNIQUE (mission_id, device_id)
      );
      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source_position_id TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        timestamp TEXT NOT NULL,
        data_origin TEXT NOT NULL,
        timestamp_source TEXT DEFAULT 'fix',
        UNIQUE (mission_id, device_id, source_position_id)
      );
      CREATE INDEX idx_positions_mission_device_timestamp
        ON positions(mission_id, device_id, timestamp);
    `)
  }
  return database
}

function createPageQueryInstrumentation(database: ReturnType<typeof createDatabase>): {
  readonly database: {
    readonly transaction: <T>(operation: () => T) => () => T
    readonly prepare: (sql: string) => {
      readonly get: (...parameters: readonly unknown[]) => unknown
      readonly all: (...parameters: readonly unknown[]) => unknown[]
      readonly iterate: (...parameters: readonly unknown[]) => IterableIterator<unknown>
    }
  }
  readonly observations: PageQueryObservation[]
  readonly totalRowsMaterialized: () => number
} {
  const observations: PageQueryObservation[] = []
  const isPagePositionQuery = (sql: string) =>
    /SELECT\s+id,\s*source_position_id,\s*device_id,\s*lat,\s*lon,\s*timestamp,\s*data_origin/iu
      .test(sql)
  const explain = (sql: string, parameters: readonly unknown[]) =>
    (database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters) as {
      readonly detail: string
    }[]).map((entry) => entry.detail)

  return {
    database: {
      transaction: <T>(operation: () => T) => database.transaction(operation),
      prepare: (sql) => {
        const statement = database.prepare(sql)
        return {
          get: (...parameters) => statement.get(...parameters),
          all: (...parameters) => {
            const rows = statement.all(...parameters) as unknown[]
            if (isPagePositionQuery(sql)) {
              observations.push({
                method: 'all',
                sql,
                parameters,
                planDetails: explain(sql, parameters),
                rowsMaterialized: rows.length,
              })
            }
            return rows
          },
          iterate: (...parameters) => {
            const source = statement.iterate(...parameters)[Symbol.iterator]()
            const observation: PageQueryObservation | null = isPagePositionQuery(sql)
              ? {
                  method: 'iterate',
                  sql,
                  parameters,
                  planDetails: explain(sql, parameters),
                  rowsMaterialized: 0,
                }
              : null
            if (observation !== null) {
              observations.push(observation)
            }
            return {
              [Symbol.iterator]() {
                return this
              },
              next() {
                const result = source.next()
                if (!result.done && observation !== null) {
                  observation.rowsMaterialized += 1
                }
                return result
              },
              return(value?: unknown) {
                return source.return?.(value) ?? { done: true, value }
              },
            }
          },
        }
      },
    },
    observations,
    totalRowsMaterialized: () => observations.reduce(
      (total, observation) => total + observation.rowsMaterialized,
      0,
    ),
  }
}

function getObservedDeviceId(observation: PageQueryObservation): string {
  const deviceId = observation.parameters[1]
  if (typeof deviceId !== 'string') {
    throw new Error('Per-device exact-dot iterator did not bind a device ID.')
  }
  return deviceId
}

function insertTrack(
  database: ReturnType<typeof createDatabase>,
  input: {
    readonly missionId: string
    readonly deviceId: string
    readonly count: number
    readonly sourceIdOffset: number
    readonly intervalMs?: number
    readonly timestampOffsetMs?: number
  },
): ExactBreadcrumbDot[] {
  const baseMs = Date.UTC(2026, 7, 8) + (input.timestampOffsetMs ?? 0)
  ensureMission(database, input.missionId, new Date(Date.UTC(2026, 7, 8)).toISOString())
  ensureDevice(database, input.missionId, input.deviceId)
  const intervalMs = input.intervalMs ?? 5_000
  const insert = database.prepare(`
    INSERT INTO positions (
      id, mission_id, device_id, source_position_id, lat, lon, timestamp, data_origin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'live')
  `)
  const positions = Array.from({ length: input.count }, (_, index) => ({
    id: `${input.missionId}:${input.deviceId}:${index}`,
    source_position_id: String(input.sourceIdOffset + index),
    device_id: input.deviceId,
    lat: 52 + index / 10_000_000,
    lon: -9.7 - index / 10_000_000,
    timestamp: new Date(baseMs + index * intervalMs).toISOString(),
    data_origin: 'live' as const,
  }))
  database.transaction(() => {
    for (const position of positions) {
      insert.run(
        position.id,
        input.missionId,
        position.device_id,
        position.source_position_id,
        position.lat,
        position.lon,
        position.timestamp,
      )
    }
  })()
  return positions
}

function insertInterleavedTracks(
  database: ReturnType<typeof createDatabase>,
  count: number,
): ExactBreadcrumbDot[] {
  ensureMission(database, 'mission-paged', new Date(Date.UTC(2026, 7, 8)).toISOString())
  ensureDevice(database, 'mission-paged', 'device-a')
  ensureDevice(database, 'mission-paged', 'device-b')
  const insert = database.prepare(`
    INSERT INTO positions (
      id, mission_id, device_id, source_position_id, lat, lon, timestamp, data_origin
    ) VALUES (?, 'mission-paged', ?, ?, ?, ?, ?, 'live')
  `)
  const baseMs = Date.UTC(2026, 7, 8)
  const positions = Array.from({ length: count }, (_, index) => {
    const deviceId = index % 2 === 0 ? 'device-a' : 'device-b'
    return {
      id: `paged-${index}`,
      source_position_id: `source-${index}`,
      device_id: deviceId,
      lat: 52 + index / 10_000_000,
      lon: -9.7 - index / 10_000_000,
      timestamp: new Date(baseMs + Math.floor(index / 2) * 5_000).toISOString(),
      data_origin: 'live' as const,
    }
  }).sort(compareExactDots)
  database.transaction(() => {
    for (const position of positions) {
      insert.run(
        position.id,
        position.device_id,
        position.source_position_id,
        position.lat,
        position.lon,
        position.timestamp,
      )
    }
  })()
  return positions
}

function ensureMission(
  database: ReturnType<typeof createDatabase>,
  missionId: string,
  startTime: string,
): void {
  database.prepare(
    'INSERT OR IGNORE INTO missions (id, start_time) VALUES (?, ?)',
  ).run(missionId, startTime)
}

function ensureDevice(
  database: ReturnType<typeof createDatabase>,
  missionId: string,
  deviceId: string,
): void {
  database.prepare(
    'INSERT OR IGNORE INTO devices (id, mission_id, device_id) VALUES (?, ?, ?)',
  ).run(`${missionId}:${deviceId}`, missionId, deviceId)
}

function compareExactDots(left: ExactBreadcrumbDot, right: ExactBreadcrumbDot): number {
  return (
    Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
    compareStrings(left.device_id, right.device_id) ||
    compareStrings(left.source_position_id ?? left.id, right.source_position_id ?? right.id)
  )
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
