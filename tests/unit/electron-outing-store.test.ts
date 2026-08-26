import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createElectronMissionStore, CURRENT_SCHEMA_VERSION } = require('../../electron/mission-store.cjs') as {
  readonly CURRENT_SCHEMA_VERSION: number
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly outingFaultInjection?: { readonly afterMutation?: boolean }
  }) => ElectronOutingStore
}

type Outing = {
  readonly id: string
  readonly mission_id: string
  readonly label: string
  readonly started_at: string
  readonly ended_at: string | null
}

type ElectronOutingStore = {
  readonly close: () => void
  readonly info: () => Promise<{ readonly schema_version: number; readonly database_path: string }>
  readonly createMission: (input: { readonly name: string; readonly start_time: string }) => Promise<{ readonly id: string }>
  readonly finishMission: (missionId: string) => Promise<unknown>
  readonly createOuting: (input: { readonly mission_id: string; readonly label: string; readonly started_at?: string }) => Promise<Outing>
  readonly endOuting: (input: { readonly mission_id: string; readonly outing_id: string; readonly ended_at?: string }) => Promise<Outing>
  readonly renameOuting: (input: { readonly mission_id: string; readonly outing_id: string; readonly label: string }) => Promise<Outing>
  readonly editOutingBoundaries: (input: { readonly mission_id: string; readonly outing_id: string; readonly started_at?: string; readonly ended_at?: string | null }) => Promise<Outing>
  readonly listOutings: (missionId: string) => Promise<readonly Outing[]>
  readonly listMissionEvents: (missionId: string) => Promise<readonly { readonly event_type: string; readonly details_json: string | null }[]>
}

let stores: ElectronOutingStore[] = []
let directories: string[] = []

afterEach(async () => {
  for (const store of stores) store.close()
  stores = []
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
  directories = []
})

async function createStore(options: { readonly failAfterMutation?: boolean } = {}): Promise<ElectronOutingStore> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sartracker-outings-'))
  directories.push(directory)
  const store = createElectronMissionStore({
    userDataPath: directory,
    ...(options.failAfterMutation === true
      ? { outingFaultInjection: { afterMutation: true } }
      : {}),
  })
  stores.push(store)
  return store
}

describe('Electron outing store', () => {
  it('migrates additively to schema v10 and manages audited adjacent outings', async () => {
    const store = await createStore()
    expect(CURRENT_SCHEMA_VERSION).toBe(10)
    await expect(store.info()).resolves.toMatchObject({ schema_version: 10 })
    const mission = await store.createMission({
      name: 'Mountain search',
      start_time: '2026-08-20T08:00:00.000Z',
    })

    const first = await store.createOuting({
      mission_id: mission.id,
      label: 'Outing 1',
      started_at: '2026-08-20T09:00:00.000Z',
    })
    await store.endOuting({
      mission_id: mission.id,
      outing_id: first.id,
      ended_at: '2026-08-20T11:00:00.000Z',
    })
    const second = await store.createOuting({
      mission_id: mission.id,
      label: 'Outing 2',
      started_at: '2026-08-20T11:00:00.000Z',
    })
    await store.renameOuting({ mission_id: mission.id, outing_id: second.id, label: 'Night search' })

    await expect(store.listOutings(mission.id)).resolves.toMatchObject([
      { id: first.id, label: 'Outing 1', ended_at: '2026-08-20T11:00:00.000Z' },
      { id: second.id, label: 'Night search', ended_at: null },
    ])
    const eventTypes = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(eventTypes).toEqual(expect.arrayContaining([
      'outing_started',
      'outing_ended',
      'outing_renamed',
    ]))
    const databasePath = (await store.info()).database_path
    const database = new (require('better-sqlite3'))(databasePath, { readonly: true })
    try {
      expect(database.prepare(`SELECT reason, subject_outing_id, old_started_at,
        old_ended_at, new_started_at, new_ended_at, drained_at
        FROM coverage_invalidations ORDER BY created_at, rowid`).all()).toEqual([
        expect.objectContaining({ reason: 'outing_created', subject_outing_id: first.id, old_started_at: null }),
        expect.objectContaining({ reason: 'outing_ended', subject_outing_id: first.id, old_ended_at: null, new_ended_at: '2026-08-20T11:00:00.000Z' }),
        expect.objectContaining({ reason: 'outing_created', subject_outing_id: second.id, old_started_at: null }),
      ])
      expect(database.prepare('SELECT change_seq FROM coverage_missions WHERE mission_id = ?').get(mission.id))
        .toEqual({ change_seq: 3 })
    } finally {
      database.close()
    }
  })

  it('refuses overlap, invalid boundaries, and mutations after mission finish without partial audit', async () => {
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Boundary search',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    const first = await store.createOuting({
      mission_id: mission.id,
      label: 'Morning',
      started_at: '2026-08-20T09:00:00.000Z',
    })
    await store.endOuting({ mission_id: mission.id, outing_id: first.id, ended_at: '2026-08-20T11:00:00.000Z' })
    const second = await store.createOuting({
      mission_id: mission.id,
      label: 'Afternoon',
      started_at: '2026-08-20T11:00:00.000Z',
    })

    await expect(store.editOutingBoundaries({
      mission_id: mission.id,
      outing_id: first.id,
      ended_at: '2026-08-20T11:30:00.000Z',
    })).rejects.toThrow(/overlap.*Afternoon/i)
    await expect(store.createOuting({
      mission_id: mission.id,
      label: 'Invalid',
      started_at: '2026-08-20T07:59:59.000Z',
    })).rejects.toThrow(/mission start/i)

    await store.endOuting({ mission_id: mission.id, outing_id: second.id, ended_at: '2026-08-20T12:00:00.000Z' })
    await store.finishMission(mission.id)
    await expect(store.createOuting({
      mission_id: mission.id,
      label: 'Too late',
      started_at: '2026-08-20T12:00:00.000Z',
    })).rejects.toThrow(/finished|finalized|read-only/i)
    expect((await store.listMissionEvents(mission.id)).filter((event) => event.event_type === 'outing_boundaries_edited')).toHaveLength(0)
  })

  it('rolls back both the outing and its audit event when the transaction fails', async () => {
    const store = await createStore({ failAfterMutation: true })
    const mission = await store.createMission({
      name: 'Rollback search',
      start_time: '2026-08-20T08:00:00.000Z',
    })

    await expect(store.createOuting({
      mission_id: mission.id,
      label: 'Outing 1',
      started_at: '2026-08-20T09:00:00.000Z',
    })).rejects.toThrow(/Injected outing transaction failure/)
    await expect(store.listOutings(mission.id)).resolves.toEqual([])
    expect((await store.listMissionEvents(mission.id)).filter((event) => event.event_type === 'outing_started')).toHaveLength(0)
    const database = new (require('better-sqlite3'))((await store.info()).database_path, { readonly: true })
    try {
      expect(database.prepare('SELECT * FROM coverage_invalidations').all()).toEqual([])
      expect(database.prepare('SELECT * FROM coverage_missions').all()).toEqual([])
    } finally {
      database.close()
    }
  })
})
