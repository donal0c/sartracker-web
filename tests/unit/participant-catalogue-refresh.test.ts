import { describe, expect, it, vi } from 'vitest'

import { startParticipantRuntime } from '../../src/features/participants/start-participant-runtime'
import type { ParticipantRuntimeState } from '../../src/features/participants/participant-store'
import type {
  ParticipantCatalogue,
  ParticipantCatalogueSource,
} from '../../src/features/participants/participant-catalogue'
import { createParticipantSelectionViewModel } from '../../src/features/participants/use-participant-selection-view-model'

const KMRT = { group_id: 'group-kmrt', name: 'KMRT', parent_group_id: null }
const MISC = { group_id: 'group-misc', name: 'Miscellaneous', parent_group_id: null }

function device(deviceId: string, groupId: string | null) {
  return {
    device_id: deviceId, name: `Device ${deviceId}`, status: 'online' as const,
    last_seen: '2026-10-01T11:00:00.000Z', unique_id: `unique-${deviceId}`, category: null, group_id: groupId,
  }
}

function createStore() {
  return {
    selectMissionParticipants: vi.fn().mockResolvedValue([]),
    addMissionParticipant: vi.fn(),
    removeMissionParticipant: vi.fn(),
    listMissionParticipants: vi.fn().mockResolvedValue([]),
    recordGroupMembershipEvents: vi.fn().mockResolvedValue([]),
    listGroupMembershipEvents: vi.fn().mockResolvedValue([]),
    listParticipantBackfillCheckpoints: vi.fn().mockResolvedValue([]),
  }
}

const KMRT_ONLY: ParticipantCatalogue = {
  groups: [KMRT], devices: [device('k1', KMRT.group_id)], rosterComplete: true,
}
const WITH_MISC: ParticipantCatalogue = {
  groups: [KMRT, MISC], devices: [device('k1', KMRT.group_id), device('m1', MISC.group_id)], rosterComplete: true,
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

async function setup(initialSource: ParticipantCatalogueSource | null) {
  const states: ParticipantRuntimeState[] = []
  const store = createStore()
  let source = initialSource
  const runtime = await startParticipantRuntime({
    participantStore: store,
    applyRuntime: (state) => states.push(state),
    readCatalogueSource: () => source,
  })
  await runtime.applyRoster(KMRT_ONLY.devices, '2026-10-01T11:00:00.000Z')
  runtime.applyGroups(KMRT_ONLY.groups)
  return {
    runtime, store, latest: () => states.at(-1)!,
    setSource: (next: ParticipantCatalogueSource | null) => { source = next },
  }
}

describe('Traccar catalogue refresh [DON-330]', () => {
  it('exposes a group added on the server after startup, without selecting or enrolling anything', async () => {
    const { runtime, store, latest } = await setup(async () => WITH_MISC)
    runtime.toggleDraftGroup(KMRT.group_id)

    await runtime.refreshCatalogue()

    expect(latest().availableGroups.map((group) => group.name)).toEqual(['KMRT', 'Miscellaneous'])
    expect(latest().draftGroupIds).toEqual([KMRT.group_id])
    expect(latest().draftDeviceIds).toEqual([])
    expect(latest().catalogueRefreshing).toBe(false)
    expect(latest().catalogueError).toBeNull()
    expect(store.selectMissionParticipants).not.toHaveBeenCalled()
    expect(store.addMissionParticipant).not.toHaveBeenCalled()
    expect(store.recordGroupMembershipEvents).not.toHaveBeenCalled()
  })

  it('selecting the new group explicitly adds only its own members', async () => {
    const { runtime, latest } = await setup(async () => WITH_MISC)
    await runtime.refreshCatalogue()

    runtime.toggleDraftGroup(MISC.group_id)

    const view = createParticipantSelectionViewModel({ ...latest(), controller: runtime })
    expect(view.selectedDeviceCount).toBe(1)
    expect(view.availableDevices.filter((entry) => entry.selected).map((entry) => entry.deviceId)).toEqual(['m1'])
  })

  it('shows a loading state while the refresh is in flight', async () => {
    const pending = deferred<ParticipantCatalogue | null>()
    const { runtime, latest } = await setup(() => pending.promise)

    const refresh = runtime.refreshCatalogue()
    expect(latest().catalogueRefreshing).toBe(true)
    pending.resolve(WITH_MISC)
    await refresh

    expect(latest().catalogueRefreshing).toBe(false)
  })

  it('reports a failed refresh as an error, keeps the existing choices and recovers on retry', async () => {
    const { runtime, latest, setSource } = await setup(async () => { throw new Error('connection refused') })

    await runtime.refreshCatalogue()

    expect(latest().catalogueError).toContain('connection refused')
    expect(latest().catalogueRefreshing).toBe(false)
    expect(latest().availableGroups.map((group) => group.name)).toEqual(['KMRT'])

    setSource(async () => WITH_MISC)
    await runtime.refreshCatalogue()
    expect(latest().catalogueError).toBeNull()
    expect(latest().availableGroups.map((group) => group.name)).toEqual(['KMRT', 'Miscellaneous'])
  })

  it('fails visibly when no tracking connection can supply the catalogue', async () => {
    const { runtime, latest } = await setup(null)

    await runtime.refreshCatalogue()

    expect(latest().catalogueError).toMatch(/tracking/iu)
    expect(latest().availableGroups.map((group) => group.name)).toEqual(['KMRT'])
  })

  it('treats a superseded source answer as a visible error rather than an empty list', async () => {
    const { runtime, latest } = await setup(async () => null)

    await runtime.refreshCatalogue()

    expect(latest().catalogueError).toMatch(/changed/iu)
    expect(latest().availableGroups.map((group) => group.name)).toEqual(['KMRT'])
  })

  it('discards an older response that arrives after a newer refresh', async () => {
    const older = deferred<ParticipantCatalogue | null>()
    const newer = deferred<ParticipantCatalogue | null>()
    const answers = [older, newer]
    const { runtime, latest } = await setup(() => answers.shift()!.promise)

    const first = runtime.refreshCatalogue()
    const second = runtime.refreshCatalogue()
    newer.resolve(WITH_MISC)
    await second
    older.resolve({ groups: [], devices: [], rosterComplete: true })
    await first

    expect(latest().availableGroups.map((group) => group.name)).toEqual(['KMRT', 'Miscellaneous'])
    expect(latest().catalogueRefreshing).toBe(false)
    expect(latest().catalogueError).toBeNull()
  })

  it('discards a response that lands after the mission changed', async () => {
    const pending = deferred<ParticipantCatalogue | null>()
    const { runtime, latest } = await setup(() => pending.promise)

    const refresh = runtime.refreshCatalogue()
    await runtime.refreshMission('mission-2')
    pending.resolve(WITH_MISC)
    await refresh

    expect(latest().availableGroups.map((group) => group.name)).toEqual(['KMRT'])
    expect(latest().catalogueRefreshing).toBe(false)
  })

  it('discards a response from a connection that was replaced during the refresh', async () => {
    const pending = deferred<ParticipantCatalogue | null>()
    const { runtime, latest, setSource } = await setup(() => pending.promise)

    const refresh = runtime.refreshCatalogue()
    setSource(async () => KMRT_ONLY)
    pending.resolve(WITH_MISC)
    await refresh

    expect(latest().availableGroups.map((group) => group.name)).toEqual(['KMRT'])
  })

  it('in a running mission updates group choices only and leaves the roster, participants and draft alone', async () => {
    const { runtime, store, latest } = await setup(async () => WITH_MISC)
    await runtime.refreshMission('mission-1')
    const participantsBefore = latest().participants

    await runtime.refreshCatalogue()

    expect(latest().availableGroups.map((group) => group.name)).toEqual(['KMRT', 'Miscellaneous'])
    expect(latest().availableDevices.map((entry) => entry.device_id)).toEqual(['k1'])
    expect(latest().participants).toBe(participantsBefore)
    expect(store.addMissionParticipant).not.toHaveBeenCalled()
    expect(store.recordGroupMembershipEvents).not.toHaveBeenCalled()
  })
})
