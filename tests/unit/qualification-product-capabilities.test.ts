import { describe, expect, it } from 'vitest'
import { candidateProductCapabilityBlockers } from '../../scripts/qualification/product-capabilities.mjs'
import { evaluateQualificationPhases } from '../../scripts/qualification/campaign-phases.mjs'

describe('candidate product capability admission', () => {
  it('cannot turn successful subset probes into integrity, recovery or retention qualification', () => {
    const blockers = candidateProductCapabilityBlockers('candidate')
    expect(blockers.map((entry) => entry.issueId)).toEqual(['DON-249', 'DON-250', 'DON-251'])
    expect(blockers.every((entry) => entry.contractIds.includes('C19'))).toBe(true)
    expect(candidateProductCapabilityBlockers('calibration')).toEqual([])
    const bindings = [
      { contractId: 'C19', variantId: 'schema', mandatory: true },
      { contractId: 'C00', variantId: 'public', mandatory: true, phase: 'postpublication' },
    ]
    const attempts = bindings.map((binding) => ({ ...binding, status: 'PASS' }))
    const result = evaluateQualificationPhases(bindings, attempts, [], blockers)
    expect(result.prepublication.status).toBe('FAIL')
    expect(result.prepublication.productCapabilityBlockers).toEqual(blockers)
    expect(result.postpublication.status).toBe('PASS')
    expect(result.evidenceComplete).toBe(false)
    expect(evaluateQualificationPhases(bindings, attempts, []).prepublication.status).toBe('PASS')
  })
})
