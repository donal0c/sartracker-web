import { createRequire } from 'node:module'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import breadcrumbsFixture from '../fixtures/traccar-breadcrumbs.json'
import type { NormalizedTrackingDevice, NormalizedTrackingPosition } from '../../src/features/tracking/tracking-types'
import {
  createPollingManager,
  type TrackingPollerClient,
} from '../../src/features/tracking/polling-manager'
import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from '../../src/features/tracking/traccar-normalization'

const NORMALIZED_DEVICES = devicesFixture.map((device) => normalizeTraccarDevice(device))
const NORMALIZED_POSITIONS = positionsFixture.map((position) =>
  normalizeTraccarPosition(position, 'live'),
)
const NORMALIZED_BREADCRUMBS = breadcrumbsFixture.map((position) =>
  normalizeTraccarPosition(position, 'live'),
)
const require = createRequire(import.meta.url)
const { listBreadcrumbPositions } = require('../../electron/breadcrumb-query.cjs') as {
  readonly listBreadcrumbPositions: (
    database: unknown,
    missionId: string,
    perDeviceLimit: number,
  ) => {
    readonly positions: readonly StoredBreadcrumbRow[]
    readonly deviceTotals: readonly {
      readonly device_id: string
      readonly total: number
    }[]
    readonly deviceSelections: readonly {
      readonly device_id: string
      readonly geometryErrorBoundMetres: number | null
      readonly targetGeometryErrorSatisfied: boolean
      readonly timeBucketWidthMs: number | null
      readonly spatialBucketWidthDegrees: number | null
    }[]
  }
}

type StoredBreadcrumbRow = {
  readonly mission_id: string
  readonly source_position_id: string
  readonly device_id: string
  readonly lat: number
  readonly lon: number
  readonly timestamp: string
  readonly source: string
}

function createClient(
  overrides: Partial<TrackingPollerClient> = {},
): TrackingPollerClient {
  return {
    authenticate: vi.fn().mockResolvedValue(undefined),
    getDevices: vi.fn().mockResolvedValue(NORMALIZED_DEVICES as readonly NormalizedTrackingDevice[]),
    getCurrentPositions: vi
      .fn()
      .mockResolvedValue(NORMALIZED_POSITIONS as readonly NormalizedTrackingPosition[]),
    getBreadcrumbs: vi
      .fn()
      .mockResolvedValue(NORMALIZED_BREADCRUMBS as readonly NormalizedTrackingPosition[]),
    ...overrides,
  }
}

function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

describe('polling manager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('authenticates once and polls immediately, then on interval', async () => {
    const client = createClient()
    const onSnapshot = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(client.authenticate).toHaveBeenCalledTimes(1)
    expect(client.getDevices).toHaveBeenCalledTimes(2)
    expect(client.getCurrentPositions).toHaveBeenCalledTimes(2)
    expect(client.getBreadcrumbs).toHaveBeenCalled()
    expect(onSnapshot).toHaveBeenCalledTimes(3)

    poller.stop()
  })

  it('wakes an idle poller immediately when mission activation occurs', async () => {
    const client = createClient()
    let pollingMode: 'active' | 'idle' = 'idle'
    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 60 * 60 * 1000,
      getPollingMode: () => pollingMode,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => new Date('2026-08-09T12:00:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(client.getDevices).not.toHaveBeenCalled()

    pollingMode = 'active'
    poller.requestPollNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(client.getDevices).toHaveBeenCalledTimes(1)
    expect(client.getCurrentPositions).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(29_999)
    expect(client.getDevices).toHaveBeenCalledTimes(1)
    poller.stop()
  })

  // V1 regression coverage (sartracker-web-8gw): a healthy poll cycle must never
  // briefly flip to 'offline'. A previous regression published an 'offline'
  // intermediate status in some healthy paths, which made operators see a
  // transport-failure warning even while the poll was succeeding. This guard
  // pins the contract that a successful single poll cycle only publishes
  // 'online' modes (and possibly 'idle' before the mission is active).
  it('never publishes an offline status during a single healthy poll cycle', async () => {
    const client = createClient()
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    const modes = onStatusChange.mock.calls.map((call) => call[0]?.mode)
    expect(modes).not.toContain('offline')
    expect(modes).toContain('online')

    poller.stop()
  })

  it('publishes the final retrieved safety snapshot before stop settles [DON-260]', async () => {
    const deferredDevices = createDeferred<readonly NormalizedTrackingDevice[]>()
    const deferredPositions = createDeferred<readonly NormalizedTrackingPosition[]>()
    const client = createClient({
      getDevices: vi.fn().mockReturnValue(deferredDevices.promise),
      getCurrentPositions: vi.fn().mockReturnValue(deferredPositions.promise),
    })
    const onSnapshot = vi.fn()
    const onStatusChange = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange,
      now: () => new Date('2026-07-28T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    const stopping = poller.stop()
    deferredDevices.resolve(NORMALIZED_DEVICES)
    deferredPositions.resolve(NORMALIZED_POSITIONS)
    await vi.advanceTimersByTimeAsync(0)
    await stopping

    expect(onSnapshot).toHaveBeenCalledOnce()
    expect(onSnapshot.mock.calls[0]?.[0].positions).toHaveLength(NORMALIZED_POSITIONS.length)
    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'online' }))
    expect(client.getBreadcrumbs).not.toHaveBeenCalled()
  })

  it('settles retrieved current-position evidence before asynchronous stop completes', async () => {
    const currentPositions = createDeferred<{
      readonly accepted: readonly NormalizedTrackingPosition[]
      readonly rejected: readonly [{
        readonly deviceId: string
        readonly reason: 'invalid_coordinates'
        readonly rowIndex: number
        readonly anomalyKey: string
        readonly sourcePositionId: string
        readonly canonicalEvidence: Readonly<Record<string, unknown>>
      }]
    }>()
    const roster = createDeferred<readonly NormalizedTrackingDevice[]>()
    const rejection = {
      deviceId: '2',
      reason: 'invalid_coordinates' as const,
      rowIndex: 1,
      anomalyKey: 'source:stop-in-flight',
      sourcePositionId: 'stop-in-flight',
      canonicalEvidence: { source_position_id: 'stop-in-flight', device_id: '2' },
    }
    const client = createClient({
      getDevices: vi.fn().mockReturnValue(roster.promise),
      getCurrentPositionsWithReport: vi.fn().mockReturnValue(currentPositions.promise),
    })
    const onCurrentPositionRejections = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      getHistoryResetKey: () => 'mission-1',
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      onCurrentPositionRejections,
      now: () => new Date('2026-08-26T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    const stopping = poller.stop()
    let stopSettled = false
    void stopping.then(() => {
      stopSettled = true
    })
    await Promise.resolve()
    expect(stopSettled).toBe(false)

    currentPositions.resolve({ accepted: NORMALIZED_POSITIONS, rejected: [rejection] })
    await vi.advanceTimersByTimeAsync(0)

    await expect(stopping).resolves.toBeUndefined()
    expect(onCurrentPositionRejections).toHaveBeenCalledWith([rejection], {
      missionId: 'mission-1',
      observedAt: '2026-08-26T10:35:00.000Z',
    })
  })

  it('keeps live positions visible while a closed mission observation scope excludes evidence', async () => {
    const rejection = {
      deviceId: '2',
      reason: 'invalid_coordinates' as const,
      rowIndex: 1,
      anomalyKey: 'source:after-finish-cutoff',
      sourcePositionId: 'after-finish-cutoff',
      canonicalEvidence: { source_position_id: 'after-finish-cutoff', device_id: '2' },
    }
    const onSnapshot = vi.fn()
    const onCurrentPositionRejections = vi.fn()
    const poller = createPollingManager(createClient({
      getCurrentPositionsWithReport: vi.fn().mockResolvedValue({
        accepted: NORMALIZED_POSITIONS,
        rejected: [rejection],
      }),
    }), {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      getHistoryResetKey: () => 'mission-1',
      beginMissionEvidenceObservation: () => ({
        missionId: null,
        complete: vi.fn(),
      }),
      onSnapshot,
      onStatusChange: vi.fn(),
      onCurrentPositionRejections,
      now: () => new Date('2026-08-26T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ positions: expect.any(Array) }),
      expect.objectContaining({
        historyResetKey: 'mission-1',
        missionEvidenceId: null,
      }),
    )
    expect(onCurrentPositionRejections).toHaveBeenCalledWith([rejection], {
      missionId: null,
      observedAt: '2026-08-26T10:35:00.000Z',
    })
    await poller.stop()
  })

  it('does not publish breadcrumb work into a replacement mission history [DON-260]', async () => {
    const deferredBreadcrumbs = createDeferred<readonly NormalizedTrackingPosition[]>()
    const client = createClient({
      getBreadcrumbs: vi.fn().mockReturnValue(deferredBreadcrumbs.promise),
    })
    const onSnapshot = vi.fn()
    let missionId = 'mission-a'
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      getHistoryResetKey: () => missionId,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-07-28T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(onSnapshot).toHaveBeenCalledTimes(1)

    missionId = 'mission-b'
    deferredBreadcrumbs.resolve(NORMALIZED_BREADCRUMBS)
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot).toHaveBeenCalledTimes(1)
    poller.stop()
  })

  it('publishes current fixes before a long restart-history hydration completes [DON-260]', async () => {
    const persistedBreadcrumbs =
      createDeferred<readonly NormalizedTrackingPosition[]>()
    const onSnapshot = vi.fn()
    const poller = createPollingManager(createClient(), {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      getInitialBreadcrumbs: () => persistedBreadcrumbs.promise,
      getInitialBreadcrumbTotals: async () => ({}),
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-07-28T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(onSnapshot.mock.calls[0]?.[0].positions.map((position) => position.id)).toEqual(
      NORMALIZED_POSITIONS.map((position) => position.id),
    )
    expect(onSnapshot.mock.calls[0]?.[0].breadcrumbs).toEqual([])
    expect(onSnapshot.mock.calls[0]?.[1]).toEqual({
      historyResetKey: null,
      missionEvidenceId: null,
    })

    persistedBreadcrumbs.resolve(NORMALIZED_BREADCRUMBS)
    await vi.advanceTimersByTimeAsync(0)
    expect(onSnapshot.mock.calls.length).toBeGreaterThan(1)
    poller.stop()
  })

  it('aborts a stale restart seed before polling the replacement mission', async () => {
    let missionId = 'mission-a'
    const seedSignals = new Map<string, AbortSignal | undefined>()
    const logger = { warn: vi.fn() }
    const onSnapshot = vi.fn()
    const getInitialBreadcrumbs = vi.fn((signal?: AbortSignal) => {
      const requestedMissionId = missionId
      seedSignals.set(requestedMissionId, signal)
      return new Promise<readonly NormalizedTrackingPosition[]>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const error = new Error('Restart seed cancelled.')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    })
    const poller = createPollingManager(createClient(), {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      getHistoryResetKey: () => missionId,
      getInitialBreadcrumbs,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-07-28T10:35:00.000Z'),
      logger,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(getInitialBreadcrumbs).toHaveBeenCalledTimes(1)

    missionId = 'mission-b'
    poller.requestPollNow()
    await vi.advanceTimersByTimeAsync(0)

    expect(seedSignals.get('mission-a')?.aborted).toBe(true)
    expect(getInitialBreadcrumbs).toHaveBeenCalledTimes(2)
    expect(
      onSnapshot.mock.calls.slice(1).every(
        (call) => call[1]?.historyResetKey === 'mission-b',
      ),
    ).toBe(true)
    expect(logger.warn).not.toHaveBeenCalledWith(
      'Tracking breadcrumb cursor load failed.',
      expect.anything(),
    )

    poller.stop()
    expect(seedSignals.get('mission-b')?.aborted).toBe(true)
  })

  it('serves the last-good snapshot on fetch failure without clearing data', async () => {
    const client = createClient()
    const onSnapshot = vi.fn()
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    vi.mocked(client.getCurrentPositions).mockRejectedValueOnce(new Error('network down'))

    await vi.advanceTimersByTimeAsync(5_000)

    expect(onSnapshot).toHaveBeenCalledTimes(3)
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'offline',
        warning: 'OFFLINE MODE — showing last known positions.',
      }),
    )
    expect(onSnapshot.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ rawBreadcrumbsForPersistence: [] }),
    )

    poller.stop()
  })

  it('publishes current positions with last-known roster metadata when roster refresh fails [DON-267]', async () => {
    const client = {
      ...createClient(),
      getDevices: vi
        .fn()
        .mockResolvedValueOnce(NORMALIZED_DEVICES)
        .mockRejectedValueOnce(new Error('roster unavailable')),
      getCurrentPositionsWithReport: vi.fn().mockResolvedValue({
        accepted: NORMALIZED_POSITIONS,
        rejected: [],
      }),
    } as TrackingPollerClient
    const onSnapshot = vi.fn()
    const onStatusChange = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    onSnapshot.mockClear()
    onStatusChange.mockClear()

    await vi.advanceTimersByTimeAsync(5_000)

    expect(onSnapshot.mock.calls[0]?.[0].devices).toEqual(NORMALIZED_DEVICES)
    expect(onSnapshot.mock.calls[0]?.[0].positions.map(
      (position: NormalizedTrackingPosition) => position.id,
    )).toEqual(NORMALIZED_POSITIONS.map((position) => position.id))
    expect(onStatusChange.mock.calls.some((call) =>
      /roster.*unavailable/i.test(call[0]?.warning ?? ''),
    )).toBe(true)
    expect(onStatusChange.mock.calls.every((call) => call[0]?.mode === 'online')).toBe(true)
    poller.stop()
  })

  it('publishes current fixes before a slow roster request settles [DON-267]', async () => {
    const roster = createDeferred<readonly NormalizedTrackingDevice[]>()
    const client = createClient({
      getDevices: vi.fn().mockReturnValue(roster.promise),
      getCurrentPositionsWithReport: vi.fn().mockResolvedValue({
        accepted: NORMALIZED_POSITIONS,
        rejected: [],
      }),
    })
    const onSnapshot = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(50)

    expect(onSnapshot.mock.calls[0]?.[0].positions.map(
      (position: NormalizedTrackingPosition) => position.id,
    )).toEqual(NORMALIZED_POSITIONS.map((position) => position.id))

    await vi.advanceTimersByTimeAsync(5_000)
    expect(client.getCurrentPositionsWithReport).toHaveBeenCalledTimes(2)
    expect(onSnapshot.mock.calls.filter((call) =>
      call[0].positions.length === NORMALIZED_POSITIONS.length,
    )).toHaveLength(2)

    roster.resolve(NORMALIZED_DEVICES)
    await vi.advanceTimersByTimeAsync(0)
    poller.stop()
  })

  it('admits history before transport so stop waits for late rejected-row evidence [DON-267]', async () => {
    const history = createDeferred<{
      readonly accepted: readonly NormalizedTrackingPosition[]
      readonly rejected: readonly {
        readonly deviceId: string
        readonly reason: 'invalid_timestamp'
        readonly rowIndex: number
        readonly anomalyKey: string
        readonly sourcePositionId: string
        readonly canonicalEvidence: Readonly<Record<string, unknown>>
      }[]
    }>()
    const rejection = {
      deviceId: '1',
      reason: 'invalid_timestamp' as const,
      rowIndex: 0,
      anomalyKey: 'source:late-rejection',
      sourcePositionId: 'late-rejection',
      canonicalEvidence: { source_position_id: 'late-rejection', device_id: '1' },
    }
    const completedObservations: ReturnType<typeof vi.fn>[] = []
    const onBreadcrumbRejections = vi.fn()
    const poller = createPollingManager(createClient({
      getBreadcrumbsWithReport: vi.fn().mockReturnValue(history.promise),
    }), {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      getHistoryResetKey: () => 'mission-finish-fence',
      beginMissionEvidenceObservation: (missionId) => {
        const complete = vi.fn()
        completedObservations.push(complete)
        return { missionId, complete }
      },
      onBreadcrumbRejections,
      onSnapshot: vi.fn().mockResolvedValue(undefined),
      onStatusChange: vi.fn(),
      now: () => new Date('2026-08-27T09:00:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(completedObservations.length).toBeGreaterThanOrEqual(2)
    expect(completedObservations.at(-1)).not.toHaveBeenCalled()

    let stopped = false
    const stop = poller.stop().then(() => { stopped = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(stopped).toBe(false)

    history.resolve({ accepted: [], rejected: [rejection] })
    await stop
    expect(onBreadcrumbRejections).toHaveBeenCalledWith([rejection], {
      missionId: 'mission-finish-fence',
      observedAt: '2026-08-27T09:00:00.000Z',
    })
    expect(completedObservations.at(-1)).toHaveBeenCalledOnce()
  })

  it('starts a new mission history task without waiting for superseded transport [DON-267]', async () => {
    const missionAHistory = createDeferred<readonly NormalizedTrackingPosition[]>()
    let missionId = 'mission-a'
    const historySignals: Array<AbortSignal | undefined> = []
    const getBreadcrumbs = vi.fn((...args: [string, Date, Date, AbortSignal?]) => {
      historySignals.push(args[3])
      return missionId === 'mission-a' ? missionAHistory.promise : Promise.resolve([])
    })
    const poller = createPollingManager(createClient({ getBreadcrumbs }), {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      getHistoryResetKey: () => missionId,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => new Date('2026-08-27T09:00:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(getBreadcrumbs).toHaveBeenCalledTimes(NORMALIZED_DEVICES.length)

    missionId = 'mission-b'
    poller.requestPollNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(getBreadcrumbs).toHaveBeenCalledTimes(NORMALIZED_DEVICES.length * 2)
    expect(historySignals.slice(0, NORMALIZED_DEVICES.length)).toEqual(
      NORMALIZED_DEVICES.map(() => expect.objectContaining({ aborted: true })),
    )
    expect(historySignals.slice(NORMALIZED_DEVICES.length)).toEqual(
      NORMALIZED_DEVICES.map(() => expect.objectContaining({ aborted: false })),
    )

    missionAHistory.resolve([])
    await poller.stop()
  })

  it('bounds a 100-device incremental history wave to the shared history capacity [DON-267]', async () => {
    const devices = Array.from({ length: 100 }, (_, index) => ({
      ...NORMALIZED_DEVICES[0]!,
      device_id: String(index + 1),
      name: `Device ${index + 1}`,
    }))
    const unresolved = createDeferred<readonly NormalizedTrackingPosition[]>()
    const getBreadcrumbs = vi.fn().mockReturnValue(unresolved.promise)
    const poller = createPollingManager(createClient({
      getDevices: vi.fn().mockResolvedValue(devices),
      getBreadcrumbs,
    }), {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => new Date('2026-08-27T09:00:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(getBreadcrumbs.mock.calls.length).toBeGreaterThan(0)
    expect(getBreadcrumbs.mock.calls.length).toBeLessThanOrEqual(8)

    unresolved.resolve([])
    await vi.advanceTimersByTimeAsync(0)
    await poller.stop()
  })

  it('avoids a placeholder device write when roster metadata follows the fix promptly [DON-267]', async () => {
    const roster = createDeferred<readonly NormalizedTrackingDevice[]>()
    const client = createClient({
      getDevices: vi.fn().mockReturnValue(roster.promise),
      getCurrentPositionsWithReport: vi.fn().mockResolvedValue({
        accepted: NORMALIZED_POSITIONS,
        rejected: [],
      }),
    })
    const onSnapshot = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(25)

    expect(onSnapshot).not.toHaveBeenCalled()

    roster.resolve(NORMALIZED_DEVICES)
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot).toHaveBeenCalled()
    expect(onSnapshot.mock.calls.every((call) =>
      call[0].devices === NORMALIZED_DEVICES ||
      JSON.stringify(call[0].devices) === JSON.stringify(NORMALIZED_DEVICES),
    )).toBe(true)
    poller.stop()
  })

  it('synthesizes bounded device rows when the first roster request fails [DON-267]', async () => {
    const client = createClient({
      getDevices: vi.fn().mockRejectedValue(new Error('roster unavailable')),
      getCurrentPositionsWithReport: vi.fn().mockResolvedValue({
        accepted: NORMALIZED_POSITIONS,
        rejected: [],
      }),
    })
    const onSnapshot = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot.mock.calls.at(-1)?.[0].devices).toEqual([
      expect.objectContaining({ device_id: '1', name: 'Device 1' }),
      expect.objectContaining({ device_id: '2', name: 'Device 2' }),
    ])
    poller.stop()
  })

  it('marks every snapshot from a partially normalized Traccar roster non-authoritative [DON-271]', async () => {
    const client = createClient({
      getDevicesWithReport: vi.fn().mockResolvedValue({
        accepted: [NORMALIZED_DEVICES[0]!],
        complete: false,
      }),
    })
    const onSnapshot = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    const rosterSnapshots = onSnapshot.mock.calls.filter((call) => call[0].devices.length > 0)
    expect(rosterSnapshots.length).toBeGreaterThan(0)
    expect(rosterSnapshots.every((call) =>
      call[1]?.participantRosterAuthoritative === false)).toBe(true)
    poller.stop()
  })

  it('publishes valid current positions before safely reporting rejected rows [DON-268]', async () => {
    const events: string[] = []
    const rejection = {
      deviceId: '2',
      reason: 'invalid_coordinates' as const,
      rowIndex: 1,
      anomalyKey: 'source:200',
      sourcePositionId: '200',
      canonicalEvidence: { source_position_id: '200', device_id: '2' },
    }
    const client = createClient({
      getCurrentPositionsWithReport: vi.fn().mockResolvedValue({
        accepted: NORMALIZED_POSITIONS,
        rejected: [rejection],
      }),
    })
    const onSnapshot = vi.fn(() => events.push('snapshot'))
    const onStatusChange = vi.fn()
    const onCurrentPositionRejections = vi.fn(() => {
      events.push('rejections')
      throw new Error('renderer evidence staging failed')
    })
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange,
      onCurrentPositionRejections,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(events.slice(0, 2)).toEqual(['snapshot', 'rejections'])
    expect(onSnapshot.mock.calls[0]?.[0].positions.map(
      (position: NormalizedTrackingPosition) => position.id,
    )).toEqual(NORMALIZED_POSITIONS.map((position) => position.id))
    expect(onStatusChange.mock.calls.some((call) => call[0]?.mode === 'offline')).toBe(false)
    poller.stop()
  })

  it('retains last accepted current positions while reporting an all-invalid poll [DON-268]', async () => {
    const rejected = {
      deviceId: '1',
      reason: 'invalid_coordinates' as const,
      rowIndex: 0,
      anomalyKey: 'source:100',
      sourcePositionId: '100',
      canonicalEvidence: { source_position_id: '100', device_id: '1' },
    }
    const client = createClient({
      getCurrentPositionsWithReport: vi.fn()
        .mockResolvedValueOnce({ accepted: NORMALIZED_POSITIONS, rejected: [] })
        .mockResolvedValueOnce({ accepted: [], rejected: [rejected] }),
    })
    const onSnapshot = vi.fn()
    const onStatusChange = vi.fn()
    const onCurrentPositionRejections = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange,
      onCurrentPositionRejections,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    onSnapshot.mockClear()
    onStatusChange.mockClear()
    onCurrentPositionRejections.mockClear()

    await vi.advanceTimersByTimeAsync(5_000)

    expect(onSnapshot.mock.calls[0]?.[0].positions.map(
      (position: NormalizedTrackingPosition) => position.id,
    )).toEqual(NORMALIZED_POSITIONS.map((position) => position.id))
    expect(onCurrentPositionRejections).toHaveBeenCalledWith(
      [rejected],
      {
        missionId: null,
        observedAt: '2026-04-06T10:35:00.000Z',
      },
    )
    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'online',
      warning: expect.stringMatching(/rejected.*last accepted/i),
    }))
    poller.stop()
  })

  it('republishes retained current positions when a history reset is followed by a failed poll [DON-267]', async () => {
    const client = createClient()
    const onSnapshot = vi.fn()
    let historyResetKey = 'mission-a'
    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 60 * 60 * 1000,
      getHistoryResetKey: () => historyResetKey,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    const callsBeforeReset = onSnapshot.mock.calls.length

    historyResetKey = 'mission-b'
    vi.mocked(client.getCurrentPositions).mockRejectedValueOnce(new Error('positions unavailable'))
    poller.requestPollNow()
    await vi.advanceTimersByTimeAsync(0)

    const resetSnapshots = onSnapshot.mock.calls.slice(callsBeforeReset)
    expect(resetSnapshots).toHaveLength(1)
    expect(resetSnapshots[0]?.[1]).toEqual({ historyResetKey: 'mission-b' })
    expect(resetSnapshots[0]?.[0].positions.map(
      (position: NormalizedTrackingPosition) => position.id,
    )).toEqual(NORMALIZED_POSITIONS.map((position) => position.id))
    expect(resetSnapshots[0]?.[0].breadcrumbs).toEqual([])
    poller.stop()
  })

  it('backs off after failures and reports recovery', async () => {
    const client = createClient({
      getCurrentPositions: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockRejectedValueOnce(new Error('still offline'))
        .mockResolvedValue(NORMALIZED_POSITIONS as readonly NormalizedTrackingPosition[]),
    })
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange,
      retryBaseMs: 1_000,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(2_000)

    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'offline', consecutiveFailures: 1 }),
    )
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'offline', consecutiveFailures: 2 }),
    )
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'online',
        recovered: true,
        warning: 'CONNECTION RESTORED',
      }),
    )

    poller.stop()
  })

  it('records a sanitized failed poll and its recovery in the tracking ledger [DON-229]', async () => {
    const client = createClient({
      getCurrentPositions: vi
        .fn()
        .mockRejectedValueOnce(new DOMException('request aborted', 'AbortError'))
        .mockResolvedValue(NORMALIZED_POSITIONS as readonly NormalizedTrackingPosition[]),
    })
    const onPollDiagnostic = vi.fn()
    const times = [
      '2026-07-12T09:51:14.000Z',
      '2026-07-12T09:52:01.000Z',
      '2026-07-12T09:52:02.000Z',
      '2026-07-12T09:52:02.250Z',
    ]

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      onPollDiagnostic,
      retryBaseMs: 1_000,
      now: () => new Date(times.shift() ?? '2026-07-12T09:52:02.250Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(onPollDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'poll_cycle',
        outcome: 'failure',
        phase: 'current_positions',
        failureKind: 'timeout',
        consecutiveFailures: 1,
        retryDelayMs: 1_000,
      }),
    )
    expect(onPollDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'poll_cycle',
        outcome: 'recovered',
        phase: 'current_positions',
        consecutiveFailures: 0,
        outageDurationMs: expect.any(Number),
      }),
    )
    expect(onPollDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'poll_cycle',
        outcome: 'success',
        phase: 'breadcrumbs',
        consecutiveFailures: 0,
      }),
    )

    poller.stop()
  })

  it('fetches breadcrumbs incrementally per device after the first poll', async () => {
    const client = createClient()
    const onSnapshot = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(client.getBreadcrumbs).toHaveBeenCalledWith(
      '1',
      expect.any(Date),
      expect.any(Date),
      expect.any(AbortSignal),
    )
    expect(client.getBreadcrumbs).toHaveBeenCalledWith(
      '2',
      expect.any(Date),
      expect.any(Date),
      expect.any(AbortSignal),
    )

    const latestSnapshot = onSnapshot.mock.calls.at(-1)?.[0]
    expect(latestSnapshot?.breadcrumbs.length).toBeGreaterThan(0)

    poller.stop()
  })

  it('publishes a bounded current-fixes snapshot and breadcrumb snapshot per successful poll', async () => {
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(NORMALIZED_DEVICES as readonly NormalizedTrackingDevice[]),
      getCurrentPositions: vi.fn().mockResolvedValue(NORMALIZED_POSITIONS),
      getBreadcrumbs: vi.fn().mockResolvedValue(NORMALIZED_POSITIONS),
    })
    const onSnapshot = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot).toHaveBeenCalledTimes(2)
    expect(onSnapshot.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        devices: NORMALIZED_DEVICES,
        positions: expect.arrayContaining([
          expect.objectContaining({ device_id: NORMALIZED_POSITIONS[0]!.device_id }),
        ]),
        breadcrumbs: [],
      }),
    )
    expect(onSnapshot.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        devices: NORMALIZED_DEVICES,
        positions: expect.arrayContaining([
          expect.objectContaining({ device_id: NORMALIZED_POSITIONS[0]!.device_id }),
        ]),
        breadcrumbs: expect.arrayContaining([
          expect.objectContaining({ device_id: NORMALIZED_POSITIONS[0]!.device_id }),
        ]),
      }),
    )

    poller.stop()
  })

  it('publishes current fixes before slow breadcrumb history resolves', async () => {
    const deferredBreadcrumbs = createDeferred<readonly NormalizedTrackingPosition[]>()
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(NORMALIZED_DEVICES as readonly NormalizedTrackingDevice[]),
      getCurrentPositions: vi.fn().mockResolvedValue(NORMALIZED_POSITIONS),
      getBreadcrumbs: vi.fn().mockReturnValue(deferredBreadcrumbs.promise),
    })
    const onSnapshot = vi.fn()
    const onStatusChange = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange,
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(client.getBreadcrumbs).toHaveBeenCalled()
    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(onSnapshot.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        devices: NORMALIZED_DEVICES,
        positions: expect.arrayContaining([
          expect.objectContaining({ device_id: NORMALIZED_POSITIONS[0]!.device_id }),
        ]),
        breadcrumbs: [],
      }),
    )
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'online',
        warning: 'Current fixes loaded; loading breadcrumb history.',
      }),
    )

    deferredBreadcrumbs.resolve(NORMALIZED_BREADCRUMBS)
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot).toHaveBeenCalledTimes(2)
    expect(onSnapshot.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        breadcrumbs: expect.arrayContaining([
          expect.objectContaining({ device_id: NORMALIZED_BREADCRUMBS[0]!.device_id }),
        ]),
      }),
    )

    poller.stop()
  })

  it('publishes a second current poll on cadence while incremental history stays unresolved [DON-267] [SAR-QA-002]', async () => {
    const unresolvedHistory = createDeferred<readonly NormalizedTrackingPosition[]>()
    const client = createClient({
      getBreadcrumbs: vi.fn().mockReturnValue(unresolvedHistory.promise),
    })
    const onSnapshot = vi.fn()
    const onPollDiagnostic = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      onPollDiagnostic,
      now: () => new Date('2026-08-27T07:00:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(client.getCurrentPositions).toHaveBeenCalledTimes(1)
    expect(client.getBreadcrumbs).toHaveBeenCalledTimes(NORMALIZED_DEVICES.length)

    await vi.advanceTimersByTimeAsync(15_000)

    expect(client.getCurrentPositions).toHaveBeenCalledTimes(4)
    expect(client.getBreadcrumbs).toHaveBeenCalledTimes(NORMALIZED_DEVICES.length)
    expect(onSnapshot.mock.calls.filter((call) =>
      call[0].positions.length === NORMALIZED_POSITIONS.length,
    )).toHaveLength(4)
    expect(onPollDiagnostic.mock.calls.map((call) => call[0]).filter((entry) =>
      entry.kind === 'poll_cycle' && entry.phase === 'current_positions',
    )).toHaveLength(4)
    expect(onPollDiagnostic.mock.calls.map((call) => call[0]).filter((entry) =>
      entry.kind === 'poll_cycle' && entry.phase === 'breadcrumbs',
    )).toHaveLength(0)
    poller.stop()
  })

  it('surfaces rejected breadcrumb rows with a count while valid exact fixes continue [DON-267] [DON-268]', async () => {
    const rejection = {
      deviceId: '1',
      reason: 'invalid_timestamp' as const,
      rowIndex: 1,
      anomalyKey: 'source:history-rejected',
      sourcePositionId: 'history-rejected',
      canonicalEvidence: { id: 'history-rejected' },
    }
    const client = createClient({
      getBreadcrumbsWithReport: vi.fn().mockResolvedValue({
        accepted: NORMALIZED_BREADCRUMBS,
        rejected: [rejection],
      }),
    })
    const onBreadcrumbRejections = vi.fn()
    const onStatusChange = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      getHistoryResetKey: () => 'mission-a',
      onSnapshot: vi.fn(),
      onStatusChange,
      onBreadcrumbRejections,
      now: () => new Date('2026-08-27T07:00:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(onBreadcrumbRejections).toHaveBeenCalledWith([rejection], {
      missionId: 'mission-a',
      observedAt: '2026-08-27T07:00:00.000Z',
    })
    expect(onStatusChange.mock.calls.map((call) => call[0]?.warning)).toContain(
      'BREADCRUMB EVIDENCE WARNING — the latest affected history response rejected 1 source row. Valid canonical fixTime evidence remains available; rejected rows stay excluded and are reported.',
    )
    poller.stop()
  })

  it('does not let older history completion overwrite a newer current-position failure [DON-267]', async () => {
    const unresolvedHistory = createDeferred<readonly NormalizedTrackingPosition[]>()
    const client = createClient({
      getCurrentPositions: vi.fn()
        .mockResolvedValueOnce(NORMALIZED_POSITIONS)
        .mockRejectedValueOnce(new Error('current positions unavailable')),
      getBreadcrumbs: vi.fn().mockReturnValue(unresolvedHistory.promise),
    })
    const onStatusChange = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange,
      now: () => new Date('2026-08-27T07:00:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(onStatusChange.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ mode: 'offline' }),
    )

    unresolvedHistory.resolve(NORMALIZED_BREADCRUMBS)
    await vi.advanceTimersByTimeAsync(0)

    expect(onStatusChange.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ mode: 'offline' }),
    )
    poller.stop()
  })

  it('does not flash the initial history warning on every successful empty-history poll [DON-261]', async () => {
    const client = createClient({
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })
    const onStatusChange = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(onStatusChange.mock.calls.map((call) => call[0]?.warning)).toEqual([
      'Current fixes loaded; loading breadcrumb history.',
      null,
    ])

    onStatusChange.mockClear()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(onStatusChange.mock.calls.map((call) => call[0]?.warning)).toEqual([
      null,
      null,
    ])

    poller.stop()
  })

  it('clears the breadcrumb reconciliation warning after catch-up and keeps it clear [DON-261]', async () => {
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue([NORMALIZED_DEVICES[0]!]),
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })
    const onStatusChange = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      getInitialBreadcrumbFrom: () => new Date('2026-04-06T00:00:00.000Z'),
      getBreadcrumbDeviceIds: () => ['1'],
      onSnapshot: vi.fn(),
      onStatusChange,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(
      onStatusChange.mock.calls.some((call) =>
        /reconciling/i.test(call[0]?.warning ?? ''),
      ),
    ).toBe(true)
    expect(onStatusChange.mock.calls.at(-1)?.[0]?.warning).toBeNull()

    onStatusChange.mockClear()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(
      onStatusChange.mock.calls.every((call) => call[0]?.warning === null),
    ).toBe(true)

    poller.stop()
  })

  it('shows the initial history warning again only after the mission history key changes [DON-261]', async () => {
    const client = createClient({
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })
    const onStatusChange = vi.fn()
    let historyResetKey = 'mission-1'
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      getHistoryResetKey: () => historyResetKey,
      onSnapshot: vi.fn(),
      onStatusChange,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    onStatusChange.mockClear()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(onStatusChange.mock.calls.map((call) => call[0]?.warning)).toEqual([
      null,
      null,
    ])

    historyResetKey = 'mission-2'
    onStatusChange.mockClear()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(onStatusChange.mock.calls.map((call) => call[0]?.warning)).toEqual([
      'Current fixes loaded; loading breadcrumb history.',
      null,
    ])

    poller.stop()
  })

  it('skips the breadcrumb snapshot when an overlap poll contains no new breadcrumb state', async () => {
    const client = createClient({
      getBreadcrumbs: vi.fn().mockResolvedValue(NORMALIZED_BREADCRUMBS),
    })
    const onSnapshot = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(onSnapshot).toHaveBeenCalledTimes(3)
    expect(onSnapshot.mock.calls[0]?.[0].breadcrumbs).toHaveLength(0)
    expect(onSnapshot.mock.calls[1]?.[0].breadcrumbs.length).toBeGreaterThan(0)
    expect(onSnapshot.mock.calls[2]?.[0].breadcrumbs).toBe(onSnapshot.mock.calls[1]?.[0].breadcrumbs)

    poller.stop()
  })

  it('uses persisted breadcrumbs for the first history fetch and published trail', async () => {
    const client = createClient({
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })
    const persistedBreadcrumbs = [
      {
        ...NORMALIZED_BREADCRUMBS[0]!,
        device_id: '1',
        timestamp: '2026-04-06T10:10:00.000Z',
      },
      {
        ...NORMALIZED_BREADCRUMBS[1]!,
        device_id: '2',
        timestamp: '2026-04-06T10:20:00.000Z',
      },
    ] satisfies readonly NormalizedTrackingPosition[]
    const onSnapshot = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      getInitialBreadcrumbFrom: () => new Date('2026-04-06T07:00:00.000Z'),
      getInitialBreadcrumbs: async () => persistedBreadcrumbs,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(client.getBreadcrumbs).toHaveBeenCalledWith(
      '1',
      new Date('2026-04-06T10:05:00.000Z'),
      expect.any(Date),
      expect.any(AbortSignal),
    )
    expect(client.getBreadcrumbs).toHaveBeenCalledWith(
      '2',
      new Date('2026-04-06T10:15:00.000Z'),
      expect.any(Date),
      expect.any(AbortSignal),
    )
    expect(client.getBreadcrumbs).toHaveBeenCalledWith(
      '1',
      new Date('2026-04-06T07:00:00.000Z'),
      new Date('2026-04-06T09:00:00.000Z'),
      expect.any(AbortSignal),
    )
    expect(onSnapshot.mock.calls[0]?.[0].breadcrumbs).toEqual([])
    expect(onSnapshot.mock.calls[1]?.[0].breadcrumbs).toEqual(persistedBreadcrumbs)
    expect(onSnapshot.mock.calls[0]?.[0].rawBreadcrumbsForPersistence).toEqual([])
    expect(onSnapshot.mock.calls[1]?.[0].rawBreadcrumbsForPersistence).toEqual([])

    poller.stop()
  })

  it('reconciles mission history in bounded chunks while polling recent fixes [DON-260]', async () => {
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue([NORMALIZED_DEVICES[0]!]),
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })
    const onStatusChange = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 5 * 60 * 1000,
      getInitialBreadcrumbFrom: () => new Date('2026-04-06T00:00:00.000Z'),
      getBreadcrumbDeviceIds: () => ['1'],
      onSnapshot: vi.fn(),
      onStatusChange,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)

    const windows = vi.mocked(client.getBreadcrumbs).mock.calls.map((call) => ({
      from: call[1],
      to: call[2],
    }))
    expect(windows).toContainEqual({
      from: new Date('2026-04-06T00:00:00.000Z'),
      to: new Date('2026-04-06T02:00:00.000Z'),
    })
    expect(windows).toContainEqual({
      from: new Date('2026-04-06T02:00:00.000Z'),
      to: new Date('2026-04-06T04:00:00.000Z'),
    })
    expect(
      windows.every(
        (window) => window.to.getTime() - window.from.getTime() <= 2 * 60 * 60 * 1000,
      ),
    ).toBe(true)
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'online',
        warning: expect.stringMatching(/reconciling/i),
      }),
    )

    poller.stop()
  })

  it('completes a 36-hour initial history sweep without waiting for the normal poll interval', async () => {
    const missionStartedAt = new Date('2026-04-06T00:00:00.000Z')
    const currentTime = new Date('2026-04-07T12:00:00.000Z')
    const historicalWindows: Array<{ readonly from: Date; readonly to: Date }> = []
    const onSnapshot = vi.fn()
    const onStatusChange = vi.fn()
    const onPollDiagnostic = vi.fn()
    let activeHistoricalRequests = 0
    let maximumHistoricalConcurrency = 0
    let currentFixPublishedBeforeHistory = false
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue([NORMALIZED_DEVICES[0]!]),
      getCurrentPositions: vi.fn().mockResolvedValue([NORMALIZED_POSITIONS[0]!]),
      getBreadcrumbs: vi.fn().mockImplementation(
        async (_deviceId: string, from: Date, to: Date) => {
          const durationMs = to.getTime() - from.getTime()
          if (durationMs > 5 * 60 * 1000) {
            currentFixPublishedBeforeHistory = onSnapshot.mock.calls.some(
              (call) => call[0]?.positions.length === 1,
            )
            historicalWindows.push({ from, to })
            activeHistoricalRequests += 1
            maximumHistoricalConcurrency = Math.max(
              maximumHistoricalConcurrency,
              activeHistoricalRequests,
            )
            await Promise.resolve()
            activeHistoricalRequests -= 1
          }
          return []
        },
      ),
    })
    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 5 * 60 * 1000,
      getInitialBreadcrumbFrom: () => missionStartedAt,
      getBreadcrumbDeviceIds: () => ['1'],
      onSnapshot,
      onStatusChange,
      onPollDiagnostic,
      now: () => currentTime,
    })

    poller.start()
    // Drain only immediately available work. Advancing the 30-second steady-poll
    // timer would hide the field regression by making a 36-hour initial load take
    // seventeen extra poll intervals (8.5 minutes for one device).
    await vi.advanceTimersByTimeAsync(0)

    expect(currentFixPublishedBeforeHistory).toBe(true)
    expect(historicalWindows).toHaveLength(18)
    expect(historicalWindows[0]).toEqual({
      from: missionStartedAt,
      to: new Date('2026-04-06T02:00:00.000Z'),
    })
    expect(historicalWindows.at(-1)).toEqual({
      from: new Date('2026-04-07T10:00:00.000Z'),
      to: currentTime,
    })
    expect(
      historicalWindows.every(
        (window, index) =>
          window.to.getTime() - window.from.getTime() <= 2 * 60 * 60 * 1000 &&
          (index === 0 ||
            historicalWindows[index - 1]?.to.getTime() === window.from.getTime()),
      ),
    ).toBe(true)
    expect(maximumHistoricalConcurrency).toBeLessThanOrEqual(8)
    expect(client.getDevices).toHaveBeenCalledTimes(1)
    expect(client.getCurrentPositions).toHaveBeenCalledTimes(1)
    expect(onStatusChange.mock.calls.at(-1)?.[0]?.warning).toBeNull()
    const reconciliationDiagnostics = onPollDiagnostic.mock.calls
      .map((call) => call[0])
      .filter((entry) => entry.kind === 'breadcrumb_reconciliation')
    expect(reconciliationDiagnostics.at(-1)).toEqual(
      expect.objectContaining({
        outcome: 'complete',
        reconciliationPhase: 'initial',
        targetFrom: missionStartedAt.toISOString(),
        targetTo: currentTime.toISOString(),
        totalDeviceCount: 1,
        completedDeviceCount: 1,
        totalChunkCount: 18,
        completedChunkCount: 18,
        pendingDeviceCount: 0,
        failedDeviceCount: 0,
      }),
    )
    expect(JSON.stringify(reconciliationDiagnostics)).not.toMatch(
      /deviceId|deviceName|Donal Phone/u,
    )

    poller.stop()
  })

  it('resumes from a durable checkpoint and acknowledges empty initial chunks', async () => {
    const missionStartedAt = new Date('2026-04-06T00:00:00.000Z')
    const currentTime = new Date('2026-04-06T06:00:00.000Z')
    const persistHistoryChunk = vi.fn().mockResolvedValue(undefined)
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue([NORMALIZED_DEVICES[0]!]),
      getCurrentPositions: vi.fn().mockResolvedValue([NORMALIZED_POSITIONS[0]!]),
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })
    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 5 * 60 * 1000,
      getHistoryResetKey: () => 'mission-1',
      getInitialBreadcrumbFrom: () => missionStartedAt,
      getInitialBreadcrumbs: async () => [],
      getInitialHistoryCheckpoints: async () => ({
        '1': {
          historyFrom: missionStartedAt.toISOString(),
          reconciledUntil: '2026-04-06T02:00:00.000Z',
        },
      }),
      getBreadcrumbDeviceIds: () => ['1'],
      persistHistoryChunk,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(persistHistoryChunk.mock.calls.map((call) => call[0])).toEqual([
      {
        phase: 'initial',
        expectedMissionId: 'mission-1',
        deviceId: '1',
        historyFrom: missionStartedAt.toISOString(),
        reconciledUntil: '2026-04-06T04:00:00.000Z',
        positions: [],
      },
      {
        phase: 'initial',
        expectedMissionId: 'mission-1',
        deviceId: '1',
        historyFrom: missionStartedAt.toISOString(),
        reconciledUntil: currentTime.toISOString(),
        positions: [],
      },
    ])
    const historicalWindows = vi.mocked(client.getBreadcrumbs).mock.calls
      .filter((call) => call[2].getTime() - call[1].getTime() > 5 * 60 * 1000)
      .map((call) => [call[1], call[2]])
    expect(historicalWindows).toEqual([
      [
        new Date('2026-04-06T02:00:00.000Z'),
        new Date('2026-04-06T04:00:00.000Z'),
      ],
      [
        new Date('2026-04-06T04:00:00.000Z'),
        currentTime,
      ],
    ])

    poller.stop()
  })

  it('refreshes a same-process participant history origin and reconciles its new prefix', async () => {
    const missionStartedAt = new Date('2026-04-06T08:00:00.000Z')
    const currentTime = new Date('2026-04-06T14:00:00.000Z')
    let participantHistoryStart = '2026-04-06T12:00:00.000Z'
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue([NORMALIZED_DEVICES[0]!]),
      getCurrentPositions: vi.fn().mockResolvedValue([NORMALIZED_POSITIONS[0]!]),
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })
    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 5 * 60 * 1000,
      getHistoryResetKey: () => 'mission-1',
      getInitialBreadcrumbFrom: () => missionStartedAt,
      getInitialBreadcrumbs: async () => [],
      getInitialHistoryCheckpoints: async () => ({
        '1': {
          historyFrom: '2026-04-06T12:00:00.000Z',
          reconciledUntil: currentTime.toISOString(),
        },
      }),
      getBreadcrumbDeviceIds: () => ['1'],
      getParticipantHistoryStarts: () => ({ '1': participantHistoryStart }),
      persistHistoryChunk: vi.fn().mockResolvedValue({ changed: false }),
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    participantHistoryStart = '2026-04-06T10:00:00.000Z'
    await vi.advanceTimersByTimeAsync(30_000)

    const historicalWindows = vi.mocked(client.getBreadcrumbs).mock.calls
      .filter((call) => call[2].getTime() - call[1].getTime() > 5 * 60 * 1000)
      .map((call) => [call[1], call[2]])
    expect(historicalWindows).toEqual([[
      new Date('2026-04-06T10:00:00.000Z'),
      new Date('2026-04-06T12:00:00.000Z'),
    ]])

    poller.stop()
  })

  it('publishes an initial fetch wave only after its atomic persistence acknowledgement', async () => {
    const missionStartedAt = new Date('2026-04-06T00:00:00.000Z')
    const currentTime = new Date('2026-04-06T06:00:00.000Z')
    const persistence = createDeferred<void>()
    const persistHistoryChunks = vi.fn().mockReturnValue(persistence.promise)
    const persistHistoryChunk = vi.fn().mockResolvedValue({ changed: true })
    const historyPositions = NORMALIZED_DEVICES.slice(0, 2).map((device, index) => ({
      ...NORMALIZED_BREADCRUMBS[index]!,
      id: `initial-wave-${device.device_id}`,
      device_id: device.device_id,
      timestamp: '2026-04-06T01:00:00.000Z',
    }))
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(NORMALIZED_DEVICES.slice(0, 2)),
      getCurrentPositions: vi.fn().mockResolvedValue(NORMALIZED_POSITIONS.slice(0, 2)),
      getBreadcrumbs: vi.fn().mockImplementation(
        async (deviceId: string, from: Date) =>
          from.getTime() === missionStartedAt.getTime()
            ? historyPositions.filter((position) => position.device_id === deviceId)
            : [],
      ),
    })
    const onSnapshot = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 5 * 60 * 1000,
      getHistoryResetKey: () => 'mission-1',
      getInitialBreadcrumbFrom: () => missionStartedAt,
      getInitialBreadcrumbs: async () => [],
      getBreadcrumbDeviceIds: () => NORMALIZED_DEVICES.slice(0, 2).map(
        (device) => device.device_id,
      ),
      persistHistoryChunks,
      persistHistoryChunk,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(persistHistoryChunks).toHaveBeenCalledOnce()
    expect(persistHistoryChunks.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        phase: 'initial',
        deviceId: NORMALIZED_DEVICES[0]!.device_id,
        positions: [historyPositions[0]],
      }),
      expect.objectContaining({
        phase: 'initial',
        deviceId: NORMALIZED_DEVICES[1]!.device_id,
        positions: [historyPositions[1]],
      }),
    ])
    expect(persistHistoryChunk).not.toHaveBeenCalled()
    expect(
      onSnapshot.mock.calls.flatMap((call) => call[0].breadcrumbs).map(
        (position) => position.id,
      ),
    ).not.toContain(historyPositions[0]!.id)

    persistence.resolve()
    await vi.advanceTimersByTimeAsync(0)

    expect(
      onSnapshot.mock.calls.flatMap((call) => call[0].breadcrumbs).map(
        (position) => position.id,
      ),
    ).toEqual(expect.arrayContaining(historyPositions.map((position) => position.id)))

    poller.stop()
  })

  it('uses singleton batch acknowledgements to isolate a failed wave without a singular hook', async () => {
    const missionStartedAt = new Date('2026-04-06T00:00:00.000Z')
    const currentTime = new Date('2026-04-06T02:00:00.000Z')
    const singletonAcknowledgements = NORMALIZED_DEVICES.slice(0, 2).map(() =>
      createDeferred<void>(),
    )
    const singletonAcknowledgementQueue = [...singletonAcknowledgements]
    const persistHistoryChunks = vi.fn().mockImplementation(
      (inputs: readonly unknown[]) => {
        if (inputs.length > 1) {
          return Promise.reject(new Error('wave transaction rejected'))
        }
        const acknowledgement = singletonAcknowledgementQueue.shift()
        return acknowledgement?.promise ?? Promise.resolve()
      },
    )
    const historyPositions = NORMALIZED_DEVICES.slice(0, 2).map((device, index) => ({
      ...NORMALIZED_BREADCRUMBS[index]!,
      id: `singleton-wave-${device.device_id}`,
      device_id: device.device_id,
      timestamp: '2026-04-06T01:00:00.000Z',
    }))
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(NORMALIZED_DEVICES.slice(0, 2)),
      getCurrentPositions: vi.fn().mockResolvedValue(NORMALIZED_POSITIONS.slice(0, 2)),
      getBreadcrumbs: vi.fn().mockImplementation(
        async (deviceId: string, from: Date) =>
          from.getTime() === missionStartedAt.getTime()
            ? historyPositions.filter((position) => position.device_id === deviceId)
            : [],
      ),
    })
    const onSnapshot = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 5 * 60 * 1000,
      getHistoryResetKey: () => 'mission-1',
      getInitialBreadcrumbFrom: () => missionStartedAt,
      getInitialBreadcrumbs: async () => [],
      getBreadcrumbDeviceIds: () => NORMALIZED_DEVICES.slice(0, 2).map(
        (device) => device.device_id,
      ),
      persistHistoryChunks,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(persistHistoryChunks).toHaveBeenCalledTimes(3)
    expect(persistHistoryChunks.mock.calls.map((call) => call[0].length)).toEqual([
      2,
      1,
      1,
    ])
    expect(
      onSnapshot.mock.calls.flatMap((call) => call[0].breadcrumbs).map(
        (position) => position.id,
      ),
    ).not.toContain(historyPositions[0]!.id)

    for (const acknowledgement of singletonAcknowledgements) {
      acknowledgement.resolve()
    }
    await vi.advanceTimersByTimeAsync(0)

    expect(
      onSnapshot.mock.calls.flatMap((call) => call[0].breadcrumbs).map(
        (position) => position.id,
      ),
    ).toEqual(expect.arrayContaining(historyPositions.map((position) => position.id)))

    poller.stop()
  })

  it('batches initial history publication and suppresses intermediate cache writes', async () => {
    const missionStartedAt = new Date('2026-04-06T00:00:00.000Z')
    const currentTime = new Date('2026-04-07T12:00:00.000Z')
    let nextPositionId = 1
    const onSnapshot = vi.fn()
    const persistHistoryChunk = vi.fn().mockResolvedValue(undefined)
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue([NORMALIZED_DEVICES[0]!]),
      getCurrentPositions: vi.fn().mockResolvedValue([NORMALIZED_POSITIONS[0]!]),
      getBreadcrumbs: vi.fn().mockImplementation(
        async (_deviceId: string, from: Date, to: Date) => {
          if (to.getTime() - from.getTime() <= 5 * 60 * 1000) {
            return []
          }
          return Array.from({ length: 500 }, (_, index) => ({
            ...NORMALIZED_POSITIONS[0]!,
            id: String(nextPositionId++),
            timestamp: new Date(from.getTime() + index * 1_000).toISOString(),
          }))
        },
      ),
    })
    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 5 * 60 * 1000,
      getInitialBreadcrumbFrom: () => missionStartedAt,
      getBreadcrumbDeviceIds: () => ['1'],
      persistHistoryChunk,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    const historySnapshots = onSnapshot.mock.calls.filter(
      (call) => call[1]?.suppressTrackingCache !== undefined,
    )
    expect(historySnapshots).toHaveLength(2)
    for (const [snapshot] of historySnapshots) {
      expect(snapshot).toHaveProperty('rawBreadcrumbsForPersistence')
      expect(snapshot.rawBreadcrumbsForPersistence).toEqual([])
    }
    expect(historySnapshots[0]?.[1]?.suppressTrackingCache).toBe(true)
    expect(historySnapshots[1]?.[1]?.suppressTrackingCache).toBe(false)
    expect(
      persistHistoryChunk.mock.calls.flatMap((call) => call[0].positions),
    ).toHaveLength(9_000)

    poller.stop()
  })

  it('bounds provisional 36-hour source while preserving every durable fix and final canonical identity', async () => {
    const missionStartedAt = new Date('2026-04-06T00:00:00.000Z')
    const currentTime = new Date('2026-04-07T12:00:00.000Z')
    const nextPositionIdByDevice = new Map<string, number>()
    const progressivePositionsByDevice = new Map<
      string,
      NormalizedTrackingPosition[]
    >()
    const canonicalLoad = createDeferred<{
      readonly positions: readonly NormalizedTrackingPosition[]
      readonly totalObservedByDevice: Readonly<Record<string, number>>
      readonly selectionMetadataByDevice: Readonly<Record<string, {
        readonly geometryErrorBoundMetres: number | null
        readonly targetGeometryErrorSatisfied: boolean
      }>>
    }>()
    const getCanonicalBreadcrumbs = vi.fn().mockReturnValue(canonicalLoad.promise)
    const onSnapshot = vi.fn()
    const persistHistoryChunk = vi.fn().mockResolvedValue({ changed: true })
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(NORMALIZED_DEVICES),
      getCurrentPositions: vi.fn().mockResolvedValue([NORMALIZED_POSITIONS[0]!]),
      getBreadcrumbs: vi.fn().mockImplementation(
        async (deviceId: string, from: Date, to: Date) => {
          if (to.getTime() - from.getTime() <= 5 * 60 * 1000) {
            return []
          }
          const nextPositionId = nextPositionIdByDevice.get(deviceId) ?? 1
          const chunk = Array.from({ length: 500 }, (_, index) => ({
            ...NORMALIZED_POSITIONS[0]!,
            id: `${deviceId}-${nextPositionId + index}`,
            device_id: deviceId,
            timestamp: new Date(from.getTime() + index * 1_000).toISOString(),
          }))
          nextPositionIdByDevice.set(deviceId, nextPositionId + chunk.length)
          const progressive = progressivePositionsByDevice.get(deviceId) ?? []
          progressive.push(...chunk)
          progressivePositionsByDevice.set(deviceId, progressive)
          return chunk
        },
      ),
    })
    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 5 * 60 * 1000,
      getHistoryResetKey: () => 'mission-1',
      getInitialBreadcrumbFrom: () => missionStartedAt,
      getInitialBreadcrumbs: async () => [],
      getCanonicalBreadcrumbs,
      persistHistoryChunk,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot.mock.calls[0]?.[0].positions.map(
      (position: NormalizedTrackingPosition) => position.id,
    )).toEqual([NORMALIZED_POSITIONS[0]!.id])
    expect(onSnapshot.mock.calls[0]?.[0].breadcrumbs).toEqual([])
    expect([...progressivePositionsByDevice.keys()].sort()).toEqual(['1', '2'])
    expect(progressivePositionsByDevice.get('1')).toHaveLength(9_000)
    expect(progressivePositionsByDevice.get('2')).toHaveLength(9_000)
    expect(getCanonicalBreadcrumbs).toHaveBeenCalledWith(
      'mission-1',
      expect.any(AbortSignal),
    )
    const provisionalHistorySnapshots = onSnapshot.mock.calls
      .filter((call) => call[1]?.suppressTrackingCache !== undefined)
      .map((call) => call[0])
    expect(provisionalHistorySnapshots.length).toBeGreaterThan(1)
    for (const snapshot of provisionalHistorySnapshots) {
      for (const budget of snapshot.breadcrumbMetadata.deviceBudgets) {
        expect(budget.sourceRetained).toBeLessThanOrEqual(5_000)
        expect(budget.geometryErrorBoundMetres).not.toBeNull()
        expect(budget.geometryErrorBoundMetres).toBeLessThanOrEqual(25)
        expect(budget.targetGeometryErrorSatisfied).toBe(true)
      }
    }
    expect(
      persistHistoryChunk.mock.calls.flatMap((call) => call[0].positions),
    ).toHaveLength(18_000)

    const canonicalPositions = [...progressivePositionsByDevice.values()]
      .flatMap((positions) => positions.filter((_position, index) => index % 3 === 0))
      .sort(
        (left, right) =>
          Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
          left.device_id.localeCompare(right.device_id),
      )
    canonicalLoad.resolve({
      positions: canonicalPositions,
      totalObservedByDevice: { '1': 9_000, '2': 9_000 },
      selectionMetadataByDevice: {
        '1': {
          geometryErrorBoundMetres: 20,
          targetGeometryErrorSatisfied: true,
        },
        '2': {
          geometryErrorBoundMetres: 20,
          targetGeometryErrorSatisfied: true,
        },
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    const settled = onSnapshot.mock.calls.at(-1)?.[0]
    expect(settled.rawBreadcrumbsForPersistence).toEqual([])
    expect(settled.breadcrumbs.map((position: NormalizedTrackingPosition) => position.id)).toEqual(
      canonicalPositions.map((position) => position.id),
    )
    expect(settled.breadcrumbMetadata.totalObserved).toBe(18_000)
    expect(settled.breadcrumbMetadata.deviceBudgets).toEqual([
      expect.objectContaining({ sourceRetained: 3_000, total: 9_000 }),
      expect.objectContaining({ sourceRetained: 3_000, total: 9_000 }),
    ])

    poller.stop()
  })

  it.each([
    { changed: true, expectedCanonicalLoads: 2, label: 'changed' },
    { changed: false, expectedCanonicalLoads: 1, label: 'duplicate-only' },
  ])('refreshes canonical history after $label anti-entropy persistence only when truth changed', async ({
    changed,
    expectedCanonicalLoads,
  }) => {
    const missionStartedAt = new Date('2026-04-06T00:00:00.000Z')
    const currentTime = new Date('2026-04-06T02:00:00.000Z')
    const historicalPosition = {
      ...NORMALIZED_BREADCRUMBS[0]!,
      id: '500',
      timestamp: '2026-04-06T01:00:00.000Z',
    }
    const canonicalSeed = {
      positions: [historicalPosition],
      totalObservedByDevice: { '1': 1 },
      selectionMetadataByDevice: {},
    }
    const firstCanonicalLoad = createDeferred<typeof canonicalSeed>()
    const getCanonicalBreadcrumbs = vi.fn()
      .mockReturnValueOnce(firstCanonicalLoad.promise)
      .mockResolvedValue(canonicalSeed)
    const persistHistoryChunk = vi.fn().mockImplementation(async (input) => ({
      changed: input.phase === 'initial' ? true : changed,
    }))
    const poller = createPollingManager(createClient({
      getDevices: vi.fn().mockResolvedValue([NORMALIZED_DEVICES[0]!]),
      getCurrentPositions: vi.fn().mockResolvedValue([]),
      getBreadcrumbs: vi.fn().mockImplementation(
        async (_deviceId: string, from: Date, to: Date) =>
          to.getTime() - from.getTime() > 5 * 60 * 1000
            ? [historicalPosition]
            : [],
      ),
    }), {
      intervalMs: 60 * 60 * 1_000,
      staleThresholdMs: 5 * 60 * 1000,
      getHistoryResetKey: () => 'mission-1',
      getInitialBreadcrumbFrom: () => missionStartedAt,
      getInitialBreadcrumbs: async () => [],
      getCanonicalBreadcrumbs,
      persistHistoryChunk,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(getCanonicalBreadcrumbs).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000)
    expect(getCanonicalBreadcrumbs).toHaveBeenCalledTimes(1)

    firstCanonicalLoad.resolve(canonicalSeed)
    await vi.advanceTimersByTimeAsync(0)
    expect(getCanonicalBreadcrumbs).toHaveBeenCalledTimes(expectedCanonicalLoads)

    poller.stop()
  })

  it('canonicalizes once for repeated completed initial-reconciliation progress', async () => {
    const currentTime = new Date('2026-04-06T02:00:00.000Z')
    const canonicalSeed = {
      positions: [] as readonly NormalizedTrackingPosition[],
      totalObservedByDevice: {},
      selectionMetadataByDevice: {},
    }
    const canonicalLoad = createDeferred<typeof canonicalSeed>()
    const getCanonicalBreadcrumbs = vi.fn().mockReturnValue(canonicalLoad.promise)
    const poller = createPollingManager(createClient({
      getDevices: vi.fn().mockResolvedValue([NORMALIZED_DEVICES[0]!]),
      getCurrentPositions: vi.fn().mockResolvedValue([]),
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    }), {
      intervalMs: 5_000,
      staleThresholdMs: 5 * 60 * 1_000,
      getHistoryResetKey: () => 'mission-1',
      getInitialBreadcrumbFrom: () => currentTime,
      getInitialBreadcrumbs: async () => [],
      getCanonicalBreadcrumbs,
      persistHistoryChunk: vi.fn().mockResolvedValue({ changed: false }),
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(getCanonicalBreadcrumbs).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(getCanonicalBreadcrumbs).toHaveBeenCalledTimes(1)

    canonicalLoad.resolve(canonicalSeed)
    await vi.advanceTimersByTimeAsync(0)
    expect(getCanonicalBreadcrumbs).toHaveBeenCalledTimes(1)

    poller.stop()
  })

  it('starts a new canonicalization epoch when breadcrumb device selection expands', async () => {
    const currentTime = new Date('2026-04-06T02:00:00.000Z')
    let selectedDeviceIds = ['1']
    const getCanonicalBreadcrumbs = vi.fn().mockResolvedValue({
      positions: [],
      totalObservedByDevice: {},
      selectionMetadataByDevice: {},
    })
    const poller = createPollingManager(createClient({
      getDevices: vi.fn().mockResolvedValue(NORMALIZED_DEVICES),
      getCurrentPositions: vi.fn().mockResolvedValue([]),
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    }), {
      intervalMs: 30_000,
      staleThresholdMs: 5 * 60 * 1_000,
      getHistoryResetKey: () => 'mission-1',
      getInitialBreadcrumbFrom: () => currentTime,
      getInitialBreadcrumbs: async () => [],
      getBreadcrumbDeviceIds: () => selectedDeviceIds,
      getCanonicalBreadcrumbs,
      persistHistoryChunk: vi.fn().mockResolvedValue({ changed: false }),
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(getCanonicalBreadcrumbs).toHaveBeenCalledTimes(1)

    selectedDeviceIds = ['1', '2']
    poller.requestPollNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(getCanonicalBreadcrumbs).toHaveBeenCalledTimes(2)

    poller.stop()
  })

  it('aborts stale canonical work on mission replacement and stop', async () => {
    const currentTime = new Date('2026-04-06T02:00:00.000Z')
    let missionId = 'mission-a'
    const observedSignals = new Map<string, AbortSignal | undefined>()
    const getCanonicalBreadcrumbs = vi.fn(
      (expectedMissionId: string, signal?: AbortSignal) => {
        observedSignals.set(expectedMissionId, signal)
        return new Promise<{
          readonly positions: readonly NormalizedTrackingPosition[]
          readonly totalObservedByDevice: Readonly<Record<string, number>>
          readonly selectionMetadataByDevice: Readonly<Record<string, never>>
        }>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            const error = new Error('Canonical query aborted.')
            error.name = 'AbortError'
            reject(error)
          }, { once: true })
        })
      },
    )
    const logger = { warn: vi.fn() }
    const onSnapshot = vi.fn()
    const poller = createPollingManager(createClient({
      getDevices: vi.fn().mockResolvedValue([NORMALIZED_DEVICES[0]!]),
      getCurrentPositions: vi.fn().mockResolvedValue([]),
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    }), {
      intervalMs: 30_000,
      staleThresholdMs: 5 * 60 * 1_000,
      getHistoryResetKey: () => missionId,
      getInitialBreadcrumbFrom: () => currentTime,
      getInitialBreadcrumbs: async () => [],
      getCanonicalBreadcrumbs,
      persistHistoryChunk: vi.fn().mockResolvedValue({ changed: false }),
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => currentTime,
      logger,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(getCanonicalBreadcrumbs).toHaveBeenCalledTimes(1)

    const callsBeforeMissionSwitch = onSnapshot.mock.calls.length
    missionId = 'mission-b'
    poller.requestPollNow()
    await vi.advanceTimersByTimeAsync(0)

    expect(observedSignals.get('mission-a')?.aborted).toBe(true)
    expect(getCanonicalBreadcrumbs.mock.calls.map(([id]) => id)).toEqual([
      'mission-a',
      'mission-b',
    ])
    expect(
      onSnapshot.mock.calls.slice(callsBeforeMissionSwitch).every(
        (call) => call[1]?.historyResetKey === 'mission-b',
      ),
    ).toBe(true)
    expect(logger.warn).not.toHaveBeenCalledWith(
      'Tracking breadcrumb canonicalization failed.',
      expect.anything(),
    )

    poller.stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(observedSignals.get('mission-b')?.aborted).toBe(true)
  })

  it('reruns an in-flight worker so a durable late correction ends at exact CJS truth', async () => {
    const anchorMs = Date.UTC(2026, 0, 1)
    const baseMs = Math.floor(anchorMs / 4_096) * 4_096
    const createStoredRow = (
      sourcePositionId: string,
      offsetMs: number,
      lat: number,
      lon: number,
    ): StoredBreadcrumbRow => ({
      mission_id: 'mission-1',
      source_position_id: sourcePositionId,
      device_id: '1',
      lat,
      lon,
      timestamp: new Date(baseMs + offsetMs).toISOString(),
      source: 'synthetic',
    })
    const durableBeforeCorrection = [
      ...Array.from({ length: 10 }, (_, index) =>
        createStoredRow(`A${index + 1}`, index, 52, -9.7),
      ),
      ...Array.from({ length: 4_992 }, (_, index) =>
        index % 2 === 0
          ? createStoredRow(`C${index + 1}`, index + 10, 53, -9)
          : createStoredRow(`D${index + 1}`, index + 10, 54, -8),
      ),
    ]
    const lateCorrection = createStoredRow('B', 5.5, 52, -9.69)
    const selectCanonical = (rows: readonly StoredBreadcrumbRow[]) =>
      listBreadcrumbPositions({
        transaction: (callback: () => unknown) => callback,
        prepare: (query: string) =>
          query.includes('COUNT(*)')
            ? {
                all: () => [{ device_id: '1', total: rows.length }],
              }
            : {
                iterate: () => rows,
              },
      }, 'mission-1', 5_000)
    const normalizeStoredRows = (
      rows: readonly StoredBreadcrumbRow[],
    ): readonly NormalizedTrackingPosition[] =>
      rows.map((row) => ({
        ...NORMALIZED_POSITIONS[0]!,
        id: row.source_position_id,
        device_id: row.device_id,
        lat: row.lat,
        lon: row.lon,
        timestamp: row.timestamp,
        source: row.source,
      }))
    const createCanonicalSeed = (
      selection: ReturnType<typeof selectCanonical>,
    ) => ({
      positions: normalizeStoredRows(selection.positions),
      totalObservedByDevice: Object.fromEntries(
        selection.deviceTotals.map((entry) => [entry.device_id, entry.total]),
      ),
      selectionMetadataByDevice: Object.fromEntries(
        selection.deviceSelections.map((entry) => [entry.device_id, {
          geometryErrorBoundMetres: entry.geometryErrorBoundMetres,
          targetGeometryErrorSatisfied: entry.targetGeometryErrorSatisfied,
          timeBucketWidthMs: entry.timeBucketWidthMs,
          spatialBucketWidthDegrees: entry.spatialBucketWidthDegrees,
        }]),
      ),
    })
    const firstCanonical = createCanonicalSeed(
      selectCanonical(durableBeforeCorrection),
    )
    const exactCanonical = createCanonicalSeed(
      selectCanonical([...durableBeforeCorrection, lateCorrection]),
    )
    const firstCanonicalLoad = createDeferred<typeof firstCanonical>()
    const exactCanonicalLoad = createDeferred<typeof exactCanonical>()
    const getCanonicalBreadcrumbs = vi.fn()
      .mockReturnValueOnce(firstCanonicalLoad.promise)
      .mockReturnValueOnce(exactCanonicalLoad.promise)
    let historicalVisit = 0
    const onSnapshot = vi.fn()
    const poller = createPollingManager(createClient({
      getDevices: vi.fn().mockResolvedValue([NORMALIZED_DEVICES[0]!]),
      getCurrentPositions: vi.fn().mockResolvedValue([]),
      getBreadcrumbs: vi.fn().mockImplementation(
        async (_deviceId: string, from: Date, to: Date) => {
          if (to.getTime() - from.getTime() <= 5 * 60 * 1_000) {
            return []
          }
          historicalVisit += 1
          return historicalVisit === 1
            ? []
            : normalizeStoredRows([lateCorrection])
        },
      ),
    }), {
      intervalMs: 60 * 60 * 1_000,
      staleThresholdMs: 5 * 60 * 1_000,
      getHistoryResetKey: () => 'mission-1',
      getInitialBreadcrumbFrom: () => new Date(baseMs),
      getInitialBreadcrumbs: async () => [],
      getCanonicalBreadcrumbs,
      persistHistoryChunk: vi.fn().mockImplementation(async (input) => ({
        changed: input.phase === 'anti_entropy',
      })),
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date(baseMs + 2 * 60 * 60 * 1_000),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(getCanonicalBreadcrumbs).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000)
    expect(getCanonicalBreadcrumbs).toHaveBeenCalledTimes(1)

    firstCanonicalLoad.resolve(firstCanonical)
    await vi.advanceTimersByTimeAsync(0)
    expect(getCanonicalBreadcrumbs).toHaveBeenCalledTimes(2)
    const interim = onSnapshot.mock.calls.at(-1)?.[0]
    expect(
      interim.breadcrumbMetadata.deviceBudgets[0].sourceRetained,
    ).toBeLessThanOrEqual(5_000)
    expect(
      interim.breadcrumbs.map((position: NormalizedTrackingPosition) => position.id),
    ).not.toEqual(
      exactCanonical.positions.map((position) => position.id),
    )

    exactCanonicalLoad.resolve(exactCanonical)
    await vi.advanceTimersByTimeAsync(0)
    const settled = onSnapshot.mock.calls.at(-1)?.[0]
    expect(
      settled.breadcrumbs.map((position: NormalizedTrackingPosition) => position.id),
    ).toEqual(exactCanonical.positions.map((position) => position.id))
    expect(settled.breadcrumbMetadata.deviceBudgets[0]).toEqual(
      expect.objectContaining({
        sourceRetained: exactCanonical.positions.length,
        total: durableBeforeCorrection.length + 1,
      }),
    )

    poller.stop()
  })

  it('does not canonicalize history that failed durable persistence', async () => {
    const getCanonicalBreadcrumbs = vi.fn()
    const onSnapshot = vi.fn()
    const poller = createPollingManager(createClient({
      getDevices: vi.fn().mockResolvedValue([NORMALIZED_DEVICES[0]!]),
      getCurrentPositions: vi.fn().mockResolvedValue([]),
      getBreadcrumbs: vi.fn().mockImplementation(
        async (_deviceId: string, from: Date, to: Date) =>
          to.getTime() - from.getTime() > 5 * 60 * 1000
            ? [NORMALIZED_BREADCRUMBS[0]!]
            : [],
      ),
    }), {
      intervalMs: 30_000,
      staleThresholdMs: 5 * 60 * 1000,
      getHistoryResetKey: () => 'mission-1',
      getInitialBreadcrumbFrom: () => new Date('2026-04-06T00:00:00.000Z'),
      getInitialBreadcrumbs: async () => [],
      getCanonicalBreadcrumbs,
      persistHistoryChunk: vi.fn().mockRejectedValue(
        new Error('atomic persistence failed'),
      ),
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T02:00:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(getCanonicalBreadcrumbs).not.toHaveBeenCalled()
    expect(
      onSnapshot.mock.calls.flatMap((call) => call[0].breadcrumbs),
    ).not.toContainEqual(NORMALIZED_BREADCRUMBS[0])

    poller.stop()
  })

  it('round-robins continuous catch-up for a large team without an immediate rescan [DON-260]', async () => {
    const devices = Array.from({ length: 16 }, (_, index) => ({
      ...NORMALIZED_DEVICES[0]!,
      device_id: String(index + 1),
      name: `Tracker ${index + 1}`,
    }))
    let activeHistoricalRequests = 0
    let maximumHistoricalConcurrency = 0
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(devices),
      getCurrentPositions: vi.fn().mockResolvedValue([]),
      getBreadcrumbs: vi.fn().mockImplementation(
        async (_deviceId: string, from: Date, to: Date) => {
          if (to.getTime() - from.getTime() > 5 * 60 * 1000) {
            activeHistoricalRequests += 1
            maximumHistoricalConcurrency = Math.max(
              maximumHistoricalConcurrency,
              activeHistoricalRequests,
            )
            await Promise.resolve()
            activeHistoricalRequests -= 1
          }
          return []
        },
      ),
    })
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 5 * 60 * 1000,
      getInitialBreadcrumbFrom: () => new Date('2026-04-06T00:00:00.000Z'),
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    const firstPollCalls = [...vi.mocked(client.getBreadcrumbs).mock.calls]
    const firstHistoricalDeviceIds = firstPollCalls
      .filter((call) => call[2].getTime() - call[1].getTime() > 5 * 60 * 1000)
      .map((call) => call[0])
    expect(firstPollCalls).toHaveLength(112)
    expect(firstHistoricalDeviceIds.slice(0, 16)).toEqual([
      '1',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
      '16',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ])
    expect(firstHistoricalDeviceIds).toHaveLength(96)
    expect(maximumHistoricalConcurrency).toBeLessThanOrEqual(8)
    for (const device of devices) {
      expect(
        firstHistoricalDeviceIds.filter((deviceId) => deviceId === device.device_id),
      ).toHaveLength(6)
    }

    await vi.advanceTimersByTimeAsync(5_000)

    const secondPollCalls = vi.mocked(client.getBreadcrumbs).mock.calls.slice(
      firstPollCalls.length,
    )
    const secondHistoricalDeviceIds = secondPollCalls
      .filter((call) => call[2].getTime() - call[1].getTime() > 5 * 60 * 1000)
      .map((call) => call[0])
    expect(secondPollCalls).toHaveLength(16)
    expect(secondHistoricalDeviceIds).toEqual([])

    poller.stop()
  })

  it('finds a late fix through low-rate anti-entropy without an immediate rescan [DON-260]', async () => {
    const lateFix = {
      ...NORMALIZED_POSITIONS[0],
      id: '991001',
      timestamp: '2026-04-06T08:30:00.000Z',
    } satisfies NormalizedTrackingPosition
    let historicalWindowVisits = 0
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue([NORMALIZED_DEVICES[0]!]),
      getBreadcrumbs: vi.fn().mockImplementation(
        async (_deviceId: string, from: Date, to: Date) => {
          if (
            from.toISOString() === '2026-04-06T08:00:00.000Z' &&
            to.toISOString() === '2026-04-06T10:00:00.000Z'
          ) {
            historicalWindowVisits += 1
            return historicalWindowVisits >= 2 ? [lateFix] : []
          }
          return []
        },
      ),
    })
    const onSnapshot = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 5 * 60 * 1000,
      getInitialBreadcrumbFrom: () => new Date('2026-04-06T08:00:00.000Z'),
      getBreadcrumbDeviceIds: () => ['1'],
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:00:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(historicalWindowVisits).toBe(1)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 5_000)

    expect(historicalWindowVisits).toBe(2)
    expect(
      onSnapshot.mock.calls
        .map((call) => call[0] as TrackingSnapshot)
        .some((snapshot) =>
          snapshot.breadcrumbs.some((breadcrumb) => breadcrumb.id === lateFix.id),
        ),
    ).toBe(true)

    poller.stop()
  })

  it('overlaps incremental breadcrumb fetches so buffered older fixes are not skipped [DON-233]', async () => {
    const firstBatch = [
      {
        ...NORMALIZED_POSITIONS[0],
        id: 'newest-first-poll',
        timestamp: '2026-04-06T10:20:00.000Z',
      },
    ] satisfies readonly NormalizedTrackingPosition[]
    const bufferedOlderFix = {
      ...NORMALIZED_POSITIONS[0],
      id: 'buffered-older-fix',
      timestamp: '2026-04-06T10:16:00.000Z',
    } satisfies NormalizedTrackingPosition
    const client = createClient({
      getBreadcrumbs: vi.fn()
        .mockResolvedValueOnce(firstBatch)
        .mockResolvedValueOnce([bufferedOlderFix]),
    })
    const onSnapshot = vi.fn()
    let currentTime = new Date('2026-04-06T10:20:00.000Z')

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      getBreadcrumbDeviceIds: () => ['1'],
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    currentTime = new Date('2026-04-06T10:25:00.000Z')
    await vi.advanceTimersByTimeAsync(5_000)

    const secondFetchFrom = vi.mocked(client.getBreadcrumbs).mock.calls[1]?.[1]
    expect(secondFetchFrom?.getTime()).toBeLessThan(Date.parse('2026-04-06T10:16:00.000Z'))
    expect(
      onSnapshot.mock.calls
        .map((call) => call[0] as TrackingSnapshot)
        .some((snapshot) =>
          snapshot.breadcrumbs.some((breadcrumb) => breadcrumb.id === 'buffered-older-fix'),
        ),
    ).toBe(true)

    poller.stop()
  })

  it('clamps future breadcrumb timestamps to the completed fetch window [DON-233]', async () => {
    const futureBreadcrumb = {
      ...NORMALIZED_POSITIONS[0],
      id: 'future-clock-skew',
      timestamp: '2026-04-06T10:45:00.000Z',
    } satisfies NormalizedTrackingPosition
    const client = createClient({
      getBreadcrumbs: vi.fn()
        .mockResolvedValueOnce([futureBreadcrumb])
        .mockResolvedValueOnce([]),
    })
    let currentTime = new Date('2026-04-06T10:20:00.000Z')

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      getBreadcrumbDeviceIds: () => ['1'],
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    currentTime = new Date('2026-04-06T10:25:00.000Z')
    await vi.advanceTimersByTimeAsync(5_000)

    const secondFetchFrom = vi.mocked(client.getBreadcrumbs).mock.calls[1]?.[1]
    const secondFetchTo = vi.mocked(client.getBreadcrumbs).mock.calls[1]?.[2]
    expect(secondFetchFrom?.getTime()).toBeLessThanOrEqual(secondFetchTo!.getTime())
    expect(secondFetchFrom?.getTime()).toBeLessThan(Date.parse('2026-04-06T10:25:00.000Z'))

    poller.stop()
  })

  it('advances breadcrumb cursors by the maximum timestamp in an unsorted batch [DON-233]', async () => {
    const unsortedBatch = [
      {
        ...NORMALIZED_POSITIONS[0],
        id: 'later-first',
        timestamp: '2026-04-06T10:20:00.000Z',
      },
      {
        ...NORMALIZED_POSITIONS[0],
        id: 'earlier-second',
        timestamp: '2026-04-06T10:05:00.000Z',
      },
    ] satisfies readonly NormalizedTrackingPosition[]
    const client = createClient({
      getBreadcrumbs: vi.fn()
        .mockResolvedValueOnce(unsortedBatch)
        .mockResolvedValueOnce([]),
    })
    let currentTime = new Date('2026-04-06T10:20:00.000Z')

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      getBreadcrumbDeviceIds: () => ['1'],
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    currentTime = new Date('2026-04-06T10:25:00.000Z')
    await vi.advanceTimersByTimeAsync(5_000)

    const secondFetchFrom = vi.mocked(client.getBreadcrumbs).mock.calls[1]?.[1]
    expect(secondFetchFrom?.getTime()).toBeGreaterThan(Date.parse('2026-04-06T10:05:00.000Z'))
    expect(secondFetchFrom?.getTime()).toBeLessThan(Date.parse('2026-04-06T10:20:00.000Z'))

    poller.stop()
  })

  it('does not continue with a truncated fallback history window after seed failure [DON-233]', async () => {
    const client = createClient({
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })
    const logger = { warn: vi.fn() }

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      getInitialBreadcrumbs: async () => {
        throw new Error('sqlite read failed')
      },
      logger,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(client.getBreadcrumbs).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      'Tracking breadcrumb cursor load failed.',
      expect.objectContaining({ error: 'sqlite read failed' }),
    )

    poller.stop()
  })

  it('classifies authentication failures without keeping the poller authenticated [DON-234]', async () => {
    const authenticationError = new Error('Session expired')
    authenticationError.name = 'TraccarAuthenticationError'
    const client = createClient({
      getCurrentPositions: vi
        .fn()
        .mockRejectedValueOnce(authenticationError)
        .mockResolvedValue(NORMALIZED_POSITIONS as readonly NormalizedTrackingPosition[]),
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange,
      retryBaseMs: 1_000,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(client.authenticate).toHaveBeenCalledTimes(2)
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'offline',
        warning: 'TRACKING AUTHENTICATION FAILED — check Traccar credentials.',
      }),
    )

    poller.stop()
  })

  it('does not skip sub-second breadcrumbs immediately after the previous cursor', async () => {
    const firstBatch = [
      {
        ...NORMALIZED_POSITIONS[0],
        id: 'breadcrumb-before-boundary',
        timestamp: '2026-04-06T10:00:04.900Z',
      },
      {
        ...NORMALIZED_POSITIONS[0],
        id: 'breadcrumb-at-boundary',
        timestamp: '2026-04-06T10:00:05.000Z',
      },
    ] satisfies readonly NormalizedTrackingPosition[]
    const secondBatch = [
      {
        ...NORMALIZED_POSITIONS[0],
        id: 'breadcrumb-at-boundary',
        timestamp: '2026-04-06T10:00:05.000Z',
      },
      {
        ...NORMALIZED_POSITIONS[0],
        id: 'breadcrumb-after-boundary',
        timestamp: '2026-04-06T10:00:05.500Z',
      },
    ] satisfies readonly NormalizedTrackingPosition[]
    const client = createClient({
      getBreadcrumbs: vi.fn()
        .mockResolvedValueOnce(firstBatch)
        .mockResolvedValueOnce(secondBatch),
    })
    const onSnapshot = vi.fn()
    const onPollDiagnostic = vi.fn()
    let currentTime = new Date('2026-04-06T10:00:05.000Z')

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      onPollDiagnostic,
      getBreadcrumbDeviceIds: () => ['1'],
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    currentTime = new Date('2026-04-06T10:00:10.000Z')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(client.getBreadcrumbs).toHaveBeenNthCalledWith(
      2,
      '1',
      new Date('2026-04-06T09:55:05.000Z'),
      expect.any(Date),
      expect.any(AbortSignal),
    )
    expect(
      onSnapshot.mock.calls
        .map((call) => call[0] as TrackingSnapshot)
        .some((snapshot) =>
          snapshot.breadcrumbs.some((breadcrumb) => breadcrumb.id === 'breadcrumb-after-boundary'),
        ),
    ).toBe(true)
    const latestSnapshot = onSnapshot.mock.calls.at(-1)?.[0] as TrackingSnapshot | undefined
    expect(
      latestSnapshot?.breadcrumbs.filter(
        (breadcrumb) => breadcrumb.timestamp === '2026-04-06T10:00:05.000Z',
      ),
    ).toHaveLength(1)
    expect(onPollDiagnostic).toHaveBeenLastCalledWith(
      expect.objectContaining({
        breadcrumbReturnedCount: 2,
        breadcrumbAcceptedCount: 1,
        breadcrumbDuplicateCount: 1,
        breadcrumbWindow: {
          previousCursorEarliest: '2026-04-06T10:00:05.000Z',
          previousCursorLatest: '2026-04-06T10:00:05.000Z',
          requestedFromEarliest: '2026-04-06T09:55:05.000Z',
          requestedFromLatest: '2026-04-06T09:55:05.000Z',
          requestedTo: '2026-04-06T10:00:10.000Z',
          newestReturnedEarliest: '2026-04-06T10:00:05.500Z',
          newestReturnedLatest: '2026-04-06T10:00:05.500Z',
        },
      }),
    )

    poller.stop()
  })

  it('marks aged live positions as stale in published snapshots', async () => {
    const client = createClient({
      getCurrentPositions: vi.fn().mockResolvedValue([
        {
          ...NORMALIZED_POSITIONS[0],
          timestamp: '2026-04-06T08:00:00.000Z',
        },
      ] satisfies readonly NormalizedTrackingPosition[]),
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })
    const onSnapshot = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot.mock.calls[0]?.[0].positions[0]?.device_cache_stale).toBe(true)

    poller.stop()
  })

  it('keeps the polling timer alive while suppressing refresh during mission pause', async () => {
    const client = createClient()
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange,
      getPollingMode: () => 'paused',
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(client.authenticate).not.toHaveBeenCalled()
    expect(client.getDevices).not.toHaveBeenCalled()
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        warning: 'Live refresh suspended while mission is paused.',
      }),
    )

    poller.stop()
  })

  it('replays a paused mission snapshot without re-persisting its rendered history', async () => {
    let pollingMode: 'active' | 'paused' = 'active'
    const onSnapshot = vi.fn()
    const poller = createPollingManager(createClient(), {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      getPollingMode: () => pollingMode,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    pollingMode = 'paused'
    await vi.advanceTimersByTimeAsync(5_000)

    expect(onSnapshot.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ rawBreadcrumbsForPersistence: [] }),
    )

    poller.stop()
  })

  it('stays idle without authenticating before a mission starts', async () => {
    const client = createClient()
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange,
      getPollingMode: () => 'idle',
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(client.authenticate).not.toHaveBeenCalled()
    expect(client.getDevices).not.toHaveBeenCalled()
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'idle',
        warning: 'Waiting for an active mission.',
      }),
    )

    poller.stop()
  })

  it('does not publish a fresh online snapshot if the mission becomes inactive mid-poll', async () => {
    let pollingMode: 'active' | 'paused' | 'idle' = 'active'
    const client = createClient({
      getCurrentPositions: vi.fn().mockImplementation(() => {
        pollingMode = 'idle'
        return Promise.resolve(NORMALIZED_POSITIONS as readonly NormalizedTrackingPosition[])
      }),
    })
    const onSnapshot = vi.fn()
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange,
      getPollingMode: () => pollingMode,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot).toHaveBeenCalledWith(
      {
        devices: [],
        positions: [],
        breadcrumbs: [],
        rawBreadcrumbsForPersistence: [],
      },
      { historyResetKey: null, participantRosterAuthoritative: false },
    )
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'idle',
        warning: 'Waiting for an active mission.',
      }),
    )
    expect(onStatusChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'online' }),
    )

    poller.stop()
  })

  it('clamps the retry delay to maxBackoffMs once the unbounded value would exceed it', async () => {
    const client = createClient({
      getCurrentPositions: vi.fn().mockRejectedValue(new Error('offline')),
    })
    const setTimeoutSpy = vi.fn(window.setTimeout.bind(window)) as unknown as typeof window.setTimeout
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange,
      retryBaseMs: 1_000,
      maxBackoffMs: 60_000,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
      setTimeout: setTimeoutSpy,
    })

    poller.start()

    // Drain enough failures to cross the cap. Failure 7 would compute 64_000 ms unclamped.
    for (let i = 0; i < 10; i += 1) {
      // Each iteration: advance the currently scheduled retry, then let the next
      // poll/await chain settle so the next setTimeout is scheduled.
      const lastDelay = (setTimeoutSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[1] as number
      await vi.advanceTimersByTimeAsync(lastDelay ?? 1)
    }

    const recordedDelays = (setTimeoutSpy as unknown as { mock: { calls: [() => void, number][] } }).mock.calls.map(
      (call) => call[1],
    )

    // Failure 1 -> 1_000, 2 -> 2_000, 3 -> 4_000, 4 -> 8_000, 5 -> 16_000, 6 -> 32_000.
    // Failure 7 onwards -> clamped at 60_000.
    expect(recordedDelays.slice(0, 6)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000])
    expect(recordedDelays.slice(6)).toEqual(recordedDelays.slice(6).map(() => 60_000))
    expect(recordedDelays.length).toBeGreaterThanOrEqual(7)

    poller.stop()
  })

  it('normalizes invalid success-poll intervals before scheduling the next poll [DON-208]', async () => {
    const client = createClient()
    const setTimeoutSpy = vi.fn(window.setTimeout.bind(window)) as unknown as typeof window.setTimeout

    const poller = createPollingManager(client, {
      intervalMs: Number.NaN,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
      setTimeout: setTimeoutSpy,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    const recordedDelays = (setTimeoutSpy as unknown as { mock: { calls: [() => void, number][] } }).mock.calls.map(
      (call) => call[1],
    )
    expect(recordedDelays.at(-1)).toBe(30_000)

    poller.stop()
  })

  it('clamps too-short success-poll intervals to five seconds [DON-208]', async () => {
    const client = createClient()
    const setTimeoutSpy = vi.fn(window.setTimeout.bind(window)) as unknown as typeof window.setTimeout

    const poller = createPollingManager(client, {
      intervalMs: 0,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
      setTimeout: setTimeoutSpy,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    const recordedDelays = (setTimeoutSpy as unknown as { mock: { calls: [() => void, number][] } }).mock.calls.map(
      (call) => call[1],
    )
    expect(recordedDelays.at(-1)).toBe(5_000)

    poller.stop()
  })

  it('honours an explicit validation-only minimum without changing the production default [DON-246]', async () => {
    const client = createClient()
    const poller = createPollingManager(client, {
      intervalMs: 25,
      minimumIntervalMs: 25,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(25)

    expect(client.getDevices).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it('clamps too-long success-poll intervals to one hour [DON-208]', async () => {
    const client = createClient()
    const setTimeoutSpy = vi.fn(window.setTimeout.bind(window)) as unknown as typeof window.setTimeout

    const poller = createPollingManager(client, {
      intervalMs: 24 * 60 * 60 * 1000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
      setTimeout: setTimeoutSpy,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    const recordedDelays = (setTimeoutSpy as unknown as { mock: { calls: [() => void, number][] } }).mock.calls.map(
      (call) => call[1],
    )
    expect(recordedDelays.at(-1)).toBe(60 * 60 * 1000)

    poller.stop()
  })

  it('continues aggregating breadcrumbs from healthy devices when one device fails', async () => {
    const onSnapshot = vi.fn()
    const onStatusChange = vi.fn()
    const logger = { warn: vi.fn() }
    const devices = [
      NORMALIZED_DEVICES[0],
      NORMALIZED_DEVICES[1],
      { ...NORMALIZED_DEVICES[0], device_id: '3', name: 'Hill team' },
    ] satisfies readonly NormalizedTrackingDevice[]
    const deviceOneBreadcrumb = {
      ...NORMALIZED_BREADCRUMBS[0],
      id: 'breadcrumb-device-1',
      device_id: '1',
    } satisfies NormalizedTrackingPosition
    const deviceThreeBreadcrumb = {
      ...NORMALIZED_BREADCRUMBS[0],
      id: 'breadcrumb-device-3',
      device_id: '3',
    } satisfies NormalizedTrackingPosition

    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(devices),
      getBreadcrumbs: vi.fn().mockImplementation((deviceId: string) => {
        if (deviceId === '2') {
          return Promise.reject(new Error('HTTP 500'))
        }
        if (deviceId === '3') {
          return Promise.resolve([deviceThreeBreadcrumb])
        }
        return Promise.resolve([deviceOneBreadcrumb])
      }),
    })

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange,
      retryBaseMs: 1_000,
      maxBackoffMs: 60_000,
      logger,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    const firstSnapshotWithBreadcrumbs = onSnapshot.mock.calls.at(-1)?.[0] as {
      breadcrumbs: readonly NormalizedTrackingPosition[]
    }
    expect(firstSnapshotWithBreadcrumbs.breadcrumbs.map((breadcrumb) => breadcrumb.device_id)).toEqual([
      '1',
      '3',
    ])

    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'online', consecutiveFailures: 0 }),
    )
    expect(onStatusChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'offline' }),
    )

    expect(logger.warn).toHaveBeenCalledTimes(1)
    const warnCall = logger.warn.mock.calls[0]
    expect(warnCall?.[0]).toContain('breadcrumb')
    expect(warnCall?.[1]).toEqual(
      expect.objectContaining({ deviceId: '2' }),
    )

    poller.stop()
  })

  it('keeps quiet-device breadcrumbs when another device exceeds the render budget [DON-159]', async () => {
    const onSnapshot = vi.fn()
    const devices = [
      { ...NORMALIZED_DEVICES[0]!, device_id: '2', name: 'Eamonn O Connor' },
      { ...NORMALIZED_DEVICES[1]!, device_id: '25', name: 'Richard Morrison' },
    ] satisfies readonly NormalizedTrackingDevice[]
    const noisyDeviceBreadcrumbs = Array.from({ length: 25_000 }, (_, index) => ({
      ...NORMALIZED_BREADCRUMBS[0]!,
      id: `eoc-${index}`,
      device_id: '2',
      lat: 52 + index / 1_000_000,
      lon: -9.7 - index / 1_000_000,
      timestamp: new Date(Date.UTC(2026, 5, 13, 0, 0, index)).toISOString(),
    }))
    const quietDeviceBreadcrumbs = Array.from({ length: 3_280 }, (_, index) => ({
      ...NORMALIZED_BREADCRUMBS[0]!,
      id: `richard-${index}`,
      device_id: '25',
      lat: 51.99 + index / 1_000_000,
      lon: -9.74 - index / 1_000_000,
      timestamp: new Date(Date.UTC(2026, 5, 12, 12, 0, index)).toISOString(),
    }))
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(devices),
      getBreadcrumbs: vi.fn().mockImplementation((deviceId: string) => {
        if (deviceId === '2') {
          return Promise.resolve(noisyDeviceBreadcrumbs)
        }
        if (deviceId === '25') {
          return Promise.resolve(quietDeviceBreadcrumbs)
        }
        return Promise.resolve([])
      }),
    })

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-06-13T21:48:51.654Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    const latestSnapshot = onSnapshot.mock.calls.at(-1)?.[0]
    expect(latestSnapshot?.breadcrumbs.some((position) => position.device_id === '25')).toBe(true)
    expect(latestSnapshot?.breadcrumbs.length).toBeGreaterThanOrEqual(5_780)
    expect(latestSnapshot?.breadcrumbs.length).toBeLessThanOrEqual(8_280)
    expect(latestSnapshot?.rawBreadcrumbsForPersistence).toHaveLength(28_280)
    expect(
      latestSnapshot?.rawBreadcrumbsForPersistence?.filter((position) => position.device_id === '2'),
    ).toHaveLength(25_000)
    expect(
      latestSnapshot?.rawBreadcrumbsForPersistence?.filter((position) => position.device_id === '25'),
    ).toHaveLength(3_280)
    expect(latestSnapshot?.breadcrumbMetadata?.deviceBudgets).toContainEqual(
      expect.objectContaining({
        deviceId: '2',
        firstTimestamp: noisyDeviceBreadcrumbs[0]!.timestamp,
        lastTimestamp: noisyDeviceBreadcrumbs.at(-1)!.timestamp,
        truncated: true,
      }),
    )
    expect(latestSnapshot?.breadcrumbMetadata?.deviceBudgets).toContainEqual(
      expect.objectContaining({ deviceId: '25', retained: 3_280, truncated: false }),
    )

    poller.stop()
  })

  it('can restrict breadcrumb history fetches to requested device ids [DON-159]', async () => {
    const devices = [
      { ...NORMALIZED_DEVICES[0]!, device_id: '2', name: 'Eamonn O Connor' },
      { ...NORMALIZED_DEVICES[1]!, device_id: '25', name: 'Richard Morrison' },
      { ...NORMALIZED_DEVICES[0]!, device_id: '99', name: 'Cold roster device' },
    ] satisfies readonly NormalizedTrackingDevice[]
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(devices),
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      getBreadcrumbDeviceIds: () => ['2', '25'],
      now: () => new Date('2026-06-13T21:48:51.654Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(client.getBreadcrumbs).toHaveBeenCalledWith('2', expect.any(Date), expect.any(Date), expect.any(AbortSignal))
    expect(client.getBreadcrumbs).toHaveBeenCalledWith('25', expect.any(Date), expect.any(Date), expect.any(AbortSignal))
    expect(client.getBreadcrumbs).not.toHaveBeenCalledWith('99', expect.any(Date), expect.any(Date), expect.any(AbortSignal))

    poller.stop()
  })

  it('intersects history visibility with mission participation and never fetches non-participant history [DON-271]', async () => {
    const devices = [
      { ...NORMALIZED_DEVICES[0]!, device_id: '2' },
      { ...NORMALIZED_DEVICES[1]!, device_id: '25' },
      { ...NORMALIZED_DEVICES[0]!, device_id: '99' },
    ] satisfies readonly NormalizedTrackingDevice[]
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(devices),
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      getParticipantDeviceIds: () => ['2', '25'],
      getBreadcrumbDeviceIds: () => ['25', '99'],
      now: () => new Date('2026-06-13T21:48:51.654Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(client.getBreadcrumbs).toHaveBeenCalledWith('25', expect.any(Date), expect.any(Date), expect.any(AbortSignal))
    expect(client.getBreadcrumbs).not.toHaveBeenCalledWith('2', expect.any(Date), expect.any(Date), expect.any(AbortSignal))
    expect(client.getBreadcrumbs).not.toHaveBeenCalledWith('99', expect.any(Date), expect.any(Date), expect.any(AbortSignal))
    poller.stop()
  })

  it('fetches no history when mission-model participation is explicitly empty [DON-271]', async () => {
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(NORMALIZED_DEVICES),
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      getParticipantDeviceIds: () => [],
      now: () => new Date('2026-06-13T21:48:51.654Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(client.getBreadcrumbs).not.toHaveBeenCalled()
    poller.stop()
  })

  it('routes per-device breadcrumb failures through logger.warn rather than console.error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const logger = { warn: vi.fn() }
      const client = createClient({
        getBreadcrumbs: vi.fn().mockRejectedValue(new Error('HTTP 500')),
      })

      const poller = createPollingManager(client, {
        intervalMs: 5_000,
        staleThresholdMs: 60 * 60 * 1000,
        onSnapshot: vi.fn(),
        onStatusChange: vi.fn(),
        logger,
        now: () => new Date('2026-04-06T10:35:00.000Z'),
      })

      poller.start()
      await vi.advanceTimersByTimeAsync(0)

      expect(logger.warn).toHaveBeenCalled()
      expect(consoleErrorSpy).not.toHaveBeenCalled()

      poller.stop()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('resets breadcrumb history when a new mission session starts', async () => {
    const client = createClient()
    const onSnapshot = vi.fn()
    let historyResetKey: string | null = 'mission-1'
    let initialBreadcrumbFrom = new Date('2026-04-06T07:00:00.000Z')

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      getHistoryResetKey: () => historyResetKey,
      getInitialBreadcrumbFrom: () => initialBreadcrumbFrom,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    historyResetKey = 'mission-2'
    initialBreadcrumbFrom = new Date('2026-04-06T09:00:00.000Z')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(client.getBreadcrumbs).toHaveBeenCalledWith(
      '1',
      new Date('2026-04-06T07:00:00.000Z'),
      expect.any(Date),
      expect.any(AbortSignal),
    )
    expect(client.getBreadcrumbs).toHaveBeenCalledWith(
      '1',
      new Date('2026-04-06T09:00:00.000Z'),
      expect.any(Date),
      expect.any(AbortSignal),
    )
    const missionOneSnapshots = onSnapshot.mock.calls.filter(
      (call) => call[1]?.historyResetKey === 'mission-1',
    )
    const missionTwoSnapshots = onSnapshot.mock.calls.filter(
      (call) => call[1]?.historyResetKey === 'mission-2',
    )
    expect(missionOneSnapshots[0]?.[0].breadcrumbs).toHaveLength(0)
    expect(
      missionOneSnapshots.some((call) => call[0].breadcrumbs.length === 3),
    ).toBe(true)
    expect(missionTwoSnapshots[0]?.[0].breadcrumbs).toHaveLength(0)
    expect(
      missionTwoSnapshots.some((call) => call[0].breadcrumbs.length === 3),
    ).toBe(true)

    poller.stop()
  })

  it('does not publish a durably accepted old-mission render batch after switching missions', async () => {
    const oldMissionSecondChunk = createDeferred<readonly NormalizedTrackingPosition[]>()
    const oldMissionBreadcrumb = {
      ...NORMALIZED_BREADCRUMBS[0]!,
      id: 'mission-a-history',
      timestamp: '2026-04-06T07:00:00.000Z',
    }
    const getBreadcrumbs = vi.fn().mockImplementation(
      (_deviceId: string, from: Date, to: Date) => {
        if (
          from.toISOString() === '2026-04-06T06:00:00.000Z' &&
          to.toISOString() === '2026-04-06T08:00:00.000Z'
        ) {
          return Promise.resolve([oldMissionBreadcrumb])
        }
        if (
          from.toISOString() === '2026-04-06T08:00:00.000Z' &&
          to.toISOString() === '2026-04-06T10:00:00.000Z'
        ) {
          return oldMissionSecondChunk.promise
        }
        return Promise.resolve([])
      },
    )
    const onSnapshot = vi.fn()
    const lifecycleEvents: string[] = []
    const persistHistoryChunk = vi.fn().mockImplementation(async (input) => {
      lifecycleEvents.push(`persist:${input.expectedMissionId}`)
    })
    let historyResetKey: string | null = 'mission-a'
    let initialBreadcrumbFrom = new Date('2026-04-06T06:00:00.000Z')
    const poller = createPollingManager(createClient({ getBreadcrumbs }), {
      intervalMs: 30_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: (...args) => {
        lifecycleEvents.push(`snapshot:${args[1].historyResetKey}`)
        onSnapshot(...args)
      },
      onStatusChange: vi.fn(),
      getHistoryResetKey: () => historyResetKey,
      getInitialBreadcrumbFrom: () => initialBreadcrumbFrom,
      getInitialBreadcrumbs: async () => [],
      persistHistoryChunk,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(persistHistoryChunk).toHaveBeenCalledWith(expect.objectContaining({
      expectedMissionId: 'mission-a',
      deviceId: '1',
      historyFrom: '2026-04-06T06:00:00.000Z',
      reconciledUntil: '2026-04-06T08:00:00.000Z',
      positions: [oldMissionBreadcrumb],
    }))
    const callsBeforeMissionSwitch = onSnapshot.mock.calls.length
    lifecycleEvents.push('switch:mission-b')
    historyResetKey = 'mission-b'
    initialBreadcrumbFrom = new Date('2026-04-06T09:00:00.000Z')
    poller.requestPollNow()
    await vi.advanceTimersByTimeAsync(0)

    const snapshotsAfterMissionSwitch = onSnapshot.mock.calls.slice(
      callsBeforeMissionSwitch,
    )
    expect(snapshotsAfterMissionSwitch.length).toBeGreaterThan(0)
    expect(
      snapshotsAfterMissionSwitch.every((call) => call[1]?.historyResetKey === 'mission-b'),
    ).toBe(true)
    expect(
      snapshotsAfterMissionSwitch.flatMap((call) => call[0].breadcrumbs).map(
        (position) => position.id,
      ),
    ).not.toContain(oldMissionBreadcrumb.id)
    expect(lifecycleEvents.indexOf('persist:mission-a')).toBeLessThan(
      lifecycleEvents.indexOf('switch:mission-b'),
    )

    oldMissionSecondChunk.resolve([])
    await vi.advanceTimersByTimeAsync(100)
    expect(
      onSnapshot.mock.calls
        .slice(callsBeforeMissionSwitch)
        .some((call) =>
          call[0].breadcrumbs.some(
            (position: NormalizedTrackingPosition) =>
              position.id === oldMissionBreadcrumb.id,
          ),
        ),
    ).toBe(false)

    poller.stop()
  })

  it('publishes fallback history immediately so mission replacement cannot drop a queued batch', async () => {
    const oldMissionBreadcrumb = {
      ...NORMALIZED_BREADCRUMBS[0]!,
      id: 'mission-a-fallback-history',
      timestamp: '2026-04-06T07:00:00.000Z',
    }
    const onSnapshot = vi.fn()
    let historyResetKey: string | null = 'mission-a'
    let initialBreadcrumbFrom = new Date('2026-04-06T06:00:00.000Z')
    const poller = createPollingManager(createClient({
      getBreadcrumbs: vi.fn().mockImplementation(
        (_deviceId: string, from: Date, to: Date) =>
          from.toISOString() === '2026-04-06T06:00:00.000Z' &&
          to.toISOString() === '2026-04-06T08:00:00.000Z'
            ? Promise.resolve([oldMissionBreadcrumb])
            : Promise.resolve([]),
      ),
    }), {
      intervalMs: 30_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      getHistoryResetKey: () => historyResetKey,
      getInitialBreadcrumbFrom: () => initialBreadcrumbFrom,
      getInitialBreadcrumbs: async () => [],
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot.mock.calls.some((call) =>
      call[1]?.historyResetKey === 'mission-a' &&
      call[0].rawBreadcrumbsForPersistence?.some(
        (position: NormalizedTrackingPosition) =>
          position.id === oldMissionBreadcrumb.id,
      ),
    )).toBe(true)
    const callsBeforeMissionSwitch = onSnapshot.mock.calls.length

    historyResetKey = 'mission-b'
    initialBreadcrumbFrom = new Date('2026-04-06T09:00:00.000Z')
    poller.requestPollNow()
    await vi.advanceTimersByTimeAsync(100)

    expect(
      onSnapshot.mock.calls
        .slice(callsBeforeMissionSwitch)
        .every((call) => call[1]?.historyResetKey === 'mission-b'),
    ).toBe(true)
    expect(
      onSnapshot.mock.calls
        .slice(callsBeforeMissionSwitch)
        .flatMap((call) => call[0].breadcrumbs)
        .map((position) => position.id),
    ).not.toContain(oldMissionBreadcrumb.id)

    poller.stop()
  })

  it('keeps fallback breadcrumb publication inside the mission evidence fence [DON-276]', async () => {
    vi.useRealTimers()
    const historyPublication = createDeferred<void>()
    const observationCompletions: ReturnType<typeof vi.fn>[] = []
    const beginMissionEvidenceObservation = vi.fn((missionId: string | null) => {
      const complete = vi.fn()
      observationCompletions.push(complete)
      return { missionId, complete }
    })
    const onSnapshot = vi.fn((snapshot) =>
      snapshot.rawBreadcrumbsForPersistence?.length > 0
        ? historyPublication.promise
        : Promise.resolve(),
    )
    const poller = createPollingManager(createClient(), {
      intervalMs: 30_000,
      staleThresholdMs: 60 * 60 * 1000,
      getHistoryResetKey: () => 'mission-fenced-history',
      getInitialBreadcrumbFrom: () => new Date('2026-04-06T06:00:00.000Z'),
      getInitialBreadcrumbs: async () => [],
      beginMissionEvidenceObservation,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.waitFor(() => expect(onSnapshot.mock.calls.some(
      (call) => call[0].rawBreadcrumbsForPersistence?.length > 0,
    )).toBe(true))

    expect(beginMissionEvidenceObservation.mock.calls.length).toBeGreaterThanOrEqual(2)
    const historyCall = onSnapshot.mock.calls.find(
      (call) => call[0].rawBreadcrumbsForPersistence?.length > 0,
    )
    expect(historyCall?.[1]).toMatchObject({
      historyResetKey: 'mission-fenced-history',
      missionEvidenceId: 'mission-fenced-history',
    })
    expect(observationCompletions.slice(1).some(
      (completion) => completion.mock.calls.length === 0,
    )).toBe(true)

    historyPublication.resolve(undefined)
    await vi.waitFor(() => {
      for (const completion of observationCompletions) {
        expect(completion).toHaveBeenCalledOnce()
      }
    })
    await poller.stop()
  })

  it('keeps direct reconciliation persistence inside the mission evidence fence [DON-276]', async () => {
    vi.useRealTimers()
    const historyPersistence = createDeferred<{ readonly changed: boolean }>()
    const observationCompletions: ReturnType<typeof vi.fn>[] = []
    const beginMissionEvidenceObservation = vi.fn((missionId: string | null) => {
      const complete = vi.fn()
      observationCompletions.push(complete)
      return { missionId, complete }
    })
    const persistenceCompletions: ReturnType<typeof vi.fn>[] = []
    const persistHistoryChunk = vi.fn(() => {
      const completion = observationCompletions.at(-1)
      if (completion !== undefined) persistenceCompletions.push(completion)
      return historyPersistence.promise
    })
    const poller = createPollingManager(createClient(), {
      intervalMs: 30_000,
      staleThresholdMs: 60 * 60 * 1000,
      getHistoryResetKey: () => 'mission-fenced-reconciliation',
      getInitialBreadcrumbFrom: () => new Date('2026-04-06T06:00:00.000Z'),
      getInitialBreadcrumbs: async () => [],
      beginMissionEvidenceObservation,
      persistHistoryChunk,
      onSnapshot: vi.fn().mockResolvedValue(undefined),
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.waitFor(() => expect(persistHistoryChunk).toHaveBeenCalled())

    expect(beginMissionEvidenceObservation.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(persistenceCompletions.length).toBeGreaterThan(0)
    for (const completion of persistenceCompletions) {
      expect(completion).not.toHaveBeenCalled()
    }

    historyPersistence.resolve({ changed: true })
    await vi.waitFor(() => {
      for (const completion of persistenceCompletions) {
        expect(completion).toHaveBeenCalledOnce()
      }
    })
    await poller.stop()
  })
})
