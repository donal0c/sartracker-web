import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

import positionsFixture from '../fixtures/traccar-positions.json'
import { normalizeTraccarPosition } from '../../src/features/tracking/traccar-normalization'
import type { NormalizedTrackingDevice, TrackingSnapshot } from '../../src/features/tracking/tracking-types'
import type { TrackingSnapshotContext } from '../../src/features/tracking/polling-manager'
import { startTrackingRuntime } from '../../src/features/tracking/start-tracking-runtime'
import { createParticipationScope } from '../../src/features/participants/participation-scope'

// Audit M-34, carried end to end: a participant removed before the first poll
// that would have saved its device record. Its fix from inside its participant
// window reaches the real store through the live tracking runtime, is saved,
// and no extra participant appears.

type Participant = Parameters<typeof createParticipationScope>[0]['participants'][number]

type RealStore = {
  readonly close: () => void
  readonly createMission: (input: { readonly name: string; readonly start_time?: string }) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: Record<string, unknown>) => Promise<unknown>
  readonly listDevices: (missionId: string) => Promise<readonly { readonly device_id: string }[]>
  readonly persistTrackingPositionsBulk: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  readonly addMissionParticipant: (input: Record<string, unknown>) => Promise<{ readonly id: string }>
  readonly removeMissionParticipant: (input: Record<string, unknown>) => Promise<unknown>
  readonly listMissionParticipants: (missionId: string) => Promise<readonly Participant[]>
  readonly countPositions: (missionId: string, deviceId?: string) => Promise<number>
}

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => RealStore
}

const TEMPLATE = normalizeTraccarPosition(positionsFixture[0]!, 'live')

let userDataPath: string | undefined
let store: RealStore | undefined
let stopRuntime: (() => Promise<void>) | undefined

afterEach(async () => {
  await stopRuntime?.()
  stopRuntime = undefined
  store?.close()
  store = undefined
  if (userDataPath !== undefined) {
    await rm(userDataPath, { recursive: true, force: true })
    userDataPath = undefined
  }
})

function device(deviceId: string): NormalizedTrackingDevice {
  return {
    id: deviceId,
    device_id: deviceId,
    name: `Tracker ${deviceId}`,
    status: 'online',
    last_update: new Date().toISOString(),
  } as NormalizedTrackingDevice
}

describe('participant removed before its first saved poll, through the runtime [M-34]', () => {
  it('saves its in-window fix in the real store without adding a participant', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-removed-participant-'))
    const realStore = createElectronMissionStore({ userDataPath })
    store = realStore
    const nowMs = Date.now()
    const mission = await realStore.createMission({
      name: 'Removed Participant',
      start_time: new Date(nowMs - 60 * 60_000).toISOString(),
    })
    await realStore.addMissionParticipant({
      mission_id: mission.id,
      kind: 'device',
      ref: 'removed',
      confirmed_by: 'Coordinator',
      effective_from: new Date(nowMs - 120_000).toISOString(),
    })
    const [added] = await realStore.listMissionParticipants(mission.id)
    await realStore.removeMissionParticipant({
      mission_id: mission.id,
      participant_id: added!.id,
      removed_by: 'Coordinator',
    })
    const participants = await realStore.listMissionParticipants(mission.id)
    expect(participants).toHaveLength(1)
    await expect(realStore.listDevices(mission.id)).resolves.toEqual([])

    let hooks: {
      readonly onSnapshot: (snapshot: TrackingSnapshot, context?: TrackingSnapshotContext) => void | Promise<void>
      readonly onStatusChange: (status: Record<string, unknown>) => void
    } | undefined
    stopRuntime = await startTrackingRuntime({
      config: { baseUrl: 'http://synthetic.invalid' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, pollerHooks) => {
        hooks = pollerHooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
      missionStore: {
        getActiveMission: vi.fn().mockResolvedValue({ id: mission.id }),
        listPositions: vi.fn().mockResolvedValue([]),
        listDevices: (missionId) => realStore.listDevices(missionId),
        upsertDevice: (input) => realStore.upsertDevice(input),
        addPosition: vi.fn().mockRejectedValue(new Error('per-row writer must not be used')),
        persistTrackingPositionsBulk: (input) => realStore.persistTrackingPositionsBulk(input) as never,
      },
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      writeCache: false,
      missionModelEnabled: true,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      readParticipationScope: () => createParticipationScope({ participants, membershipEvents: [] }),
      readParticipationScopeMissionId: () => mission.id,
      readParticipationScopeStatus: () => 'ready',
      subscribeParticipationScope: () => () => undefined,
    })
    hooks!.onStatusChange({
      mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: null,
    })

    // A fix from inside the removed participant's window, first seen after removal.
    const fix = {
      ...TEMPLATE,
      id: 'removed-in-window',
      device_id: 'removed',
      lat: 52.1,
      lon: -9.6,
      timestamp: new Date(nowMs - 60_000).toISOString(),
      timestamp_source: 'fix' as const,
    }
    await hooks!.onSnapshot(
      { devices: [device('removed')], positions: [], breadcrumbs: [fix], rawBreadcrumbsForPersistence: [fix] },
      { historyResetKey: mission.id },
    )

    await vi.waitFor(async () =>
      expect(await realStore.countPositions(mission.id, 'removed')).toBe(1), { timeout: 3_000 })
    expect((await realStore.listDevices(mission.id)).map((entry) => entry.device_id)).toEqual(['removed'])
    expect(await realStore.listMissionParticipants(mission.id)).toHaveLength(1)
  })
})
