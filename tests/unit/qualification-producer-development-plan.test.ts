import { describe, expect, it } from 'vitest'
import { compileProducerDevelopmentPlan } from '../../scripts/qualification/producer-development-plan.mjs'

describe('bounded PR producer development inventory', () => {
  it('compiles explicit variants and keeps held-gate negatives separate from product passes', () => {
    const cases = compileProducerDevelopmentPlan({ app: '/candidate/app', output: '/evidence',
      sourceSha: 'a'.repeat(40), appSha256: 'b'.repeat(64) })
    expect(new Set(cases.map(entry => entry.id)).size).toBe(cases.length)
    expect(cases.filter(entry => entry.contractId === 'C01')).toHaveLength(3)
    expect(cases.filter(entry => entry.contractId === 'C01').every(entry => entry.mechanicsOnly)).toBe(true)
    expect(cases.find(entry => entry.id === 'C28-routine')?.command.args).toContain('routine')
    expect(cases.find(entry => entry.id === 'C19-legacy-schema-matrix')?.command.script).toContain('legacy-schema-probe')
    expect(cases.find(entry => entry.id === 'C10-replay-201-outings')?.command.script).toContain('replay-outing-probe')
    expect(cases.every(entry => entry.command.timeoutMs <= 300000)).toBe(true)
    expect(cases.some(entry => entry.id.includes('field-') || entry.command.args.includes('--enospc-mount'))).toBe(false)
  })
})
