import { assertReleaseResponsiveness } from '../support/release-responsiveness'
import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { collectMainEventLoopEvidence, installMainEventLoopProbe, validateMainEventLoopEvidence } from '../../build/main-event-loop-probe.js'

describe('independent packaged main-loop gate [DON-254]', () => {
  it('fails collection within a bounded deadline when main never services the stop timer', async () => {
    vi.useFakeTimers()
    try {
      const collection = collectMainEventLoopEvidence({ evaluate: () => new Promise(() => undefined) }, 100)
      await vi.advanceTimersByTimeAsync(100)
      await expect(collection).resolves.toEqual({ error: 'main_timer_collection_failed' })
    } finally { vi.useRealTimers() }
  })

  it('rejects a real blocked Node main loop that the inspector interrupt path misses', async () => {
    const fixture = path.resolve('tests/fixtures/main-event-loop-probe-negative-control.mjs')
    const { stdout } = await promisify(execFile)(process.execPath, [fixture], { timeout: 10_000 })
    const report = JSON.parse(stdout)
    expect(report.error).toBeNull()
    assertReleaseResponsiveness(() => expect(report.inspectorRoundTripMs).toBeLessThan(200))
    expect(report.mainEvaluatedAtMs).toBeGreaterThanOrEqual(report.blockStartedAtMs)
    expect(report.mainEvaluatedAtMs).toBeLessThan(report.blockEndedAtMs)
    expect(report.mainEventLoop.maximumGapMs).toBeGreaterThanOrEqual(350)
    expect(report.failureReasons).toEqual([expect.stringMatching(/main.*200ms/iu)])
  }, 15_000)

  it('detects a blocked loop even when the separate inspector response is fast', () => {
    let time = 0
    let tick = () => undefined
    const probe = installMainEventLoopProbe({
      performance: { now: () => time, timeOrigin: 1_000 },
      setInterval: (callback: () => void) => { tick = callback; return 1 },
      clearInterval: () => undefined,
    })
    time = 50
    tick()
    // Inspector evaluation is an interrupt path, so its response may be short
    // even though the main timer has not received another event-loop turn.
    const inspectorRoundTripMs = 2
    time = 300
    tick()
    const evidence = probe.stop()
    expect(inspectorRoundTripMs).toBeLessThan(200)
    expect(evidence.maximumGapMs).toBe(250)
    expect(validateMainEventLoopEvidence([evidence], 1)).toEqual([
      expect.stringMatching(/main.*250.*200/iu),
    ])
  })

  it('accepts complete sub-200 evidence and rejects the exact threshold and missing launch samples', () => {
    const evidence = { intervalMs: 50, samples: 2, startedAtMs: 0, stoppedAtMs: 150, maximumGapMs: 150 }
    expect(validateMainEventLoopEvidence([evidence, evidence], 2)).toEqual([])
    expect(validateMainEventLoopEvidence([{ ...evidence, maximumGapMs: 200 }], 1)).not.toEqual([])
    expect(validateMainEventLoopEvidence([evidence], 2)).not.toEqual([])
    for (const invalid of [null, { ...evidence, samples: 0 }, { ...evidence, maximumGapMs: NaN }, { ...evidence, stoppedAtMs: -1 }]) {
      expect(validateMainEventLoopEvidence([invalid], 1)).not.toEqual([])
    }
  })

  it('includes the unserviced tail at stop and stops idempotently', () => {
    let time = 0
    const probe = installMainEventLoopProbe({
      performance: { now: () => time, timeOrigin: 1_000 },
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    time = 250
    const evidence = probe.stop()
    expect(evidence.maximumGapMs).toBe(250)
    expect(evidence.samples).toBe(0)
    time = 500
    expect(probe.stop()).toEqual(evidence)
    expect(validateMainEventLoopEvidence([evidence], 1)).not.toEqual([])
  })
})
