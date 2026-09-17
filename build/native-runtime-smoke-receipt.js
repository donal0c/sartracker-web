import assert from 'node:assert/strict'
import {
  assertNoUnexpectedDiagnostics,
  createLinuxVulkanStartupDiagnosticAllowlist,
} from './electron-repair-train-d-smoke-lib.js'

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
  assert.deepEqual({ ...receipt.ipc, serviceWorkers: null }, { protocol: 'file:', count: 24, allEnumerated: true, serviceWorkers: null }, 'Native IPC control is incomplete.')
  assert.ok(receipt.ipc.serviceWorkers === null || receipt.ipc.serviceWorkers === 0, 'Unexpected service-worker registrations.')
  assert.deepEqual(receipt.store, { added: true, kinds: ['outing', 'unassigned'], exactFixes: 1,
    cancellation: 'AbortError', physicalExit: true, cancellationObservedAfterExit: true,
    liveSnapshotCount: 1, liveCurrentCount: 2, liveClaimReady: false }, 'Native worker snapshot/exit control is incomplete.')
  assert.deepEqual(receipt.close, { exit: { exitCode: 0, signal: null }, closeError: null, forcedCleanup: null }, 'Native child did not exit cleanly.')
  assert.equal(receipt.stderrStreamAttached, true, 'Native control did not attach to the owned stderr stream.')
  assert.ok(Array.isArray(receipt.stderr), 'Native control did not retain stderr capture.')
  assert.equal(receipt.stderrDrained, true, 'Native control validated before stderr drained.')
  assert.equal(receipt.profileRemoved, true, 'Native control profile cleanup is not proved.')
  assertNoUnexpectedDiagnostics(receipt.diagnostics, createLinuxVulkanStartupDiagnosticAllowlist({
    platform: receipt.runtime?.platform,
    processStderr: receipt.diagnostics.processStderr,
    processStderrCount: receipt.diagnostics.counts.processStderr,
    processStderrTruncated: receipt.diagnostics.truncated.processStderr,
  }))
}
