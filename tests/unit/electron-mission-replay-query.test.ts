import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (path: string) => {
  exec(sql: string): void
  prepare(sql: string): { run(...params: readonly unknown[]): unknown }
}
const { readMissionReplayState, readMissionReplayTrackChunk } = require(
  '../../electron/mission-replay-query.cjs',
) as {
  readMissionReplayState(database: InstanceType<typeof Database>, input: ReplayInput): ReplayState
  readMissionReplayTrackChunk(database: InstanceType<typeof Database>, input: ReplayInput & { cursor?: string }): ReplayChunk
}

type ReplayInput = { readonly missionId: string; readonly selectedTime: string; readonly trackLimit: number }
type ReplayState = {
  readonly objects: readonly { readonly object_type: string; readonly object_id: string; readonly state: Record<string, unknown> }[]
  readonly tracks: readonly { readonly evidence_id: string; readonly effective_at: string; readonly recorded_at: string; readonly source_type: string }[]
  readonly staticGpxPointCount: number
  readonly limitations: readonly { readonly code: string }[]
  readonly nextCursor: string | null
  readonly missionLifecycle: { readonly event_type: string } | null
  readonly participants: readonly { readonly id: string }[]
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
    db.prepare("INSERT INTO mission_events VALUES ('event-1', 'mission-1', 'mission_created', '2026-08-27T08:00:00Z', NULL)").run()
    db.prepare("INSERT INTO mission_events VALUES ('event-2', 'mission-1', 'mission_paused', '2026-08-27T08:09:00Z', NULL)").run()
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
    CREATE TABLE gpx_track_imports (id TEXT, mission_id TEXT, retired_at TEXT);
    CREATE TABLE gpx_import_revisions (
      import_id TEXT, mission_id TEXT, revision_sequence INTEGER, recorded_at TEXT,
      timing_class TEXT, completeness TEXT
    );
    CREATE TABLE gpx_evidence_points (
      import_id TEXT, revision_sequence INTEGER, segment_index INTEGER, point_index INTEGER,
      lat REAL, lon REAL, elevation REAL, source_time TEXT
    );
    CREATE TABLE mission_events (id TEXT, mission_id TEXT, event_type TEXT, timestamp TEXT, details_json TEXT);
    CREATE TABLE mission_participants (
      id TEXT, mission_id TEXT, kind TEXT, traccar_device_id TEXT, mission_team_id TEXT,
      provenance TEXT, effective_from TEXT, added_at TEXT, added_by TEXT, removed_at TEXT, removed_by TEXT
    );
    CREATE TABLE mission_group_membership_events (
      id TEXT, sequence INTEGER, mission_id TEXT, mission_team_id TEXT,
      traccar_device_id TEXT, change TEXT, observed_at TEXT
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
  db.prepare(`INSERT INTO gpx_import_revisions VALUES (
    'gpx-1', 'mission-1', 1, '2026-08-27T08:04:00Z', 'partially_dated', 'complete'
  )`).run()
  db.prepare(`INSERT INTO gpx_evidence_points VALUES
    ('gpx-1', 1, 0, 0, 52, -9.7, 100, '2026-08-27T08:01:30Z'),
    ('gpx-1', 1, 0, 1, 52.1, -9.8, NULL, NULL)`).run()
}
