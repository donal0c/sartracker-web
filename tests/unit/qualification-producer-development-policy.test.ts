import { describe, expect, it } from 'vitest'
import {
  inspectHeldGateDevelopment,
  inspectHeldGateExecution,
} from '../../scripts/qualification/producer-development-policy.mjs'

describe('development fault mechanics are distinct from qualification', () => {
  it('requires the crash-log write to stay held through dismissal and then finish durably', () => {
    const file = { bytes: 100, sha256: 'a'.repeat(64) }
    const report = {
      schema: 'sartracker-c01-startup-held-gate-development-v1',
      gateKind: 'crash-write',
      proofMode: 'development-electron-held-gate-calibration',
      qualification: { eligible: false },
      scenario: {
        profileKind: 'held-crash-gate',
        observed: 'actionable-fault',
        gate: {
          kind: 'crash', mode: 'crash-log-write-hold', held: true, bounded: true, synthetic: false,
          timeoutMs: 20000, action: 'preserve-profile-and-contact-support', response: 'startup-fault-window',
          dialogObserved: true, dialogDismissed: true, lateDialogAfterTimeout: false,
          hold: { markerObserved: true, releasedAfterDialogDismissal: true, writeCompleted: true, temporaryFilesRemaining: false },
        },
        process: {
          pid: 123, closed: true, exitCode: 1, signal: null, forcedKill: false, timedOut: false,
          dialogObserved: true, dialogObservedAtMs: 1900, dialogDismissed: true, faultShellAtMs: 1900,
          productExitCode: 1, productExitSignal: null, exitAfterDialogMs: 50,
        },
        cleanup: { holdReleased: true, temporaryFilesRemoved: true },
        startupLogs: { startupFailureSummaries: ['Error: newer mission store schema 14'] },
        originalFiles: {
          before: { 'mission-store.sqlite': file, 'settings.json': file },
          after: { 'mission-store.sqlite': file, 'settings.json': file },
        },
      },
    }

    expect(inspectHeldGateDevelopment(report, 'crash-write')).toMatchObject({
      infrastructurePassed: true,
      observedPredicateStatus: 'PASS',
      producerCheckPassed: true,
      qualificationExecuted: false,
      releaseEligible: false,
    })
    expect(inspectHeldGateDevelopment({ ...report, scenario: {
      ...report.scenario,
      gate: { ...report.scenario.gate, hold: { ...report.scenario.gate.hold, releasedAfterDialogDismissal: false } },
    } }, 'crash-write').infrastructurePassed).toBe(false)
  })

  it('keeps failed X11 observation and harness cleanup as invalid evidence', () => {
    const file = { bytes: 100, sha256: 'a'.repeat(64) }
    const report = {
      schema: 'sartracker-c01-startup-held-gate-development-v1',
      gateKind: 'crash',
      proofMode: 'development-electron-held-gate-calibration',
      qualification: { eligible: false },
      scenario: {
        profileKind: 'non-regular-crash-evidence',
        observed: 'not-observed',
        gate: {
          kind: 'crash', mode: 'non-regular-evidence-rejection', held: false, bounded: true, synthetic: false, timeoutMs: 20000,
          response: 'startup-fault-window', dialogObserved: true, dialogDismissed: false,
        },
        process: {
          pid: 123, closed: true, exitCode: null, signal: 'SIGKILL', forcedKill: true,
          timedOut: false, dialogObserved: true, dialogDismissed: false,
          productExitCode: null, productExitSignal: null, exitAfterDialogMs: null,
        },
        cleanup: { heldPathRemoved: true },
        startupLogs: { startupFailures: [{ code: 'ERR_SARTRACKER_NON_REGULAR_FILE' }] },
        originalFiles: {
          before: { 'mission-store.sqlite': file, 'settings.json': file },
          after: { 'mission-store.sqlite': file, 'settings.json': file },
        },
        observationFailure: 'C01 X11 visibility query failed.',
        observationFailureDetails: {
          code: null, signal: 'SIGPIPE', killed: true, stdout: '', stderr: '',
        },
      },
    }

    expect(inspectHeldGateDevelopment(report, 'crash')).toMatchObject({
      infrastructurePassed: false,
      observedPredicateStatus: 'INVALID_EVIDENCE',
      producerCheckPassed: false,
      productGap: null,
    })
  })

  it('retains a real bounded negative without promoting it to contract PASS', () => {
    const file = { bytes: 100, sha256: 'a'.repeat(64) }
    const report = {
      schema: 'sartracker-c01-startup-held-gate-development-v1', gateKind: 'diagnostics',
      proofMode: 'development-electron-held-gate-calibration', qualification: { eligible: false },
      scenario: { profileKind: 'held-diagnostics-gate', observed: 'bounded-timeout-no-action',
        gate: { kind: 'diagnostics', mode: 'post-readiness-watchdog-timeout', held: true, bounded: true, synthetic: false, timeoutMs: 20000, startupTimeoutMs: 10000, action: '' },
        process: { pid: 123, closed: true, signal: 'SIGKILL', faultShellAtMs: 10100 },
        startupLogs: { startupFailureSummaries: ['StartupTimeoutError: The 10000 ms startup deadline expired while "storage diagnostics initialization" was pending.'] },
        cleanup: { heldPathRemoved: true },
        originalFiles: { before: { 'mission-store.sqlite': file, 'settings.json': file },
          after: { 'mission-store.sqlite': file, 'settings.json': file } },
        productGap: 'No actionable operator response within the observation bound.',
      },
    }
    const negativeResult = inspectHeldGateDevelopment(report, 'diagnostics')
    expect(negativeResult).toMatchObject({
      infrastructurePassed: true, observedPredicateStatus: 'FAIL', producerCheckPassed: false,
      qualificationExecuted: false, releaseEligible: false,
    })
    expect(negativeResult.productGap).toBe(report.scenario.productGap)
    const actionable = { ...report, scenario: { ...report.scenario,
      observed: 'actionable-fault',
      gate: { ...report.scenario.gate, action: 'preserve-profile-and-contact-support',
        response: 'startup-fault-window', dialogObserved: true },
      process: { ...report.scenario.process, exitCode: 1, signal: null, forcedKill: false,
        dialogObserved: true, dialogDismissed: true, timedOut: false, dialogObservedAtMs: 10_100,
        productExitCode: 1, productExitSignal: null, exitAfterDialogMs: 50, faultShellAtMs: 10_100 },
    } }
    expect(inspectHeldGateDevelopment(actionable, 'diagnostics')).toMatchObject({
      infrastructurePassed: true, observedPredicateStatus: 'PASS', producerCheckPassed: true,
    })
    expect(inspectHeldGateDevelopment({ ...report, scenario: { ...report.scenario,
      gate: { ...report.scenario.gate, held: false } } }, 'diagnostics').infrastructurePassed).toBe(false)
    expect(inspectHeldGateDevelopment({ ...report, scenario: { ...report.scenario,
      observed: 'not-observed' } }, 'diagnostics').infrastructurePassed).toBe(false)
    expect(inspectHeldGateDevelopment({ ...report, scenario: { ...report.scenario,
      process: { ...report.scenario.process, closed: false } } }, 'diagnostics').infrastructurePassed).toBe(false)
    expect(inspectHeldGateDevelopment(report, 'store').infrastructurePassed).toBe(false)

    const dialogWithoutProductExit = { ...actionable, scenario: { ...actionable.scenario,
      process: { ...actionable.scenario.process, exitCode: null, signal: 'SIGTERM', forcedKill: false,
        productExitCode: null, productExitSignal: null, exitAfterDialogMs: null },
      productGap: 'Application showed the fault dialog but did not exit after dismissal.',
    } }
    expect(inspectHeldGateDevelopment(dialogWithoutProductExit, 'diagnostics')).toMatchObject({
      infrastructurePassed: true, observedPredicateStatus: 'FAIL', producerCheckPassed: false,
      productGap: dialogWithoutProductExit.scenario.productGap,
    })

    const forcedProductExit = { ...actionable, scenario: { ...actionable.scenario,
      process: { ...actionable.scenario.process, exitCode: null, signal: 'SIGKILL', forcedKill: true,
        productExitCode: null, productExitSignal: null, exitAfterDialogMs: null },
      productGap: 'Application showed the fault dialog but did not exit after dismissal.',
    } }
    expect(inspectHeldGateDevelopment(forcedProductExit, 'diagnostics')).toMatchObject({
      infrastructurePassed: true, observedPredicateStatus: 'FAIL', producerCheckPassed: false,
    })
  })

  it('classifies product exits that bypass or outlast the operator dialog as product failures', () => {
    const file = { bytes: 100, sha256: 'a'.repeat(64) }
    const base = {
      schema: 'sartracker-c01-startup-held-gate-development-v1', gateKind: 'diagnostics',
      proofMode: 'development-electron-held-gate-calibration', qualification: { eligible: false },
    }
    const scenarioBase = {
      profileKind: 'held-diagnostics-gate',
      startupLogs: { startupFailureSummaries: ['StartupTimeoutError: The 10000 ms startup deadline expired while "storage diagnostics initialization" was pending.'] },
      cleanup: { heldPathRemoved: true },
      originalFiles: { before: { 'mission-store.sqlite': file, 'settings.json': file },
        after: { 'mission-store.sqlite': file, 'settings.json': file } },
    }
    const gate = { kind: 'diagnostics', mode: 'post-readiness-watchdog-timeout', held: true, bounded: true,
      synthetic: false, timeoutMs: 20000, startupTimeoutMs: 10000 }

    // The fault window appeared in bound but the product exited before the
    // operator could dismiss it: the product defect, not harness infrastructure.
    const exitedBeforeDismissal = { ...base, scenario: { ...scenarioBase,
      observed: 'actionable-fault',
      gate: { ...gate, action: 'preserve-profile-and-contact-support', response: 'startup-fault-window',
        dialogObserved: true },
      process: { pid: 123, closed: true, exitCode: 1, signal: null, forcedKill: false, timedOut: false,
        dialogObserved: true, dialogObservedAtMs: 10_100, dialogDismissed: false, exitedBeforeDismissal: true,
        productExitCode: 1, productExitSignal: null, exitAfterDialogMs: null, faultShellAtMs: 10_100 },
      productGap: 'Application closed its fault dialog before operator dismissal.',
    } }
    expect(inspectHeldGateDevelopment(exitedBeforeDismissal, 'diagnostics')).toMatchObject({
      infrastructurePassed: true, observedPredicateStatus: 'FAIL', producerCheckPassed: false,
      productGap: exitedBeforeDismissal.scenario.productGap,
    })

    // A dialog only after the bound, followed by the product's own clean exit,
    // is still the bounded-timeout product negative.
    const lateDialogOwnExit = { ...base, scenario: { ...scenarioBase,
      observed: 'bounded-timeout-no-action',
      gate: { ...gate, action: '' },
      process: { pid: 123, closed: true, exitCode: 1, signal: null, forcedKill: false, timedOut: true,
        dialogObserved: true, dialogDismissed: true, productExitCode: 1, productExitSignal: null,
        exitAfterDialogMs: 40, faultShellAtMs: null },
      productGap: 'Dependency hold reached the bound; a native dialog was observed only after the bound.',
    } }
    expect(inspectHeldGateDevelopment(lateDialogOwnExit, 'diagnostics')).toMatchObject({
      infrastructurePassed: true, observedPredicateStatus: 'FAIL', producerCheckPassed: false,
      productGap: lateDialogOwnExit.scenario.productGap,
    })

    // The real probe records neither a fault-shell time nor a timeout summary
    // when the product never responded; that is still a product negative.
    const silentTimeout = { ...base, scenario: { ...scenarioBase,
      observed: 'bounded-timeout-no-action',
      startupLogs: { startupFailureSummaries: [] },
      gate: { ...gate, action: '' },
      process: { pid: 123, closed: true, exitCode: null, signal: 'SIGKILL', forcedKill: true, timedOut: true,
        dialogObserved: false, dialogDismissed: false, productExitCode: null, productExitSignal: null,
        exitAfterDialogMs: null, faultShellAtMs: null },
      productGap: 'Dependency hold reached the bound without an actionable operator response.',
    } }
    expect(inspectHeldGateDevelopment(silentTimeout, 'diagnostics')).toMatchObject({
      infrastructurePassed: true, observedPredicateStatus: 'FAIL',
    })

    // A held crash-log write whose product never exits after dismissal cannot
    // prove durable completion; that is the product failure it looks like.
    const crashWriteNoExit = { ...base, gateKind: 'crash-write', scenario: { ...scenarioBase,
      profileKind: 'held-crash-gate',
      observed: 'actionable-fault',
      gate: { kind: 'crash', mode: 'crash-log-write-hold', held: true, bounded: true, synthetic: false,
        timeoutMs: 20000, action: 'preserve-profile-and-contact-support', response: 'startup-fault-window',
        dialogObserved: true,
        hold: { markerObserved: true, releasedAfterDialogDismissal: true, writeCompleted: false, temporaryFilesRemaining: true } },
      process: { pid: 123, closed: true, exitCode: null, signal: 'SIGTERM', forcedKill: false, timedOut: false,
        dialogObserved: true, dialogObservedAtMs: 1_900, dialogDismissed: true, productExitCode: null,
        productExitSignal: null, exitAfterDialogMs: null, faultShellAtMs: 1_900 },
      cleanup: { holdReleased: true, temporaryFilesRemoved: false },
      productGap: 'Application showed the fault dialog but did not exit after dismissal.',
    } }
    expect(inspectHeldGateDevelopment(crashWriteNoExit, 'crash-write')).toMatchObject({
      observedPredicateStatus: 'FAIL', productGap: crashWriteNoExit.scenario.productGap,
    })
  })

  it('keeps an observed product timeout separate from producer infrastructure', () => {
    const negative = {
      infrastructurePassed: true,
      observedPredicateStatus: 'FAIL',
      producerCheckPassed: false,
    }

    expect(inspectHeldGateExecution({
      exitCode: 2,
      timedOut: false,
      processError: null,
      zeroDescendantsAfterRun: true,
      mechanics: negative,
    })).toEqual({ infrastructurePassed: true, productCheckPassed: false })

    expect(inspectHeldGateExecution({
      exitCode: 1,
      timedOut: false,
      processError: null,
      zeroDescendantsAfterRun: true,
      mechanics: negative,
    })).toEqual({ infrastructurePassed: false, productCheckPassed: false })
  })
})
