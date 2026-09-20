// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  C02_LIFECYCLE_VARIANTS,
  validateC02LifecycleReceipt,
} from '../../scripts/qualification/c02-lifecycle-receipts.mjs'

const expected = {
  contractId: 'C02',
  variantId: 'main-sigkill',
  appSha256: 'a'.repeat(64),
  asarSha256: 'b'.repeat(64),
  sourceSha: 'c'.repeat(40),
  evidencePath: '/owned/evidence',
}

function validReport() {
  return {
    schemaVersion: 1,
    contractId: 'C02',
    variantId: 'main-sigkill',
    proofMode: 'packaged-electron',
    source: { head: expected.sourceSha, dirty: false },
    profile: { path: '/owned/evidence/.profile-c02', removed: true },
    runtime: {
      launches: [
        { label: 'before', pid: 101, executableSha256: expected.appSha256, asarSha256: expected.asarSha256, userDataPath: '/owned/evidence/.profile-c02' },
        { label: 'recovery', pid: 102, executableSha256: expected.appSha256, asarSha256: expected.asarSha256, userDataPath: '/owned/evidence/.profile-c02' },
      ],
    },
    mission: {
      id: 'mission-1',
      snapshots: {
        before: { id: 'mission-1', status: 'active' },
        afterRecovery: { id: 'mission-1', status: 'active' },
      },
      audit: {
        before: [{ id: 'event-1', mission_id: 'mission-1', event_type: 'mission_created' }],
        afterRecovery: [{ id: 'event-1', mission_id: 'mission-1', event_type: 'mission_created' }],
      },
    },
    fault: {
      requested: 'main-process-sigkill',
      observed: true,
      process: { pid: 101, signal: 'SIGKILL', exitCode: null },
      recoveryState: { uncleanShutdown: true, lastCrash: null },
      recoveryNotice: true,
      evidenceHealthWarning: true,
      evidenceHealthWarning: true,
    },
    cleanup: { applicationClosed: true, profileRemoved: true },
    failure: null,
    result: 'pass',
  }
}

describe('C02 packaged lifecycle receipt validation', () => {
  it('publishes a fixed variant inventory', () => {
    expect(C02_LIFECYCLE_VARIANTS).toEqual([
      'graceful-close',
      'reload',
      'renderer-crash',
      'main-sigkill',
      'pending-finalize',
    ])
  })

  it('accepts a complete main SIGKILL receipt', async () => {
    await expect(validateC02LifecycleReceipt(validReport(), expected)).resolves.toMatchObject({
      status: 'PASS',
      contractId: 'C02',
      variantId: 'main-sigkill',
    })
  })

  it('rejects a forged aggregate pass without the raw lifecycle facts', async () => {
    const forged = { ...validReport(), mission: undefined, result: 'pass' }
    await expect(validateC02LifecycleReceipt(forged, expected)).rejects.toThrow(/mission/i)
  })

  it('rejects a SIGKILL after a clean exit or a mismatched signal', async () => {
    const clean = validReport()
    clean.fault.process.signal = null
    clean.fault.process.exitCode = 0
    await expect(validateC02LifecycleReceipt(clean, expected)).rejects.toThrow(/SIGKILL/i)
  })

  it('rejects a renderer exception in place of an actual renderer crash', async () => {
    const report = { ...validReport(), variantId: 'renderer-crash', fault: {
      requested: 'renderer-javascript-exception',
      observed: true,
      process: { pid: 101, signal: null, exitCode: null },
      recoveryState: { uncleanShutdown: false, lastCrash: null },
    } }
    await expect(validateC02LifecycleReceipt(report, { ...expected, variantId: 'renderer-crash' })).rejects.toThrow(/renderer process crash/i)
  })

  it('requires a durable pending-finalize boundary and preserves an evidence-fence refusal', async () => {
    const evidencePath = await mkdtemp(path.join(tmpdir(), 'c02-receipt-'))
    const markerPath = path.join(evidencePath, 'renderer-loss-marker.json')
    const marker = JSON.stringify({ reasons: ['renderer_pending_evidence_lost'], lossGeneration: 1 })
    await writeFile(markerPath, marker, { mode: 0o600 })
    const markerDigest = createHash('sha256').update(marker).digest('hex')
    const report = validReport()
    report.variantId = 'pending-finalize'
    report.profile.path = `${evidencePath}/.profile-c02`
    for (const launch of report.runtime.launches) launch.userDataPath = report.profile.path
    report.fault = {
      requested: 'main-process-sigkill-at-finalize-phase',
      observed: true,
      process: { pid: 101, signal: 'SIGKILL', exitCode: null },
      recoveryState: { uncleanShutdown: true, lastCrash: null },
      recoveryNotice: true,
      evidenceHealthWarning: true,
    }
    report.pendingFinalize = {
      operationId: 'op-1',
      phase: 'snapshot',
      boundaryObserved: true,
      recoveryAttempted: true,
      settled: false,
      blocked: true,
      evidenceHealthBeforeRetry: { state: 'critical', reason: 'renderer_pending_evidence_lost' },
      evidenceLossMarker: {
        path: markerPath,
        bytes: Buffer.byteLength(marker),
        sha256: markerDigest,
      },
      finalMission: { id: 'mission-1', status: 'finished' },
      retry: { error: 'ARCHIVE_EVIDENCE_HEALTH_BLOCKED' },
      audit: [
        { id: 'event-1', mission_id: 'mission-1', event_type: 'mission_created' },
        { id: 'event-2', mission_id: 'mission-1', event_type: 'mission_finalize_requested' },
        { id: 'event-3', mission_id: 'mission-1', event_type: 'mission_archive_failed' },
      ],
    }
    await expect(validateC02LifecycleReceipt(report, { ...expected, evidencePath, variantId: 'pending-finalize' })).resolves.toMatchObject({
      status: 'PASS',
      outcome: 'safe-blocked',
    })

    report.pendingFinalize.blocked = false
    await expect(validateC02LifecycleReceipt(report, { ...expected, evidencePath, variantId: 'pending-finalize' })).rejects.toThrow(/safe blocked/i)

    report.pendingFinalize.blocked = true
    report.pendingFinalize.evidenceLossMarker = null
    await expect(validateC02LifecycleReceipt(report, { ...expected, evidencePath, variantId: 'pending-finalize' })).rejects.toThrow(/evidence-loss marker/i)

    await rm(evidencePath, { recursive: true, force: true })
  })
})
