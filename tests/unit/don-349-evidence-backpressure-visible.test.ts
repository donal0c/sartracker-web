import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDeferredMissionEvidenceQueue } from '../../src/features/tracking/deferred-mission-evidence'
import { createPollingManager, type TrackingPollerClient } from '../../src/features/tracking/polling-manager'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  TrackingConnectionStatus,
  TrackingSnapshot,
} from '../../src/features/tracking/tracking-types'

// DON-349 (audit M-83): after each published current fix the poller waits for
// room in the bounded evidence queue before fetching again. When a mission
// store write never settles, that queue never frees and the poll loop parks.
// The park must reach the operator in plain words, and the last positions
// must go stale on schedule, instead of the status staying "online" with
// positions that look current.

const NOW_MS = Date.parse('2026-04-06T10:30:10.000Z')
const DEVICE: NormalizedTrackingDevice = {
  device_id: '1',
  name: 'Unit one',
  status: 'online',
  last_seen: '2026-04-06T10:30:00.000Z',
  unique_id: 'synthetic-1',
  category: null,
}
const FIX: NormalizedTrackingPosition = {
  id: 'fix-1',
  device_id: '1',
  lat: 52.1,
  lon: -9.7,
  altitude: null,
  speed: null,
  battery: null,
  accuracy: null,
  timestamp: '2026-04-06T10:30:00.000Z',
  timestamp_source: 'fix',
  fix_time_unverified: false,
  source: 'traccar',
  data_origin: 'live',
  cache_age_seconds: null,
  device_cache_stale: false,
}

/** A Traccar client that always answers with the same single fix. */
function createClient(): TrackingPollerClient {
  return {
    authenticate: vi.fn().mockResolvedValue(undefined),
    getDevices: vi.fn().mockResolvedValue([DEVICE]),
    getCurrentPositions: vi.fn().mockResolvedValue([FIX]),
    getBreadcrumbs: vi.fn().mockResolvedValue([]),
  }
}

/** The real evidence queue as production wires it, with a store write that never settles until released. */
function startParkedPoller() {
  let release = (): void => undefined
  const blockedWrite = new Promise<void>((resolve) => { release = resolve })
  const queue = createDeferredMissionEvidenceQueue<number>({
    capacity: 8,
    beginObservation: (missionId) => ({ missionId, complete: () => undefined }),
    persist: async () => { await blockedWrite },
    markEvidenceLoss: vi.fn(),
  })
  const statuses: TrackingConnectionStatus[] = []
  const snapshots: TrackingSnapshot[] = []
  let observed = 0
  const poller = createPollingManager(createClient(), {
    intervalMs: 5_000,
    staleThresholdMs: 60_000,
    onSnapshot: (snapshot) => { snapshots.push(snapshot) },
    onCurrentSnapshot: (snapshot) => {
      snapshots.push(snapshot)
      observed += 1
      expect(queue.enqueue('mission-a', observed)).toBe(true)
      queue.requestFlushMission('mission-a')
    },
    onStatusChange: (status) => { statuses.push(status) },
    waitForCurrentEvidenceCapacity: (signal) => queue.waitForCapacity(signal),
    reserveCurrentEvidenceCapacity: (signal) => queue.reserveCapacity(signal),
  })
  poller.start()
  return { poller, queue, statuses, snapshots, release, observed: () => observed }
}

describe('[DON-349] M-83: a long wait for evidence capacity is never silent', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW_MS)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('warns that positions are not updating and re-marks the last positions stale while parked', async () => {
    const parked = startParkedPoller()

    await vi.advanceTimersByTimeAsync(180_000)

    // The loop really is parked: the queue is full and no fix was observed since.
    expect(parked.queue.pendingCount()).toBe(8)
    const observedWhileParked = parked.observed()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(parked.observed()).toBe(observedWhileParked)

    const latestStatus = parked.statuses.at(-1)!
    expect(latestStatus.warningCodes).toContain('evidence_backpressure')
    expect(latestStatus.warning).toContain('LIVE REFRESH SUSPENDED')
    expect(latestStatus.warning).toContain('not being saved')
    // The fix is now three and a half minutes old against a one-minute threshold.
    const latestSnapshot = parked.snapshots.at(-1)!
    expect(latestSnapshot.positions.map((position) => position.device_cache_stale)).toEqual([true])

    parked.release()
    await vi.advanceTimersByTimeAsync(15_000)
    await parked.poller.stop()

    expect(parked.observed()).toBeGreaterThan(observedWhileParked)
    expect(parked.statuses.at(-1)!.warningCodes ?? []).not.toContain('evidence_backpressure')
  })

  it('does not warn while the evidence queue keeps draining normally', async () => {
    const queue = createDeferredMissionEvidenceQueue<number>({
      capacity: 8,
      beginObservation: (missionId) => ({ missionId, complete: () => undefined }),
      persist: async () => undefined,
      markEvidenceLoss: vi.fn(),
    })
    const statuses: TrackingConnectionStatus[] = []
    let observed = 0
    const poller = createPollingManager(createClient(), {
      intervalMs: 5_000,
      staleThresholdMs: 60_000,
      onSnapshot: vi.fn(),
      onCurrentSnapshot: () => {
        observed += 1
        queue.enqueue('mission-a', observed)
        queue.requestFlushMission('mission-a')
      },
      onStatusChange: (status) => { statuses.push(status) },
      waitForCurrentEvidenceCapacity: (signal) => queue.waitForCapacity(signal),
      reserveCurrentEvidenceCapacity: (signal) => queue.reserveCapacity(signal),
    })
    poller.start()
    await vi.advanceTimersByTimeAsync(180_000)
    await poller.stop()

    expect(observed).toBeGreaterThan(30)
    expect(statuses.flatMap((status) => status.warningCodes ?? [])).not.toContain('evidence_backpressure')
  })
})
