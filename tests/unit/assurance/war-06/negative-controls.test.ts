// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('keeps all WAR-06 characterization oracles falsifiable', () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const result = spawnSync(process.execPath, ['scripts/assurance/war-06-prove-red.mjs'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 360_000,
  })
  expect(result.error?.message, `${result.stdout}\n${result.stderr}`).toBeUndefined()
  expect(result.signal, `${result.stdout}\n${result.stderr}`).toBeNull()
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  expect(result.stdout.match(/GREEN current control/g)).toHaveLength(3)
  expect(result.stdout.match(/RED at named safety oracle/g)).toHaveLength(3)
})
