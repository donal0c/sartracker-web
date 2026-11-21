import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import breadcrumbsFixture from '../fixtures/traccar-breadcrumbs.json'
import { createPollingManager, type TrackingPollerClient } from '../../src/features/tracking/polling-manager'
import { normalizeTraccarDevice, normalizeTraccarPosition } from '../../src/features/tracking/traccar-normalization'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from '../../src/features/tracking/tracking-types'

// [DON-338] A history refresh still in flight when the mission pauses must
// never replace the paused status with "online". It may update the stored
// warnings, and re-publish the paused status when its text changes.

const DEVICES = devicesFixture.map((device) => normalizeTraccarDevice(device)) as readonly NormalizedTrackingDevice[]
const POSITIONS = positionsFixture.map((position) => normalizeTraccarPosition(position, 'live')) as readonly NormalizedTrackingPosition[]
const BREADCRUMBS = breadcrumbsFixture.map((position) => normalizeTraccarPosition(position, 'live')) as readonly NormalizedTrackingPosition[]

type PublishedStatus = { readonly mode: string; readonly warning: string | null }

describe('[DON-338] history settling after a pause', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  /**
   * Runs a poller whose first history snapshot render is held, pauses the
   * mission while it is held, then lets it settle.
   */
  async function pauseWhileHistoryRenders(outcome: 'resolve' | 'reject') {
    let pollingMode: 'active' | 'paused' = 'active'
    let settleRender: (ok: boolean) => void = () => undefined
    let held = false
    const onSnapshot = vi.fn((snapshot: TrackingSnapshot) => {
      if (snapshot.breadcrumbs.length === 0 || held) return undefined
      held = true
      return new Promise<void>((resolve, reject) => {
        settleRender = (ok) => { if (ok) resolve(); else reject(new Error('history render failed')) }
      })
    })
    const statuses: PublishedStatus[] = []
    const client: TrackingPollerClient = {
      authenticate: vi.fn().mockResolvedValue(undefined),
      getDevices: vi.fn().mockResolvedValue(DEVICES),
      getCurrentPositions: vi.fn().mockResolvedValue(POSITIONS),
      getBreadcrumbs: vi.fn().mockResolvedValue(BREADCRUMBS),
    }
    const poller = createPollingManager(client, {
      // No poll runs between the pause and the settle: the history task is
      // the next publisher.
      intervalMs: 30 * 60 * 1000,
      staleThresholdMs: 60 * 60 * 1000,
      getHistoryResetKey: () => 'mission-1',
      getPollingMode: () => pollingMode,
      getInitialBreadcrumbFrom: () => new Date('2026-04-04T10:00:00.000Z'),
      onSnapshot,
      onStatusChange: (status: PublishedStatus) => { statuses.push(status) },
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })
    poller.start()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(held).toBe(true)
    expect(statuses.at(-1)?.mode).toBe('online')
    const pausedAt = statuses.length

    pollingMode = 'paused'
    settleRender(outcome === 'resolve')
    await vi.advanceTimersByTimeAsync(1_000)
    await poller.stop()
    return { statuses, afterPause: statuses.slice(pausedAt) }
  }

  it('publishes the paused status, never "online", when the history render settles after the pause', async () => {
    const { statuses, afterPause } = await pauseWhileHistoryRenders('resolve')
    expect(afterPause.filter((status) => status.mode === 'online')).toEqual([])
    expect(statuses.at(-1)?.mode).toBe('idle')
    expect(statuses.at(-1)?.warning ?? '').toMatch(/^Live refresh suspended while mission is paused\./u)
    expect(statuses.at(-1)?.warning ?? '').not.toContain('current fixes remain live')
  })

  it('never publishes "online" when the history render fails after the pause', async () => {
    const { afterPause } = await pauseWhileHistoryRenders('reject')
    expect(afterPause.filter((status) => status.mode === 'online')).toEqual([])
  })
})
