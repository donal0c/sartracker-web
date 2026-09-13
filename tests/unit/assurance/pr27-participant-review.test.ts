import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore } = require('../../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
  }) => ParticipantStore
}

type Participant = {
  readonly id: string
  readonly kind: 'group' | 'device'
  readonly mission_team_id: string | null
  readonly removed_at: string | null
  readonly starting_member_device_ids_json?: string | null
  readonly backfill_member_count?: number | null
  readonly backfill_completed_count?: number | null
  readonly backfill_scope_inferred?: boolean
  readonly backfill_scope_unknown?: boolean
}

type Mission = { readonly id: string }

type ParticipantStore = {
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
  readonly info: () => Promise<{ readonly database_path: string }>
  readonly createMission: (input: {
    readonly name: string
    readonly start_time: string
  }) => Promise<Mission>
  readonly getMission: (missionId: string) => Promise<{ readonly status: string }>
  readonly selectMissionParticipants: (input: unknown) => Promise<readonly Participant[]>
  readonly addMissionParticipant: (input: unknown) => Promise<Participant>
  readonly resolveLegacyParticipantRoster: (input: unknown) => Promise<Participant>
  readonly removeMissionParticipant: (input: unknown) => Promise<Participant>
  readonly listMissionParticipants: (missionId: string) => Promise<readonly Participant[]>
  readonly listGroupMembershipEvents: (missionId: string) => Promise<readonly unknown[]>
  readonly listParticipantBackfillCheckpoints: (missionId: string) => Promise<readonly Checkpoint[]>
  readonly upsertParticipantBackfillCheckpoint: (input: unknown) => Promise<unknown>
  readonly finishMission: (missionId: string) => Promise<{ readonly status: string }>
  readonly finalizeMission: (missionId: string) => Promise<{ readonly archive: { readonly archive_path: string } }>
}

type Checkpoint = {
  readonly traccar_device_id: string
  readonly window_from: string
  readonly window_to: string
  readonly completed: number
}

const missionStart = '2026-08-20T08:00:00.000Z'

let stores: ParticipantStore[] = []
let directories: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(stores.map((store) => store.prepareClose()))
  for (const store of stores) store.close()
  stores = []
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
  directories = []
})

describe('PR27 participant review regressions [DON-271]', () => {
  it.each(['not-a-time', '2026-08-20T10:00:00.000Z', '2026-08-20T07:00:00.000Z', 'future-end'])(
    'rejects malformed or out-of-bound original intervals before empty attestation: %s', async (start) => {
      vi.useFakeTimers()
      setClock('2026-08-20T09:00:00.000Z')
      let store = await createStore()
      const mission = await store.createMission({ name: 'Invalid legacy interval', start_time: missionStart })
      const [group] = await store.selectMissionParticipants({ mission_id: mission.id, groups: [
        { traccar_group_id: '101', name: 'Team', member_device_ids: [] }], devices: [], selected_by: 'A' })
      store = await replaceSnapshotWithLegacyNull(store, group!.id)
      const db = new Database((await store.info()).database_path)
      db.prepare('UPDATE mission_participants SET effective_from = ?, added_at = ? WHERE id = ?')
        .run(start === 'future-end' ? missionStart : start,
          start === 'future-end' ? '2999-01-01T00:00:00.000Z' : '2026-08-20T09:00:00.000Z', group!.id)
      await expect(store.resolveLegacyParticipantRoster({ mission_id: mission.id, participant_id: group!.id,
        member_device_ids: [], resolution: 'attested-empty', confirmed: true, confirmed_by: 'Jane', reason: 'Checked roster' }))
        .rejects.toThrow(/timestamp|before|future/i)
      expect(db.prepare("SELECT COUNT(*) AS count FROM mission_events WHERE event_type = 'participant_roster_attested'").get())
        .toEqual({ count: 0 })
      db.close()
      await expect(store.finishMission(mission.id)).rejects.toThrow(/unknown/i)
    },
  )

  it.each([{ ids: [] }, { ids: ['11', '22'] }])('audits legacy roster recovery $ids without changing original evidence', async ({ ids }) => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    let store = await createStore()
    const mission = await store.createMission({ name: 'Attested recovery', start_time: missionStart })
    const [group] = await store.selectMissionParticipants({ mission_id: mission.id,
      groups: [{ traccar_group_id: '101', name: 'Team', member_device_ids: [] }], devices: [], selected_by: 'A' })
    store = await replaceSnapshotWithLegacyNull(store, group!.id)
    await store.removeMissionParticipant({ mission_id: mission.id, participant_id: group!.id, removed_by: 'A' })
    const input = { mission_id: mission.id, participant_id: group!.id, member_device_ids: ids,
      resolution: ids.length === 0 ? 'attested-empty' : 'supplied-members', confirmed: true as const, confirmed_by: 'Coordinator Jane', reason: 'Checked incident roster with team lead' }
    await expect(store.resolveLegacyParticipantRoster({ ...input, reason: '' })).rejects.toThrow(/reason/i)
    await expect(store.resolveLegacyParticipantRoster({ ...input, confirmed_by: '' })).rejects.toThrow(/coordinator/i)
    await expect(store.resolveLegacyParticipantRoster({ ...input, resolution: 'automatic' })).rejects.toThrow(/resolution/i)
    await expect(store.resolveLegacyParticipantRoster({ ...input, confirmed: false })).rejects.toThrow(/confirmation/i)
    const transactionDb = new Database((await store.info()).database_path)
    const { createParticipantStore } = require('../../../electron/participant-store.cjs') as {
      createParticipantStore(options: { db: unknown; now: () => string; faultInjection: { afterMutation: boolean } }): {
        resolveLegacyParticipantRoster(input: unknown): unknown
      }
    }
    const failingStore = createParticipantStore({ db: transactionDb, now: () => '2026-08-20T09:00:00.000Z', faultInjection: { afterMutation: true } })
    expect(() => failingStore.resolveLegacyParticipantRoster(input)).toThrow(/injected/i)
    expect(transactionDb.prepare("SELECT COUNT(*) AS count FROM mission_events WHERE event_type = 'participant_roster_attested'").get()).toEqual({ count: 0 })
    expect(transactionDb.prepare('SELECT COUNT(*) AS count FROM participant_backfill_checkpoints').get()).toEqual({ count: 0 })
    transactionDb.close()
    await store.resolveLegacyParticipantRoster(input)
    await expect(store.resolveLegacyParticipantRoster(input)).rejects.toThrow(/already|correction/i)
    const databasePath = (await store.info()).database_path
    const db = new Database(databasePath)
    expect(db.prepare('SELECT starting_member_device_ids_json FROM mission_participants WHERE id = ?').get(group!.id))
      .toEqual({ starting_member_device_ids_json: null })
    const events = db.prepare("SELECT * FROM mission_events WHERE event_type = 'participant_roster_attested'").all()
    expect(events).toHaveLength(1)
    expect(JSON.parse(events[0].details_json)).toMatchObject({ ...input, original_starting_member_device_ids_json: null })
    db.close()
    await expect(store.listGroupMembershipEvents(mission.id)).resolves.toEqual([])
    for (const id of ids) {
      await expect(store.finishMission(mission.id)).rejects.toThrow(/backfill/i)
      expect(await store.listParticipantBackfillCheckpoints(mission.id)).toContainEqual(expect.objectContaining({
        traccar_device_id: id, window_from: missionStart, window_to: '2026-08-20T09:00:00.000Z' }))
      await completeCheckpoint(store, mission.id, id)
    }
    await store.prepareClose()
    store.close()
    stores = stores.filter((candidate) => candidate !== store)
    store = await reopenStore(directories.at(-1)!)
    expect(await store.listMissionParticipants(mission.id)).toContainEqual(expect.objectContaining({
      id: group!.id, starting_member_device_ids_json: null, backfill_scope_attested: true,
      backfill_member_count: ids.length, backfill_completed_count: ids.length }))
    await expect(store.finishMission(mission.id)).resolves.toMatchObject({ status: 'finished' })
    await expect(store.resolveLegacyParticipantRoster(input)).rejects.toThrow(/read-only/i)
    const finalized = await store.finalizeMission(mission.id)
    const { readZipArchive } = require('../../../electron/zip-archive.cjs') as {
      readZipArchive(buffer: Buffer): ReadonlyMap<string, Buffer>
    }
    const archivePath = path.join(directories.at(-1)!, 'attested-archive.sqlite')
    await writeFile(archivePath, readZipArchive(await readFile(finalized.archive.archive_path)).get('mission-store.sqlite')!)
    const archive = new Database(archivePath, { readonly: true })
    expect(archive.prepare('SELECT starting_member_device_ids_json FROM mission_participants WHERE id = ?').get(group!.id))
      .toEqual({ starting_member_device_ids_json: null })
    expect(archive.prepare("SELECT COUNT(*) AS count FROM mission_events WHERE event_type = 'participant_roster_attested'").get())
      .toEqual({ count: 1 })
    expect(archive.prepare('SELECT COUNT(*) AS count FROM participant_backfill_checkpoints WHERE completed = 1').get())
      .toEqual({ count: ids.length })
    archive.close()
  })

  it('reproduces the legacy unknown-scope deadlock after the group is removed', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    let store = await createStore()
    const mission = await store.createMission({
      name: 'Legacy removed group deadlock mission',
      start_time: missionStart,
    })
    const [group] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: [],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })

    store = await replaceSnapshotWithLegacyNull(store, group!.id)
    setClock('2026-08-20T10:00:00.000Z')
    await store.removeMissionParticipant({
      mission_id: mission.id,
      participant_id: group!.id,
      removed_by: 'Coordinator A',
      reason: 'Team stood down',
    })

    const removedGroup = (await store.listMissionParticipants(mission.id))
      .find((participant) => participant.id === group!.id)
    await expect(store.listGroupMembershipEvents(mission.id)).resolves.toEqual([])
    await expect(store.listParticipantBackfillCheckpoints(mission.id)).resolves.toEqual([])
    expect(removedGroup).toMatchObject({
      removed_at: expect.any(String),
      backfill_member_count: null,
      backfill_completed_count: null,
      backfill_scope_unknown: true,
    })
    await expect(store.finishMission(mission.id)).rejects.toThrow(
      /legacy group history scope is unknown/i,
    )
    await expect(store.getMission(mission.id)).resolves.toMatchObject({ status: 'active' })
  })

  it('requires an exact backdated re-add to retain departed members across its effective interval', async () => {
    vi.useFakeTimers()
    const { store, mission, readdedGroup } = await createBackdatedReaddScenario()
    const currentGroup = (await store.listMissionParticipants(mission.id))
      .find((participant) => participant.id === readdedGroup.id)

    // The current snapshot contains B, while A still has historical coverage
    // in the backdated interval. The safe contract must retain both members.
    expect.soft(currentGroup).toMatchObject({
      starting_member_device_ids_json: '["B"]',
      backfill_member_count: 2,
      backfill_completed_count: 1,
      backfill_scope_inferred: false,
    })
    let finishError: unknown = null
    try {
      await store.finishMission(mission.id)
    } catch (error) {
      finishError = error
    }
    expect.soft(finishError).toMatchObject({
      message: expect.stringMatching(/history backfill.*incomplete|complete.*history backfill/i),
    })
  })

  it('shows the inferred legacy path retaining the departed member as a conservative control', async () => {
    vi.useFakeTimers()
    const { store, mission, readdedGroup } = await createBackdatedReaddScenario()
    const legacyStore = await replaceSnapshotWithLegacyNull(store, readdedGroup.id)

    const currentGroup = (await legacyStore.listMissionParticipants(mission.id))
      .find((participant) => participant.id === readdedGroup.id)
    expect(currentGroup).toMatchObject({
      backfill_member_count: 2,
      backfill_completed_count: 1,
      backfill_scope_inferred: true,
      backfill_scope_unknown: false,
    })
    await expect(legacyStore.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|complete.*history backfill/i,
    )
  })

  it('does not import an unrelated group checkpoint into an exact re-add scope', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Unrelated checkpoint scope mission',
      start_time: missionStart,
    })
    const selected = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [
        {
          traccar_group_id: '101',
          name: 'Kerry MRT',
          member_device_ids: ['A'],
        },
        {
          traccar_group_id: '202',
          name: 'Other team',
          member_device_ids: ['X'],
        },
      ],
      devices: [],
      selected_by: 'Coordinator A',
    })
    const initialGroup = selected.find((participant) => participant.mission_team_id !== null)
    const otherGroup = selected.find((participant) => participant.id !== initialGroup?.id)
    await completeCheckpoint(store, mission.id, 'A')
    await completeCheckpoint(store, mission.id, 'X')

    setClock('2026-08-20T10:00:00.000Z')
    await store.removeMissionParticipant({
      mission_id: mission.id,
      participant_id: initialGroup!.id,
      removed_by: 'Coordinator A',
    })
    setClock('2026-08-20T11:00:00.000Z')
    const readdedGroup = await store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'group',
      ref: {
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['B'],
      },
      effective_from: missionStart,
      confirmed_by: 'Coordinator A',
    })
    await completeCheckpoint(store, mission.id, 'B')

    const currentGroup = (await store.listMissionParticipants(mission.id))
      .find((participant) => participant.id === readdedGroup.id)
    expect(otherGroup).toBeDefined()
    expect(currentGroup).toMatchObject({
      backfill_member_count: 2,
      backfill_completed_count: 1,
    })
  })

  it('keeps proven coverage complete when a redundant pending window overlaps it', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T11:00:00.000Z')
    let store = await createStore()
    const mission = await store.createMission({
      name: 'Redundant pending coverage mission',
      start_time: missionStart,
    })
    const [group] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['A'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })

    const databasePath = (await store.info()).database_path
    const directory = directories.at(-1)!
    await store.prepareClose()
    store.close()
    stores = stores.filter((candidate) => candidate !== store)
    const database = new Database(databasePath)
    database.prepare(`DELETE FROM participant_backfill_checkpoints
      WHERE mission_id = ? AND traccar_device_id = ?`).run(mission.id, 'A')
    database.prepare(`INSERT INTO participant_backfill_checkpoints (
        mission_id, traccar_device_id, window_from, window_to,
        reconciled_until, completed, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?), (?, ?, ?, ?, ?, 0, ?)`)
      .run(
        mission.id, 'A', missionStart, '2026-08-20T11:00:00.000Z',
        '2026-08-20T11:00:00.000Z', '2026-08-20T11:00:00.000Z',
        mission.id, 'A', '2026-08-20T09:00:00.000Z', '2026-08-20T10:00:00.000Z',
        '2026-08-20T09:00:00.000Z', '2026-08-20T11:00:00.000Z',
      )
    database.close()
    store = await reopenStore(directory)

    const currentGroup = (await store.listMissionParticipants(mission.id))
      .find((participant) => participant.id === group!.id)
    expect(currentGroup).toMatchObject({
      backfill_member_count: 1,
      backfill_completed_count: 1,
    })
    await expect(store.finishMission(mission.id)).rejects.toThrow(
      /participant history backfill checkpoint\(s\) are incomplete/i,
    )
  })
})

/** Creates a removed then backdated group re-add where the departed member has earlier coverage. */
async function createBackdatedReaddScenario(): Promise<{
  readonly store: ParticipantStore
  readonly mission: Mission
  readonly readdedGroup: Participant
}> {
  setClock('2026-08-20T09:00:00.000Z')
  const store = await createStore()
  const mission = await store.createMission({
    name: 'Backdated departed-member discrepancy mission',
    start_time: missionStart,
  })
  const [initialGroup] = await store.selectMissionParticipants({
    mission_id: mission.id,
    groups: [{
      traccar_group_id: '101',
      name: 'Kerry MRT',
      member_device_ids: ['A'],
    }],
    devices: [],
    selected_by: 'Coordinator A',
  })
  await completeCheckpoint(store, mission.id, 'A')

  setClock('2026-08-20T10:00:00.000Z')
  await store.removeMissionParticipant({
    mission_id: mission.id,
    participant_id: initialGroup!.id,
    removed_by: 'Coordinator A',
  })
  setClock('2026-08-20T11:00:00.000Z')
  const readdedGroup = await store.addMissionParticipant({
    mission_id: mission.id,
    kind: 'group',
    ref: {
      traccar_group_id: '101',
      name: 'Kerry MRT',
      member_device_ids: ['B'],
    },
    effective_from: missionStart,
    confirmed_by: 'Coordinator A',
  })
  await completeCheckpoint(store, mission.id, 'B')
  return { store, mission, readdedGroup }
}

/** Completes the pending fixed window for one device. */
async function completeCheckpoint(
  store: ParticipantStore,
  missionId: string,
  deviceId: string,
): Promise<void> {
  const checkpoint = (await store.listParticipantBackfillCheckpoints(missionId))
    .filter((candidate) => candidate.traccar_device_id === deviceId && candidate.completed === 0)
    .at(-1)
  expect(checkpoint).toBeDefined()
  await store.upsertParticipantBackfillCheckpoint({
    mission_id: missionId,
    traccar_device_id: checkpoint!.traccar_device_id,
    window_from: checkpoint!.window_from,
    window_to: checkpoint!.window_to,
    reconciled_until: checkpoint!.window_to,
    completed: true,
  })
}

/** Converts a participant row to the nullable legacy representation and reopens its store. */
async function replaceSnapshotWithLegacyNull(
  store: ParticipantStore,
  participantId: string,
): Promise<ParticipantStore> {
  const databasePath = (await store.info()).database_path
  const directory = directories.at(-1)!
  await store.prepareClose()
  store.close()
  stores = stores.filter((candidate) => candidate !== store)
  const database = new Database(databasePath)
  database.prepare(`UPDATE mission_participants
    SET starting_member_device_ids_json = NULL WHERE id = ?`).run(participantId)
  database.close()
  return reopenStore(directory)
}

/** Reopens one native mission store from an existing user-data directory. */
async function reopenStore(directory: string): Promise<ParticipantStore> {
  const store = createElectronMissionStore({ userDataPath: directory })
  stores.push(store)
  return store
}

/** Sets deterministic wall-clock time for native timestamps. */
function setClock(timestamp: string): void {
  vi.setSystemTime(new Date(timestamp))
}

/** Creates a disposable native mission store and registers it for teardown. */
async function createStore(): Promise<ParticipantStore> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sartracker-pr27-participant-'))
  directories.push(directory)
  const store = createElectronMissionStore({ userDataPath: directory })
  stores.push(store)
  return store
}
