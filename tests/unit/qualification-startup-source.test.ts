// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { readStartupSourceIdentity } from '../../scripts/qualification/startup-probe.mjs'

describe('startup producer source identity', () => {
  it('does not invert a dirty checkout into clean evidence', () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
    expect(readStartupSourceIdentity(head)).toMatchObject({ head, expectedHead: head, dirty: status.length > 0 })
  })
})
