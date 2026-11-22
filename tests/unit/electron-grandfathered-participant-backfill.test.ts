import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (
  file: string,
  options?: { readonly readonly?: boolean },
) => {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => {
    readonly all: (...args: unknown[]) => unknown[]
    readonly run: (...args: unknown[]) => unknown
  }
  readonly close: () => void
}

type Checkpoint = {
  readonly traccar_device_id: string
  readonly window_from: string
  readonly window_to: string
  readonly reconciled_until: string
  readonly completed: number
}

type Store = {
  readonly close: () => void
  readonly finishMission: (missionId: string) => Promise<{ readonly status: string }>
  readonly listMissionEvents: (missionId: string) => Promise<readonly {
    readonly event_type: string
    readonly details_json: string | null
  }[]>
  readonly listParticipantBackfillCheckpoints: (missionId: string) => Promise<readonly Checkpoint[]>
  readonly listMissionParticipants: (missionId: string) => Promise<readonly {
    readonly id: string
    readonly traccar_device_id: string | null
    readonly provenance: string
    readonly effective_from: string
    readonly added_at: string
  }[]>
  readonly removeMissionParticipant: (input: {
    readonly mission_id: string
    readonly participant_id: string
    readonly removed_by: string
  }) => Promise<unknown>
  readonly upsertParticipantBackfillCheckpoint: (input: {
    readonly mission_id: string
    readonly traccar_device_id: string
    readonly window_from: string
    readonly window_to: string
    readonly reconciled_until: string
    readonly completed: boolean
  }) => Promise<unknown>
}

const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => Store
}

const START = '2026-08-01T06:00:00.000Z'
const MISSION_ID = 'open-mission'

/** Writes a pre-participants (schema 8) store holding one open mission and one finalized mission. */
function seedSchema8Store(databasePath: string, status: 'active' | 'paused'): void {
  const legacyDb = new Database(databasePath)
  try {
    legacyDb.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO metadata (key, value) VALUES ('schema_version', '8');
      CREATE TABLE missions (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL,
        start_time TEXT NOT NULL, pause_time TEXT, finish_time TEXT,
        paused_seconds INTEGER NOT NULL DEFAULT 0, notes TEXT,
        schema_version INTEGER NOT NULL
      );
      INSERT INTO missions VALUES (
        '${MISSION_ID}', 'Open at upgrade', '${status}', '${START}',
        ${status === 'paused' ? "'2026-08-01T20:00:00.000Z'" : 'NULL'}, NULL, 0, NULL, 8
      );
      INSERT INTO missions VALUES (
        'finalized-mission', 'Legacy Finalized', 'finalized',
        '2026-07-01T06:00:00.000Z', NULL, '2026-07-01T18:00:00.000Z', 0, NULL, 8
      );
      CREATE TABLE devices (
        id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, device_id TEXT NOT NULL,
        name TEXT NOT NULL, color TEXT NOT NULL, last_seen TEXT, status TEXT NOT NULL,
        UNIQUE (mission_id, device_id)
      );
      INSERT INTO devices VALUES
        ('device-row-1', '${MISSION_ID}', '11', 'Alpha', '#fff', NULL, 'online'),
        ('device-row-2', 'finalized-mission', '12', 'Bravo', '#fff', NULL, 'offline');
    `)
  } finally {
    legacyDb.close()
  }
}

describe('grandfathered participants on an upgraded open mission [M-26]', () => {
  let userDataPath: string | null = null
  let store: Store | null = null

  afterEach(async () => {
    store?.close()
    store = null
    if (userDataPath !== null) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = null
    }
  })

  async function openUpgradedStore(status: 'active' | 'paused'): Promise<Store> {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-m26-'))
    seedSchema8Store(path.join(userDataPath, 'mission-store.sqlite'), status)
    store = createElectronMissionStore({ userDataPath })
    return store
  }

  async function completeScheduledWindow(openStore: Store, checkpoint: Checkpoint): Promise<void> {
    await openStore.upsertParticipantBackfillCheckpoint({
      mission_id: MISSION_ID,
      traccar_device_id: checkpoint.traccar_device_id,
      window_from: checkpoint.window_from,
      window_to: checkpoint.window_to,
      reconciled_until: checkpoint.window_to,
      completed: true,
    })
  }

  it.each(['active', 'paused'] as const)(
    'schedules the pre-upgrade history window so a %s mission can be finished once it is fetched',
    async (status) => {
      const openStore = await openUpgradedStore(status)
      const [participant] = await openStore.listMissionParticipants(MISSION_ID)
      expect(participant).toMatchObject({ traccar_device_id: '11', provenance: 'grandfathered' })

      const checkpoints = await openStore.listParticipantBackfillCheckpoints(MISSION_ID)
      // Not claimed as fetched: the runtime backfill must re-read it from Traccar.
      expect(checkpoints).toEqual([expect.objectContaining({
        traccar_device_id: '11',
        window_from: START,
        window_to: participant!.added_at,
        reconciled_until: START,
        completed: 0,
      })])
      const events = await openStore.listMissionEvents(MISSION_ID)
      const scheduled = events.filter(
        (event) => event.event_type === 'participant_backfill_scheduled',
      )
      expect(scheduled).toHaveLength(1)
      expect(JSON.parse(scheduled[0]!.details_json!)).toEqual({
        traccar_device_id: '11',
        window_from: START,
        window_to: participant!.added_at,
        reason: 'grandfathered_on_upgrade',
      })

      await expect(openStore.finishMission(MISSION_ID)).rejects.toThrow(/backfill/u)
      await completeScheduledWindow(openStore, checkpoints[0]!)
      await expect(openStore.finishMission(MISSION_ID)).resolves.toMatchObject({
        status: 'finished',
      })
    },
  )

  it('keeps Finish fenced after the grandfathered device is removed until its window completes', async () => {
    const openStore = await openUpgradedStore('active')
    const [participant] = await openStore.listMissionParticipants(MISSION_ID)
    await openStore.removeMissionParticipant({
      mission_id: MISSION_ID,
      participant_id: participant!.id,
      removed_by: 'Coordinator',
    })

    await expect(openStore.finishMission(MISSION_ID)).rejects.toThrow(/backfill/u)
    const [checkpoint] = await openStore.listParticipantBackfillCheckpoints(MISSION_ID)
    await completeScheduledWindow(openStore, checkpoint!)
    await expect(openStore.finishMission(MISSION_ID)).resolves.toMatchObject({
      status: 'finished',
    })
  })

  it('repairs a store that was already migrated without the window, and leaves finished missions alone', async () => {
    await openUpgradedStore('active')
    store!.close()
    store = null
    // Simulate a store migrated by an earlier build: participants but no checkpoint.
    const databasePath = path.join(userDataPath!, 'mission-store.sqlite')
    const rawDb = new Database(databasePath)
    try {
      rawDb.prepare('DELETE FROM participant_backfill_checkpoints').run()
      rawDb.prepare("DELETE FROM mission_events WHERE event_type = 'participant_backfill_scheduled'").run()
    } finally {
      rawDb.close()
    }

    store = createElectronMissionStore({ userDataPath: userDataPath! })
    const checkpoints = await store.listParticipantBackfillCheckpoints(MISSION_ID)
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]).toMatchObject({ window_from: START, completed: 0 })
    expect(await store.listParticipantBackfillCheckpoints('finalized-mission')).toEqual([])

    // Reopening again schedules nothing twice.
    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })
    expect(await store.listParticipantBackfillCheckpoints(MISSION_ID)).toHaveLength(1)
    const events = await store.listMissionEvents(MISSION_ID)
    expect(events.filter((event) => event.event_type === 'participant_backfill_scheduled'))
      .toHaveLength(1)
  })
})
