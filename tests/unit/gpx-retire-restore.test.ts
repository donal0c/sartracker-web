import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')

type ImportResult = {
  readonly imports: readonly { readonly id: string }[]
  readonly failures?: readonly { readonly sourcePath: string; readonly reason: string }[]
}
type Store = {
  readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
  readonly finishMission: (missionId: string) => Promise<unknown>
  readonly finalizeMission: (missionId: string) => Promise<unknown>
  readonly importGpxEvidencePaths: (input: {
    readonly missionId: string
    readonly paths: readonly string[]
    readonly skipRetiredSources?: boolean
  }) => Promise<ImportResult>
  readonly deleteGpxImport: (importId: string) => Promise<boolean>
  readonly updateGpxImportPresentation: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly readMissionReplay: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly info: () => Promise<{ readonly database_path: string }>
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
}
const { createElectronMissionStore, CURRENT_SCHEMA_VERSION } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => Store
  readonly CURRENT_SCHEMA_VERSION: number
}

const TRACK = `<gpx version="1.1"><trk><name>Tomies Wood</name><trkseg>
  <trkpt lat="52.030" lon="-9.600"><time>2026-06-29T09:00:00Z</time></trkpt>
  <trkpt lat="52.040" lon="-9.620"><time>2026-06-29T09:10:00Z</time></trkpt>
</trkseg></trk></gpx>`
const TRACK_CHANGED = `<gpx version="1.1"><trk><name>Tomies Wood</name><trkseg>
  <trkpt lat="52.030" lon="-9.600"><time>2026-06-29T09:00:00Z</time></trkpt>
  <trkpt lat="52.040" lon="-9.620"><time>2026-06-29T09:10:00Z</time></trkpt>
  <trkpt lat="52.045" lon="-9.640"><time>2026-06-29T09:20:00Z</time></trkpt>
</trkseg></trk></gpx>`

/**
 * DON-309 (Donal, 1 Oct 2026): a deliberate import of a retired file brings the
 * same track back with an audit event; changed bytes also record a new
 * revision. A watched-folder scan never restores. Only the same path (or a
 * recorded alias) restores; a renamed copy stays a new track. Replay hides the
 * track only while it was retired.
 */
describe('restore a retired GPX track with truthful replay [DON-309]', () => {
  let userDataPath: string | null = null
  let store: Store | null = null

  afterEach(async () => {
    await store?.prepareClose()
    store?.close()
    store = null
    if (userDataPath !== null) await rm(userDataPath, { recursive: true, force: true })
    userDataPath = null
  })

  async function openStore(): Promise<Store> {
    userDataPath ??= await mkdtemp(path.join(tmpdir(), 'sartracker-gpx-restore-'))
    store = createElectronMissionStore({ userDataPath })
    return store
  }

  async function withDb<T>(read: (db: InstanceType<typeof Database>) => T): Promise<T> {
    const db = new Database((await store!.info()).database_path, { readonly: true })
    try {
      return read(db)
    } finally {
      db.close()
    }
  }

  async function retiredTrack(name = 'Retire and restore') {
    const missionStore = await openStore()
    const mission = await missionStore.createMission({ name })
    const sourcePath = path.join(userDataPath!, 'Tomies Wood.gpx')
    await writeFile(sourcePath, TRACK)
    const imported = await missionStore.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] })
    const importId = imported.imports[0]!.id
    await expect(missionStore.deleteGpxImport(importId)).resolves.toBe(true)
    return { missionStore, mission, sourcePath, importId }
  }

  const replayShows = async (missionId: string, importId: string, selectedTime: string) =>
    JSON.stringify(await store!.readMissionReplay({ missionId, selectedTime, trackLimit: 1000 }))
      .includes(importId)

  it('restores the same track when its file is imported again deliberately', async () => {
    const { missionStore, mission, sourcePath, importId } = await retiredTrack()

    const again = await missionStore.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] })

    expect(again.failures ?? []).toEqual([])
    expect(again.imports.map((entry) => entry.id)).toEqual([importId])
    await withDb((db) => {
      expect(db.prepare('SELECT retired_at, revision_sequence FROM gpx_track_imports WHERE id = ?').get(importId))
        .toEqual({ retired_at: null, revision_sequence: 1 })
      expect(db.prepare(`SELECT event_type, json_extract(details_json, '$.gpx_import_id') AS import_id
        FROM mission_events WHERE mission_id = ? AND event_type IN ('gpx_import_deleted', 'gpx_import_restored')
        ORDER BY timestamp, rowid`).all(mission.id)).toEqual([
        { event_type: 'gpx_import_deleted', import_id: importId },
        { event_type: 'gpx_import_restored', import_id: importId },
      ])
    })
  })

  it('restores and records a new revision when the file changed while retired', async () => {
    const { missionStore, mission, sourcePath, importId } = await retiredTrack()
    await writeFile(sourcePath, TRACK_CHANGED)

    const again = await missionStore.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] })

    expect(again.imports.map((entry) => entry.id)).toEqual([importId])
    await withDb((db) => {
      expect(db.prepare('SELECT retired_at, revision_sequence FROM gpx_track_imports WHERE id = ?').get(importId))
        .toEqual({ retired_at: null, revision_sequence: 2 })
      expect(db.prepare(`SELECT COUNT(*) AS count FROM mission_events
        WHERE mission_id = ? AND event_type = 'gpx_import_restored'`).get(mission.id)).toEqual({ count: 1 })
    })
  })

  it('never restores from a watched-folder scan, and says how to bring a changed file back', async () => {
    const { missionStore, mission, sourcePath, importId } = await retiredTrack()
    const unchanged = await missionStore.importGpxEvidencePaths({
      missionId: mission.id, paths: [sourcePath], skipRetiredSources: true,
    })
    expect(unchanged.imports).toEqual([])
    await writeFile(sourcePath, TRACK_CHANGED)
    const changed = await missionStore.importGpxEvidencePaths({
      missionId: mission.id, paths: [sourcePath], skipRetiredSources: true,
    })
    expect(changed.failures).toEqual([{
      sourcePath,
      reason: 'This GPX file was retired and has since changed. To bring the track back with the new version, use Import Files.',
    }])
    await withDb((db) => {
      expect(db.prepare('SELECT retired_at IS NOT NULL AS retired FROM gpx_track_imports WHERE id = ?').get(importId))
        .toEqual({ retired: 1 })
    })
  })

  it('keeps a renamed copy as a new track and the original retired', async () => {
    const { missionStore, mission, sourcePath, importId } = await retiredTrack()
    const copyPath = path.join(userDataPath!, 'Tomies Wood (copy).gpx')
    await writeFile(copyPath, TRACK)

    const copied = await missionStore.importGpxEvidencePaths({ missionId: mission.id, paths: [copyPath] })

    expect(copied.imports).toHaveLength(1)
    expect(copied.imports[0]!.id).not.toBe(importId)
    await withDb((db) => {
      expect(db.prepare('SELECT retired_at IS NOT NULL AS retired FROM gpx_track_imports WHERE id = ?').get(importId))
        .toEqual({ retired: 1 })
    })
    void sourcePath
  })

  it('keeps the colour and display name the operator chose', async () => {
    const missionStore = await openStore()
    const mission = await missionStore.createMission({ name: 'Presentation survives restore' })
    const sourcePath = path.join(userDataPath!, 'Tomies Wood.gpx')
    await writeFile(sourcePath, TRACK)
    const importId = (await missionStore.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] }))
      .imports[0]!.id
    await missionStore.updateGpxImportPresentation({
      id: importId, mission_id: mission.id, display_name: 'Purple/Tomies',
      metadata_json: JSON.stringify({ color: '#a855f7' }),
    })
    const before = await withDb((db) => db.prepare(
      'SELECT display_name, metadata_json, outing_id, retired_at FROM gpx_track_imports WHERE id = ?',
    ).get(importId))
    await missionStore.deleteGpxImport(importId)

    await missionStore.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] })

    await withDb((db) => {
      expect(db.prepare('SELECT display_name, metadata_json, outing_id, retired_at FROM gpx_track_imports WHERE id = ?')
        .get(importId)).toEqual(before)
    })
  })

  it('refuses to restore into a finalized mission and changes nothing', async () => {
    const { missionStore, mission, sourcePath, importId } = await retiredTrack('Finalized')
    await missionStore.finishMission(mission.id)
    await missionStore.finalizeMission(mission.id)

    await expect(missionStore.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] }))
      .rejects.toThrow()
    await withDb((db) => {
      expect(db.prepare('SELECT retired_at IS NOT NULL AS retired FROM gpx_track_imports WHERE id = ?').get(importId))
        .toEqual({ retired: 1 })
    })
  })

  it('replays the track before retirement, hides it while retired, and shows it after restore', async () => {
    const { missionStore, mission, sourcePath, importId } = await retiredTrack('Replay intervals')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await missionStore.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await missionStore.deleteGpxImport(importId)
    const events = await withDb((db) => db.prepare(`SELECT event_type, timestamp FROM mission_events
      WHERE mission_id = ? AND event_type IN ('gpx_import_deleted', 'gpx_import_restored')
      ORDER BY timestamp, rowid`).all(mission.id) as { readonly event_type: string; readonly timestamp: string }[])
    expect(events.map((event) => event.event_type))
      .toEqual(['gpx_import_deleted', 'gpx_import_restored', 'gpx_import_deleted'])
    const first = { retired_at: events[0]!.timestamp, restored_at: events[1]!.timestamp }
    const second = { retired_at: events[2]!.timestamp }
    const just = (iso: string, deltaMs: number) => new Date(Date.parse(iso) + deltaMs).toISOString()

    expect(await replayShows(mission.id, importId, just(first.retired_at, -1))).toBe(true)
    expect(await replayShows(mission.id, importId, first.retired_at)).toBe(false)
    expect(await replayShows(mission.id, importId, just(first.restored_at, -1))).toBe(false)
    expect(await replayShows(mission.id, importId, first.restored_at)).toBe(true)
    expect(await replayShows(mission.id, importId, second.retired_at)).toBe(false)
  })

  it('keeps the whole retired gap hidden when a track retired before restore existed is restored', async () => {
    const { missionStore, mission, sourcePath, importId } = await retiredTrack('Legacy gap')
    const databasePath = (await missionStore.info()).database_path
    // A track retired by an older build has no retire event carrying its id.
    const writer = new Database(databasePath)
    const retiredAt = (writer.prepare('SELECT retired_at FROM gpx_track_imports WHERE id = ?').get(importId) as {
      readonly retired_at: string
    }).retired_at
    writer.prepare("DELETE FROM mission_events WHERE event_type = 'gpx_import_deleted'").run()
    writer.close()
    await new Promise((resolve) => setTimeout(resolve, 20))

    await missionStore.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] })

    const restoredAt = await withDb((db) => (db.prepare(`SELECT timestamp FROM mission_events
      WHERE event_type = 'gpx_import_restored'`).get() as { readonly timestamp: string }).timestamp)
    const just = (iso: string, deltaMs: number) => new Date(Date.parse(iso) + deltaMs).toISOString()
    expect(await replayShows(mission.id, importId, just(retiredAt, -1))).toBe(true)
    expect(await replayShows(mission.id, importId, retiredAt)).toBe(false)
    expect(await replayShows(mission.id, importId, just(restoredAt, -1))).toBe(false)
    expect(await replayShows(mission.id, importId, restoredAt)).toBe(true)
  })

  it('keeps the chosen name and colour and records the new revision when a changed file restores', async () => {
    const missionStore = await openStore()
    const mission = await missionStore.createMission({ name: 'Changed restore presentation' })
    const sourcePath = path.join(userDataPath!, 'Tomies Wood.gpx')
    await writeFile(sourcePath, TRACK)
    const importId = (await missionStore.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] }))
      .imports[0]!.id
    await missionStore.updateGpxImportPresentation({
      id: importId, mission_id: mission.id, display_name: 'Purple/Tomies',
      metadata_json: JSON.stringify({ color: '#a855f7' }),
    })
    await missionStore.deleteGpxImport(importId)
    await writeFile(sourcePath, TRACK_CHANGED)

    await missionStore.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] })

    await withDb((db) => {
      const row = db.prepare(`SELECT display_name, metadata_json, revision_sequence, content_sha256, retired_at
        FROM gpx_track_imports WHERE id = ?`).get(importId) as {
        readonly display_name: string
        readonly metadata_json: string
        readonly revision_sequence: number
        readonly content_sha256: string
        readonly retired_at: string | null
      }
      expect(row.display_name).toBe('Purple/Tomies')
      expect(JSON.parse(row.metadata_json)).toMatchObject({ color: '#a855f7', pointCount: 3 })
      expect(row.retired_at).toBeNull()
      const restored = JSON.parse((db.prepare(`SELECT details_json FROM mission_events
        WHERE event_type = 'gpx_import_restored'`).get() as { readonly details_json: string }).details_json)
      expect(restored).toMatchObject({
        gpx_import_id: importId,
        revision_sequence: 2,
        content_sha256: row.content_sha256,
        previous_revision_sequence: 1,
        previous_retired_at: expect.any(String),
      })
    })
  })

  it('opens a schema 13 store as 14 without inventing events, and replay still hides its retired tracks', async () => {
    const { missionStore, mission, importId } = await retiredTrack('Migrated')
    const databasePath = (await missionStore.info()).database_path
    await missionStore.prepareClose()
    missionStore.close()
    store = null
    const db = new Database(databasePath)
    const retiredAt = (db.prepare('SELECT retired_at FROM gpx_track_imports WHERE id = ?').get(importId) as {
      readonly retired_at: string
    }).retired_at
    db.exec("UPDATE metadata SET value = '13' WHERE key = 'schema_version'")
    // An older store may hold a retired row whose retire event is missing.
    db.prepare("DELETE FROM mission_events WHERE event_type = 'gpx_import_deleted'").run()
    const eventsBefore = (db.prepare('SELECT COUNT(*) AS count FROM mission_events').get() as { count: number }).count
    db.close()

    store = createElectronMissionStore({ userDataPath: userDataPath! })
    await withDb((check) => {
      expect(check.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get())
        .toEqual({ value: '14' })
      expect((check.prepare('SELECT COUNT(*) AS count FROM mission_events').get() as { count: number }).count)
        .toBe(eventsBefore)
    })
    expect(CURRENT_SCHEMA_VERSION).toBe(14)
    const before = new Date(Date.parse(retiredAt) - 1).toISOString()
    expect(await replayShows(mission.id, importId, before)).toBe(true)
    expect(await replayShows(mission.id, importId, retiredAt)).toBe(false)
  })
})
