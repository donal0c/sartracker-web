import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from '../../src/features/tracking/traccar-normalization'
import type { TrackingConnectionStatus, TrackingSnapshot } from '../../src/features/tracking/tracking-types'
import { startTrackingRuntime } from '../../src/features/tracking/start-tracking-runtime'
import type { TrackingSnapshotContext } from '../../src/features/tracking/polling-manager'

// DON-338 piece 3: the real snapshot persist loop against the real mission
// store. One bad fix must not stop the other fixes of its 256-row piece from
// being saved, and both a refused fix and a reused Traccar position id must
// reach the operator through the tracking status.

type RealStore = {
  readonly close: () => void
  readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: Record<string, unknown>) => Promise<unknown>
  readonly persistTrackingPositionsBulk: (input: Record<string, unknown>) => Promise<{
    readonly changedPositionCount: number
    readonly insertedPositionCount: number
    readonly skippedAmbiguousLegacyAdoptionCount: number
    readonly rejectedPositionCount: number
    readonly sourceIdentityConflictCount: number
  }>
  readonly countPositions: (missionId: string) => Promise<number>
  readonly listIngestAnomalies: (missionId: string) => Promise<readonly { readonly kind: string }[]>
}

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => RealStore
}

const DEVICES = devicesFixture.map((device) => normalizeTraccarDevice(device))
const TEMPLATE = positionsFixture.map((position) => normalizeTraccarPosition(position, 'live'))[0]!

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

/** Builds a snapshot of unseen breadcrumbs for the template device. */
function snapshotOf(count: number, prefix: string): TrackingSnapshot {
  const breadcrumbs = Array.from({ length: count }, (_, index) => ({
    ...TEMPLATE,
    id: `${prefix}-${index}`,
    lat: 52 + index * 1e-6,
    lon: -9.7 - index * 1e-6,
    timestamp: new Date(Date.parse('2026-04-06T08:00:00.000Z') + index * 1_000).toISOString(),
  }))
  return { devices: DEVICES, positions: [], breadcrumbs, rawBreadcrumbsForPersistence: breadcrumbs }
}

/** Starts the tracking runtime with the real store as its only position writer. */
async function startWithRealStore(): Promise<{
  readonly missionId: string
  readonly realStore: RealStore
  readonly deliver: (snapshot: TrackingSnapshot) => Promise<void> | void
  readonly statuses: TrackingConnectionStatus[]
  readonly recordMissionEvidenceLoss: ReturnType<typeof vi.fn>
}> {
  userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-runtime-write-integrity-'))
  const realStore = createElectronMissionStore({ userDataPath })
  store = realStore
  const mission = await realStore.createMission({ name: 'Runtime Write Integrity' })
  const statuses: TrackingConnectionStatus[] = []
  const recordMissionEvidenceLoss = vi.fn().mockResolvedValue(undefined)
  let hooks:
    | {
        readonly onSnapshot: (snapshot: TrackingSnapshot, context?: TrackingSnapshotContext) => void | Promise<void>
        readonly onStatusChange: (status: TrackingConnectionStatus) => void
      }
    | undefined
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
      upsertDevice: (input) => realStore.upsertDevice(input),
      addPosition: vi.fn().mockRejectedValue(new Error('per-row writer must not be used')),
      persistTrackingPositionsBulk: (input) => realStore.persistTrackingPositionsBulk(input),
    },
    applySnapshot: vi.fn(),
    applyStatus: (status) => { statuses.push(status) },
    writeCache: false,
    recordMissionEvidenceLoss,
  })
  hooks!.onStatusChange({
    mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: null,
  })
  return {
    missionId: mission.id,
    realStore,
    deliver: (snapshot) => hooks!.onSnapshot(snapshot, { historyResetKey: mission.id }),
    statuses,
    recordMissionEvidenceLoss,
  }
}

describe('tracking persist loop with the real mission store [DON-338]', () => {
  it('saves every good fix around one bad fix, makes progress, and warns the operator (STO-3)', async () => {
    const runtime = await startWithRealStore()
    const snapshot = snapshotOf(300, 'traccar')
    const bad = { ...snapshot.breadcrumbs[10]!, lat: 999 }
    const breadcrumbs = snapshot.breadcrumbs.map((fix, index) => index === 10 ? bad : fix)
    const withBadFix = { ...snapshot, breadcrumbs, rawBreadcrumbsForPersistence: breadcrumbs }

    await runtime.deliver(withBadFix)
    await vi.waitFor(async () =>
      expect(await runtime.realStore.countPositions(runtime.missionId)).toBe(299))
    // The same snapshot again neither fails nor re-sends what was settled.
    await runtime.deliver(withBadFix)

    await vi.waitFor(() => expect(runtime.statuses.at(-1)?.warningCodes)
      .toContain('mission_storage_rows_rejected'))
    const latest = runtime.statuses.at(-1)!
    expect(latest.warningCodes).not.toContain('mission_storage_failed')
    expect(latest.warning).toMatch(/1 fix was refused by mission storage/i)
    expect(runtime.recordMissionEvidenceLoss).not.toHaveBeenCalled()
    await expect(runtime.realStore.countPositions(runtime.missionId)).resolves.toBe(299)
    await expect(runtime.realStore.listIngestAnomalies(runtime.missionId)).resolves.toEqual([
      expect.objectContaining({ kind: 'rejected' }),
    ])
  })

  it('tells the operator when the tracking server reused a stored position id (STO-1)', async () => {
    const runtime = await startWithRealStore()
    const first = snapshotOf(3, 'traccar')
    await runtime.deliver(first)
    await vi.waitFor(async () =>
      expect(await runtime.realStore.countPositions(runtime.missionId)).toBe(3))

    // A reset server starts numbering again: same id, a different fix.
    const reused = {
      ...first.breadcrumbs[0]!,
      lat: 53.4,
      timestamp: '2026-04-06T12:00:00.000Z',
    }
    await runtime.deliver({ ...first, breadcrumbs: [reused], rawBreadcrumbsForPersistence: [reused] })

    await vi.waitFor(() => expect(runtime.statuses.at(-1)?.warningCodes)
      .toContain('source_position_id_reused'))
    expect(runtime.statuses.at(-1)!.warning).toMatch(/1 position id was reused/i)
    await expect(runtime.realStore.countPositions(runtime.missionId)).resolves.toBe(3)
  })
})
