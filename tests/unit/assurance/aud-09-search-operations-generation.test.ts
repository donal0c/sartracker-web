import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (path: string) => {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => {
    readonly run: (...params: readonly unknown[]) => unknown
    readonly get: (...params: readonly unknown[]) => Readonly<Record<string, unknown>> | undefined
    readonly all: (...params: readonly unknown[]) => readonly Readonly<Record<string, unknown>>[]
  }
  readonly close: () => void
}
type NativeMissionStore = {
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
  readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
  readonly info: () => Promise<{ readonly database_path: string }>
}
const { createElectronMissionStore } = require('../../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
  }) => NativeMissionStore
}
const { ensureSearchOperationsGenerationSchema } = require(
  '../../../electron/search-operations-generation.cjs',
) as {
  readonly ensureSearchOperationsGenerationSchema: (database: {
    readonly prepare: (sql: string) => {
      readonly get: (...params: readonly unknown[]) => Readonly<Record<string, unknown>> | undefined
    }
    readonly exec: (sql: string) => void
  }) => boolean
}

/** Reads both durable counters for one mission. */
function readGenerations(database: {
  readonly prepare: (sql: string) => {
    readonly get: (...params: readonly unknown[]) => Readonly<Record<string, unknown>> | undefined
  }
}, missionId: string) {
  return database.prepare(`SELECT generation, search_operations_generation
    FROM mission_replay_generations WHERE mission_id = ?`).get(missionId)
}

describe('AUD-09 Search Operations generation triggers', () => {
  let userDataPath: string | null = null
  let store: NativeMissionStore | null = null
  let database: { readonly close: () => void } | null = null

  afterEach(async () => {
    database?.close()
    database = null
    if (store !== null) {
      await store.prepareClose()
      store.close()
      store = null
    }
    if (userDataPath !== null) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = null
    }
  })

  it('adds the derived generation column to an existing store without scanning projections', () => {
    const legacyDatabase = new Database(':memory:')
    try {
      legacyDatabase.exec(`CREATE TABLE mission_replay_generations (
        mission_id TEXT PRIMARY KEY, generation INTEGER NOT NULL
      );`)
      legacyDatabase.prepare(`INSERT INTO mission_replay_generations
        (mission_id, generation) VALUES ('mission-a', 7)`).run()

      expect(ensureSearchOperationsGenerationSchema(legacyDatabase)).toBe(true)
      expect(ensureSearchOperationsGenerationSchema(legacyDatabase)).toBe(false)
      expect(legacyDatabase.prepare(`SELECT mission_id, generation,
        search_operations_generation FROM mission_replay_generations`).all()).toEqual([{
        mission_id: 'mission-a',
        generation: 7,
        search_operations_generation: 0,
      }])
    } finally {
      legacyDatabase.close()
    }
  })

  it('shares one durable fence across areas, assignments, outings, passes, and links', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-aud-09-generation-'))
    store = createElectronMissionStore({ userDataPath })
    const mission = await store.createMission({ name: 'AUD-09 generation triggers' })
    const databasePath = (await store.info()).database_path
    database = new Database(databasePath)
    const writable = database as typeof database & {
      readonly prepare: (sql: string) => {
        readonly run: (...params: readonly unknown[]) => unknown
        readonly get: (...params: readonly unknown[]) => Readonly<Record<string, unknown>> | undefined
      }
    }
    const base = '2026-09-13T10:00:00.000Z'
    const areaId = 'aud09-area'
    const outingId = 'aud09-outing'
    const assignmentId = 'aud09-assignment'
    const passId = 'aud09-pass'
    const insertArea = writable.prepare(`INSERT INTO search_areas (
      id, mission_id, name, status, geometry_json, version_sequence,
      updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', '{}', 1, 'Coordinator', ?, ?)`)
    insertArea.run(areaId, mission.id, 'Area', base, base)
    const afterAreaInsert = readGenerations(database, mission.id)
    expect(afterAreaInsert?.search_operations_generation).toBe(1)
    expect(afterAreaInsert?.generation).toBe(1)

    writable.prepare(`INSERT INTO outings (
      id, mission_id, label, started_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`).run(outingId, mission.id, 'Outing', base, base, base)
    writable.prepare(`INSERT INTO search_assignments (
      id, mission_id, search_area_id, outing_id, team_id, participant_ids_json,
      version_sequence, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'Team', '[]', 1, 'Coordinator', ?, ?)`).run(
      assignmentId, mission.id, areaId, outingId, base, base,
    )
    writable.prepare(`INSERT INTO search_passes (
      id, mission_id, search_area_id, assignment_id, started_at, outcome,
      coordinator_name, version_sequence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'partial', 'Coordinator', 1, ?, ?)`).run(
      passId, mission.id, areaId, assignmentId, base, base, base,
    )
    writable.prepare(`INSERT INTO search_pass_evidence_links (
      pass_id, version_sequence, link_kind, target_id
    ) VALUES (?, 1, 'clue', 'clue-a')`).run(passId)

    const afterAllInserts = readGenerations(database, mission.id)
    expect(afterAllInserts?.search_operations_generation).toBeGreaterThan(
      afterAreaInsert?.search_operations_generation as number,
    )
    expect(afterAllInserts?.generation).toBe(afterAreaInsert?.generation)

    const updates = [
      `UPDATE search_areas SET name = 'Area updated' WHERE id = ?`,
      `UPDATE outings SET label = 'Outing updated' WHERE id = ?`,
      `UPDATE search_assignments SET team_id = 'Team updated' WHERE id = ?`,
      `UPDATE search_passes SET notes = 'Pass updated' WHERE id = ?`,
      `UPDATE search_pass_evidence_links SET target_id = 'clue-b' WHERE pass_id = ?`,
    ]
    const updateIds = [areaId, outingId, assignmentId, passId, passId]
    let previousGeneration = Number(afterAllInserts?.search_operations_generation)
    for (let index = 0; index < updates.length; index += 1) {
      writable.prepare(updates[index]).run(updateIds[index])
      const afterUpdate = readGenerations(database, mission.id)
      expect(afterUpdate?.search_operations_generation).toBeGreaterThan(previousGeneration)
      expect(afterUpdate?.generation).toBe(afterAreaInsert?.generation)
      previousGeneration = Number(afterUpdate?.search_operations_generation)
    }

    writable.prepare(`DELETE FROM search_pass_evidence_links WHERE pass_id = ?`).run(passId)
    writable.prepare(`DELETE FROM search_passes WHERE id = ?`).run(passId)
    writable.prepare(`DELETE FROM search_assignments WHERE id = ?`).run(assignmentId)
    writable.prepare(`DELETE FROM search_areas WHERE id = ?`).run(areaId)
    writable.prepare(`DELETE FROM outings WHERE id = ?`).run(outingId)
    const afterDeletes = readGenerations(database, mission.id)
    expect(afterDeletes?.search_operations_generation).toBeGreaterThan(previousGeneration)
    expect(afterDeletes?.generation).toBe(afterAreaInsert?.generation)
  })

  it('invalidates once when a pass deletion cascades to its evidence links', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-aud-09-cascade-'))
    store = createElectronMissionStore({ userDataPath })
    const mission = await store.createMission({ name: 'AUD-09 cascade fence' })
    const databasePath = (await store.info()).database_path
    database = new Database(databasePath)
    database.exec('PRAGMA foreign_keys = ON')
    const writable = database as typeof database & {
      readonly prepare: (sql: string) => {
        readonly run: (...params: readonly unknown[]) => unknown
        readonly get: (...params: readonly unknown[]) => Readonly<Record<string, unknown>> | undefined
      }
    }
    const base = '2026-09-13T10:00:00.000Z'
    writable.prepare(`INSERT INTO search_areas (
      id, mission_id, name, status, geometry_json, version_sequence,
      updated_by, created_at, updated_at
    ) VALUES ('cascade-area', ?, 'Area', 'active', '{}', 1, 'Coordinator', ?, ?)`)
      .run(mission.id, base, base)
    writable.prepare(`INSERT INTO outings (
      id, mission_id, label, started_at, created_at, updated_at
    ) VALUES ('cascade-outing', ?, 'Outing', ?, ?, ?)`)
      .run(mission.id, base, base, base)
    writable.prepare(`INSERT INTO search_assignments (
      id, mission_id, search_area_id, outing_id, team_id, participant_ids_json,
      version_sequence, updated_by, created_at, updated_at
    ) VALUES ('cascade-assignment', ?, 'cascade-area', 'cascade-outing',
      'Team', '[]', 1, 'Coordinator', ?, ?)`)
      .run(mission.id, base, base)
    writable.prepare(`INSERT INTO search_passes (
      id, mission_id, search_area_id, assignment_id, started_at, outcome,
      coordinator_name, version_sequence, created_at, updated_at
    ) VALUES ('cascade-pass', ?, 'cascade-area', 'cascade-assignment', ?,
      'partial', 'Coordinator', 1, ?, ?)`)
      .run(mission.id, base, base, base)
    writable.prepare(`INSERT INTO search_pass_evidence_links (
      pass_id, version_sequence, link_kind, target_id
    ) VALUES ('cascade-pass', 1, 'clue', 'cascade-clue')`).run()

    const before = readGenerations(database, mission.id)
    writable.prepare(`DELETE FROM search_passes WHERE id = 'cascade-pass'`).run()
    const after = readGenerations(database, mission.id)

    expect(Number(after?.search_operations_generation))
      .toBe(Number(before?.search_operations_generation) + 1)
    expect(database.prepare(`SELECT COUNT(*) AS count
      FROM search_pass_evidence_links WHERE pass_id = 'cascade-pass'`).get()?.count)
      .toBe(0)
  })
})
