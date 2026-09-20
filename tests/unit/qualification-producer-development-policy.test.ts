import { describe, expect, it } from 'vitest'
import { inspectHeldGateDevelopment } from '../../scripts/qualification/producer-development-policy.mjs'

describe('development fault mechanics are distinct from qualification', () => {
  it('retains a real bounded negative without promoting it to contract PASS', () => {
    const file = { bytes: 100, sha256: 'a'.repeat(64) }
    const report = {
      schema: 'sartracker-c01-startup-held-gate-development-v1', gateKind: 'diagnostics',
      proofMode: 'development-electron-held-gate-calibration', qualification: { eligible: false },
      scenario: { profileKind: 'held-diagnostics-gate', observed: 'bounded-timeout-no-action',
        gate: { kind: 'diagnostics', held: true, bounded: true, synthetic: false, timeoutMs: 5000, action: '' },
        process: { pid: 123, closed: true, signal: 'SIGKILL' },
        cleanup: { heldPathRemoved: true },
        originalFiles: { before: { 'mission-store.sqlite': file, 'settings.json': file },
          after: { 'mission-store.sqlite': file, 'settings.json': file } },
        productGap: 'No actionable operator response within the observation bound.',
      },
    }
    expect(inspectHeldGateDevelopment(report, 'diagnostics')).toMatchObject({
      infrastructurePassed: true, observedPredicateStatus: 'FAIL', qualificationExecuted: false,
    })
    expect(inspectHeldGateDevelopment({ ...report, scenario: { ...report.scenario,
      gate: { ...report.scenario.gate, held: false } } }, 'diagnostics').infrastructurePassed).toBe(false)
    expect(inspectHeldGateDevelopment({ ...report, scenario: { ...report.scenario,
      observed: 'not-observed' } }, 'diagnostics').infrastructurePassed).toBe(false)
    expect(inspectHeldGateDevelopment({ ...report, scenario: { ...report.scenario,
      process: { ...report.scenario.process, closed: false } } }, 'diagnostics').infrastructurePassed).toBe(false)
    expect(inspectHeldGateDevelopment(report, 'store').infrastructurePassed).toBe(false)
  })
})
