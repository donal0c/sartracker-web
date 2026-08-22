import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { readMissionReviewSummary } = require(
  '../../electron/mission-review-read-query.cjs',
) as {
  readonly readMissionReviewSummary: (
    database: unknown,
    input: {
      readonly missionId: string
      readonly includeTelemetry: boolean
      readonly auditLimit: number
    },
  ) => {
    readonly auditEvents: readonly { readonly id: string; readonly event_type: string }[]
    readonly breadcrumbCount: number
  }
}

describe('mission-review read query [DON-251]', () => {
  it('returns an exact bounded newest-first audit page and scalar breadcrumb count', () => {
    const database = createDatabase()
    seedPositionRows(database, 12_345)
    const insertEvent = database.prepare(`
      INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
      VALUES (?, 'mission-1', ?, ?, NULL)
    `)
    insertEvent.run('older', 'mission_created', '2026-08-20T08:00:00.000Z')
    insertEvent.run('tie-first', 'marker_created', '2026-08-20T09:00:00.000Z')
    insertEvent.run('telemetry', 'position_recorded', '2026-08-20T10:00:00.000Z')
    insertEvent.run('tie-second', 'drawing_created', '2026-08-20T09:00:00.000Z')

    const result = readMissionReviewSummary(database, {
      missionId: 'mission-1',
      includeTelemetry: false,
      auditLimit: 2,
    })

    expect(result.breadcrumbCount).toBe(12_345)
    expect(result.auditEvents.map((event) => event.id)).toEqual([
      'tie-second',
      'tie-first',
    ])
    expect(result.auditEvents).toHaveLength(2)
    database.close()
  })

  it('preserves the telemetry toggle and timestamp/rowid tie-breaking', () => {
    const database = createDatabase()
    const insertEvent = database.prepare(`
      INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
      VALUES (?, 'mission-1', ?, '2026-08-20T10:00:00.000Z', NULL)
    `)
    insertEvent.run('telemetry-first', 'position_recorded')
    insertEvent.run('operator-middle', 'marker_created')
    insertEvent.run('telemetry-last', 'device_updated')

    const result = readMissionReviewSummary(database, {
      missionId: 'mission-1',
      includeTelemetry: true,
      auditLimit: 3,
    })

    expect(result.auditEvents.map((event) => event.id)).toEqual([
      'telemetry-last',
      'operator-middle',
      'telemetry-first',
    ])
    database.close()
  })

  it('reads audit and count from one WAL snapshot during a concurrent commit', () => {
    const fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'mission-review-snapshot-'))
    const databasePath = path.join(fixtureDirectory, 'fixture.sqlite')
    const writer = createDatabase(databasePath)
    const reader = new Database(databasePath)
    writer.pragma('journal_mode = WAL')
    reader.pragma('journal_mode = WAL')
    seedPositionRows(writer, 1)
    writer.prepare(`
      INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
      VALUES ('initial-event', 'mission-1', 'mission_created', '2026-08-20T08:00:00.000Z', NULL)
    `).run()
    let committedDuringRead = false
    const instrumentedReader = {
      prepare: (query: string) => {
        const statement = reader.prepare(query)
        if (!query.includes('FROM mission_events')) {
          return statement
        }
        return {
          all: (...parameters: readonly unknown[]) => {
            const rows = statement.all(...parameters)
            writer.prepare(`
              INSERT INTO positions (id, mission_id, device_id, timestamp)
              VALUES ('concurrent-position', 'mission-1', 'device-1', '2026-08-20T09:00:00.000Z')
            `).run()
            committedDuringRead = true
            return rows
          },
        }
      },
      transaction: (callback: () => unknown) => reader.transaction(callback),
    }

    const result = readMissionReviewSummary(instrumentedReader, {
      missionId: 'mission-1',
      includeTelemetry: false,
      auditLimit: 10,
    })

    expect(committedDuringRead).toBe(true)
    expect(result.breadcrumbCount).toBe(1)
    expect(writer.prepare('SELECT COUNT(*) FROM positions').pluck().get()).toBe(2)
    reader.close()
    writer.close()
    rmSync(fixtureDirectory, { recursive: true, force: true })
  })

  it('rejects malformed or unbounded query inputs', () => {
    const database = createDatabase()

    for (const input of [
      { missionId: '', includeTelemetry: false, auditLimit: 1 },
      { missionId: 'mission-1', includeTelemetry: false, auditLimit: 0 },
      { missionId: 'mission-1', includeTelemetry: false, auditLimit: 5_002 },
      { missionId: 'mission-1', includeTelemetry: 'yes', auditLimit: 1 },
    ]) {
      expect(() => readMissionReviewSummary(database, input as never)).toThrow()
    }
    database.close()
  })
})

function createDatabase(filePath = ':memory:') {
  const database = new Database(filePath)
  database.exec(`
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_positions_mission_device_timestamp
      ON positions(mission_id, device_id, timestamp);
    CREATE TABLE IF NOT EXISTS mission_events (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details_json TEXT
    );
  `)
  return database
}

function seedPositionRows(database: ReturnType<typeof createDatabase>, count: number): void {
  const insert = database.prepare(`
    INSERT INTO positions (id, mission_id, device_id, timestamp)
    VALUES (?, 'mission-1', 'device-1', ?)
  `)
  database.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      insert.run(`position-${index}`, new Date(Date.UTC(2026, 7, 20, 8, 0, index)).toISOString())
    }
  })()
}
