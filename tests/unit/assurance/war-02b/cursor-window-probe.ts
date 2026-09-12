import { vi } from 'vitest'

import {
  createPollingManager,
  type TrackingPollerClient,
} from '../../../../src/features/tracking/polling-manager'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
} from '../../../../src/features/tracking/tracking-types'
import { createProbePosition, type CursorWindowCase } from './arbitraries'

const PROBE_BASE_TIME_MS = Date.parse('2026-09-12T10:00:00.000Z')
export const WAR_02B_CURSOR_OVERLAP_MS = 5 * 60 * 1000
const WAR_02B_RECENT_WINDOW_MAX_MS = 2 * 60 * 60 * 1000

export type CursorWindowObservation = {
  readonly previousCursorMs: number
  readonly requestedFromMs: number
  readonly managerRequestedFromMs: number
  readonly requestedToMs: number
  readonly completedNowMs: number
  readonly boundaryReturned: boolean
  readonly boundaryPublished: boolean
}

export type CursorWindowProbeOptions = {
  /** Mutates the request after the real polling manager has calculated its window. */
  readonly mutateRequestedFrom?: (requestedFromMs: number) => number
}

/** Computes the expected inclusive cursor window, including the bounded recent-history clamp. */
function expectedRequestedFromMs(observation: CursorWindowObservation): number {
  const overlappedMs = observation.previousCursorMs - WAR_02B_CURSOR_OVERLAP_MS
  const lowerBoundedMs = Math.max(
    overlappedMs,
    observation.requestedToMs - WAR_02B_RECENT_WINDOW_MAX_MS,
  )
  return Math.min(lowerBoundedMs, observation.requestedToMs)
}

/** Checks the manager's actual arithmetic before any client-boundary mutation is applied. */
export function cursorWindowRequestArithmeticInvariant(
  observation: CursorWindowObservation,
): boolean {
  return observation.managerRequestedFromMs === expectedRequestedFromMs(observation)
}

/** States the operator-safety oracle for a completed inclusive history window. */
export function cursorWindowInvariant(observation: CursorWindowObservation): boolean {
  return (
    cursorWindowRequestArithmeticInvariant(observation) &&
    observation.requestedFromMs === expectedRequestedFromMs(observation) &&
    observation.requestedFromMs <= observation.requestedToMs &&
    observation.requestedToMs <= observation.completedNowMs &&
    observation.boundaryReturned &&
    observation.boundaryPublished
  )
}

/** Checks exact request arithmetic and boundary behavior across both cursor and recent-window regimes. */
export function cursorWindowBoundsInvariant(observation: CursorWindowObservation): boolean {
  const expectedFromMs = expectedRequestedFromMs(observation)
  const shouldReturnBoundary = expectedFromMs <= observation.previousCursorMs
  return (
    cursorWindowRequestArithmeticInvariant(observation) &&
    observation.requestedFromMs === expectedFromMs &&
    observation.requestedFromMs <= observation.requestedToMs &&
    observation.requestedToMs <= observation.completedNowMs &&
    observation.boundaryReturned === shouldReturnBoundary &&
    observation.boundaryPublished === shouldReturnBoundary
  )
}

const probeDevice: NormalizedTrackingDevice = {
  device_id: 'war-02b-device',
  name: 'WAR-02B device',
  status: 'online',
  last_seen: null,
  unique_id: 'war-02b-device',
  category: null,
}

/** Exercises the real polling manager through its public client boundary. */
export async function observeCursorWindow(
  input: CursorWindowCase,
  options: CursorWindowProbeOptions = {},
): Promise<CursorWindowObservation> {
  let poller: ReturnType<typeof createPollingManager> | undefined
  try {
    vi.useFakeTimers()
    let currentTimeMs = PROBE_BASE_TIME_MS
    let breadcrumbCallCount = 0
    let secondBoundaryReturned = false
    let managerRequestedFromMs: number | undefined
    const previousCursorMs = PROBE_BASE_TIME_MS - input.previousCursorAgeMs
    const firstPosition = createProbePosition(new Date(previousCursorMs).toISOString())
    const boundaryPosition = {
      ...createProbePosition(new Date(previousCursorMs + 500).toISOString()),
      id: 'war-02b-next-boundary-fix',
    }
    const getBreadcrumbs = vi.fn(
      async (
        _deviceId: string,
        from: Date,
        _to: Date,
        _signal?: AbortSignal,
      ): Promise<readonly NormalizedTrackingPosition[]> => {
        void _to
        void _signal
        breadcrumbCallCount += 1
        if (breadcrumbCallCount === 1) {
          return [firstPosition]
        }
        managerRequestedFromMs = from.getTime()
        const effectiveRequestedFromMs = options.mutateRequestedFrom?.(managerRequestedFromMs) ?? managerRequestedFromMs
        secondBoundaryReturned = effectiveRequestedFromMs <= previousCursorMs
        return secondBoundaryReturned ? [boundaryPosition] : []
      },
    )
    const client: TrackingPollerClient = {
      authenticate: vi.fn().mockResolvedValue(undefined),
      getDevices: vi.fn().mockResolvedValue([probeDevice]),
      getCurrentPositions: vi.fn().mockResolvedValue([]),
      getBreadcrumbs,
    }
    const onSnapshot = vi.fn()
    poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      getBreadcrumbDeviceIds: () => [probeDevice.device_id],
      onSnapshot,
      onStatusChange: vi.fn(),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      now: () => new Date(currentTimeMs),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    currentTimeMs += input.pollingGapMs
    poller.requestPollNow()
    await vi.advanceTimersByTimeAsync(0)

    const secondCall = getBreadcrumbs.mock.calls[1]
    if (secondCall === undefined) {
      throw new Error('WAR-02B cursor probe did not reach its second history request.')
    }
    const requestedFrom = secondCall[1]
    const requestedTo = secondCall[2]
    if (requestedFrom === undefined || requestedTo === undefined) {
      throw new Error('WAR-02B cursor probe captured an incomplete history request.')
    }
    if (managerRequestedFromMs === undefined) {
      throw new Error('WAR-02B cursor probe did not capture the manager request arithmetic.')
    }
    return {
      previousCursorMs,
      requestedFromMs: requestedFrom.getTime(),
      managerRequestedFromMs,
      requestedToMs: requestedTo.getTime(),
      completedNowMs: currentTimeMs,
      boundaryReturned: secondBoundaryReturned,
      boundaryPublished: onSnapshot.mock.calls.some((call) => {
        const snapshot = call[0] as { readonly breadcrumbs?: readonly NormalizedTrackingPosition[] }
        return snapshot.breadcrumbs?.some((position) => position.id === boundaryPosition.id) ?? false
      }),
    }
  } finally {
    await poller?.stop()
    vi.useRealTimers()
  }
}
