import { describe, expect, it, vi } from 'vitest'

import type { CoverageState } from '../../src/features/tracking/coverage-controller'
import { createCoverageStalenessMonitor } from '../../src/features/tracking/coverage-staleness-monitor'

const MINUTE_MS = 60_000

/** Builds a live coverage state with the controller's cumulative stale counter. */
function coverage(
  status: 'loading' | 'partial' | 'complete' | 'error',
  retryableStaleCount: number,
  missionId = 'mission-1',
): CoverageState {
  return {
    status,
    missionId,
    rendererGeneration: 'renderer-1',
    changeSeq: 1,
    latestObservedChangeSeq: 1,
    manifest: null,
    tileCatalog: null,
    delivered: {},
    deliveredFixCount: 0,
    totalFixCount: 0,
    retryableStaleCount,
    lastErrorClass: status === 'partial' ? 'chunk_stale' : null,
  }
}

function harness() {
  let nowMs = 1_000_000
  const onPersistent = vi.fn()
  const onRecovered = vi.fn()
  const monitor = createCoverageStalenessMonitor({ now: () => nowMs, onPersistent, onRecovered })
  return {
    monitor,
    onPersistent,
    onRecovered,
    advance: (ms: number) => { nowMs += ms },
  }
}

describe('coverage staleness monitor [DON-334]', () => {
  it('escalates once when coverage stays stale for five minutes with at least five stale results', () => {
    const h = harness()
    h.monitor.observe(coverage('complete', 0))
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      h.monitor.observe(coverage('partial', attempt))
      if (attempt < 10) h.advance(30_000)
    }
    // 4.5 minutes of stale results: not yet persistent.
    expect(h.onPersistent).not.toHaveBeenCalled()

    h.advance(30_000)
    h.monitor.observe(coverage('partial', 11))
    h.advance(30_000)
    h.monitor.observe(coverage('partial', 12))

    expect(h.onPersistent).toHaveBeenCalledExactlyOnceWith({ staleForMs: 5 * MINUTE_MS, staleResults: 11 })
  })

  it('does not escalate a long stale spell with fewer than five stale results', () => {
    const h = harness()
    h.monitor.observe(coverage('partial', 1))
    h.advance(10 * MINUTE_MS)
    h.monitor.observe(coverage('partial', 4))
    h.monitor.observe(coverage('loading', 4))
    expect(h.onPersistent).not.toHaveBeenCalled()
  })

  it('reports recovery and starts a fresh episode once coverage completes', () => {
    const h = harness()
    h.monitor.observe(coverage('partial', 1))
    h.advance(6 * MINUTE_MS)
    h.monitor.observe(coverage('partial', 6))
    expect(h.onPersistent).toHaveBeenCalledTimes(1)

    h.advance(MINUTE_MS)
    h.monitor.observe(coverage('complete', 6))
    expect(h.onRecovered).toHaveBeenCalledExactlyOnceWith({ reason: 'complete', staleForMs: 7 * MINUTE_MS })

    // A new short stale spell after recovery must not re-escalate on old counts.
    h.monitor.observe(coverage('partial', 7))
    h.advance(MINUTE_MS)
    h.monitor.observe(coverage('partial', 12))
    expect(h.onPersistent).toHaveBeenCalledTimes(1)
  })

  it('keeps a stale episode open through loading and error states until Complete', () => {
    const h = harness()
    h.monitor.observe(coverage('partial', 1))
    h.advance(2 * MINUTE_MS)
    h.monitor.observe(coverage('error', 3))
    h.advance(2 * MINUTE_MS)
    h.monitor.observe(coverage('loading', 3))
    h.advance(MINUTE_MS)
    h.monitor.observe(coverage('partial', 5))
    expect(h.onPersistent).toHaveBeenCalledExactlyOnceWith({ staleForMs: 5 * MINUTE_MS, staleResults: 5 })
  })

  it('clears the escalation when the mission changes or coverage becomes inactive', () => {
    const h = harness()
    h.monitor.observe(coverage('partial', 1))
    h.advance(5 * MINUTE_MS)
    h.monitor.observe(coverage('partial', 5))
    h.monitor.observe(coverage('partial', 0, 'mission-2'))
    expect(h.onRecovered).toHaveBeenCalledExactlyOnceWith({ reason: 'mission_changed', staleForMs: 5 * MINUTE_MS })

    h.monitor.observe(coverage('partial', 1, 'mission-2'))
    h.advance(5 * MINUTE_MS)
    h.monitor.observe(coverage('partial', 5, 'mission-2'))
    h.monitor.observe({ status: 'inactive' })
    expect(h.onRecovered).toHaveBeenLastCalledWith({ reason: 'mission_changed', staleForMs: 5 * MINUTE_MS })
    expect(h.onPersistent).toHaveBeenCalledTimes(2)
  })

  it('counts stale results across a controller counter reset within the same mission', () => {
    const h = harness()
    h.monitor.observe(coverage('partial', 3))
    h.advance(2 * MINUTE_MS)
    // An identity change inside the controller resets its cumulative counter.
    h.monitor.observe(coverage('partial', 0))
    h.monitor.observe(coverage('partial', 2))
    h.advance(3 * MINUTE_MS)
    h.monitor.observe(coverage('partial', 2))
    expect(h.onPersistent).toHaveBeenCalledExactlyOnceWith({ staleForMs: 5 * MINUTE_MS, staleResults: 5 })
  })

  it('clears any escalation on stop without reporting it as recovered coverage', () => {
    const h = harness()
    h.monitor.observe(coverage('partial', 1))
    h.advance(5 * MINUTE_MS)
    h.monitor.observe(coverage('partial', 5))
    h.monitor.stop()
    expect(h.onRecovered).toHaveBeenCalledExactlyOnceWith({ reason: 'stopped', staleForMs: 5 * MINUTE_MS })
    h.monitor.stop()
    expect(h.onRecovered).toHaveBeenCalledTimes(1)
  })
})
