import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (
  path: string,
  options?: { readonly?: boolean },
) => {
  readonly prepare: (sql: string) => {
    readonly get: (...params: readonly unknown[]) => Readonly<Record<string, unknown>> | undefined
  }
  readonly close: () => void
}
const { createElectronMissionStore } = require(
  '../../../electron/mission-store.cjs',
) as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
  }) => NativeMissionStore
}

type NativeMissionStore = {
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
  readonly info: () => Promise<{ readonly database_path: string }>
  readonly createMission: (input: {
    readonly name: string
  }) => Promise<{ readonly id: string }>
  readonly upsertSearchArea: (input: {
    readonly mission_id: string
    readonly name: string
    readonly geometry_json: string
    readonly updated_by: string
  }) => Promise<Readonly<Record<string, unknown>>>
  readonly listSearchAreas: (
    missionId: string,
  ) => Promise<readonly Readonly<Record<string, unknown>>[]>
  readonly listSearchOperationPage: (input: {
    readonly missionId: string
    readonly kind: 'areas'
    readonly limit: number
    readonly cursor?: string
  }) => Promise<{
    readonly generation: number
    readonly entries: readonly Readonly<Record<string, unknown>>[]
    readonly nextCursor: string | null
  }>
  readonly syncBackup: (trigger?: string) => Promise<string>
  readonly listMissionEvents: (missionId: string) => Promise<readonly {
    readonly event_type: string
  }[]>
}

describe('AUD-09 native backup and Search Operations pagination', () => {
  let userDataPath: string | null = null
  let store: NativeMissionStore | null = null

  afterEach(async () => {
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

  it('keeps an unchanged page cursor usable after backup while retaining the audit append', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-aud-09-'))
    store = createElectronMissionStore({ userDataPath })
    const mission = await store.createMission({ name: 'AUD-09 pagination' })
    const geometryJson = JSON.stringify({
      type: 'Polygon',
      coordinates: [[[-9.8, 52], [-9.7, 52], [-9.7, 52.1], [-9.8, 52.1], [-9.8, 52]]],
    })

    for (let index = 0; index < 26; index += 1) {
      await store.upsertSearchArea({
        mission_id: mission.id,
        name: `AUD-09 area ${String(index).padStart(2, '0')}`,
        geometry_json: geometryJson,
        updated_by: 'Coordinator',
      })
    }

    const firstPage = await store.listSearchOperationPage({
      missionId: mission.id,
      kind: 'areas',
      limit: 25,
    })
    expect(firstPage.entries).toHaveLength(25)
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    const cursorPayload = JSON.parse(Buffer.from(
      firstPage.nextCursor ?? '', 'base64url',
    ).toString('utf8')) as { readonly v: number }
    expect(cursorPayload.v).toBe(3)

    const areasBeforeBackup = await store.listSearchAreas(mission.id)
    const eventsBeforeBackup = await store.listMissionEvents(mission.id)
    const databasePath = (await store.info()).database_path
    const readGenerations = () => {
      const reader = new Database(databasePath, { readonly: true })
      try {
        return reader.prepare(`SELECT generation, search_operations_generation
          FROM mission_replay_generations WHERE mission_id = ?`).get(mission.id)
      } finally {
        reader.close()
      }
    }
    const generationsBeforeBackup = readGenerations()
    expect(generationsBeforeBackup).toMatchObject({
      generation: expect.any(Number),
      search_operations_generation: expect.any(Number),
    })
    await expect(store.syncBackup('interval')).resolves.toEqual(
      path.join(userDataPath, 'mission-store.backup.sqlite'),
    )

    expect(await store.listSearchAreas(mission.id)).toEqual(areasBeforeBackup)
    const eventsAfterBackup = await store.listMissionEvents(mission.id)
    expect(eventsAfterBackup).toHaveLength(eventsBeforeBackup.length + 1)
    expect(eventsAfterBackup.filter((event) => event.event_type === 'mission_backup_synced'))
      .toHaveLength(1)
    const generationsAfterBackup = readGenerations()
    expect(generationsAfterBackup?.generation).toBe(
      Number(generationsBeforeBackup?.generation) + 1,
    )
    expect(generationsAfterBackup?.search_operations_generation).toBe(
      generationsBeforeBackup?.search_operations_generation,
    )

    await store.prepareClose()
    store.close()
    store = createElectronMissionStore({ userDataPath })

    const secondPage = await store.listSearchOperationPage({
      missionId: mission.id,
      kind: 'areas',
      limit: 25,
      cursor: firstPage.nextCursor ?? undefined,
    })
    expect(secondPage.entries).toHaveLength(1)
    expect(secondPage.entries[0]).toMatchObject({ name: 'AUD-09 area 25' })
    expect(secondPage.generation).toBe(firstPage.generation)
    const legacyCursor = Buffer.from(JSON.stringify({
      ...cursorPayload,
      v: 2,
    }), 'utf8').toString('base64url')
    await expect(store.listSearchOperationPage({
      missionId: mission.id,
      kind: 'areas',
      limit: 25,
      cursor: legacyCursor,
    })).rejects.toThrow(/cursor is invalid/i)
  })

  it('invalidates a continuation when a retained projection sort key moves', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-aud-09-sort-'))
    store = createElectronMissionStore({ userDataPath })
    const mission = await store.createMission({ name: 'AUD-09 sort invalidation' })
    const geometryJson = JSON.stringify({
      type: 'Polygon',
      coordinates: [[[-9.8, 52], [-9.7, 52], [-9.7, 52.1], [-9.8, 52.1], [-9.8, 52]]],
    })
    await store.upsertSearchArea({
      mission_id: mission.id,
      name: 'Alpha',
      geometry_json: geometryJson,
      updated_by: 'Coordinator',
    })
    const movedArea = await store.upsertSearchArea({
      mission_id: mission.id,
      name: 'Bravo',
      geometry_json: geometryJson,
      updated_by: 'Coordinator',
    })
    const firstPage = await store.listSearchOperationPage({
      missionId: mission.id,
      kind: 'areas',
      limit: 1,
    })
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    await store.upsertSearchArea({
      mission_id: mission.id,
      id: String(movedArea.id),
      name: 'Aardvark',
      geometry_json: geometryJson,
      updated_by: 'Coordinator',
    })

    await expect(store.listSearchOperationPage({
      missionId: mission.id,
      kind: 'areas',
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    })).rejects.toThrow(/Search Operations page changed; return to the first page/i)
  })
})
