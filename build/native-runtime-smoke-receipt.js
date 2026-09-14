import assert from 'node:assert/strict'
import { assertNoUnexpectedDiagnostics } from './electron-repair-train-d-smoke-lib.js'

/** Independently rejects incomplete, stale-source or unclean native control receipts. */
export function validateNativeRuntimeReceipt(receipt, expectedHead) {
  assert.equal(receipt?.result, 'pass', 'Native runtime control did not pass.')
  if (expectedHead !== undefined) {
    assert.equal(receipt.source?.head, expectedHead, 'Native control source head mismatch.')
    assert.equal(receipt.source?.dirty, false, 'Native control source is dirty.')
  }
  assert.match(receipt.package?.archiveSha256 ?? '', /^[a-f0-9]{64}$/u, 'Missing package identity.')
  for (const file of ['electron/mission-store.cjs', 'electron/coverage-query-worker.cjs',
    'electron/coverage-query-runner.cjs', 'electron/coverage-ipc.cjs', 'electron/coverage-owner-lifecycle.cjs']) {
    assert.match(receipt.package?.inputs?.[file] ?? '', /^[a-f0-9]{64}$/u, `Missing packaged input: ${file}`)
  }
  assert.deepEqual(receipt.ipc, { protocol: 'file:', count: 24, allEnumerated: true, serviceWorkers: 0 }, 'Native IPC control is incomplete.')
  assert.deepEqual(receipt.store, { added: true, kinds: ['outing', 'unassigned'], exactFixes: 1,
    cancellation: 'AbortError', physicalExit: true }, 'Native worker snapshot/exit control is incomplete.')
  assert.deepEqual(receipt.close, { exit: { exitCode: 0, signal: null }, closeError: null, forcedCleanup: null }, 'Native child did not exit cleanly.')
  assert.equal(receipt.profileRemoved, true, 'Native control profile cleanup is not proved.')
  assertNoUnexpectedDiagnostics(receipt.diagnostics)
}
