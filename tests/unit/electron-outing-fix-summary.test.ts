import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { readOutingFixSummary } = require('../../electron/outing-fix-summary-query.cjs') as {
  readonly readOutingFixSummary: (
    database: ReturnType<typeof Database>,
    input: { readonly missionId: string },
  ) => {
    readonly outings: readonly { readonly outing_id: string; readonly accepted_fix_count: number }[]
    readonly unassigned_accepted_fix_count: number
    readonly total_accepted_fix_count: number
  }
}

describe('outing fix-summary query', () => {
  it('classifies exact boundary and gap fixes without inventing an outing', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE outings (id TEXT PRIMARY KEY, mission_id TEXT, started_at TEXT, ended_at TEXT);
      CREATE TABLE positions (id TEXT PRIMARY KEY, mission_id TEXT, timestamp TEXT);
      INSERT INTO outings VALUES
        ('outing-a', 'mission-1', '2026-08-20T09:00:00.000Z', '2026-08-20T11:00:00.000Z'),
        ('outing-b', 'mission-1', '2026-08-20T11:00:00.000Z', '2026-08-20T12:00:00.000Z');
      INSERT INTO positions VALUES
        ('before', 'mission-1', '2026-08-20T08:59:59.000Z'),
        ('a', 'mission-1', '2026-08-20T10:00:00.000Z'),
        ('boundary', 'mission-1', '2026-08-20T11:00:00.000Z'),
        ('after', 'mission-1', '2026-08-20T12:00:00.000Z');
    `)

    expect(readOutingFixSummary(database, { missionId: 'mission-1' })).toEqual({
      outings: [
        { outing_id: 'outing-a', accepted_fix_count: 1 },
        { outing_id: 'outing-b', accepted_fix_count: 1 },
      ],
      unassigned_accepted_fix_count: 2,
      total_accepted_fix_count: 4,
    })
    database.close()
  })

  it('returns all fixes as Unassigned for a legacy mission with no outings', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE outings (id TEXT PRIMARY KEY, mission_id TEXT, started_at TEXT, ended_at TEXT);
      CREATE TABLE positions (id TEXT PRIMARY KEY, mission_id TEXT, timestamp TEXT);
      INSERT INTO positions VALUES ('legacy', 'legacy-mission', '2026-08-20T10:00:00.000Z');
    `)

    expect(readOutingFixSummary(database, { missionId: 'legacy-mission' })).toEqual({
      outings: [],
      unassigned_accepted_fix_count: 1,
      total_accepted_fix_count: 1,
    })
    database.close()
  })
})
