import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const DatabaseConstructor = require('better-sqlite3')
const {
  analyzeCoverageInvalidation,
  enumerateCoverageChunks,
  readCoverageClaimSnapshot,
  readCoverageManifestSnapshot,
  readCoverageChunkPage,
} = require('../../electron/coverage-query.cjs') as {
  readonly analyzeCoverageInvalidation: (database: Database, input: { readonly invalidationId: string }) => {
    readonly invalidationId: string
    readonly affectedKeys: readonly (CoverageKey & { readonly mission_id: string })[]
  }
  readonly enumerateCoverageChunks: (database: Database, input: { readonly missionId: string }) => {
    readonly changeSeq: number
    readonly chunks: readonly CoverageChunk[]
  }
  readonly readCoverageClaimSnapshot: (
    database: Database,
    input: { readonly missionId: string; readonly selectedKeys: readonly CoverageKey[] },
  ) => {
    readonly changeSeq: number
    readonly databaseReady: boolean
    readonly blockers: readonly string[]
    readonly chunkRevisions: readonly { readonly key: CoverageKey; readonly contentRev: number }[]
  }
  readonly readCoverageManifestSnapshot: (
    database: Database,
    input: { readonly missionId: string },
  ) => {
    readonly diagnostics: {
      readonly queueDepth: number
      readonly oldestQueuedAt: string | null
      readonly pendingChunkCount: number
      readonly staleChunkCount: number
      readonly freshChunkCount: number
      readonly pendingInvalidationCount: number
    }
    readonly chunks: readonly {
      readonly key: CoverageKey
      readonly contentRev: number
      readonly builtRev: number | null
      readonly fixCount: number | null
      readonly exactCount: number
    }[]
  }
  readonly readCoverageChunkPage: (database: Database, input: {
    readonly missionId: string
    readonly key: CoverageKey
    readonly expectedContentRev: number
    readonly cursor?: { readonly timestamp: string; readonly id: string }
    readonly limit?: number
  }) => {
    readonly key: CoverageKey
    readonly contentRev: number
    readonly positions: readonly PositionRow[]
    readonly nextCursor: { readonly timestamp: string; readonly id: string } | null
  }
}

type Database = {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => {
    readonly all: (...params: unknown[]) => readonly Record<string, unknown>[]
    readonly get: (...params: unknown[]) => Record<string, unknown> | undefined
  }
  readonly close: () => void
}

type CoverageKey = {
  readonly device_id: string
  readonly period_kind: 'outing' | 'unassigned'
  readonly period_id: string
}

type CoverageChunk = CoverageKey & {
  readonly fix_count: number
  readonly fix_digest: string
  readonly min_ts: string | null
  readonly max_ts: string | null
}

type PositionRow = {
  readonly id: string
  readonly source_position_id: string | null
  readonly device_id: string
  readonly timestamp: string
  readonly lat: number
  readonly lon: number
}

describe('Electron coverage query', () => {
  let database: Database

  beforeEach(() => {
    database = new DatabaseConstructor(':memory:')
    createSchema(database)
  })

  afterEach(() => database.close())

  it('enumerates roster and zero-fix active participants across outings plus Unassigned', () => {
    seedMissionModel(database)

    const result = enumerateCoverageChunks(database, { missionId: 'mission-1' })

    expect(result.changeSeq).toBe(4)
    expect(result.chunks.map((chunk) => [
      chunk.device_id, chunk.period_kind, chunk.period_id, chunk.fix_count,
    ])).toEqual([
      ['device-1', 'outing', 'outing-1', 2],
      ['device-1', 'unassigned', '', 1],
      ['device-2', 'outing', 'outing-1', 0],
      ['device-2', 'unassigned', '', 0],
      ['device-3', 'outing', 'outing-1', 0],
      ['device-3', 'unassigned', '', 0],
    ])
    expect(result.chunks.some((chunk) => chunk.device_id === 'device-4')).toBe(false)
    expect(result.chunks.every((chunk) => /^[a-f0-9]{64}$/u.test(chunk.fix_digest))).toBe(true)
  })

  it('gives a legacy no-outing mission exactly one Unassigned chunk per roster device', () => {
    database.exec(`
      INSERT INTO devices VALUES ('row-1', 'mission-1', 'device-1');
      INSERT INTO devices VALUES ('row-2', 'mission-1', 'device-2');
      INSERT INTO positions VALUES
        ('row-a', 'mission-1', 'device-1', NULL, '2026-08-24T09:00:00.000Z', 52, -9.7);
    `)

    expect(enumerateCoverageChunks(database, { missionId: 'mission-1' }).chunks).toEqual([
      expect.objectContaining({ device_id: 'device-1', period_kind: 'unassigned', period_id: '', fix_count: 1 }),
      expect.objectContaining({ device_id: 'device-2', period_kind: 'unassigned', period_id: '', fix_count: 0 }),
    ])
  })

  it('is a read-only, deterministic enumeration snapshot', () => {
    seedMissionModel(database)

    const first = enumerateCoverageChunks(database, { missionId: 'mission-1' })
    const second = enumerateCoverageChunks(database, { missionId: 'mission-1' })

    expect(second).toEqual(first)
    expect(database.prepare('SELECT enumerated FROM coverage_missions').get()).toEqual({ enumerated: 0 })
    expect(database.prepare('SELECT * FROM coverage_chunks').all()).toEqual([])
  })

  it('enumerates each participant device with one indexed positions traversal', () => {
    seedMissionModel(database)
    const preparedPositionQueries: string[] = []
    const rawPositionQueries: string[] = []
    const measuredDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property !== 'prepare') return Reflect.get(target, property, receiver)
        return (sql: string) => {
          if (sql.includes('FROM positions AS position')) preparedPositionQueries.push(sql)
          const statement = target.prepare(sql)
          if (!sql.includes('FROM positions AS position')) return statement
          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver) {
              if (statementProperty !== 'raw') {
                const value = Reflect.get(statementTarget, statementProperty, statementReceiver)
                return typeof value === 'function' ? value.bind(statementTarget) : value
              }
              return () => {
                rawPositionQueries.push(sql)
                return statementTarget.raw()
              }
            },
          })
        }
      },
    })

    const result = enumerateCoverageChunks(measuredDatabase, { missionId: 'mission-1' })

    expect(result.chunks).toHaveLength(6)
    expect(preparedPositionQueries).toHaveLength(3)
    expect(rawPositionQueries).toHaveLength(3)
  })

  it('returns bounded ledger diagnostics without device identities or position rows', () => {
    database.exec(`
      INSERT INTO coverage_chunks (
        mission_id, device_id, period_kind, period_id, content_rev, built_rev,
        fix_count, fix_digest, min_ts, max_ts, updated_at
      ) VALUES
        ('mission-1', 'device-1', 'outing', 'outing-1', 2, 1,
          2, 'digest-a', NULL, NULL, '2026-08-24T11:58:00.000Z'),
        ('mission-1', 'device-1', 'unassigned', '', 1, NULL,
          NULL, NULL, NULL, NULL, '2026-08-24T11:59:00.000Z'),
        ('mission-1', 'device-2', 'outing', 'outing-1', 1, 1,
          0, 'digest-b', NULL, NULL, '2026-08-24T12:00:00.000Z');
      INSERT INTO coverage_invalidations VALUES (
        'pending-1', 'mission-1', 'outing_created', 'outing-1',
        NULL, NULL, '2026-08-24T10:00:00.000Z', '2026-08-24T11:00:00.000Z',
        '2026-08-24T10:00:00.000Z', '2026-08-24T11:00:00.000Z',
        '2026-08-24T12:01:00.000Z', NULL
      );
    `)

    const result = readCoverageManifestSnapshot(database, { missionId: 'mission-1' })

    expect(result.diagnostics).toEqual({
      queueDepth: 2,
      oldestQueuedAt: '2026-08-24T11:58:00.000Z',
      pendingChunkCount: 1,
      staleChunkCount: 1,
      freshChunkCount: 1,
      pendingInvalidationCount: 1,
    })
    expect(JSON.stringify(result.diagnostics)).not.toContain('device-1')
  })

  it('reads an enumerated fresh manifest from bounded ledger metadata without scanning positions', () => {
    seedMissionModel(database)
    database.exec(`
      UPDATE coverage_missions SET enumerated = 1;
      INSERT INTO coverage_chunks (
        mission_id, device_id, period_kind, period_id, content_rev, built_rev,
        fix_count, fix_digest, min_ts, max_ts, updated_at
      ) VALUES
        ('mission-1', 'device-1', 'outing', 'outing-1', 1, 1,
          2, 'digest-a', NULL, NULL, '2026-08-24T12:00:00.000Z'),
        ('mission-1', 'device-1', 'unassigned', '', 1, 1,
          1, 'digest-b', NULL, NULL, '2026-08-24T12:00:00.000Z'),
        ('mission-1', 'device-2', 'outing', 'outing-1', 1, 1,
          0, 'digest-empty', NULL, NULL, '2026-08-24T12:00:00.000Z'),
        ('mission-1', 'device-2', 'unassigned', '', 1, 1,
          0, 'digest-empty', NULL, NULL, '2026-08-24T12:00:00.000Z'),
        ('mission-1', 'device-3', 'outing', 'outing-1', 1, 1,
          0, 'digest-empty', NULL, NULL, '2026-08-24T12:00:00.000Z'),
        ('mission-1', 'device-3', 'unassigned', '', 1, 1,
          0, 'digest-empty', NULL, NULL, '2026-08-24T12:00:00.000Z');
      DROP TABLE positions;
    `)

    const result = readCoverageManifestSnapshot(database, { missionId: 'mission-1' })

    expect(result.chunks).toHaveLength(6)
    expect(result.chunks.map((chunk) => chunk.exactCount)).toEqual([2, 1, 0, 0, 0, 0])
  })

  it('evaluates a claim from ledger metadata without exact mission enumeration', () => {
    seedMissionModel(database)
    database.exec(`
      UPDATE coverage_missions SET enumerated = 1;
      INSERT INTO coverage_chunks (
        mission_id, device_id, period_kind, period_id, content_rev, built_rev,
        fix_count, fix_digest, min_ts, max_ts, updated_at
      ) VALUES ('mission-1', 'device-1', 'unassigned', '', 3, 3,
        1, 'digest', NULL, NULL, '2026-08-24T12:00:00.000Z');
      DROP TABLE positions;
    `)
    const key: CoverageKey = {
      device_id: 'device-1', period_kind: 'unassigned', period_id: '',
    }

    expect(readCoverageClaimSnapshot(database, {
      missionId: 'mission-1', selectedKeys: [key],
    })).toEqual({
      changeSeq: 4,
      databaseReady: true,
      blockers: [],
      chunkRevisions: [{ key, contentRev: 3 }],
    })
  })

  it('blocks a selected fresh chunk until the mission inventory is enumerated', () => {
    seedMissionModel(database)
    database.exec(`
      INSERT INTO coverage_chunks (
        mission_id, device_id, period_kind, period_id, content_rev, built_rev,
        fix_count, fix_digest, min_ts, max_ts, updated_at
      ) VALUES ('mission-1', 'device-1', 'unassigned', '', 1, 1,
        1, 'digest', NULL, NULL, '2026-08-24T12:00:00.000Z');
    `)
    const key: CoverageKey = {
      device_id: 'device-1', period_kind: 'unassigned', period_id: '',
    }

    expect(readCoverageClaimSnapshot(database, {
      missionId: 'mission-1', selectedKeys: [key],
    })).toMatchObject({
      databaseReady: false,
      blockers: ['not_enumerated'],
    })
  })

  it('blocks an enumerated inventory when its selected ledger chunk is missing', () => {
    seedMissionModel(database)
    database.exec('UPDATE coverage_missions SET enumerated = 1')
    const key: CoverageKey = {
      device_id: 'device-1', period_kind: 'unassigned', period_id: '',
    }

    expect(readCoverageClaimSnapshot(database, {
      missionId: 'mission-1', selectedKeys: [key],
    })).toEqual({
      changeSeq: 4,
      databaseReady: false,
      blockers: ['chunk_missing'],
      chunkRevisions: [],
    })
  })

  it('reads one logical chunk in deterministic cursor pages with source-exact rows', () => {
    seedMissionModel(database)
    database.exec(`INSERT INTO coverage_chunks (
      mission_id, device_id, period_kind, period_id, content_rev, built_rev, updated_at
    ) VALUES ('mission-1', 'device-1', 'outing', 'outing-1', 3, NULL,
      '2026-08-24T12:00:00.000Z')`)
    const key: CoverageKey = { device_id: 'device-1', period_kind: 'outing', period_id: 'outing-1' }

    const first = readCoverageChunkPage(database, {
      missionId: 'mission-1', key, expectedContentRev: 3, limit: 1,
    })
    const second = readCoverageChunkPage(database, {
      missionId: 'mission-1', key, expectedContentRev: 3,
      cursor: first.nextCursor ?? undefined, limit: 1,
    })

    expect(first.positions.map((row) => row.id)).toEqual(['position-1'])
    expect(second.positions.map((row) => row.id)).toEqual(['position-2'])
    expect(second.nextCursor).toBeNull()
    const allRows = [...first.positions, ...second.positions]
    expect(digest(allRows)).toBe(
      enumerateCoverageChunks(database, { missionId: 'mission-1' }).chunks[0]?.fix_digest,
    )
  })

  it('rejects only a moved chunk revision and keeps logical identity stable when pages shift', () => {
    seedMissionModel(database)
    database.exec(`INSERT INTO coverage_chunks (
      mission_id, device_id, period_kind, period_id, content_rev, built_rev, updated_at
    ) VALUES
      ('mission-1', 'device-1', 'outing', 'outing-1', 1, NULL,
        '2026-08-24T12:00:00.000Z'),
      ('mission-1', 'device-1', 'unassigned', '', 9, NULL,
        '2026-08-24T12:00:00.000Z')`)
    const key: CoverageKey = { device_id: 'device-1', period_kind: 'outing', period_id: 'outing-1' }
    const before = readCoverageChunkPage(database, {
      missionId: 'mission-1', key, expectedContentRev: 1, limit: 1,
    })

    database.exec(`
      INSERT INTO positions VALUES
        ('position-late', 'mission-1', 'device-1', 'source-late', '2026-08-24T10:04:00.000Z', 52.01, -9.71);
      UPDATE coverage_chunks SET content_rev = 2
      WHERE mission_id = 'mission-1' AND device_id = 'device-1'
        AND period_kind = 'outing' AND period_id = 'outing-1';
    `)

    expect(() => readCoverageChunkPage(database, {
      missionId: 'mission-1', key, expectedContentRev: 1, limit: 1,
    })).toThrow(/chunk-stale/)
    const after = readCoverageChunkPage(database, {
      missionId: 'mission-1', key, expectedContentRev: 2, limit: 1,
    })
    expect(after.key).toEqual(before.key)
    expect(after.positions[0]?.id).toBe('position-late')
  })

  it('uses captured old and new boundaries to compute a bounded invalidation drain', () => {
    seedMissionModel(database)
    database.exec(`
      INSERT INTO outings (id, mission_id, started_at, ended_at) VALUES
        ('outing-2', 'mission-1', '2026-08-24T11:00:00.000Z', '2026-08-24T12:00:00.000Z');
      INSERT INTO coverage_invalidations VALUES (
        'invalidation-1', 'mission-1', 'outing_boundaries_edited', 'outing-1',
        '2026-08-24T10:00:00.000Z', '2026-08-24T12:00:00.000Z',
        '2026-08-24T09:30:00.000Z', '2026-08-24T11:00:00.000Z',
        '2026-08-24T09:30:00.000Z', '2026-08-24T12:00:00.000Z',
        '2026-08-24T12:30:00.000Z', NULL
      );
    `)

    expect(analyzeCoverageInvalidation(database, { invalidationId: 'invalidation-1' }))
      .toEqual({
        invalidationId: 'invalidation-1',
        affectedKeys: [
          { mission_id: 'mission-1', device_id: 'device-1', period_kind: 'outing', period_id: 'outing-1' },
          { mission_id: 'mission-1', device_id: 'device-1', period_kind: 'outing', period_id: 'outing-2' },
          { mission_id: 'mission-1', device_id: 'device-1', period_kind: 'unassigned', period_id: '' },
        ],
      })
  })
})

function createSchema(database: Database): void {
  database.exec(`
    CREATE TABLE devices (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, device_id TEXT NOT NULL);
    CREATE TABLE outings (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT 'Outing',
      started_at TEXT NOT NULL, ended_at TEXT
    );
    CREATE TABLE positions (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, device_id TEXT NOT NULL,
      source_position_id TEXT, timestamp TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL
    );
    CREATE INDEX idx_positions_mission_device_timestamp
      ON positions(mission_id, device_id, timestamp);
    CREATE TABLE mission_participants (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, kind TEXT NOT NULL,
      traccar_device_id TEXT, mission_team_id TEXT, removed_at TEXT
    );
    CREATE TABLE mission_group_membership_events (
      id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, mission_id TEXT NOT NULL,
      mission_team_id TEXT NOT NULL, traccar_device_id TEXT NOT NULL,
      change TEXT NOT NULL, observed_at TEXT NOT NULL
    );
    CREATE TABLE coverage_missions (
      mission_id TEXT PRIMARY KEY, change_seq INTEGER NOT NULL,
      enumerated INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO coverage_missions VALUES ('mission-1', 4, 0, '2026-08-24T12:00:00.000Z');
    CREATE TABLE coverage_chunks (
      mission_id TEXT NOT NULL, device_id TEXT NOT NULL, period_kind TEXT NOT NULL,
      period_id TEXT NOT NULL, content_rev INTEGER NOT NULL, built_rev INTEGER,
      fix_count INTEGER, fix_digest TEXT, min_ts TEXT, max_ts TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, device_id, period_kind, period_id)
    );
    CREATE TABLE coverage_invalidations (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, reason TEXT NOT NULL,
      subject_outing_id TEXT NOT NULL, old_started_at TEXT, old_ended_at TEXT,
      new_started_at TEXT, new_ended_at TEXT, range_from TEXT NOT NULL,
      range_to TEXT, created_at TEXT NOT NULL, drained_at TEXT
    );
    CREATE TABLE participant_backfill_checkpoints (
      mission_id TEXT NOT NULL, completed INTEGER NOT NULL
    );
  `)
}

function seedMissionModel(database: Database): void {
  database.exec(`
    INSERT INTO devices VALUES ('row-1', 'mission-1', 'device-1');
    INSERT INTO outings (id, mission_id, started_at, ended_at) VALUES
      ('outing-1', 'mission-1', '2026-08-24T10:00:00.000Z', '2026-08-24T11:00:00.000Z');
    INSERT INTO positions VALUES
      ('position-1', 'mission-1', 'device-1', 'source-1', '2026-08-24T10:05:00.000Z', 52.001, -9.701),
      ('position-2', 'mission-1', 'device-1', 'source-2', '2026-08-24T10:10:00.000Z', 52.002, -9.702),
      ('position-3', 'mission-1', 'device-1', NULL, '2026-08-24T12:00:00.000Z', 52.003, -9.703);
    INSERT INTO mission_participants VALUES
      ('participant-2', 'mission-1', 'device', 'device-2', NULL, NULL),
      ('participant-group', 'mission-1', 'group', NULL, 'team-1', NULL),
      ('participant-removed', 'mission-1', 'device', 'device-4', NULL, '2026-08-24T11:00:00.000Z');
    INSERT INTO mission_group_membership_events VALUES
      ('membership-1', 1, 'mission-1', 'team-1', 'device-3', 'member', '2026-08-24T09:00:00.000Z');
  `)
}

function digest(rows: readonly PositionRow[]): string {
  const identities = rows.map((row) =>
    row.source_position_id === null ? `stored:${row.id}` : `source:${row.source_position_id}`)
  return createHash('sha256').update(identities.join('\n')).digest('hex')
}
