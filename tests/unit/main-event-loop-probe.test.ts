import { assertReleaseResponsiveness } from '../support/release-responsiveness'
import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import {
  collectMainEventLoopEvidence,
  installMainEventLoopProbe,
  validateMainEventLoopEvidence,
  validateMainPhaseEvidence,
} from '../../build/main-event-loop-probe.js'

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

  it('records per-operation wall, CPU and Linux scheduler timing', () => {
    let time = 0
    let cpu = { user: 10_000, system: 2_000 }
    let resource = { voluntaryContextSwitches: 3, involuntaryContextSwitches: 4 }
    const schedulerSnapshots = [
      '1000000 200000 3',
      '51000000 10200000 5',
    ]
    const timers: Array<() => void> = []
    const root = {
      performance: { now: () => time, timeOrigin: 1_000 },
      setInterval: (callback: () => void) => { timers.push(callback); return callback },
      clearInterval: () => undefined,
      process: {
        platform: 'linux',
        cpuUsage: (previous?: { readonly user: number; readonly system: number }) => previous === undefined
          ? { ...cpu }
          : { user: cpu.user - previous.user, system: cpu.system - previous.system },
        resourceUsage: () => ({ ...resource }),
        getBuiltinModule: () => ({ readFileSync: (file: string) =>
          file === '/proc/sys/kernel/sched_schedstats' ? '1\n' : schedulerSnapshots.shift() }),
      },
    }
    const probe = installMainEventLoopProbe(root)
    const phase = probe.startPhase('marker-mutation')
    time = 50
    cpu = { user: 22_000, system: 5_000 }
    resource = { voluntaryContextSwitches: 4, involuntaryContextSwitches: 6 }
    for (const tick of timers) tick()

    const evidence = phase.finish()
    expect(evidence).toMatchObject({
      name: 'marker-mutation',
      wallDurationMs: 50,
      processCpuMs: { user: 12, system: 3, total: 15 },
      scheduler: {
        status: 'measured',
        threadRuntimeMs: 50,
        threadRunQueueWaitMs: 10,
        threadTimeSlices: 2,
        processVoluntaryContextSwitches: 1,
        processInvoluntaryContextSwitches: 2,
      },
      mainLoop: { maximumGapMs: 50, samples: 1 },
    })
    expect(validateMainPhaseEvidence([evidence], ['marker-mutation'], 'linux')).toEqual([])
    expect(validateMainPhaseEvidence([evidence], ['prepare-close'], 'linux')).not.toEqual([])
    expect(validateMainPhaseEvidence([
      { ...evidence, mainLoop: { ...evidence.mainLoop, maximumGapMs: 200 } },
    ], ['marker-mutation'], 'linux')).not.toEqual([])
  })

  it('marks Linux scheduler counters unavailable when kernel accounting is disabled', () => {
    let time = 0
    const root = {
      performance: { now: () => time, timeOrigin: 1_000 },
      setInterval: () => 1,
      clearInterval: () => undefined,
      process: {
        platform: 'linux',
        cpuUsage: (previous?: { readonly user: number; readonly system: number }) => previous === undefined
          ? { user: 10_000, system: 2_000 }
          : { user: 1_000, system: 500 },
        resourceUsage: () => ({ voluntaryContextSwitches: 2, involuntaryContextSwitches: 1 }),
        getBuiltinModule: () => ({ readFileSync: (file: string) =>
          file === '/proc/sys/kernel/sched_schedstats' ? '0\n' : '1000000 0 0\n' }),
      },
    }
    const probe = installMainEventLoopProbe(root)
    const phase = probe.startPhase('marker-mutation')
    time = 50
    const evidence = phase.finish()

    expect(evidence.scheduler).toEqual({
      status: 'unavailable',
      code: 'SCHEDSTATS_DISABLED',
      processVoluntaryContextSwitches: 0,
      processInvoluntaryContextSwitches: 0,
    })
    expect(validateMainPhaseEvidence([evidence], ['marker-mutation'], 'linux')).toEqual([])
    expect(validateMainPhaseEvidence([{
      ...evidence,
      scheduler: { ...evidence.scheduler, code: undefined },
    }], ['marker-mutation'], 'linux')).not.toEqual([])
  })

  it('keeps scheduler evidence unavailable when only the start snapshot failed', () => {
    let time = 0
    let statReads = 0
    const root = {
      performance: { now: () => time, timeOrigin: 1_000 },
      setInterval: () => 1,
      clearInterval: () => undefined,
      process: {
        platform: 'linux',
        cpuUsage: (previous?: { readonly user: number; readonly system: number }) => previous === undefined
          ? { user: 10_000, system: 2_000 }
          : { user: 1_000, system: 500 },
        resourceUsage: () => ({ voluntaryContextSwitches: 2, involuntaryContextSwitches: 1 }),
        getBuiltinModule: () => ({ readFileSync: (file: string) => {
          if (file === '/proc/sys/kernel/sched_schedstats') return '1\n'
          statReads += 1
          if (statReads === 1) throw Object.assign(new Error('interrupted'), { code: 'EINTR' })
          return '51000000 10200000 5\n'
        } }),
      },
    }
    const probe = installMainEventLoopProbe(root)
    const phase = probe.startPhase('marker-mutation')
    time = 50
    const evidence = phase.finish()

    expect(evidence.scheduler).toMatchObject({ status: 'unavailable', code: 'EINTR' })
    expect(evidence.scheduler).not.toHaveProperty('threadRuntimeMs')
    expect(validateMainPhaseEvidence([evidence], ['marker-mutation'], 'linux')).toEqual([])
  })
})
