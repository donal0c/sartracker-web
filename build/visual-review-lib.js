/**
 * Pure helpers for the visual review automation.
 *
 * The visual project (`tests/e2e/visual/**`) writes one `.entry.json` and one
 * `.png` per screenshot to `test-results/visual-verification/`. CLAUDE.md
 * historically asked the human to "spawn Opus subagents" against each entry.
 * The visual review runner automates that step: it reads every entry, sends
 * the screenshot and verificationPrompt to a Claude subprocess, parses the
 * structured reply, and reports per-entry pass/fail with an exit code.
 *
 * This module owns only shaping and parsing logic. Process execution and
 * filesystem IO performed during a real review live in
 * `scripts/visual-review.mjs`. Keeping helpers pure makes the safety-critical
 * pieces (severity gating, JSON extraction, cache keys) deterministic and
 * unit-testable.
 *
 * Why a .js module under build/ instead of src/lib/: this is Node-only tooling
 * that runs alongside `scripts/`. Mirroring `build/beta-verify-lib.js` keeps
 * the contract symmetric and avoids a TypeScript compile step before review.
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @typedef {'critical' | 'high' | 'medium'} Severity
 *
 * @typedef {'app-shell' | 'mission' | 'tracking' | 'markers' | 'drawings' | 'layers' | 'measurements' | 'settings' | 'recovery'} ManifestArea
 *
 * @typedef {Object} ManifestEntry
 * @property {string} testId
 * @property {string} testName
 * @property {ManifestArea} area
 * @property {string} screenshotPath
 * @property {string} verificationPrompt
 * @property {Severity} severity
 * @property {string} capturedAt
 * @property {string[]} playwrightAssertions
 *
 * @typedef {'pass' | 'fail' | 'error'} ReviewVerdict
 *
 * @typedef {Object} ReviewResult
 * @property {string} testId
 * @property {string} testName
 * @property {Severity} severity
 * @property {ReviewVerdict} verdict
 * @property {string[]} failedItems
 * @property {string} rawReply
 * @property {number} durationMs
 * @property {boolean} cacheHit
 * @property {string} [errorMessage]
 *
 * @typedef {Object} ParsedModelReply
 * @property {'pass' | 'fail'} verdict
 * @property {string[]} failedItems
 * @property {string} notes
 *
 * @typedef {Object} ReviewArgs
 * @property {string | null} manifestDir
 * @property {string | null} reportDir
 * @property {boolean} cache
 * @property {boolean} dryRun
 * @property {Severity} failOn
 * @property {string} model
 * @property {number} concurrency
 * @property {string | null} filterTestId
 *
 * @typedef {Object} ReviewSummary
 * @property {boolean} ok
 * @property {number} exitCode
 * @property {{ pass: number; fail: number; error: number }} counts
 * @property {string[]} lines
 */

/** Ordered severities from most to least blocking. */
const SEVERITY_ORDER = ['critical', 'high', 'medium']

/**
 * Map of severity -> { atLeastAsBlockingAs: Set<Severity> }, used so failOn
 * gating is a simple set membership test instead of a switch.
 */
const SEVERITY_AT_LEAST = (() => {
  /** @type {Record<Severity, Set<Severity>>} */
  const out = { critical: new Set(), high: new Set(), medium: new Set() }
  for (let i = 0; i < SEVERITY_ORDER.length; i += 1) {
    const threshold = SEVERITY_ORDER[i]
    for (let j = 0; j <= i; j += 1) {
      out[threshold].add(SEVERITY_ORDER[j])
    }
  }
  return out
})()

const REQUIRED_ENTRY_FIELDS = [
  'testId',
  'testName',
  'area',
  'screenshotPath',
  'verificationPrompt',
  'severity',
  'capturedAt',
  'playwrightAssertions',
]

const ALLOWED_SEVERITIES = new Set(['critical', 'high', 'medium'])

/**
 * Parse the visual-review CLI args.
 *
 * Defaults are chosen to match the existing repo workflow: caching on,
 * non-interactive review, fail when any high-or-critical entry fails. The
 * runner translates these into process behavior.
 *
 * @param {readonly string[]} argv
 * @returns {ReviewArgs}
 */
export function parseReviewArgs(argv) {
  /** @type {ReviewArgs} */
  const args = {
    manifestDir: null,
    reportDir: null,
    cache: true,
    dryRun: false,
    failOn: 'high',
    model: 'opus',
    concurrency: 3,
    filterTestId: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    switch (flag) {
      case '--no-cache':
        args.cache = false
        break
      case '--dry-run':
        args.dryRun = true
        break
      case '--manifest-dir':
        args.manifestDir = requireValue(argv, ++i, '--manifest-dir')
        break
      case '--report-dir':
        args.reportDir = requireValue(argv, ++i, '--report-dir')
        break
      case '--fail-on': {
        const value = requireValue(argv, ++i, '--fail-on')
        if (!ALLOWED_SEVERITIES.has(value)) {
          throw new Error(
            `--fail-on must be one of critical, high, medium (got "${value}").`,
          )
        }
        args.failOn = /** @type {Severity} */ (value)
        break
      }
      case '--concurrency': {
        const value = requireValue(argv, ++i, '--concurrency')
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error(
            `--concurrency must be a positive integer (got "${value}").`,
          )
        }
        args.concurrency = parsed
        break
      }
      case '--model':
        args.model = requireValue(argv, ++i, '--model')
        break
      case '--only':
        args.filterTestId = requireValue(argv, ++i, '--only')
        break
      default:
        throw new Error(`unknown visual-review flag "${flag}".`)
    }
  }

  return args
}

/**
 * Load every `*.entry.json` from a manifest directory into a sorted array.
 *
 * Missing directories return an empty array so the caller can decide whether
 * that should be a hard error (CLI runner) or a no-op (tests). Malformed or
 * incomplete entries throw with the offending filename so the operator can
 * find and fix the bad manifest entry quickly.
 *
 * @param {string} dir
 * @returns {ManifestEntry[]}
 */
export function loadManifestEntries(dir) {
  if (!existsSync(dir)) {
    return []
  }
  const files = readdirSync(dir).filter((file) => file.endsWith('.entry.json'))
  /** @type {ManifestEntry[]} */
  const entries = []
  for (const file of files) {
    const fullPath = join(dir, file)
    let parsed
    try {
      parsed = JSON.parse(readFileSync(fullPath, 'utf-8'))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`manifest entry ${file} is not valid JSON: ${reason}`)
    }
    validateEntry(parsed, file)
    entries.push(parsed)
  }
  entries.sort((a, b) => a.testId.localeCompare(b.testId))
  return entries
}

/**
 * Parse a model reply that should contain a JSON object with `verdict` and
 * `failedItems`. Tolerates ```json fences, plain ``` fences, and free-form
 * prose around a single JSON object. Rejects a reply that does not contain a
 * recognisable verdict so reviewer regressions cannot silently flip to pass.
 *
 * @param {string} reply
 * @returns {ParsedModelReply}
 */
export function parseModelReply(reply) {
  const candidate = extractJsonObject(reply)
  if (candidate === null) {
    throw new Error(
      'no JSON object found in reviewer reply; reviewer must return {"verdict":"pass|fail","failedItems":[...]}.',
    )
  }
  /** @type {Record<string, unknown>} */
  let parsed
  try {
    parsed = JSON.parse(candidate)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`reviewer reply is not valid JSON: ${reason}`)
  }
  const verdictRaw = parsed.verdict
  if (typeof verdictRaw !== 'string') {
    throw new Error('reviewer reply is missing a string `verdict` field.')
  }
  const verdict = verdictRaw.toLowerCase()
  if (verdict !== 'pass' && verdict !== 'fail') {
    throw new Error(
      `reviewer verdict must be "pass" or "fail" (got "${verdictRaw}").`,
    )
  }
  /** @type {unknown} */
  const failedItemsRaw = parsed.failedItems ?? []
  if (!Array.isArray(failedItemsRaw)) {
    throw new Error('reviewer reply `failedItems` must be an array.')
  }
  /** @type {string[]} */
  const failedItems = []
  for (const item of failedItemsRaw) {
    if (typeof item !== 'string') {
      throw new Error('reviewer reply `failedItems` must be an array of strings.')
    }
    failedItems.push(item)
  }
  const notes = typeof parsed.notes === 'string' ? parsed.notes : ''
  return { verdict, failedItems, notes }
}

/**
 * Format a single review result as one terminal line.
 *
 * @param {ReviewResult} result
 * @returns {string}
 */
export function formatReviewLine(result) {
  const verdict = result.verdict.toUpperCase().padEnd(5, ' ')
  const sev = `[${result.severity}]`.padEnd(11, ' ')
  const dur = `(${(result.durationMs / 1000).toFixed(2)}s${result.cacheHit ? ', cache' : ''})`
  const tail = formatVerdictTail(result)
  return `${verdict} ${sev} ${result.testId} — ${result.testName} ${dur}${tail}`
}

/**
 * Aggregate review results into a printable summary plus an exit code that
 * encodes both severity gating and reviewer health.
 *
 * Exit codes:
 *   0 — every result passed gating.
 *   1 — at least one result failed at or above failOn severity.
 *   2 — reviewer errored on at least one entry (always blocks).
 *   3 — the manifest had zero entries (caller almost certainly forgot to run
 *       the visual project).
 *
 * @param {readonly ReviewResult[]} results
 * @param {{ failOn: Severity }} options
 * @returns {ReviewSummary}
 */
export function summarizeReviewResults(results, options) {
  const counts = { pass: 0, fail: 0, error: 0 }
  /** @type {string[]} */
  const lines = []
  if (results.length === 0) {
    return {
      ok: false,
      exitCode: 3,
      counts,
      lines: [
        'OVERALL: FAIL  (no manifest entries — did the visual Playwright project run?)',
      ],
    }
  }

  let blockingFails = 0
  let errorCount = 0
  const blockingSeverities = SEVERITY_AT_LEAST[options.failOn]
  for (const result of results) {
    counts[result.verdict] += 1
    lines.push(formatReviewLine(result))
    if (result.failedItems.length > 0) {
      for (const item of result.failedItems) {
        lines.push(`        • ${item}`)
      }
    }
    if (result.verdict === 'error' && result.errorMessage) {
      lines.push(`        • reviewer error: ${result.errorMessage}`)
    }
    if (result.verdict === 'fail' && blockingSeverities.has(result.severity)) {
      blockingFails += 1
    }
    if (result.verdict === 'error') {
      errorCount += 1
    }
  }

  let exitCode = 0
  if (errorCount > 0) {
    exitCode = 2
  } else if (blockingFails > 0) {
    exitCode = 1
  }
  const ok = exitCode === 0
  const overall = ok ? 'PASS' : 'FAIL'
  lines.push(
    `OVERALL: ${overall}  (${counts.pass} pass, ${counts.fail} fail, ${counts.error} error; failOn=${options.failOn}, blocking fails=${blockingFails})`,
  )
  return { ok, exitCode, counts, lines }
}

/**
 * Build a deterministic JSON report filename keyed by UTC timestamp.
 *
 * @param {Date} now
 * @returns {string}
 */
export function buildReviewReportFilename(now) {
  const iso = now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')
  return `visual-review-${iso}.json`
}

/**
 * Compute a stable cache key for a (manifest entry, screenshot, model) tuple.
 *
 * The cache lets repeated runs skip the model call when the screenshot bytes
 * and the verificationPrompt are unchanged. Other manifest fields are
 * intentionally excluded — testName or capturedAt drift should not invalidate
 * a still-valid review.
 *
 * @param {ManifestEntry} entry
 * @param {Buffer | Uint8Array} screenshotBytes
 * @param {string} model
 * @returns {string}
 */
export function computeCacheKey(entry, screenshotBytes, model) {
  const hash = createHash('sha256')
  hash.update('v1\n')
  hash.update(model)
  hash.update('\n')
  hash.update(entry.verificationPrompt)
  hash.update('\n')
  hash.update(entry.severity)
  hash.update('\n')
  hash.update(screenshotBytes)
  return hash.digest('hex')
}

/**
 * Pull the canonical step list out for callers that want to print help text.
 * (Severity ordering is exposed so the runner can show valid --fail-on values.)
 */
export const SEVERITIES = Object.freeze([...SEVERITY_ORDER])

function requireValue(argv, index, flag) {
  if (index >= argv.length) {
    throw new Error(`${flag} requires a value.`)
  }
  return argv[index]
}

function validateEntry(value, file) {
  if (value === null || typeof value !== 'object') {
    throw new Error(`manifest entry ${file} is not an object.`)
  }
  for (const field of REQUIRED_ENTRY_FIELDS) {
    if (!(field in value)) {
      throw new Error(`manifest entry ${file} is missing required field "${field}".`)
    }
  }
  if (!ALLOWED_SEVERITIES.has(value.severity)) {
    throw new Error(
      `manifest entry ${file} has unsupported severity "${value.severity}".`,
    )
  }
  if (!Array.isArray(value.playwrightAssertions)) {
    throw new Error(
      `manifest entry ${file} field "playwrightAssertions" must be an array.`,
    )
  }
}

function formatVerdictTail(result) {
  if (result.verdict === 'fail') {
    const count = result.failedItems.length
    return ` — ${count} failed item${count === 1 ? '' : 's'}`
  }
  if (result.verdict === 'error') {
    return ' — reviewer error'
  }
  return ''
}

function extractJsonObject(reply) {
  const fenced = matchFencedJson(reply)
  if (fenced !== null) {
    return fenced
  }
  return findFirstJsonObject(reply)
}

function matchFencedJson(reply) {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply)
  if (fence === null) {
    return null
  }
  const inner = fence[1].trim()
  return findFirstJsonObject(inner)
}

function findFirstJsonObject(text) {
  let depth = 0
  let start = -1
  let inString = false
  let escape = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) {
        start = i
      }
      depth += 1
      continue
    }
    if (ch === '}') {
      depth -= 1
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1)
      }
    }
  }
  return null
}
