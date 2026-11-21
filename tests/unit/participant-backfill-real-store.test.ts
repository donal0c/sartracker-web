import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

import positionsFixture from '../fixtures/traccar-positions.json'
import { normalizeTraccarPosition } from '../../src/features/tracking/traccar-normalization'
import type { BreadcrumbNormalizationResult } from '../../src/features/tracking/traccar-client'
import type { TrackingConnectionStatus } from '../../src/features/tracking/tracking-types'
import { startTrackingRuntime } from '../../src/features/tracking/start-tracking-runtime'
import { createParticipationScope } from '../../src/features/participants/participation-scope'

// DON-338 review findings 3 and 4: participant history backfill runs against
// the real mission store. One device whose history cannot be fetched must not
// starve the others, and a fix the store refuses must reach the operator.

type ParticipantCheckpoint = {
  readonly mission_id: string
  readonly traccar_device_id: string
  readonly window_from: string
  readonly window_to: string
  readonly reconciled_until: string
  readonly completed: number
  readonly updated_at: string
}

type RealStore = {
  readonly close: () => void
  readonly createMission: (input: { readonly name: string; readonly start_time?: string }) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: Record<string, unknown>) => Promise<unknown>
  readonly listDevices: (missionId: string) => Promise<readonly { readonly device_id: string }[]>
  readonly persistTrackingPositionsBulk: (input: Record<string, unknown>) => Promise<{
    readonly changedPositionCount: number
    readonly insertedPositionCount: number
    readonly skippedAmbiguousLegacyAdoptionCount: number
    readonly rejectedPositionCount: number
    readonly sourceIdentityConflictCount: number
  }>
  readonly upsertParticipantBackfillCheckpoint: (input: {
    readonly mission_id: string
    readonly traccar_device_id: string
    readonly window_from: string
    readonly window_to: string
    readonly reconciled_until: string
    readonly completed: boolean
  }) => Promise<ParticipantCheckpoint>
  readonly listParticipantBackfillCheckpoints: (missionId: string) => Promise<readonly ParticipantCheckpoint[]>
  readonly countPositions: (missionId: string, deviceId?: string) => Promise<number>
}

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => RealStore
}

const TEMPLATE = normalizeTraccarPosition(positionsFixture[0]!, 'live')
const HOUR_MS = 60 * 60 * 1_000

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

/** One accepted history fix for a device at a time. */
function historyFix(deviceId: string, timestampMs: number, id: string, lat = 52) {
  return {
    ...TEMPLATE,
    id,
    device_id: deviceId,
    lat,
    lon: -9.7,
    timestamp: new Date(timestampMs).toISOString(),
    timestamp_source: 'fix' as const,
  }
}

/**
 * Starts the runtime with the real store, two participant devices and their
 * one-hour backfill windows, then makes the participant scope ready.
 */
async function startBackfill(
  getBreadcrumbsWithReport: (deviceId: string, from: Date, to: Date) => Promise<BreadcrumbNormalizationResult>,
): Promise<{
  readonly missionId: string
  readonly realStore: RealStore
  readonly windowFromMs: number
  readonly statuses: TrackingConnectionStatus[]
  readonly warn: ReturnType<typeof vi.fn>
}> {
  userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-participant-backfill-'))
  const realStore = createElectronMissionStore({ userDataPath })
  store = realStore
  const windowFromMs = Date.now() - 3 * HOUR_MS
  const mission = await realStore.createMission({
    name: 'Participant Backfill Real Store',
    start_time: new Date(windowFromMs).toISOString(),
  })
  for (const deviceId of ['1', '2']) {
    await realStore.upsertDevice({
      mission_id: mission.id, device_id: deviceId, name: `Tracker ${deviceId}`, color: '#ff0000', status: 'online',
    })
    await realStore.upsertParticipantBackfillCheckpoint({
      mission_id: mission.id,
      traccar_device_id: deviceId,
      window_from: new Date(windowFromMs).toISOString(),
      window_to: new Date(windowFromMs + HOUR_MS).toISOString(),
      reconciled_until: new Date(windowFromMs).toISOString(),
      completed: false,
    })
  }
  const statuses: TrackingConnectionStatus[] = []
  const warn = vi.fn()
  let notifyScopeChanged: ((reason?: 'scope' | 'status') => void) | undefined
  let scopeStatus: 'loading' | 'ready' = 'loading'
  let hooks: { readonly onStatusChange: (status: TrackingConnectionStatus) => void } | undefined
  stopRuntime = await startTrackingRuntime({
    config: { baseUrl: 'http://synthetic.invalid' },
    createClient: vi.fn().mockReturnValue({ getBreadcrumbsWithReport }),
    createPoller: vi.fn().mockImplementation((_client, pollerHooks) => {
      hooks = pollerHooks
      return { start: vi.fn(), stop: vi.fn(), requestPollNow: vi.fn() }
    }),
    cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
    missionStore: {
      getActiveMission: vi.fn().mockResolvedValue({ id: mission.id }),
      listPositions: vi.fn().mockResolvedValue([]),
      listDevices: (missionId) => realStore.listDevices(missionId),
      upsertDevice: (input) => realStore.upsertDevice(input),
      addPosition: vi.fn().mockRejectedValue(new Error('per-row writer must not be used')),
      persistTrackingPositionsBulk: (input) => realStore.persistTrackingPositionsBulk(input),
      listParticipantBackfillCheckpoints: (missionId) => realStore.listParticipantBackfillCheckpoints(missionId),
      upsertParticipantBackfillCheckpoint: (input) => realStore.upsertParticipantBackfillCheckpoint(input),
    },
    applySnapshot: vi.fn(),
    applyStatus: (status) => { statuses.push(status) },
    writeCache: false,
    missionModelEnabled: true,
    logger: { info: vi.fn(), warn, error: vi.fn() },
    readParticipationScope: () => createParticipationScope({ participants: [], membershipEvents: [] }),
    readParticipationScopeMissionId: () => mission.id,
    readParticipationScopeStatus: () => scopeStatus,
    subscribeParticipationScope: (listener) => {
      notifyScopeChanged = listener
      return () => undefined
    },
  })
  hooks!.onStatusChange({
    mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: null,
  })
  scopeStatus = 'ready'
  notifyScopeChanged?.('status')
  return { missionId: mission.id, realStore, windowFromMs, statuses, warn }
}

/** The durable checkpoint for one device. */
async function checkpointOf(realStore: RealStore, missionId: string, deviceId: string) {
  const checkpoints = await realStore.listParticipantBackfillCheckpoints(missionId)
  return checkpoints.find((checkpoint) => checkpoint.traccar_device_id === deviceId)
}

describe('participant history backfill with the real mission store [DON-338]', () => {
  it('backfills a healthy device while another device keeps failing (finding 3)', async () => {
    const calls: string[] = []
    const runtime = await startBackfill(async (deviceId, from) => {
      calls.push(deviceId)
      if (deviceId === '1') throw new Error('Traccar request failed with status 503.')
      return { accepted: [historyFix(deviceId, from.getTime() + 60_000, `${deviceId}-a`)], rejected: [] }
    })

    await vi.waitFor(async () => {
      expect((await checkpointOf(runtime.realStore, runtime.missionId, '2'))?.completed).toBe(1)
    }, { timeout: 3_000 })
    await expect(runtime.realStore.countPositions(runtime.missionId, '2')).resolves.toBe(1)
    // The failing device stays incomplete and truthful: its cursor never moved.
    const stuck = await checkpointOf(runtime.realStore, runtime.missionId, '1')
    expect(stuck?.completed).toBe(0)
    expect(stuck?.reconciled_until).toBe(new Date(runtime.windowFromMs).toISOString())
    expect(calls).toContain('1')
    expect(runtime.warn).toHaveBeenCalledWith(
      expect.stringMatching(/participant history backfill/i),
      expect.anything(),
    )
  })

  it('tells the operator when mission storage refuses a backfilled fix (finding 4)', async () => {
    const runtime = await startBackfill(async (deviceId, from) => ({
      accepted: [
        historyFix(deviceId, from.getTime() + 60_000, `${deviceId}-good`),
        // Out of range: the store refuses it and records the refusal.
        historyFix(deviceId, from.getTime() + 120_000, `${deviceId}-bad`, 999),
      ],
      rejected: [],
    }))

    await vi.waitFor(() => expect(runtime.statuses.at(-1)?.warningCodes)
      .toContain('mission_storage_rows_rejected'), { timeout: 3_000 })
    expect(runtime.statuses.at(-1)!.warning).toMatch(/2 fixes were refused by mission storage/i)
    await vi.waitFor(async () => {
      expect((await checkpointOf(runtime.realStore, runtime.missionId, '2'))?.completed).toBe(1)
    })
    // Unchanged behaviour (open decision): the checkpoint still moves past a refused fix.
    expect((await checkpointOf(runtime.realStore, runtime.missionId, '1'))?.completed).toBe(1)
    await expect(runtime.realStore.countPositions(runtime.missionId)).resolves.toBe(2)
  })
})
