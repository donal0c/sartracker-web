/**
 * Result vocabulary for the team smoke.
 *
 * A check proves the product wrong only by throwing `ProductFailure`. Any other
 * exception is a tool, fixture or environment problem: the runner records it
 * as NOT TESTED, because a broken tool is missing evidence, not a product FAIL.
 */

/** Thrown by a check when the application itself behaved wrongly. */
export class ProductFailure extends Error {
  /**
   * @param {string} message what the operator would have seen or lost
   */
  constructor(message) {
    super(message)
    this.name = 'ProductFailure'
  }
}

/** Thrown by a check whose prerequisites are absent (for example no previous profile). */
export class NotTested extends Error {
  /**
   * @param {string} message why the check could not run
   */
  constructor(message) {
    super(message)
    this.name = 'NotTested'
  }
}

/**
 * Fails the check with a product failure unless the condition holds.
 *
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
export function expectProduct(condition, message) {
  if (!condition) {
    throw new ProductFailure(message)
  }
}

/**
 * Renders results as the release-note table, one row per checklist check.
 *
 * @param {{name: string}[]} checks every checklist check, in order
 * @param {Map<string, {result: string, evidence: string}>} results
 * @returns {string}
 */
export function renderResultTable(checks, results) {
  const lines = ['| Check | Result | Evidence |', '| --- | --- | --- |']
  for (const { name } of checks) {
    const row = results.get(name) ?? { result: 'NOT TESTED', evidence: 'Manual check; not run by team-smoke.' }
    lines.push(`| ${name} | ${row.result} | ${row.evidence.replace(/\|/gu, '/').replace(/\s+/gu, ' ').trim()} |`)
  }
  return lines.join('\n')
}
