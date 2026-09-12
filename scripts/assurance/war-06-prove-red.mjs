import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { assertProofProcessCompleted } from './war-02a-proof-result.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const cases = [
  {
    control: 'AUD-01-visible-publication',
    pattern: 'reproduces stale history publication at the real delayed poller flush',
    name: 'reproduces stale history publication at the real delayed poller flush [WAR-06-AUD-01]',
    oracle: 'WAR-06 AUD-01 safety oracle:',
  },
  {
    control: 'AUD-02-stationary-projection',
    pattern: 'reproduces deferred stale current-fix publication through finish-idle-start while a poll is in flight',
    name: 'reproduces deferred stale current-fix publication through finish-idle-start while a poll is in flight [WAR-06-AUD-02]',
    oracle: 'WAR-06 AUD-02 safety oracle:',
  },
  {
    control: 'CACHE-SIBLING-stationary-projection',
    pattern: 'characterizes the unkeyed cached snapshot on Mission B cold start',
    name: 'characterizes the unkeyed cached snapshot on Mission B cold start [WAR-06-CACHE-SIBLING]',
    oracle: 'WAR-06 CACHE-SIBLING safety oracle:',
  },
]

/** Reads the structured Vitest receipt and proves only the selected result changed. */
function parseProofReport(result, entry, disabled) {
  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    return false
  }
  if (
    report.war02a?.unhandledErrorCount !== 0 ||
    report.war02a?.suiteErrorCount !== 0 ||
    report.war02a?.reason !== (disabled ? 'failed' : 'passed') ||
    !Array.isArray(report.testResults) || report.testResults.length !== 1
  ) return false
  const assertions = report.testResults[0]?.assertionResults
  if (!Array.isArray(assertions)) return false
  const executed = assertions.filter((assertion) => assertion.status !== 'skipped')
  if (executed.length !== 1 || executed[0]?.title !== entry.name) return false
  const assertion = executed[0]
  if (disabled) {
    return report.success === false && report.numFailedTests === 1 &&
      assertion.status === 'failed' &&
      assertion.failureMessages.some((message) => message.startsWith(`AssertionError: ${entry.oracle}`))
  }
  return report.success === true && report.numPassedTests === 1 &&
    report.numFailedTests === 0 && assertion.status === 'passed' &&
    assertion.failureMessages.length === 0
}

// The negative control erases the visible publication immediately before the
// characterization oracle. Each selected test must pass normally and then go
// RED at its named safety assertion, never at collection or cleanup.
for (const entry of cases) {
  const args = [
    path.join(root, 'node_modules/vitest/vitest.mjs'),
    'run',
    'tests/unit/assurance/war-06/tracking-lifecycle-characterization.test.ts',
    '-t',
    entry.pattern,
    '--no-file-parallelism',
    '--reporter',
    path.join(root, 'scripts/assurance/war-02a-reporter.mjs'),
  ]
  for (const disabled of [false, true]) {
    const env = { ...process.env, NO_COLOR: '1' }
    if (disabled) env.WAR06_NEGATIVE_CONTROL = 'drop-visible-publication'
    else delete env.WAR06_NEGATIVE_CONTROL
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 120_000,
    })
    assertProofProcessCompleted(result, `${entry.control} ${disabled ? 'red' : 'green'}`)
    if (!parseProofReport(result, entry, disabled)) {
      process.stderr.write(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
      throw new Error(`WAR-06 ${entry.control} ${disabled ? 'red' : 'green'} proof failed.`)
    }
    process.stdout.write(`${entry.control}: ${disabled ? 'RED at named safety oracle' : 'GREEN current control'}\n`)
  }
}
