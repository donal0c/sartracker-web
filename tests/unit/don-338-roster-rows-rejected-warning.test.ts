import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import breadcrumbsFixture from '../fixtures/traccar-breadcrumbs.json'
import {
  createTraccarClient,
  type TraccarFetch,
} from '../../src/features/tracking/traccar-client'
import {
  createIncompleteRosterWarning,
  fetchRosterAndCurrentPositions,
} from '../../src/features/tracking/current-position-poll'
import { createPollingManager, type TrackingPollerClient } from '../../src/features/tracking/polling-manager'
import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from '../../src/features/tracking/traccar-normalization'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
} from '../../src/features/tracking/tracking-types'

// ING-4 [DON-338]: a device row Traccar returns malformed is dropped from the
// roster. The operator must be told, in plain words, that a tracker may be
// missing, through the existing roster warning on the tracking status. The
// warning counts the unreadable entries; it never names or invents a device.

const ONE_UNREADABLE =
  'DEVICE ROSTER INCOMPLETE — 1 device entry from Traccar could not be read, so a tracker may be missing from the map. Check the device list in Traccar.'
const TWO_UNREADABLE =
  'DEVICE ROSTER INCOMPLETE — 2 device entries from Traccar could not be read, so trackers may be missing from the map. Check the device list in Traccar.'
const UNKNOWN_UNREADABLE =
  'DEVICE ROSTER INCOMPLETE — some device entries from Traccar could not be read, so trackers may be missing from the map. Check the device list in Traccar.'

const DEVICES = devicesFixture.map((device) => normalizeTraccarDevice(device)) as readonly NormalizedTrackingDevice[]
const POSITIONS = positionsFixture.map((position) => normalizeTraccarPosition(position, 'live')) as readonly NormalizedTrackingPosition[]
const BREADCRUMBS = breadcrumbsFixture.map((position) => normalizeTraccarPosition(position, 'live')) as readonly NormalizedTrackingPosition[]

/** Wraps a JSON body as a fetch response. */
function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('[DON-338] ING-4 dropped roster rows raise a roster warning', () => {
  it('counts the device rows the client could not read', async () => {
    const fetchFn: TraccarFetch = vi.fn(async () =>
      createJsonResponse([
        devicesFixture[0],
        { ...devicesFixture[1], id: 'not-a-device-id' },
        { name: 'no id at all' },
      ]),
    )
    const client = createTraccarClient(
      { baseUrl: 'http://test:8082', logger: { warn: vi.fn() } },
      fetchFn,
    )

    await expect(client.getDevicesWithReport()).resolves.toEqual({
      accepted: [expect.objectContaining({ device_id: '1' })],
      complete: false,
      rejectedCount: 2,
    })
  })

  it('words the warning truthfully for one, several, or an unknown number of entries', () => {
    expect(createIncompleteRosterWarning({ accepted: [], complete: true })).toBeNull()
    expect(createIncompleteRosterWarning({ accepted: [], complete: true, rejectedCount: 0 })).toBeNull()
    expect(createIncompleteRosterWarning({ accepted: [], complete: false, rejectedCount: 1 }))
      .toEqual({ code: 'roster_unavailable', text: ONE_UNREADABLE })
    expect(createIncompleteRosterWarning({ accepted: [], complete: false, rejectedCount: 2 }))
      .toEqual({ code: 'roster_unavailable', text: TWO_UNREADABLE })
    expect(createIncompleteRosterWarning({ accepted: [], complete: false }))
      .toEqual({ code: 'roster_unavailable', text: UNKNOWN_UNREADABLE })
  })

  it('returns the warning from a current-position poll whose roster dropped a row', async () => {
    const result = await fetchRosterAndCurrentPositions({
      getDevices: () => Promise.resolve(DEVICES),
      getDevicesWithReport: () => Promise.resolve({
        accepted: [DEVICES[0]!],
        complete: false,
        rejectedCount: 1,
      }),
      getCurrentPositions: () => Promise.resolve({ accepted: [], rejected: [] }),
    }, [])

    expect(result.rosterComplete).toBe(false)
    expect(result.devices).toEqual([DEVICES[0]])
    expect(result.rosterWarning).toEqual({ code: 'roster_unavailable', text: ONE_UNREADABLE })
  })

  describe('through the poller status', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    /** Starts a poller whose roster drops one row and returns every published warning. */
    async function runPoller(
      getDevicesWithReport: TrackingPollerClient['getDevicesWithReport'],
      breadcrumbDelayMs = 0,
      getPollingMode: () => 'active' | 'paused' = () => 'active',
    ) {
      const client: TrackingPollerClient = {
        authenticate: vi.fn().mockResolvedValue(undefined),
        getDevices: vi.fn().mockResolvedValue(DEVICES),
        getDevicesWithReport,
        getCurrentPositions: vi.fn().mockResolvedValue(POSITIONS),
        getBreadcrumbs: vi.fn(() => new Promise<readonly NormalizedTrackingPosition[]>((resolve) => {
          setTimeout(() => resolve(BREADCRUMBS), breadcrumbDelayMs)
        })),
      }
      const publishedAt: number[] = []
      const onStatusChange = vi.fn(() => { publishedAt.push(Date.now()) })
      const poller = createPollingManager(client, {
        intervalMs: 5_000,
        staleThresholdMs: 60 * 60 * 1000,
        getPollingMode,
        getInitialBreadcrumbFrom: () => new Date('2026-04-04T10:00:00.000Z'),
        onSnapshot: vi.fn(),
        onStatusChange,
        now: () => new Date('2026-04-06T10:35:00.000Z'),
      })
      poller.start()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1_000)
      poller.stop()
      return onStatusChange.mock.calls
        .map((call, index) => ({
          ...(call as unknown as [{ readonly warning: string | null; readonly mode: string }])[0],
          publishedAtMs: publishedAt[index] ?? Number.NaN,
        }))
    }

    it('shows the warning on the online status when the roster answers in time', async () => {
      const statuses = await runPoller(vi.fn().mockResolvedValue({
        accepted: [DEVICES[0]!],
        complete: false,
        rejectedCount: 1,
      }))
      const online = statuses.filter((status) => status.mode === 'online')
      expect(online.length).toBeGreaterThan(0)
      expect(online.at(-1)?.warning ?? '').toContain(ONE_UNREADABLE)
    })

    it('keeps the warning when a slow roster settles after the current fixes', async () => {
      // The roster answers after the poll's short grace period, so the current
      // fixes publish "refreshing". It then lands incomplete before history
      // finishes: the history status must carry the incomplete-roster warning,
      // not a cleared one.
      const getDevicesWithReport = vi.fn(() => new Promise<{
        readonly accepted: readonly NormalizedTrackingDevice[]
        readonly complete: boolean
        readonly rejectedCount: number
      }>((resolve) => {
        setTimeout(() => resolve({ accepted: [DEVICES[0]!], complete: false, rejectedCount: 1 }), 200)
      }))
      const statuses = await runPoller(getDevicesWithReport, 400)
      expect(statuses.some((status) => (status.warning ?? '').includes('refreshing device roster'))).toBe(true)
      const online = statuses.filter((status) => status.mode === 'online')
      expect(online.at(-1)?.warning ?? '').toContain(ONE_UNREADABLE)
    })

    /** A roster that answers incomplete only after `delayMs`. */
    function slowIncompleteRoster(delayMs: number) {
      return vi.fn(() => new Promise<{
        readonly accepted: readonly NormalizedTrackingDevice[]
        readonly complete: boolean
        readonly rejectedCount: number
      }>((resolve) => {
        setTimeout(() => resolve({ accepted: [DEVICES[0]!], complete: false, rejectedCount: 1 }), delayMs)
      }))
    }

    it('publishes the warning when a slow roster settles after current fixes and history have both finished', async () => {
      // History answers at once, so the last status before the roster lands
      // says "refreshing". Nothing else publishes until the next poll: the
      // roster settling must publish its own warning.
      const statuses = await runPoller(slowIncompleteRoster(400), 0)
      const online = statuses.filter((status) => status.mode === 'online')
      const settledAt = statuses.findIndex((status) => (status.warning ?? '').includes(ONE_UNREADABLE))
      const lastRefreshing = statuses.findLastIndex((status) => (status.warning ?? '').includes('refreshing device roster'))
      expect(lastRefreshing).toBeGreaterThanOrEqual(0)
      expect(settledAt).toBeGreaterThan(lastRefreshing)
      expect(online.at(-1)?.warning ?? '').toContain(ONE_UNREADABLE)
      expect(online.at(-1)?.warning ?? '').not.toContain('refreshing device roster')
    })

    it('does not publish an online status when a slow roster settles while the mission is paused', async () => {
      let mode: 'active' | 'paused' = 'active'
      let pausedAtMs = Number.POSITIVE_INFINITY
      const pauseAfterFirstPoll = setTimeout(() => {
        mode = 'paused'
        pausedAtMs = Date.now()
      }, 100)
      const statuses = await runPoller(slowIncompleteRoster(400), 0, () => mode)
      clearTimeout(pauseAfterFirstPoll)
      expect(statuses.some((status) => status.publishedAtMs < pausedAtMs)).toBe(true)
      expect(statuses.filter((status) => status.publishedAtMs >= pausedAtMs && status.mode === 'online')).toEqual([])
    })

    it('keeps a known missing-tracker warning while the next roster refresh is pending, active and paused', async () => {
      // The first roster answers incomplete; the next never answers within the
      // grace period. "Refreshing" must not erase what is already known.
      let pollingMode: 'active' | 'paused' = 'active'
      const getDevicesWithReport = vi.fn()
        .mockResolvedValueOnce({ accepted: [DEVICES[0]!], complete: false, rejectedCount: 1 })
        .mockReturnValue(new Promise(() => undefined))
      const statuses: { readonly mode: string; readonly warning: string | null; readonly warningCodes?: readonly string[] }[] = []
      const poller = createPollingManager({
        authenticate: vi.fn().mockResolvedValue(undefined),
        getDevices: vi.fn().mockResolvedValue(DEVICES),
        getDevicesWithReport,
        getCurrentPositions: vi.fn().mockResolvedValue(POSITIONS),
        getBreadcrumbs: vi.fn().mockResolvedValue(BREADCRUMBS),
      }, {
        intervalMs: 5_000,
        staleThresholdMs: 60 * 60 * 1000,
        getPollingMode: () => pollingMode,
        getInitialBreadcrumbFrom: () => new Date('2026-04-04T10:00:00.000Z'),
        onSnapshot: vi.fn(),
        onStatusChange: (status: typeof statuses[number]) => { statuses.push(status) },
        now: () => new Date('2026-04-06T10:35:00.000Z'),
      })
      poller.start()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(statuses.at(-1)?.warning ?? '').toContain(ONE_UNREADABLE)

      // Second poll: the roster request is still pending after the grace period.
      await vi.advanceTimersByTimeAsync(5_000)
      expect(getDevicesWithReport).toHaveBeenCalledTimes(2)
      const active = statuses.at(-1)
      expect(active?.mode).toBe('online')
      expect(active?.warning ?? '').toContain('refreshing device roster')
      expect(active?.warning ?? '').toContain(ONE_UNREADABLE)

      pollingMode = 'paused'
      poller.requestPollNow()
      await vi.advanceTimersByTimeAsync(1_000)
      const paused = statuses.at(-1)
      expect(paused?.mode).toBe('idle')
      expect(paused?.warning ?? '').toBe(`Live refresh suspended while mission is paused. ${ONE_UNREADABLE}`)
      await poller.stop()
    })

    it('clears the known missing-tracker warning only when a complete roster arrives', async () => {
      const getDevicesWithReport = vi.fn()
        .mockResolvedValueOnce({ accepted: [DEVICES[0]!], complete: false, rejectedCount: 1 })
        .mockRejectedValueOnce(new Error('roster endpoint down'))
        .mockResolvedValue({ accepted: DEVICES, complete: true, rejectedCount: 0 })
      const statuses: { readonly warning: string | null }[] = []
      const poller = createPollingManager({
        authenticate: vi.fn().mockResolvedValue(undefined),
        getDevices: vi.fn().mockResolvedValue(DEVICES),
        getDevicesWithReport,
        getCurrentPositions: vi.fn().mockResolvedValue(POSITIONS),
        getBreadcrumbs: vi.fn().mockResolvedValue(BREADCRUMBS),
      }, {
        intervalMs: 5_000,
        staleThresholdMs: 60 * 60 * 1000,
        getInitialBreadcrumbFrom: () => new Date('2026-04-04T10:00:00.000Z'),
        onSnapshot: vi.fn(),
        onStatusChange: (status: typeof statuses[number]) => { statuses.push(status) },
        now: () => new Date('2026-04-06T10:35:00.000Z'),
      })
      poller.start()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(statuses.at(-1)?.warning ?? '').toContain(ONE_UNREADABLE)
      // A failed roster request proves nothing about the missing tracker.
      await vi.advanceTimersByTimeAsync(5_000)
      expect(statuses.at(-1)?.warning ?? '').toContain('DEVICE ROSTER UNAVAILABLE')
      expect(statuses.at(-1)?.warning ?? '').toContain(ONE_UNREADABLE)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(statuses.at(-1)?.warning ?? '').not.toContain('DEVICE ROSTER')
      await poller.stop()
    })

    /** A poller on a switchable mission that records every published status. */
    function startMissionPoller(getDevicesWithReport: TrackingPollerClient['getDevicesWithReport']) {
      const state = { mission: 'mission-a', mode: 'active' as 'active' | 'paused' }
      const statuses: { readonly mode: string; readonly warning: string | null }[] = []
      const poller = createPollingManager({
        authenticate: vi.fn().mockResolvedValue(undefined),
        getDevices: vi.fn().mockResolvedValue(DEVICES),
        getDevicesWithReport,
        getCurrentPositions: vi.fn().mockResolvedValue(POSITIONS),
        getBreadcrumbs: vi.fn().mockResolvedValue(BREADCRUMBS),
      }, {
        intervalMs: 5_000,
        staleThresholdMs: 60 * 60 * 1000,
        getPollingMode: () => state.mode,
        getHistoryResetKey: () => state.mission,
        getInitialBreadcrumbFrom: () => new Date('2026-04-04T10:00:00.000Z'),
        onSnapshot: vi.fn(),
        onStatusChange: (status: typeof statuses[number]) => { statuses.push(status) },
        now: () => new Date('2026-04-06T10:35:00.000Z'),
      })
      poller.start()
      return { poller, state, statuses }
    }

    it('does not carry mission A\'s missing-tracker warning into mission B', async () => {
      const getDevicesWithReport = vi.fn()
        .mockResolvedValueOnce({ accepted: [DEVICES[0]!], complete: false, rejectedCount: 1 })
        .mockReturnValue(new Promise(() => undefined))
      const { poller, state, statuses } = startMissionPoller(getDevicesWithReport)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(statuses.at(-1)?.warning ?? '').toContain(ONE_UNREADABLE)

      // Switch to mission B; its roster refresh stays pending. Then pause B.
      state.mission = 'mission-b'
      poller.requestPollNow()
      await vi.advanceTimersByTimeAsync(1_000)
      const switchedAt = statuses.length
      state.mode = 'paused'
      poller.requestPollNow()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(statuses.at(-1)?.mode).toBe('idle')
      expect(statuses.slice(switchedAt).some((status) => (status.warning ?? '').includes(ONE_UNREADABLE)))
        .toBe(false)
      await poller.stop()
    })

    it('ignores a late roster answer from mission A after switching to mission B', async () => {
      const getDevicesWithReport = vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => {
          setTimeout(() => resolve({ accepted: [DEVICES[0]!], complete: false, rejectedCount: 1 }), 3_000)
        }))
        .mockReturnValue(new Promise(() => undefined))
      const { poller, state, statuses } = startMissionPoller(getDevicesWithReport)
      await vi.advanceTimersByTimeAsync(1_000)
      state.mission = 'mission-b'
      poller.requestPollNow()
      await vi.advanceTimersByTimeAsync(500)
      const switchedAt = statuses.length
      // Mission A's roster answers incomplete now, then B polls on.
      await vi.advanceTimersByTimeAsync(7_000)
      state.mode = 'paused'
      poller.requestPollNow()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(statuses.length).toBeGreaterThan(switchedAt)
      expect(statuses.slice(switchedAt).some((status) => (status.warning ?? '').includes(ONE_UNREADABLE)))
        .toBe(false)
      await poller.stop()
    })
  })
})
