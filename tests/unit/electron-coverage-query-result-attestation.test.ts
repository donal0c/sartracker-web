import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const {
  assertCoverageManifestOutings,
  readCoverageQueryResultLimits,
} = require('../../electron/coverage-query-result-attestation.cjs') as {
  readonly assertCoverageManifestOutings: (
    database: InstanceType<typeof Database>,
    missionId: string,
    outings: readonly Readonly<Record<string, unknown>>[],
  ) => void
  readonly readCoverageQueryResultLimits: (
    database: InstanceType<typeof Database>,
    query: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, number>>
}

let database: InstanceType<typeof Database> | undefined

afterEach(() => {
  database?.close()
  database = undefined
})

describe('coverage query result attestation', () => {
  it('derives cardinality from canonical outings and device inventory', () => {
    database = createMetadataDatabase()

    expect(readCoverageQueryResultLimits(database, {
      kind: 'manifest', missionId: 'mission-1',
    })).toEqual({ maxChunks: 2, maxOutings: 1 })
    expect(readCoverageQueryResultLimits(database, {
      kind: 'invalidation-analysis', invalidationId: 'invalidation-1',
    })).toEqual({ maxAffectedKeys: 3 })
  })

  it('requires every manifest outing field to equal canonical SQLite metadata', () => {
    database = createMetadataDatabase()
    const canonical = [{
      id: 'outing-1',
      label: 'Canonical outing',
      started_at: '2026-08-24T10:00:00.000Z',
      ended_at: '2026-08-24T11:00:00.000Z',
    }]

    expect(() => assertCoverageManifestOutings(database!, 'mission-1', canonical))
      .not.toThrow()
    expect(() => assertCoverageManifestOutings(database!, 'mission-1', [{
      ...canonical[0], label: 'Altered outing',
    }])).toThrow(/diverged from canonical metadata/iu)
  })
})

function createMetadataDatabase(): InstanceType<typeof Database> {
  const result = new Database(':memory:')
  result.exec(`
    CREATE TABLE outings (
      id TEXT PRIMARY KEY, mission_id TEXT, label TEXT,
      started_at TEXT, ended_at TEXT
    );
    CREATE TABLE devices (mission_id TEXT, device_id TEXT);
    CREATE TABLE mission_participants (
      mission_id TEXT, kind TEXT, removed_at TEXT,
      traccar_device_id TEXT, mission_team_id TEXT
    );
    CREATE TABLE mission_group_membership_events (
      mission_id TEXT, mission_team_id TEXT, traccar_device_id TEXT,
      change TEXT, observed_at TEXT, sequence INTEGER
    );
    CREATE TABLE coverage_invalidations (
      id TEXT PRIMARY KEY, mission_id TEXT, drained_at TEXT
    );
    INSERT INTO outings VALUES (
      'outing-1', 'mission-1', 'Canonical outing',
      '2026-08-24T10:00:00.000Z', '2026-08-24T11:00:00.000Z'
    );
    INSERT INTO devices VALUES ('mission-1', 'device-1');
    INSERT INTO coverage_invalidations VALUES (
      'invalidation-1', 'mission-1', NULL
    );
  `)
  return result
}
