import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { compileProducerDevelopmentPlan } from '../../scripts/qualification/producer-development-plan.mjs'

describe('bounded PR producer development inventory', () => {
  it('allows every declared case and its cleanup to finish before the CI deadline', () => {
    const cases = compileProducerDevelopmentPlan({ app: '/candidate/app', output: '/evidence',
      sourceSha: 'a'.repeat(40), appSha256: 'b'.repeat(64) })
    const workflow = readFileSync('.github/workflows/electron-linux-validation.yml', 'utf8')
    const stepMinutes = Number(workflow.match(/name: Candidate producer development checks \(not qualification\)\s+timeout-minutes: (\d+)/u)?.[1])
    const jobMinutes = Number(workflow.match(/^ {4}timeout-minutes: (\d+)$/mu)?.[1])
    // Per-case TERM grace + cleanup, plus five minutes for evidence/summary I/O.
    const worstCaseMs = cases.reduce((total, entry) => total + entry.command.timeoutMs + 15000, 300000)
    expect(stepMinutes * 60000).toBeGreaterThan(worstCaseMs)
    expect(jobMinutes).toBeGreaterThanOrEqual(stepMinutes + 60)
  })
  it('compiles explicit variants and keeps held-gate negatives separate from product passes', () => {
    const cases = compileProducerDevelopmentPlan({ app: '/candidate/app', output: '/evidence',
      sourceSha: 'a'.repeat(40), appSha256: 'b'.repeat(64) })
    expect(new Set(cases.map(entry => entry.id)).size).toBe(cases.length)
    expect(cases.filter(entry => entry.contractId === 'C01')).toHaveLength(3)
    expect(cases.filter(entry => entry.contractId === 'C01').every(entry => entry.mechanicsOnly)).toBe(true)
    expect(cases.filter(entry => entry.contractId === 'C01')
      .every(entry => entry.command.timeoutMs === 120000)).toBe(true)
    expect(cases.find(entry => entry.id === 'C28-routine')?.command.args).toContain('routine')
    expect(cases.find(entry => entry.id === 'C19-legacy-schema-matrix')?.command.script).toContain('legacy-schema-probe')
    expect(cases.find(entry => entry.id === 'C10-replay-201-outings')?.command.script).toContain('replay-outing-probe')
    expect(cases.every(entry => entry.command.timeoutMs <= 300000)).toBe(true)
    expect(cases.some(entry => entry.id.includes('field-') || entry.command.args.includes('--enospc-mount'))).toBe(false)
  })
})
