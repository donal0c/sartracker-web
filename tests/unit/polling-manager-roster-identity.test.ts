import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import breadcrumbsFixture from '../fixtures/traccar-breadcrumbs.json'
import { createPollingManager, type TrackingPollerClient } from '../../src/features/tracking/polling-manager'
import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from '../../src/features/tracking/traccar-normalization'
import type { NormalizedTrackingDevice, NormalizedTrackingPosition } from '../../src/features/tracking/tracking-types'

/**
 * DON-300 item 8 escape (box run 5a, 2 Oct 2026): one blank KMRT listing
 * recorded 8 "left" events, and each walker lost the fix inside the false
 * leave. The participant runtime confirms an absence on the second complete
 * roster, but one poll delivers the same /api/devices fetch on more than one
 * snapshot (current positions, then history), so a single blank listing was
 * counted twice. Each delivery must say which roster fetch it carries, so the
 * runtime can tell a repeat from a second roster.
 */
const DEVICES = devicesFixture.map((device) => normalizeTraccarDevice(device)) as readonly NormalizedTrackingDevice[]
const POSITIONS = positionsFixture.map((position) => normalizeTraccarPosition(position, 'live')) as readonly NormalizedTrackingPosition[]
const BREADCRUMBS = breadcrumbsFixture.map((position) => normalizeTraccarPosition(position, 'live')) as readonly NormalizedTrackingPosition[]

type Delivery = { readonly devices: number, readonly rosterObservationId: unknown, readonly authoritative: boolean }

describe('roster deliveries carry the fetch they came from [DON-300]', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('labels every authoritative delivery of one /api/devices fetch with the same roster observation', async () => {
    const getDevicesWithReport = vi.fn().mockResolvedValue({ accepted: DEVICES, complete: true })
    const client: TrackingPollerClient = {
      authenticate: vi.fn().mockResolvedValue(undefined),
      getDevices: vi.fn().mockResolvedValue(DEVICES),
      getDevicesWithReport,
      getCurrentPositions: vi.fn().mockResolvedValue(POSITIONS),
      getBreadcrumbs: vi.fn().mockResolvedValue(BREADCRUMBS),
    }
    const deliveries: Delivery[] = []
    const record = (snapshot: { devices: readonly unknown[] }, context?: Record<string, unknown>) => {
      deliveries.push({
        devices: snapshot.devices.length,
        rosterObservationId: context?.rosterObservationId,
        authoritative: context?.participantRosterAuthoritative !== false,
      })
    }
    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 60 * 60 * 1000,
      getHistoryResetKey: () => 'mission-1',
      getInitialBreadcrumbFrom: () => new Date('2026-04-04T10:00:00.000Z'),
      onSnapshot: record,
      onCurrentSnapshot: (snapshot, context, observation) => {
        record(snapshot, context as unknown as Record<string, unknown>)
        observation?.complete?.()
      },
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(10)
    poller.stop()

    expect(getDevicesWithReport).toHaveBeenCalledTimes(1)
    const rosters = deliveries.filter((delivery) => delivery.authoritative && delivery.devices > 0)
    // The escape: one fetch reaches the participant runtime as more than one roster.
    expect(rosters.length, JSON.stringify(deliveries)).toBeGreaterThan(1)
    // The fix: every such delivery names the one fetch it came from.
    expect(rosters.every((delivery) => typeof delivery.rosterObservationId === 'string')).toBe(true)
    expect(new Set(rosters.map((delivery) => delivery.rosterObservationId)).size).toBe(1)
  })

  it('keeps a replayed device list labelled with the fetch it came from, not the latest one', async () => {
    // Codex review: blank roster A, then complete roster B whose current
    // positions fail. The fallback replays the last good snapshot (A's list);
    // labelled with B's fetch it would confirm A's absence.
    let listing = 0
    const getDevicesWithReport = vi.fn(async () => {
      listing += 1
      return { accepted: listing === 2 ? [DEVICES[0]!] : [...DEVICES], complete: true }
    })
    const getCurrentPositions = vi.fn(async () => {
      if (listing === 3) throw new Error('current positions failed')
      return POSITIONS
    })
    const client: TrackingPollerClient = {
      authenticate: vi.fn().mockResolvedValue(undefined),
      getDevices: vi.fn(async () => (await getDevicesWithReport()).accepted),
      getDevicesWithReport,
      getCurrentPositions,
      getBreadcrumbs: vi.fn().mockResolvedValue(BREADCRUMBS),
    }
    const deliveries: { ids: string, rosterObservationId: unknown, authoritative: boolean }[] = []
    const record = (snapshot: { devices: readonly { device_id: string }[] }, context?: Record<string, unknown>) => {
      deliveries.push({
        ids: snapshot.devices.map((device) => device.device_id).sort().join(','),
        rosterObservationId: context?.rosterObservationId,
        authoritative: context?.participantRosterAuthoritative !== false,
      })
    }
    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: record,
      onCurrentSnapshot: (snapshot, context, observation) => {
        record(snapshot, context as unknown as Record<string, unknown>)
        observation?.complete?.()
      },
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    for (let poll = 0; poll < 3; poll += 1) await vi.advanceTimersByTimeAsync(30_000)
    poller.stop()

    expect(listing).toBeGreaterThanOrEqual(3)
    const authoritative = deliveries.filter((delivery) => delivery.authoritative)
    // Every fetch id labels exactly one device list.
    const listsById = new Map<unknown, Set<string>>()
    for (const delivery of authoritative) {
      listsById.set(delivery.rosterObservationId, (listsById.get(delivery.rosterObservationId) ?? new Set()).add(delivery.ids))
    }
    expect([...listsById.values()].every((lists) => lists.size === 1), JSON.stringify(deliveries)).toBe(true)
    // The blank list was replayed after B's fetch, still under A's id.
    const blank = DEVICES[0]!.device_id
    const blankIds = new Set(authoritative.filter((delivery) => delivery.ids === blank).map((delivery) => delivery.rosterObservationId))
    expect(blankIds.size, JSON.stringify(deliveries)).toBe(1)
  })
})
