import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assertArchiveLifecycleSmokeEvidenceOmitsSecrets,
  buildArchiveLifecycleSmokeCiEnvironment,
  buildArchiveLifecycleSmokeCiRunnerArgs,
  parseArchiveLifecycleSmokeArgs,
  resolvePackagedApplicationArchivePath,
  validateArchiveLifecycleSmokeEvidence,
} from '../../build/electron-archive-lifecycle-smoke-lib.js'

const HEAD = 'a'.repeat(40)
const TREE = 'b'.repeat(40)
const SHA256 = 'c'.repeat(64)

/** Returns one complete exact-head packaged archive-lifecycle proof. */
function completeEvidence(): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    proofKind: 'packaged-electron-archive-lifecycle-v1',
    source: {
      expectedHead: HEAD,
      headBefore: HEAD,
      headAfter: HEAD,
      treeBefore: TREE,
      treeAfter: TREE,
      worktreeCleanBefore: true,
      worktreeCleanAfter: true,
      packagedExecutableSha256: SHA256,
      packagedApplicationArchiveSha256: SHA256,
      packagedBuildHeadMatched: true,
    },
    run: {
      startedAt: '2026-08-30T08:00:00.000Z',
      finishedAt: '2026-08-30T08:02:00.000Z',
      durationMs: 120_000,
      platform: 'linux',
      architecture: 'x64',
      nodeVersion: 'v22.18.0',
      launchCount: 2,
      observedLaunchExitCount: 2,
    },
    mission: {
      missionId: 'mission-packaged-proof',
      missionNameSha256: SHA256,
      createdStatus: 'active',
      finishedStatus: 'finished',
      finalizedStatus: 'finalized',
      seededPositionRows: 4_096,
    },
    archive: {
      archiveId: 'archive-packaged-proof',
      containerVersion: 2,
      statusAfterFinalize: 'verified',
      statusAfterIndependentVerify: 'verified',
      availability: 'present',
      ciphertextSha256: SHA256,
      sizeBytes: 9_001,
      createProgressPhases: ['encrypt', 'publish', 'seal', 'snapshot', 'staged'],
      verifyProgressPhases: [
        'decrypt',
        'inventory',
        'plaintext_cleanup',
        'replay',
        'verified',
      ],
    },
    reviewBeforeCleanup: {
      opened: true,
      immutable: true,
      verified: true,
      plaintextResidual: 'permission_restricted_session_open',
      contentSha256: SHA256,
      archiveIdMatched: true,
      readMissionIdMatched: true,
      breadcrumbCount: 4_096,
      openResidualFileCount: 1,
      openDirectoriesOwnerOnly: true,
      openFilesOwnerOnly: true,
      openPrivacyCanaryDetected: true,
      mutationAttempt: 'upsertMarker',
      mutationBoundary: 'preload_read_only',
      mutationDenied: true,
      denialAudited: true,
      closed: true,
      residualEntriesAfterClose: 0,
    },
    interruptedRestore: {
      supported: true,
      progressTriggered: true,
      triggerPhase: 'decrypt',
      killSignalRequested: 'SIGKILL',
      exitSignal: 'SIGKILL',
      residualEntriesBeforeRestart: 2,
      plaintextFileObservedBeforeRestart: true,
      privacyCanaryDetectedBeforeRestart: true,
      restartSweepCompleted: true,
      residualEntriesAfterRestart: 0,
    },
    cleanup: {
      eligibilityChecked: true,
      eligibleBeforeCredential: false,
      freshCredentialOnlyBlocker: true,
      completed: true,
      storageState: 'archived',
      movedRows: 4_100,
      remainingBreadcrumbRows: 0,
    },
    reviewAfterCleanup: {
      opened: true,
      immutable: true,
      verified: true,
      plaintextResidual: 'permission_restricted_session_open',
      contentSha256: SHA256,
      archiveIdMatched: true,
      readMissionIdMatched: true,
      breadcrumbCount: 4_096,
      openResidualFileCount: 1,
      openDirectoriesOwnerOnly: true,
      openFilesOwnerOnly: true,
      openPrivacyCanaryDetected: true,
      mutationAttempt: 'upsertMarker',
      mutationBoundary: 'preload_read_only',
      mutationDenied: true,
      denialAudited: true,
      closed: true,
      residualEntriesAfterClose: 0,
    },
    privacy: {
      secretsProvidedOnlyViaPreload: true,
      secretsAbsentFromProcessArguments: true,
      secretsAbsentFromEvidence: true,
      exactSecretScanFiles: 8,
      exactSecretMatches: 0,
      plaintextResidueEntriesAtEnd: 0,
    },
    verdict: { passed: true, failureReasons: [] },
  }
}

describe('packaged Electron archive-lifecycle smoke helpers [DON-248/DON-252/DON-253]', () => {
  it('parses an absolute, exact-head runner command without accepting custody material', () => {
    expect(parseArchiveLifecycleSmokeArgs([
      '--app',
      '/tmp/sartracker-web',
      '--evidence',
      '/tmp/archive-smoke',
      '--expected-head',
      HEAD,
      '--seed-position-rows',
      '2048',
      '--timeout-ms',
      '240000',
      '--',
      '--no-sandbox',
    ])).toEqual({
      appPath: '/tmp/sartracker-web',
      evidenceDir: '/tmp/archive-smoke',
      expectedHead: HEAD,
      seedPositionRows: 2_048,
      timeoutMs: 240_000,
      extraArgs: ['--no-sandbox'],
    })

    expect(() => parseArchiveLifecycleSmokeArgs([])).toThrow(/--app/iu)
    expect(() => parseArchiveLifecycleSmokeArgs([
      '--app', 'relative-app', '--evidence', '/tmp/e', '--expected-head', HEAD,
    ])).toThrow(/absolute/iu)
    expect(() => parseArchiveLifecycleSmokeArgs([
      '--app', '/tmp/app', '--evidence', 'relative-evidence', '--expected-head', HEAD,
    ])).toThrow(/absolute/iu)
    expect(() => parseArchiveLifecycleSmokeArgs([
      '--app', '/tmp/app', '--evidence', '/tmp/e', '--expected-head', 'main',
    ])).toThrow(/head/iu)
    expect(() => parseArchiveLifecycleSmokeArgs([
      '--app', '/tmp/app', '--evidence', '/tmp/e', '--expected-head', HEAD,
      '--passphrase', 'must-never-be-cli-input',
    ])).toThrow(/unknown|custody|argument/iu)
    expect(() => parseArchiveLifecycleSmokeArgs([
      '--app', '/tmp/app', '--evidence', '/tmp/e', '--expected-head', HEAD,
      '--', '--archive-secret=must-never-be-forwarded',
    ])).toThrow(/secret|credential|custody/iu)
  })

  it('builds a deterministic exact-head CI invocation and Linux-only renderer environment', () => {
    expect(buildArchiveLifecycleSmokeCiRunnerArgs({
      appPath: '/tmp/sartracker-web',
      expectedHead: HEAD,
      platform: 'linux',
      projectRoot: '/repo',
    })).toEqual([
      '/repo/scripts/electron-archive-lifecycle-smoke.mjs',
      '--app',
      '/tmp/sartracker-web',
      '--evidence',
      '/repo/tmp/breadcrumb-pr6-packaged-archive-smoke',
      '--expected-head',
      HEAD,
      '--',
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=gl',
      '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ])
    expect(buildArchiveLifecycleSmokeCiEnvironment({
      environment: { DISPLAY: ':99', EXISTING: 'preserved' },
      platform: 'linux',
    })).toEqual({
      DISPLAY: ':99',
      EXISTING: 'preserved',
      LIBGL_ALWAYS_SOFTWARE: '1',
      GALLIUM_DRIVER: 'llvmpipe',
    })
    expect(buildArchiveLifecycleSmokeCiEnvironment({
      environment: { EXISTING: 'preserved' },
      platform: 'darwin',
    })).toEqual({ EXISTING: 'preserved' })
  })

  it('binds the packaged application archive separately from its platform wrapper', () => {
    expect(resolvePackagedApplicationArchivePath(
      '/repo/tmp/electron-dist/linux-unpacked/sartracker-web',
      'linux',
    )).toBe('/repo/tmp/electron-dist/linux-unpacked/resources/app.asar')
    expect(resolvePackagedApplicationArchivePath(
      '/repo/tmp/electron-dist/mac-arm64/SAR Tracker Electron Validation.app/Contents/MacOS/SAR Tracker Electron Validation',
      'darwin',
    )).toBe(
      '/repo/tmp/electron-dist/mac-arm64/SAR Tracker Electron Validation.app/Contents/Resources/app.asar',
    )
  })

  it('accepts only a complete, exact-head, restart-swept lifecycle proof', () => {
    expect(validateArchiveLifecycleSmokeEvidence(completeEvidence())).toEqual({
      valid: true,
      passed: true,
      failureReasons: [],
    })
  })

  it('proves the verifier integrated into finalization without retrying an already verified archive', () => {
    const runnerSource = readFileSync(
      path.resolve('scripts/electron-archive-lifecycle-smoke.mjs'),
      'utf8',
    )
    expect(runnerSource).not.toContain('.verifyMissionArchive(')

    const evidence = completeEvidence() as Record<string, Record<string, unknown>>
    const conflated = {
      ...evidence,
      archive: {
        ...evidence.archive,
        createProgressPhases: ['encrypt', 'publish', 'snapshot', 'verified'],
      },
    }
    expect(validateArchiveLifecycleSmokeEvidence(conflated).failureReasons.join('\n'))
      .toMatch(/create.*seal/iu)
  })

  it('binds CI to the workflow exact-source variable instead of the pull-request merge SHA', () => {
    const runnerSource = readFileSync(
      path.resolve('scripts/electron-archive-lifecycle-smoke-ci.mjs'),
      'utf8',
    )
    expect(runnerSource).toContain('process.env.EXPECTED_SOURCE_SHA')
    expect(runnerSource).not.toContain('process.env.GITHUB_SHA')
  })

  it('counts every app-owned archive plaintext scratch root in the terminal residue claim', () => {
    const runnerSource = readFileSync(
      path.resolve('scripts/electron-archive-lifecycle-smoke.mjs'),
      'utf8',
    )
    expect(runnerSource).toContain("path.join(userDataDir, 'archives', '.staging')")
    expect(runnerSource).toContain("path.join(userDataDir, 'archives', '.verification')")
    expect(runnerSource).toContain("path.join(userDataDir, 'archive-review')")
  })

  it('observes packaged build identity, live Review permissions/content, and child exit', () => {
    const runnerSource = readFileSync(
      path.resolve('scripts/electron-archive-lifecycle-smoke.mjs'),
      'utf8',
    )
    expect(runnerSource).toContain('resolvePackagedApplicationArchivePath')
    expect(runnerSource).toContain('options.expectedHead')
    expect(runnerSource).toContain('openFilesOwnerOnly')
    expect(runnerSource).toContain("method: 'upsertMarker'")
    expect(runnerSource).toContain('remainingBreadcrumbRows')
    expect(runnerSource).toContain('privacyCanaryDetectedBeforeRestart')
    expect(runnerSource).toContain('observedLaunchExitCount')
  })

  it('keeps the disposable profile outside the evidence upload tree and sweeps it', () => {
    const runnerSource = readFileSync(
      path.resolve('scripts/electron-archive-lifecycle-smoke.mjs'),
      'utf8',
    )
    expect(runnerSource).toContain("mkdtemp(path.join(os.tmpdir(), 'sartracker-pr6-archive-smoke-'))")
    expect(runnerSource).not.toContain("path.join(options.evidenceDir, 'user-data')")
    expect(runnerSource).toContain('await removeDisposableProfile(userDataDir)')
    expect(runnerSource.indexOf('await removeDisposableProfile(userDataDir)'))
      .toBeLessThan(runnerSource.indexOf("'electron-archive-lifecycle-smoke-report.json'"))
  })

  it.each([
    ['source head drift', { source: { headAfter: 'd'.repeat(40) } }, /head/iu],
    ['dirty source', { source: { worktreeCleanAfter: false } }, /clean/iu],
    ['stale packaged app', { source: { packagedBuildHeadMatched: false } }, /packaged.*head/iu],
    ['invalid app archive hash', { source: { packagedApplicationArchiveSha256: 'bad' } }, /application.*archive/iu],
    ['unobserved launch exit', { run: { observedLaunchExitCount: 1 } }, /launch.*exit/iu],
    ['no independent verify', { archive: { statusAfterIndependentVerify: 'sealed' } }, /independent.*verif/iu],
    ['no pre-cleanup mutation denial', { reviewBeforeCleanup: { mutationDenied: false } }, /mutation/iu],
    ['pre-cleanup content drift', { reviewBeforeCleanup: { contentSha256: 'd'.repeat(64) } }, /content.*changed|review.*changed/iu],
    ['world-readable Review files', { reviewBeforeCleanup: { openFilesOwnerOnly: false } }, /permission|owner/iu],
    ['restored content count drift', { reviewBeforeCleanup: { breadcrumbCount: 4_095 } }, /breadcrumb.*seeded/iu],
    ['cleanup did not archive', { cleanup: { storageState: 'live' } }, /cleanup|archived/iu],
    ['cleanup retained breadcrumbs', { cleanup: { remainingBreadcrumbRows: 1 } }, /breadcrumb.*remain/iu],
    ['no post-cleanup read', { reviewAfterCleanup: { readMissionIdMatched: false } }, /post-cleanup|mission/iu],
    ['kill not progress-triggered', { interruptedRestore: { progressTriggered: false } }, /progress/iu],
    ['wrong kill signal', { interruptedRestore: { exitSignal: 'SIGTERM' } }, /SIGKILL/iu],
    ['no interrupted residual', { interruptedRestore: { residualEntriesBeforeRestart: 0 } }, /residual.*before/iu],
    ['no interrupted plaintext file', { interruptedRestore: { plaintextFileObservedBeforeRestart: false } }, /plaintext.*before/iu],
    ['restart left residue', { interruptedRestore: { residualEntriesAfterRestart: 1 } }, /restart.*residu/iu],
    ['final plaintext residue', { privacy: { plaintextResidueEntriesAtEnd: 1 } }, /plaintext.*residu/iu],
  ])('fails closed for %s', (_label, patch, expected) => {
    const base = completeEvidence() as Record<string, Record<string, unknown>>
    const [section, update] = Object.entries(patch)[0] as [string, Record<string, unknown>]
    const evidence = { ...base, [section]: { ...base[section], ...update } }
    const verdict = validateArchiveLifecycleSmokeEvidence(evidence)
    expect(verdict.passed).toBe(false)
    expect(verdict.failureReasons.join('\n')).toMatch(expected)
  })

  it('rejects unknown fields, absolute paths, recovery codes, and exact in-memory secrets', () => {
    const evidence = completeEvidence()
    expect(validateArchiveLifecycleSmokeEvidence({
      ...evidence,
      archivePath: '/private/tmp/mission.sararch',
    }).failureReasons.join('\n')).toMatch(/unknown|path/iu)
    expect(validateArchiveLifecycleSmokeEvidence({
      ...evidence,
      privacy: {
        ...(evidence.privacy as Readonly<Record<string, unknown>>),
        recoveryCode: '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567',
      },
    }).failureReasons.join('\n')).toMatch(/unknown|recovery|secret/iu)

    expect(() => assertArchiveLifecycleSmokeEvidenceOmitsSecrets(
      evidence,
      ['Generated!Passphrase2026', '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'],
    )).not.toThrow()
    expect(() => assertArchiveLifecycleSmokeEvidenceOmitsSecrets(
      { ...evidence, leaked: 'Generated!Passphrase2026' },
      ['Generated!Passphrase2026'],
    )).toThrow(/secret|custody/iu)
  })
})
