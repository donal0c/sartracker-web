// @vitest-environment node
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const require = createRequire(import.meta.url)
const { validateProofReport, assertProofProcessCompleted } = require('../../../../scripts/assurance/war-02a-proof-result.mjs') as {
  assertProofProcessCompleted: (result: ReturnType<typeof spawnSync>, label: string) => void
  validateProofReport: (report: unknown, expected: { name: string; oracle: string; disabled: boolean }) => boolean
}

describe('WAR-02A real reporter error channels', () => {
  for (const kind of ['cleanup', 'suite', 'unhandled'] as const) {
    it(`refuses the intended assertion plus a ${kind} error`, async () => {
      await mkdir(path.join(root, 'tmp'), { recursive: true })
      const directory = await mkdtemp(path.join(root, 'tmp/war02a-reporter-'))
      try {
        const fixture = path.join(directory, 'mixed.test.mjs')
        const config = path.join(directory, 'config.mjs')
        const extra = kind === 'cleanup' ? "afterEach(() => { throw new Error('cleanup fixture') })"
          : kind === 'suite' ? "afterAll(() => { throw new Error('suite fixture') })" : ''
        const body = kind === 'unhandled' ? "process.emit('unhandledRejection', new Error('unhandled fixture'), Promise.resolve())" : ''
        await writeFile(fixture, `import { afterAll, afterEach, expect, it } from 'vitest'\n${extra}\nit('selected case', () => { ${body}; expect('old', 'safety property').toBe('new') })\n`)
        await writeFile(config, `export default ${JSON.stringify({ test: { include: [fixture], environment: 'node' } })}`)
        const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
          '--config', config, '--reporter', path.join(root, 'scripts/assurance/war-02a-reporter.mjs')],
        { cwd: root, encoding: 'utf8', timeout: 30_000 })
        assertProofProcessCompleted(result, `reporter ${kind}`)
        expect(result.status).toBe(1)
        const report = JSON.parse(result.stdout) as {
          war02a: { suiteErrorCount: number; unhandledErrorCount: number }
          testResults: { assertionResults: { failureMessages: string[] }[] }[]
        }
        const failures = report.testResults[0]!.assertionResults[0]!.failureMessages
        expect(failures.some((message) => message.startsWith('AssertionError: safety property:'))).toBe(true)
        if (kind === 'cleanup') expect(failures).toHaveLength(2)
        if (kind === 'suite') expect(report.war02a.suiteErrorCount).toBeGreaterThan(0)
        if (kind === 'unhandled') expect(report.war02a.unhandledErrorCount).toBe(1)
        expect(validateProofReport(report, { name: 'selected case', oracle: 'safety property', disabled: true })).toBe(false)
      } finally { await rm(directory, { recursive: true, force: true }) }
    }, 40_000)
  }
})
