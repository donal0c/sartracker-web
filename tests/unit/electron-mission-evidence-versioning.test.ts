import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (path: string) => {
  close(): void
  prepare(sql: string): {
    all(...params: readonly unknown[]): readonly Record<string, unknown>[]
    get(...params: readonly unknown[]): Record<string, unknown> | undefined
    run(...params: readonly unknown[]): unknown
  }
  exec(sql: string): void
}

type MissionEvidenceStore = {
  close(): void
  info(): Promise<{ readonly schema_version: number; readonly database_path: string }>
  createMission(input: { readonly name: string; readonly start_time?: string }): Promise<{ readonly id: string }>
  finishMission(missionId: string): Promise<{ readonly status: string }>
  upsertMarker(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  deleteMarker(markerId: string): Promise<boolean>
  listMarkers(missionId: string): Promise<readonly Readonly<Record<string, unknown>>[]>
  upsertDrawing(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  createOuting(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  renameOuting(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  upsertGpxImport(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  deleteGpxImport(importId: string): Promise<boolean>
  listGpxImports(missionId: string): Promise<readonly Readonly<Record<string, unknown>>[]>
  listGpxImportRevisions(importId: string): Promise<readonly Readonly<Record<string, unknown>>[]>
  upsertSearchArea(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  upsertSearchAssignment(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  upsertSearchPass(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  listSearchAreas(missionId: string): Promise<readonly Readonly<Record<string, unknown>>[]>
  listSearchAssignments(missionId: string): Promise<readonly Readonly<Record<string, unknown>>[]>
  listSearchPasses(missionId: string): Promise<readonly Readonly<Record<string, unknown>>[]>
  importGpxEvidencePaths(input: { readonly missionId: string; readonly paths: readonly string[] }): Promise<{
    readonly imports: readonly { readonly id: string }[]
    readonly dispatchDurationMs: number
  }>
  readMissionReplay(input: Readonly<Record<string, unknown>>, requestId?: string): Promise<Readonly<Record<string, unknown>>>
  cancelMissionReplay(requestId: string): Promise<boolean>
  listMissionObjectVersions(input: {
    readonly missionId: string
    readonly objectType?: 'marker' | 'drawing' | 'outing'
    readonly objectId?: string
  }): Promise<readonly {
    readonly object_type: string
    readonly object_id: string
    readonly version_sequence: number
    readonly operation: string
    readonly completeness: string
    readonly state_json: string
    readonly audit_event_id: string
  }[]>
}

const { createElectronMissionStore, CURRENT_SCHEMA_VERSION } = require('../../electron/mission-store.cjs') as {
  readonly CURRENT_SCHEMA_VERSION: number
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly evidenceVersionFaultInjection?: { readonly afterProjection?: boolean }
  }) => MissionEvidenceStore
}

const SAMPLE_MARKER = {
  type: 'clue',
  name: 'Boot print',
  description: 'Initial description',
  lat: 52.0599,
  lon: -9.5045,
  irish_grid_e: 480000,
  irish_grid_n: 580000,
  display_order: 0,
  updated_by: 'Coordinator One',
} as const

describe('mission evidence versioning [DON-277]', () => {
  let userDataPath: string | null = null
  let store: MissionEvidenceStore | null = null

  afterEach(async () => {
    store?.close()
    store = null
    if (userDataPath !== null) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = null
    }
  })

  it('writes projection, immutable version, and audit identity in one transaction', async () => {
    store = await createStore()
    const mission = await store.createMission({
      name: 'Versioned Evidence Mission',
      start_time: '2026-08-27T08:00:00.000Z',
    })

    const created = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    await store.upsertMarker({
      mission_id: mission.id,
      ...SAMPLE_MARKER,
      id: created.id,
      description: 'Coordinator-confirmed description',
    })

    const versions = await store.listMissionObjectVersions({
      missionId: mission.id,
      objectType: 'marker',
      objectId: String(created.id),
    })
    expect(versions.map((version) => version.version_sequence)).toEqual([1, 2])
    expect(versions.map((version) => version.operation)).toEqual(['created', 'updated'])
    expect(JSON.parse(versions[0]!.state_json)).toMatchObject({ description: 'Initial description' })
    expect(JSON.parse(versions[1]!.state_json)).toMatchObject({
      description: 'Coordinator-confirmed description',
    })
    expect(versions.every((version) => version.audit_event_id !== '')).toBe(true)

    const db = openDatabase(await databasePath())
    const auditRows = db.prepare(
      `SELECT id, details_json FROM mission_events
       WHERE mission_id = ? AND event_type IN ('marker_created', 'marker_updated')
       ORDER BY rowid ASC`,
    ).all(mission.id)
    db.close()
    expect(auditRows).toHaveLength(2)
    expect(auditRows.map((row) => row.id)).toEqual(
      versions.map((version) => version.audit_event_id),
    )
  })

  it('rolls the projection back when immutable version persistence fails', async () => {
    store = await createStore({ afterProjection: true })
    const mission = await store.createMission({ name: 'Atomic Failure Mission' })

    await expect(
      store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER }),
    ).rejects.toThrow(/evidence version/i)
    await expect(store.listMarkers(mission.id)).resolves.toEqual([])
    await expect(
      store.listMissionObjectVersions({ missionId: mission.id, objectType: 'marker' }),
    ).resolves.toEqual([])
  })

  it('versions outing lifecycle changes without rewriting the earlier outing state', async () => {
    store = await createStore()
    const mission = await store.createMission({
      name: 'Versioned Outing Mission',
      start_time: '2026-08-27T08:00:00.000Z',
    })
    const outing = await store.createOuting({
      mission_id: mission.id,
      label: 'Morning deployment',
      started_at: '2026-08-27T08:10:00.000Z',
    })
    await store.renameOuting({
      mission_id: mission.id,
      outing_id: outing.id,
      label: 'Northern deployment',
    })

    const versions = await store.listMissionObjectVersions({
      missionId: mission.id,
      objectType: 'outing',
      objectId: String(outing.id),
    })
    expect(versions.map((version) => version.operation)).toEqual(['created', 'updated'])
    expect(JSON.parse(versions[0]!.state_json)).toMatchObject({ label: 'Morning deployment' })
    expect(JSON.parse(versions[1]!.state_json)).toMatchObject({ label: 'Northern deployment' })
  })

  it('retires evidence without physically deleting it and rejects finalized writes', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Retained Evidence Mission' })
    const created = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })

    await expect(store.deleteMarker(String(created.id))).resolves.toBe(true)
    await expect(store.listMarkers(mission.id)).resolves.toEqual([])
    const versions = await store.listMissionObjectVersions({
      missionId: mission.id,
      objectType: 'marker',
      objectId: String(created.id),
    })
    expect(versions.map((version) => version.operation)).toEqual(['created', 'retired'])
    expect(JSON.parse(versions[1]!.state_json)).toMatchObject({ retired_at: expect.any(String) })

    const db = openDatabase(await databasePath())
    expect(db.prepare('SELECT id, retired_at FROM markers WHERE id = ?').get(created.id)).toMatchObject({
      id: created.id,
      retired_at: expect.any(String),
    })
    db.close()

    const second = await store.upsertMarker({
      mission_id: mission.id,
      ...SAMPLE_MARKER,
      name: 'Locked clue',
    })
    await store.finishMission(mission.id)
    await expect(
      store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER, id: second.id }),
    ).rejects.toThrow(/finished mission|read-only/i)
    await expect(store.deleteMarker(String(second.id))).rejects.toThrow(/finished mission|read-only/i)
  })

  it('migrates legacy mutable rows to explicit incomplete baseline versions', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-migration-'))
    const first = createElectronMissionStore({ userDataPath })
    const mission = await first.createMission({ name: 'Legacy Baseline Mission' })
    await first.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    await first.upsertDrawing({
      mission_id: mission.id,
      type: 'search_area',
      name: 'Legacy Area',
      display_order: 0,
      geometry_json: '{"type":"Polygon","coordinates":[]}',
    })
    await first.createOuting({ mission_id: mission.id, label: 'Outing One' })
    first.close()

    const db = openDatabase(path.join(userDataPath, 'mission-store.sqlite'))
    db.prepare("UPDATE metadata SET value = '11' WHERE key = 'schema_version'").run()
    db.exec('DROP TABLE mission_object_versions')
    db.close()

    store = createElectronMissionStore({ userDataPath })
    expect(CURRENT_SCHEMA_VERSION).toBe(12)
    await expect(store.info()).resolves.toMatchObject({ schema_version: 12 })
    const versions = await store.listMissionObjectVersions({ missionId: mission.id })
    expect(versions).toHaveLength(4)
    expect(new Set(versions.map((version) => version.object_type))).toEqual(
      new Set(['marker', 'drawing', 'outing', 'search_area']),
    )
    expect(versions.every((version) => version.operation === 'legacy_baseline')).toBe(true)
    expect(versions.every((version) => version.completeness === 'legacy_baseline')).toBe(true)
  })

  it('deduplicates GPX by exact content and preserves changed files as revisions [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'GPX Evidence Mission' })
    const first = await store.upsertGpxImport(gpxInput(mission.id, {
      source_path: '/field/route.gpx',
      content_sha256: 'a'.repeat(64),
      source_bytes_base64: 'PGdweD5maXJzdDwvZ3B4Pg==',
    }))
    const alias = await store.upsertGpxImport(gpxInput(mission.id, {
      source_path: '/copied/route.gpx',
      content_sha256: 'a'.repeat(64),
      source_bytes_base64: 'PGdweD5maXJzdDwvZ3B4Pg==',
    }))
    expect(alias.id).toBe(first.id)

    const revised = await store.upsertGpxImport(gpxInput(mission.id, {
      id: String(first.id),
      source_path: '/field/route.gpx',
      content_sha256: 'b'.repeat(64),
      source_bytes_base64: 'PGdweD5zZWNvbmQ8L2dweD4=',
      timing_class: 'partially_dated',
    }))
    expect(revised.revision_sequence).toBe(2)
    const revisions = await store.listGpxImportRevisions(String(first.id))
    expect(revisions).toHaveLength(2)
    expect(revisions.map((revision) => revision.content_sha256)).toEqual([
      'a'.repeat(64),
      'b'.repeat(64),
    ])
    expect(revisions.map((revision) => revision.source_bytes_base64)).toEqual([
      'PGdweD5maXJzdDwvZ3B4Pg==',
      'PGdweD5zZWNvbmQ8L2dweD4=',
    ])

    await expect(store.deleteGpxImport(String(first.id))).resolves.toBe(true)
    await expect(store.listGpxImports(mission.id)).resolves.toEqual([])
    const db = openDatabase(await databasePath())
    expect(db.prepare('SELECT retired_at FROM gpx_track_imports WHERE id = ?').get(first.id))
      .toMatchObject({ retired_at: expect.any(String) })
    expect(db.prepare('SELECT COUNT(*) AS count FROM gpx_import_aliases WHERE import_id = ?').get(first.id))
      .toMatchObject({ count: 2 })
    db.close()
  })

  it('keeps stable areas, repeated assignments, and coordinator-declared pass revisions [DON-279]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Repeated Search Mission' })
    const outing = await store.createOuting({ mission_id: mission.id, label: 'Operational period 1' })
    const area = await store.upsertSearchArea({
      mission_id: mission.id,
      name: 'Area Alpha',
      status: 'active',
      geometry_json: '{"type":"Polygon","coordinates":[]}',
      updated_by: 'Coordinator One',
    })
    const firstAssignment = await store.upsertSearchAssignment({
      mission_id: mission.id,
      search_area_id: area.id,
      outing_id: outing.id,
      team_id: 'team-1',
      participant_ids: ['participant-1'],
      notes: 'First attempt',
      updated_by: 'Coordinator One',
    })
    await store.upsertSearchAssignment({
      mission_id: mission.id,
      search_area_id: area.id,
      outing_id: outing.id,
      team_id: 'team-2',
      participant_ids: [],
      notes: 'Second independent attempt',
      updated_by: 'Coordinator One',
    })
    const pass = await store.upsertSearchPass({
      mission_id: mission.id,
      search_area_id: area.id,
      assignment_id: firstAssignment.id,
      started_at: '2026-08-27T08:00:00Z',
      ended_at: '2026-08-27T09:00:00Z',
      outcome: 'full',
      notes: 'Coordinator declaration',
      coordinator_name: 'Coordinator One',
      participant_ids: ['participant-1'],
      clue_ids: [],
      track_evidence_ids: ['device-1'],
    })
    await store.upsertSearchPass({
      ...pass,
      outcome: 'partial',
      notes: 'Corrected after debrief',
      coordinator_name: 'Coordinator One',
    })

    expect(await store.listSearchAreas(mission.id)).toHaveLength(1)
    expect(await store.listSearchAssignments(mission.id)).toHaveLength(2)
    expect(await store.listSearchPasses(mission.id)).toEqual([
      expect.objectContaining({
        id: pass.id,
        outcome: 'partial',
        coordinator_name: 'Coordinator One',
        version_sequence: 2,
      }),
    ])
    const passVersions = await store.listMissionObjectVersions({
      missionId: mission.id,
      objectType: 'search_pass',
      objectId: String(pass.id),
    })
    expect(passVersions.map((version) => JSON.parse(version.state_json).outcome))
      .toEqual(['full', 'partial'])

    await store.finishMission(mission.id)
    await expect(store.upsertSearchPass({ ...pass, outcome: 'aborted' }))
      .rejects.toThrow(/finished mission|read-only/i)
  })

  it('hashes, parses, and bulk-persists GPX off the main isolate with bounded results [DON-274]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Worker GPX Mission' })
    const sourcePath = path.join(userDataPath!, 'worker-track.gpx')
    await writeFile(sourcePath, `<gpx version="1.1"><trk><name>Hill Team</name><trkseg>
      <trkpt lat="52" lon="-9.7"><time>2026-08-27T08:00:00Z</time></trkpt>
      <trkpt lat="52.01" lon="-9.71"></trkpt>
    </trkseg></trk></gpx>`)

    const result = await store.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] })
    expect(result.dispatchDurationMs).toBeLessThan(150)
    expect(result.imports).toEqual([expect.objectContaining({ id: expect.any(String) })])
    expect(JSON.stringify(result)).not.toContain('source_bytes_base64')
    expect(JSON.stringify(result)).not.toContain('MultiLineString')

    const db = openDatabase(await databasePath())
    expect(db.prepare('SELECT COUNT(*) AS count FROM gpx_evidence_points').get())
      .toMatchObject({ count: 2 })
    expect(db.prepare('SELECT timing_class, source_bytes_base64 FROM gpx_import_revisions').get())
      .toMatchObject({ timing_class: 'partially_dated', source_bytes_base64: expect.any(String) })
    db.close()

    const seekStartedAt = performance.now()
    const replay = await store.readMissionReplay({
      missionId: mission.id,
      selectedTime: new Date().toISOString(),
      timezone: 'Europe/Dublin',
      trackLimit: 100,
    }, 'worker-gpx-replay')
    expect(performance.now() - seekStartedAt).toBeLessThan(1_000)
    expect(replay).toMatchObject({
      totalTrackCount: 1,
      staticGpxPointCount: 1,
      tracks: [expect.objectContaining({ time_authority: 'gpx_source_time' })],
      limitations: [expect.objectContaining({ code: 'undated_gpx_static' })],
    })
  })

  async function createStore(
    faultInjection?: { readonly afterProjection?: boolean },
  ): Promise<MissionEvidenceStore> {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-pr5-versioning-'))
    return createElectronMissionStore({
      userDataPath,
      ...(faultInjection === undefined ? {} : { evidenceVersionFaultInjection: faultInjection }),
    })
  }

  async function databasePath(): Promise<string> {
    const info = await store!.info()
    return info.database_path
  }

  function openDatabase(databasePath: string): InstanceType<typeof Database> {
    return new Database(databasePath)
  }

  function gpxInput(missionId: string, overrides: Readonly<Record<string, unknown>>) {
    return {
      mission_id: missionId,
      source_path: '/field/route.gpx',
      file_name: 'route.gpx',
      display_name: 'Route',
      geometry_json: '{"type":"MultiLineString","coordinates":[[[-9.7,52],[-9.71,52.01]]]}',
      metadata_json: '{}',
      content_sha256: 'a'.repeat(64),
      source_bytes_base64: 'PGdweD5maXJzdDwvZ3B4Pg==',
      timing_class: 'fully_dated',
      points: [
        { segment_index: 0, point_index: 0, track_name: 'Route', lat: 52, lon: -9.7, elevation: 100, timestamp: '2026-08-27T08:00:00Z' },
        { segment_index: 0, point_index: 1, track_name: 'Route', lat: 52.01, lon: -9.71, elevation: null, timestamp: null },
      ],
      rejections: [],
      ...overrides,
    }
  }
})
