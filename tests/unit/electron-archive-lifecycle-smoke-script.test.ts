import { readFileSync } from 'node:fs'
import { access, lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  cleanupArchiveLifecycleResources,
  writeArchiveLifecycleFailureReceipt,
  writeArchiveLifecycleSuccessReport,
} from '../../scripts/electron-archive-lifecycle-smoke.mjs'

const runnerPath = path.resolve('scripts/electron-archive-lifecycle-smoke.mjs')
const workflowPath = path.resolve('.github/workflows/electron-linux-validation.yml')

describe('packaged archive-lifecycle process-faithful liveness runner [DON-252 / BCP-15]', () => {
  it('uses the real packaged tracking and MapLibre path under two external watchdogs', () => {
    const source = readFileSync(runnerPath, 'utf8')

    expect(source).toContain('startArchiveLifecycleLivenessMockTraccarServer')
    expect(source).toContain('SARTRACKER_ELECTRON_SOAK_POLL_INTERVAL_MS')
    expect(source).toContain('`--inspect=${inspectorPort}`')
    expect(source).toContain('connectMainInspector')
    expect(source).toContain('installRendererLivenessProbe')
    expect(source).toContain("getSource('tracking')")
    expect(source).toContain('source.updateData =')
    expect(source).toContain('requestAnimationFrame')
    expect(source).toContain("mainInspector.evaluate('process.uptime()')")
  })

  it('emits the strict v2 phase aggregate and never substitutes direct database timing', () => {
    const source = readFileSync(runnerPath, 'utf8')

    expect(source).toContain('schemaVersion: 2')
    expect(source).toContain("proofKind: 'packaged-electron-archive-lifecycle-v2'")
    expect(source).toContain("provenance: 'packaged-electron-external-watchdog-v1'")
    expect(source).toContain("mode: 'time-compressed-validation'")
    for (const field of [
      'sampleCount',
      'currentFixMaxGapMs',
      'sourceToRendererMaxMs',
      'requestToRendererMaxMs',
      'mainWatchdogMaxGapMs',
      'rendererFrameMaxGapMs',
    ]) expect(source).toContain(field)
    for (const phase of ['create', 'verify', 'restore', 'cleanup']) {
      expect(source).toContain(`'${phase}'`)
    }
    expect(source).not.toContain('inspectDatabase(')
  })

  it('binds the post-cleanup archive review to a fresh restore operation', () => {
    const source = readFileSync(runnerPath, 'utf8')
    const reviewStart = source.indexOf('const secondReview =')
    const reviewEnd = source.indexOf('const postCleanup =', reviewStart)
    const reviewFlow = source.slice(
      source.lastIndexOf("await livenessProbe.setPhase('cleanup')", reviewStart),
      reviewEnd,
    )

    expect(reviewStart).toBeGreaterThan(0)
    expect(reviewEnd).toBeGreaterThan(reviewStart)
    expect(reviewFlow).toContain("await livenessProbe.setPhase('restore')")
    expect(reviewFlow).toContain("beginPhaseOperation('restore')")
    expect(reviewFlow).toContain('), secondReviewOperation)')
    expect(reviewFlow).toContain('completePhaseOperation(secondReviewOperation)')
  })

  it('ends terminal liveness monitoring before unrelated post-cleanup inspection', () => {
    const source = readFileSync(runnerPath, 'utf8')
    const reviewCompleted = source.indexOf('completePhaseOperation(secondReviewOperation)')
    const detached = source.indexOf('livenessProbe.detachLaunch(restartedLaunch)', reviewCompleted)
    const postCleanup = source.indexOf('assertPostCleanupState({', reviewCompleted)

    expect(reviewCompleted).toBeGreaterThan(0)
    expect(detached).toBeGreaterThan(reviewCompleted)
    expect(postCleanup).toBeGreaterThan(detached)
  })

  it('publishes and always uploads one bounded failure receipt', () => {
    const source = readFileSync(runnerPath, 'utf8')
    const workflow = readFileSync(workflowPath, 'utf8')
    const protectedSetupStart = source.indexOf('let profileCleanupCompleted = false')
    const lifecycleTry = source.indexOf('try {', protectedSetupStart)
    const profileAllocation = source.indexOf('userDataDir = await mkdtemp', lifecycleTry)
    const packagedArchiveCheck = source.indexOf(
      'packagedApplicationArchivePath = resolvePackagedApplicationArchivePath',
      lifecycleTry,
    )
    const cleanupLoop = source.indexOf(
      'const cleanup = await cleanupArchiveLifecycleResources({',
      lifecycleTry,
    )
    const failurePublish = source.indexOf(
      'writeArchiveLifecycleFailureReceipt({',
      cleanupLoop,
    )

    expect(source).toContain('electron-archive-lifecycle-smoke-failure.json')
    expect(source).toContain('writeArchiveLifecycleFailureReceipt')
    expect(source).toContain('archiveLifecycleDiagnostics')
    expect(lifecycleTry).toBeGreaterThan(protectedSetupStart)
    expect(profileAllocation).toBeGreaterThan(lifecycleTry)
    expect(packagedArchiveCheck).toBeGreaterThan(profileAllocation)
    expect(cleanupLoop).toBeGreaterThan(packagedArchiveCheck)
    expect(failurePublish).toBeGreaterThan(cleanupLoop)
    expect(workflow).toContain(
      'tmp/breadcrumb-pr6-packaged-archive-smoke/electron-archive-lifecycle-smoke-failure.json',
    )
    expect(source).not.toContain('}).catch(() => null)')
    expect(workflow).toContain('Verify archive lifecycle terminal evidence')
    expect(workflow).toContain('terminalArtifacts.length !== 1')
  })

  it('keeps the disposable profile and retry ownership after a launch stop failure', async () => {
    const launchStopFailure = new Error('Electron shutdown timed out.')
    const removeProfile = vi.fn(async () => undefined)
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-lifecycle-cleanup-'))
    const cleanup = await cleanupArchiveLifecycleResources({
      failure: null,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-owned',
      removeProfile,
      steps: [
        { blocksProfileCleanup: false, run: async () => undefined },
        { blocksProfileCleanup: true, run: async () => { throw launchStopFailure } },
        { blocksProfileCleanup: false, run: async () => undefined },
      ],
    })

    expect(removeProfile).not.toHaveBeenCalled()
    expect(cleanup).toMatchObject({
      failure: launchStopFailure,
      processCleanupCompleted: false,
      profileCleanupCompleted: false,
      cleanupFailureCount: 1,
    })

    try {
      const failurePath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: cleanup.failure,
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 1,
        processCleanupCompleted: cleanup.processCleanupCompleted,
        profileCleanupCompleted: cleanup.profileCleanupCompleted,
        cleanupFailureCount: cleanup.cleanupFailureCount,
        secrets: [],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })

      expect(JSON.parse(await readFile(failurePath, 'utf8'))).toMatchObject({
        cleanup: {
          cleanupFailureCount: 1,
          processCleanupCompleted: false,
          profileCleanupCompleted: false,
        },
        verdict: { passed: false },
      })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }

    const source = readFileSync(runnerPath, 'utf8')
    expect(source).toContain('if (cleanup.processCleanupCompleted) activeLaunch = null')
  })

  it('atomically publishes exactly one success or failure terminal artifact', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-lifecycle-terminal-'))
    const successPath = path.join(evidenceDir, 'electron-archive-lifecycle-smoke-report.json')
    const failurePath = path.join(evidenceDir, 'electron-archive-lifecycle-smoke-failure.json')
    try {
      await writeFile(failurePath, '{"stale":true}\n', { mode: 0o600 })
      await writeArchiveLifecycleSuccessReport({
        evidenceDir,
        evidence: { verdict: { passed: true } },
      })

      expect(JSON.parse(await readFile(successPath, 'utf8'))).toEqual({
        verdict: { passed: true },
      })
      await expect(access(failurePath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await readdir(evidenceDir)).filter((entry) => entry.startsWith('.'))).toEqual([])

      await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: new Error('Lifecycle failed.'),
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 2,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 0,
        secrets: [],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })

      await expect(access(successPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(JSON.parse(await readFile(failurePath, 'utf8'))).toMatchObject({
        verdict: { passed: false },
      })
      expect((await readdir(evidenceDir)).filter((entry) => entry.startsWith('.'))).toEqual([])
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('does not leave a partial success artifact when atomic publication fails', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-lifecycle-atomic-'))
    const failurePath = path.join(evidenceDir, 'electron-archive-lifecycle-smoke-failure.json')
    const publicationFailure = new Error('Injected terminal rename failure.')
    try {
      await writeFile(failurePath, '{"stale":true}\n', { mode: 0o600 })
      await expect(writeArchiveLifecycleSuccessReport({
        evidenceDir,
        evidence: { verdict: { passed: true } },
      }, {
        rename: async () => { throw publicationFailure },
      })).rejects.toBe(publicationFailure)

      expect(await readFile(failurePath, 'utf8')).toBe('{"stale":true}\n')
      expect(await readdir(evidenceDir)).toEqual([
        'electron-archive-lifecycle-smoke-failure.json',
      ])
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('atomically writes a sanitized mode-0600 liveness failure receipt', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-lifecycle-failure-'))
    const secret = 'Synthetic Receipt Secret 2026!'
    const error = new Error(`Gate failed for ${secret} at ${evidenceDir}/private-profile`)
    Object.defineProperty(error, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({
        errorKinds: ['current_fix_continuity_gate_breached'],
        activePhase: 'restore',
        activeLaunchNumber: 2,
        currentFixContinuity: Object.freeze({
          phase: 'restore',
          gapMs: 200,
          intervalStartedAtMs: 100,
          previousObservedAtMs: 150,
          auditedAtMs: 350,
        }),
        currentFixTimeout: null,
        operationCount: 0,
        operationOverflowCount: 0,
        operations: Object.freeze([]),
        phaseMetrics: Object.freeze({}),
      }),
    })
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error,
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 2,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 0,
        secrets: [secret],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })
      const receipt = JSON.parse(await readFile(reportPath, 'utf8'))

      expect((await lstat(reportPath)).mode & 0o777).toBe(0o600)
      expect(receipt).toMatchObject({
        schemaVersion: 1,
        proofKind: 'packaged-electron-archive-lifecycle-failure-v1',
        failure: {
          classification: 'external_liveness_gate_failure',
          archiveLifecycleDiagnostics: {
            errorKinds: ['current_fix_continuity_gate_breached'],
            activePhase: 'restore',
          },
        },
        cleanup: { profileCleanupCompleted: true },
        verdict: { passed: false },
      })
      expect(JSON.stringify(receipt)).not.toContain(secret)
      expect(JSON.stringify(receipt)).not.toContain(evidenceDir)
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('redacts complete quoted and unquoted absolute paths containing spaces', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-lifecycle-spaced-path-'))
    const privatePath = '/Users/Private Operator/Builds/SAR Tracker.app/Contents/Resources/app.asar'
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: new Error(`ENOENT: no such file, lstat '${privatePath}'`),
        expectedHead: 'e'.repeat(40),
        observedLaunchCount: 0,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 0,
        secrets: [],
        sourceBefore: {
          head: 'e'.repeat(40),
          tree: 'f'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })
      const serialized = await readFile(reportPath, 'utf8')

      expect(serialized).not.toContain(privatePath)
      expect(serialized).not.toContain('Private Operator')
      expect(serialized).not.toContain('Tracker.app')
      expect(JSON.parse(serialized)).toMatchObject({
        failure: { message: "ENOENT: no such file, lstat '[PATH]'" },
      })

      const unquotedReportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: new Error(`Could not inspect ${privatePath} while publishing evidence.`),
        expectedHead: 'e'.repeat(40),
        observedLaunchCount: 0,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 0,
        secrets: [],
        sourceBefore: {
          head: 'e'.repeat(40),
          tree: 'f'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })
      const unquotedReceipt = JSON.parse(await readFile(unquotedReportPath, 'utf8'))

      expect(unquotedReceipt.failure.message).toBe('Could not inspect [PATH]')
      expect(JSON.stringify(unquotedReceipt)).not.toContain('Private Operator')
      expect(JSON.stringify(unquotedReceipt)).not.toContain('Tracker.app')
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('writes a setup-failure receipt before custody values exist', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-lifecycle-setup-failure-'))
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: new Error('Packaged application archive is unavailable.'),
        expectedHead: 'c'.repeat(40),
        observedLaunchCount: 0,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 0,
        secrets: [],
        sourceBefore: {
          head: 'c'.repeat(40),
          tree: 'd'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })

      expect(JSON.parse(await readFile(reportPath, 'utf8'))).toMatchObject({
        failure: { classification: 'lifecycle_failure' },
        cleanup: { profileCleanupCompleted: true },
        verdict: { passed: false },
      })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })
})
