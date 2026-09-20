import path from 'node:path'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import {
  compileSuiteBinding,
  executeSuiteVariant,
  validateRetainedSuite,
  retainBrowserCaptures,
} from '../../scripts/qualification/suite-adapter.mjs'

const SOURCE_SHA = 'a'.repeat(40)

it('retains available failure screenshots without inventing a missing frame', async () => {
  const work = await realpath(await mkdtemp(path.join(tmpdir(), 'failed-browser-work-')))
  const attempt = await realpath(await mkdtemp(path.join(tmpdir(), 'failed-browser-attempt-')))
  try {
    const frame = path.join(work, 'failed.png')
    await writeFile(frame, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const tests = [{ id: 'failed', attempts: [{ attachments: [{ contentType: 'image/png', path: frame }] }] },
      { id: 'interrupted', attempts: [{ attachments: [] }] }]
    const captures = await retainBrowserCaptures(tests, work, attempt, false)
    expect(captures).toHaveLength(1)
    expect(captures[0].testId).toBe('failed')
    expect(await readFile(captures[0].path)).toEqual(await readFile(frame))
  } finally { await rm(work, { recursive: true, force: true }); await rm(attempt, { recursive: true, force: true }) }
})
const SYNTHETIC_FILE = 'tests/unit/qualification-test-suite-receipts.test.ts'
const SYNTHETIC_NAME = 'qualification test-suite receipt validation > accepts an exact Vitest source report and retains each assertion result'
const SYNTHETIC_EXPECTED = Object.freeze({
  runner: 'vitest',
  files: Object.freeze([SYNTHETIC_FILE]),
  testIds: Object.freeze([`${SYNTHETIC_FILE}::${SYNTHETIC_NAME}`]),
  sourceSha: SOURCE_SHA,
  proofMode: 'source',
})

/** Build the smallest complete Vitest report accepted by the strict receipt parser. */
function syntheticVitestReport(overrides: Record<string, unknown> = {}) {
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
    testResults: [{
      assertionResults: [{
        ancestorTitles: ['qualification test-suite receipt validation'],
        fullName: 'qualification test-suite receipt validation accepts an exact Vitest source report and retains each assertion result',
        status: 'passed',
        title: 'accepts an exact Vitest source report and retains each assertion result',
        duration: 1,
        failureMessages: [],
        meta: {},
        tags: [],
      }],
      startTime: 1,
      endTime: 2,
      status: 'passed',
      message: '',
      name: path.resolve(SYNTHETIC_FILE),
    }],
    ...overrides,
  }
}

describe('qualification suite adapter', () => {
  it('resolves Playwright discovery paths relative to the runner test root', async () => {
    const expected = await compileSuiteBinding({ contractId: 'C06', proofMode: 'browser' }, SOURCE_SHA)
    expect(expected.files).toEqual(['tests/e2e/stationary-attention.spec.ts'])
    expect(expected.testIds.length).toBeGreaterThan(0)
  })
  it('compiles the fixed C13 source selection into an immutable test identity plan', async () => {
    const compiled = await compileSuiteBinding({ contractId: 'C13', proofMode: 'source' }, SOURCE_SHA)

    expect(compiled).toMatchObject({
      runner: 'vitest',
      proofMode: 'source',
      sourceSha: SOURCE_SHA,
    })
    expect(compiled.files).toContain('tests/unit/coordinates.test.ts')
    expect(compiled.testIds.length).toBeGreaterThan(1)
    expect(Object.isFrozen(compiled)).toBe(true)
    expect(Object.isFrozen(compiled.files)).toBe(true)
    expect(Object.isFrozen(compiled.testIds)).toBe(true)
  }, 60_000)

  it('executes only the reviewed source variant and retains report and runner logs', async () => {
    const binding = { contractId: 'C13', proofMode: 'source' as const, command: 'echo arbitrary commands are forbidden' }
    const expected = await compileSuiteBinding(binding, SOURCE_SHA)
    const attemptDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-suite-attempt-'))
    const workDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-suite-work-'))

    try {
      const receipt = await executeSuiteVariant({ binding, expected, attemptDirectory, workDirectory })

      expect(receipt).toMatchObject({
        status: 'PASS',
        valid: true,
        runner: 'vitest',
        proofMode: 'source',
        sourceSha: SOURCE_SHA,
        releaseEligible: false,
      })
      expect(await readFile(receipt.reportPath, 'utf8')).toContain('testResults')
      expect(await readFile(receipt.stdoutPath, 'utf8')).toBeDefined()
      expect(await readFile(receipt.stderrPath, 'utf8')).toBeDefined()
      expect(path.basename(receipt.reportPath)).toBe('suite-report.json')
      expect(receipt.reportPath).toContain('sartracker-suite-attempt-')
      expect(receipt.workDirectory).toContain('sartracker-suite-work-')
    } finally {
      await Promise.all([rm(attemptDirectory, { recursive: true, force: true }), rm(workDirectory, { recursive: true, force: true })])
    }
  }, 120_000)

  it('revalidates retained JSON and rejects a newly introduced retry', async () => {
    const attemptDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-suite-retained-'))
    const reportPath = path.join(attemptDirectory, 'suite-report.json')

    try {
      await writeFile(reportPath, JSON.stringify(syntheticVitestReport()))
      const receipt = {
        status: 'PASS',
        valid: true,
        runner: 'vitest',
        proofMode: 'source',
        sourceSha: SOURCE_SHA,
        reportPath,
        exitCode: 0,
        expected: SYNTHETIC_EXPECTED,
        validation: { status: 'PASS', valid: true },
      }
      const binding = { contractId: 'C13', proofMode: 'source' as const }
      const retained = await validateRetainedSuite(receipt, binding, {
        expected: SYNTHETIC_EXPECTED,
        attemptDirectory,
      })
      expect(retained.status).toBe('PASS')
      expect(retained.valid).toBe(true)

      const retriedReport = syntheticVitestReport({
        testResults: [{
          ...syntheticVitestReport().testResults[0],
          assertionResults: [{
            ...syntheticVitestReport().testResults[0].assertionResults[0],
            meta: { retry: 1 },
          }],
        }],
      })
      await writeFile(reportPath, JSON.stringify(retriedReport))
      const invalid = await validateRetainedSuite(receipt, binding, {
        expected: SYNTHETIC_EXPECTED,
        attemptDirectory,
      })
      expect(invalid.status).toBe('INVALID_EVIDENCE')
      expect(invalid.valid).toBe(false)
      expect(invalid.validation.failureReasons.join(' ')).toMatch(/retry/iu)
    } finally {
      await rm(attemptDirectory, { recursive: true, force: true })
    }
  })
})
