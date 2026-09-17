import { describe, expect, it } from 'vitest'
// @ts-expect-error JavaScript evidence validator is exercised through its runtime contract.
import { validateNativeRuntimeReceipt } from '../../build/native-runtime-smoke-receipt.js'
import {
  appendBoundedDiagnostic,
  createDiagnosticState,
} from '../../build/electron-repair-train-d-smoke-lib.js'

/** Supplies one complete synthetic terminal control, never a packaged proof. */
function receipt() {
  return {
    result: 'pass', source: { head: 'a'.repeat(40), dirty: false },
    package: { archiveSha256: 'b'.repeat(64), inputs: Object.fromEntries([
      'electron/mission-store.cjs', 'electron/coverage-query-worker.cjs', 'electron/coverage-query-runner.cjs',
      'electron/coverage-ipc.cjs', 'electron/coverage-owner-lifecycle.cjs',
    ].map(file => [file, 'c'.repeat(64)])) },
    ipc: { protocol: 'file:', count: 24, allEnumerated: true, serviceWorkers: null as number | null },
    store: { added: true, kinds: ['outing', 'unassigned'], exactFixes: 1, cancellation: 'AbortError', physicalExit: true,
      cancellationObservedAfterExit: true, liveSnapshotCount: 1, liveCurrentCount: 2, liveClaimReady: false },
    close: { exit: { exitCode: 0, signal: null }, closeError: null, forcedCleanup: null },
    diagnostics: createDiagnosticState(), stderr: [], stderrStreamAttached: true,
    stderrDrained: true, profileRemoved: true,
  }
}

describe('native runtime terminal evidence [DON-254]', () => {
  it('accepts the complete bounded proof and checks exact source when requested', () => {
    expect(() => validateNativeRuntimeReceipt(receipt(), 'a'.repeat(40))).not.toThrow()
    expect(() => validateNativeRuntimeReceipt(receipt(), 'd'.repeat(40))).toThrow(/source/i)
  })
  it('accepts only the canonical Linux Vulkan startup pair in packaged stderr', () => {
    const value = receipt()
    value.runtime = { platform: 'linux' }
    for (const message of [
      '[12974:0916/222400.492761:ERROR:gpu/vulkan/vulkan_instance.cc:200] vkCreateInstance() failed: -9',
      '[12974:0916/222400.492993:ERROR:gpu/ipc/service/gpu_init.cc:1366] Failed to create and initialize Vulkan implementation.',
    ]) {
      appendBoundedDiagnostic(value.diagnostics, 'processStderr', { message }, {
        phase: 'launch', type: 'stderr', source: 'main-process-stderr',
      })
    }

    expect(() => validateNativeRuntimeReceipt(value)).not.toThrow()

    value.diagnostics.processStderr[1].message = 'unexpected packaged stderr'
    expect(() => validateNativeRuntimeReceipt(value)).toThrow(/unexpected packaged diagnostics/i)
  })
  it.each(['ipc', 'store', 'close', 'package', 'diagnostics'] as const)('rejects omitted %s evidence', field => {
    const value = receipt()
    Reflect.deleteProperty(value, field)
    expect(() => validateNativeRuntimeReceipt(value)).toThrow()
  })
  it('rejects unfinished physical exit and incomplete IPC workload', () => {
    const value = receipt()
    value.store.physicalExit = false
    expect(() => validateNativeRuntimeReceipt(value)).toThrow(/worker/i)
    value.store.physicalExit = true
    value.ipc.count = 23
    expect(() => validateNativeRuntimeReceipt(value)).toThrow(/IPC/i)
  })

  it('rejects missing live-ingest progress or cancellation-exit ordering evidence', () => {
    const value = receipt()
    value.store.liveClaimReady = true
    expect(() => validateNativeRuntimeReceipt(value)).toThrow(/worker/i)
    value.store.liveClaimReady = false
    value.store.cancellationObservedAfterExit = false
    expect(() => validateNativeRuntimeReceipt(value)).toThrow(/worker/i)
  })

  it('rejects a receipt without owned stderr capture and terminal drain evidence', () => {
    const value = receipt()
    Reflect.deleteProperty(value, 'stderrStreamAttached')
    expect(() => validateNativeRuntimeReceipt(value)).toThrow(/stderr/i)

    value.stderrStreamAttached = true
    value.stderrDrained = false
    expect(() => validateNativeRuntimeReceipt(value)).toThrow(/stderr/i)
  })
})
