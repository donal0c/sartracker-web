import { createRequire } from 'node:module'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const {
  appendCoverageInvalidation,
  applyCoverageChunkBuild,
  applyCoverageChunkBuilds,
  applyCoverageEnumeration,
  applyCoverageInvalidationDrain,
  recordAcceptedCoveragePositions,
} = require('../../electron/coverage-ledger.cjs') as {
  readonly recordAcceptedCoveragePositions: (
    database: Database,
    input: {
      readonly missionId: string
      readonly positions: readonly { readonly device_id: string; readonly timestamp: string }[]
      readonly updatedAt: string
    },
  ) => { readonly changeSeq: number; readonly affectedKeys: readonly string[] }
  readonly appendCoverageInvalidation: (
    database: Database,
    input: {
      readonly id: string
      readonly missionId: string
      readonly reason: 'outing_created' | 'outing_ended' | 'outing_boundaries_edited'
      readonly subjectOutingId: string
      readonly oldBounds: { readonly started_at: string; readonly ended_at: string | null } | null
      readonly newBounds: { readonly started_at: string; readonly ended_at: string | null } | null
      readonly createdAt: string
    },
  ) => { readonly changeSeq: number }
  readonly applyCoverageEnumeration: (
    database: Database,
    input: {
      readonly missionId: string
      readonly expectedChangeSeq: number
      readonly chunks: readonly {
        readonly device_id: string
        readonly period_kind: 'outing' | 'unassigned'
        readonly period_id: string
        readonly fix_count: number
        readonly fix_digest: string
        readonly min_ts: string | null
        readonly max_ts: string | null
      }[]
      readonly updatedAt: string
      readonly failBeforeCommit?: boolean
    },
  ) => { readonly applied: boolean; readonly changeSeq: number }
  readonly applyCoverageChunkBuild: (
    database: Database,
    input: {
      readonly missionId: string
      readonly deviceId: string
      readonly periodKind: 'outing' | 'unassigned'
      readonly periodId: string
      readonly expectedContentRev: number
      readonly fixCount: number
      readonly fixDigest: string
      readonly minTs: string | null
      readonly maxTs: string | null
      readonly updatedAt: string
    },
  ) => boolean
  readonly applyCoverageChunkBuilds: (
    database: Database,
    input: {
      readonly missionId: string
      readonly builds: readonly {
        readonly key: {
          readonly device_id: string
          readonly period_kind: 'outing' | 'unassigned'
          readonly period_id: string
        }
        readonly contentRev: number
        readonly fixCount: number
        readonly fixDigest: string
        readonly minTs: string | null
        readonly maxTs: string | null
      }[]
      readonly updatedAt: string
      readonly failAfterBuildIndex?: number
    },
  ) => { readonly rejectedChunkKeys: readonly string[] }
  readonly applyCoverageInvalidationDrain: (
    database: Database,
    input: {
      readonly invalidationId: string
      readonly affectedKeys: readonly {
        readonly mission_id: string
        readonly device_id: string
        readonly period_kind: 'outing' | 'unassigned'
        readonly period_id: string
      }[]
      readonly drainedAt: string
      readonly failAfterChunkUpdates?: boolean
    },
  ) => { readonly applied: boolean; readonly changeSeq: number | null }
}

type Database = {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => {
    readonly all: (...params: unknown[]) => readonly Record<string, unknown>[]
    readonly get: (...params: unknown[]) => Record<string, unknown> | undefined
    readonly run: (...params: unknown[]) => { readonly changes: number }
  }
  readonly transaction: <T>(callback: () => T) => () => T
  readonly close: () => void
}

describe('Electron coverage ledger', () => {
  let database: Database

  beforeEach(() => {
    database = new Database(':memory:')
    createSchema(database)
  })

  afterEach(() => {
    database.close()
  })

  it('bumps each accepted logical chunk once and mission change sequence once per transaction', () => {
    seedOutings(database)

    expect(recordAcceptedCoveragePositions(database, {
      missionId: 'mission-1',
      positions: [
        { device_id: 'device-1', timestamp: '2026-08-24T10:05:00.000Z' },
        { device_id: 'device-1', timestamp: '2026-08-24T10:06:00.000Z' },
        { device_id: 'device-1', timestamp: '2026-08-24T12:00:00.000Z' },
        { device_id: 'device-2', timestamp: '2026-08-24T10:07:00.000Z' },
      ],
      updatedAt: '2026-08-24T12:01:00.000Z',
    })).toEqual({
      changeSeq: 1,
      affectedKeys: [
        'device-1\u0000outing\u0000outing-1',
        'device-1\u0000unassigned\u0000',
        'device-2\u0000outing\u0000outing-1',
      ],
    })

    expect(readChunks(database)).toEqual([
      expect.objectContaining({ device_id: 'device-1', period_kind: 'outing', period_id: 'outing-1', content_rev: 1 }),
      expect.objectContaining({ device_id: 'device-1', period_kind: 'unassigned', period_id: '', content_rev: 1 }),
      expect.objectContaining({ device_id: 'device-2', period_kind: 'outing', period_id: 'outing-1', content_rev: 1 }),
    ])
    expect(readMission(database)).toEqual({ change_seq: 1, enumerated: 0 })

    recordAcceptedCoveragePositions(database, {
      missionId: 'mission-1',
      positions: [
        { device_id: 'device-1', timestamp: '2026-08-24T10:08:00.000Z' },
        { device_id: 'device-1', timestamp: '2026-08-24T10:09:00.000Z' },
      ],
      updatedAt: '2026-08-24T12:02:00.000Z',
    })
    expect(readChunks(database)[0]).toEqual(expect.objectContaining({ content_rev: 2 }))
    expect(readMission(database)).toEqual({ change_seq: 2, enumerated: 0 })
  })

  it('touches nothing when no accepted position changed', () => {
    expect(recordAcceptedCoveragePositions(database, {
      missionId: 'mission-1',
      positions: [],
      updatedAt: '2026-08-24T12:00:00.000Z',
    })).toEqual({ changeSeq: 0, affectedKeys: [] })
    expect(readChunks(database)).toEqual([])
    expect(readMission(database)).toBeUndefined()
  })

  it('resolves each accepted fix with an indexed point lookup instead of scanning every mission outing', () => {
    database.exec('CREATE INDEX idx_outings_mission_started ON outings(mission_id, started_at)')
    database.exec(`
      INSERT INTO outings VALUES
        ('outing-early', 'mission-1', '2026-08-24T08:00:00.000Z', '2026-08-24T09:00:00.000Z'),
        ('outing-current', 'mission-1', '2026-08-24T10:00:00.000Z', '2026-08-24T11:00:00.000Z')
    `)
    const preparedSql: string[] = []
    const instrumentedDatabase = new Proxy(database, {
      get(target, property) {
        if (property === 'prepare') {
          return (sql: string) => {
            preparedSql.push(sql)
            return target.prepare(sql)
          }
        }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    expect(recordAcceptedCoveragePositions(instrumentedDatabase, {
      missionId: 'mission-1',
      positions: [
        { device_id: 'device-1', timestamp: '2026-08-24T10:05:00.000Z' },
        { device_id: 'device-2', timestamp: '2026-08-24T12:00:00.000Z' },
      ],
      updatedAt: '2026-08-24T12:01:00.000Z',
    }).affectedKeys).toEqual([
      'device-1\u0000outing\u0000outing-current',
      'device-2\u0000unassigned\u0000',
    ])

    const outingReads = preparedSql.filter((sql) => sql.includes('FROM outings'))
    expect(outingReads).toHaveLength(1)
    expect(outingReads[0]).toContain('SELECT id, ended_at')
    expect(outingReads[0]).toContain('started_at <= ?')
    expect(outingReads[0]).toContain('LIMIT 1')
    expect(outingReads[0]).not.toContain('ended_at IS NULL')
    expect(outingReads[0]).not.toContain('ORDER BY started_at ASC')
    expect(database.prepare(`EXPLAIN QUERY PLAN ${outingReads[0]}`)
      .all('mission-1', '2026-08-24T10:05:00.000Z'))
      .toEqual([
        expect.objectContaining({ detail: expect.stringContaining('idx_outings_mission_started') }),
      ])
  })

  it.each([
    {
      reason: 'outing_created' as const,
      oldBounds: null,
      newBounds: { started_at: '2026-08-24T10:00:00.000Z', ended_at: null },
      expectedRange: ['2026-08-24T10:00:00.000Z', null],
    },
    {
      reason: 'outing_ended' as const,
      oldBounds: { started_at: '2026-08-24T10:00:00.000Z', ended_at: null },
      newBounds: { started_at: '2026-08-24T10:00:00.000Z', ended_at: '2026-08-24T12:00:00.000Z' },
      expectedRange: ['2026-08-24T10:00:00.000Z', null],
    },
    {
      reason: 'outing_boundaries_edited' as const,
      oldBounds: { started_at: '2026-08-24T10:00:00.000Z', ended_at: '2026-08-24T12:00:00.000Z' },
      newBounds: { started_at: '2026-08-24T09:30:00.000Z', ended_at: '2026-08-24T11:00:00.000Z' },
      expectedRange: ['2026-08-24T09:30:00.000Z', '2026-08-24T12:00:00.000Z'],
    },
  ])('appends one O(1) $reason invalidation with exact old/new bounds', ({ reason, oldBounds, newBounds, expectedRange }) => {
    appendCoverageInvalidation(database, {
      id: `invalidation-${reason}`,
      missionId: 'mission-1',
      reason,
      subjectOutingId: 'outing-1',
      oldBounds,
      newBounds,
      createdAt: '2026-08-24T12:30:00.000Z',
    })

    expect(database.prepare('SELECT * FROM coverage_invalidations').all()).toEqual([
      expect.objectContaining({
        id: `invalidation-${reason}`,
        reason,
        subject_outing_id: 'outing-1',
        old_started_at: oldBounds?.started_at ?? null,
        old_ended_at: oldBounds?.ended_at ?? null,
        new_started_at: newBounds?.started_at ?? null,
        new_ended_at: newBounds?.ended_at ?? null,
        range_from: expectedRange[0],
        range_to: expectedRange[1],
        drained_at: null,
      }),
    ])
    expect(readChunks(database)).toEqual([])
    expect(readMission(database)).toEqual({ change_seq: 1, enumerated: 0 })
  })

  it('rolls evidence and ledger back together when the ledger write fails', () => {
    seedOutings(database)
    const write = database.transaction(() => {
      database.exec("INSERT INTO positions VALUES ('position-1', 'mission-1')")
      recordAcceptedCoveragePositions(database, {
        missionId: 'mission-1',
        positions: [{ device_id: 'device-1', timestamp: '2026-08-24T10:05:00.000Z' }],
        updatedAt: '2026-08-24T12:00:00.000Z',
      })
      throw new Error('Injected ledger failure.')
    })

    expect(write).toThrow(/Injected ledger failure/)
    expect(database.prepare('SELECT * FROM positions').all()).toEqual([])
    expect(readChunks(database)).toEqual([])
    expect(readMission(database)).toBeUndefined()
  })

  it('drains atomically and idempotently while crash-before and crash-mid stay pending', () => {
    appendCoverageInvalidation(database, {
      id: 'invalidation-1',
      missionId: 'mission-1',
      reason: 'outing_boundaries_edited',
      subjectOutingId: 'outing-1',
      oldBounds: { started_at: '2026-08-24T10:00:00.000Z', ended_at: '2026-08-24T12:00:00.000Z' },
      newBounds: { started_at: '2026-08-24T09:00:00.000Z', ended_at: '2026-08-24T11:00:00.000Z' },
      createdAt: '2026-08-24T12:30:00.000Z',
    })
    const affectedKeys = [{
      mission_id: 'mission-1', device_id: 'device-1', period_kind: 'outing' as const, period_id: 'outing-1',
    }]

    expect(database.prepare('SELECT drained_at FROM coverage_invalidations').get()).toEqual({ drained_at: null })
    expect(() => applyCoverageInvalidationDrain(database, {
      invalidationId: 'invalidation-1', affectedKeys,
      drainedAt: '2026-08-24T12:31:00.000Z', failAfterChunkUpdates: true,
    })).toThrow(/Injected invalidation drain failure/)
    expect(readChunks(database)).toEqual([])
    expect(database.prepare('SELECT drained_at FROM coverage_invalidations').get()).toEqual({ drained_at: null })

    expect(applyCoverageInvalidationDrain(database, {
      invalidationId: 'invalidation-1', affectedKeys,
      drainedAt: '2026-08-24T12:32:00.000Z',
    })).toEqual({ applied: true, changeSeq: 2 })
    expect(applyCoverageInvalidationDrain(database, {
      invalidationId: 'invalidation-1', affectedKeys,
      drainedAt: '2026-08-24T12:33:00.000Z',
    })).toEqual({ applied: false, changeSeq: null })
    expect(readChunks(database)).toEqual([
      expect.objectContaining({ content_rev: 1, built_rev: null }),
    ])
    expect(readMission(database)).toEqual({ change_seq: 2, enumerated: 0 })
  })

  it('applies first enumeration atomically and never trusts a crashed enumeration', () => {
    const enumeration = {
      missionId: 'mission-1',
      expectedChangeSeq: 0,
      chunks: [{
        device_id: 'device-1', period_kind: 'unassigned' as const, period_id: '',
        fix_count: 2, fix_digest: 'digest-2',
        min_ts: '2026-08-24T10:00:00.000Z', max_ts: '2026-08-24T10:05:00.000Z',
      }],
      updatedAt: '2026-08-24T12:00:00.000Z',
    }

    expect(() => applyCoverageEnumeration(database, {
      ...enumeration, failBeforeCommit: true,
    })).toThrow(/Injected coverage enumeration failure/)
    expect(readChunks(database)).toEqual([])
    expect(readMission(database)).toBeUndefined()

    expect(applyCoverageEnumeration(database, enumeration)).toEqual({
      applied: true, changeSeq: 1,
    })
    expect(readChunks(database)).toEqual([
      expect.objectContaining({
        content_rev: 1, built_rev: 1, fix_count: 2, fix_digest: 'digest-2',
      }),
    ])
    expect(readMission(database)).toEqual({ change_seq: 1, enumerated: 1 })
    expect(applyCoverageEnumeration(database, enumeration)).toEqual({
      applied: false, changeSeq: 1,
    })
  })

  it('commits concurrent enumeration rows as pending and conditionally applies only the matching chunk build', () => {
    database.exec(`INSERT INTO coverage_missions VALUES
      ('mission-1', 1, 0, '2026-08-24T11:00:00.000Z')`)
    applyCoverageEnumeration(database, {
      missionId: 'mission-1', expectedChangeSeq: 0,
      chunks: [{
        device_id: 'device-1', period_kind: 'unassigned', period_id: '',
        fix_count: 2, fix_digest: 'stale-enumeration', min_ts: null, max_ts: null,
      }],
      updatedAt: '2026-08-24T12:00:00.000Z',
    })
    expect(readChunks(database)).toEqual([
      expect.objectContaining({ content_rev: 1, built_rev: null, fix_count: null }),
    ])

    expect(applyCoverageChunkBuild(database, {
      missionId: 'mission-1', deviceId: 'device-1',
      periodKind: 'unassigned', periodId: '', expectedContentRev: 2,
      fixCount: 3, fixDigest: 'wrong-revision', minTs: null, maxTs: null,
      updatedAt: '2026-08-24T12:01:00.000Z',
    })).toBe(false)
    expect(applyCoverageChunkBuild(database, {
      missionId: 'mission-1', deviceId: 'device-1',
      periodKind: 'unassigned', periodId: '', expectedContentRev: 1,
      fixCount: 3, fixDigest: 'current-revision', minTs: null, maxTs: null,
      updatedAt: '2026-08-24T12:02:00.000Z',
    })).toBe(true)
    expect(readChunks(database)[0]).toEqual(expect.objectContaining({
      content_rev: 1, built_rev: 1, fix_count: 3, fix_digest: 'current-revision',
    }))
  })

  it('applies a full 100-device by 13-period build set in one atomic transaction', () => {
    const builds = Array.from({ length: 1_300 }, (_, index) => ({
      key: {
        device_id: `device-${Math.floor(index / 13)}`,
        period_kind: 'outing' as const,
        period_id: `period-${index % 13}`,
      },
      contentRev: 1,
      fixCount: index,
      fixDigest: `digest-${index}`,
      minTs: null,
      maxTs: null,
    }))
    const insert = database.transaction(() => {
      for (const build of builds) {
        database.prepare(`INSERT INTO coverage_chunks (
          mission_id, device_id, period_kind, period_id,
          content_rev, built_rev, updated_at
        ) VALUES (?, ?, ?, ?, 1, NULL, ?)`)
          .run(
            'mission-1', build.key.device_id, build.key.period_kind,
            build.key.period_id, '2026-08-24T12:00:00.000Z',
          )
      }
    })
    insert()

    expect(() => applyCoverageChunkBuilds(database, {
      missionId: 'mission-1', builds,
      updatedAt: '2026-08-24T12:01:00.000Z', failAfterBuildIndex: 649,
    })).toThrow(/Injected coverage build batch failure/)
    expect(database.prepare(`SELECT COUNT(*) AS count FROM coverage_chunks
      WHERE built_rev IS NOT NULL`).get()).toEqual({ count: 0 })

    const startedAt = performance.now()
    expect(applyCoverageChunkBuilds(database, {
      missionId: 'mission-1', builds,
      updatedAt: '2026-08-24T12:02:00.000Z',
    })).toEqual({ rejectedChunkKeys: [] })
    expect(performance.now() - startedAt).toBeLessThan(200)
    expect(database.prepare(`SELECT COUNT(*) AS count FROM coverage_chunks
      WHERE built_rev = content_rev`).get()).toEqual({ count: 1_300 })
  })
})

function createSchema(database: Database): void {
  database.exec(`
    CREATE TABLE outings (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT
    );
    CREATE TABLE positions (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL);
    CREATE TABLE coverage_chunks (
      mission_id TEXT NOT NULL, device_id TEXT NOT NULL,
      period_kind TEXT NOT NULL, period_id TEXT NOT NULL DEFAULT '',
      content_rev INTEGER NOT NULL DEFAULT 1, built_rev INTEGER,
      fix_count INTEGER, fix_digest TEXT, min_ts TEXT, max_ts TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, device_id, period_kind, period_id)
    );
    CREATE TABLE coverage_missions (
      mission_id TEXT PRIMARY KEY, change_seq INTEGER NOT NULL DEFAULT 0,
      enumerated INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    CREATE TABLE coverage_invalidations (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, reason TEXT NOT NULL,
      subject_outing_id TEXT NOT NULL, old_started_at TEXT, old_ended_at TEXT,
      new_started_at TEXT, new_ended_at TEXT, range_from TEXT NOT NULL,
      range_to TEXT, created_at TEXT NOT NULL, drained_at TEXT
    );
  `)
}

function seedOutings(database: Database): void {
  database.exec(`INSERT INTO outings VALUES
    ('outing-1', 'mission-1', '2026-08-24T10:00:00.000Z', '2026-08-24T11:00:00.000Z')`)
}

function readChunks(database: Database): readonly Record<string, unknown>[] {
  return database.prepare(`SELECT * FROM coverage_chunks
    ORDER BY device_id, period_kind, period_id`).all()
}

function readMission(database: Database): Record<string, unknown> | undefined {
  return database.prepare(`SELECT change_seq, enumerated FROM coverage_missions
    WHERE mission_id = 'mission-1'`).get()
}
