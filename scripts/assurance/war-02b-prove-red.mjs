import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const testFile = 'tests/unit/assurance/war-02b/negative-controls.test.ts'
const testName = 'DON-228 controlled rebreak: cursor/window skips boundary fixes'
const reporter = path.join(root, 'scripts/assurance/war-02b-reporter.mjs')

/** Rejects child launch, timeout, and signal failures before reading proof output. */
function completed(result, label) {
  if (result.error || result.signal !== null || result.status === null) {
    const reason = result.error
      ? `${result.error.code ?? 'spawn error'}: ${result.error.message}`
      : result.signal ?? 'missing exit status'
    throw new Error(`WAR-02B ${label}: infrastructure failure; no safety proof was obtained (${reason})`)
  }
}

/** Parses only the structured reporter stream; human text is not proof. */
function parseReport(result) {
  try {
    return JSON.parse(result.stdout)
  } catch {
    return null
  }
}

/** Accepts only the expected single-test green or named-red receipt. */
function validate(report, disabled) {
  if (
    !report ||
    report.war02b?.unhandledErrorCount !== 0 ||
    report.war02b?.suiteErrorCount !== 0 ||
    report.war02b?.reason !== (disabled ? 'failed' : 'passed') ||
    !Array.isArray(report.testResults) ||
    report.testResults.length !== 1
  ) return false
  const suite = report.testResults[0]
  if (!suite || suite.message !== '' || !Array.isArray(suite.assertionResults)) return false
  const executed = suite.assertionResults.filter((assertion) => assertion.status !== 'skipped')
  if (executed.length !== 1 || executed[0]?.title !== testName) return false
  const assertion = executed[0]
  if (disabled) {
    return report.success === false &&
      report.numFailedTests === 1 &&
      report.numPassedTests === 0 &&
      assertion.status === 'failed' &&
      assertion.failureMessages.length === 1 &&
      assertion.failureMessages[0].includes('WAR-02B property failed:') &&
      assertion.failureMessages[0].includes('counterexample=') &&
      assertion.failureMessages[0].includes('replay=seed=')
  }
  return report.success === true &&
    report.numPassedTests === 1 &&
    report.numFailedTests === 0 &&
    assertion.status === 'passed' &&
    assertion.failureMessages.length === 0
}

const args = [
  path.join(root, 'node_modules/vitest/vitest.mjs'),
  'run',
  testFile,
  '-t',
  testName,
  '--no-file-parallelism',
  '--reporter',
  reporter,
]

for (const disabled of [false, true]) {
  const env = { ...process.env, NO_COLOR: '1' }
  if (disabled) env.WAR02B_NEGATIVE_CONTROL = 'cursor-window'
  else delete env.WAR02B_NEGATIVE_CONTROL
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  })
  completed(result, `cursor-window ${disabled ? 'red' : 'green'}`)
  const report = parseReport(result)
  if (result.status !== (disabled ? 1 : 0) || !validate(report, disabled)) {
    process.stderr.write(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
    throw new Error(`WAR-02B cursor-window ${disabled ? 'red' : 'green'} proof failed.`)
  }
  process.stdout.write(`cursor-window: ${disabled ? 'RED at named safety oracle' : 'GREEN current control'}\n`)
}
