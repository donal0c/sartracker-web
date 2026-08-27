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
  readonly objectTypeCounts: Readonly<Record<string, number>>
}
type ReplayChunk = {
  readonly tracks: ReplayState['tracks']
  readonly trackCursor: string
  readonly previousCursor: string | null
  readonly nextCursor: string | null
  readonly totalTrackCount: number
}

describe('mission replay query [DON-278]', () => {
  it('enumerates replay sources from bounded mission devices instead of scanning positions', () => {
    const db = createReplayDatabase()
    insertPosition(db, ['fix-1', '2026-08-27T08:02:00Z', '2026-08-27T08:03:00Z'])
    const preparedSql: string[] = []
    const instrumented = {
      prepare(sql: string) {
        preparedSql.push(sql.replace(/\s+/gu, ' ').trim())
        return db.prepare(sql)
      },
    } as unknown as InstanceType<typeof Database>

    readMissionReplayState(instrumented, {
      missionId: 'mission-1', selectedTime: '2026-08-27T09:00:00Z', trackLimit: 100,
    })

    expect(preparedSql.some((sql) => /SELECT DISTINCT device_id FROM positions/u.test(sql))).toBe(false)
    expect(preparedSql.some((sql) => /SELECT device_id FROM devices/u.test(sql))).toBe(true)
  })

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

  it('matches an independent nine-outing mixed-evidence oracle at sampled times', () => {
    const db = createReplayDatabase()
    const objectVersions: Array<{
      id: string; objectType: string; objectId: string; sequence: number
      effectiveAt: string; recordedAt: string; state: Record<string, unknown>
    }> = []
    for (let index = 1; index <= 9; index += 1) {
      const hour = String(index).padStart(2, '0')
      objectVersions.push({
        id: `outing-version-${index}`, objectType: 'outing', objectId: `outing-${index}`,
        sequence: 1, effectiveAt: `2026-08-27T${hour}:00:00Z`,
        recordedAt: `2026-08-27T${hour}:00:01Z`,
        state: { id: `outing-${index}`, label: `Operational period ${index}` },
      })
    }
    objectVersions.push(
      { id: 'area-v1', objectType: 'search_area', objectId: 'area-alpha', sequence: 1, effectiveAt: '2026-08-27T01:30:00Z', recordedAt: '2026-08-27T01:30:01Z', state: { name: 'Area Alpha', status: 'active' } },
      { id: 'assignment-v1', objectType: 'search_assignment', objectId: 'assignment-1', sequence: 1, effectiveAt: '2026-08-27T02:00:00Z', recordedAt: '2026-08-27T02:00:01Z', state: { search_area_id: 'area-alpha', outing_id: 'outing-1', team_id: 'team-red' } },
      { id: 'pass-v1', objectType: 'search_pass', objectId: 'pass-1', sequence: 1, effectiveAt: '2026-08-27T03:00:00Z', recordedAt: '2026-08-27T03:00:01Z', state: { search_area_id: 'area-alpha', assignment_id: 'assignment-1', outcome: 'partial' } },
      { id: 'assignment-v2', objectType: 'search_assignment', objectId: 'assignment-2', sequence: 1, effectiveAt: '2026-08-27T07:00:00Z', recordedAt: '2026-08-27T07:00:01Z', state: { search_area_id: 'area-alpha', outing_id: 'outing-7', team_id: 'team-blue' } },
      { id: 'pass-v2', objectType: 'search_pass', objectId: 'pass-2', sequence: 1, effectiveAt: '2026-08-27T08:00:00Z', recordedAt: '2026-08-27T08:00:01Z', state: { search_area_id: 'area-alpha', assignment_id: 'assignment-2', outcome: 'full' } },
      // Effective before the middle sample but only learned afterwards.
      { id: 'area-v2-late', objectType: 'search_area', objectId: 'area-alpha', sequence: 2, effectiveAt: '2026-08-27T04:00:00Z', recordedAt: '2026-08-27T08:30:00Z', state: { name: 'Area Alpha revisited', status: 'active' } },
    )
    for (const version of objectVersions) insertOracleVersion(db, version)

    const participants = [
      { id: 'participant-red', device: 'device-red', effectiveFrom: '2026-08-27T01:00:00Z', addedAt: '2026-08-27T01:00:01Z', removedAt: '2026-08-27T05:00:00Z' },
      { id: 'participant-blue', device: 'device-blue', effectiveFrom: '2026-08-27T05:00:00Z', addedAt: '2026-08-27T05:00:01Z', removedAt: null },
    ]
    for (const participant of participants) {
      db.prepare(`INSERT INTO mission_participants VALUES (
        ?, 'mission-1', 'device', ?, NULL, 'explicit', ?, ?, 'Coordinator', ?, NULL
      )`).run(
        participant.id, participant.device, participant.effectiveFrom,
        participant.addedAt, participant.removedAt,
      )
    }
    const memberships = [
      { id: 'member-red', sequence: 1, device: 'device-red', change: 'member', observedAt: '2026-08-27T01:00:00Z', recordedAt: '2026-08-27T01:00:01Z' },
      { id: 'left-red', sequence: 2, device: 'device-red', change: 'left', observedAt: '2026-08-27T05:00:00Z', recordedAt: '2026-08-27T05:00:01Z' },
      { id: 'member-blue', sequence: 3, device: 'device-blue', change: 'member', observedAt: '2026-08-27T05:00:00Z', recordedAt: '2026-08-27T05:00:01Z' },
    ]
    for (const membership of memberships) {
      db.prepare(`INSERT INTO mission_group_membership_events VALUES (
        ?, ?, 'mission-1', 'team-1', ?, ?, ?, ?, 'complete'
      )`).run(
        membership.id, membership.sequence, membership.device, membership.change,
        membership.observedAt, membership.recordedAt,
      )
    }

    const positions = [
      { id: 'fix-red', device: 'device-red', effectiveAt: '2026-08-27T02:30:00Z', recordedAt: '2026-08-27T02:30:01Z' },
      { id: 'tie-a', device: 'device-blue', effectiveAt: '2026-08-27T04:00:00Z', recordedAt: '2026-08-27T04:00:01Z' },
      { id: 'tie-b', device: 'device-red', effectiveAt: '2026-08-27T04:00:00Z', recordedAt: '2026-08-27T04:00:01Z' },
      { id: 'late-fix', device: 'device-blue', effectiveAt: '2026-08-27T03:30:00Z', recordedAt: '2026-08-27T06:00:00Z' },
    ]
    for (const position of positions) {
      insertPositionForDevice(db, position.device, [
        position.id, position.effectiveAt, position.recordedAt,
      ])
    }
    insertGpx(db, 'outing-2', 'gpx-oracle', '2026-08-27T03:45:00Z')
    const gpxTracks = [{
      id: 'gpx-oracle:1:0:0', effectiveAt: '2026-08-27T03:45:00Z',
      recordedAt: '2026-08-27T08:04:00Z', sourceOrder: 1,
      stableOrder: 'gpx-oracle:00000000:00000000',
    }]

    for (const selectedTime of [
      '2026-08-27T04:30:00Z',
      '2026-08-27T06:30:00Z',
      '2026-08-27T10:00:00Z',
    ]) {
      const actual = readMissionReplayState(db, {
        missionId: 'mission-1', selectedTime, trackLimit: 100, objectLimit: 100,
      })
      const expectedObjects = independentObjectOracle(objectVersions, selectedTime)
      const expectedTracks = independentTrackOracle(positions, gpxTracks, selectedTime)
      const expectedParticipants = participants
        .filter((entry) => entry.addedAt <= selectedTime && entry.effectiveFrom <= selectedTime
          && (entry.removedAt === null || entry.removedAt > selectedTime))
        .map((entry) => entry.id)
      const expectedMembership = independentMembershipOracle(memberships, selectedTime)

      expect(actual.objects.map((entry) => `${entry.object_type}:${entry.object_id}:${(entry as { version_sequence?: number }).version_sequence}`))
        .toEqual(expectedObjects)
      expect(actual.tracks.map((entry) => entry.evidence_id)).toEqual(expectedTracks)
      expect(actual.participants.map((entry) => entry.id)).toEqual(expectedParticipants)
      expect(actual.groupMembership.map((entry) => entry.id)).toEqual(expectedMembership)
    }
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

  it('surfaces future legacy lifecycle and membership baselines before they become knowable', () => {
    const db = createReplayDatabase()
    db.prepare(`INSERT INTO mission_events VALUES (
      'legacy-created', 'mission-1', 'mission_created', '2026-08-27T07:00:00Z', NULL,
      '2026-08-27T09:00:00Z', 'legacy_baseline'
    )`).run()
    db.prepare(`INSERT INTO mission_group_membership_events VALUES (
      'legacy-member', 1, 'mission-1', 'team-1', 'device-1', 'member',
      '2026-08-27T07:30:00Z', '2026-08-27T09:00:00Z', 'legacy_baseline'
    )`).run()

    const replay = readMissionReplayState(db, {
      missionId: 'mission-1', selectedTime: '2026-08-27T08:00:00Z', trackLimit: 100,
    })
    expect(replay.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'legacy_lifecycle_history_unknown_before_baseline' }),
      expect.objectContaining({ code: 'legacy_membership_history_unknown_before_baseline' }),
    ]))
  })

  it('uses opaque keyset cursors and applies display-only device and outing filters', () => {
    const db = createReplayDatabase()
    insertPosition(db, ['device-1-first', '2026-08-27T08:00:00Z', '2026-08-27T08:00:01Z'])
    insertPositionForDevice(db, 'device-2', ['device-2-first', '2026-08-27T08:00:30Z', '2026-08-27T08:00:31Z'])
    insertPosition(db, ['device-1-second', '2026-08-27T08:01:00Z', '2026-08-27T08:01:01Z'])
    insertGpx(db, 'outing-1')
    insertGpx(db, 'outing-2', 'gpx-2', '2026-08-27T08:02:00Z')

    const first = readMissionReplayState(db, {
      missionId: 'mission-1', selectedTime: '2026-08-27T09:00:00Z', trackLimit: 1,
      deviceIds: ['device-1'], outingIds: ['outing-2'],
    } as ReplayInput)
    expect(first.totalTrackCount).toBe(3)
    expect(first.tracks.map((track) => track.evidence_id)).toEqual(['device-1-first'])
    expect(first.nextCursor).not.toMatch(/^\d+$/u)

    const second = readMissionReplayTrackChunk(db, {
      missionId: 'mission-1', selectedTime: '2026-08-27T09:00:00Z', trackLimit: 1,
      deviceIds: ['device-1'], outingIds: ['outing-2'], cursor: first.nextCursor,
    } as ReplayInput & { cursor: string })
    expect(second.trackCursor).toBe('1')
    expect(second.tracks.map((track) => track.evidence_id)).toEqual(['device-1-second'])
    expect(second.previousCursor).not.toBeNull()

    const previous = readMissionReplayTrackChunk(db, {
      missionId: 'mission-1', selectedTime: '2026-08-27T09:00:00Z', trackLimit: 1,
      deviceIds: ['device-1'], outingIds: ['outing-2'], cursor: second.previousCursor,
    } as ReplayInput & { cursor: string })
    expect(previous.trackCursor).toBe('0')
    expect(previous.tracks.map((track) => track.evidence_id)).toEqual(['device-1-first'])
  })

  it('reports whole-state object-type totals independently of the current object page', () => {
    const db = createReplayDatabase()
    for (let index = 0; index < 3; index += 1) {
      insertVersion(db, [
        `marker-version-${index}`, `marker-${index}`, 1,
        '2026-08-27T08:00:00Z', '2026-08-27T08:00:01Z', `Marker ${index}`,
      ])
    }
    db.prepare(`INSERT INTO mission_object_versions VALUES (
      'outing-version', 'mission-1', 'outing', 'outing-1', 1, 'created',
      '2026-08-27T08:00:00Z', '2026-08-27T08:00:01Z', 'complete',
      '{"label":"Outing"}', NULL, NULL, NULL
    )`).run()

    const replay = readMissionReplayState(db, {
      missionId: 'mission-1', selectedTime: '2026-08-27T09:00:00Z',
      trackLimit: 100, objectLimit: 1,
    })
    expect(replay.objects).toHaveLength(1)
    expect(replay.objectTypeCounts).toMatchObject({ marker: 3, outing: 1 })
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
    CREATE TABLE devices (mission_id TEXT, device_id TEXT);
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
  insertPositionForDevice(db, 'device-1', values)
}

function insertGpx(
  db: InstanceType<typeof Database>,
  outingId: string | null = null,
  importId = 'gpx-1',
  sourceTime = '2026-08-27T08:01:30Z',
): void {
  db.prepare('INSERT INTO gpx_track_imports VALUES (?, \'mission-1\', NULL)').run(importId)
  db.prepare(`INSERT INTO gpx_import_revisions (
    import_id, mission_id, revision_sequence, recorded_at, source_path, file_name,
    display_name, content_sha256, timing_class, outing_id, completeness, import_state
  ) VALUES (
    ?, 'mission-1', 1, '2026-08-27T08:04:00Z', ?,
    ?, ?, 'abc', 'partially_dated', ?, 'complete', 'complete'
  )`).run(importId, `/${importId}.gpx`, `${importId}.gpx`, importId, outingId)
  db.prepare(`INSERT INTO gpx_evidence_points VALUES
    (?, 1, 0, 0, 52, -9.7, 100, ?),
    (?, 1, 0, 1, 52.1, -9.8, NULL, NULL)`).run(importId, sourceTime, importId)
}

function insertPositionForDevice(
  db: InstanceType<typeof Database>,
  deviceId: string,
  values: readonly unknown[],
): void {
  db.prepare(`INSERT INTO devices (mission_id, device_id)
    SELECT 'mission-1', ? WHERE NOT EXISTS (
      SELECT 1 FROM devices WHERE mission_id = 'mission-1' AND device_id = ?
    )`).run(deviceId, deviceId)
  db.prepare(`INSERT INTO positions VALUES (
    ?, 'mission-1', ?, 52, -9.7, NULL, 5, ?, ?, 'fix'
  )`).run(values[0], deviceId, ...values.slice(1))
}

function insertOracleVersion(
  db: InstanceType<typeof Database>,
  version: {
    readonly id: string
    readonly objectType: string
    readonly objectId: string
    readonly sequence: number
    readonly effectiveAt: string
    readonly recordedAt: string
    readonly state: Readonly<Record<string, unknown>>
  },
): void {
  db.prepare(`INSERT INTO mission_object_versions VALUES (
    ?, 'mission-1', ?, ?, ?, 'updated', ?, ?, 'complete', ?, NULL, NULL, NULL
  )`).run(
    version.id, version.objectType, version.objectId, version.sequence,
    version.effectiveAt, version.recordedAt, JSON.stringify(version.state),
  )
}

function independentObjectOracle(
  versions: readonly {
    readonly id: string
    readonly objectType: string
    readonly objectId: string
    readonly sequence: number
    readonly effectiveAt: string
    readonly recordedAt: string
  }[],
  selectedTime: string,
): readonly string[] {
  const latest = new Map<string, typeof versions[number]>()
  for (const version of versions) {
    if (version.effectiveAt > selectedTime || version.recordedAt > selectedTime) continue
    const key = `${version.objectType}:${version.objectId}`
    const existing = latest.get(key)
    if (existing === undefined
      || version.recordedAt > existing.recordedAt
      || (version.recordedAt === existing.recordedAt && version.sequence > existing.sequence)
      || (version.recordedAt === existing.recordedAt && version.sequence === existing.sequence
        && version.id > existing.id)) {
      latest.set(key, version)
    }
  }
  return [...latest.values()]
    .sort((left, right) => left.objectType.localeCompare(right.objectType)
      || left.objectId.localeCompare(right.objectId))
    .map((entry) => `${entry.objectType}:${entry.objectId}:${entry.sequence}`)
}

function independentTrackOracle(
  positions: readonly {
    readonly id: string
    readonly effectiveAt: string
    readonly recordedAt: string
  }[],
  gpxTracks: readonly {
    readonly id: string
    readonly effectiveAt: string
    readonly recordedAt: string
    readonly sourceOrder: number
    readonly stableOrder: string
  }[],
  selectedTime: string,
): readonly string[] {
  return [
    ...positions.map((entry) => ({ ...entry, sourceOrder: 0, stableOrder: entry.id })),
    ...gpxTracks,
  ]
    .filter((entry) => entry.effectiveAt <= selectedTime && entry.recordedAt <= selectedTime)
    .sort((left, right) => left.effectiveAt.localeCompare(right.effectiveAt)
      || left.recordedAt.localeCompare(right.recordedAt)
      || left.sourceOrder - right.sourceOrder
      || left.stableOrder.localeCompare(right.stableOrder))
    .map((entry) => entry.id)
}

function independentMembershipOracle(
  memberships: readonly {
    readonly id: string
    readonly device: string
    readonly change: string
    readonly observedAt: string
    readonly recordedAt: string
    readonly sequence: number
  }[],
  selectedTime: string,
): readonly string[] {
  const latest = new Map<string, typeof memberships[number]>()
  for (const membership of memberships
    .filter((entry) => entry.observedAt <= selectedTime && entry.recordedAt <= selectedTime)
    .sort((left, right) => left.device.localeCompare(right.device)
      || left.observedAt.localeCompare(right.observedAt)
      || left.sequence - right.sequence
      || left.id.localeCompare(right.id))) {
    latest.set(membership.device, membership)
  }
  return [...latest.values()].filter((entry) => entry.change === 'member').map((entry) => entry.id)
}
