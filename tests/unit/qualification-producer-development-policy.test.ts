import { describe, expect, it } from 'vitest'
import {
  inspectHeldGateDevelopment,
  inspectHeldGateExecution,
} from '../../scripts/qualification/producer-development-policy.mjs'

describe('development fault mechanics are distinct from qualification', () => {
  it('retains a real bounded negative without promoting it to contract PASS', () => {
    const file = { bytes: 100, sha256: 'a'.repeat(64) }
    const report = {
      schema: 'sartracker-c01-startup-held-gate-development-v1', gateKind: 'diagnostics',
      proofMode: 'development-electron-held-gate-calibration', qualification: { eligible: false },
      scenario: { profileKind: 'held-diagnostics-gate', observed: 'bounded-timeout-no-action',
        gate: { kind: 'diagnostics', held: true, bounded: true, synthetic: false, timeoutMs: 20000, action: '' },
        process: { pid: 123, closed: true, signal: 'SIGKILL' },
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
        response: 'native-error-dialog', dialogObserved: true },
      process: { ...report.scenario.process, exitCode: 1, signal: null, forcedKill: false,
        dialogObserved: true, dialogDismissed: true, timedOut: false, dialogObservedAtMs: 904,
        productExitCode: 1, productExitSignal: null, exitAfterDialogMs: 50, faultShellAtMs: 904 },
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
