import { describe, expect, it, vi } from 'vitest'

import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from '../../src/features/tracking/traccar-normalization'
import type { TrackingConnectionStatus, TrackingSnapshot } from '../../src/features/tracking/tracking-types'
import { startTrackingRuntime } from '../../src/features/tracking/start-tracking-runtime'

const SNAPSHOT: TrackingSnapshot = {
  devices: devicesFixture.map((device) => normalizeTraccarDevice(device)),
  positions: positionsFixture.map((position) => normalizeTraccarPosition(position, 'live')),
  breadcrumbs: positionsFixture.map((position) => normalizeTraccarPosition(position, 'live')),
}

const CACHED_SNAPSHOT: TrackingSnapshot = {
  devices: SNAPSHOT.devices,
  positions: positionsFixture.map((position) => normalizeTraccarPosition(position, 'cache')),
  breadcrumbs: positionsFixture.map((position) => normalizeTraccarPosition(position, 'cache')),
}

describe('startTrackingRuntime', () => {
  it('does not start tracking when the runtime config is missing', async () => {
    const applySnapshot = vi.fn()
    const applyStatus = vi.fn()

    const stop = await startTrackingRuntime({
      config: null,
      createClient: vi.fn(),
      createPoller: vi.fn(),
      cache: { read: vi.fn(), write: vi.fn() },
      missionStore: createMissionStoreStub(),
      applySnapshot,
      applyStatus,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    expect(applySnapshot).not.toHaveBeenCalled()
    expect(applyStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'idle',
      }),
    )

    stop()
  })

  // Regression for `sartracker-web-el9`: when a non-null tracking config arrives at
  // bootstrap (provider=traccar_http, auto_connect=true, secret present in OS keychain),
  // the runtime must construct AND start the poller. Without this assertion, a regression
  // that builds the poller but forgets to start it would silently produce the same
  // operator-visible "no devices, last success: never" failure mode as the original bug.
  it('starts the poller when the runtime config is present', async () => {
    const start = vi.fn()
    const stop = vi.fn()
    const createPoller = vi.fn().mockReturnValue({ start, stop })
    const applyStatus = vi.fn()

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller,
      cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
      missionStore: createMissionStoreStub(),
      applySnapshot: vi.fn(),
      applyStatus,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    expect(createPoller).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(1)
    expect(applyStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        warning: expect.stringMatching(/not configured/i),
      }),
    )
  })

  it('hydrates the UI from cache before polling starts', async () => {
    const applySnapshot = vi.fn()
    const createPoller = vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() })

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn(),
      createPoller,
      cache: {
        read: vi.fn().mockResolvedValue(
          JSON.stringify({
            cached_at: '2026-04-06T10:35:00.000Z',
            devices: CACHED_SNAPSHOT.devices,
            positions: CACHED_SNAPSHOT.positions,
            breadcrumbs: CACHED_SNAPSHOT.breadcrumbs,
          }),
        ),
        write: vi.fn(),
      },
      missionStore: createMissionStoreStub(),
      applySnapshot,
      applyStatus: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    expect(applySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        devices: CACHED_SNAPSHOT.devices,
        positions: expect.arrayContaining([
          expect.objectContaining({
            data_origin: 'cache',
            cache_age_seconds: 0,
          }),
        ]),
      }),
    )
    expect(createPoller).toHaveBeenCalledTimes(1)
  })

  it('ignores cache snapshots older than the max cache age', async () => {
    const applySnapshot = vi.fn()

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn(),
      createPoller: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
      cache: {
        read: vi.fn().mockResolvedValue(
          JSON.stringify({
            cached_at: '2026-04-06T06:00:00.000Z',
            devices: CACHED_SNAPSHOT.devices,
            positions: CACHED_SNAPSHOT.positions,
            breadcrumbs: CACHED_SNAPSHOT.breadcrumbs,
          }),
        ),
        write: vi.fn(),
      },
      missionStore: createMissionStoreStub(),
      applySnapshot,
      applyStatus: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    expect(applySnapshot).not.toHaveBeenCalled()
  })

  it('ignores malformed cache payloads and still starts the poller', async () => {
    const applySnapshot = vi.fn()
    const createPoller = vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() })

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn(),
      createPoller,
      cache: {
        read: vi.fn().mockResolvedValue('{not-valid-json'),
        write: vi.fn(),
      },
      missionStore: createMissionStoreStub(),
      applySnapshot,
      applyStatus: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    expect(applySnapshot).not.toHaveBeenCalled()
    expect(createPoller).toHaveBeenCalledTimes(1)
  })

  it('persists devices and deduplicated positions into the active mission on snapshot updates', async () => {
    const upsertDevice = vi.fn().mockResolvedValue(undefined)
    const addPosition = vi.fn().mockResolvedValue(undefined)
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
          onStatusChange: (status: TrackingConnectionStatus) => void
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockResolvedValue('/tmp/tracking-cache.json'),
      },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listPositions: vi.fn().mockResolvedValue([
          {
            device_id: '1',
            timestamp: SNAPSHOT.positions[0].timestamp,
          },
        ]),
        upsertDevice,
        addPosition,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    await pollerHooks?.onSnapshot(SNAPSHOT)

    expect(upsertDevice).toHaveBeenCalledTimes(2)
    expect(addPosition).toHaveBeenCalledTimes(1)
    expect(addPosition).toHaveBeenCalledWith(
      expect.objectContaining({
        mission_id: 'mission-1',
        device_id: '2',
      }),
    )
  })

  it('keeps the live snapshot applied when cache and mission persistence side effects fail', async () => {
    const applySnapshot = vi.fn()
    const logger = { warn: vi.fn() }
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
          onStatusChange: (status: TrackingConnectionStatus) => void
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockRejectedValue(new Error('cache write failed')),
      },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listPositions: vi.fn().mockResolvedValue([]),
        upsertDevice: vi.fn().mockRejectedValue(new Error('device persistence failed')),
      }),
      applySnapshot,
      applyStatus: vi.fn(),
      logger,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    await expect(pollerHooks?.onSnapshot(SNAPSHOT)).resolves.toBeUndefined()

    expect(applySnapshot).toHaveBeenCalledWith(SNAPSHOT)
    expect(logger.warn).toHaveBeenCalledWith(
      'Tracking cache update failed.',
      expect.any(Error),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'Tracking mission persistence failed.',
      expect.any(Error),
    )
  })

  it('can cap browser-only mission persistence without trimming the live map snapshot', async () => {
    const applySnapshot = vi.fn()
    const cacheWrite = vi.fn().mockResolvedValue('/tmp/tracking-cache.json')
    const addPosition = vi.fn().mockResolvedValue(undefined)
    const breadcrumbs = Array.from({ length: 5 }, (_, index) => ({
      ...SNAPSHOT.breadcrumbs[0]!,
      id: `breadcrumb-${index}`,
      timestamp: new Date(Date.UTC(2026, 3, 6, 10, index, 0)).toISOString(),
    }))
    const largeSnapshot = {
      ...SNAPSHOT,
      breadcrumbs,
    } satisfies TrackingSnapshot
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
          onStatusChange: (status: TrackingConnectionStatus) => void
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: cacheWrite,
      },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listPositions: vi.fn().mockResolvedValue([]),
        addPosition,
      }),
      applySnapshot,
      applyStatus: vi.fn(),
      maxPersistedPositionsPerSnapshot: SNAPSHOT.positions.length + 2,
      writeCache: false,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    await pollerHooks?.onSnapshot(largeSnapshot)

    expect(applySnapshot).toHaveBeenCalledWith(largeSnapshot)
    expect(cacheWrite).not.toHaveBeenCalled()
    expect(addPosition).toHaveBeenCalledTimes(SNAPSHOT.positions.length + 2)
    expect(addPosition.mock.calls.map((call) => call[0].timestamp)).toEqual([
      breadcrumbs[3]!.timestamp,
      breadcrumbs[4]!.timestamp,
      SNAPSHOT.positions[0]!.timestamp,
      SNAPSHOT.positions[1]!.timestamp,
    ])
  })
})

function createMissionStoreStub(overrides: Record<string, unknown> = {}) {
  return {
    getActiveMission: vi.fn().mockResolvedValue(null),
    listPositions: vi.fn().mockResolvedValue([]),
    upsertDevice: vi.fn().mockResolvedValue(undefined),
    addPosition: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}
