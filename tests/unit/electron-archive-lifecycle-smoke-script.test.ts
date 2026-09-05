import { readFileSync } from 'node:fs'
import { access, lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  cleanupArchiveLifecycleResources,
  isExactLivenessParticipantReady,
  waitForActiveMission,
  waitForExactLivenessParticipant,
  writeArchiveLifecycleFailureReceipt,
  writeArchiveLifecycleSuccessReport,
} from '../../scripts/electron-archive-lifecycle-smoke.mjs'

const runnerPath = path.resolve('scripts/electron-archive-lifecycle-smoke.mjs')
const workflowPath = path.resolve('.github/workflows/electron-linux-validation.yml')

/** Builds one internally consistent terminal-receipt input for adversarial tests. */
function createFailureReceiptInput(
  evidenceDir: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    evidenceDir,
    error: new Error('Primary lifecycle failure.'),
    expectedHead: 'a'.repeat(40),
    observedLaunchCount: 1,
    processCleanupCompleted: true,
    profileCleanupCompleted: true,
    cleanupFailureCount: 0,
    cleanupFailures: [],
    secrets: [],
    sourceBefore: {
      head: 'a'.repeat(40),
      tree: 'b'.repeat(40),
      clean: true,
    },
    startedAtMs: Date.now() - 10,
    ...overrides,
  }
}

describe('packaged archive-lifecycle process-faithful liveness runner [DON-252 / BCP-15]', () => {
  it('does not arm liveness from the participant empty-state placeholder', () => {
    const exactParticipant = {
      kind: 'device',
      removed_at: null,
      traccar_device_id: '991',
    }
    const exactRenderedParticipant = {
      kind: 'device',
      traccarDeviceId: '991',
    }

    expect(isExactLivenessParticipantReady({
      renderedParticipants: [],
      participants: [exactParticipant],
    }, 991)).toBe(false)
    expect(isExactLivenessParticipantReady({
      renderedParticipants: [exactRenderedParticipant],
      participants: [exactParticipant],
    }, 991)).toBe(true)
    for (const snapshot of [
      {
        renderedParticipants: [{ ...exactRenderedParticipant, traccarDeviceId: '992' }],
        participants: [exactParticipant],
      },
      {
        renderedParticipants: [{ kind: 'group', traccarDeviceId: null }],
        participants: [exactParticipant],
      },
      {
        renderedParticipants: [exactRenderedParticipant, exactRenderedParticipant],
        participants: [exactParticipant],
      },
      {
        renderedParticipants: [exactRenderedParticipant],
        participants: [{ ...exactParticipant, traccar_device_id: '992' }],
      },
      {
        renderedParticipants: [exactRenderedParticipant],
        participants: [{ ...exactParticipant, removed_at: '2026-09-05T01:40:35.000Z' }],
      },
      {
        renderedParticipants: [exactRenderedParticipant],
        participants: [{ ...exactParticipant, kind: 'group', traccar_device_id: null }],
      },
      {
        renderedParticipants: [exactRenderedParticipant],
        participants: [exactParticipant, { ...exactParticipant }],
      },
    ]) {
      expect(isExactLivenessParticipantReady(snapshot, 991)).toBe(false)
    }

    const source = readFileSync(runnerPath, 'utf8')
    const participantWait = source.slice(
      source.indexOf('async function waitForExactLivenessParticipant('),
      source.indexOf('/** Waits until the backend and renderer agree', source.indexOf(
        'async function waitForExactLivenessParticipant(',
      )),
    )
    expect(participantWait).toContain("querySelectorAll(':scope > .sar-readout')")
    expect(participantWait).toContain("getAttribute('data-participant-kind')")
    expect(participantWait).toContain("getAttribute('data-traccar-device-id')")
    expect(participantWait).toContain('.listMissionParticipants?.(expectedMissionId)')
    expect(participantWait).toContain('isExactLivenessParticipantReady(')
    expect(participantWait).not.toContain('.children.length')
  })

  it('fails closed when the participant readiness IPC read never settles', async () => {
    vi.useFakeTimers()
    try {
      const page = {
        evaluate: vi.fn(() => new Promise(() => undefined)),
      }
      const readiness = waitForExactLivenessParticipant(
        page,
        '00000000-0000-4000-8000-000000000001',
        991,
        30,
      )
      const rejection = expect(readiness).rejects.toThrow(
        'Archive-lifecycle liveness participant readiness read timed out.',
      )

      await vi.advanceTimersByTimeAsync(31)
      await rejection
      expect(page.evaluate).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('hydrates the recovered participant before launch-two liveness attachment', () => {
    const source = readFileSync(runnerPath, 'utf8')
    const restartStart = source.indexOf('restartedLaunch = await launchPackagedApp')
    const resume = source.indexOf('await resumeLivenessMission(', restartStart)
    const attach = source.indexOf('await livenessProbe.attachLaunch(restartedLaunch)', restartStart)
    const restoredOperation = source.indexOf(
      'const resumedRestoreOperation = await livenessProbe.beginPhaseOperation(',
      restartStart,
    )

    expect(restartStart).toBeGreaterThan(0)
    expect(resume).toBeGreaterThan(restartStart)
    expect(source.slice(resume, attach)).toContain('livenessMission.mission.id')
    expect(attach).toBeGreaterThan(resume)
    expect(restoredOperation).toBeGreaterThan(attach)
  })

  it('rejects a same-name active mission decoy after restart', async () => {
    const expectedMissionId = '00000000-0000-4000-8000-000000000001'
    const page = {
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => ({
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Packaged Archive Liveness Probe',
        status: 'active',
      })),
    }

    await expect(waitForActiveMission(
      page,
      'Packaged Archive Liveness Probe',
      30_000,
      expectedMissionId,
    )).rejects.toThrow('exact expected identity')
    expect(page.waitForFunction).toHaveBeenCalledWith(
      expect.any(Function),
      { name: 'Packaged Archive Liveness Probe', id: expectedMissionId },
      { timeout: expect.any(Number) },
    )
    const timeout = page.waitForFunction.mock.calls[0]?.[2]?.timeout
    expect(timeout).toBeGreaterThan(0)
    expect(timeout).toBeLessThanOrEqual(30_000)
  })

  it('accepts the exact active mission identity after restart', async () => {
    const expectedMission = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Packaged Archive Liveness Probe',
      status: 'active',
    }
    const page = {
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => expectedMission),
    }

    await expect(waitForActiveMission(
      page,
      expectedMission.name,
      30_000,
      expectedMission.id,
    )).resolves.toEqual(expectedMission)
  })

  it('fails closed when the active mission confirmation IPC read never settles', async () => {
    vi.useFakeTimers()
    try {
      const page = {
        waitForFunction: vi.fn(async () => undefined),
        evaluate: vi.fn(() => new Promise(() => undefined)),
      }
      const readiness = waitForActiveMission(
        page,
        'Packaged Archive Liveness Probe',
        30,
        '00000000-0000-4000-8000-000000000001',
      )
      const rejection = expect(readiness).rejects.toThrow(
        'Archive-lifecycle liveness mission confirmation read timed out.',
      )

      await vi.advanceTimersByTimeAsync(31)
      await rejection
      expect(page.waitForFunction).toHaveBeenCalledTimes(1)
      expect(page.evaluate).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

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
    expect(reviewFlow).toContain('const secondReviewOperation = await livenessProbe.beginPhaseOperation(')
    expect(reviewFlow).toContain("'review_after_cleanup'")
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
        { name: 'liveness_probe_stop', blocksProfileCleanup: false, run: async () => undefined },
        {
          name: 'restarted_launch_stop',
          blocksProfileCleanup: true,
          run: async () => { throw launchStopFailure },
        },
        { name: 'mock_server_close', blocksProfileCleanup: false, run: async () => undefined },
      ],
    })

    expect(removeProfile).not.toHaveBeenCalled()
    expect(cleanup).toMatchObject({
      failure: launchStopFailure,
      processCleanupCompleted: false,
      profileCleanupCompleted: false,
      cleanupFailureCount: 1,
      cleanupFailures: [{
        step: 'restarted_launch_stop',
        error: launchStopFailure,
      }],
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
        cleanupFailures: cleanup.cleanupFailures,
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
          failures: [{
            step: 'restarted_launch_stop',
            classification: 'cleanup_failure',
            message: 'Electron shutdown timed out.',
            archiveLifecycleDiagnostics: null,
          }],
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

  it('counts only a genuinely new liveness finalization failure during cleanup', async () => {
    const primaryFailure = new Error('Primary liveness failure.')
    Object.defineProperty(primaryFailure, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({
        errorKinds: ['source_identity_left_pending_at_operation_start'],
        activePhase: 'create',
      }),
    })
    const evolvedFailure = new Error('Evolved liveness stop failure.')
    Object.defineProperty(evolvedFailure, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({
        errorKinds: [
          'current_fix_not_observed_before_gate',
          'source_identity_left_pending_at_operation_start',
        ],
        activePhase: 'create',
      }),
    })
    const removeProfile = vi.fn(async () => undefined)
    const repeated = await cleanupArchiveLifecycleResources({
      failure: primaryFailure,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-repeat',
      removeProfile,
      steps: [{
        name: 'liveness_probe_stop',
        blocksProfileCleanup: false,
        run: async () => { throw primaryFailure },
      }],
    })

    expect(repeated).toMatchObject({
      failure: primaryFailure,
      cleanupFailureCount: 0,
      cleanupFailures: [],
      processCleanupCompleted: true,
      profileCleanupCompleted: true,
    })

    const withNewFailure = await cleanupArchiveLifecycleResources({
      failure: primaryFailure,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-new-stop',
      removeProfile,
      steps: [{
        name: 'liveness_probe_stop',
        blocksProfileCleanup: false,
        run: async () => { throw evolvedFailure },
      }],
    })
    expect(withNewFailure).toMatchObject({
      failure: primaryFailure,
      cleanupFailureCount: 1,
      cleanupFailures: [{
        step: 'liveness_probe_stop',
        error: evolvedFailure,
      }],
      processCleanupCompleted: true,
      profileCleanupCompleted: true,
    })
    expect(readFileSync(runnerPath, 'utf8')).toContain(
      'run: () => livenessProbe?.stop(lifecycleFailure)',
    )
  })

  it('does not suppress a primary error object replayed by a different cleanup step', async () => {
    const primaryFailure = new Error('Primary lifecycle failure.')
    const cleanup = await cleanupArchiveLifecycleResources({
      failure: primaryFailure,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-launch-replay',
      removeProfile: async () => undefined,
      steps: [{
        name: 'restarted_launch_stop',
        blocksProfileCleanup: true,
        run: async () => { throw primaryFailure },
      }],
    })

    expect(cleanup).toMatchObject({
      failure: primaryFailure,
      cleanupFailureCount: 1,
      cleanupFailures: [{ step: 'restarted_launch_stop', error: primaryFailure }],
      processCleanupCompleted: false,
      profileCleanupCompleted: false,
    })
  })

  it('normalizes null and undefined cleanup-step rejections into non-null failures', async () => {
    const removeProfile = vi.fn(async () => undefined)
    const cleanup = await cleanupArchiveLifecycleResources({
      failure: null,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-nullish-steps',
      removeProfile,
      steps: [
        {
          name: 'liveness_probe_stop',
          blocksProfileCleanup: false,
          run: async () => { throw null },
        },
        {
          name: 'restarted_launch_stop',
          blocksProfileCleanup: true,
          run: async () => Promise.reject(undefined),
        },
      ],
    })

    expect(removeProfile).not.toHaveBeenCalled()
    expect(cleanup.failure).toBeInstanceOf(Error)
    expect(cleanup.cleanupFailures).toHaveLength(2)
    expect(cleanup.cleanupFailures).toEqual([
      {
        step: 'liveness_probe_stop',
        error: expect.objectContaining({
          message: expect.stringMatching(/liveness_probe_stop.*without a reason/iu),
        }),
      },
      {
        step: 'restarted_launch_stop',
        error: expect.objectContaining({
          message: expect.stringMatching(/restarted_launch_stop.*without a reason/iu),
        }),
      },
    ])
    expect(cleanup).toMatchObject({
      cleanupFailureCount: 2,
      processCleanupCompleted: false,
      profileCleanupCompleted: false,
    })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('normalizes a %s profile-removal rejection', async (_label, rejection) => {
    const cleanup = await cleanupArchiveLifecycleResources({
      failure: null,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-nullish-profile',
      removeProfile: async () => Promise.reject(rejection),
      steps: [],
    })

    expect(cleanup.failure).toBeInstanceOf(Error)
    expect(cleanup.cleanupFailures).toEqual([{
      step: 'profile_removal',
      error: expect.objectContaining({
        message: expect.stringMatching(/profile_removal.*without a reason/iu),
      }),
    }])
    expect(cleanup).toMatchObject({
      cleanupFailureCount: 1,
      processCleanupCompleted: true,
      profileCleanupCompleted: false,
    })
  })

  it('publishes an evolved liveness cleanup failure with its latest diagnostics', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-cleanup-details-'))
    const primaryFailure = new Error('Initial renderer collection failure.')
    Object.defineProperty(primaryFailure, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({
        errorKinds: ['renderer_cdp_watchdog_failed'],
        activePhase: 'create',
      }),
    })
    const evolvedFailure = new Error('Liveness finalization recorded another gate.')
    Object.defineProperty(evolvedFailure, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({
        errorKinds: [
          'current_fix_not_observed_before_gate',
          'renderer_cdp_watchdog_failed',
        ],
        activePhase: 'create',
      }),
    })
    const cleanup = await cleanupArchiveLifecycleResources({
      failure: primaryFailure,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-details',
      removeProfile: async () => undefined,
      steps: [{
        name: 'liveness_probe_stop',
        blocksProfileCleanup: false,
        run: async () => { throw evolvedFailure },
      }],
    })

    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: cleanup.failure,
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 1,
        processCleanupCompleted: cleanup.processCleanupCompleted,
        profileCleanupCompleted: cleanup.profileCleanupCompleted,
        cleanupFailureCount: cleanup.cleanupFailureCount,
        cleanupFailures: cleanup.cleanupFailures,
        secrets: [],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })
      const receipt = JSON.parse(await readFile(reportPath, 'utf8'))

      expect(receipt.cleanup).toEqual({
        cleanupFailureCount: 1,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        failures: [
          {
            step: 'liveness_probe_stop',
            classification: 'external_liveness_gate_failure',
            message: 'Liveness finalization recorded another gate.',
            archiveLifecycleDiagnostics: {
              errorKinds: [
                'current_fix_not_observed_before_gate',
                'renderer_cdp_watchdog_failed',
              ],
              activePhase: 'create',
            },
          },
        ],
      })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('publishes a new same-kind CDP failure from liveness stop', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-cleanup-cdp-'))
    const primaryFailure = new Error('Initial renderer collection failure.')
    Object.defineProperty(primaryFailure, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({
        errorKinds: ['renderer_cdp_watchdog_failed'],
        activePhase: 'create',
      }),
    })
    const sameKindCdpFailure = new Error(
      'Archive-lifecycle renderer collection failed during liveness stop.',
      { cause: primaryFailure },
    )
    const cleanup = await cleanupArchiveLifecycleResources({
      failure: primaryFailure,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-cdp',
      removeProfile: async () => undefined,
      steps: [{
        name: 'liveness_probe_stop',
        blocksProfileCleanup: false,
        run: async () => { throw sameKindCdpFailure },
      }],
    })

    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: cleanup.failure,
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 1,
        processCleanupCompleted: cleanup.processCleanupCompleted,
        profileCleanupCompleted: cleanup.profileCleanupCompleted,
        cleanupFailureCount: cleanup.cleanupFailureCount,
        cleanupFailures: cleanup.cleanupFailures,
        secrets: [],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })
      const receipt = JSON.parse(await readFile(reportPath, 'utf8'))

      expect(receipt.cleanup.failures).toEqual([{
        step: 'liveness_probe_stop',
        classification: 'cleanup_failure',
        message: 'Archive-lifecycle renderer collection failed during liveness stop.',
        archiveLifecycleDiagnostics: null,
      }])
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('retains profile-removal failure attribution and bounds cleanup step names', async () => {
    const profileFailure = new Error('Disposable profile removal failed.')
    const cleanup = await cleanupArchiveLifecycleResources({
      failure: null,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-profile-failure',
      removeProfile: async () => { throw profileFailure },
      steps: [{
        name: 'liveness_probe_stop',
        blocksProfileCleanup: false,
        run: async () => undefined,
      }],
    })

    expect(cleanup).toMatchObject({
      failure: profileFailure,
      cleanupFailureCount: 1,
      cleanupFailures: [{ step: 'profile_removal', error: profileFailure }],
      processCleanupCompleted: true,
      profileCleanupCompleted: false,
    })
    await expect(cleanupArchiveLifecycleResources({
      failure: null,
      profilePath: null,
      removeProfile: async () => undefined,
      steps: [{
        name: '../private-profile',
        blocksProfileCleanup: false,
        run: async () => undefined,
      }],
    })).rejects.toThrow(/cleanup inputs are invalid/iu)
    await expect(cleanupArchiveLifecycleResources({
      failure: null,
      profilePath: null,
      removeProfile: async () => undefined,
      steps: Array.from({ length: 9 }, (_entry, index) => ({
        name: `cleanup_step_${index}`,
        blocksProfileCleanup: false,
        run: async () => undefined,
      })),
    })).rejects.toThrow(/cleanup inputs are invalid/iu)
  })

  it('rejects inconsistent cleanup failure counts and details', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-cleanup-mismatch-'))
    try {
      await expect(writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: new Error('Lifecycle failed.'),
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 1,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 1,
        cleanupFailures: [],
        secrets: [],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })).rejects.toThrow(/cleanup failure count.*details/iu)
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('redacts custody values and local paths from cleanup failure details', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-cleanup-redaction-'))
    const secret = 'Secondary Cleanup Secret 2026!'
    const privatePath = '/Users/Private Operator/Builds/SAR Tracker.app/Contents/Resources/app.asar'
    const cleanupFailure = new Error(`Cleanup failed for ${secret} at '${privatePath}'`)
    Object.defineProperty(cleanupFailure, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({
        errorKinds: ['renderer_cdp_watchdog_failed'],
        activePhase: 'restore',
        privatePath,
      }),
    })
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: new Error('Primary lifecycle failure.'),
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 1,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 1,
        cleanupFailures: [{ step: 'liveness_probe_stop', error: cleanupFailure }],
        secrets: [secret],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })
      const serialized = await readFile(reportPath, 'utf8')
      const receipt = JSON.parse(serialized)

      expect(receipt.cleanup.failures[0]).toMatchObject({
        step: 'liveness_probe_stop',
        classification: 'external_liveness_gate_failure',
        message: "Cleanup failed for [REDACTED] at '[PATH]'",
        archiveLifecycleDiagnostics: {
          errorKinds: ['renderer_cdp_watchdog_failed'],
          activePhase: 'restore',
        },
      })
      expect(receipt.cleanup.failures[0].archiveLifecycleDiagnostics).not.toHaveProperty(
        'privatePath',
      )
      expect(serialized).not.toContain(secret)
      expect(serialized).not.toContain(privatePath)
      expect(serialized).not.toContain('Private Operator')
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('globally bounds nested diagnostic array fan-out', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-cleanup-bounds-'))
    let nestedDiagnostics: unknown = 'renderer_cdp_watchdog_failed'
    for (let depth = 0; depth < 6; depth += 1) {
      nestedDiagnostics = Array(16).fill(nestedDiagnostics)
    }
    const cleanupFailure = new Error('Bound nested diagnostic evidence.')
    Object.defineProperty(cleanupFailure, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({ operations: nestedDiagnostics }),
    })
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: new Error('Primary lifecycle failure.'),
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 1,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 1,
        cleanupFailures: [{ step: 'liveness_probe_stop', error: cleanupFailure }],
        secrets: [],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })
      const serialized = await readFile(reportPath, 'utf8')

      expect(serialized.length).toBeLessThan(8_000)
      expect(JSON.parse(serialized).cleanup.failures).toHaveLength(1)
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('publishes a bounded receipt when failure and detail accessors are hostile', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-hostile-failure-'))
    const hostileFailure = new Proxy({}, {
      get: () => { throw new Error('hostile failure getter') },
      getOwnPropertyDescriptor: () => { throw new Error('hostile descriptor getter') },
      getPrototypeOf: () => { throw new Error('hostile prototype getter') },
    })
    const hostileDetail = new Proxy({
      step: 'liveness_probe_stop',
      error: hostileFailure,
    }, {
      get: (_target, property, receiver) => {
        if (property === 'error') throw new Error('hostile cleanup detail getter')
        return Reflect.get(_target, property, receiver)
      },
    })
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        evidenceDir,
        {
          error: hostileFailure,
          cleanupFailureCount: 1,
          cleanupFailures: [hostileDetail],
        },
      ))
      const receipt = JSON.parse(await readFile(reportPath, 'utf8'))

      expect(receipt.failure).toEqual({
        classification: 'lifecycle_failure',
        message: 'Archive-lifecycle failure did not expose a safe message.',
        archiveLifecycleDiagnostics: null,
      })
      expect(receipt.cleanup.failures).toEqual([{
        step: 'cleanup_detail_unreadable_0',
        classification: 'cleanup_failure',
        message: 'Archive-lifecycle cleanup failure detail was unreadable.',
        archiveLifecycleDiagnostics: null,
      }])
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('publishes when the bounded cleanup-detail array proxy is revoked', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-hostile-details-'))
    const details = Proxy.revocable([
      { step: 'liveness_probe_stop', error: new Error('Stop failed.') },
    ], {})
    details.revoke()
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        evidenceDir,
        {
          cleanupFailureCount: 1,
          cleanupFailures: details.proxy,
        },
      ))
      const receipt = JSON.parse(await readFile(reportPath, 'utf8'))

      expect(receipt.cleanup.failures).toEqual([{
        step: 'cleanup_detail_unreadable_0',
        classification: 'cleanup_failure',
        message: 'Archive-lifecycle cleanup failure detail was unreadable.',
        archiveLifecycleDiagnostics: null,
      }])
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('bounds hostile diagnostic arrays, getters, proxies, and cycles', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-hostile-diagnostics-'))
    const hostileArray = new Proxy([], {
      get: (_target, property, receiver) => {
        if (property === 'length') throw new Error('hostile array length')
        return Reflect.get(_target, property, receiver)
      },
    })
    const cycle: Record<string, unknown> = {
      errorKinds: ['renderer_cdp_watchdog_failed'],
      operations: hostileArray,
    }
    Object.defineProperty(cycle, 'activePhase', {
      enumerable: true,
      get: () => { throw new Error('hostile diagnostic getter') },
    })
    const diagnosticProxy = new Proxy(cycle, {
      getOwnPropertyDescriptor: (target, property) => {
        if (property === 'phaseMetrics') throw new Error('hostile diagnostic descriptor')
        return Reflect.getOwnPropertyDescriptor(target, property)
      },
    })
    cycle.currentFixContinuity = diagnosticProxy
    const cleanupFailure = new Error('Diagnostic projection must stay bounded.')
    Object.defineProperty(cleanupFailure, 'archiveLifecycleDiagnostics', {
      value: diagnosticProxy,
    })
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        evidenceDir,
        {
          cleanupFailureCount: 1,
          cleanupFailures: [{ step: 'liveness_probe_stop', error: cleanupFailure }],
        },
      ))
      const serialized = await readFile(reportPath, 'utf8')
      const receipt = JSON.parse(serialized)

      expect(serialized.length).toBeLessThan(8_000)
      expect(receipt.cleanup.failures[0]).toMatchObject({
        classification: 'external_liveness_gate_failure',
        archiveLifecycleDiagnostics: {
          errorKinds: ['renderer_cdp_watchdog_failed'],
          currentFixContinuity: null,
          operations: [],
        },
      })
      expect(receipt.cleanup.failures[0].archiveLifecycleDiagnostics).not.toHaveProperty(
        'activePhase',
      )
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('replaces an oversized or throwing message getter with a bounded fallback', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-hostile-message-'))
    const oversizedMessage = {}
    Object.defineProperty(oversizedMessage, 'message', {
      get: () => 'x'.repeat(10_000),
    })
    const throwingMessage = {}
    Object.defineProperty(throwingMessage, 'message', {
      get: () => { throw new Error('hostile message getter') },
    })
    try {
      const oversizedPath = await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        evidenceDir,
        { error: oversizedMessage },
      ))
      const oversizedReceipt = JSON.parse(await readFile(oversizedPath, 'utf8'))
      expect(oversizedReceipt.failure.message).toBe(
        'Archive-lifecycle failure message exceeded the bounded evidence limit.',
      )

      const throwingPath = await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        evidenceDir,
        { error: throwingMessage },
      ))
      const throwingReceipt = JSON.parse(await readFile(throwingPath, 'utf8'))
      expect(throwingReceipt.failure.message).toBe(
        'Archive-lifecycle failure did not expose a safe message.',
      )
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
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
        cleanupFailures: [],
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
        errorKinds: ['renderer_frame_sample_invalid'],
        activePhase: 'create',
        activeLaunchNumber: 2,
        currentFixContinuity: null,
        currentFixTimeout: null,
        invalidRendererFrame: Object.freeze({
          phase: 'create',
          gapMs: -0.625,
          gapType: 'negative',
        }),
        rendererCurrentFixMonotonicTail: Object.freeze({
          phase: 'restore',
          gapMs: 240,
        }),
        sourceCadence: Object.freeze({
          latestReceivedSequence: 13,
          latestAcknowledgedSequence: 13,
          pendingCount: 0,
          latestRequestStartedAtMs: 1_000,
          latestEmittedAtMs: 1_001,
          latestRequestAgeMs: 240,
          latestSourceAgeMs: 239,
          oldestPendingRequestAgeMs: null,
          oldestPendingSourceAgeMs: null,
          auditedAtMs: 1_240,
        }),
        operationCount: 1,
        operationOverflowCount: 0,
        operations: Object.freeze([Object.freeze({
          phase: 'restore',
          kind: 'review_before_cleanup',
          startedAtMs: 1_010,
          endedAtMs: null,
          freshSampleCount: 0,
        })]),
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
        cleanupFailures: [],
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
            errorKinds: ['renderer_frame_sample_invalid'],
            activePhase: 'create',
            invalidRendererFrame: {
              phase: 'create',
              gapMs: -0.625,
              gapType: 'negative',
            },
            rendererCurrentFixMonotonicTail: {
              phase: 'restore',
              gapMs: 240,
            },
            sourceCadence: {
              latestReceivedSequence: 13,
              latestAcknowledgedSequence: 13,
              pendingCount: 0,
              latestRequestAgeMs: 240,
              latestSourceAgeMs: 239,
            },
            operations: [{
              phase: 'restore',
              kind: 'review_before_cleanup',
              startedAtMs: 1_010,
              endedAtMs: null,
              freshSampleCount: 0,
            }],
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

  it('redacts quoted and unquoted POSIX, Windows, and UNC paths', async () => {
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
        cleanupFailures: [],
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
        cleanupFailures: [],
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

      const windowsPath = String.raw`C:\Users\Private Operator\Builds\SAR Tracker.exe`
      const uncPath = String.raw`\\rescue-server\Private Operator\SAR Tracker\profile`
      const windowsReportPath = await writeArchiveLifecycleFailureReceipt(
        createFailureReceiptInput(evidenceDir, {
          error: new Error(`Could not inspect "${windowsPath}" or ${uncPath}`),
        }),
      )
      const windowsSerialized = await readFile(windowsReportPath, 'utf8')
      const windowsReceipt = JSON.parse(windowsSerialized)

      expect(windowsReceipt.failure.message).toBe('Could not inspect "[PATH]" or [PATH]')
      expect(windowsSerialized).not.toContain(windowsPath)
      expect(windowsSerialized).not.toContain(uncPath)
      expect(windowsSerialized).not.toContain('Private Operator')

      const rootedWindowsPath = String.raw`\Users\Private Operator\SAR Tracker\profile`
      const boundaryReportPath = await writeArchiveLifecycleFailureReceipt(
        createFailureReceiptInput(evidenceDir, {
          error: new Error(
            `Could not inspect '${rootedWindowsPath}'; fallback [${windowsPath}]`,
          ),
        }),
      )
      const boundarySerialized = await readFile(boundaryReportPath, 'utf8')

      expect(boundarySerialized).not.toContain(rootedWindowsPath)
      expect(boundarySerialized).not.toContain(windowsPath)
      expect(boundarySerialized).not.toContain('Private Operator')
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
        cleanupFailures: [],
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
