import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { validateTestSuiteReceipt } from '../../scripts/qualification/test-suite-receipts.mjs'

const SOURCE_SHA = 'a'.repeat(40)
const VITEST_FILE = 'tests/unit/qualification-team-evidence.test.ts'
const VITEST_FULL_NAME = 'C29 external team evidence boundary > validates the signed receipt'
const VITEST_REPORT_FULL_NAME = 'C29 external team evidence boundary validates the signed receipt'
const PLAYWRIGHT_FILE = 'tests/e2e/coordinate-converter.spec.ts'
const PLAYWRIGHT_FULL_NAME = 'M18 coordinate converter > converts DD input, copies results, and activates a go-to target'

const vitestExpected = {
  runner: 'vitest',
  files: [VITEST_FILE],
  testIds: [`${VITEST_FILE}::${VITEST_FULL_NAME}`],
  sourceSha: SOURCE_SHA,
  proofMode: 'source',
} as const

const playwrightExpected = {
  runner: 'playwright',
  files: [PLAYWRIGHT_FILE],
  testIds: [`${PLAYWRIGHT_FILE}::${PLAYWRIGHT_FULL_NAME}`],
  sourceSha: SOURCE_SHA,
  proofMode: 'browser',
} as const

/** Build one report with the exact Vitest JSON reporter schema observed locally. */
function vitestReport(overrides: Record<string, unknown> = {}) {
  const suite = {
    assertionResults: [{
      ancestorTitles: ['C29 external team evidence boundary'],
      fullName: VITEST_REPORT_FULL_NAME,
      status: 'passed',
      title: 'validates the signed receipt',
      duration: 1,
      failureMessages: [],
      meta: {},
      tags: [],
    }],
    startTime: 1,
    endTime: 2,
    status: 'passed',
    message: '',
    name: path.resolve(VITEST_FILE),
  }
  return {
    numTotalTestSuites: 2,
    numPassedTestSuites: 2,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    snapshot: {
      added: 0, failure: false, filesAdded: 0, filesRemoved: 0,
      filesRemovedList: [], filesUnmatched: 0, filesUpdated: 0, matched: 0,
      total: 0, unchecked: 0, uncheckedKeysByFile: [], unmatched: 0,
      updated: 0, didUpdate: false,
    },
    startTime: 1,
    success: true,
    testResults: [suite],
    ...overrides,
  }
}

/** Build one report with the exact Playwright JSON reporter shape observed locally. */
function playwrightReport(overrides: Record<string, unknown> = {}) {
  const test = {
    timeout: 30_000,
    annotations: [],
    expectedStatus: 'passed',
    projectId: 'chromium',
    projectName: 'chromium',
    results: [{
      workerIndex: 0,
      parallelIndex: 0,
      status: 'passed',
      duration: 10,
      errors: [],
      stdout: [],
      stderr: [],
      retry: 0,
      startTime: '2026-09-19T19:23:52.538Z',
      annotations: [],
      attachments: [],
    }],
    status: 'expected',
  }
  const spec = {
    title: 'converts DD input, copies results, and activates a go-to target',
    ok: true,
    tags: [],
    tests: [test],
    id: 'playwright-test-id',
    file: 'coordinate-converter.spec.ts',
    line: 13,
    column: 3,
  }
  return {
    config: {
      rootDir: path.resolve('tests/e2e'),
      projects: [{ id: 'chromium', name: 'chromium', retries: 0 }],
    },
    suites: [{
      title: 'coordinate-converter.spec.ts',
      file: 'coordinate-converter.spec.ts',
      column: 0,
      line: 0,
      specs: [],
      suites: [{
        title: 'M18 coordinate converter',
        file: 'coordinate-converter.spec.ts',
        line: 3,
        column: 6,
        specs: [spec],
      }],
    }],
    errors: [],
    stats: {
      startTime: '2026-09-19T19:23:51.867Z',
      duration: 2_502.271,
      expected: 1,
      skipped: 0,
      unexpected: 0,
      flaky: 0,
    },
    ...overrides,
  }
}

describe('qualification test-suite receipt validation', () => {
  it('accepts an exact Vitest source report and retains each assertion result', () => {
    const result = validateTestSuiteReceipt(vitestReport(), vitestExpected)

    expect(result).toMatchObject({
      runner: 'vitest',
      proofMode: 'source',
      status: 'PASS',
      valid: true,
      passed: true,
      releaseEligible: false,
      files: [VITEST_FILE],
      testIds: [`${VITEST_FILE}::${VITEST_FULL_NAME}`],
    })
    expect(result.tests).toHaveLength(1)
    expect(result.tests[0]).toMatchObject({
      id: `${VITEST_FILE}::${VITEST_FULL_NAME}`,
      status: 'passed',
      errors: [],
    })
  })

  it('accepts an exact Playwright browser report and retains attempt errors', () => {
    const result = validateTestSuiteReceipt(playwrightReport(), playwrightExpected)

    expect(result).toMatchObject({
      runner: 'playwright',
      proofMode: 'browser',
      status: 'PASS',
      valid: true,
      passed: true,
      releaseEligible: false,
      files: [PLAYWRIGHT_FILE],
      testIds: [`${PLAYWRIGHT_FILE}::${PLAYWRIGHT_FULL_NAME}`],
    })
    expect(result.tests).toHaveLength(1)
    expect(result.tests[0]).toMatchObject({
      id: `${PLAYWRIGHT_FILE}::${PLAYWRIGHT_FULL_NAME}`,
      status: 'expected',
      attempts: [{ retry: 0, status: 'passed', errors: [] }],
    })
  })

  it.each([
    ['missing file', { testResults: [] }],
    ['missing test', { testResults: [{ ...vitestReport().testResults[0], assertionResults: [] }] }],
    ['failed assertion', { testResults: [{
      ...vitestReport().testResults[0],
      status: 'failed',
      assertionResults: [{ ...vitestReport().testResults[0].assertionResults[0], status: 'failed', failureMessages: ['AssertionError: source oracle failed'] }],
    }], success: false, numPassedTests: 0, numFailedTests: 1 }],
    ['skipped assertion', { testResults: [{
      ...vitestReport().testResults[0],
      assertionResults: [{ ...vitestReport().testResults[0].assertionResults[0], status: 'skipped' }],
    }], success: true, numPassedTests: 0, numPendingTests: 1 }],
    ['retried assertion', { testResults: [{
      ...vitestReport().testResults[0],
      assertionResults: [{ ...vitestReport().testResults[0].assertionResults[0], meta: { retry: 1 } }],
    }] }],
    ['duplicate assertion', { testResults: [{
      ...vitestReport().testResults[0],
      assertionResults: [
        ...vitestReport().testResults[0].assertionResults,
        vitestReport().testResults[0].assertionResults[0],
      ],
    }], numTotalTests: 2, numPassedTests: 2 }],
  ])('rejects Vitest %s evidence', (_label, overrides) => {
    const result = validateTestSuiteReceipt(vitestReport(overrides), vitestExpected)

    expect(result.valid).toBe(false)
    expect(result.passed).toBe(false)
    expect(result.status).toBe('INVALID_EVIDENCE')
  })

  it('retains a Vitest failure message instead of accepting forged green aggregates', () => {
    const assertion = {
      ...vitestReport().testResults[0].assertionResults[0],
      status: 'failed',
      failureMessages: ['Error: actual assertion failure'],
    }
    const result = validateTestSuiteReceipt(vitestReport({
      testResults: [{ ...vitestReport().testResults[0], status: 'passed', assertionResults: [assertion] }],
      success: true,
      numPassedTests: 1,
      numFailedTests: 0,
    }), vitestExpected)

    expect(result.valid).toBe(false)
    expect(result.tests[0]).toMatchObject({ status: 'failed', errors: ['Error: actual assertion failure'] })
    expect(result.failureReasons.join(' ')).toMatch(/assertion|aggregate|passed/iu)
  })

  it('rejects empty Vitest acceptance even when success is forged true', () => {
    const result = validateTestSuiteReceipt(vitestReport({
      testResults: [],
      numTotalTestSuites: 0,
      numPassedTestSuites: 0,
      numTotalTests: 0,
      numPassedTests: 0,
      success: true,
    }), { ...vitestExpected, files: [], testIds: [] })

    expect(result.valid).toBe(false)
    expect(result.failureReasons.join(' ')).toMatch(/zero|empty|planned/iu)
  })

  it.each([
    ['missing file', { suites: [] }],
    ['missing test', { suites: [{ ...playwrightReport().suites[0], suites: [] }] }],
    ['failed test', { suites: [{
      ...playwrightReport().suites[0],
      suites: [{
        ...playwrightReport().suites[0].suites[0],
        specs: [{
          ...playwrightReport().suites[0].suites[0].specs[0],
          ok: false,
          tests: [{
            ...playwrightReport().suites[0].suites[0].specs[0].tests[0],
            status: 'unexpected',
            results: [{ ...playwrightReport().suites[0].suites[0].specs[0].tests[0].results[0], status: 'failed', errors: [{ message: 'browser assertion failed' }] }],
          }],
        }],
      }],
    }], stats: { ...playwrightReport().stats, expected: 0, unexpected: 1 } }],
    ['skipped test', { suites: [{
      ...playwrightReport().suites[0],
      suites: [{
        ...playwrightReport().suites[0].suites[0],
        specs: [{
          ...playwrightReport().suites[0].suites[0].specs[0],
          ok: true,
          tests: [{ ...playwrightReport().suites[0].suites[0].specs[0].tests[0], expectedStatus: 'skipped', status: 'skipped', results: [{ ...playwrightReport().suites[0].suites[0].specs[0].tests[0].results[0], status: 'skipped' }] }],
        }],
      }],
    }], stats: { ...playwrightReport().stats, expected: 0, skipped: 1 } }],
    ['retried test', { suites: [{
      ...playwrightReport().suites[0],
      suites: [{
        ...playwrightReport().suites[0].suites[0],
        specs: [{
          ...playwrightReport().suites[0].suites[0].specs[0],
          tests: [{ ...playwrightReport().suites[0].suites[0].specs[0].tests[0], results: [{ ...playwrightReport().suites[0].suites[0].specs[0].tests[0].results[0], retry: 1 }] }],
        }],
      }],
    }] }],
    ['duplicate test', { suites: [{
      ...playwrightReport().suites[0],
      suites: [{
        ...playwrightReport().suites[0].suites[0],
        specs: [
          playwrightReport().suites[0].suites[0].specs[0],
          playwrightReport().suites[0].suites[0].specs[0],
        ],
      }],
    }], stats: { ...playwrightReport().stats, expected: 2 } }],
  ])('rejects Playwright %s evidence', (_label, overrides) => {
    const result = validateTestSuiteReceipt(playwrightReport(overrides), playwrightExpected)

    expect(result.valid).toBe(false)
    expect(result.passed).toBe(false)
    expect(result.status).toBe('INVALID_EVIDENCE')
  })

  it('retains a Playwright failure error instead of accepting forged green statistics', () => {
    const base = playwrightReport()
    const spec = base.suites[0].suites[0].specs[0]
    const test = spec.tests[0]
    const result = validateTestSuiteReceipt(playwrightReport({
      suites: [{ ...base.suites[0], suites: [{
        ...base.suites[0].suites[0], specs: [{ ...spec, ok: true, tests: [{
          ...test,
          status: 'expected',
          results: [{ ...test.results[0], status: 'failed', errors: [{ message: 'actual browser failure' }] }],
        }] }],
      }] }],
      stats: { ...base.stats, expected: 1, unexpected: 0 },
    }), playwrightExpected)

    expect(result.valid).toBe(false)
    expect(result.tests[0]).toMatchObject({
      status: 'expected',
      attempts: [{ status: 'failed', errors: [{ message: 'actual browser failure' }] }],
    })
  })

  it('rejects runner/proof-mode substitution and invalid source identity', () => {
    expect(validateTestSuiteReceipt(vitestReport(), { ...vitestExpected, proofMode: 'browser' }).valid).toBe(false)
    expect(validateTestSuiteReceipt(playwrightReport(), { ...playwrightExpected, proofMode: 'source' }).valid).toBe(false)
    expect(validateTestSuiteReceipt(vitestReport(), { ...vitestExpected, sourceSha: 'not-a-sha' }).valid).toBe(false)
    expect(validateTestSuiteReceipt(vitestReport(), { ...vitestExpected, files: ['/absolute/file.test.ts'] }).valid).toBe(false)
  })
})
