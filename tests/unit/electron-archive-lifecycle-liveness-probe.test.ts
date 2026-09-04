import { describe, expect, it, vi } from 'vitest'

import {
  createPackagedLivenessProbe,
  installRendererLivenessProbe,
  startExternalLaunchWatchdog,
} from '../../scripts/electron-archive-lifecycle-smoke.mjs'

const PHASES = ['create', 'verify', 'restore', 'cleanup'] as const
type Phase = typeof PHASES[number]

interface SourceEntry {
  sequence: number
  phase: Phase | null
  sourcePositionId: string
  sourceTimestamp: string
  requestStartedAtMs: number
  emittedAtMs: number
}

interface RendererSnapshot {
  currentFixes: Array<{
    phase: Phase
    sourcePositionId: string
    sourceTimestamp: string
    observedAtMs: number
  }>
  frameGaps: Array<{ phase: Phase; gapMs: number }>
  frameTail: { phase: Phase; gapMs: number } | null
  currentFixOverflowCount: number
  frameGapOverflowCount: number
}

/** Creates a deterministic external-source and renderer-CDP boundary. */
function createProbeHarness() {
  let nowMs = 10_000
  let sequence = 0
  let drainCount = 0
  let overflowCount = 0
  let activePhase: Phase | null = null
  let sourceEntries: SourceEntry[] = []
  let rendererPhaseDelayMs = 0
  let rendererFrameTailDelayMs = 0
  let watchdogStopDelayMs = 0
  let watchdogStopCount = 0
  let watchdogStopSettled = false
  let rendererCollectionFailure: Error | null = null
  let rendererSnapshot: RendererSnapshot = {
    currentFixes: [],
    frameGaps: [],
    frameTail: null,
    currentFixOverflowCount: 0,
    frameGapOverflowCount: 0,
  }
  let watchdogInput: {
    onMainGap: (phase: Phase, gapMs: number, countSample?: boolean) => void
    onRendererSnapshot: (snapshot: RendererSnapshot) => void
  } | null = null
  const mockServer = {
    deviceId: 991,
    setPhase: async (phase: Phase | null) => { activePhase = phase },
    drainCurrentFixLedger: () => {
      drainCount += 1
      const entries = sourceEntries
      sourceEntries = []
      const drainedOverflowCount = overflowCount
      overflowCount = 0
      return { entries, overflowCount: drainedOverflowCount }
    },
  }
  const drainRenderer = () => {
    const snapshot = rendererSnapshot
    rendererSnapshot = {
      currentFixes: [],
      frameGaps: [],
      frameTail: snapshot.frameTail,
      currentFixOverflowCount: 0,
      frameGapOverflowCount: 0,
    }
    return snapshot
  }
  const probe = createPackagedLivenessProbe(mockServer, {
    now: () => nowMs,
    delay: async () => { nowMs += 10 },
    installRendererLivenessProbe: async () => undefined,
    setRendererLivenessPhase: async (_page: unknown, phase: Phase | null) => {
      const delayedTail = rendererSnapshot.frameTail === null
        ? null
        : {
            ...rendererSnapshot.frameTail,
            gapMs: rendererSnapshot.frameTail.gapMs + rendererFrameTailDelayMs,
          }
      nowMs += rendererPhaseDelayMs
      rendererPhaseDelayMs = 0
      rendererFrameTailDelayMs = 0
      rendererSnapshot.frameTail = phase === null ? null : { phase, gapMs: 0 }
      return delayedTail
    },
    collectRendererLivenessProbe: async () => {
      if (rendererCollectionFailure !== null) {
        const failure = rendererCollectionFailure
        rendererCollectionFailure = null
        throw failure
      }
      return drainRenderer()
    },
    startExternalLaunchWatchdog: (input: typeof watchdogInput) => {
      watchdogInput = input
      return {
        stop: async () => {
          watchdogStopCount += 1
          const snapshot = drainRenderer()
          nowMs += watchdogStopDelayMs
          if (snapshot.frameTail !== null) {
            snapshot.frameTail = {
              ...snapshot.frameTail,
              gapMs: snapshot.frameTail.gapMs + watchdogStopDelayMs,
            }
          }
          input?.onRendererSnapshot(snapshot)
          watchdogStopSettled = true
        },
      }
    },
  })
  const launch = { page: {}, externalLivenessWatchdog: undefined }

  const publishRendererFix = (
    source: Pick<SourceEntry, 'phase' | 'sourcePositionId' | 'sourceTimestamp'>,
    renderedTimestamp?: string,
    renderedPhase?: Phase,
  ) => {
    if (source.phase === null) throw new Error('Test source phase is not active.')
    rendererSnapshot.currentFixes.push({
      phase: renderedPhase ?? source.phase,
      sourcePositionId: source.sourcePositionId,
      sourceTimestamp: renderedTimestamp ?? source.sourceTimestamp,
      observedAtMs: nowMs,
    })
    rendererSnapshot.frameGaps.push({ phase: source.phase, gapMs: 16 })
    watchdogInput?.onMainGap(source.phase, 50)
    watchdogInput?.onRendererSnapshot(drainRenderer())
  }

  return {
    probe,
    launch,
    emitCurrentFix: (
      rendered: boolean,
      renderedTimestamp?: string,
      renderedPhase?: Phase,
    ) => {
      if (activePhase === null) throw new Error('Test source phase is not active.')
      sequence += 1
      const sourcePositionId = `source-${sequence}`
      const sourceTimestamp = new Date(nowMs).toISOString()
      const source = {
        sequence,
        phase: activePhase,
        sourcePositionId,
        sourceTimestamp,
        requestStartedAtMs: nowMs,
        emittedAtMs: nowMs,
      }
      sourceEntries.push(source)
      nowMs += 10
      if (rendered) {
        publishRendererFix(source, renderedTimestamp, renderedPhase)
      } else {
        rendererSnapshot.frameGaps.push({ phase: activePhase, gapMs: 16 })
        watchdogInput?.onMainGap(activePhase, 50)
        watchdogInput?.onRendererSnapshot(drainRenderer())
      }
      return source
    },
    queueCorrelatedCurrentFix: () => {
      if (activePhase === null) throw new Error('Test source phase is not active.')
      sequence += 1
      const sourcePositionId = `source-${sequence}`
      const sourceTimestamp = new Date(nowMs).toISOString()
      const source = {
        sequence,
        phase: activePhase,
        sourcePositionId,
        sourceTimestamp,
        requestStartedAtMs: nowMs,
        emittedAtMs: nowMs,
      }
      sourceEntries.push(source)
      nowMs += 10
      rendererSnapshot.currentFixes.push({
        phase: activePhase,
        sourcePositionId,
        sourceTimestamp,
        observedAtMs: nowMs,
      })
      rendererSnapshot.frameGaps.push({ phase: activePhase, gapMs: 16 })
      nowMs += 1
      return source
    },
    publishRendererFix,
    publishRendererSnapshot: (snapshot: unknown) => {
      watchdogInput?.onRendererSnapshot(snapshot as RendererSnapshot)
    },
    queueRendererFrameTail: (phase: Phase, gapMs: number) => {
      rendererSnapshot.frameTail = { phase, gapMs }
    },
    publishWatchdogTick: () => {
      if (activePhase === null) throw new Error('Test source phase is not active.')
      rendererSnapshot.frameGaps.push({ phase: activePhase, gapMs: 16 })
      watchdogInput?.onMainGap(activePhase, 50)
      watchdogInput?.onRendererSnapshot(drainRenderer())
    },
    advanceClock: (milliseconds: number) => { nowMs += milliseconds },
    reportLedgerOverflow: () => { overflowCount += 1 },
    delayNextRendererPhase: (milliseconds: number, frameTailMilliseconds = milliseconds) => {
      rendererPhaseDelayMs = milliseconds
      rendererFrameTailDelayMs = frameTailMilliseconds
    },
    delayWatchdogStop: (milliseconds: number) => { watchdogStopDelayMs = milliseconds },
    failNextRendererCollection: (error: Error) => { rendererCollectionFailure = error },
    watchdogStopCount: () => watchdogStopCount,
    watchdogStopSettled: () => watchdogStopSettled,
    pendingSourceCount: () => sourceEntries.length,
    drainCount: () => drainCount,
  }
}

describe('packaged archive-lifecycle liveness operation gates [DON-252 / BCP-15]', () => {
  it('starts current-fix continuity after the initial renderer observer is armed', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    harness.delayNextRendererPhase(200, 0)

    await expect(harness.probe.setPhase('create')).resolves.toBeUndefined()
    harness.emitCurrentFix(true)
    await expect(harness.probe.waitForPhaseSample('create', 100)).resolves.toBeUndefined()
  })

  it('rejects a pre-operation sample and requires a fresh MapLibre fix in every phase', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)

    for (const phase of PHASES) {
      await harness.probe.setPhase(phase)
      harness.emitCurrentFix(true)
      await harness.probe.waitForPhaseSample(phase, 100)

      const staleCheckpoint = await harness.probe.beginPhaseOperation(phase)
      await harness.probe.guardOperation(Promise.resolve(), staleCheckpoint)
      harness.emitCurrentFix(true)
      await expect(harness.probe.completePhaseOperation(staleCheckpoint)).rejects.toThrow(
        new RegExp(`${phase} operation completed without a fresh MapLibre current fix`, 'u'),
      )

      const freshCheckpoint = await harness.probe.beginPhaseOperation(phase)
      await harness.probe.guardOperation(Promise.resolve().then(() => {
        harness.emitCurrentFix(true)
      }), freshCheckpoint)
      await expect(harness.probe.completePhaseOperation(freshCheckpoint)).resolves.toBeUndefined()
    }

    const evidence = await harness.probe.finish()
    expect(evidence).toMatchObject({
      provenance: 'packaged-electron-external-watchdog-v1',
      hardGateMs: 200,
      pollProfile: { mode: 'time-compressed-validation', intervalMs: 50 },
    })
    for (const phase of PHASES) {
      expect(evidence.byPhase[phase]).toEqual({
        sampleCount: 3,
        currentFixMaxGapMs: expect.any(Number),
        sourceToRendererMaxMs: 10,
        requestToRendererMaxMs: 10,
        mainWatchdogMaxGapMs: 50,
        rendererFrameMaxGapMs: 16,
      })
    }
  })

  it('fails a guarded operation at 200 ms when an emitted identity never reaches MapLibre', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    const operation = await harness.probe.beginPhaseOperation('create')
    harness.emitCurrentFix(false)
    expect(harness.pendingSourceCount()).toBe(0)

    const neverCompletes = new Promise<never>(() => undefined)
    const guarded = harness.probe.guardOperation(neverCompletes)
    harness.advanceClock(190)
    harness.emitCurrentFix(false)

    await expect(guarded).rejects.toThrow(/current_fix_not_observed_before_gate/u)
    expect(operation).toMatchObject({ phase: 'create' })
    expect(harness.pendingSourceCount()).toBe(0)
    expect(harness.drainCount()).toBeGreaterThan(0)
  })

  it('rejects a MapLibre identity whose propagated source timestamp changed', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    const operation = await harness.probe.beginPhaseOperation('restore')
    harness.emitCurrentFix(true, '2026-09-04T00:00:00.000Z')

    await expect(harness.probe.guardOperation(Promise.resolve(), operation)).rejects.toThrow(
      /current_fix_timestamp_identity_mismatch/u,
    )
  })

  it('attributes exact renderer observations from the external source identity during phase handoff', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    const operation = await harness.probe.beginPhaseOperation('create')
    harness.emitCurrentFix(true, undefined, 'verify')

    await expect(harness.probe.guardOperation(Promise.resolve(), operation)).resolves.toBeUndefined()
    await expect(harness.probe.completePhaseOperation(operation)).resolves.toBeUndefined()
  })

  it('rejects a fix that reaches MapLibre only after the guarded operation ended', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('verify')
    const operation = await harness.probe.beginPhaseOperation('verify')
    let finishOperation: (() => void) | undefined
    const guarded = harness.probe.guardOperation(new Promise<void>((resolve) => {
      finishOperation = resolve
    }), operation)
    const source = harness.emitCurrentFix(false)

    finishOperation?.()
    await guarded
    harness.advanceClock(1)
    harness.publishRendererFix(source)

    await expect(harness.probe.completePhaseOperation(operation)).rejects.toThrow(
      /operation completed without a fresh MapLibre current fix/u,
    )
  })

  it('accepts an exact fix observed before operation end but drained at the boundary', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('verify')
    const operation = await harness.probe.beginPhaseOperation('verify')
    harness.queueCorrelatedCurrentFix()

    await harness.probe.guardOperation(Promise.resolve(), operation)

    await expect(harness.probe.completePhaseOperation(operation)).resolves.toBeUndefined()
  })

  it('fails closed when the bounded external source ledger reports overflow', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('cleanup')
    harness.reportLedgerOverflow()

    await expect(harness.probe.waitForPhaseSample('cleanup', 100)).rejects.toThrow(
      /source_ledger_overflow/u,
    )
  })

  it.each([
    ['current-fix', { currentFixOverflowCount: 1, frameGapOverflowCount: 0 }, /renderer_current_fix_ledger_overflow/u],
    ['frame-gap', { currentFixOverflowCount: 0, frameGapOverflowCount: 1 }, /renderer_frame_gap_ledger_overflow/u],
  ])('fails closed when the renderer %s ledger overflows', async (_label, overflow, expected) => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('cleanup')
    harness.publishRendererSnapshot({
      currentFixes: [],
      frameGaps: [],
      frameTail: { phase: 'cleanup', gapMs: 0 },
      ...overflow,
    })

    await expect(harness.probe.waitForPhaseSample('cleanup', 100)).rejects.toThrow(expected)
  })

  it('rejects a renderer drain snapshot without both bounded-ledger counters', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('verify')
    harness.publishRendererSnapshot({
      currentFixes: [],
      frameGaps: [],
      frameTail: { phase: 'verify', gapMs: 0 },
    })

    await expect(harness.probe.waitForPhaseSample('verify', 100)).rejects.toThrow(
      /renderer_liveness_snapshot_invalid/u,
    )
  })

  it('rejects a renderer drain snapshot without an external frame-tail sample', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('verify')
    harness.publishRendererSnapshot({
      currentFixes: [],
      frameGaps: [],
      currentFixOverflowCount: 0,
      frameGapOverflowCount: 0,
    })

    await expect(harness.probe.waitForPhaseSample('verify', 100)).rejects.toThrow(
      /renderer_liveness_snapshot_invalid/u,
    )
  })

  it('attaches one bounded invalid-frame diagnostic to the liveness failure', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.publishRendererSnapshot({
      currentFixes: [],
      frameGaps: [{ phase: 'create', gapMs: -0.625 }],
      frameTail: { phase: 'create', gapMs: 0 },
      currentFixOverflowCount: 0,
      frameGapOverflowCount: 0,
    })

    const failure = await harness.probe.waitForPhaseSample('create', 100)
      .catch((error: unknown) => error) as Error & {
        archiveLifecycleDiagnostics?: Readonly<Record<string, unknown>>
      }

    expect(failure.archiveLifecycleDiagnostics).toMatchObject({
      errorKinds: ['renderer_frame_sample_invalid'],
      invalidRendererFrame: {
        phase: 'create',
        gapMs: -0.625,
        gapType: 'negative',
      },
    })
  })

  it('rethrows one stable liveness failure during cleanup finalization', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.publishRendererSnapshot({
      currentFixes: [],
      frameGaps: [{ phase: 'create', gapMs: -0.625 }],
      frameTail: { phase: 'create', gapMs: 0 },
      currentFixOverflowCount: 0,
      frameGapOverflowCount: 0,
    })
    const primaryFailure = await harness.probe.waitForPhaseSample('create', 100)
      .catch((error: unknown) => error)

    await expect(harness.probe.stop(primaryFailure)).resolves.toBeUndefined()
  })

  it('creates a new liveness failure when finalization records a new error kind', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.publishRendererSnapshot({
      currentFixes: [],
      frameGaps: [{ phase: 'create', gapMs: -0.625 }],
      frameTail: { phase: 'create', gapMs: 0 },
      currentFixOverflowCount: 0,
      frameGapOverflowCount: 0,
    })
    const primaryFailure = await harness.probe.waitForPhaseSample('create', 100)
      .catch((error: unknown) => error)

    harness.publishRendererSnapshot({})
    const evolvedFailure = await harness.probe.waitForPhaseSample('create', 100)
      .catch((error: unknown) => error) as Error & {
        archiveLifecycleDiagnostics?: { errorKinds?: string[] }
      }

    expect(evolvedFailure).not.toBe(primaryFailure)
    expect(evolvedFailure.archiveLifecycleDiagnostics?.errorKinds).toEqual([
      'renderer_frame_sample_invalid',
      'renderer_liveness_snapshot_invalid',
    ])
  })

  it('propagates a new stop-time CDP failure even when its kind was already recorded', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.failNextRendererCollection(new Error('Initial renderer CDP failure.'))
    const primaryFailure = await harness.probe.waitForPhaseSample('create', 100)
      .catch((error: unknown) => error)
    harness.failNextRendererCollection(new Error('New stop-time renderer CDP failure.'))

    const stopFailure = await harness.probe.stop(primaryFailure)
      .catch((error: unknown) => error)

    expect(stopFailure).not.toBe(primaryFailure)
    expect(stopFailure).toEqual(expect.objectContaining({
      message: expect.stringMatching(/stop.*renderer|renderer.*stop/iu),
    }))
    expect(harness.watchdogStopCount()).toBe(1)
    expect(harness.watchdogStopSettled()).toBe(true)
    expect(harness.launch.externalLivenessWatchdog).toBeUndefined()

    const replacementLaunch = { page: {}, externalLivenessWatchdog: undefined }
    await expect(harness.probe.attachLaunch(replacementLaunch)).resolves.toBeUndefined()
    await expect(harness.probe.stop(primaryFailure)).resolves.toBeUndefined()
    expect(harness.watchdogStopCount()).toBe(2)
    expect(replacementLaunch.externalLivenessWatchdog).toBeUndefined()
  })

  it('fails when exact-correlated current fixes stall for 200 ms after an initial sample', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('create', 100)

    harness.advanceClock(200)
    harness.publishWatchdogTick()

    await expect(harness.probe.waitForPhaseSample('create', 100)).rejects.toThrow(
      /current_fix_continuity_gate_breached/u,
    )
  })

  it('attaches bounded phase and clock evidence to a continuity failure', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('create', 100)
    harness.advanceClock(200)
    harness.publishWatchdogTick()

    const failure = await harness.probe.waitForPhaseSample('create', 100)
      .catch((error: unknown) => error) as Error & {
        archiveLifecycleDiagnostics?: Readonly<Record<string, unknown>>
      }
    expect(failure.archiveLifecycleDiagnostics).toMatchObject({
      errorKinds: ['current_fix_continuity_gate_breached'],
      activePhase: 'create',
      currentFixContinuity: {
        phase: 'create',
        gapMs: 200,
        intervalStartedAtMs: expect.any(Number),
        previousObservedAtMs: expect.any(Number),
        auditedAtMs: expect.any(Number),
      },
      operations: [],
    })
  })

  it('attaches bounded source-age evidence when an exact fix misses the gate', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    harness.emitCurrentFix(false)
    harness.advanceClock(190)
    harness.publishWatchdogTick()

    const failure = await harness.probe.waitForPhaseSample('restore', 100)
      .catch((error: unknown) => error) as Error & {
        archiveLifecycleDiagnostics?: Readonly<Record<string, unknown>>
      }
    expect(failure.archiveLifecycleDiagnostics).toMatchObject({
      errorKinds: [
        'current_fix_continuity_gate_breached',
        'current_fix_not_observed_before_gate',
      ],
      activePhase: 'restore',
      currentFixTimeout: {
        phase: 'restore',
        requestAgeMs: 200,
        sourceAgeMs: 200,
        auditedAtMs: expect.any(Number),
      },
      operations: [],
    })
  })

  it('fails when a phase has no first exact-correlated fix within 200 ms', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('verify')

    harness.advanceClock(200)
    harness.publishWatchdogTick()

    await expect(harness.probe.waitForPhaseSample('verify', 100)).rejects.toThrow(
      /current_fix_continuity_gate_breached/u,
    )
  })

  it('fails when consecutive exact-correlated fixes are 200 ms apart', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('cleanup')
    harness.emitCurrentFix(true)
    harness.advanceClock(190)
    harness.emitCurrentFix(true)

    await expect(harness.probe.waitForPhaseSample('cleanup', 100)).rejects.toThrow(
      /current_fix_continuity_gate_breached/u,
    )
  })

  it('includes the phase-exit tail in the current-fix continuity gate', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('cleanup')
    harness.emitCurrentFix(true)
    harness.advanceClock(200)

    await expect(harness.probe.setPhase('restore')).rejects.toThrow(
      /current_fix_continuity_gate_breached/u,
    )
  })

  it('fails on a 200 ms renderer-frame tail sampled at phase exit', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('create', 100)
    harness.queueRendererFrameTail('create', 200)

    await expect(harness.probe.setPhase('verify')).rejects.toThrow(
      /renderer_frame_gate_breached/u,
    )
  })

  it('pauses renderer attribution before a delayed watchdog teardown', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('create', 100)
    harness.delayWatchdogStop(200)

    await expect(harness.probe.detachLaunch(harness.launch)).resolves.toBeUndefined()
  })

  it('keeps phase continuity active while switching the renderer observer', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    harness.delayNextRendererPhase(200, 0)

    await expect(harness.probe.setPhase('verify')).rejects.toThrow(
      /current_fix_continuity_gate_breached/u,
    )
  })

  it('does not split one strict cross-phase current-fix gap into passing tails', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('create', 100)
    harness.delayNextRendererPhase(100, 0)

    await harness.probe.setPhase('verify')
    harness.advanceClock(90)
    harness.emitCurrentFix(true)

    await expect(harness.probe.waitForPhaseSample('verify', 100)).rejects.toThrow(
      /current_fix_continuity_gate_breached/u,
    )
  })

  it('fails when the atomic renderer phase switch exposes a strict 200 ms old-phase tail', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('create', 100)
    harness.queueRendererFrameTail('create', 30)
    harness.delayNextRendererPhase(170)

    await expect(harness.probe.setPhase('verify')).rejects.toThrow(
      /renderer_frame_gate_breached/u,
    )
  })

  it('includes the operation tail in the current-fix continuity gate', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    const operation = await harness.probe.beginPhaseOperation('restore')
    let finishOperation: (() => void) | undefined
    const guarded = harness.probe.guardOperation(new Promise<void>((resolve) => {
      finishOperation = resolve
    }), operation)
    harness.emitCurrentFix(true)
    harness.advanceClock(200)
    finishOperation?.()

    await expect(guarded).rejects.toThrow(/current_fix_continuity_gate_breached/u)
  })

  it('fails on a 200 ms renderer-frame tail sampled at operation exit', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('restore', 100)
    const operation = await harness.probe.beginPhaseOperation('restore')
    let finishOperation: (() => void) | undefined
    const guarded = harness.probe.guardOperation(new Promise<void>((resolve) => {
      finishOperation = resolve
    }), operation)
    harness.emitCurrentFix(true)
    harness.queueRendererFrameTail('restore', 200)
    finishOperation?.()

    await expect(guarded).rejects.toThrow(/renderer_frame_gate_breached/u)
  })

  it('requires a fresh restore fix for a review started after cleanup', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('cleanup')
    const cleanup = await harness.probe.beginPhaseOperation('cleanup')
    await harness.probe.guardOperation(Promise.resolve().then(() => {
      harness.emitCurrentFix(true)
    }), cleanup)
    await harness.probe.completePhaseOperation(cleanup)

    await harness.probe.setPhase('restore')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('restore', 100)
    const review = await harness.probe.beginPhaseOperation('restore')
    await harness.probe.guardOperation(Promise.resolve(), review)
    harness.emitCurrentFix(true)

    await expect(harness.probe.completePhaseOperation(review)).rejects.toThrow(
      /restore operation completed without a fresh MapLibre current fix/u,
    )
  })
})

describe('packaged renderer liveness ledger bounds [DON-252 / BCP-15]', () => {
  it('records the active main-process phase tail before suppressing teardown work', async () => {
    let evaluationCount = 0
    let secondEvaluationStarted: (() => void) | undefined
    const secondEvaluation = new Promise<void>((resolve) => {
      secondEvaluationStarted = resolve
    })
    const mainGaps: Array<{ phase: Phase; gapMs: number; countSample: boolean }> = []
    const errors: string[] = []
    const emptySnapshot: RendererSnapshot = {
      currentFixes: [],
      frameGaps: [],
      frameTail: null,
      currentFixOverflowCount: 0,
      frameGapOverflowCount: 0,
    }
    const watchdog = startExternalLaunchWatchdog({
      launch: {
        mainInspector: {
          evaluate: () => {
            evaluationCount += 1
            if (evaluationCount === 1) return Promise.resolve(1)
            secondEvaluationStarted?.()
            return new Promise(() => undefined)
          },
        },
        page: { evaluate: () => Promise.resolve(emptySnapshot) },
      },
      readPhase: () => 'restore',
      onMainGap: (phase: Phase, gapMs: number, countSample = true) => {
        mainGaps.push({ phase, gapMs, countSample })
      },
      onRendererSnapshot: () => undefined,
      onError: (error: string) => errors.push(error),
    })

    await secondEvaluation
    await new Promise((resolve) => setTimeout(resolve, 160))
    await watchdog.stop()

    expect(errors).toEqual([])
    expect(mainGaps).toContainEqual({
      phase: 'restore',
      gapMs: expect.any(Number),
      countSample: false,
    })
    expect(mainGaps.findLast((gap) => gap.countSample === false)?.gapMs)
      .toBeGreaterThanOrEqual(200)
  })

  it('drops in-flight active-phase samples after watchdog teardown begins', async () => {
    let resolveMain: ((value: unknown) => void) | undefined
    let resolveRenderer: ((value: RendererSnapshot) => void) | undefined
    let rendererCollectionCount = 0
    const finalSnapshot: RendererSnapshot = {
      currentFixes: [],
      frameGaps: [],
      frameTail: null,
      currentFixOverflowCount: 0,
      frameGapOverflowCount: 0,
    }
    const onMainGap = vi.fn()
    const onRendererSnapshot = vi.fn()
    const watchdog = startExternalLaunchWatchdog({
      launch: {
        mainInspector: {
          evaluate: () => new Promise((resolve) => { resolveMain = resolve }),
        },
        page: {
          evaluate: () => {
            rendererCollectionCount += 1
            if (rendererCollectionCount === 1) {
              return new Promise((resolve) => { resolveRenderer = resolve })
            }
            return Promise.resolve(finalSnapshot)
          },
        },
      },
      readPhase: () => 'restore',
      onMainGap,
      onRendererSnapshot,
      onError: vi.fn(),
    })

    expect(resolveMain).toBeTypeOf('function')
    expect(resolveRenderer).toBeTypeOf('function')
    const stopped = watchdog.stop()
    resolveMain?.(1)
    resolveRenderer?.({
      ...finalSnapshot,
      frameTail: { phase: 'restore', gapMs: 250 },
    })
    await stopped

    expect(onMainGap.mock.calls.filter((call) => call[2] !== false)).toHaveLength(0)
    expect(onRendererSnapshot).toHaveBeenCalledTimes(1)
    expect(onRendererSnapshot).toHaveBeenCalledWith(finalSnapshot)
  })

  it('caps both renderer ledgers and externally samples the undrained frame tail', async () => {
    const source = {
      setData: (value: unknown) => { void value },
      updateData: (value: unknown) => { void value },
    }
    let nextFrame: FrameRequestCallback | null = null
    let frameId = 0
    const fakeWindow = {
      __SARTRACKER_MAP__: { getSource: () => source },
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        nextFrame = callback
        frameId += 1
        return frameId
      },
      cancelAnimationFrame: (id: number) => { void id },
    } as unknown as Window & {
      __SARTRACKER_ARCHIVE_LIVENESS__?: {
        setPhase: (phase: Phase | null) => { phase: Phase; gapMs: number } | null
        drain: () => RendererSnapshot
        cleanup: () => void
      }
    }
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    let rendererNow = 1_000
    const performanceNow = vi.spyOn(performance, 'now').mockImplementation(() => rendererNow)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: fakeWindow,
    })
    const page = {
      waitForFunction: async (callback: () => unknown) => {
        if (callback() !== true) throw new Error('Fake MapLibre source was unavailable.')
      },
      evaluate: async <TArgument, TResult>(
        callback: (argument: TArgument) => TResult,
        argument: TArgument,
      ) => callback(argument),
    }

    try {
      await installRendererLivenessProbe(page, 991)
      fakeWindow.__SARTRACKER_ARCHIVE_LIVENESS__?.setPhase('create')
      const queuedFrame = nextFrame
      if (queuedFrame === null) throw new Error('Renderer frame callback was unavailable.')
      queuedFrame(rendererNow - 0.625)
      expect(fakeWindow.__SARTRACKER_ARCHIVE_LIVENESS__?.drain()).toMatchObject({
        frameGaps: [{ phase: 'create', gapMs: 0 }],
      })
      for (let index = 0; index < 258; index += 1) {
        source.setData({
          features: [{
            properties: {
              featureKind: 'device',
              deviceId: '991',
              sourcePositionId: `source-${index}`,
              timestamp: new Date(10_000 + index).toISOString(),
            },
          }],
        })
        const callback = nextFrame
        if (callback === null) throw new Error('Renderer frame callback was unavailable.')
        rendererNow += 16
        callback(rendererNow)
      }

      const first = fakeWindow.__SARTRACKER_ARCHIVE_LIVENESS__?.drain()
      expect(first).toMatchObject({
        currentFixOverflowCount: 2,
        frameGapOverflowCount: 2,
      })
      expect(first?.currentFixes).toHaveLength(256)
      expect(first?.frameGaps).toHaveLength(256)
      expect(fakeWindow.__SARTRACKER_ARCHIVE_LIVENESS__?.drain()).toEqual({
        currentFixes: [],
        frameGaps: [],
        frameTail: { phase: 'create', gapMs: 0 },
        currentFixOverflowCount: 0,
        frameGapOverflowCount: 0,
      })
      rendererNow += 200
      expect(fakeWindow.__SARTRACKER_ARCHIVE_LIVENESS__?.setPhase('verify')).toEqual({
        phase: 'create',
        gapMs: 200,
      })
      expect(fakeWindow.__SARTRACKER_ARCHIVE_LIVENESS__?.drain()).toMatchObject({
        frameTail: { phase: 'verify', gapMs: 200 },
      })
      rendererNow += 25
      expect(fakeWindow.__SARTRACKER_ARCHIVE_LIVENESS__?.setPhase(null)).toEqual({
        phase: 'verify',
        gapMs: 225,
      })
      expect(fakeWindow.__SARTRACKER_ARCHIVE_LIVENESS__?.drain()).toMatchObject({
        frameTail: null,
      })
      fakeWindow.__SARTRACKER_ARCHIVE_LIVENESS__?.cleanup()
    } finally {
      performanceNow.mockRestore()
      if (originalWindow === undefined) delete (globalThis as { window?: Window }).window
      else Object.defineProperty(globalThis, 'window', originalWindow)
    }
  })
})
