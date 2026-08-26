import { createRequire } from 'node:module'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const DatabaseConstructor = require('better-sqlite3')
const { assertCoverageQueryPlans } = require(
  '../../electron/coverage-query-plan.cjs',
) as {
  readonly assertCoverageQueryPlans: (
    database: Database,
    input: { readonly missionId: string; readonly deviceId: string; readonly outingId: string },
  ) => Readonly<Record<'outing' | 'unassigned' | 'invalidationRange', readonly string[]>>
}

type Database = {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => {
    readonly all: (...params: unknown[]) => readonly { readonly detail: string }[]
    readonly get: (...params: unknown[]) => Record<string, unknown> | undefined
    readonly source: string
  }
  readonly close: () => void
}

describe('Electron coverage query plans', () => {
  let database: Database

  beforeEach(() => {
    database = new DatabaseConstructor(':memory:')
    database.exec(`
      CREATE TABLE positions (
        id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, device_id TEXT NOT NULL,
        source_position_id TEXT, timestamp TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL
      );
      CREATE INDEX idx_positions_mission_device_timestamp
        ON positions(mission_id, device_id, timestamp);
      CREATE TABLE outings (
        id TEXT PRIMARY KEY, mission_id TEXT NOT NULL,
        started_at TEXT NOT NULL, ended_at TEXT
      );
      CREATE INDEX idx_outings_mission_started ON outings(mission_id, started_at);
      INSERT INTO outings VALUES (
        'outing-1', 'mission-1', '2026-08-24T10:00:00.000Z', '2026-08-24T11:00:00.000Z'
      );
    `)
  })

  afterEach(() => database.close())

  it('uses the mission-device-timestamp index without a positions full scan', () => {
    const plans = assertCoverageQueryPlans(database, {
      missionId: 'mission-1', deviceId: 'device-1', outingId: 'outing-1',
    })

    for (const details of Object.values(plans)) {
      expect(details.some((detail) =>
        detail.includes('idx_positions_mission_device_timestamp'))).toBe(true)
      expect(details.some((detail) => /SCAN (?:TABLE )?position(?:s)?(?:\s|$)/iu.test(detail))).toBe(false)
    }
  })

  it('fails loudly if the required index is absent', () => {
    database.exec('DROP INDEX idx_positions_mission_device_timestamp')

    expect(() => assertCoverageQueryPlans(database, {
      missionId: 'mission-1', deviceId: 'device-1', outingId: 'outing-1',
    })).toThrow(/coverage query plan.*positions index/iu)
  })
})
