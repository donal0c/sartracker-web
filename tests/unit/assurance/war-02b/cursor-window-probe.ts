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

export type CursorWindowObservation = {
  readonly previousCursorMs: number
  readonly requestedFromMs: number
  readonly requestedToMs: number
  readonly completedNowMs: number
  readonly boundaryReturned: boolean
  readonly boundaryPublished: boolean
}

/** Applies only the historical exclusive one-second cursor arithmetic mutation. */
export function applyCursorWindowRebreak(
  observation: CursorWindowObservation,
): CursorWindowObservation {
  return {
    ...observation,
    requestedFromMs: observation.previousCursorMs + 1_000,
  }
}

/** States the operator-safety oracle for a completed inclusive history window. */
export function cursorWindowInvariant(observation: CursorWindowObservation): boolean {
  return (
    observation.requestedFromMs < observation.previousCursorMs &&
    observation.requestedFromMs <= observation.requestedToMs &&
    observation.requestedToMs <= observation.completedNowMs &&
    observation.boundaryReturned &&
    observation.boundaryPublished
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
): Promise<CursorWindowObservation> {
  vi.useFakeTimers()
  let currentTimeMs = PROBE_BASE_TIME_MS
  let breadcrumbCallCount = 0
  let secondBoundaryReturned = false
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
      secondBoundaryReturned = from.getTime() <= previousCursorMs
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
  const poller = createPollingManager(client, {
    intervalMs: 5_000,
    staleThresholdMs: 60 * 60 * 1000,
    getBreadcrumbDeviceIds: () => [probeDevice.device_id],
    onSnapshot,
    onStatusChange: vi.fn(),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    now: () => new Date(currentTimeMs),
  })

  try {
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
    return {
      previousCursorMs,
      requestedFromMs: requestedFrom.getTime(),
      requestedToMs: requestedTo.getTime(),
      completedNowMs: currentTimeMs,
      boundaryReturned: secondBoundaryReturned,
      boundaryPublished: onSnapshot.mock.calls.some((call) => {
        const snapshot = call[0] as { readonly breadcrumbs?: readonly NormalizedTrackingPosition[] }
        return snapshot.breadcrumbs?.some((position) => position.id === boundaryPosition.id) ?? false
      }),
    }
  } finally {
    await poller.stop()
    vi.useRealTimers()
  }
}
