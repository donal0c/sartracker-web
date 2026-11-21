import { afterEach, describe, expect, it, vi } from 'vitest'

import { summarizeCoverageStatus } from '../../src/features/tracking/coverage-progress'
import {
  activeCoverage as active,
  createCoverageFakeMapHarness as harness,
  loadCoverageComplete as loadComplete,
} from '../support/coverage-fake-map-harness'

/**
 * DON-338 round 2: the whole-history line recovers by itself after the tile
 * worker dies, and operator Retry makes the map re-apply a catalog or filter
 * that stalled. Only the native store and the map are replaced; the fake map
 * re-runs its sync exactly when use-map-overlays would (catalog object
 * identity or selection signature changes).
 */

afterEach(() => vi.useRealTimers())

describe('DON-338: the history line recovers after the tile worker dies', () => {
  it('rebuilds without operator action and never reads up to date meanwhile', async () => {
    vi.useFakeTimers()
    const { controller, deliverSelection } = harness()
    await loadComplete(controller)
    expect(deliverSelection).toHaveBeenCalledTimes(1)

    controller.notifyRendererUnavailable('Coverage tile worker is unavailable.')
    const failed = active(controller.getState())
    expect(failed.status).toBe('error')
    expect(failed.updating).toBe(true)
    expect(summarizeCoverageStatus(failed)).toMatchObject({ kind: 'failed', automaticRetry: true })

    await vi.advanceTimersByTimeAsync(250)
    expect(deliverSelection).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(0)
    expect(active(controller.getState())).toMatchObject({ status: 'complete', deliveredFixCount: 10 })
    controller.stop()
  })

  it('schedules the next attempt when a recovery load also fails', async () => {
    vi.useFakeTimers()
    // The first rebuild after the worker died fails too.
    const { controller, deliverSelection } = harness({ failDelivery: (call) => call === 2 })
    await loadComplete(controller)

    controller.notifyRendererUnavailable('Coverage tile worker is unavailable.')
    await vi.advanceTimersByTimeAsync(250)
    expect(deliverSelection).toHaveBeenCalledTimes(2)
    const stillFailed = active(controller.getState())
    expect(stillFailed.status).toBe('error')
    expect(stillFailed.updating).toBe(true)
    expect(summarizeCoverageStatus(stillFailed).kind).toBe('failed')

    await vi.advanceTimersByTimeAsync(5_000)
    expect(deliverSelection).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(0)
    expect(active(controller.getState()).status).toBe('complete')
    controller.stop()
  })

  it('keeps retrying on the capped backoff while every rebuild fails', async () => {
    vi.useFakeTimers()
    const { controller, deliverSelection } = harness({ failDelivery: (call) => call >= 2 })
    await loadComplete(controller)

    controller.notifyRendererUnavailable('Coverage tile worker is unavailable.')
    await vi.advanceTimersByTimeAsync(250 + 5_000 + 15_000 + 30_000 + 30_000)
    expect(deliverSelection).toHaveBeenCalledTimes(6)
    expect(active(controller.getState())).toMatchObject({ status: 'error', updating: true })
    controller.stop()
  })
})

describe('DON-338: Retry makes the map re-apply a stalled catalog or filter', () => {
  it('recovers a detached map once the map can draw again', async () => {
    vi.useFakeTimers()
    const { controller, map } = harness()
    await loadComplete(controller)

    map.working = false
    controller.notifyRendererDetached()
    expect(active(controller.getState()).blockers).toContain('renderer_detached')
    map.working = true

    await controller.resume()
    await vi.advanceTimersByTimeAsync(0)
    const recovered = active(controller.getState())
    expect(recovered.blockers ?? []).not.toContain('renderer_detached')
    expect(recovered.status).toBe('complete')
    controller.stop()
  })

  it('recovers a history filter the map never applied', async () => {
    vi.useFakeTimers()
    const { controller, map } = harness()
    await loadComplete(controller)

    map.working = false
    map.omissions = { omittedDeviceIds: ['device-b'], omittedPeriodKeys: [] }
    await controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1', omittedDeviceIds: ['device-b'],
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(active(controller.getState()).blockers).toContain('renderer_filter_pending')
    map.working = true

    await controller.resume()
    await vi.advanceTimersByTimeAsync(0)
    const recovered = active(controller.getState())
    expect(recovered.blockers ?? []).not.toContain('renderer_filter_pending')
    expect(recovered).toMatchObject({ status: 'complete', totalFixCount: 5 })
    controller.stop()
  })
})

describe('DON-338: the worker cause holds for its whole recovery episode', () => {
  const OUT_OF_MEMORY = { code: 'coverage-worker-out-of-memory' } as const

  /** A tile of the given stage's catalog rejecting, as the dead worker's outstanding tiles do. */
  function tileFailure(stage: number) {
    return {
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing-1',
      revisionDigest: `stage-${stage}`,
      activationId: `stage-${stage}`,
      message: 'Coverage tile delivery failed',
    }
  }

  it('keeps out-of-memory when an outstanding tile then fails generically', async () => {
    vi.useFakeTimers()
    const { controller, deliverSelection } = harness()
    await loadComplete(controller)

    controller.notifyRendererUnavailable('Coverage tile worker is unavailable.', OUT_OF_MEMORY)
    controller.notifyRendererFailure(tileFailure(1))
    expect(active(controller.getState())).toMatchObject({
      status: 'error', lastErrorClass: 'worker_out_of_memory', updating: true,
    })

    // The secondary failure did not start a new episode: the first attempt
    // still runs on the first backoff step and recovers.
    await vi.advanceTimersByTimeAsync(250)
    expect(deliverSelection).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(0)
    expect(active(controller.getState()).status).toBe('complete')
    controller.stop()
  })

  it('keeps out-of-memory when a recovery load fails generically, and clears it once one succeeds', async () => {
    vi.useFakeTimers()
    const { controller, deliverSelection } = harness({ failDelivery: (call) => call === 2 })
    await loadComplete(controller)

    controller.notifyRendererUnavailable('Coverage tile worker is unavailable.', OUT_OF_MEMORY)
    await vi.advanceTimersByTimeAsync(250)
    expect(deliverSelection).toHaveBeenCalledTimes(2)
    expect(active(controller.getState())).toMatchObject({ status: 'error', lastErrorClass: 'worker_out_of_memory' })

    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(active(controller.getState()).status).toBe('complete')

    // A new, unrelated failure after recovery is its own cause.
    controller.notifyRendererFailure(tileFailure(2))
    const later = active(controller.getState())
    expect(later.status).toBe('error')
    expect(later.lastErrorClass).not.toBe('worker_out_of_memory')
    controller.stop()
  })
})
