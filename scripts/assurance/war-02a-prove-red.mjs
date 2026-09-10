import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { assertProofProcessCompleted, validateProofReport } from './war-02a-proof-result.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const cases = [
  {
    control: 'renderer-active-only',
    file: 'renderer-lifecycle.test.ts',
    name: 'historical renderer scope: lost preserves finished mission evidence through restart',
    oracle: 'finished mission evidence must retain durable loss ownership',
  },
  {
    control: 'backup-direct-target',
    file: 'backup.test.ts',
    name: 'historical backup atomicity: EIO before file.rename retains a whole mirror',
    oracle: 'prior mirror bytes must survive failed replacement',
  },
]

// This gate accepts only the named safety assertion failing, never collection,
// timeout, syntax, module loading, missing native dependency or arbitrary failure.
for (const entry of cases) {
  const args = [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
    `tests/unit/assurance/war-02a/${entry.file}`, '-t', entry.name, '--no-file-parallelism',
    '--reporter', path.join(root, 'scripts/assurance/war-02a-reporter.mjs')]
  for (const disabled of [false, true]) {
    const env = { ...process.env, NO_COLOR: '1' }
    delete env.WAR02A_NEGATIVE_CONTROL
    if (disabled) env.WAR02A_NEGATIVE_CONTROL = entry.control
    const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 60_000 })
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    assertProofProcessCompleted(result, `${entry.control} ${disabled ? 'red' : 'green'}`)
    let report
    try { report = JSON.parse(result.stdout) } catch { /* Invalid structured evidence fails below. */ }
    const valid = !result.error && result.signal === null && result.status === (disabled ? 1 : 0)
      && validateProofReport(report, { ...entry, disabled })
    if (!valid) {
      process.stderr.write(output)
      throw new Error(`WAR-02A ${entry.control} ${disabled ? 'red' : 'green'} proof failed: ${result.error?.message ?? result.status}`)
    }
    process.stdout.write(`${entry.control}: ${disabled ? 'RED at named safety oracle' : 'GREEN current control'}\n`)
  }
}
