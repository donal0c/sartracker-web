import { describe, expect, it, vi } from 'vitest'

import type { NormalizedTrackingPosition, TrackingSnapshot } from '../../src/features/tracking/tracking-types'

type ExactDotPage = {
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly totalPositionCount: number
  readonly pagePositionCount: number
  readonly fromTimestamp: string | null
  readonly toTimestamp: string | null
  readonly hasEarlier: boolean
  readonly hasLater: boolean
  readonly earlierCursor: string | null
  readonly laterCursor: string | null
}

type ExactDotState =
  | { readonly status: 'inactive' }
  | { readonly status: 'loading'; readonly missionId: string }
  | ({ readonly status: 'ready'; readonly missionId: string } & ExactDotPage)
  | { readonly status: 'unavailable'; readonly missionId: string; readonly message: string }

type ExactDotController = {
  readonly updateContext: (input: {
    readonly missionId: string | null
    readonly trailMode: 'dots' | 'line'
    readonly activeDeviceIds: readonly string[]
  }) => void
  readonly showEarlier: () => void
  readonly showLater: () => void
  readonly notifyDurableChange: (changedPositionCount: number) => void
  readonly stop: () => void
  readonly getState: () => ExactDotState
}

type ExactDotControllerModule = {
  readonly EXACT_BREADCRUMB_DOT_DURABLE_REFRESH_INTERVAL_MS: number
  readonly createExactBreadcrumbDotController: (input: {
    readonly limit: number
    readonly queryPage: (input: {
      readonly missionId: string
      readonly activeDeviceIds: readonly string[]
      readonly limit: number
      readonly cursor: string | null
      readonly direction: 'earlier' | 'later' | 'latest'
      readonly signal: AbortSignal
    }) => Promise<ExactDotPage>
    readonly publish: (state: ExactDotState) => void
    readonly refreshScheduler?: {
      readonly now: () => number
      readonly schedule: (
        callback: () => void,
        delayMs: number,
      ) => ReturnType<typeof setTimeout>
      readonly cancel: (handle: ReturnType<typeof setTimeout>) => void
    }
  }) => ExactDotController
  readonly resolveBreadcrumbDotOverlaySnapshot: (
    snapshot: TrackingSnapshot,
    trailMode: 'dots' | 'line',
    state: ExactDotState,
  ) => TrackingSnapshot
}

describe('exact breadcrumb-dot controller', () => {
  it('queries the exact page in dot mode and ignores representative snapshot breadcrumbs', async () => {
    const module = await loadControllerModule()
    const representatives = [createPosition('representative-1', 'device-1', 0)]
    const exact = Array.from({ length: 8_941 }, (_, index) =>
      createPosition(`exact-${index}`, 'device-1', index),
    )
    const publish = vi.fn()
    const queryPage = vi.fn().mockResolvedValue(createPage(exact))
    const controller = module.createExactBreadcrumbDotController({
      limit: 10_000,
      queryPage,
      publish,
    })

    controller.updateContext({
      missionId: 'mission-a',
      trailMode: 'dots',
      activeDeviceIds: ['device-1'],
    })
    await vi.waitFor(() => expect(controller.getState().status).toBe('ready'))

    expect(queryPage).toHaveBeenCalledWith(expect.objectContaining({
      missionId: 'mission-a',
      activeDeviceIds: ['device-1'],
      limit: 10_000,
      cursor: null,
      direction: 'latest',
      signal: expect.any(AbortSignal),
    }))
    const resolved = module.resolveBreadcrumbDotOverlaySnapshot(
      createSnapshot(representatives),
      'dots',
      controller.getState(),
    )
    expect(resolved.breadcrumbs).toEqual(exact)
    expect(resolved.breadcrumbs).not.toContain(representatives[0])
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'ready',
      pagePositionCount: 8_941,
    }))
  })

  it('never queries exact dots in line mode and leaves the line snapshot unchanged', async () => {
    const module = await loadControllerModule()
    const queryPage = vi.fn()
    const controller = module.createExactBreadcrumbDotController({
      limit: 10_000,
      queryPage,
      publish: vi.fn(),
    })
    const snapshot = createSnapshot([
      createPosition('line-1', 'device-1', 0),
      createPosition('line-2', 'device-1', 1),
    ])

    controller.updateContext({
      missionId: 'mission-a',
      trailMode: 'line',
      activeDeviceIds: ['device-1'],
    })

    expect(queryPage).not.toHaveBeenCalled()
    expect(controller.getState()).toEqual({ status: 'inactive' })
    expect(
      module.resolveBreadcrumbDotOverlaySnapshot(snapshot, 'line', controller.getState()),
    ).toBe(snapshot)
  })

  it('aborts and suppresses late pages after a mission or mode epoch changes', async () => {
    const module = await loadControllerModule()
    const missionA = createDeferred<ExactDotPage>()
    const missionB = createDeferred<ExactDotPage>()
    const queryPage = vi.fn()
      .mockReturnValueOnce(missionA.promise)
      .mockReturnValueOnce(missionB.promise)
    const publish = vi.fn()
    const controller = module.createExactBreadcrumbDotController({
      limit: 10_000,
      queryPage,
      publish,
    })

    controller.updateContext({
      missionId: 'mission-a',
      trailMode: 'dots',
      activeDeviceIds: ['device-1'],
    })
    await vi.waitFor(() => expect(queryPage).toHaveBeenCalledTimes(1))
    const missionASignal = queryPage.mock.calls[0]?.[0].signal as AbortSignal
    controller.updateContext({
      missionId: 'mission-b',
      trailMode: 'dots',
      activeDeviceIds: ['device-2'],
    })
    await vi.waitFor(() => expect(queryPage).toHaveBeenCalledTimes(2))
    expect(missionASignal.aborted).toBe(true)

    missionA.resolve(createPage([createPosition('stale-a', 'device-1', 0)]))
    await Promise.resolve()
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'ready',
      missionId: 'mission-a',
    }))

    const missionBSignal = queryPage.mock.calls[1]?.[0].signal as AbortSignal
    controller.updateContext({
      missionId: 'mission-b',
      trailMode: 'line',
      activeDeviceIds: ['device-2'],
    })
    expect(missionBSignal.aborted).toBe(true)
    missionB.resolve(createPage([createPosition('stale-b', 'device-2', 0)]))
    await Promise.resolve()
    expect(controller.getState()).toEqual({ status: 'inactive' })
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'ready',
      missionId: 'mission-b',
    }))
  })

  it('publishes visible unavailability with zero dots and never falls back to representatives', async () => {
    const module = await loadControllerModule()
    const controller = module.createExactBreadcrumbDotController({
      limit: 10_000,
      queryPage: vi.fn().mockRejectedValue(new Error('SQLite worker failed')),
      publish: vi.fn(),
    })
    const representativeSnapshot = createSnapshot([
      createPosition('representative-a', 'device-1', 0),
      createPosition('representative-b', 'device-1', 1),
    ])

    controller.updateContext({
      missionId: 'mission-a',
      trailMode: 'dots',
      activeDeviceIds: ['device-1'],
    })
    await vi.waitFor(() => expect(controller.getState().status).toBe('unavailable'))

    const state = controller.getState()
    expect(state).toEqual(expect.objectContaining({
      status: 'unavailable',
      missionId: 'mission-a',
      message: expect.stringMatching(/exact breadcrumb dots.*unavailable/iu),
    }))
    const resolved = module.resolveBreadcrumbDotOverlaySnapshot(
      representativeSnapshot,
      'dots',
      state,
    )
    expect(resolved.breadcrumbs).toEqual([])
    expect(resolved.devices).toBe(representativeSnapshot.devices)
    expect(resolved.positions).toBe(representativeSnapshot.positions)
  })

  it('rate-bounds durable refreshes while eventually publishing the latest dirty truth', async () => {
    const module = await loadControllerModule()
    expect(module.EXACT_BREADCRUMB_DOT_DURABLE_REFRESH_INTERVAL_MS).toBe(1_000)
    const refreshScheduler = createManualRefreshScheduler()
    const refresh = createDeferred<ExactDotPage>()
    const trailing = createDeferred<ExactDotPage>()
    const queryStartedAtMs: number[] = []
    const queryPage = vi.fn(() => {
      queryStartedAtMs.push(refreshScheduler.now())
      if (queryStartedAtMs.length === 1) {
        return Promise.resolve(createPage([createPosition('initial', 'device-1', 0)]))
      }
      return queryStartedAtMs.length === 2 ? refresh.promise : trailing.promise
    })
    const controller = module.createExactBreadcrumbDotController({
      limit: 10_000,
      queryPage,
      publish: vi.fn(),
      refreshScheduler,
    })
    controller.updateContext({
      missionId: 'mission-a',
      trailMode: 'dots',
      activeDeviceIds: ['device-1'],
    })
    await vi.waitFor(() => expect(controller.getState().status).toBe('ready'))

    controller.notifyDurableChange(0)
    expect(queryPage).toHaveBeenCalledTimes(1)
    controller.notifyDurableChange(1)
    controller.notifyDurableChange(2)
    controller.notifyDurableChange(3)
    expect(queryPage).toHaveBeenCalledTimes(1)
    refreshScheduler.advanceBy(999)
    expect(queryPage).toHaveBeenCalledTimes(1)
    refreshScheduler.advanceBy(1)
    expect(queryPage).toHaveBeenCalledTimes(2)

    controller.notifyDurableChange(4)
    controller.notifyDurableChange(5)

    refresh.resolve(createPage([createPosition('refresh', 'device-1', 1)]))
    await vi.waitFor(() => expect(controller.getState()).toEqual(
      expect.objectContaining({
        status: 'ready',
        positions: [expect.objectContaining({ id: 'refresh' })],
      }),
    ))
    refreshScheduler.advanceBy(999)
    expect(queryPage).toHaveBeenCalledTimes(2)
    refreshScheduler.advanceBy(1)
    expect(queryPage).toHaveBeenCalledTimes(3)
    trailing.resolve(createPage([createPosition('trailing', 'device-1', 2)]))
    await vi.waitFor(() => expect(controller.getState()).toEqual(
      expect.objectContaining({
        status: 'ready',
        positions: [expect.objectContaining({ id: 'trailing' })],
      }),
    ))
    expect(queryPage).toHaveBeenCalledTimes(3)
    expect(queryStartedAtMs).toEqual([0, 1_000, 2_000])
  })

  it('keeps the last exact page visible and prioritizes explicit navigation during background refresh', async () => {
    const module = await loadControllerModule()
    const refreshScheduler = createManualRefreshScheduler()
    const backgroundRefresh = createDeferred<ExactDotPage>()
    const initial = {
      ...createPage([createPosition('latest', 'device-1', 100)]),
      hasEarlier: true,
      earlierCursor: 'before-latest',
    }
    const earlier = {
      ...createPage([createPosition('earlier', 'device-1', 10)]),
      hasLater: true,
      laterCursor: 'after-earlier',
    }
    const queryPage = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(backgroundRefresh.promise)
      .mockResolvedValueOnce(earlier)
    const publish = vi.fn()
    const controller = module.createExactBreadcrumbDotController({
      limit: 10_000,
      queryPage,
      publish,
      refreshScheduler,
    })
    controller.updateContext({
      missionId: 'mission-a',
      trailMode: 'dots',
      activeDeviceIds: ['device-1'],
    })
    await vi.waitFor(() => expect(controller.getState().status).toBe('ready'))

    controller.notifyDurableChange(1)
    refreshScheduler.advanceBy(1_000)
    expect(queryPage).toHaveBeenCalledTimes(2)
    const backgroundSignal = queryPage.mock.calls[1]?.[0].signal as AbortSignal
    expect(controller.getState()).toEqual(expect.objectContaining({
      status: 'ready',
      positions: [expect.objectContaining({ id: 'latest' })],
    }))
    expect(publish).not.toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'loading',
    }))

    controller.showEarlier()
    expect(backgroundSignal.aborted).toBe(true)
    expect(queryPage).toHaveBeenCalledTimes(3)
    expect(queryPage).toHaveBeenNthCalledWith(3, expect.objectContaining({
      direction: 'earlier',
      cursor: 'before-latest',
    }))
    await vi.waitFor(() => expect(controller.getState()).toEqual(
      expect.objectContaining({
        status: 'ready',
        positions: [expect.objectContaining({ id: 'earlier' })],
      }),
    ))

    backgroundRefresh.resolve(createPage([createPosition('stale-refresh', 'device-1', 101)]))
    await Promise.resolve()
    expect(controller.getState()).toEqual(expect.objectContaining({
      status: 'ready',
      positions: [expect.objectContaining({ id: 'earlier' })],
    }))
  })

  it('cancels scheduled durable refreshes on context replacement and stop', async () => {
    const module = await loadControllerModule()
    const refreshScheduler = createManualRefreshScheduler()
    const queryPage = vi.fn().mockResolvedValue(createPage([
      createPosition('initial', 'device-1', 0),
    ]))
    const controller = module.createExactBreadcrumbDotController({
      limit: 10_000,
      queryPage,
      publish: vi.fn(),
      refreshScheduler,
    })
    controller.updateContext({
      missionId: 'mission-a',
      trailMode: 'dots',
      activeDeviceIds: ['device-1'],
    })
    await vi.waitFor(() => expect(controller.getState().status).toBe('ready'))

    controller.notifyDurableChange(1)
    expect(refreshScheduler.pendingCount()).toBe(1)
    controller.updateContext({
      missionId: 'mission-a',
      trailMode: 'line',
      activeDeviceIds: ['device-1'],
    })
    expect(refreshScheduler.pendingCount()).toBe(0)
    refreshScheduler.advanceBy(2_000)
    expect(queryPage).toHaveBeenCalledTimes(1)

    controller.updateContext({
      missionId: 'mission-b',
      trailMode: 'dots',
      activeDeviceIds: ['device-2'],
    })
    await vi.waitFor(() => expect(controller.getState().status).toBe('ready'))
    expect(queryPage).toHaveBeenCalledTimes(2)
    controller.notifyDurableChange(1)
    expect(refreshScheduler.pendingCount()).toBe(1)
    controller.stop()
    expect(refreshScheduler.pendingCount()).toBe(0)
    refreshScheduler.advanceBy(2_000)
    expect(queryPage).toHaveBeenCalledTimes(2)
  })

  it('refreshes the operator current earlier page without jumping back to latest', async () => {
    const module = await loadControllerModule()
    const latestPosition = createPosition('latest', 'device-1', 100)
    const earlierPosition = createPosition('earlier', 'device-1', 10)
    const refreshedEarlierPosition = createPosition('earlier-corrected', 'device-1', 10)
    const queryPage = vi.fn()
      .mockResolvedValueOnce({
        ...createPage([latestPosition]),
        hasEarlier: true,
        earlierCursor: 'before-latest',
      })
      .mockResolvedValueOnce({
        ...createPage([earlierPosition]),
        hasLater: true,
        laterCursor: 'after-earlier',
      })
      .mockResolvedValueOnce({
        ...createPage([refreshedEarlierPosition]),
        hasLater: true,
        laterCursor: 'after-earlier',
      })
    const controller = module.createExactBreadcrumbDotController({
      limit: 10_000,
      queryPage,
      publish: vi.fn(),
    })
    controller.updateContext({
      missionId: 'mission-a',
      trailMode: 'dots',
      activeDeviceIds: [],
    })
    await vi.waitFor(() => expect(controller.getState().status).toBe('ready'))

    controller.showEarlier()
    await vi.waitFor(() => expect(controller.getState()).toEqual(
      expect.objectContaining({
        status: 'ready',
        positions: [expect.objectContaining({ id: 'earlier' })],
      }),
    ))
    controller.notifyDurableChange(1)
    await vi.waitFor(() => expect(controller.getState()).toEqual(
      expect.objectContaining({
        status: 'ready',
        positions: [expect.objectContaining({ id: 'earlier-corrected' })],
      }),
    ))

    expect(queryPage).toHaveBeenNthCalledWith(3, expect.objectContaining({
      direction: 'earlier',
      cursor: 'before-latest',
    }))
  })

  it('replays an operator Earlier click published before the foreground request drains', async () => {
    const module = await loadControllerModule()
    const latest = {
      ...createPage([createPosition('latest', 'device-1', 100)]),
      hasEarlier: true,
      earlierCursor: 'before-latest',
    }
    const earlier = {
      ...createPage([createPosition('earlier', 'device-1', 10)]),
      hasLater: true,
      laterCursor: 'after-earlier',
    }
    const queryPage = vi.fn((input: { readonly direction: string }) =>
      Promise.resolve(input.direction === 'earlier' ? earlier : latest),
    )
    let clickedEarlier = false
    const controllerReference: { current: ExactDotController | null } = {
      current: null,
    }
    const publish = vi.fn((state: ExactDotState) => {
      if (
        !clickedEarlier &&
        state.status === 'ready' &&
        state.positions[0]?.id === 'latest'
      ) {
        clickedEarlier = true
        controllerReference.current?.showEarlier()
      }
    })
    const controller = module.createExactBreadcrumbDotController({
      limit: 10_000,
      queryPage,
      publish,
    })
    controllerReference.current = controller

    controller.updateContext({
      missionId: 'mission-a',
      trailMode: 'dots',
      activeDeviceIds: [],
    })

    await vi.waitFor(() => expect(controller.getState()).toEqual(
      expect.objectContaining({
        status: 'ready',
        positions: [expect.objectContaining({ id: 'earlier' })],
      }),
    ))
    expect(queryPage).toHaveBeenCalledTimes(2)
    expect(queryPage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      direction: 'earlier',
      cursor: 'before-latest',
    }))
  })

  it.each(['context replacement', 'stop'] as const)(
    'discards queued foreground navigation after %s',
    async (lifecycleAction) => {
      const module = await loadControllerModule()
      const latest = {
        ...createPage([createPosition('latest', 'device-1', 100)]),
        hasEarlier: true,
        earlierCursor: 'before-latest',
      }
      const queryPage = vi.fn().mockResolvedValue(latest)
      let lifecycleApplied = false
      const controllerReference: { current: ExactDotController | null } = {
        current: null,
      }
      const publish = vi.fn((state: ExactDotState) => {
        if (!lifecycleApplied && state.status === 'ready') {
          lifecycleApplied = true
          controllerReference.current?.showEarlier()
          if (lifecycleAction === 'stop') {
            controllerReference.current?.stop()
          } else {
            controllerReference.current?.updateContext({
              missionId: 'mission-a',
              trailMode: 'line',
              activeDeviceIds: [],
            })
          }
        }
      })
      const controller = module.createExactBreadcrumbDotController({
        limit: 10_000,
        queryPage,
        publish,
      })
      controllerReference.current = controller

      controller.updateContext({
        missionId: 'mission-a',
        trailMode: 'dots',
        activeDeviceIds: [],
      })
      await vi.waitFor(() => expect(controller.getState()).toEqual({
        status: 'inactive',
      }))
      await Promise.resolve()

      expect(queryPage).toHaveBeenCalledTimes(1)
      expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({
        positions: [expect.objectContaining({ id: 'earlier' })],
      }))
    },
  )
})

async function loadControllerModule(): Promise<ExactDotControllerModule> {
  try {
    const modulePath = '../../src/features/tracking/exact-breadcrumb-dot-controller'
    return await import(/* @vite-ignore */ modulePath) as ExactDotControllerModule
  } catch (error) {
    throw new Error(
      'Exact dot mode requires an isolated exact-breadcrumb-dot controller; snapshot line representatives are not an allowed fallback.',
      { cause: error },
    )
  }
}

function createPosition(
  id: string,
  deviceId: string,
  ordinal: number,
): NormalizedTrackingPosition {
  return {
    id,
    device_id: deviceId,
    lat: 52 + ordinal / 10_000_000,
    lon: -9.7 - ordinal / 10_000_000,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp: new Date(Date.UTC(2026, 7, 8) + ordinal * 5_000).toISOString(),
    source: 'traccar',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}

function createPage(positions: readonly NormalizedTrackingPosition[]): ExactDotPage {
  return {
    positions,
    totalPositionCount: positions.length,
    pagePositionCount: positions.length,
    fromTimestamp: positions[0]?.timestamp ?? null,
    toTimestamp: positions.at(-1)?.timestamp ?? null,
    hasEarlier: false,
    hasLater: false,
    earlierCursor: null,
    laterCursor: null,
  }
}

function createSnapshot(
  breadcrumbs: readonly NormalizedTrackingPosition[],
): TrackingSnapshot {
  return {
    devices: [],
    positions: [],
    breadcrumbs,
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

function createManualRefreshScheduler(): {
  readonly now: () => number
  readonly schedule: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>
  readonly cancel: (handle: ReturnType<typeof setTimeout>) => void
  readonly advanceBy: (elapsedMs: number) => void
  readonly pendingCount: () => number
} {
  type ScheduledTask = {
    readonly handle: ReturnType<typeof setTimeout>
    readonly atMs: number
    readonly callback: () => void
  }
  let nowMs = 0
  let nextHandle = 1
  const tasks = new Map<ReturnType<typeof setTimeout>, ScheduledTask>()

  const scheduler = {
    now: () => nowMs,
    schedule: (callback: () => void, delayMs: number) => {
      const handle = nextHandle as unknown as ReturnType<typeof setTimeout>
      nextHandle += 1
      tasks.set(handle, {
        handle,
        atMs: nowMs + Math.max(0, delayMs),
        callback,
      })
      return handle
    },
    cancel: (handle: ReturnType<typeof setTimeout>) => {
      tasks.delete(handle)
    },
    advanceBy: (elapsedMs: number) => {
      const targetMs = nowMs + elapsedMs
      while (true) {
        const next = [...tasks.values()]
          .filter((task) => task.atMs <= targetMs)
          .sort((left, right) => left.atMs - right.atMs)[0]
        if (next === undefined) {
          break
        }
        tasks.delete(next.handle)
        nowMs = next.atMs
        next.callback()
      }
      nowMs = targetMs
    },
    pendingCount: () => tasks.size,
  }
  return scheduler
}
