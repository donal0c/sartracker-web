// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('keeps both historical controls falsifiable in the normal source gate', () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const result = spawnSync(process.execPath, ['scripts/assurance/war-02a-prove-red.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 120_000,
  })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  expect(result.stdout.match(/RED at named safety oracle/g)).toHaveLength(2)
  expect(result.stdout.match(/GREEN current control/g)).toHaveLength(2)
}, 130_000)
