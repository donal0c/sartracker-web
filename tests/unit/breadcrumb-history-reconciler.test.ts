import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBreadcrumbHistoryReconciler } from '../../src/features/tracking/breadcrumb-history-reconciler'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
} from '../../src/features/tracking/tracking-types'

const DEVICE = {
  device_id: '1',
  name: 'Tracker 1',
  status: 'online',
  last_seen: null,
  unique_id: 'tracker-1',
  category: null,
} satisfies NormalizedTrackingDevice

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

describe('breadcrumb history reconciler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('drains bounded chunks once without waiting for a steady-poll timer', async () => {
    const fetchBreadcrumbs = vi.fn().mockResolvedValue([])
    const onChunk = vi.fn()
    const onProgress = vi.fn()
    const reconciler = createBreadcrumbHistoryReconciler({
      fetchBreadcrumbs,
      onChunk,
      onProgress,
      shouldContinue: () => true,
      logger: { warn: vi.fn() },
    })

    reconciler.reconcile({
      devices: [DEVICE],
      from: new Date('2026-04-06T00:00:00.000Z'),
      until: new Date('2026-04-06T06:00:00.000Z'),
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchBreadcrumbs.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      [
        new Date('2026-04-06T00:00:00.000Z'),
        new Date('2026-04-06T02:00:00.000Z'),
      ],
      [
        new Date('2026-04-06T02:00:00.000Z'),
        new Date('2026-04-06T04:00:00.000Z'),
      ],
      [
        new Date('2026-04-06T04:00:00.000Z'),
        new Date('2026-04-06T06:00:00.000Z'),
      ],
    ])
    expect(onChunk).toHaveBeenCalledTimes(3)
    expect(onProgress.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      pendingDeviceNames: [],
      failedDeviceNames: [],
      complete: true,
      completedChunkCount: 3,
      totalChunkCount: 3,
    }))

    reconciler.reconcile({
      devices: [DEVICE],
      from: new Date('2026-04-06T00:00:00.000Z'),
      until: new Date('2026-04-06T07:00:00.000Z'),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchBreadcrumbs).toHaveBeenCalledTimes(3)
  })

  it('discards a suspended request and resumes its unadvanced window', async () => {
    const deferred = createDeferred<readonly NormalizedTrackingPosition[]>()
    const fetchBreadcrumbs = vi
      .fn()
      .mockReturnValueOnce(deferred.promise)
      .mockResolvedValue([])
    const onChunk = vi.fn()
    let active = true
    const reconciler = createBreadcrumbHistoryReconciler({
      fetchBreadcrumbs,
      onChunk,
      onProgress: vi.fn(),
      shouldContinue: () => active,
      logger: { warn: vi.fn() },
    })

    reconciler.reconcile({
      devices: [DEVICE],
      from: new Date('2026-04-06T00:00:00.000Z'),
      until: new Date('2026-04-06T02:00:00.000Z'),
    })
    active = false
    reconciler.suspend()
    active = true
    reconciler.reconcile({
      devices: [DEVICE],
      from: new Date('2026-04-06T00:00:00.000Z'),
      until: new Date('2026-04-06T02:00:00.000Z'),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchBreadcrumbs).toHaveBeenCalledTimes(1)

    active = false
    deferred.resolve([])
    await vi.advanceTimersByTimeAsync(0)
    expect(onChunk).not.toHaveBeenCalled()

    active = true
    reconciler.reconcile({
      devices: [DEVICE],
      from: new Date('2026-04-06T00:00:00.000Z'),
      until: new Date('2026-04-06T02:00:00.000Z'),
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchBreadcrumbs).toHaveBeenNthCalledWith(
      2,
      '1',
      new Date('2026-04-06T00:00:00.000Z'),
      new Date('2026-04-06T02:00:00.000Z'),
    )
    expect(onChunk).toHaveBeenCalledTimes(1)
  })

  it('starts a new mission while an old mission request remains unresolved', async () => {
    const oldMissionRequest = createDeferred<readonly NormalizedTrackingPosition[]>()
    const newMissionRequest = createDeferred<readonly NormalizedTrackingPosition[]>()
    const newMissionDevice = {
      ...DEVICE,
      device_id: '2',
      name: 'Tracker 2',
      unique_id: 'tracker-2',
    }
    const fetchBreadcrumbs = vi.fn().mockImplementation((deviceId: string) =>
      deviceId === DEVICE.device_id
        ? oldMissionRequest.promise
        : newMissionRequest.promise,
    )
    const onChunk = vi.fn()
    const onProgress = vi.fn()
    const reconciler = createBreadcrumbHistoryReconciler({
      fetchBreadcrumbs,
      onChunk,
      onProgress,
      shouldContinue: () => true,
      logger: { warn: vi.fn() },
      maxConcurrency: 1,
    })
    const requestWindow = {
      from: new Date('2026-04-06T00:00:00.000Z'),
      until: new Date('2026-04-06T02:00:00.000Z'),
    }

    reconciler.reconcile({ ...requestWindow, devices: [DEVICE] })
    expect(fetchBreadcrumbs).toHaveBeenNthCalledWith(
      1,
      DEVICE.device_id,
      requestWindow.from,
      requestWindow.until,
    )

    reconciler.reset()
    reconciler.reconcile({ ...requestWindow, devices: [newMissionDevice] })

    expect(fetchBreadcrumbs).toHaveBeenNthCalledWith(
      2,
      newMissionDevice.device_id,
      requestWindow.from,
      requestWindow.until,
    )
    expect(reconciler.getProgress()).toEqual(expect.objectContaining({
      pendingDeviceNames: [newMissionDevice.name],
      complete: false,
    }))

    newMissionRequest.resolve([])
    await vi.advanceTimersByTimeAsync(0)
    expect(onChunk).toHaveBeenCalledTimes(1)
    expect(onChunk).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: newMissionDevice.device_id }),
    )
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'initial',
      pendingDeviceNames: [],
      complete: true,
    }))

    oldMissionRequest.resolve([])
    await vi.advanceTimersByTimeAsync(0)
    expect(onChunk).toHaveBeenCalledTimes(1)
    expect(fetchBreadcrumbs).toHaveBeenCalledTimes(2)
  })

  it('retries one failed device without blocking healthy reconciliation', async () => {
    const secondDevice = { ...DEVICE, device_id: '2', name: 'Tracker 2' }
    const attemptsByDevice = new Map<string, number>()
    const fetchBreadcrumbs = vi.fn().mockImplementation(async (deviceId: string) => {
      const attempt = (attemptsByDevice.get(deviceId) ?? 0) + 1
      attemptsByDevice.set(deviceId, attempt)
      if (deviceId === '1' && attempt === 1) {
        throw new Error('temporary failure')
      }
      return []
    })
    const onChunk = vi.fn()
    const reconciler = createBreadcrumbHistoryReconciler({
      fetchBreadcrumbs,
      onChunk,
      onProgress: vi.fn(),
      shouldContinue: () => true,
      logger: { warn: vi.fn() },
    })

    reconciler.reconcile({
      devices: [DEVICE, secondDevice],
      from: new Date('2026-04-06T00:00:00.000Z'),
      until: new Date('2026-04-06T02:00:00.000Z'),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(onChunk).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: '2' }),
    )
    expect(onChunk).not.toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: '1' }),
    )

    await vi.advanceTimersByTimeAsync(1_000)
    expect(attemptsByDevice.get('1')).toBe(2)
    expect(onChunk).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: '1' }),
    )
  })

  it('does not advance a chunk until its durable acknowledgement succeeds', async () => {
    const fetchBreadcrumbs = vi.fn().mockResolvedValue([])
    const onChunk = vi
      .fn()
      .mockRejectedValueOnce(new Error('checkpoint write failed'))
      .mockResolvedValue(undefined)
    const reconciler = createBreadcrumbHistoryReconciler({
      fetchBreadcrumbs,
      onChunk,
      onProgress: vi.fn(),
      shouldContinue: () => true,
      logger: { warn: vi.fn() },
    })

    reconciler.reconcile({
      devices: [DEVICE],
      from: new Date('2026-04-06T00:00:00.000Z'),
      until: new Date('2026-04-06T04:00:00.000Z'),
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchBreadcrumbs).toHaveBeenCalledTimes(1)
    expect(reconciler.getProgress().completedChunkCount).toBe(0)

    await vi.advanceTimersByTimeAsync(1_000)

    expect(fetchBreadcrumbs.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      [
        new Date('2026-04-06T00:00:00.000Z'),
        new Date('2026-04-06T02:00:00.000Z'),
      ],
      [
        new Date('2026-04-06T00:00:00.000Z'),
        new Date('2026-04-06T02:00:00.000Z'),
      ],
      [
        new Date('2026-04-06T02:00:00.000Z'),
        new Date('2026-04-06T04:00:00.000Z'),
      ],
    ])
    expect(onChunk).toHaveBeenCalledTimes(3)
    expect(reconciler.getProgress()).toEqual(expect.objectContaining({
      complete: true,
      completedChunkCount: 2,
    }))
  })

  it('prunes a deselected device and discards its in-flight history', async () => {
    const secondDevice = { ...DEVICE, device_id: '2', name: 'Tracker 2' }
    const deferred = createDeferred<readonly NormalizedTrackingPosition[]>()
    const fetchBreadcrumbs = vi
      .fn()
      .mockReturnValueOnce(deferred.promise)
      .mockResolvedValue([])
    const onChunk = vi.fn()
    const reconciler = createBreadcrumbHistoryReconciler({
      fetchBreadcrumbs,
      onChunk,
      onProgress: vi.fn(),
      shouldContinue: () => true,
      logger: { warn: vi.fn() },
      maxConcurrency: 1,
    })

    const request = {
      from: new Date('2026-04-06T00:00:00.000Z'),
      until: new Date('2026-04-06T02:00:00.000Z'),
    }
    reconciler.reconcile({ ...request, devices: [DEVICE, secondDevice] })
    expect(fetchBreadcrumbs).toHaveBeenCalledTimes(1)

    reconciler.reconcile({ ...request, devices: [secondDevice] })
    expect(reconciler.getProgress().pendingDeviceNames).toEqual(['Tracker 2'])
    deferred.resolve([])
    await vi.advanceTimersByTimeAsync(0)

    expect(onChunk).not.toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: '1' }),
    )
    expect(fetchBreadcrumbs).toHaveBeenNthCalledWith(
      2,
      '2',
      request.from,
      request.until,
    )
  })

  it('resumes initial catch-up from a validated durable checkpoint', async () => {
    const fetchBreadcrumbs = vi.fn().mockResolvedValue([])
    const reconciler = createBreadcrumbHistoryReconciler({
      fetchBreadcrumbs,
      onChunk: vi.fn(),
      onProgress: vi.fn(),
      shouldContinue: () => true,
      logger: { warn: vi.fn() },
    })

    reconciler.reconcile({
      devices: [DEVICE],
      from: new Date('2026-04-06T00:00:00.000Z'),
      until: new Date('2026-04-06T08:00:00.000Z'),
      checkpointsByDevice: {
        '1': {
          historyFrom: '2026-04-06T00:00:00.000Z',
          reconciledUntil: '2026-04-06T04:00:00.000Z',
        },
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchBreadcrumbs).toHaveBeenNthCalledWith(
      1,
      '1',
      new Date('2026-04-06T04:00:00.000Z'),
      new Date('2026-04-06T06:00:00.000Z'),
    )
    expect(fetchBreadcrumbs).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      label: 'corrupt',
      checkpoint: {
        historyFrom: 'not-a-timestamp',
        reconciledUntil: '2026-04-06T04:00:00.000Z',
      },
    },
    {
      label: 'mismatched',
      checkpoint: {
        historyFrom: '2026-04-05T23:00:00.000Z',
        reconciledUntil: '2026-04-06T04:00:00.000Z',
      },
    },
    {
      label: 'future',
      checkpoint: {
        historyFrom: '2026-04-06T00:00:00.000Z',
        reconciledUntil: '2026-04-06T10:00:00.000Z',
      },
    },
  ])('ignores a $label durable checkpoint instead of skipping history', async ({ checkpoint }) => {
    const fetchBreadcrumbs = vi.fn().mockResolvedValue([])
    const reconciler = createBreadcrumbHistoryReconciler({
      fetchBreadcrumbs,
      onChunk: vi.fn(),
      onProgress: vi.fn(),
      shouldContinue: () => true,
      logger: { warn: vi.fn() },
    })

    reconciler.reconcile({
      devices: [DEVICE],
      from: new Date('2026-04-06T00:00:00.000Z'),
      until: new Date('2026-04-06T08:00:00.000Z'),
      checkpointsByDevice: { '1': checkpoint },
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchBreadcrumbs).toHaveBeenNthCalledWith(
      1,
      '1',
      new Date('2026-04-06T00:00:00.000Z'),
      new Date('2026-04-06T02:00:00.000Z'),
    )
  })
})
