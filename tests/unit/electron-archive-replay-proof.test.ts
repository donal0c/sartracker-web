import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => {
    readonly close: () => void
  }
}
const { computeMissionReplaySemanticProof } = require(
  '../../electron/archive-replay-proof.cjs',
) as {
  readonly computeMissionReplaySemanticProof: (
    db: BetterSqliteDatabase,
    input: Readonly<Record<string, unknown>>,
  ) => {
    readonly proof_version: number
    readonly sample_count: number
    readonly sample_strategy: string
    readonly samples: readonly {
      readonly semantic_sha256: string
      readonly sampled_outing_filter_count?: number
      readonly sampled_object_count: number
      readonly sampled_track_count: number
      readonly total_outing_filter_count?: number
      readonly total_object_count: number
      readonly total_track_count: number
    }[]
  }
}

type BetterSqliteDatabase = {
  readonly exec: (sql: string) => unknown
  readonly prepare: (sql: string) => {
    readonly run: (...parameters: readonly unknown[]) => unknown
  }
  readonly close: () => void
}

const temporaryDirectories = new Set<string>()

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

/** Creates a production-schema replay fixture requiring at least five pages of each row kind. */
function createFixture() {
  const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-replay-proof-'))
  temporaryDirectories.add(userDataPath)
  const store = createElectronMissionStore({ userDataPath })
  store.close()
  const db = new Database(path.join(userDataPath, 'mission-store.sqlite')) as BetterSqliteDatabase
  db.prepare(`INSERT INTO missions (
    id, name, status, start_time, finish_time, paused_seconds, schema_version
  ) VALUES ('mission-a', 'Mission A', 'finished', ?, ?, 0, 13)`).run(
    '2026-08-29T10:00:00.000Z',
    '2026-08-29T12:00:00.000Z',
  )
  db.prepare(`INSERT INTO devices (
    id, mission_id, device_id, name, color, status
  ) VALUES ('device-row', 'mission-a', 'device-a', 'Device A', '#123456', 'online')`).run()
  const insertPosition = db.prepare(`INSERT INTO positions (
    id, mission_id, device_id, lat, lon, timestamp, data_origin, received_at,
    source_kind, timestamp_source, timestamp_provenance_recorded_at
  ) VALUES (?, 'mission-a', 'device-a', 52, -9.7, ?, 'live', ?, 'traccar', 'fix', ?)`)
  for (let index = 0; index < 321; index += 1) {
    const timestamp = new Date(Date.parse('2026-08-29T10:00:00.000Z') + index * 10_000)
      .toISOString()
    insertPosition.run(`position-${String(index).padStart(4, '0')}`, timestamp, timestamp, timestamp)
  }
  const insertObject = db.prepare(`INSERT INTO mission_object_versions (
    id, mission_id, object_type, object_id, version_sequence, operation,
    effective_at, recorded_at, completeness, state_json
  ) VALUES (?, 'mission-a', 'marker', ?, 1, 'created', ?, ?, 'complete', ?)`)
  for (let index = 0; index < 129; index += 1) {
    insertObject.run(
      `version-${index}`,
      `marker-${index}`,
      '2026-08-29T10:10:00.000Z',
      '2026-08-29T10:10:00.000Z',
      JSON.stringify({ id: `marker-${index}`, type: 'Clue' }),
    )
  }
  const requestEventId = '33333333-3333-4333-8333-333333333333'
  db.prepare(`INSERT INTO mission_events (
    rowid, id, mission_id, event_type, timestamp, details_json,
    recorded_at, recording_completeness
  ) VALUES (42, ?, 'mission-a', 'mission_finalize_requested', ?, '{}', ?, 'complete')`).run(
    requestEventId,
    '2026-08-29T14:00:00.000Z',
    '2026-08-29T14:00:00.000Z',
  )
  db.prepare(`INSERT INTO mission_replay_generations (mission_id, generation)
    VALUES ('mission-a', 1) ON CONFLICT(mission_id) DO UPDATE SET generation = 1`).run()
  return { db, requestEventId }
}

describe('archive replay semantic proof', () => {
  it('exhausts every track and object page for all five deterministic samples', () => {
    const fixture = createFixture()
    const input = {
      missionId: 'mission-a',
      requestEventId: fixture.requestEventId,
      archiveKind: 'finalized',
    }
    const canonical = computeMissionReplaySemanticProof(fixture.db, input)

    expect(canonical.sample_count).toBe(5)
    expect(canonical.samples.every((sample) =>
      sample.sampled_track_count === sample.total_track_count)).toBe(true)
    expect(canonical.samples.every((sample) =>
      sample.sampled_object_count === sample.total_object_count)).toBe(true)
    expect(canonical.samples.some((sample) => sample.sampled_track_count === 321)).toBe(true)
    expect(canonical.samples.some((sample) => sample.sampled_object_count === 129)).toBe(true)

    fixture.db.prepare(`UPDATE mission_replay_generations SET generation = 37
      WHERE mission_id = 'mission-a'`).run()
    fixture.db.exec(`
      DROP INDEX idx_mission_events_replay;
      DROP INDEX idx_positions_replay_known_at;
      DROP INDEX idx_positions_replay_device_known_at;
    `)
    expect(computeMissionReplaySemanticProof(fixture.db, input)).toEqual(canonical)
    fixture.db.close()
  })

  it('reports bounded page work without changing the replay-semantic proof', () => {
    const fixture = createFixture()
    const input = {
      missionId: 'mission-a',
      requestEventId: fixture.requestEventId,
      archiveKind: 'finalized',
    }
    const expected = computeMissionReplaySemanticProof(fixture.db, input)
    const rowsProcessed: number[] = []
    const observed = computeMissionReplaySemanticProof(fixture.db, {
      ...input,
      onProgress: (progress: { readonly rowsProcessed: number }) => {
        rowsProcessed.push(progress.rowsProcessed)
      },
    })

    expect(observed).toEqual(expected)
    expect(rowsProcessed.length).toBeGreaterThan(expected.sample_count * 2)
    expect(rowsProcessed[0]).toBeGreaterThan(0)
    expect(rowsProcessed.every((value, index) =>
      index === 0 || value > rowsProcessed[index - 1]!)).toBe(true)
  })

  it.each([
    {
      rowKind: 'track',
      state: {
        objects: [],
        tracks: [{ id: 'track-initial' }],
        nextCursor: 'repeated-track-cursor',
        nextObjectCursor: null,
        totalTrackCount: 3,
        totalObjectCount: 0,
      },
      trackPage: {
        tracks: [{ id: 'track-continuation' }],
        nextCursor: 'repeated-track-cursor',
      },
      objectPage: { objects: [], nextObjectCursor: null },
    },
    {
      rowKind: 'object',
      state: {
        objects: [{ id: 'object-initial' }],
        tracks: [],
        nextCursor: null,
        nextObjectCursor: 'repeated-object-cursor',
        totalTrackCount: 0,
        totalObjectCount: 3,
      },
      trackPage: { tracks: [], nextCursor: null },
      objectPage: {
        objects: [{ id: 'object-continuation' }],
        nextObjectCursor: 'repeated-object-cursor',
      },
    },
  ])('rejects a repeated $rowKind cursor instead of looping or accepting a partial proof', ({
    state,
    trackPage,
    objectPage,
  }) => {
    const loaded = loadReplayProofWithQueries({
      readMissionReplayState: () => replayState(state),
      readMissionReplayTrackChunk: () => trackPage,
      readMissionReplayObjectChunk: () => objectPage,
    })
    try {
      expect(() => loaded.computeMissionReplaySemanticProof(
        createReplayDatabaseStub(),
        replayProofInput,
      )).toThrow(expect.objectContaining({
        name: 'ArchiveReplayProofError',
        code: 'ARCHIVE_REPLAY_CURSOR_CYCLE',
      }))
    } finally {
      loaded.restore()
    }
  })

  it.each([
    {
      rowKind: 'track',
      state: {
        objects: [],
        tracks: [{ id: 'only-track' }],
        nextCursor: null,
        nextObjectCursor: null,
        totalTrackCount: 2,
        totalObjectCount: 0,
      },
    },
    {
      rowKind: 'object',
      state: {
        objects: [{ id: 'only-object' }],
        tracks: [],
        nextCursor: null,
        nextObjectCursor: null,
        totalTrackCount: 0,
        totalObjectCount: 2,
      },
    },
  ])('rejects a completed $rowKind page chain whose observed count differs from its declared total', ({
    state,
  }) => {
    const loaded = loadReplayProofWithQueries({
      readMissionReplayState: () => replayState(state),
    })
    try {
      expect(() => loaded.computeMissionReplaySemanticProof(
        createReplayDatabaseStub(),
        replayProofInput,
      )).toThrow(expect.objectContaining({
        name: 'ArchiveReplayProofError',
        code: 'ARCHIVE_REPLAY_TOTAL_MISMATCH',
      }))
    } finally {
      loaded.restore()
    }
  })

  it('uses the frozen direct/recovery request-event contract without weakening finalization', () => {
    const fixture = createFixture()
    fixture.db.prepare(`UPDATE mission_events SET event_type = 'mission_archive_requested'
      WHERE id = ?`).run(fixture.requestEventId)

    for (const archiveKind of ['direct', 'finalized_recovery']) {
      expect(computeMissionReplaySemanticProof(fixture.db, {
        missionId: 'mission-a',
        requestEventId: fixture.requestEventId,
        archiveKind,
      }).sample_count).toBe(5)
    }
    expect(() => computeMissionReplaySemanticProof(fixture.db, {
      missionId: 'mission-a',
      requestEventId: fixture.requestEventId,
      archiveKind: 'finalized',
    })).toThrow(/request event/iu)
    fixture.db.close()
  })

  it('exhausts every production outing-filter choice page and records exact counts', () => {
    const fixture = createFixture()
    insertReplayOutingChoices(fixture.db, 201)

    const proof = computeMissionReplaySemanticProof(fixture.db, {
      missionId: 'mission-a',
      requestEventId: fixture.requestEventId,
      archiveKind: 'finalized',
    })

    expect(proof.samples.every((sample) =>
      sample.sampled_outing_filter_count === 201
      && sample.sampled_outing_filter_count === sample.total_outing_filter_count)).toBe(true)
    expect(proof.proof_version).toBe(3)
    expect(proof.sample_strategy)
      .toBe('mission-start-finish-fence-midpoints-exhaustive-pages-and-outing-filters-v3')
    fixture.db.close()
  })

  it('binds later outing-filter page IDs into the deterministic semantic digest', () => {
    const fixture = createFixture()
    insertReplayOutingChoices(fixture.db, 201)
    const input = {
      missionId: 'mission-a',
      requestEventId: fixture.requestEventId,
      archiveKind: 'finalized',
    }
    const canonical = computeMissionReplaySemanticProof(fixture.db, input)

    insertReplayOuting(fixture.db, 'outing-zzz')
    fixture.db.prepare(`UPDATE gpx_import_revisions SET outing_id = 'outing-zzz'
      WHERE mission_id = 'mission-a' AND outing_id = 'outing-200'`).run()

    const changed = computeMissionReplaySemanticProof(fixture.db, input)
    expect(changed.samples.map((sample) => sample.semantic_sha256))
      .not.toEqual(canonical.samples.map((sample) => sample.semantic_sha256))
    fixture.db.close()
  })

  it('keeps exhaustive outing-filter evidence insensitive to replay-generation cursor rotation', () => {
    const fixture = createFixture()
    insertReplayOutingChoices(fixture.db, 201)
    const input = {
      missionId: 'mission-a',
      requestEventId: fixture.requestEventId,
      archiveKind: 'finalized',
    }
    const canonical = computeMissionReplaySemanticProof(fixture.db, input)

    fixture.db.prepare(`UPDATE mission_replay_generations SET generation = 37
      WHERE mission_id = 'mission-a'`).run()

    expect(computeMissionReplaySemanticProof(fixture.db, input)).toEqual(canonical)
    fixture.db.close()
  })

  it('rejects a repeated outing-filter cursor instead of accepting partial choice evidence', () => {
    const loaded = loadReplayProofWithQueries({
      readMissionReplayState: () => replayState({
        objects: [],
        tracks: [],
        nextCursor: null,
        nextObjectCursor: null,
        totalTrackCount: 0,
        totalObjectCount: 0,
        availableOutingIds: ['outing-000'],
        availableOutingTotalCount: 3,
        availableOutingNextCursor: 'repeated-outing-cursor',
      }),
      readMissionReplayFilterPage: () => ({
        filterKind: 'outing',
        search: '',
        entries: ['outing-001'],
        totalCount: 3,
        nextCursor: 'repeated-outing-cursor',
      }),
    })
    try {
      expect(() => loaded.computeMissionReplaySemanticProof(
        createReplayDatabaseStub(),
        replayProofInput,
      )).toThrow(expect.objectContaining({
        name: 'ArchiveReplayProofError',
        code: 'ARCHIVE_REPLAY_CURSOR_CYCLE',
      }))
    } finally {
      loaded.restore()
    }
  })

  it('rejects an outing-filter page chain that terminates before its declared total', () => {
    const loaded = loadReplayProofWithQueries({
      readMissionReplayState: () => replayState({
        objects: [],
        tracks: [],
        nextCursor: null,
        nextObjectCursor: null,
        totalTrackCount: 0,
        totalObjectCount: 0,
        availableOutingIds: ['outing-000'],
        availableOutingTotalCount: 2,
        availableOutingNextCursor: null,
      }),
    })
    try {
      expect(() => loaded.computeMissionReplaySemanticProof(
        createReplayDatabaseStub(),
        replayProofInput,
      )).toThrow(expect.objectContaining({
        name: 'ArchiveReplayProofError',
        code: 'ARCHIVE_REPLAY_TOTAL_MISMATCH',
      }))
    } finally {
      loaded.restore()
    }
  })
})

/** Adds one persisted outing row accepted by the production GPX revision foreign key. */
function insertReplayOuting(db: BetterSqliteDatabase, outingId: string) {
  db.prepare(`INSERT INTO outings (
    id, mission_id, label, started_at, ended_at, created_at, updated_at
  ) VALUES (?, 'mission-a', ?, '2026-08-29T08:00:00.000Z',
    '2026-08-29T08:30:00.000Z', '2026-08-29T08:00:00.000Z',
    '2026-08-29T08:30:00.000Z')`).run(outingId, outingId)
}

/** Adds many eligible GPX revisions so production Replay must use every outing-choice page. */
function insertReplayOutingChoices(db: BetterSqliteDatabase, count: number) {
  const insertImport = db.prepare(`INSERT INTO gpx_track_imports (
    id, mission_id, source_path, file_name, display_name, geometry_json,
    timing_class, import_state, revision_sequence, imported_at, updated_at
  ) VALUES (?, 'mission-a', ?, ?, ?, '{"type":"LineString","coordinates":[]}',
    'fully_dated', 'complete', 1, '2026-08-29T09:59:00.000Z',
    '2026-08-29T09:59:00.000Z')`)
  const insertRevision = db.prepare(`INSERT INTO gpx_import_revisions (
    id, mission_id, import_id, revision_sequence, source_revision_sequence,
    source_path, file_name, display_name, geometry_json, timing_class, outing_id,
    import_state, completeness, recorded_at
  ) VALUES (?, 'mission-a', ?, 1, 1, ?, ?, ?,
    '{"type":"LineString","coordinates":[]}', 'fully_dated', ?, 'complete',
    'complete', '2026-08-29T09:59:00.000Z')`)
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index).padStart(3, '0')
    const outingId = `outing-${suffix}`
    const importId = `gpx-${suffix}`
    const sourcePath = `/fixture/${importId}.gpx`
    insertReplayOuting(db, outingId)
    insertImport.run(importId, sourcePath, `${importId}.gpx`, importId)
    insertRevision.run(
      `revision-${suffix}`,
      importId,
      sourcePath,
      `${importId}.gpx`,
      importId,
      outingId,
    )
  }
}

const replayProofInput = Object.freeze({
  missionId: 'mission-a',
  requestEventId: '33333333-3333-4333-8333-333333333333',
  archiveKind: 'finalized',
})

/** Supplies the stable non-row fields consumed by semantic normalization. */
function replayState(rows: Readonly<Record<string, unknown>>) {
  return {
    missionId: 'mission-a',
    selectedTime: '2026-08-29T10:00:00.000Z',
    replayGeneration: 1,
    limitations: [],
    ...rows,
  }
}

/** Supplies the mission and request-event queries required by sample enumeration. */
function createReplayDatabaseStub() {
  return {
    prepare: (sql: string) => ({
      get: () => sql.includes('FROM missions')
        ? {
            start_time: '2026-08-29T10:00:00.000Z',
            finish_time: '2026-08-29T12:00:00.000Z',
          }
        : { timestamp: '2026-08-29T14:00:00.000Z' },
    }),
    transaction: (callback: () => unknown) => callback,
  }
}

/** Reloads the CJS proof module with controlled production-query continuations. */
function loadReplayProofWithQueries(overrides: Readonly<Record<string, unknown>>) {
  const queryPath = require.resolve('../../electron/mission-replay-query.cjs')
  const proofPath = require.resolve('../../electron/archive-replay-proof.cjs')
  const queryModule = require(queryPath) as Readonly<Record<string, unknown>>
  const queryCache = require.cache[queryPath]
  if (queryCache === undefined) throw new Error('Replay query module was not cached for attack testing.')
  queryCache.exports = { ...queryModule, ...overrides }
  delete require.cache[proofPath]
  const loaded = require(proofPath) as {
    readonly computeMissionReplaySemanticProof: (
      db: Readonly<Record<string, unknown>>,
      input: Readonly<Record<string, unknown>>,
    ) => unknown
  }
  return {
    ...loaded,
    restore: () => {
      queryCache.exports = queryModule
      delete require.cache[proofPath]
    },
  }
}
