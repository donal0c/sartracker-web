/**
 * Pure helpers for the beta verification gate.
 *
 * The gate runs the lint/build/test/test:backend/package/smoke chain that the
 * beta release plan calls "Verification Before Sharing". This module owns the
 * shaping logic only — process execution lives in scripts/beta-verify.mjs so
 * that the helpers stay deterministic and unit-testable.
 *
 * Why a .js module under build/ instead of src/lib/: the verification gate is
 * Node-only tooling that must run before any TypeScript build step succeeds.
 * Mirroring build/bundle-budgets.js keeps the contract symmetric.
 */

/**
 * @typedef {'lint' | 'build' | 'test' | 'test-backend' | 'package' | 'smoke'} BetaStep
 *
 * @typedef {Object} BetaStepResult
 * @property {BetaStep} step
 * @property {string} command
 * @property {'pass' | 'fail' | 'skip'} status
 * @property {number | null} exitCode
 * @property {number} durationMs
 * @property {string} notes
 *
 * @typedef {Object} BetaVerifyReport
 * @property {string} version
 * @property {string} buildTag
 * @property {string} startedAt
 * @property {string} finishedAt
 * @property {BetaStepResult[]} results
 */

/** Canonical ordered list of beta verification steps. */
export const ALL_BETA_STEPS = ['lint', 'build', 'test', 'test-backend', 'package', 'smoke']

/**
 * Padding width used for step labels in terminal output. Aligns short step
 * names (lint/build/test/smoke) into a single column. Longer names such as
 * test-backend exceed the column intentionally rather than forcing every
 * row wider.
 */
const STEP_NAME_PADDING = 10

/**
 * Parses a comma-separated --steps flag into a deduplicated list of canonical
 * steps in canonical order. Throws when an unknown step is requested so the
 * caller fails loudly before any process work runs.
 *
 * @param {string | undefined} flag
 * @returns {BetaStep[]}
 */
export function parseBetaStepsFlag(flag) {
  if (typeof flag !== 'string' || flag.trim() === '') {
    return [...ALL_BETA_STEPS]
  }

  const requested = new Set(
    flag
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )

  for (const entry of requested) {
    if (!ALL_BETA_STEPS.includes(entry)) {
      throw new Error(
        `Unknown beta verification step "${entry}". Allowed steps: ${ALL_BETA_STEPS.join(', ')}.`,
      )
    }
  }

  return ALL_BETA_STEPS.filter((step) => requested.has(step))
}

/**
 * Formats a single step result as a single fixed-width line for terminal output.
 *
 * @param {BetaStepResult} result
 * @returns {string}
 */
export function formatBetaStepResult(result) {
  const status = result.status.toUpperCase().padEnd(4, ' ')
  const stepLabel = result.step.padEnd(STEP_NAME_PADDING, ' ')
  const tail = formatStepResultTail(result)

  return `${status}  ${stepLabel}  ${result.command}${tail}`
}

/**
 * Summarizes a verification report into terminal lines and an overall ok flag.
 *
 * The summary distinguishes "all passed" from "passed but skipped steps" so
 * that callers can refuse to publish a beta unless every step actually ran.
 *
 * @param {BetaVerifyReport} report
 * @returns {{ ok: boolean; lines: string[]; warning: string | null }}
 */
export function summarizeBetaReport(report) {
  const counts = { pass: 0, fail: 0, skip: 0 }
  const lines = []

  for (const result of report.results) {
    counts[result.status] += 1
    lines.push(formatBetaStepResult(result))
  }

  const ok = counts.fail === 0
  const overall = ok ? 'PASS' : 'FAIL'
  lines.push(`OVERALL: ${overall}  (${counts.pass} pass, ${counts.fail} fail, ${counts.skip} skip)`)

  let warning = null
  if (ok && counts.skip > 0) {
    warning = `One or more steps were skipped — do not share this beta until every step passes without --steps filters.`
  }

  return { ok, lines, warning }
}

/**
 * Builds a deterministic JSON report filename keyed by version, build tag, and
 * UTC timestamp so concurrent runs cannot collide.
 *
 * @param {string} version
 * @param {string} buildTag
 * @param {Date} now
 * @returns {string}
 */
export function buildBetaReportFilename(version, buildTag, now) {
  const safeVersion = sanitizeForFilename(version)
  const safeBuildTag = isLocalOrEmpty(buildTag) ? '' : sanitizeForFilename(buildTag)
  const stamp = formatUtcStampForFilename(now)

  const segments = ['verify', safeVersion]
  if (safeBuildTag !== '') {
    segments.push(safeBuildTag)
  }
  segments.push(stamp)

  return `${segments.join('-')}.json`
}

function formatStepResultTail(result) {
  if (result.status === 'skip') {
    return result.notes ? `  ${result.notes}` : ''
  }

  const durationSeconds = (result.durationMs / 1000).toFixed(2)
  if (result.status === 'pass') {
    return `  (${durationSeconds}s)`
  }

  const exitFragment = result.exitCode === null ? '' : `, exit ${result.exitCode}`
  const noteFragment = result.notes ? `  ${result.notes}` : ''
  return `  (${durationSeconds}s${exitFragment})${noteFragment}`
}

function isLocalOrEmpty(buildTag) {
  if (typeof buildTag !== 'string') {
    return true
  }
  const trimmed = buildTag.trim()
  return trimmed === '' || trimmed === 'local'
}

function sanitizeForFilename(value) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function formatUtcStampForFilename(now) {
  const iso = now.toISOString()
  return iso.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')
}
