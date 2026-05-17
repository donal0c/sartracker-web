import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildReviewReportFilename,
  computeCacheKey,
  formatReviewLine,
  loadManifestEntries,
  parseModelReply,
  parseReviewArgs,
  summarizeReviewResults,
  type ManifestEntry,
  type ReviewResult,
} from '../../build/visual-review-lib.js'

function makeEntry(partial: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    testId: 't',
    testName: 'test',
    area: 'app-shell',
    screenshotPath: '/abs/path/t.png',
    verificationPrompt: 'Verify this',
    severity: 'high',
    capturedAt: '2026-05-17T00:00:00.000Z',
    playwrightAssertions: [],
    ...partial,
  }
}

function makeResult(partial: Partial<ReviewResult> = {}): ReviewResult {
  return {
    testId: 't',
    testName: 'test',
    severity: 'high',
    verdict: 'pass',
    failedItems: [],
    rawReply: '',
    durationMs: 0,
    cacheHit: false,
    ...partial,
  }
}

describe('parseReviewArgs', () => {
  it('returns defaults when no flags are given', () => {
    expect(parseReviewArgs([])).toEqual({
      manifestDir: null,
      reportDir: null,
      cache: true,
      dryRun: false,
      failOn: 'high',
      model: 'opus',
      concurrency: 3,
      filterTestId: null,
    })
  })

  it('parses --no-cache to disable caching', () => {
    expect(parseReviewArgs(['--no-cache']).cache).toBe(false)
  })

  it('parses --dry-run', () => {
    expect(parseReviewArgs(['--dry-run']).dryRun).toBe(true)
  })

  it('parses --manifest-dir <path>', () => {
    expect(parseReviewArgs(['--manifest-dir', '/x/y']).manifestDir).toBe('/x/y')
  })

  it('parses --report-dir <path>', () => {
    expect(parseReviewArgs(['--report-dir', '/r']).reportDir).toBe('/r')
  })

  it('parses --fail-on critical|high|medium', () => {
    expect(parseReviewArgs(['--fail-on', 'critical']).failOn).toBe('critical')
    expect(parseReviewArgs(['--fail-on', 'medium']).failOn).toBe('medium')
  })

  it('rejects --fail-on with an unknown severity', () => {
    expect(() => parseReviewArgs(['--fail-on', 'low'])).toThrow(/fail-on/i)
  })

  it('parses --concurrency as a positive integer', () => {
    expect(parseReviewArgs(['--concurrency', '5']).concurrency).toBe(5)
  })

  it('rejects --concurrency that is not a positive integer', () => {
    expect(() => parseReviewArgs(['--concurrency', '0'])).toThrow(/concurrency/i)
    expect(() => parseReviewArgs(['--concurrency', '-1'])).toThrow(/concurrency/i)
    expect(() => parseReviewArgs(['--concurrency', 'abc'])).toThrow(/concurrency/i)
  })

  it('parses --model <name>', () => {
    expect(parseReviewArgs(['--model', 'sonnet']).model).toBe('sonnet')
  })

  it('parses --only <testId> for single-entry runs', () => {
    expect(parseReviewArgs(['--only', 'shell-idle-state']).filterTestId).toBe(
      'shell-idle-state',
    )
  })

  it('rejects unknown flags', () => {
    expect(() => parseReviewArgs(['--bogus'])).toThrow(/unknown/i)
  })
})

describe('loadManifestEntries', () => {
  it('returns an empty array when the directory does not exist', () => {
    expect(loadManifestEntries('/definitely/not/here')).toEqual([])
  })

  it('reads every .entry.json file and ignores non-entry files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manifest-'))
    try {
      writeFileSync(
        join(dir, 'a.entry.json'),
        JSON.stringify(makeEntry({ testId: 'a' })),
      )
      writeFileSync(
        join(dir, 'b.entry.json'),
        JSON.stringify(makeEntry({ testId: 'b' })),
      )
      writeFileSync(join(dir, 'a.png'), 'binary')
      writeFileSync(join(dir, 'notes.txt'), 'ignore me')

      const entries = loadManifestEntries(dir)
      expect(entries.map((e) => e.testId)).toEqual(['a', 'b'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sorts entries by testId for deterministic output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manifest-'))
    try {
      writeFileSync(
        join(dir, 'z.entry.json'),
        JSON.stringify(makeEntry({ testId: 'z' })),
      )
      writeFileSync(
        join(dir, 'a.entry.json'),
        JSON.stringify(makeEntry({ testId: 'a' })),
      )
      const entries = loadManifestEntries(dir)
      expect(entries.map((e) => e.testId)).toEqual(['a', 'z'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws a clear error when an entry file is malformed JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manifest-'))
    try {
      writeFileSync(join(dir, 'broken.entry.json'), '{ not json')
      expect(() => loadManifestEntries(dir)).toThrow(/broken\.entry\.json/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws a clear error when an entry is missing required fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manifest-'))
    try {
      writeFileSync(
        join(dir, 'partial.entry.json'),
        JSON.stringify({ testId: 'partial' }),
      )
      expect(() => loadManifestEntries(dir)).toThrow(/partial/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('parseModelReply', () => {
  it('extracts a strict JSON object reply with verdict pass', () => {
    const reply = JSON.stringify({
      verdict: 'pass',
      failedItems: [],
      notes: 'looks good',
    })
    expect(parseModelReply(reply)).toEqual({
      verdict: 'pass',
      failedItems: [],
      notes: 'looks good',
    })
  })

  it('extracts a strict JSON object reply with verdict fail and items', () => {
    const reply = JSON.stringify({
      verdict: 'fail',
      failedItems: ['Item 2: missing label', 'Item 5: wrong color'],
      notes: 'see items',
    })
    expect(parseModelReply(reply)).toEqual({
      verdict: 'fail',
      failedItems: ['Item 2: missing label', 'Item 5: wrong color'],
      notes: 'see items',
    })
  })

  it('extracts JSON when wrapped in ```json fences and prose', () => {
    const reply = `Sure, here's my analysis.

\`\`\`json
{"verdict":"pass","failedItems":[],"notes":"all clear"}
\`\`\`

Let me know if you need more.`
    expect(parseModelReply(reply)).toEqual({
      verdict: 'pass',
      failedItems: [],
      notes: 'all clear',
    })
  })

  it('extracts JSON when wrapped in plain ``` fences', () => {
    const reply = '```\n{"verdict":"fail","failedItems":["a"],"notes":""}\n```'
    expect(parseModelReply(reply)).toEqual({
      verdict: 'fail',
      failedItems: ['a'],
      notes: '',
    })
  })

  it('extracts JSON embedded in prose without fences', () => {
    const reply =
      'After reviewing the screenshot: {"verdict":"pass","failedItems":[],"notes":"ok"} done.'
    expect(parseModelReply(reply)).toEqual({
      verdict: 'pass',
      failedItems: [],
      notes: 'ok',
    })
  })

  it('normalizes verdict casing', () => {
    expect(parseModelReply('{"verdict":"PASS","failedItems":[]}').verdict).toBe(
      'pass',
    )
    expect(parseModelReply('{"verdict":"Fail","failedItems":["a"]}').verdict).toBe(
      'fail',
    )
  })

  it('coerces missing failedItems to []', () => {
    expect(parseModelReply('{"verdict":"pass"}').failedItems).toEqual([])
  })

  it('throws when the verdict is missing or invalid', () => {
    expect(() => parseModelReply('{"failedItems":[]}')).toThrow(/verdict/i)
    expect(() => parseModelReply('{"verdict":"maybe","failedItems":[]}')).toThrow(
      /verdict/i,
    )
  })

  it('throws when no JSON object is present', () => {
    expect(() => parseModelReply('Sorry, I cannot verify.')).toThrow(/no json/i)
  })

  it('throws when failedItems is not an array of strings', () => {
    expect(() =>
      parseModelReply('{"verdict":"fail","failedItems":[1,2,3]}'),
    ).toThrow(/failedItems/i)
  })

  it('treats verdict=fail with empty failedItems as still-failing', () => {
    expect(parseModelReply('{"verdict":"fail","failedItems":[]}').verdict).toBe(
      'fail',
    )
  })
})

describe('summarizeReviewResults', () => {
  it('reports overall pass when all entries pass', () => {
    const results = [
      makeResult({ testId: 'a', verdict: 'pass', severity: 'critical' }),
      makeResult({ testId: 'b', verdict: 'pass', severity: 'medium' }),
    ]
    const summary = summarizeReviewResults(results, { failOn: 'high' })
    expect(summary.ok).toBe(true)
    expect(summary.exitCode).toBe(0)
    expect(summary.counts).toEqual({ pass: 2, fail: 0, error: 0 })
  })

  it('fails overall when a critical entry fails and failOn=critical', () => {
    const results = [
      makeResult({ testId: 'a', verdict: 'fail', severity: 'critical' }),
      makeResult({ testId: 'b', verdict: 'pass', severity: 'high' }),
    ]
    const summary = summarizeReviewResults(results, { failOn: 'critical' })
    expect(summary.ok).toBe(false)
    expect(summary.exitCode).toBe(1)
  })

  it('does not fail overall when only a medium entry fails and failOn=high', () => {
    const results = [
      makeResult({ testId: 'a', verdict: 'fail', severity: 'medium' }),
      makeResult({ testId: 'b', verdict: 'pass', severity: 'critical' }),
    ]
    const summary = summarizeReviewResults(results, { failOn: 'high' })
    expect(summary.ok).toBe(true)
    expect(summary.exitCode).toBe(0)
  })

  it('treats reviewer errors as blocking regardless of failOn', () => {
    const results = [
      makeResult({ testId: 'a', verdict: 'error', severity: 'medium' }),
    ]
    const summary = summarizeReviewResults(results, { failOn: 'critical' })
    expect(summary.ok).toBe(false)
    expect(summary.exitCode).toBe(2)
    expect(summary.counts.error).toBe(1)
  })

  it('returns ok=false when there are zero results to review', () => {
    const summary = summarizeReviewResults([], { failOn: 'high' })
    expect(summary.ok).toBe(false)
    expect(summary.exitCode).toBe(3)
  })

  it('produces formatted lines per result and a final overall line', () => {
    const results = [
      makeResult({
        testId: 'a',
        testName: 'thing one',
        verdict: 'pass',
        severity: 'high',
        durationMs: 5000,
      }),
      makeResult({
        testId: 'b',
        testName: 'thing two',
        verdict: 'fail',
        severity: 'critical',
        failedItems: ['Item 1', 'Item 4'],
        durationMs: 6000,
      }),
    ]
    const summary = summarizeReviewResults(results, { failOn: 'critical' })
    expect(summary.lines.length).toBeGreaterThan(0)
    expect(summary.lines.some((line) => line.includes('PASS') && line.includes('a'))).toBe(true)
    expect(summary.lines.some((line) => line.includes('FAIL') && line.includes('b'))).toBe(true)
    expect(summary.lines.some((line) => line.includes('Item 1'))).toBe(true)
    expect(summary.lines[summary.lines.length - 1]).toMatch(/OVERALL: FAIL/)
  })

  it('marks cached results clearly in the formatted lines', () => {
    const results = [
      makeResult({
        testId: 'a',
        verdict: 'pass',
        severity: 'high',
        cacheHit: true,
      }),
    ]
    const summary = summarizeReviewResults(results, { failOn: 'high' })
    expect(summary.lines.some((line) => line.includes('cache'))).toBe(true)
  })
})

describe('formatReviewLine', () => {
  it('formats a passing review entry', () => {
    const line = formatReviewLine(
      makeResult({
        testId: 'shell-idle-state',
        testName: 'idle',
        verdict: 'pass',
        severity: 'critical',
        durationMs: 1234,
      }),
    )
    expect(line).toMatch(/PASS/)
    expect(line).toMatch(/shell-idle-state/)
    expect(line).toMatch(/critical/)
  })

  it('includes failure detail count for a failing entry', () => {
    const line = formatReviewLine(
      makeResult({
        verdict: 'fail',
        failedItems: ['x', 'y'],
      }),
    )
    expect(line).toMatch(/FAIL/)
    expect(line).toMatch(/2/)
  })

  it('marks reviewer errors clearly', () => {
    const line = formatReviewLine(
      makeResult({ verdict: 'error', failedItems: [] }),
    )
    expect(line).toMatch(/ERROR/)
  })
})

describe('buildReviewReportFilename', () => {
  it('builds a deterministic filename keyed by UTC timestamp', () => {
    const now = new Date('2026-05-17T08:01:33.421Z')
    expect(buildReviewReportFilename(now)).toBe(
      'visual-review-2026-05-17T08-01-33Z.json',
    )
  })
})

describe('computeCacheKey', () => {
  it('is stable for identical inputs', () => {
    const entry = makeEntry()
    const bytes = Buffer.from('hello')
    const key1 = computeCacheKey(entry, bytes, 'opus')
    const key2 = computeCacheKey(entry, bytes, 'opus')
    expect(key1).toBe(key2)
  })

  it('changes when the screenshot bytes change', () => {
    const entry = makeEntry()
    const a = computeCacheKey(entry, Buffer.from('hello'), 'opus')
    const b = computeCacheKey(entry, Buffer.from('hello!'), 'opus')
    expect(a).not.toBe(b)
  })

  it('changes when the verification prompt changes', () => {
    const bytes = Buffer.from('hello')
    const a = computeCacheKey(makeEntry({ verificationPrompt: 'A' }), bytes, 'opus')
    const b = computeCacheKey(makeEntry({ verificationPrompt: 'B' }), bytes, 'opus')
    expect(a).not.toBe(b)
  })

  it('changes when the model identifier changes', () => {
    const bytes = Buffer.from('hello')
    const a = computeCacheKey(makeEntry(), bytes, 'opus')
    const b = computeCacheKey(makeEntry(), bytes, 'sonnet')
    expect(a).not.toBe(b)
  })

  it('does not change when irrelevant fields change', () => {
    const bytes = Buffer.from('hello')
    const a = computeCacheKey(
      makeEntry({ capturedAt: '2026-01-01T00:00:00Z' }),
      bytes,
      'opus',
    )
    const b = computeCacheKey(
      makeEntry({ capturedAt: '2026-12-31T23:59:59Z' }),
      bytes,
      'opus',
    )
    expect(a).toBe(b)
  })
})
