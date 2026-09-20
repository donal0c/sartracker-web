import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createTrainDReceipt } from '../fixtures/train-d-receipt'

import {
  PACKAGE_SMOKE_DESCRIPTORS,
  validatePackageSmokeReceipt,
} from '../../scripts/qualification/package-smoke-receipts.mjs'

const sha1 = 'a'.repeat(40)
const tree = 'b'.repeat(40)
const sha256 = 'c'.repeat(64)
const expected = {
  source: { expectedHead: sha1, tree },
  artifact: { executableSha256: sha256, archiveSha256: sha256 },
  workload: { profile: 'synthetic-package-smoke', processTier: 'installed-deb' },
  processTier: 'installed-deb',
}

describe('candidate package-smoke receipt validation', () => {
  it('validates installed Train D using independently observed runtime rather than a linux-unpacked path flag', () => {
    const runtime = { proofMode: 'installed-deb', launchPath: '/opt/SAR/sartracker', installedExecutablePath: '/opt/SAR/sartracker',
      artifactSha256: sha256, executableSha256: sha256, asarSha256: sha256 }
    const observations = [101, 102].map(pid => ({ pid, startTicks: String(pid), mainProcess: true, descendantOfRunner: true,
      launchPath: runtime.launchPath, executablePath: runtime.launchPath, artifactSha256: sha256,
      executableSha256: sha256, asarSha256: sha256, appImagePath: null }))
    const raw = createTrainDReceipt()
    const receipt = { ...raw, executablePath: runtime.launchPath, runtime: { platform: 'linux', requireLinuxUnpacked: false },
      source: { dirty: false, head: sha1, tree, proofMode: 'exact-head-clean-tree' },
      package: { ...raw.package, executableSha256: sha256, archiveSha256: sha256 } }
    const binding = { ...expected, workload: { profile: raw.profile }, runtime: { expected: runtime, observations } }
    const result = validatePackageSmokeReceipt('C02', receipt, binding)
    expect(result.failureReasons).toEqual([])
    expect(result).toMatchObject({ passed: true, proofMode: 'installed-deb' })
    observations[0].asarSha256 = 'f'.repeat(64)
    expect(validatePackageSmokeReceipt('C02', receipt, binding).passed).toBe(false)
  })
  it('catalogues the exact producers, arguments and receipt paths without upgrading proof mode', () => {
    expect(PACKAGE_SMOKE_DESCRIPTORS.C01).toMatchObject({
      script: 'scripts/electron-bad-secret-smoke.mjs',
      reportPath: '<evidence-dir>/summary.json',
      actualProofMode: 'packaged-electron-startup-subset',
    })
    expect(PACKAGE_SMOKE_DESCRIPTORS.C09.reportPath).toBe('<output-dir>/receipt.json')
    expect(PACKAGE_SMOKE_DESCRIPTORS.C18.cli).toContain('--post-restart-observation-ms')
    expect(PACKAGE_SMOKE_DESCRIPTORS.C15.uncoveredAxes.join(' ')).toMatch(/installed|artifact/iu)
    expect(PACKAGE_SMOKE_DESCRIPTORS.C19.uncoveredAxes.join(' ')).toMatch(/default app|operator|field/iu)
  })

  it('retains the actual bad-secret startup predicate without claiming the omitted Settings receipt', () => {
    const result = validatePackageSmokeReceipt('C01', {
      appPath: '/tmp/SAR Tracker.AppImage',
      evidenceDir: '/tmp/evidence',
      result: 'pass',
      userDataDir: '/tmp/evidence/user-data',
      warning: 'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.',
    }, {
      ...expected,
      // The producer has no source or artifact identity fields. Runtime custody
      // remains an adapter-owned prerequisite, so this deliberately validates
      // only the observed startup subset.
      source: undefined,
      artifact: undefined,
      processTier: 'packaged-electron-startup-subset',
      workload: { warning: 'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.' },
    })

    expect(result).toMatchObject({
      status: 'INVALID_EVIDENCE',
      valid: false,
      passed: false,
      contractComplete: false,
      releaseEligible: false,
      predicates: { startup: true, recoverySurface: false },
    })
    expect(result.uncoveredAxes.join(' ')).toMatch(/source|artifact|persistence/iu)
    expect(result.failureReasons.join(' ')).toMatch(/Settings|receipt|summary/iu)
  })

  it.each([
    ['producer result', { result: 'fail' }],
    ['warning text', { warning: 'wrong warning' }],
  ])('rejects a tampered C01/C16 startup observation: %s', (_label, replacement) => {
    const report = {
      appPath: '/tmp/SAR Tracker.AppImage',
      evidenceDir: '/tmp/evidence',
      result: 'pass',
      userDataDir: '/tmp/evidence/user-data',
      warning: 'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.',
      ...replacement,
    }
    const result = validatePackageSmokeReceipt('C16', report, {
      source: undefined,
      artifact: undefined,
      processTier: 'packaged-electron-startup-subset',
      workload: { warning: 'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.' },
    })
    expect(result.valid).toBe(false)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join(' ')).toMatch(/startup|warning|pass/iu)
  })

  it('does not trust C02 result when the existing independent Train D validator rejects the receipt', () => {
    const result = validatePackageSmokeReceipt('C02', {
      result: 'pass',
      failures: [],
      scenarioResults: { aud08: 'pass', aud09: 'pass', restart: 'pass' },
      scenarioResult: 'pass',
    }, expected)

    expect(result.valid).toBe(false)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join(' ')).toMatch(/Train D|receipt|attestation|profile/iu)
  })

  it('rejects C09 when the receipt omits independently inspectable provenance observations', () => {
    const result = validatePackageSmokeReceipt('C09', {
      proofTier: 'CI packaged Electron; synthetic profile; network blocked; native chooser automated',
      sourceHead: sha1,
      sourceTree: tree,
      sourceDirty: false,
      sourceSha256: sha256,
      largeSourceSha256: sha256,
      malformedSourceSha256: sha256,
      undatedSourceSha256: sha256,
      largePointCount: 75_000,
      archiveSha256: sha256,
      packagedInputHashes: {},
      passed: true,
    }, expected)

    expect(result.valid).toBe(false)
    expect(result.predicates.provenance).toBe(false)
    expect(result.failureReasons.join(' ')).toMatch(/inspect|GPX|provenance|restart/iu)
  })

  it('rejects C09 when the expanded boundary, lifecycle, and kill observations are absent', () => {
    const result = validatePackageSmokeReceipt('C09', {
      proofTier: 'CI packaged Electron; synthetic profile; network blocked; native chooser automated',
      sourceHead: sha1,
      sourceTree: tree,
      sourceDirty: false,
      sourceSha256: sha256,
      largeSourceSha256: sha256,
      malformedSourceSha256: sha256,
      undatedSourceSha256: sha256,
      largePointCount: 75_000,
      archiveSha256: sha256,
      packagedInputHashes: {},
      passed: true,
      lifecycle: {},
    }, expected)

    expect(result.valid).toBe(false)
    expect(result.failureReasons.join(' ')).toMatch(/boundary|lifecycle|kill/iu)
  })

  it('accepts the expanded C09 oracle only when each bounded race and custody checkpoint is present', () => {
    const source = '<gpx>source</gpx>'
    const replacement = '<gpx>replacement</gpx>'
    const large = '<gpx>large</gpx>'
    const undated = '<gpx>undated</gpx>'
    const digest = (value: string) => createHash('sha256').update(value).digest('hex')
    const revision = (fileName: string, sequence: number, value: string) => ({
      file_name: fileName,
      revision_sequence: sequence,
      content_sha256: digest(value),
      source_bytes_base64: Buffer.from(value).toString('base64'),
      import_state: 'complete',
      audit_event_id: `event-${fileName}-${sequence}`,
    })
    const before = {
      integrity: 'ok',
      count: 75_008,
      endedOutings: 1,
      points: [
        { point_index: 0, track_name: 'Ridge party', lat: 52, lon: -9.7, elevation: 100, source_time: '2026-09-07T08:00:00.000Z' },
        { point_index: 1, track_name: 'Ridge party', lat: 52.001, lon: -9.701, elevation: 110, source_time: '2026-09-07T08:01:00.000Z' },
      ],
      undated: [
        { file_name: 'undated-late-name.gpx', display_name: 'undated-late-name', timing_class: 'undated', point_index: 0, track_name: 'Ridge party', source_time: null },
        { file_name: 'undated-late-name.gpx', display_name: 'undated-late-name', timing_class: 'undated', point_index: 1, track_name: 'Ridge party', source_time: null },
      ],
      imports: [
        { file_name: 'fidelity.gpx', display_name: 'fidelity', timing_class: 'fully_dated' },
        { file_name: 'outing-race.gpx', display_name: 'outing-race', timing_class: 'fully_dated' },
        { file_name: 'undated-late-name.gpx', display_name: 'undated-late-name', timing_class: 'undated' },
      ],
      receipts: [
        { file_name: 'fidelity.gpx', status: 'settled' },
        { file_name: 'malformed-geometry.gpx', status: 'failed' },
        { file_name: 'outing-race.gpx', status: 'settled' },
        { file_name: 'undated-late-name.gpx', status: 'settled' },
      ],
      failures: [{ file_name: 'malformed-geometry.gpx', content_sha256: digest('malformed'), source_bytes_base64: Buffer.from('malformed').toString('base64'), reason: 'GPX namespace_mismatch: trkseg.', rejection_count: 0, rejections_json: '[]' }],
      revisions: [revision('fidelity.gpx', 1, source), revision('fidelity.gpx', 2, replacement), revision('fidelity.gpx', 3, source), revision('outing-race.gpx', 1, large), revision('undated-late-name.gpx', 1, undated)],
    }
    const report = {
      proofTier: 'CI packaged Electron; synthetic profile; network blocked; native chooser automated',
      sourceHead: sha1, sourceTree: tree, sourceDirty: false,
      sourceSha256: digest(source), largeSourceSha256: digest(large), malformedSourceSha256: digest('malformed'), undatedSourceSha256: digest(undated),
      largePointCount: 75_000, archiveSha256: sha256, packagedInputHashes: { 'electron/gpx-source-reader.cjs': sha256 }, passed: true,
      beforeRestart: before, afterRestart: structuredClone(before),
      boundaryProbe: { maxBytes: 8 * 1024 * 1024, exact: { bytes: 8 * 1024 * 1024, accepted: true, sha256 }, over: { bytes: 8 * 1024 * 1024 + 1, rejected: true, sha256, error: 'GPX source exceeds the 8 MiB evidence import safety limit.' } },
      lifecycle: { batches: [{ status: 'completed', total_files: 1, completed_files: 1, failed_files: 0, finished_at: '2026-01-01T00:00:00.000Z' }], receipts: [{ file_name: 'fidelity.gpx', status: 'settled', content_sha256: digest(source), copy_checkpoint: true }], commits: [{ file_name: 'fidelity.gpx', import_state: 'complete', revision_sequence: 3, audit_event_id: 'event-fidelity-3', commit_checkpoint: true }], unsettled_count: 0 },
      duplicateIdentity: { attempted: true, same_content_skipped: true, no_new_revision: true, before_revision_count: 3, after_revision_count: 3 },
      replacementIdentity: { attempted: true, original_sha256: digest(source), replacement_sha256: digest(replacement), final_sha256: digest(source), source_path_stable: true, revisions_added: 2 },
      concurrentIdentity: { attempted: true, request_count: 2, settled_count: 2, no_duplicate_revision: true },
      killRecovery: {
        attempted: true,
        proofMode: 'packaged-electron-public-ipc',
        phases: ['pending', 'retained'],
        fixtureBytes: 1024 * 1024,
        source_sha256: sha256,
        receipt_checkpoint: true,
        copy_checkpoint: true,
        commit_checkpoint: true,
        cases: ['pending', 'retained'].map((phase) => ({
          phase,
          sourceBytes: 1024 * 1024,
          source_sha256: sha256,
          app_pid: 4242,
          barrier_observed: true,
          signal: 'SIGKILL',
          recovered_status: 'failed',
          receipt_checkpoint: true,
          copy_checkpoint: phase === 'retained',
          no_committed_revision: true,
          batch_checkpoint: true,
          profile_removed: true,
          failure_reason: phase === 'pending'
            ? 'GPX import was interrupted before source bytes were retained.'
            : 'GPX import was interrupted after source bytes were retained but before evidence was published.',
          failure_hash: phase === 'pending' ? null : sha256,
          retained_database: { bytes: 1234, sha256 },
          worker_hook_matched: 1,
          worker_hook_restored: true,
        })),
      },
    }
    const result = validatePackageSmokeReceipt('C09', report, {
      ...expected,
      processTier: 'packaged-electron-synthetic-profile',
    })
    expect(result).toMatchObject({ valid: true, passed: true, predicates: { provenance: true } })
  })

  it('rejects a development-harness C09 receipt from candidate qualification', () => {
    const source = '<gpx>source</gpx>'
    const digest = (value: string) => createHash('sha256').update(value).digest('hex')
    const report = {
      developmentTestHarness: true,
      proofTier: 'development Electron; synthetic profile; network blocked; native chooser automated',
      sourceHead: sha1,
      sourceTree: tree,
      sourceDirty: false,
      sourceSha256: digest(source),
      largeSourceSha256: digest(source),
      malformedSourceSha256: digest(source),
      undatedSourceSha256: digest(source),
      largePointCount: 75_000,
      archiveSha256: sha256,
      packagedInputHashes: { 'electron/gpx-source-reader.cjs': sha256 },
      passed: true,
    }
    const result = validatePackageSmokeReceipt('C09', report, {
      ...expected,
      processTier: 'packaged-electron-synthetic-profile',
    })

    expect(result.valid).toBe(false)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join(' ')).toMatch(/development.*candidate|candidate.*development/iu)
  })

  it('recomputes C15 package and render predicates instead of trusting checks.complete', () => {
    const result = validatePackageSmokeReceipt('C15', {
      schema: 'sartracker-war11-official-map-qualification-v1',
      runtime: { appPath: '/tmp/app.asar', isPackaged: true },
      buildIdentity: { asarSha256: sha256, sourceInputs: {}, packagedRuntimeInputs: {} },
      blockedNetwork: true,
      providerIsolation: { rendererNetworkProbeBlocked: true, mainMapGenieFallbackEligible: false },
      package: { mapId: 'official_discovery_topo', targetTile: { z: 12, x: 1935, y: 1352 } },
      checks: { complete: true, completeOperatorCheck: { status: 'complete' }, staleReplacementServedOldContent: false },
      processExit: { cleanExit: true, exit: { code: 0, signal: null } },
    }, expected)

    expect(result.valid).toBe(false)
    expect(result.predicates.render).toBe(false)
    expect(result.failureReasons.join(' ')).toMatch(/map|evidence|replacement|missing/iu)
  })

  it('fails C18 closed when the report omits the raw observations required by its existing oracle', () => {
    const result = validatePackageSmokeReceipt('C18', {
      schemaVersion: 1,
      issue: 'DON-244',
      app: { basename: 'SAR Tracker', sha256 },
      fixture: { basename: 'fixture.sqlite', bytes: 123, sha256 },
      platform: { os: 'Linux', architecture: 'x64', node: 'v22.0.0' },
      killedAt: { type: 'backup', stage: 'started' },
      recoveredAs: { type: 'backup', stage: 'started' },
      supportBundleBasename: 'storage-diagnostics-kill-support-bundle.txt',
      privacyChecks: [{ label: 'fixture', absent: true }],
      verdict: { passed: true, failures: [] },
    }, { ...expected, processTier: 'packaged-kill-restart-summary' })

    expect(result.valid).toBe(false)
    expect(result.predicates.recovery).toBe(false)
    expect(result.failureReasons.join(' ')).toMatch(/raw|runtime|support|independent/iu)
  })

  it('accepts C18 lifecycle predicates from the producer’s bounded structured oracle input', () => {
    const result = validatePackageSmokeReceipt('C18', {
      schemaVersion: 2,
      schema: 'sartracker-storage-diagnostics-kill-probe-v2',
      issue: 'DON-244',
      app: { basename: 'SAR Tracker', sha256 },
      fixture: { basename: 'fixture.sqlite', bytes: 123, sha256 },
      platform: { os: 'Linux', architecture: 'x64', node: 'v22.0.0' },
      killedAt: { type: 'backup', stage: 'started' },
      recoveredAs: { type: 'backup', stage: 'started' },
      supportBundleBasename: 'storage-diagnostics-kill-support-bundle.txt',
      privacyChecks: [{ label: 'fixture', absent: true }],
      oracleInput: {
        schemaVersion: 1,
        redaction: 'bounded-marker-and-metric-extract-v1',
        beforeKill: { activeOperation: { type: 'backup', stage: 'started' } },
        afterRestart: {
          activeOperation: null,
          previousInterruptedOperation: { type: 'backup', stage: 'started' },
        },
        runtimeLog: {
          markers: [
            'storage_backup_started',
            'storage_previous_run_interrupted',
            'storage_main_event_loop_summary',
          ],
          evidence: 'storage_backup_started\nstorage_previous_run_interrupted\nstorage_main_event_loop_summary',
          bytes: 123,
          sha256,
        },
        supportBundle: {
          requiredLines: [
            '[storage-diagnostics]',
            'previous interrupted operation: backup started',
            'event loop latest maximum delay ms: 5120',
          ],
          evidence: '[storage-diagnostics]\nprevious interrupted operation: backup started\nevent loop latest maximum delay ms: 5120',
          eventLoopLatestMaximumDelayMs: 5120,
          bytes: 123,
          sha256,
        },
        privacy: [{
          label: 'forbidden-value-1',
          valueSha256: sha256,
          matchCount: 0,
        }],
      },
      verdict: { passed: true, failures: [] },
    }, {
      ...expected,
      processTier: 'packaged-kill-restart-summary',
      artifact: { executableSha256: sha256 },
      workload: { fixtureSha256: sha256 },
    })

    expect(result.predicates.recovery).toBe(true)
    expect(result.predicates.custody).toBe(true)
    expect(result.passed).toBe(true)
    expect(result.coverageComplete).toBe(false)
  })

  it('uses the existing C19 independent validator and never accepts passed=true alone', () => {
    const result = validatePackageSmokeReceipt('C19', {
      issue: 'DON-254',
      proofTier: 'diagnostic-only second disposable mission store using packaged production store/runner via an injected factory; no default app wiring or operator-load qualification',
      passed: true,
    }, {
      ...expected,
      source: { expectedHead: sha1, tree },
      workload: { baselineMarkerRows: 50_000, processTier: 'installed-deb' },
    })

    expect(result.valid).toBe(false)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join(' ')).toMatch(/source|probe|fixture|launch|packaged/iu)
  })

  it('rejects unsupported contracts and keeps every package smoke result non-release-eligible', () => {
    const result = validatePackageSmokeReceipt('C20', {}, expected)

    expect(result).toMatchObject({
      status: 'INVALID_EVIDENCE',
      valid: false,
      passed: false,
      releaseEligible: false,
      contractComplete: false,
    })
  })
})
