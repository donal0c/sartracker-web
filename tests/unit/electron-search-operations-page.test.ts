import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (path: string) => TestDatabase
const {
  readSearchOperationPage,
} = require('../../electron/search-operations-page-query.cjs') as {
  readonly readSearchOperationPage: (
    database: TestDatabase,
    input: {
      readonly missionId: string
      readonly kind: 'areas' | 'assignments' | 'outings' | 'passes'
      readonly search?: string
      readonly cursor?: string
      readonly limit?: number
    },
  ) => {
    readonly kind: string
    readonly generation: number
    readonly entries: readonly Readonly<Record<string, unknown>>[]
    readonly totalCount: number
    readonly nextCursor: string | null
  }
}
const { runSearchOperationPageInWorker } = require(
  '../../electron/search-operations-page-runner.cjs',
) as {
  readonly runSearchOperationPageInWorker: (input: {
    readonly databasePath: string
    readonly query: {
      readonly missionId: string
      readonly kind: 'passes'
      readonly limit: number
    }
  }) => Promise<{
    readonly generation: number
    readonly entries: readonly Readonly<Record<string, unknown>>[]
    readonly totalCount: number
    readonly nextCursor: string | null
  }>
}

type TestDatabase = {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => {
    readonly run: (...params: readonly unknown[]) => unknown
    readonly get: (...params: readonly unknown[]) => Readonly<Record<string, unknown>>
    readonly all: (...params: readonly unknown[]) => readonly Readonly<Record<string, unknown>>[]
  }
  readonly close: () => void
  readonly transaction: <T>(operation: () => T) => () => T
}

describe('Search Operations renderer pages [DON-279]', () => {
  it('keyset-pages passes, batches link counts, and never returns retained advisory detail', () => {
    const database = createSearchDatabase()
    for (let index = 0; index < 51; index += 1) {
      const id = `pass-${index.toString().padStart(3, '0')}`
      database.prepare(`INSERT INTO search_passes VALUES (
        ?, 'mission-1', 'area-1', 'assignment-1', ?, ?, 'partial',
        'operator note', 'Coordinator', ?, 1, ?, ?
      )`).run(
        id,
        `2026-08-28T10:${String(index).padStart(2, '0')}:00.000Z`,
        `2026-08-28T10:${String(index).padStart(2, '0')}:30.000Z`,
        JSON.stringify({ exactCoverage: 'x'.repeat(512 * 1024) }),
        '2026-08-28T12:00:00.000Z',
        '2026-08-28T12:00:00.000Z',
      )
      database.prepare(`INSERT INTO search_pass_evidence_links VALUES
        (?, 1, 'participant', 'participant-1'),
        (?, 1, 'clue', 'clue-1'),
        (?, 1, 'track', 'track-1')`).run(id, id, id)
    }

    const first = readSearchOperationPage(database, {
      missionId: 'mission-1', kind: 'passes', limit: 25,
    })
    const second = readSearchOperationPage(database, {
      missionId: 'mission-1', kind: 'passes', limit: 25,
      cursor: first.nextCursor ?? undefined,
    })
    const third = readSearchOperationPage(database, {
      missionId: 'mission-1', kind: 'passes', limit: 25,
      cursor: second.nextCursor ?? undefined,
    })

    expect(first.entries).toHaveLength(25)
    expect(second.entries).toHaveLength(25)
    expect(third.entries).toHaveLength(1)
    expect(first.totalCount).toBe(51)
    expect(second.totalCount).toBe(51)
    expect(third.nextCursor).toBeNull()
    expect(first.entries[0]).toMatchObject({
      participant_count: 1,
      clue_count: 1,
      track_evidence_count: 1,
    })
    expect(JSON.stringify({ first, second, third })).not.toContain('exactCoverage')
    expect(Buffer.byteLength(JSON.stringify(first), 'utf8')).toBeLessThanOrEqual(256 * 1024)
    database.close()
  })

  it('binds opaque cursors to mission, kind, and search while keeping every selector searchable', () => {
    const database = createSearchDatabase()
    database.exec(`
      INSERT INTO search_areas VALUES
        ('area-1', 'mission-1', 'Alpha', 'active', '{"type":"Polygon"}', NULL, 1,
          'Coordinator', '2026-08-28T09:00:00.000Z', '2026-08-28T09:00:00.000Z', NULL),
        ('area-2', 'mission-1', 'Remote Bravo', 'active', '{"type":"Polygon"}', NULL, 1,
          'Coordinator', '2026-08-28T09:01:00.000Z', '2026-08-28T09:01:00.000Z', NULL);
      INSERT INTO outings VALUES
        ('outing-1', 'mission-1', 'Morning team', '2026-08-28T08:00:00.000Z', NULL,
          '2026-08-28T08:00:00.000Z', '2026-08-28T08:00:00.000Z'),
        ('outing-2', 'mission-1', 'Remote night team', '2026-08-28T20:00:00.000Z', NULL,
          '2026-08-28T20:00:00.000Z', '2026-08-28T20:00:00.000Z');
      INSERT INTO search_assignments VALUES
        ('assignment-1', 'mission-1', 'area-1', 'outing-1', 'Alpha Team', '[]', NULL,
          1, 'Coordinator', '2026-08-28T09:00:00.000Z', '2026-08-28T09:00:00.000Z', NULL),
        ('assignment-2', 'mission-1', 'area-2', 'outing-2', 'Remote Team', '[]', NULL,
          1, 'Coordinator', '2026-08-28T20:00:00.000Z', '2026-08-28T20:00:00.000Z', NULL);
    `)

    for (const kind of ['areas', 'assignments', 'outings'] as const) {
      const page = readSearchOperationPage(database, {
        missionId: 'mission-1', kind, search: 'Remote', limit: 1,
      })
      expect(page.entries).toHaveLength(1)
      expect(page.totalCount).toBe(1)
    }

    const cursor = readSearchOperationPage(database, {
      missionId: 'mission-1', kind: 'areas', limit: 1,
    }).nextCursor
    expect(cursor).toEqual(expect.any(String))
    expect(() => readSearchOperationPage(database, {
      missionId: 'mission-2', kind: 'areas', cursor: cursor ?? undefined, limit: 1,
    })).toThrow(/cursor is invalid/i)
    expect(() => readSearchOperationPage(database, {
      missionId: 'mission-1', kind: 'outings', cursor: cursor ?? undefined, limit: 1,
    })).toThrow(/cursor is invalid/i)
    expect(() => readSearchOperationPage(database, {
      missionId: 'mission-1', kind: 'areas', search: 'different', cursor: cursor ?? undefined,
      limit: 1,
    })).toThrow(/cursor is invalid/i)
    database.close()
  })

  it('rejects a continuation after retained Search Operations evidence changes [DON-279]', () => {
    const database = createSearchDatabase()
    database.exec(`
      INSERT INTO mission_replay_generations VALUES ('mission-1', 1);
      INSERT INTO search_areas VALUES
        ('area-a', 'mission-1', 'Alpha', 'active', '{}', NULL, 1,
          'Coordinator', '2026-08-28T09:00:00.000Z', '2026-08-28T09:00:00.000Z', NULL),
        ('area-b', 'mission-1', 'Bravo', 'active', '{}', NULL, 1,
          'Coordinator', '2026-08-28T09:01:00.000Z', '2026-08-28T09:01:00.000Z', NULL),
        ('area-c', 'mission-1', 'Charlie', 'active', '{}', NULL, 1,
          'Coordinator', '2026-08-28T09:02:00.000Z', '2026-08-28T09:02:00.000Z', NULL);
    `)
    const first = readSearchOperationPage(database, {
      missionId: 'mission-1', kind: 'areas', limit: 1,
    })
    expect(first).toMatchObject({ generation: 1, totalCount: 3 })
    database.exec(`
      UPDATE search_areas SET name = 'Aardvark', version_sequence = 2 WHERE id = 'area-c';
      UPDATE mission_replay_generations SET generation = 2 WHERE mission_id = 'mission-1';
    `)

    expect(() => readSearchOperationPage(database, {
      missionId: 'mission-1', kind: 'areas', limit: 1,
      cursor: first.nextCursor ?? undefined,
    })).toThrow(/Search Operations page changed; return to the first page/i)
    database.close()
  })

  it('pins generation, exact count, and entries to one SQLite read snapshot [DON-279]', () => {
    const fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'search-operation-snapshot-'))
    const databasePath = path.join(fixtureDirectory, 'mission.sqlite')
    const reader = createSearchDatabase(databasePath)
    reader.exec(`
      PRAGMA journal_mode = WAL;
      INSERT INTO mission_replay_generations VALUES ('mission-1', 1);
      INSERT INTO search_areas VALUES
        ('area-a', 'mission-1', 'Alpha', 'active', '{}', NULL, 1,
          'Coordinator', '2026-08-28T09:00:00.000Z', '2026-08-28T09:00:00.000Z', NULL),
        ('area-b', 'mission-1', 'Bravo', 'active', '{}', NULL, 1,
          'Coordinator', '2026-08-28T09:01:00.000Z', '2026-08-28T09:01:00.000Z', NULL);
    `)
    const writer = new Database(databasePath)
    let wroteAfterCount = false
    const database = {
      exec: reader.exec.bind(reader),
      close: reader.close.bind(reader),
      transaction: reader.transaction.bind(reader),
      prepare: (sql: string) => {
        const statement = reader.prepare(sql)
        if (!sql.includes('SELECT COUNT(*) AS count')) return statement
        return new Proxy(statement, {
          get: (target, property) => {
            if (property !== 'get') return Reflect.get(target, property)
            return (...params: readonly unknown[]) => {
              const count = statement.get(...params)
              writer.exec(`
                INSERT INTO search_areas VALUES
                  ('area-new', 'mission-1', 'Aardvark', 'active', '{}', NULL, 1,
                    'Coordinator', '2026-08-28T09:02:00.000Z', '2026-08-28T09:02:00.000Z', NULL);
                UPDATE mission_replay_generations SET generation = 2
                  WHERE mission_id = 'mission-1';
              `)
              wroteAfterCount = true
              return count
            }
          },
        })
      },
    } satisfies TestDatabase

    const page = readSearchOperationPage(database, {
      missionId: 'mission-1', kind: 'areas', limit: 1,
    })
    expect(wroteAfterCount).toBe(true)
    expect(page).toMatchObject({ generation: 1, totalCount: 2 })
    expect(page.entries[0]).toMatchObject({ id: 'area-a', name: 'Alpha' })

    writer.close()
    reader.close()
    rmSync(fixtureDirectory, { recursive: true, force: true })
  })

  it('keeps a 50,000-pass read off the main isolate and returns only one bounded page', async () => {
    const fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'search-operation-page-'))
    const databasePath = path.join(fixtureDirectory, 'mission.sqlite')
    const database = createSearchDatabase(databasePath)
    const insert = database.prepare(`INSERT INTO search_passes VALUES (
      ?, 'mission-1', 'area-1', 'assignment-1', ?, ?, 'partial',
      NULL, 'Coordinator', NULL, 1, ?, ?
    )`)
    database.transaction(() => {
      for (let index = 0; index < 50_000; index += 1) {
        const timestamp = `2026-08-${String(1 + Math.floor(index / 86_400)).padStart(2, '0')}T${String(Math.floor(index / 3_600) % 24).padStart(2, '0')}:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`
        insert.run(`pass-${String(index).padStart(5, '0')}`, timestamp, timestamp, timestamp, timestamp)
      }
    })()
    database.close()

    const startedAt = performance.now()
    const timerLag = new Promise<number>((resolve) => setTimeout(
      () => resolve(performance.now() - startedAt),
      0,
    ))
    const [page, observedTimerLag] = await Promise.all([
      runSearchOperationPageInWorker({
        databasePath,
        query: { missionId: 'mission-1', kind: 'passes', limit: 25 },
      }),
      timerLag,
    ])

    expect(observedTimerLag).toBeLessThan(200)
    expect(page.entries).toHaveLength(25)
    expect(page.totalCount).toBe(50_000)
    expect(page.nextCursor).toEqual(expect.any(String))
    expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThanOrEqual(256 * 1024)
    rmSync(fixtureDirectory, { recursive: true, force: true })
  }, 30_000)
})

function createSearchDatabase(databasePath = ':memory:'): TestDatabase {
  const database = new Database(databasePath)
  database.exec(`
    CREATE TABLE search_areas (
      id TEXT PRIMARY KEY, mission_id TEXT, name TEXT, status TEXT, geometry_json TEXT,
      legacy_drawing_id TEXT, version_sequence INTEGER, updated_by TEXT, created_at TEXT,
      updated_at TEXT, retired_at TEXT
    );
    CREATE TABLE outings (
      id TEXT PRIMARY KEY, mission_id TEXT, label TEXT, started_at TEXT, ended_at TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE search_assignments (
      id TEXT PRIMARY KEY, mission_id TEXT, search_area_id TEXT, outing_id TEXT, team_id TEXT,
      participant_ids_json TEXT, notes TEXT, version_sequence INTEGER, updated_by TEXT,
      created_at TEXT, updated_at TEXT, retired_at TEXT
    );
    CREATE TABLE search_passes (
      id TEXT PRIMARY KEY, mission_id TEXT, search_area_id TEXT, assignment_id TEXT,
      started_at TEXT, ended_at TEXT, outcome TEXT, notes TEXT, coordinator_name TEXT,
      advisory_coverage_json TEXT, version_sequence INTEGER, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE search_pass_evidence_links (
      pass_id TEXT, version_sequence INTEGER, link_kind TEXT, target_id TEXT
    );
    CREATE TABLE mission_replay_generations (
      mission_id TEXT PRIMARY KEY, generation INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX idx_search_pass_links
      ON search_pass_evidence_links(pass_id, version_sequence, link_kind, target_id);
  `)
  return database
}
