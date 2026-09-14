import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import {
  appendBoundedDiagnostic,
  assertNoUnexpectedDiagnostics,
  createDiagnosticState,
  createSmokeDiagnosticAllowlist,
  createSmokeDeadline,
  createSmokeDeadlines,
  closeOwnedSmokeChild,
  evaluateSmokeResults,
  historyRequestCoversWindow,
  remainingSmokeTime,
  runBounded,
  stopOwnedChild,
  validateSmokeReceipt,
} from '../../build/electron-repair-train-d-smoke-lib.js'

class FakeChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly kills: NodeJS.Signals[] = []
  onKill?: (signal: NodeJS.Signals) => void

  kill(signal: NodeJS.Signals): boolean {
    this.kills.push(signal)
    this.onKill?.(signal)
    return true
  }
}

describe('Repair Train D packaged smoke gates', () => {
  it('rejects missing elapsed capture timing even for expected diagnostics [DON-254]', () => {
    const diagnostics = createDiagnosticState()
    appendBoundedDiagnostic(diagnostics, 'consoleErrors', {
      message: 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT',
      url: 'https://tile.openstreetmap.org/1/2/3.png',
    }, { phase: 'launch', type: 'console.error', source: 'renderer-console' })
    const entry = diagnostics.consoleErrors[0] as Record<string, unknown>
    delete entry.elapsedMs
    expect(() => assertNoUnexpectedDiagnostics(diagnostics)).toThrow(/diagnostic/i)
  })

  it('rejects absent teardown boundaries from otherwise passing receipts [DON-254]', () => {
    const receipt = completeReceipt()
    Reflect.deleteProperty(receipt.launches[0].close, 'requestedAt')
    expect(() => validateSmokeReceipt(receipt)).toThrow(/teardown.*timing/i)
  })
  it.each(['cooperative', 'term', 'kill'] as const)('closes an owned child after scenario exhaustion: %s', async (mode) => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    try {
      const windows = createSmokeDeadlines(1_000, 240_000, 20_000, 10_000)
      vi.setSystemTime(windows.scenarioDeadline)
      expect(remainingSmokeTime(windows.scenarioDeadline)).toBe(0)
      expect(remainingSmokeTime(windows.totalDeadline)).toBe(20_000)
      const child = new FakeChild()
      const unrelated = new FakeChild()
      child.onKill = (signal) => {
        if (mode === 'term' || signal === 'SIGKILL') {
          child.signalCode = signal
          child.emit('exit', null, signal)
        }
      }
      const close = vi.fn(async () => {
        if (mode === 'cooperative') {
          child.exitCode = 0
          child.emit('exit', 0, null)
          return
        }
        await new Promise(() => {})
      })
      const closing = closeOwnedSmokeChild(child, {
        owned: true, close,
        orderlyDeadline: windows.cleanupPreEscalationDeadline,
        deadline: windows.totalDeadline,
      })
      await vi.runAllTimersAsync()
      const result = await closing
      expect(result.exit).not.toBeNull()
      expect(child.kills).toEqual(mode === 'cooperative' ? [] : mode === 'term' ? ['SIGTERM'] : ['SIGTERM', 'SIGKILL'])
      expect(unrelated.kills).toEqual([])
      expect(Date.now()).toBeLessThanOrEqual(windows.totalDeadline)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('records exhausted cleanup immediately without spending invented time or touching another child', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(240_000)
    try {
      const child = new FakeChild()
      const unrelated = new FakeChild()
      const close = vi.fn()
      const result = await closeOwnedSmokeChild(child, {
        owned: true, close, orderlyDeadline: 230_000, deadline: 240_000,
      })
      expect(result.closeError?.message).toMatch(/deadline|budget/i)
      expect(result.exit).toBeNull()
      expect(child.kills).toEqual(['SIGKILL'])
      expect(close).not.toHaveBeenCalled()
      expect(unrelated.kills).toEqual([])
      expect(Date.now()).toBe(240_000)
      expect(vi.getTimerCount()).toBe(0)
      await expect(closeOwnedSmokeChild(unrelated, {
        owned: false, close, orderlyDeadline: 230_000, deadline: 240_000,
      })).rejects.toThrow(/non-owned/i)
      expect(unrelated.kills).toEqual([])
    } finally { vi.useRealTimers() }
  })

  it('keeps scenario and diagnostic outcomes separate while failing the overall result', () => {
    expect(evaluateSmokeResults({ aud08: 'pass', aud09: 'pass', restart: 'pass' }, 'fail')).toEqual({
      scenarioResult: 'pass',
      result: 'fail',
    })
    expect(evaluateSmokeResults({ aud08: 'pass', aud09: 'pass', restart: 'pending' }, 'pass')).toEqual({
      scenarioResult: 'pending',
      result: 'fail',
    })

    const diagnosticFailure = completeReceipt()
    diagnosticFailure.diagnosticResult = 'fail'
    diagnosticFailure.diagnosticBlockers = [{ launch: 'initial', error: 'unexpected', unexpected: {}, rawEvents: [] }]
    expect(() => validateSmokeReceipt(diagnosticFailure)).toThrow(/clean packaged diagnostics/i)

    const partialScenario = completeReceipt()
    partialScenario.scenarioResults.restart = 'pending'
    partialScenario.scenarioResult = 'pending'
    expect(() => validateSmokeReceipt(partialScenario)).toThrow(/all Train D scenarios/i)
  })

  it('keeps deadline arithmetic bounded and rejects invalid inputs', () => {
    const deadline = createSmokeDeadline(1_000, 500)
    expect(remainingSmokeTime(deadline, 1_200)).toBe(300)
    expect(remainingSmokeTime(deadline, 2_000)).toBe(0)
    expect(() => createSmokeDeadline(1_000, 0)).toThrow(/deadline input is invalid/i)
  })

  it('disposes the bounded operation timer after a fast result', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    try {
      await expect(runBounded(async () => 'complete', 1_000)).resolves.toEqual({
        completed: true,
        value: 'complete',
      })
      const timer = setTimeoutSpy.mock.results.at(-1)?.value
      expect(timer).toBeDefined()
      expect(clearTimeoutSpy).toHaveBeenCalledWith(timer)
    } finally {
      setTimeoutSpy.mockRestore()
      clearTimeoutSpy.mockRestore()
    }
  })

  it('escalates only an owned child from SIGTERM to SIGKILL inside bounded windows', async () => {
    const child = new FakeChild()
    child.onKill = (signal) => {
      if (signal === 'SIGKILL') {
        child.signalCode = signal
        queueMicrotask(() => child.emit('exit', null, signal))
      }
    }

    const result = await stopOwnedChild(child, { owned: true, termTimeoutMs: 2, killTimeoutMs: 20 })

    expect(result).toMatchObject({ exited: true, forced: true, signal: 'SIGKILL' })
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('does not invent shutdown time after the smoke deadline is exhausted', async () => {
    const child = new FakeChild()
    await expect(stopOwnedChild(child, { owned: true, termTimeoutMs: 0, killTimeoutMs: 0 }))
      .rejects.toThrow(/no remaining deadline/i)
    expect(child.kills).toEqual([])
  })

  it('fails closed when diagnostic metadata is missing or an unexpected warning is present', () => {
    expect(() => assertNoUnexpectedDiagnostics({ consoleErrors: [] })).toThrow(/metadata is missing/i)
    const diagnostics = createDiagnosticState()
    appendBoundedDiagnostic(diagnostics, 'consoleWarnings', {
      message: 'Persistence failure diagnostic could not be recorded.',
      url: 'file:///app/index.html',
    })
    expect(() => assertNoUnexpectedDiagnostics(diagnostics)).toThrow(/unexpected packaged diagnostics/i)
  })

  it('requires a blocked-resource console error to carry its exact known basemap URL', () => {
    const unrelated = createDiagnosticState()
    appendBoundedDiagnostic(unrelated, 'consoleErrors', {
      message: 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT',
      url: 'file:///app/index.html',
    })
    expect(() => assertNoUnexpectedDiagnostics(unrelated)).toThrow(/unexpected packaged diagnostics/i)

    const knownBasemap = createDiagnosticState()
    appendBoundedDiagnostic(knownBasemap, 'consoleErrors', {
      message: 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT',
      url: 'https://tile.openstreetmap.org/12/1/2.png',
    }, { phase: 'launch', type: 'console.error', source: 'renderer-console' })
    expect(assertNoUnexpectedDiagnostics(knownBasemap).unexpected.consoleErrors).toHaveLength(0)
  })

  it('aggregates expected blocked traffic while retaining every later unexpected event', () => {
    const diagnostics = createDiagnosticState()
    for (let index = 0; index < 100; index += 1) {
      appendBoundedDiagnostic(diagnostics, 'consoleErrors', {
        message: 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT',
      url: `https://tile.opentopomap.org/12/${index}/2.png`,
      at: `2026-09-13T19:00:${String(index % 60).padStart(2, '0')}.000Z`,
      }, { phase: 'startup', type: 'console.error', source: 'renderer-console' })
    }
    appendBoundedDiagnostic(diagnostics, 'consoleErrors', {
      message: 'Unexpected early renderer error.',
      url: 'file:///app/index.html',
      at: '2026-09-13T18:59:00.000Z',
    }, { phase: 'startup', type: 'console.error', source: 'renderer-console' })

    expect(diagnostics.counts.consoleErrors).toBe(101)
    expect(diagnostics.truncated.consoleErrors).toBe(true)
    expect(Object.values(diagnostics.expectedBlockedResources)
      .reduce((sum, aggregate) => sum + aggregate.count, 0)).toBe(100)
    expect(diagnostics.unexpectedEvents).toHaveLength(1)
    expect(diagnostics.unexpectedEvents[0]).toMatchObject({
      message: 'Unexpected early renderer error.',
      phase: 'startup',
      type: 'console.error',
      source: 'renderer-console',
      url: 'file:///app/index.html',
      sequence: 101,
    })
    expect(() => assertNoUnexpectedDiagnostics(diagnostics)).toThrow(/unexpected packaged diagnostics/i)
  })

  it('keeps capture order monotonic and rejects malformed append-only metadata', () => {
    const diagnostics = createDiagnosticState()
    appendBoundedDiagnostic(diagnostics, 'pageErrors', {
      message: 'first',
      at: '2026-09-13T19:00:02.000Z',
    }, { phase: 'aud08', type: 'pageerror', source: 'renderer-page' })
    appendBoundedDiagnostic(diagnostics, 'pageErrors', {
      message: 'second',
      at: '2026-09-13T19:00:01.000Z',
    }, { phase: 'aud08', type: 'pageerror', source: 'renderer-page' })
    expect(diagnostics.unexpectedEvents.map((entry) => entry.sequence)).toEqual([1, 2])
    expect(diagnostics.unexpectedEvents.map((entry) => entry.at)).toEqual([
      '2026-09-13T19:00:02.000Z',
      '2026-09-13T19:00:02.000Z',
    ])

    const malformed = createDiagnosticState()
    malformed.unexpectedEvents.push({ message: 'missing ordered metadata' })
    expect(() => assertNoUnexpectedDiagnostics(malformed)).toThrow(/unexpected diagnostic event is invalid/i)

    const outOfOrder = createDiagnosticState()
    appendBoundedDiagnostic(outOfOrder, 'pageErrors', { message: 'first' })
    appendBoundedDiagnostic(outOfOrder, 'pageErrors', { message: 'second' })
    outOfOrder.sequenceLog[1].sequence = 1
    expect(() => assertNoUnexpectedDiagnostics(outOfOrder)).toThrow(/sequence is invalid or out of order/i)

    const missingAggregate = createDiagnosticState()
    appendBoundedDiagnostic(missingAggregate, 'consoleErrors', {
      message: 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT',
      url: 'https://tile.opentopomap.org/12/1/2.png',
    }, { phase: 'launch', type: 'console.error', source: 'renderer-console' })
    missingAggregate.sequenceLog[0].aggregateKey = 'missing-aggregate'
    expect(() => assertNoUnexpectedDiagnostics(missingAggregate)).toThrow(/missing aggregate/i)
  })

  it('classifies only exact known basemap origins as expected blocked traffic', () => {
    const diagnostics = createDiagnosticState()
    appendBoundedDiagnostic(diagnostics, 'consoleErrors', {
      message: 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT',
      url: 'https://tile.opentopomap.org/12/1/2.png',
    }, { phase: 'launch', type: 'console.error', source: 'renderer-console' })
    appendBoundedDiagnostic(diagnostics, 'consoleErrors', {
      message: 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT',
      url: 'https://tile.opentopomap.org.attacker.example/12/1/2.png',
    })
    expect(Object.values(diagnostics.expectedBlockedResources)
      .reduce((sum, aggregate) => sum + aggregate.count, 0)).toBe(1)
    expect(diagnostics.unexpectedEvents).toHaveLength(1)
  })

  it('requires network blocked diagnostics to match the canonical failure text and source', () => {
    const expected = createDiagnosticState()
    appendBoundedDiagnostic(expected, 'networkFailures', {
      message: 'net::ERR_BLOCKED_BY_CLIENT',
      errorText: 'net::ERR_BLOCKED_BY_CLIENT',
      url: 'https://tile.opentopomap.org/12/1/2.png',
    }, { phase: 'launch', type: 'requestfailed', source: 'renderer-network' })
    expect(expected.unexpectedEvents).toHaveLength(0)

    const substituted = createDiagnosticState()
    appendBoundedDiagnostic(substituted, 'networkFailures', {
      message: 'Failed to fetch',
      errorText: 'net::ERR_BLOCKED_BY_CLIENT',
      url: 'https://tile.opentopomap.org/12/1/2.png',
    }, { phase: 'launch', type: 'requestfailed', source: 'renderer-network' })
    expect(() => assertNoUnexpectedDiagnostics(substituted)).toThrow(/unexpected packaged diagnostics/i)
  })

  it('keeps the deliberate device-22 history warning contextual and bounded', () => {
    const diagnostics = createDiagnosticState()
    appendBoundedDiagnostic(diagnostics, 'consoleWarnings', {
      message: 'Participant history backfill pass failed; it will retry.',
      url: 'file:///app/index.html',
    }, { phase: 'aud08', type: 'console.warning', source: 'renderer-console' })
    expect(() => assertNoUnexpectedDiagnostics(diagnostics)).toThrow(/unexpected packaged diagnostics/i)
    expect(historyRequestCoversWindow({
      deviceId: '11',
      status: 200,
      from: '2026-09-13T03:00:00.000Z',
      to: '2026-09-13T05:00:00.000Z',
    }, {
      from: '2026-09-13T03:30:00.000Z',
      to: '2026-09-13T04:30:00.000Z',
    })).toBe(true)

    const wrongContext = createDiagnosticState()
    appendBoundedDiagnostic(wrongContext, 'consoleWarnings', {
      message: 'Participant history backfill pass failed; it will retry.',
      url: 'file:///app/index.html',
    }, { phase: 'aud09', type: 'console.warning', source: 'renderer-console' })
    expect(() => assertNoUnexpectedDiagnostics(wrongContext, createSmokeDiagnosticAllowlist({
      historyHoldEvidence: {
        method: 'GET',
        path: '/api/positions',
        deviceId: '22',
        from: '2026-09-13T03:00:00.000Z',
        to: '2026-09-13T05:00:00.000Z',
        isHistory: true,
        status: 503,
      },
      providerOrigin: 'http://127.0.0.1:1234',
    }))).toThrow(/unexpected packaged diagnostics/i)
  })

  it('accepts the packaged Train D diagnostics caused by the deliberate history hold and close', () => {
    const diagnostics = createDiagnosticState()
    const context = {
      historyHoldEvidence: {
        method: 'GET',
        path: '/api/positions',
        deviceId: '22',
        from: '2026-09-13T03:00:00.000Z',
        to: '2026-09-13T05:00:00.000Z',
        isHistory: true,
        status: 503,
      },
      providerOrigin: 'http://127.0.0.1:1234',
    }
    const rendererWarning = (message: string, phase: string) => appendBoundedDiagnostic(
      diagnostics,
      'consoleWarnings',
      { message, url: 'file:///app/index.html' },
      { phase, type: 'console.warning', source: 'renderer-console' },
    )
    rendererWarning(
      'Tracking breadcrumb fetch failed for device. {deviceId: 22, deviceName: Repair Train D A, error: HTTP 503: Service Unavailable}',
      'aud08',
    )
    rendererWarning(
      'Tracking breadcrumb fetch failed for device. {deviceId: 11, deviceName: Repair Train D B, error: Mission history evidence scope closed before transport admission.}',
      'aud08',
    )
    rendererWarning(
      'Tracking breadcrumb reconciliation failed for device. {deviceId: 11, deviceName: Repair Train D B, retryDelayMs: 1000, error: Mission history evidence scope closed before transport admission.}',
      'aud08',
    )
    rendererWarning(
      'History request target could not be saved; retrieval will retry without a completeness claim. Error: Participant selection is unavailable; tracking history cannot be persisted safely.\n    at start-tracking-runtime.js:1:2',
      'aud08',
    )
    rendererWarning(
      'Tracking breadcrumb reconciliation failed for device. {deviceId: 22, deviceName: Repair Train D A, retryDelayMs: 1000, error: Participant selection is unavailable; tracking history cannot be persisted safely.}',
      'aud08',
    )
    rendererWarning(
      'Tracking breadcrumb reconciliation failed for device. {deviceId: 22, deviceName: Repair Train D A, retryDelayMs: 1000, error: HTTP 503: Service Unavailable}',
      'aud08',
    )
    rendererWarning(
      'Participant history backfill pass failed; it will retry. Error: HTTP 503: Service Unavailable\n    at start-tracking-runtime.js:1:2',
      'close',
    )
    appendBoundedDiagnostic(diagnostics, 'processStderr', {
      message: "Error occurred in handler for 'sartracker:mission-store:finish-mission': Error: Mission cannot be finished while 1 participant history backfill checkpoint(s) are incomplete. Keep the mission active and retry history backfill before finishing.",
    }, { phase: 'aud08', type: 'stderr', source: 'main-process-stderr' })
    appendBoundedDiagnostic(diagnostics, 'processStderr', {
      message: '    at finishMission (/app/electron/mission-store.cjs:5667:3)',
    }, { phase: 'aud08', type: 'stderr', source: 'main-process-stderr' })
    appendBoundedDiagnostic(diagnostics, 'processStderr', {
      message: "Error occurred in handler for 'sartracker:mission-store:sync-coverage-tile-catalog': Error: coverage-revision-moved: Coverage catalog chunk does not match its current revision.",
    }, { phase: 'aud08', type: 'stderr', source: 'main-process-stderr' })
    appendBoundedDiagnostic(diagnostics, 'processStderr', {
      message: '    at normalizeAuthorizedCoverageCatalogInput (/app/electron/mission-store.cjs:348:13)',
    }, { phase: 'aud08', type: 'stderr', source: 'main-process-stderr' })
    appendBoundedDiagnostic(diagnostics, 'processStderr', {
      message: '    at /app/electron/mission-store.cjs:2402:33',
    }, { phase: 'aud08', type: 'stderr', source: 'main-process-stderr' })
    appendBoundedDiagnostic(diagnostics, 'processStderr', {
      message: '    at /app/electron/mission-store.cjs:3351:48',
    }, { phase: 'aud08', type: 'stderr', source: 'main-process-stderr' })
    appendBoundedDiagnostic(diagnostics, 'processStderr', {
      message: 'Debugger ending on ws://127.0.0.1:39841/3986e37b-356e-480d-9960-8cd0095ac4ff',
    }, { phase: 'close', type: 'stderr', source: 'main-process-stderr' })
    appendBoundedDiagnostic(diagnostics, 'processStderr', {
      message: 'For help, see: https://nodejs.org/en/docs/inspector',
    }, { phase: 'close', type: 'stderr', source: 'main-process-stderr' })

    expect(() => assertNoUnexpectedDiagnostics(diagnostics, createSmokeDiagnosticAllowlist(context))).not.toThrow()
  })

  it('rejects a pass receipt that omits package, cleanup, or B-history evidence', () => {
    const receipt = minimalReceipt()
    expect(() => validateSmokeReceipt(receipt)).toThrow(/ASAR|history covered|profile|all Train D scenarios/i)
  })

  it('accepts a complete receipt and the narrowly contextual expected history warning', () => {
    const receipt = completeReceipt()
    appendBoundedDiagnostic(receipt.launches[0].close.diagnostics, 'consoleWarnings', {
      message: 'Participant history backfill pass failed; it will retry.',
      url: 'file:///app/index.html',
    }, { phase: 'aud08', type: 'console.warning', source: 'renderer-console' })

    expect(validateSmokeReceipt(receipt)).toBe(true)
  })

  it('binds restart participant state and the terminal cursor to the expected identities', () => {
    const wrongMission = completeReceipt()
    wrongMission.phases.restart.participant.mission.id = 'other-mission'
    expect(() => validateSmokeReceipt(wrongMission)).toThrow(/active 2\/1 participant/i)

    const wrongGroupMission = completeReceipt()
    wrongGroupMission.phases.restart.participant.participants[0].mission_id = 'other-mission'
    expect(() => validateSmokeReceipt(wrongGroupMission)).toThrow(/active 2\/1 participant/i)

    const wrongArea = completeReceipt()
    wrongArea.phases.aud09.secondPage.firstEntry.id = 'other-area'
    expect(() => validateSmokeReceipt(wrongArea)).toThrow(/continuation is incomplete/i)
  })

  it('keeps global replay generation separate from the dedicated Search Operations generation', () => {
    const receipt = completeReceipt()
    receipt.phases.aud09.readonly.live.generation = 9
    receipt.phases.aud09.readonly.backup.generation = 10
    receipt.phases.restart.readonly.live.generation = 11
    receipt.phases.restart.readonly.backup.generation = 12

    expect(validateSmokeReceipt(receipt)).toBe(true)
  })

  it('rejects a complete receipt when cleanup or backup evidence is weakened', () => {
    const cleanupFailure = completeReceipt()
    cleanupFailure.launches[1].close.exitCode = 1
    expect(() => validateSmokeReceipt(cleanupFailure)).toThrow(/close cleanly/i)

    const backupPathFailure = completeReceipt()
    backupPathFailure.phases.aud09.backupPath = '/tmp/other-profile/mission-store.backup.sqlite'
    expect(() => validateSmokeReceipt(backupPathFailure)).toThrow(/mirror evidence/i)

    const unboundedProviderFailure = completeReceipt()
    unboundedProviderFailure.provider.historyHoldEvidence.deviceId = '99'
    expect(() => validateSmokeReceipt(unboundedProviderFailure)).toThrow(/constrain/i)

    const substitutedHistoryReceipt = completeReceipt()
    substitutedHistoryReceipt.phases.aud08.automaticBackfill.successfulHistoryRequest.path = '/api/devices'
    expect(() => validateSmokeReceipt(substitutedHistoryReceipt)).toThrow(/device 11 history/i)
  })

  it('allows local dirty evidence but requires exact-head mode when CI supplies a source SHA', () => {
    const localReceipt = completeReceipt()
    localReceipt.source.dirty = true
    expect(validateSmokeReceipt(localReceipt)).toBe(true)
    expect(() => validateSmokeReceipt(localReceipt, { expectedSourceSha: 'sha' })).toThrow(/dirty/i)

    localReceipt.source.dirty = false
    expect(() => validateSmokeReceipt(localReceipt, { expectedSourceSha: 'sha' })).toThrow(/exact-head/i)
  })
})

/** Builds an intentionally incomplete receipt for fail-closed gate coverage. */
function minimalReceipt() {
  return {
    result: 'pass',
    failures: [],
    source: { dirty: false, head: 'sha', tree: 'tree', proofMode: 'local-working-tree' },
    profile: '/tmp/repair-train-d-profile',
    profileRetention: { status: 'removed' },
    launches: [],
    phases: {},
  }
}

/** Builds a complete terminal receipt fixture with no Electron dependency. */
function completeReceipt() {
  const profile = '/tmp/repair-train-d-profile'
  const livePath = `${profile}/mission-store.sqlite`
  const backupPath = `${profile}/mission-store.backup.sqlite`
  const diagnostics = () => createDiagnosticState()
  const close = () => ({
    requestedAt: '2026-09-14T10:00:00.000Z',
    exitObservedAt: '2026-09-14T10:00:01.000Z',
    stderrDrainedAt: '2026-09-14T10:00:02.000Z',
    graceful: true,
    exitCode: 0,
    signal: null,
    diagnostics: diagnostics(),
  })
  const firstPage = {
    kind: 'areas',
    generation: 4,
    totalCount: 26,
    entryCount: 25,
    firstEntry: { id: 'repair-train-d-area-00', name: 'AUD-09 area 00' },
    lastEntry: { id: 'repair-train-d-area-24', name: 'AUD-09 area 24' },
    nextCursor: 'cursor',
  }
  const secondPage = {
    ...firstPage,
    entryCount: 1,
    firstEntry: { id: 'repair-train-d-area-25', name: 'AUD-09 area 25' },
    lastEntry: { id: 'repair-train-d-area-25', name: 'AUD-09 area 25' },
    nextCursor: null,
  }
  const readonly = {
    live: {
      path: livePath,
      integrity: 'ok',
      generation: 4,
      searchOperationsGeneration: 4,
      searchAreaCount: 26,
      backupSyncEventCount: 1,
    },
    backup: {
      path: backupPath,
      integrity: 'ok',
      generation: 4,
      searchOperationsGeneration: 4,
      searchAreaCount: 26,
      backupSyncEventCount: 0,
    },
  }
  return {
    result: 'pass',
    failures: [],
    source: { dirty: false, head: 'sha', tree: 'tree' },
    profile,
    profileRetention: { status: 'removed' },
    package: {
      packagedInputsMatch: true,
      archivePath: '/tmp/app.asar',
      windowAttestation: { hasTraccarHttpBridge: true },
    },
    provider: {
      origin: 'http://127.0.0.1:1234',
      heldHistoryRequests: 1,
      historyHoldEvidence: {
        method: 'GET',
        path: '/api/positions',
        deviceId: '22',
        from: '2026-09-13T03:00:00.000Z',
        to: '2026-09-13T05:00:00.000Z',
        isHistory: true,
        status: 503,
      },
    },
    launches: [
      { label: 'initial', pid: 101, close: close() },
      { label: 'restart', pid: 102, close: close() },
    ],
    phases: {
      aud08: {
        missionId: 'mission-aud08',
        progressScreenshot: '/tmp/evidence/aud08-readded-group-progress.png',
        screenshot: '/tmp/evidence/aud08-readded-group-pending.png',
        finishBlockedSurface: 'Participant history backfill is incomplete; keep the mission active.',
        readdedPending: {
          participants: [{
            kind: 'group',
            mission_id: 'mission-aud08',
            removed_at: null,
            effective_from: '2026-09-13T03:30:00.000Z',
            backfill_member_count: 2,
            backfill_completed_count: 1,
          }],
          checkpoints: [
            { mission_id: 'mission-aud08', traccar_device_id: '11', completed: 1 },
            { mission_id: 'mission-aud08', traccar_device_id: '22', completed: 0 },
          ],
        },
        automaticBackfill: {
          initialCheckpointCompleted: true,
          readdedSuccessfulMember: '11',
          readdedHeldMember: '22',
          providerHistoryHoldObserved: 1,
          readdWindow: {
            from: '2026-09-13T03:30:00.000Z',
            to: '2026-09-13T04:00:00.000Z',
          },
          successfulHistoryRequest: {
            method: 'GET',
            path: '/api/positions',
            isHistory: true,
            deviceId: '11',
            status: 200,
            from: '2026-09-13T03:30:00.000Z',
            to: '2026-09-13T04:00:00.000Z',
          },
          currentRequestsBeforeHold: 1,
          currentRequestsAfterHold: 3,
        },
      },
      aud09: {
        firstPage,
        secondPage,
        backupPath,
        readonly,
        screenshot: '/tmp/evidence/aud09-search-operations-after-backup.png',
      },
      restart: {
        participant: {
          mission: { id: 'mission-aud08', status: 'active' },
          participants: [{
            kind: 'group',
            mission_id: 'mission-aud08',
            removed_at: null,
            backfill_member_count: 2,
            backfill_completed_count: 1,
          }],
          checkpoints: [{ mission_id: 'mission-aud08', traccar_device_id: '22', completed: 0 }],
        },
        secondPage,
        readonly,
        screenshot: '/tmp/evidence/restart-participant-and-search-cursor.png',
      },
    },
    scenarioResults: { aud08: 'pass', aud09: 'pass', restart: 'pass' },
    scenarioResult: 'pass',
    diagnosticResult: 'pass',
    diagnosticBlockers: [],
  }
}
