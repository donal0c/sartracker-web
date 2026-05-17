import { describe, expect, it } from 'vitest'

import {
  ALL_BETA_STEPS,
  buildBetaReportFilename,
  formatBetaStepResult,
  parseBetaStepsFlag,
  summarizeBetaReport,
  type BetaStepResult,
  type BetaVerifyReport,
} from '../../build/beta-verify-lib.js'

describe('parseBetaStepsFlag', () => {
  it('returns the full ordered step list when the flag is undefined', () => {
    expect(parseBetaStepsFlag(undefined)).toEqual(ALL_BETA_STEPS)
  })

  it('returns the full ordered step list when the flag is an empty string', () => {
    expect(parseBetaStepsFlag('')).toEqual(ALL_BETA_STEPS)
  })

  it('returns the requested subset preserving canonical order', () => {
    expect(parseBetaStepsFlag('package,lint,test')).toEqual(['lint', 'test', 'package'])
  })

  it('deduplicates repeated step names', () => {
    expect(parseBetaStepsFlag('lint,lint,build,build')).toEqual(['lint', 'build'])
  })

  it('trims whitespace around step names', () => {
    expect(parseBetaStepsFlag(' lint , build ')).toEqual(['lint', 'build'])
  })

  it('throws a clear error for unknown step names', () => {
    expect(() => parseBetaStepsFlag('lint,bogus')).toThrow(/unknown beta verification step/i)
    expect(() => parseBetaStepsFlag('lint,bogus')).toThrow(/bogus/)
  })
})

describe('formatBetaStepResult', () => {
  it('formats a passing step with duration', () => {
    const result: BetaStepResult = {
      step: 'lint',
      command: 'npm run lint',
      status: 'pass',
      exitCode: 0,
      durationMs: 1234,
      notes: '',
    }

    expect(formatBetaStepResult(result)).toBe('PASS  lint        npm run lint  (1.23s)')
  })

  it('formats a failing step with exit code and notes', () => {
    const result: BetaStepResult = {
      step: 'build',
      command: 'npm run build',
      status: 'fail',
      exitCode: 2,
      durationMs: 8000,
      notes: 'tsc reported errors',
    }

    expect(formatBetaStepResult(result)).toBe(
      'FAIL  build       npm run build  (8.00s, exit 2)  tsc reported errors',
    )
  })

  it('formats a skipped step without duration or exit code', () => {
    const result: BetaStepResult = {
      step: 'package',
      command: 'npm run tauri build -- --bundles app',
      status: 'skip',
      exitCode: null,
      durationMs: 0,
      notes: 'skipped via --steps',
    }

    expect(formatBetaStepResult(result)).toBe(
      'SKIP  package     npm run tauri build -- --bundles app  skipped via --steps',
    )
  })
})

describe('summarizeBetaReport', () => {
  it('reports overall pass when every step passed', () => {
    const report: BetaVerifyReport = {
      version: '0.1.0',
      buildTag: 'sha.abc',
      startedAt: '2026-05-17T12:00:00Z',
      finishedAt: '2026-05-17T12:05:00Z',
      results: [
        passed('lint', 'npm run lint', 1000),
        passed('build', 'npm run build', 12000),
      ],
    }

    const summary = summarizeBetaReport(report)

    expect(summary.ok).toBe(true)
    expect(summary.lines.at(-1)).toBe('OVERALL: PASS  (2 pass, 0 fail, 0 skip)')
  })

  it('reports overall fail when any step failed', () => {
    const report: BetaVerifyReport = {
      version: '0.1.0',
      buildTag: 'sha.abc',
      startedAt: '2026-05-17T12:00:00Z',
      finishedAt: '2026-05-17T12:05:00Z',
      results: [
        passed('lint', 'npm run lint', 1000),
        failed('test', 'npm run test', 5000, 1, 'one test failing'),
        skipped('package', 'npm run tauri build -- --bundles app'),
      ],
    }

    const summary = summarizeBetaReport(report)

    expect(summary.ok).toBe(false)
    expect(summary.lines.at(-1)).toBe('OVERALL: FAIL  (1 pass, 1 fail, 1 skip)')
  })

  it('flags overall pass-with-skips so callers can warn before sharing a beta', () => {
    const report: BetaVerifyReport = {
      version: '0.1.0',
      buildTag: 'sha.abc',
      startedAt: '2026-05-17T12:00:00Z',
      finishedAt: '2026-05-17T12:05:00Z',
      results: [
        passed('lint', 'npm run lint', 1000),
        skipped('package', 'npm run tauri build -- --bundles app'),
      ],
    }

    const summary = summarizeBetaReport(report)

    expect(summary.ok).toBe(true)
    expect(summary.warning).toMatch(/skipped/i)
  })
})

describe('buildBetaReportFilename', () => {
  it('builds a deterministic filename including version and build tag', () => {
    const now = new Date('2026-05-17T12:34:56.789Z')

    expect(buildBetaReportFilename('0.1.0', 'sha.abc1234', now)).toBe(
      'verify-0.1.0-sha.abc1234-2026-05-17T12-34-56Z.json',
    )
  })

  it('omits the build tag when it is local or empty', () => {
    const now = new Date('2026-05-17T12:34:56Z')

    expect(buildBetaReportFilename('0.1.0', 'local', now)).toBe(
      'verify-0.1.0-2026-05-17T12-34-56Z.json',
    )
    expect(buildBetaReportFilename('0.1.0', '', now)).toBe(
      'verify-0.1.0-2026-05-17T12-34-56Z.json',
    )
  })

  it('replaces filesystem-unsafe characters in the build tag', () => {
    const now = new Date('2026-05-17T00:00:00Z')

    expect(buildBetaReportFilename('0.1.0', 'run/42 sha:abc', now)).toBe(
      'verify-0.1.0-run-42-sha-abc-2026-05-17T00-00-00Z.json',
    )
  })
})

function passed(step: BetaStepResult['step'], command: string, durationMs: number): BetaStepResult {
  return { step, command, status: 'pass', exitCode: 0, durationMs, notes: '' }
}

function failed(
  step: BetaStepResult['step'],
  command: string,
  durationMs: number,
  exitCode: number,
  notes: string,
): BetaStepResult {
  return { step, command, status: 'fail', exitCode, durationMs, notes }
}

function skipped(step: BetaStepResult['step'], command: string): BetaStepResult {
  return { step, command, status: 'skip', exitCode: null, durationMs: 0, notes: 'skipped via --steps' }
}
