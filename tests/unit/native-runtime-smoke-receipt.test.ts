import { describe, expect, it } from 'vitest'
// @ts-expect-error JavaScript evidence validator is exercised through its runtime contract.
import { validateNativeRuntimeReceipt } from '../../build/native-runtime-smoke-receipt.js'
import { createDiagnosticState } from '../../build/electron-repair-train-d-smoke-lib.js'

/** Supplies one complete synthetic terminal control, never a packaged proof. */
function receipt() {
  return {
    result: 'pass', source: { head: 'a'.repeat(40), dirty: false },
    package: { archiveSha256: 'b'.repeat(64), inputs: Object.fromEntries([
      'electron/mission-store.cjs', 'electron/coverage-query-worker.cjs', 'electron/coverage-query-runner.cjs',
      'electron/coverage-ipc.cjs', 'electron/coverage-owner-lifecycle.cjs',
    ].map(file => [file, 'c'.repeat(64)])) },
    ipc: { protocol: 'file:', count: 24, allEnumerated: true, serviceWorkers: 0 },
    store: { added: true, kinds: ['outing', 'unassigned'], exactFixes: 1, cancellation: 'AbortError', physicalExit: true },
    close: { exit: { exitCode: 0, signal: null }, closeError: null, forcedCleanup: null },
    diagnostics: createDiagnosticState(), profileRemoved: true,
  }
}

describe('native runtime terminal evidence [DON-254]', () => {
  it('accepts the complete bounded proof and checks exact source when requested', () => {
    expect(() => validateNativeRuntimeReceipt(receipt(), 'a'.repeat(40))).not.toThrow()
    expect(() => validateNativeRuntimeReceipt(receipt(), 'd'.repeat(40))).toThrow(/source/i)
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
})
