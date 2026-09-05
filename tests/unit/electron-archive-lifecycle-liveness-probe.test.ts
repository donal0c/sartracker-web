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
  currentFixTail: { phase: Phase; gapMs: number } | null
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
  let rendererPhaseAction: (() => void) | null = null
  let rendererPhaseGate: Promise<void> | null = null
  let releaseRendererPhase: (() => void) | null = null
  let rendererPhaseStarted: (() => void) | null = null
  let appliedRendererPhase: Phase | null = null
  let rendererFrameTailDelayMs = 0
  let watchdogStopDelayMs = 0
  let watchdogStopFailure: Error | null = null
  let watchdogStopCount = 0
  let watchdogStopSettled = false
  let rendererCollectionCount = 0
  const rendererCollectionDelaysMs: number[] = []
  let rendererCollectionFailure: Error | null = null
  let rendererCollectionGate: Promise<void> | null = null
  let rendererCollectionAction: (() => void) | null = null
  let rendererCollectionAfterAction: (() => void) | null = null
  let releaseRendererCollection: (() => void) | null = null
  let rendererCollectionStarted: (() => void) | null = null
  let reportedSourceSequence: number | null = null
  let nextDelayAction: (() => void) | null = null
  let rendererSnapshot: RendererSnapshot = {
    currentFixes: [],
    frameGaps: [],
    frameTail: null,
    currentFixTail: null,
    currentFixOverflowCount: 0,
    frameGapOverflowCount: 0,
  }
  let watchdogInput: {
    onMainGap: (phase: Phase, gapMs: number, countSample?: boolean) => void
    onRendererSnapshot: (snapshot: RendererSnapshot) => void
    collectRendererSnapshot?: (
      cleanup?: boolean,
      shouldRecord?: () => boolean,
    ) => Promise<void>
  } | null = null
  const mockServer = {
    deviceId: 991,
    setPhase: async (phase: Phase | null) => { activePhase = phase },
    readCurrentFixSequence: () => reportedSourceSequence ?? sequence,
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
      currentFixTail: snapshot.currentFixTail,
      currentFixOverflowCount: 0,
      frameGapOverflowCount: 0,
    }
    return snapshot
  }
  const probe = createPackagedLivenessProbe(mockServer, {
    now: () => nowMs,
    delay: async () => {
      nowMs += 10
      const action = nextDelayAction
      nextDelayAction = null
      action?.()
    },
    installRendererLivenessProbe: async () => undefined,
    setRendererLivenessPhase: async (_page: unknown, phase: Phase | null) => {
      const delayedTail = rendererSnapshot.frameTail === null
        ? null
        : {
            ...rendererSnapshot.frameTail,
            gapMs: rendererSnapshot.frameTail.gapMs + rendererFrameTailDelayMs,
          }
      const phaseAction = rendererPhaseAction
      rendererPhaseAction = null
      phaseAction?.()
      rendererPhaseStarted?.()
      rendererPhaseStarted = null
      if (rendererPhaseGate !== null) await rendererPhaseGate
      nowMs += rendererPhaseDelayMs
      rendererPhaseDelayMs = 0
      rendererFrameTailDelayMs = 0
      rendererSnapshot.frameTail = phase === null ? null : { phase, gapMs: 0 }
      rendererSnapshot.currentFixTail = null
      appliedRendererPhase = phase
      return delayedTail
    },
    collectRendererLivenessProbe: async () => {
      rendererCollectionCount += 1
      if (rendererCollectionFailure !== null) {
        const failure = rendererCollectionFailure
        rendererCollectionFailure = null
        throw failure
      }
      const collectionAction = rendererCollectionAction
      rendererCollectionAction = null
      collectionAction?.()
      const snapshot = drainRenderer()
      rendererCollectionStarted?.()
      rendererCollectionStarted = null
      const collectionDelayMs = rendererCollectionDelaysMs.shift() ?? 0
      if (collectionDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, collectionDelayMs))
      }
      if (rendererCollectionGate !== null) await rendererCollectionGate
      const collectionAfterAction = rendererCollectionAfterAction
      rendererCollectionAfterAction = null
      collectionAfterAction?.()
      return snapshot
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
          if (watchdogStopFailure !== null) throw watchdogStopFailure
        },
      }
    },
  })
  const launch = { page: {}, externalLivenessWatchdog: undefined }

  const queueRendererFix = (
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
    rendererSnapshot.currentFixTail = { phase: source.phase, gapMs: 0 }
    rendererSnapshot.frameGaps.push({ phase: source.phase, gapMs: 16 })
  }

  const publishRendererFix = (
    source: Pick<SourceEntry, 'phase' | 'sourcePositionId' | 'sourceTimestamp'>,
    renderedTimestamp?: string,
    renderedPhase?: Phase,
  ) => {
    queueRendererFix(source, renderedTimestamp, renderedPhase)
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
      advanceMs = 10,
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
      nowMs += advanceMs
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
      rendererSnapshot.currentFixTail = { phase: activePhase, gapMs: 0 }
      rendererSnapshot.frameGaps.push({ phase: activePhase, gapMs: 16 })
      nowMs += 1
      return source
    },
    queueRendererFix,
    publishRendererFix,
    publishRendererSnapshot: (snapshot: unknown) => {
      watchdogInput?.onRendererSnapshot(snapshot as RendererSnapshot)
    },
    queueRendererFrameTail: (phase: Phase, gapMs: number) => {
      rendererSnapshot.frameTail = { phase, gapMs }
    },
    queueRendererCurrentFixTail: (phase: Phase, gapMs: number) => {
      rendererSnapshot.currentFixTail = { phase, gapMs }
    },
    queueRendererFrameGap: (phase: Phase, gapMs: number) => {
      rendererSnapshot.frameGaps.push({ phase, gapMs })
    },
    publishWatchdogTick: () => {
      if (activePhase === null) throw new Error('Test source phase is not active.')
      rendererSnapshot.frameGaps.push({ phase: activePhase, gapMs: 16 })
      watchdogInput?.onMainGap(activePhase, 50)
      watchdogInput?.onRendererSnapshot(drainRenderer())
    },
    publishMainWatchdogTick: () => {
      if (activePhase === null) throw new Error('Test source phase is not active.')
      watchdogInput?.onMainGap(activePhase, 50)
    },
    advanceClock: (milliseconds: number) => { nowMs += milliseconds },
    reportLedgerOverflow: () => { overflowCount += 1 },
    delayNextRendererPhase: (milliseconds: number, frameTailMilliseconds = milliseconds) => {
      rendererPhaseDelayMs = milliseconds
      rendererFrameTailDelayMs = frameTailMilliseconds
    },
    duringNextRendererPhase: (action: () => void) => { rendererPhaseAction = action },
    holdRendererPhaseChanges: () => {
      rendererPhaseGate = new Promise<void>((resolve) => {
        releaseRendererPhase = resolve
      })
      return new Promise<void>((resolve) => { rendererPhaseStarted = resolve })
    },
    releaseRendererPhaseChanges: () => {
      rendererPhaseGate = null
      releaseRendererPhase?.()
      releaseRendererPhase = null
    },
    duringNextRendererCollection: (action: () => void) => {
      rendererCollectionAction = action
    },
    afterNextRendererCollection: (action: () => void) => {
      rendererCollectionAfterAction = action
    },
    delayWatchdogStop: (milliseconds: number) => { watchdogStopDelayMs = milliseconds },
    failWatchdogStop: (error: Error) => { watchdogStopFailure = error },
    delayNextRendererCollections: (...milliseconds: number[]) => {
      rendererCollectionDelaysMs.push(...milliseconds)
    },
    failNextRendererCollection: (error: Error) => { rendererCollectionFailure = error },
    observeNextRendererCollection: () => new Promise<void>((resolve) => {
      rendererCollectionStarted = resolve
    }),
    holdRendererCollections: () => {
      rendererCollectionGate = new Promise<void>((resolve) => {
        releaseRendererCollection = resolve
      })
      return new Promise<void>((resolve) => { rendererCollectionStarted = resolve })
    },
    releaseRendererCollections: () => {
      rendererCollectionGate = null
      releaseRendererCollection?.()
      releaseRendererCollection = null
    },
    startWatchdogRendererCollection: () => {
      if (watchdogInput?.collectRendererSnapshot === undefined) {
        throw new Error('Test watchdog renderer collector is unavailable.')
      }
      return watchdogInput.collectRendererSnapshot(false)
    },
    reportSourceSequence: (value: number | null) => { reportedSourceSequence = value },
    afterNextDelay: (action: () => void) => { nextDelayAction = action },
    watchdogStopCount: () => watchdogStopCount,
    watchdogStopSettled: () => watchdogStopSettled,
    pendingSourceCount: () => sourceEntries.length,
    drainCount: () => drainCount,
    rendererCollectionCount: () => rendererCollectionCount,
    appliedRendererPhase: () => appliedRendererPhase,
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

  it('does not let a pre-start in-flight phase sample discharge an exact operation waiter', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    const preStartSource = harness.emitCurrentFix(false)
    const operation = await harness.probe.beginPhaseOperation(
      'restore',
      'resume_interrupted_restore',
    )
    harness.publishRendererFix(preStartSource)
    await expect(
      harness.probe.waitForPhaseSample('restore', 100, operation.sampleCount + 1),
    ).resolves.toBeUndefined()
    harness.afterNextDelay(() => { harness.emitCurrentFix(true) })

    await expect(
      harness.probe.waitForOperationFreshSample(operation, 100),
    ).resolves.toBeUndefined()
    await harness.probe.guardOperation(Promise.resolve(), operation)
    await expect(harness.probe.completePhaseOperation(operation)).resolves.toBeUndefined()
  })

  it('keeps the unchanged strict continuity deadline while an exact operation waiter runs', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    const operation = await harness.probe.beginPhaseOperation(
      'restore',
      'resume_interrupted_restore',
    )
    harness.advanceClock(200)

    const failure = await harness.probe.waitForOperationFreshSample(operation, 1_000)
      .catch((error: unknown) => error) as Error & {
        archiveLifecycleDiagnostics?: {
          readonly errorKinds?: readonly string[]
          readonly operations?: ReadonlyArray<{ readonly kind?: string }>
        }
      }

    expect(failure.archiveLifecycleDiagnostics?.errorKinds).toContain(
      'current_fix_continuity_gate_breached',
    )
    expect(failure.archiveLifecycleDiagnostics?.operations).toContainEqual(
      expect.objectContaining({ kind: 'resume_interrupted_restore' }),
    )
  })

  it('names and preserves bounded diagnostics when an operation phase ends without a fresh fix', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    const operation = await harness.probe.beginPhaseOperation(
      'restore',
      'review_after_cleanup',
    )
    await harness.probe.setPhase('cleanup')

    await harness.probe.guardOperation(Promise.resolve(), operation)
    const failure = await harness.probe.completePhaseOperation(operation)
      .catch((error: unknown) => error) as Error & {
        archiveLifecycleDiagnostics?: {
          readonly errorKinds?: readonly string[]
          readonly operations?: ReadonlyArray<{
            readonly phase?: string
            readonly kind?: string
            readonly freshSampleCount?: number
          }>
        }
      }

    expect(failure.message).toContain('review_after_cleanup')
    expect(failure.message).toContain('operation_fresh_current_fix_missing')
    expect(failure.archiveLifecycleDiagnostics?.errorKinds).toContain(
      'operation_fresh_current_fix_missing',
    )
    expect(failure.archiveLifecycleDiagnostics?.operations).toContainEqual(
      expect.objectContaining({
        phase: 'restore',
        kind: 'review_after_cleanup',
        freshSampleCount: 0,
      }),
    )
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

  it('starts behind continuous pre-operation polls without requiring the global source join to be empty', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    const preOperationSources = [
      harness.emitCurrentFix(false, undefined, undefined, 50),
      harness.emitCurrentFix(false, undefined, undefined, 50),
      harness.emitCurrentFix(false, undefined, undefined, 50),
    ]

    const operation = await harness.probe.beginPhaseOperation('create')
    for (const source of preOperationSources) harness.publishRendererFix(source)
    const guarded = harness.probe.guardOperation(Promise.resolve().then(() => {
      harness.emitCurrentFix(true)
    }), operation)

    await expect(guarded).resolves.toBeUndefined()
    await expect(harness.probe.completePhaseOperation(operation)).resolves.toBeUndefined()
  })

  it('retires a pre-operation current snapshot superseded by a newer exact render', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(false, undefined, undefined, 50)

    const operation = await harness.probe.beginPhaseOperation('create')
    harness.emitCurrentFix(true)
    harness.advanceClock(140)
    harness.publishWatchdogTick()

    await expect(
      harness.probe.guardOperation(Promise.resolve(), operation),
    ).resolves.toBeUndefined()
    await expect(harness.probe.completePhaseOperation(operation)).resolves.toBeUndefined()
  })

  it('does not block completion on an in-window snapshot superseded by a newer exact render', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('verify')
    const operation = await harness.probe.beginPhaseOperation('verify')
    harness.emitCurrentFix(false, undefined, undefined, 50)
    harness.emitCurrentFix(true)

    await expect(
      harness.probe.guardOperation(Promise.resolve(), operation),
    ).resolves.toBeUndefined()
    await expect(harness.probe.completePhaseOperation(operation)).resolves.toBeUndefined()
  })

  it('does not let a later exact render forgive a superseded source at the 200 ms gate', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(false, undefined, undefined, 0)
    harness.advanceClock(199)
    harness.emitCurrentFix(true, undefined, undefined, 1)

    const failure = await harness.probe.waitForPhaseSample('create', 100)
      .catch((error: unknown) => error) as Error & {
        archiveLifecycleDiagnostics?: {
          readonly errorKinds?: readonly string[]
        }
      }
    expect(failure.archiveLifecycleDiagnostics?.errorKinds).toContain(
      'current_fix_not_observed_before_gate',
    )
  })

  it('does not count a same-millisecond pre-start source observed after the start fence', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    const preOperationSource = harness.emitCurrentFix(false, undefined, undefined, 0)

    const operation = await harness.probe.beginPhaseOperation('restore')
    harness.advanceClock(1)
    harness.publishRendererFix(preOperationSource)
    harness.advanceClock(1)
    await harness.probe.guardOperation(Promise.resolve(), operation)

    await expect(harness.probe.completePhaseOperation(operation)).rejects.toThrow(
      /restore operation completed without a fresh MapLibre current fix/u,
    )
  })

  it('joins a watchdog-owned renderer drain before taking the operation start fence', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('verify')
    harness.queueCorrelatedCurrentFix()
    const collectionStarted = harness.holdRendererCollections()
    const watchdogCollection = harness.startWatchdogRendererCollection()
    await collectionStarted

    const operationPromise = harness.probe.beginPhaseOperation('verify')
    harness.releaseRendererCollections()
    await watchdogCollection
    const operation = await operationPromise

    expect(operation).toMatchObject({ phase: 'verify', sampleCount: 1 })
  })

  it('settles only finite in-window pending sources at operation completion', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('cleanup')
    const operation = await harness.probe.beginPhaseOperation('cleanup')
    harness.advanceClock(1)
    harness.emitCurrentFix(true)
    const pendingAtEnd = harness.emitCurrentFix(false)
    await harness.probe.guardOperation(Promise.resolve(), operation)

    let postEndSource: SourceEntry | undefined
    harness.afterNextDelay(() => {
      harness.publishRendererFix(pendingAtEnd)
      postEndSource = harness.emitCurrentFix(false)
    })
    await expect(harness.probe.completePhaseOperation(operation)).resolves.toBeUndefined()
    if (postEndSource === undefined) throw new Error('Post-end source was not emitted.')
    harness.publishRendererFix(postEndSource)
  })

  it('conservatively excludes an exact same-millisecond end-boundary sample', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    const operation = await harness.probe.beginPhaseOperation('restore')
    const endBoundarySource = harness.emitCurrentFix(false, undefined, undefined, 0)
    await harness.probe.guardOperation(Promise.resolve(), operation)
    harness.publishRendererFix(endBoundarySource)

    await expect(harness.probe.completePhaseOperation(operation)).rejects.toThrow(
      /restore operation completed without a fresh MapLibre current fix/u,
    )
  })

  it('accepts a causally post-start sample with the same millisecond timestamp', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    const operation = await harness.probe.beginPhaseOperation('restore')

    harness.emitCurrentFix(true, undefined, undefined, 0)
    await harness.probe.guardOperation(Promise.resolve(), operation)

    await expect(harness.probe.completePhaseOperation(operation)).resolves.toBeUndefined()
  })

  it('expires an in-window pending source at its original 200 ms deadline during completion', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('cleanup')
    const operation = await harness.probe.beginPhaseOperation('cleanup')
    harness.advanceClock(1)
    harness.emitCurrentFix(true)
    harness.emitCurrentFix(false, undefined, undefined, 1)
    await harness.probe.guardOperation(Promise.resolve(), operation)
    harness.advanceClock(189)

    await expect(harness.probe.completePhaseOperation(operation)).rejects.toThrow(
      /current_fix_not_observed_before_gate/u,
    )
  })

  it('bounds and poisons a never-settling serialized renderer collection', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('verify')
    harness.queueCorrelatedCurrentFix()
    const sourceDrainCountBeforeTimeout = harness.drainCount()
    const rendererCollectionCountBeforeTimeout = harness.rendererCollectionCount()
    const collectionStarted = harness.holdRendererCollections()
    const startedAt = performance.now()
    const operation = harness.probe.beginPhaseOperation('verify')
    await collectionStarted

    await expect(operation).rejects.toThrow(/renderer_cdp_watchdog_failed/u)
    expect(performance.now() - startedAt).toBeLessThan(1_000)
    expect(harness.rendererCollectionCount()).toBe(rendererCollectionCountBeforeTimeout + 1)
    await expect(harness.probe.beginPhaseOperation('verify')).rejects.toThrow(
      /renderer_cdp_watchdog_failed/u,
    )
    expect(harness.rendererCollectionCount()).toBe(rendererCollectionCountBeforeTimeout + 1)
    harness.releaseRendererCollections()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.probe.phaseSampleCount('verify')).toBe(0)
    expect(harness.drainCount()).toBe(sourceDrainCountBeforeTimeout)
    expect(harness.pendingSourceCount()).toBe(1)
  })

  it('poisons renderer evidence when a timed-out phase request settles late', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('create', 100)
    const phaseRequestStarted = harness.holdRendererPhaseChanges()
    const transition = harness.probe.setPhase('verify')
    await phaseRequestStarted

    const failure = await transition.catch((error: unknown) => error) as Error & {
      archiveLifecycleDiagnostics?: { readonly errorKinds?: readonly string[] }
    }
    expect(failure.archiveLifecycleDiagnostics?.errorKinds).toContain(
      'renderer_cdp_watchdog_failed',
    )
    const collectionCountAtTimeout = harness.rendererCollectionCount()
    harness.releaseRendererPhaseChanges()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.appliedRendererPhase()).toBe('verify')

    await expect(harness.probe.setPhase('restore')).rejects.toThrow(
      /renderer_cdp_watchdog_failed/u,
    )
    expect(harness.rendererCollectionCount()).toBe(collectionCountAtTimeout)
  })

  it('fails closed when the external source sequence fence regresses', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.beginPhaseOperation('create')
    harness.reportSourceSequence(0)

    await expect(harness.probe.beginPhaseOperation('create')).rejects.toThrow(
      /source_sequence_fence_invalid/u,
    )
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

  it('fails closed when exact renderer acknowledgements regress within one drain', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    const first = harness.emitCurrentFix(false)
    const second = harness.emitCurrentFix(false)
    harness.publishRendererSnapshot({
      currentFixes: [second, first].map((source) => ({
        phase: 'restore' as const,
        sourcePositionId: source.sourcePositionId,
        sourceTimestamp: source.sourceTimestamp,
        observedAtMs: 10_020,
      })),
      frameGaps: [],
      frameTail: null,
      currentFixTail: null,
      currentFixOverflowCount: 0,
      frameGapOverflowCount: 0,
    })

    await expect(harness.probe.waitForPhaseSample('restore', 100)).rejects.toThrow(
      /renderer_current_fix_sequence_regressed/u,
    )
  })

  it('fails closed when a superseded acknowledgement arrives in a later drain', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    const superseded = harness.emitCurrentFix(false)
    harness.emitCurrentFix(true)
    harness.publishRendererFix(superseded)

    await expect(harness.probe.waitForPhaseSample('restore', 100)).rejects.toThrow(
      /renderer_current_fix_sequence_regressed/u,
    )
  })

  it('fails closed when an older exact acknowledgement repeats after a newer one', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    const first = harness.emitCurrentFix(true)
    harness.emitCurrentFix(true)
    harness.publishRendererFix(first)

    await expect(harness.probe.waitForPhaseSample('restore', 100)).rejects.toThrow(
      /renderer_current_fix_sequence_regressed/u,
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
      currentFixTail: null,
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
      currentFixTail: null,
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
      currentFixTail: null,
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
      currentFixTail: null,
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

  it('classifies a watchdog teardown rejection as renderer CDP failure', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('create', 100)
    harness.failWatchdogStop(new Error('Final renderer cleanup failed.'))

    const failure = await harness.probe.detachLaunch(harness.launch)
      .catch((error: unknown) => error) as Error & {
        archiveLifecycleDiagnostics?: { readonly errorKinds?: readonly string[] }
      }

    expect(failure.archiveLifecycleDiagnostics?.errorKinds).toContain(
      'renderer_cdp_watchdog_failed',
    )
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

  it('does not let a main-watchdog tick overtake an already stamped renderer fix', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('restore', 100)

    harness.advanceClock(188)
    const rendererCollectionStarted = harness.holdRendererCollections()
    harness.queueCorrelatedCurrentFix()
    const rendererCollection = harness.startWatchdogRendererCollection()
    await rendererCollectionStarted
    harness.advanceClock(18)
    harness.publishMainWatchdogTick()
    harness.releaseRendererCollections()
    await rendererCollection

    await expect(
      harness.probe.waitForPhaseSample('restore', 100, 2),
    ).resolves.toBeUndefined()
  })

  it('fails at the exact 200 ms boundary observed through a serialized renderer drain', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('restore', 100)

    harness.advanceClock(200)
    await harness.startWatchdogRendererCollection()

    await expect(harness.probe.waitForPhaseSample('restore', 100)).rejects.toThrow(
      /current_fix_continuity_gate_breached/u,
    )
  })

  it('fails closed when renderer request-start watermarks regress', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('restore', 100)

    harness.advanceClock(-1)
    await harness.startWatchdogRendererCollection()

    await expect(harness.probe.waitForPhaseSample('restore', 100)).rejects.toThrow(
      /external_watchdog_clock_invalid/u,
    )
  })

  it('attaches bounded phase and clock evidence to a continuity failure', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('create', 100)
    harness.advanceClock(200)
    harness.queueRendererCurrentFixTail('create', 200)
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
      rendererCurrentFixMonotonicTail: {
        phase: 'create',
        gapMs: 200,
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
      sourceCadence: {
        latestReceivedSequence: 1,
        latestAcknowledgedSequence: 0,
        pendingCount: 0,
        latestRequestAgeMs: 200,
        latestSourceAgeMs: 200,
        oldestPendingRequestAgeMs: null,
        oldestPendingSourceAgeMs: null,
      },
      operations: [],
    })
  })

  it('names the exact active archive operation in failure diagnostics', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    const operation = await harness.probe.beginPhaseOperation(
      'restore',
      'review_before_cleanup',
    )
    harness.advanceClock(200)
    harness.publishWatchdogTick()

    const failure = await harness.probe.guardOperation(
      Promise.resolve(),
      operation,
    ).catch((error: unknown) => error) as Error & {
      archiveLifecycleDiagnostics?: Readonly<Record<string, unknown>>
    }
    expect(failure.archiveLifecycleDiagnostics).toMatchObject({
      operations: [{
        phase: 'restore',
        kind: 'review_before_cleanup',
        startedAtMs: expect.any(Number),
      }],
    })
  })

  it('rejects sparse operation-kind arrays before opening a checkpoint', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')

    await expect(harness.probe.beginPhaseOperations(
      ['create'],
      new Array<string>(1),
    )).rejects.toThrow('operation phases are invalid')

    await harness.probe.stop()
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

  it('does not credit an operation for a fix observed after its phase was paused', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('restore', 100)
    const operation = await harness.probe.beginPhaseOperation('restore')
    const pendingSource = harness.emitCurrentFix(false)
    harness.afterNextDelay(() => { harness.publishRendererFix(pendingSource) })

    await harness.probe.detachLaunch(harness.launch)
    await harness.probe.guardOperation(Promise.resolve(), operation)

    await expect(harness.probe.completePhaseOperation(operation)).rejects.toThrow(
      /restore operation completed without a fresh MapLibre current fix/u,
    )
  })

  it('does not extend a paused continuity interval with a later settled fix', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('restore', 100)
    harness.advanceClock(180)
    const pendingSource = harness.emitCurrentFix(false, undefined, undefined, 1)
    harness.afterNextDelay(() => {
      harness.advanceClock(10)
      harness.publishRendererFix(pendingSource)
    })

    await expect(harness.probe.detachLaunch(harness.launch)).resolves.toBeUndefined()
  })

  it('retains a strict frame-gap breach drained while the renderer is paused', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('restore')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('restore', 100)
    let periodicCollection: Promise<unknown> | undefined
    harness.duringNextRendererPhase(() => {
      harness.queueRendererFrameGap('restore', 200)
      harness.delayNextRendererCollections(120)
      periodicCollection = harness.startWatchdogRendererCollection().catch((error) => error)
    })

    const failure = await harness.probe.detachLaunch(harness.launch)
      .catch((error: unknown) => error) as Error & {
        archiveLifecycleDiagnostics?: { readonly errorKinds?: readonly string[] }
      }
    await periodicCollection

    expect(failure.archiveLifecycleDiagnostics?.errorKinds).toContain(
      'renderer_frame_gate_breached',
    )
    await expect(harness.probe.stop(failure)).resolves.toBeUndefined()
    expect(harness.watchdogStopSettled()).toBe(true)
    expect(harness.launch.externalLivenessWatchdog).toBeUndefined()
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

  it('does not let phase handoff overtake an already stamped renderer fix', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('create', 100)

    harness.advanceClock(178)
    harness.duringNextRendererPhase(() => { harness.queueCorrelatedCurrentFix() })
    harness.delayNextRendererPhase(30, 0)

    await expect(harness.probe.setPhase('verify')).resolves.toBeUndefined()
  })

  it('times a queued phase-fence drain from acquisition rather than enqueue', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('create', 100)
    harness.delayNextRendererCollections(120, 120)
    const firstCollectionStarted = harness.observeNextRendererCollection()
    const periodicCollection = harness.startWatchdogRendererCollection()
    await firstCollectionStarted

    const transition = harness.probe.setPhase('verify')

    await periodicCollection
    await expect(transition).resolves.toBeUndefined()
  })

  it('coalesces a periodic drain queued during the exclusive phase fence', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('create', 100)
    let queuedCollection: Promise<void> | undefined
    let queuedCollectionSettled = false
    let signalTransitionCollectionStarted: (() => void) | undefined
    const transitionCollectionStarted = new Promise<void>((resolve) => {
      signalTransitionCollectionStarted = resolve
    })
    harness.duringNextRendererPhase(() => {
      const collectionStarted = harness.holdRendererCollections()
      void collectionStarted.then(() => signalTransitionCollectionStarted?.())
      queuedCollection = harness.startWatchdogRendererCollection()
      void queuedCollection.then(() => { queuedCollectionSettled = true })
    })

    const transition = harness.probe.setPhase('verify')
    await transitionCollectionStarted
    await Promise.resolve()
    const settledBeforeTransitionCollection = queuedCollectionSettled
    harness.releaseRendererCollections()
    await transition
    if (queuedCollection === undefined) {
      throw new Error('Periodic renderer collection was not queued.')
    }
    await queuedCollection

    expect(settledBeforeTransitionCollection).toBe(true)
  })

  it('classifies a blocked renderer-queue acquisition as watchdog failure', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('create', 100)
    let blockedCollection: Promise<unknown> | undefined
    let signalBlockedCollectionStarted: (() => void) | undefined
    const blockedCollectionStarted = new Promise<void>((resolve) => {
      signalBlockedCollectionStarted = resolve
    })
    harness.afterNextRendererCollection(() => {
      const collectionStarted = harness.holdRendererCollections()
      void collectionStarted.then(() => signalBlockedCollectionStarted?.())
      blockedCollection = harness.startWatchdogRendererCollection().catch((error) => error)
    })
    const startedAt = performance.now()

    const transition = harness.probe.setPhase('verify')
    await blockedCollectionStarted
    const failure = await transition.catch((error: unknown) => error) as Error & {
      archiveLifecycleDiagnostics?: { readonly errorKinds?: readonly string[] }
    }

    expect(performance.now() - startedAt).toBeLessThan(1_000)
    expect(failure.archiveLifecycleDiagnostics?.errorKinds).toContain(
      'renderer_cdp_watchdog_failed',
    )
    harness.releaseRendererCollections()
    await blockedCollection
  })

  it('does not credit an old-phase operation for a fix observed after the phase watermark', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('create', 100)
    const operation = await harness.probe.beginPhaseOperation('create')

    harness.duringNextRendererPhase(() => {
      const oldPhaseSource = harness.emitCurrentFix(false)
      harness.duringNextRendererCollection(() => {
        harness.advanceClock(1)
        harness.queueRendererFix(oldPhaseSource)
      })
    })

    await harness.probe.setPhase('verify')
    await harness.probe.guardOperation(Promise.resolve(), operation)

    await expect(harness.probe.completePhaseOperation(operation)).rejects.toThrow(
      /create operation completed without a fresh MapLibre current fix/u,
    )
  })

  it('credits a pre-existing new-phase operation for a fix observed after the phase watermark', async () => {
    const harness = createProbeHarness()
    await harness.probe.attachLaunch(harness.launch)
    await harness.probe.setPhase('create')
    harness.emitCurrentFix(true)
    await harness.probe.waitForPhaseSample('create', 100)
    const operation = await harness.probe.beginPhaseOperation('verify')

    harness.duringNextRendererPhase(() => {
      harness.duringNextRendererCollection(() => {
        harness.advanceClock(1)
        harness.queueCorrelatedCurrentFix()
      })
    })

    await harness.probe.setPhase('verify')
    await harness.probe.guardOperation(Promise.resolve(), operation)

    await expect(harness.probe.completePhaseOperation(operation)).resolves.toBeUndefined()
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
  it('fails closed when renderer-probe installation wedges after readiness', async () => {
    vi.useFakeTimers()
    try {
      const page = {
        waitForFunction: vi.fn(async () => undefined),
        evaluate: vi.fn(() => new Promise(() => undefined)),
      }
      const installation = installRendererLivenessProbe(page, 991, 30)
      const rejection = expect(installation).rejects.toThrow(
        'Archive-lifecycle renderer liveness probe installation timed out.',
      )

      await vi.advanceTimersByTimeAsync(31)
      await rejection
      expect(page.waitForFunction).toHaveBeenCalledTimes(1)
      expect(page.evaluate).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('forwards watchdog cancellation into the production probe collector', async () => {
    let activePhase: Phase | null = null
    let sourceSequence = 0
    let sourceEntries: SourceEntry[] = []
    let releasePeriodicCollection: (() => void) | undefined
    let markPeriodicCollectionStarted: (() => void) | undefined
    const periodicCollectionStarted = new Promise<void>((resolve) => {
      markPeriodicCollectionStarted = resolve
    })
    const periodicCollectionGate = new Promise<void>((resolve) => {
      releasePeriodicCollection = resolve
    })
    const collectionModes: boolean[] = []
    const emptySnapshot: RendererSnapshot = {
      currentFixes: [],
      frameGaps: [],
      frameTail: null,
      currentFixOverflowCount: 0,
      frameGapOverflowCount: 0,
    }
    const mockServer = {
      deviceId: 991,
      setPhase: async (phase: Phase | null) => { activePhase = phase },
      readCurrentFixSequence: () => sourceSequence,
      drainCurrentFixLedger: () => {
        const entries = sourceEntries
        sourceEntries = []
        return { entries, overflowCount: 0 }
      },
    }
    const probe = createPackagedLivenessProbe(mockServer, {
      now: () => 10_000,
      installRendererLivenessProbe: async () => undefined,
      setRendererLivenessPhase: async () => null,
      collectRendererLivenessProbe: async (_page: unknown, cleanup = false) => {
        collectionModes.push(cleanup)
        if (!cleanup && collectionModes.length === 1) {
          markPeriodicCollectionStarted?.()
          await periodicCollectionGate
          if (staleSource === undefined || staleSource.phase === null) {
            throw new Error('Stale source fixture was not ready.')
          }
          return {
            ...emptySnapshot,
            currentFixes: [{
              phase: staleSource.phase,
              sourcePositionId: staleSource.sourcePositionId,
              sourceTimestamp: staleSource.sourceTimestamp,
              observedAtMs: 10_000,
            }],
          }
        }
        return emptySnapshot
      },
    })
    const launch: {
      page: Record<string, never>
      mainInspector: { evaluate: () => Promise<number> }
      externalLivenessWatchdog?: { stop: () => Promise<void> }
    } = {
      page: {},
      mainInspector: { evaluate: () => Promise.resolve(1) },
    }

    await probe.attachLaunch(launch)
    await periodicCollectionStarted
    await probe.setPhase('create')
    if (activePhase !== 'create') throw new Error('Source phase was not armed.')
    sourceSequence += 1
    const staleSource: SourceEntry = {
      sequence: sourceSequence,
      phase: activePhase,
      sourcePositionId: `source-${sourceSequence}`,
      sourceTimestamp: new Date(10_000).toISOString(),
      requestStartedAtMs: 10_000,
      emittedAtMs: 10_000,
    }
    sourceEntries.push(staleSource)

    const stopped = launch.externalLivenessWatchdog?.stop()
    if (stopped === undefined) throw new Error('External watchdog was not attached.')
    releasePeriodicCollection?.()
    await stopped

    expect(collectionModes).toEqual([false, true])
    expect(probe.phaseSampleCount('create')).toBe(0)
  })

  it('delegates periodic and teardown drains without recording their undefined result twice', async () => {
    let releasePeriodicCollection: (() => void) | undefined
    let markPeriodicCollectionStarted: (() => void) | undefined
    const periodicCollectionStarted = new Promise<void>((resolve) => {
      markPeriodicCollectionStarted = resolve
    })
    const periodicCollectionGate = new Promise<void>((resolve) => {
      releasePeriodicCollection = resolve
    })
    const collectionModes: boolean[] = []
    const committedModes: boolean[] = []
    const pageEvaluate = vi.fn()
    const onRendererSnapshot = vi.fn()
    const onError = vi.fn()
    const watchdog = startExternalLaunchWatchdog({
      launch: {
        mainInspector: { evaluate: () => Promise.resolve(1) },
        page: { evaluate: pageEvaluate },
      },
      readPhase: () => 'create',
      onMainGap: vi.fn(),
      onRendererSnapshot,
      collectRendererSnapshot: async (cleanup = false, shouldRecord = () => true) => {
        collectionModes.push(cleanup)
        if (!cleanup) {
          markPeriodicCollectionStarted?.()
          await periodicCollectionGate
        }
        if (shouldRecord()) committedModes.push(cleanup)
      },
      onError,
    })

    await periodicCollectionStarted
    const stopped = watchdog.stop()
    releasePeriodicCollection?.()
    await stopped

    expect(collectionModes).toEqual([false, true])
    expect(committedModes).toEqual([true])
    expect(pageEvaluate).not.toHaveBeenCalled()
    expect(onRendererSnapshot).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('does not add a total watchdog timeout around independently bounded delegated work', async () => {
    let markFirstCollectionStarted: (() => void) | undefined
    let markFirstCollectionCompleted: (() => void) | undefined
    const firstCollectionStarted = new Promise<void>((resolve) => {
      markFirstCollectionStarted = resolve
    })
    const firstCollectionCompleted = new Promise<void>((resolve) => {
      markFirstCollectionCompleted = resolve
    })
    let periodicCollectionCount = 0
    const onError = vi.fn()
    const watchdog = startExternalLaunchWatchdog({
      launch: {
        mainInspector: { evaluate: () => Promise.resolve(1) },
        page: {},
      },
      readPhase: () => 'create',
      onMainGap: vi.fn(),
      onRendererSnapshot: vi.fn(),
      collectRendererSnapshot: async (cleanup = false) => {
        if (cleanup) return
        periodicCollectionCount += 1
        if (periodicCollectionCount !== 1) return
        markFirstCollectionStarted?.()
        await new Promise((resolve) => setTimeout(resolve, 110))
        await new Promise((resolve) => setTimeout(resolve, 110))
        markFirstCollectionCompleted?.()
      },
      onError,
    })

    await firstCollectionStarted
    await firstCollectionCompleted
    await new Promise((resolve) => setTimeout(resolve, 0))
    await watchdog.stop()

    expect(onError).not.toHaveBeenCalled()
  })

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
        currentFixTail: { phase: 'create', gapMs: 16 },
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
