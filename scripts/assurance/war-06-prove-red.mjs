import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { assertProofProcessCompleted } from './war-02a-proof-result.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const cases = [
  {
    control: 'AUD-01-visible-publication',
    pattern: 'rejects stale history publication at the real delayed poller flush',
    name: 'rejects stale history publication at the real delayed poller flush [WAR-06-AUD-01-REPAIR]',
    oracle: 'WAR-06 AUD-01 repair safety oracle:',
  },
  {
    control: 'AUD-02-stationary-projection',
    pattern: 'rejects deferred stale current-fix publication through finish-idle-start while a poll is in flight',
    name: 'rejects deferred stale current-fix publication through finish-idle-start while a poll is in flight [WAR-06-AUD-02-REPAIR]',
    oracle: 'WAR-06 AUD-02 repair safety oracle:',
  },
  {
    control: 'CACHE-SIBLING-stationary-projection',
    pattern: 'rejects the unkeyed cached snapshot on Mission B cold start',
    name: 'rejects the unkeyed cached snapshot on Mission B cold start [WAR-06-CACHE-SIBLING-REPAIR]',
    oracle: 'WAR-06 CACHE-SIBLING repair safety oracle:',
  },
]

/** Reads one structured Vitest receipt and proves the expected oracle outcome. */
function parseProofReport(result, entry, injected) {
  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    return false
  }
  if (
    report.war02a?.unhandledErrorCount !== 0 ||
    report.war02a?.suiteErrorCount !== 0 ||
    report.war02a?.reason !== (injected ? 'failed' : 'passed') ||
    !Array.isArray(report.testResults) || report.testResults.length !== 1
  ) return false
  const assertions = report.testResults[0]?.assertionResults
  if (!Array.isArray(assertions)) return false
  const executed = assertions.filter((assertion) => assertion.status !== 'skipped')
  if (executed.length !== 1 || executed[0]?.title !== entry.name) return false
  const assertion = executed[0]
  if (injected) {
    return report.success === false && report.numFailedTests === 1 &&
      report.numPassedTests === 0 && assertion.status === 'failed' &&
      assertion.failureMessages.length === 1 &&
      assertion.failureMessages.some((message) => message.startsWith(`AssertionError: ${entry.oracle}`))
  }
  return report.success === true && report.numPassedTests === 1 &&
    report.numFailedTests === 0 && assertion.status === 'passed' &&
    assertion.failureMessages.length === 0
}

// The repaired baseline must be GREEN. The second run injects an explicit stale
// publication and must fail at the same named safety oracle, proving the control
// cannot be made vacuous by a repair.
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
  for (const injected of [false, true]) {
    const env = { ...process.env, NO_COLOR: '1' }
    if (injected) env.WAR06_NEGATIVE_CONTROL = 'inject-stale-publication'
    else delete env.WAR06_NEGATIVE_CONTROL
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 120_000,
    })
    assertProofProcessCompleted(result, `${entry.control} ${injected ? 'injected-red' : 'green'}`)
    if (!parseProofReport(result, entry, injected)) {
      process.stderr.write(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
      throw new Error(`WAR-06 ${entry.control} ${injected ? 'injected-red' : 'green'} proof failed.`)
    }
    process.stdout.write(`${entry.control}: ${injected ? 'RED injected stale publication at named repair oracle' : 'GREEN current control'}\n`)
  }
}
