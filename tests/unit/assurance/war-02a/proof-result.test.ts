// @vitest-environment node
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { validateProofReport, assertProofProcessCompleted } = require('../../../../scripts/assurance/war-02a-proof-result.mjs') as {
  assertProofProcessCompleted: (result: { error?: Error; signal: string | null; status: number | null }, label: string) => void
  validateProofReport: (report: unknown, expected: { name: string; oracle: string; disabled: boolean }) => boolean
}
const expected = { name: 'selected case', oracle: 'safety property', disabled: true }

/** A selected assertion failure with explicit error accounting from the reporter. */
function redReport() {
  return {
    numFailedTests: 1, numPassedTests: 0, success: false,
    war02a: { unhandledErrorCount: 0, suiteErrorCount: 0, reason: 'failed' },
    testResults: [{ message: '', assertionResults: [{
      title: 'selected case', status: 'failed', failureMessages: ['AssertionError: safety property: expected old to equal new'],
    }] }],
  }
}

describe('WAR-02A red-proof result acceptance', () => {
  it.each(['ETIMEDOUT', 'ENOENT'])('classifies %s as infrastructure failure, not safety proof', (code) => {
    expect(() => assertProofProcessCompleted({ error: Object.assign(new Error(code), { code }), signal: null, status: null }, 'control'))
      .toThrow(/infrastructure failure.*no safety proof.*(ETIMEDOUT|ENOENT)/)
  })
  it('distinguishes terminated children from completed assertion exits', () => {
    expect(() => assertProofProcessCompleted({ signal: 'SIGTERM', status: null }, 'control')).toThrow(/infrastructure failure.*SIGTERM/)
    expect(() => assertProofProcessCompleted({ signal: null, status: 1 }, 'control')).not.toThrow()
  })
  it('accepts the sole intended assertion failure', () => {
    expect(validateProofReport(redReport(), expected)).toBe(true)
  })
  it('rejects a second failure on the same test', () => {
    const report = redReport()
    report.testResults[0]!.assertionResults[0]!.failureMessages.push('Error: cleanup failed')
    expect(validateProofReport(report, expected)).toBe(false)
  })
  it.each(['unhandledErrorCount', 'suiteErrorCount'] as const)('rejects nonzero %s alongside the oracle', (key) => {
    const report = redReport()
    report.war02a[key] = 1
    expect(validateProofReport(report, expected)).toBe(false)
  })
  it('rejects missing explicit error accounting', () => {
    const { war02a: omitted, ...report } = redReport()
    void omitted
    expect(validateProofReport(report, expected)).toBe(false)
  })
  it('rejects an interrupted test run', () => {
    const report = redReport()
    report.war02a.reason = 'interrupted'
    expect(validateProofReport(report, expected)).toBe(false)
  })
  it('rejects a file-level failure', () => {
    const report = redReport()
    report.testResults[0]!.message = 'beforeAll failed'
    expect(validateProofReport(report, expected)).toBe(false)
  })
  it('rejects a different assertion and malformed output', () => {
    const report = redReport()
    report.testResults[0]!.assertionResults[0]!.failureMessages = ['Error: native module missing']
    expect(validateProofReport(report, expected)).toBe(false)
    expect(validateProofReport(undefined, expected)).toBe(false)
  })
})
