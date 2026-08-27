import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (path: string) => {
  exec(sql: string): void
  prepare(sql: string): { run(...params: readonly unknown[]): unknown }
}
const { readMissionReplayState, readMissionReplayTrackChunk, readMissionReplayObjectChunk } = require(
  '../../electron/mission-replay-query.cjs',
) as {
  readMissionReplayState(database: InstanceType<typeof Database>, input: ReplayInput): ReplayState
  readMissionReplayTrackChunk(database: InstanceType<typeof Database>, input: ReplayInput & { cursor?: string }): ReplayChunk
  readMissionReplayObjectChunk(database: InstanceType<typeof Database>, input: ReplayInput & { objectCursor?: string }): {
    readonly objects: ReplayState['objects']
    readonly totalObjectCount: number
    readonly objectCursor: string
    readonly nextObjectCursor: string | null
  }
}

type ReplayInput = { readonly missionId: string; readonly selectedTime: string; readonly trackLimit: number; readonly objectLimit?: number }
type ReplayState = {
  readonly objects: readonly { readonly object_type: string; readonly object_id: string; readonly state: Record<string, unknown> }[]
  readonly tracks: readonly { readonly evidence_id: string; readonly effective_at: string; readonly recorded_at: string; readonly source_type: string }[]
  readonly staticGpxPointCount: number
  readonly limitations: readonly { readonly code: string }[]
  readonly nextCursor: string | null
  readonly missionLifecycle: { readonly event_type: string } | null
  readonly participants: readonly { readonly id: string }[]
  readonly groupMembership: readonly { readonly id: string }[]
  readonly totalObjectCount: number
  readonly objectCursor: string
  readonly nextObjectCursor: string | null
}
type ReplayChunk = { readonly tracks: ReplayState['tracks']; readonly nextCursor: string | null }

describe('mission replay query [DON-278]', () => {
  it('folds only evidence known by T and places late fixes by sole fixTime authority', () => {
    const db = createReplayDatabase()
    insertVersion(db, ['v1', 'marker-1', 1, '2026-08-27T08:00:00Z', '2026-08-27T08:00:01Z', 'Old'])
    insertVersion(db, ['v2', 'marker-1', 2, '2026-08-27T08:05:00Z', '2026-08-27T08:10:00Z', 'Corrected'])
    insertPosition(db, ['fix-early', '2026-08-27T08:02:00Z', '2026-08-27T08:03:00Z'])
    insertPosition(db, ['fix-late', '2026-08-27T08:01:00Z', '2026-08-27T08:11:00Z'])
    insertGpx(db)
    db.prepare("INSERT INTO mission_events VALUES ('event-1', 'mission-1', 'mission_created', '2026-08-27T08:00:00Z', NULL, '2026-08-27T08:00:01Z', 'complete')").run()
    db.prepare("INSERT INTO mission_events VALUES ('event-2', 'mission-1', 'mission_paused', '2026-08-27T08:09:00Z', NULL, '2026-08-27T08:09:01Z', 'complete')").run()
    db.prepare(`INSERT INTO mission_participants VALUES (
      'participant-1', 'mission-1', 'device', 'device-1', NULL, 'explicit',
      '2026-08-27T08:00:00Z', '2026-08-27T08:05:00Z', 'Coordinator', NULL, NULL
    )`).run()

    const beforeLateKnowledge = readMissionReplayState(db, {
      missionId: 'mission-1',
      selectedTime: '2026-08-27T08:06:00Z',
      trackLimit: 2,
    })
    expect(beforeLateKnowledge.objects[0]?.state).toMatchObject({ name: 'Old' })
    expect(beforeLateKnowledge.tracks.map((track) => track.evidence_id)).toEqual([
      'gpx-1:1:0:0',
      'fix-early',
    ])
    expect(beforeLateKnowledge.staticGpxPointCount).toBe(1)
    expect(beforeLateKnowledge.missionLifecycle).toMatchObject({ event_type: 'mission_created' })
    expect(beforeLateKnowledge.participants).toEqual([
      expect.objectContaining({ id: 'participant-1' }),
    ])
    expect(beforeLateKnowledge.limitations).toEqual([
      expect.objectContaining({ code: 'undated_gpx_static' }),
    ])

    const afterLateKnowledge = readMissionReplayTrackChunk(db, {
      missionId: 'mission-1',
      selectedTime: '2026-08-27T08:12:00Z',
      trackLimit: 2,
    })
    expect(afterLateKnowledge.tracks.map((track) => track.evidence_id)).toEqual([
      'fix-late',
      'gpx-1:1:0:0',
    ])
    expect(afterLateKnowledge.nextCursor).not.toBeNull()
  })

  it('surfaces a machine-readable gap before a legacy baseline', () => {
    const db = createReplayDatabase()
    db.prepare(`INSERT INTO mission_object_versions VALUES (
      ?, 'mission-1', 'drawing', 'drawing-1', 1, 'legacy_baseline', ?, ?,
      'legacy_baseline', ?, NULL, NULL, NULL
    )`).run(
      'legacy-1',
      '2026-08-27T09:00:00Z',
      '2026-08-27T09:00:00Z',
      '{"name":"Unknown earlier state"}',
    )
    const replay = readMissionReplayState(db, {
      missionId: 'mission-1', selectedTime: '2026-08-27T08:00:00Z', trackLimit: 100,
    })
    expect(replay.objects).toEqual([])
    expect(replay.limitations).toEqual([
      expect.objectContaining({ code: 'legacy_history_unknown_before_baseline' }),
    ])
  })

  it('matches the deterministic nine-outing reference oracle at sampled times', () => {
    const db = createReplayDatabase()
    for (let index = 1; index <= 9; index += 1) {
      const hour = String(index).padStart(2, '0')
      db.prepare(`INSERT INTO mission_object_versions VALUES (
        ?, 'mission-1', 'outing', ?, 1, 'created', ?, ?, 'complete', ?, NULL, NULL, NULL
      )`).run(
        `outing-version-${index}`,
        `outing-${index}`,
        `2026-08-27T${hour}:00:00Z`,
        `2026-08-27T${hour}:00:01Z`,
        JSON.stringify({ id: `outing-${index}`, label: `Operational period ${index}` }),
      )
    }
    const sampled = readMissionReplayState(db, {
      missionId: 'mission-1', selectedTime: '2026-08-27T05:30:00Z', trackLimit: 100,
    })
    expect(sampled.objects.map((entry) => entry.object_id)).toEqual([
      'outing-1', 'outing-2', 'outing-3', 'outing-4', 'outing-5',
    ])
    const complete = readMissionReplayState(db, {
      missionId: 'mission-1', selectedTime: '2026-08-27T10:00:00Z', trackLimit: 100,
    })
    expect(complete.objects).toHaveLength(9)
  })

  it('surfaces every retained unproved or missing-recorded-time position as an explicit limitation', () => {
    const db = createReplayDatabase()
    db.prepare(`INSERT INTO positions VALUES
      ('legacy', 'mission-1', 'device-1', 52, -9.7, NULL, 5, '2026-08-27T08:00:00Z', NULL, NULL),
      ('missing-receipt', 'mission-1', 'device-1', 52, -9.7, NULL, 5, '2026-08-27T08:01:00Z', NULL, 'fix')`).run()
    const replay = readMissionReplayState(db, {
      missionId: 'mission-1', selectedTime: '2026-08-27T09:00:00Z', trackLimit: 100,
    })

    expect(replay.totalTrackCount).toBe(0)
    expect(replay.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'position_time_authority_unproved', count: 1 }),
      expect.objectContaining({ code: 'position_recorded_time_missing', count: 1 }),
    ]))
  })

  it('uses recorded time as the eligibility fence for lifecycle and group membership', () => {
    const db = createReplayDatabase()
    db.prepare(`INSERT INTO mission_events VALUES (
      'late-created', 'mission-1', 'mission_created', '2026-08-27T07:00:00Z', NULL,
      '2026-08-27T08:10:00Z', 'complete'
    )`).run()
    db.prepare(`INSERT INTO mission_group_membership_events VALUES (
      'late-member', 1, 'mission-1', 'team-1', 'device-1', 'member',
      '2026-08-27T07:30:00Z', '2026-08-27T08:10:00Z', 'complete'
    )`).run()

    const beforeReceipt = readMissionReplayState(db, {
      missionId: 'mission-1', selectedTime: '2026-08-27T08:05:00Z', trackLimit: 100,
    })
    expect(beforeReceipt.missionLifecycle).toBeNull()
    expect(beforeReceipt.groupMembership).toEqual([])

    const afterReceipt = readMissionReplayState(db, {
      missionId: 'mission-1', selectedTime: '2026-08-27T08:11:00Z', trackLimit: 100,
    })
    expect(afterReceipt.missionLifecycle).toMatchObject({ event_type: 'mission_created' })
    expect(afterReceipt.groupMembership).toEqual([
      expect.objectContaining({ id: 'late-member' }),
    ])
  })

  it('pages reconstructed objects without hiding later evidence or sending unbounded state', () => {
    const db = createReplayDatabase()
    for (let index = 0; index < 205; index += 1) {
      insertVersion(db, [
        `version-${index}`, `marker-${String(index).padStart(3, '0')}`, 1,
        '2026-08-27T08:00:00Z', '2026-08-27T08:00:01Z',
        `${'x'.repeat(50_000)}-${index}`,
      ])
    }
    const first = readMissionReplayState(db, {
      missionId: 'mission-1', selectedTime: '2026-08-27T09:00:00Z',
      trackLimit: 100, objectLimit: 100,
    })
    expect(first.objects).toHaveLength(100)
    expect(first.totalObjectCount).toBe(205)
    expect(first.nextObjectCursor).toBe('100')
    expect(Buffer.byteLength(JSON.stringify(first.objects))).toBeLessThan(600_000)

    const final = readMissionReplayObjectChunk(db, {
      missionId: 'mission-1', selectedTime: '2026-08-27T09:00:00Z',
      trackLimit: 100, objectLimit: 100, objectCursor: '200',
    })
    expect(final.objects).toHaveLength(5)
    expect(final.objectCursor).toBe('200')
    expect(final.nextObjectCursor).toBeNull()
  })
})

function createReplayDatabase(): InstanceType<typeof Database> {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE mission_object_versions (
      id TEXT, mission_id TEXT, object_type TEXT, object_id TEXT, version_sequence INTEGER,
      operation TEXT, effective_at TEXT, recorded_at TEXT, completeness TEXT,
      state_json TEXT, actor TEXT, correlation_id TEXT, audit_event_id TEXT
    );
    CREATE TABLE positions (
      id TEXT, mission_id TEXT, device_id TEXT, lat REAL, lon REAL, altitude REAL,
      accuracy REAL, timestamp TEXT, received_at TEXT, timestamp_source TEXT
    );
    CREATE INDEX idx_positions_mission_device_timestamp
      ON positions(mission_id, device_id, timestamp);
    CREATE TABLE gpx_track_imports (id TEXT, mission_id TEXT, retired_at TEXT);
    CREATE TABLE gpx_import_revisions (
      import_id TEXT, mission_id TEXT, revision_sequence INTEGER, recorded_at TEXT,
      source_path TEXT, file_name TEXT, display_name TEXT, content_sha256 TEXT,
      timing_class TEXT, outing_id TEXT, completeness TEXT, import_state TEXT
    );
    CREATE TABLE gpx_evidence_points (
      import_id TEXT, revision_sequence INTEGER, segment_index INTEGER, point_index INTEGER,
      lat REAL, lon REAL, elevation REAL, source_time TEXT
    );
    CREATE TABLE gpx_evidence_rejections (
      id TEXT, import_id TEXT, revision_sequence INTEGER, kind TEXT,
      segment_index INTEGER, point_index INTEGER, reason TEXT, source_value TEXT
    );
    CREATE TABLE mission_events (
      id TEXT, mission_id TEXT, event_type TEXT, timestamp TEXT, details_json TEXT,
      recorded_at TEXT, recording_completeness TEXT
    );
    CREATE TABLE mission_participants (
      id TEXT, mission_id TEXT, kind TEXT, traccar_device_id TEXT, mission_team_id TEXT,
      provenance TEXT, effective_from TEXT, added_at TEXT, added_by TEXT, removed_at TEXT, removed_by TEXT
    );
    CREATE TABLE mission_group_membership_events (
      id TEXT, sequence INTEGER, mission_id TEXT, mission_team_id TEXT,
      traccar_device_id TEXT, change TEXT, observed_at TEXT, recorded_at TEXT,
      recording_completeness TEXT
    );
  `)
  return db
}

function insertVersion(db: InstanceType<typeof Database>, values: readonly unknown[]): void {
  db.prepare(`INSERT INTO mission_object_versions VALUES (
    ?, 'mission-1', 'marker', ?, ?, 'updated', ?, ?, 'complete', ?, NULL, NULL, NULL
  )`).run(...values.slice(0, 5), JSON.stringify({ name: values[5] }))
}

function insertPosition(db: InstanceType<typeof Database>, values: readonly unknown[]): void {
  db.prepare(`INSERT INTO positions VALUES (
    ?, 'mission-1', 'device-1', 52, -9.7, NULL, 5, ?, ?, 'fix'
  )`).run(...values)
}

function insertGpx(db: InstanceType<typeof Database>): void {
  db.prepare("INSERT INTO gpx_track_imports VALUES ('gpx-1', 'mission-1', NULL)").run()
  db.prepare(`INSERT INTO gpx_import_revisions (
    import_id, mission_id, revision_sequence, recorded_at, source_path, file_name,
    display_name, content_sha256, timing_class, outing_id, completeness, import_state
  ) VALUES (
    'gpx-1', 'mission-1', 1, '2026-08-27T08:04:00Z', '/evidence.gpx',
    'evidence.gpx', 'Evidence', 'abc', 'partially_dated', NULL, 'complete', 'complete'
  )`).run()
  db.prepare(`INSERT INTO gpx_evidence_points VALUES
    ('gpx-1', 1, 0, 0, 52, -9.7, 100, '2026-08-27T08:01:30Z'),
    ('gpx-1', 1, 0, 1, 52.1, -9.8, NULL, NULL)`).run()
}
