import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BETA13_CLAIM_SCOPE,
  BETA13_NOT_CLAIMED_CAPABILITIES,
  candidateProductCapabilityResiduals,
  validateCandidateClaimScope,
} from '../../scripts/qualification/product-capabilities.mjs'
import { evaluateQualificationPhases } from '../../scripts/qualification/campaign-phases.mjs'

describe('Beta 13 not-claimed capability scope', () => {
  it('labels DON-249/250/251 as NOT_CLAIMED and binds their affected contracts and hazards', () => {
    const residuals = candidateProductCapabilityResiduals('candidate', BETA13_CLAIM_SCOPE)
    expect(residuals.map((entry) => [entry.issueId, entry.status])).toEqual([
      ['DON-249', 'NOT_CLAIMED'],
      ['DON-250', 'NOT_CLAIMED'],
      ['DON-251', 'NOT_CLAIMED'],
    ])
    expect(residuals[0].contractIds).toEqual(['C19', 'C24'])
    expect(residuals[0].hazardIds).toEqual(['PST-003', 'IPC-003'])
    expect(residuals[1].contractIds).toEqual(['C19'])
    expect(residuals[1].hazardIds).toContain('PST-005')
    expect(residuals[2].hazardIds).toEqual(['PST-004', 'IPC-003'])
    expect(candidateProductCapabilityResiduals('calibration')).toEqual([])
    expect(BETA13_NOT_CLAIMED_CAPABILITIES).toBe(residuals)
  })

  it('rejects scope edits that could silently expand use or drop a known residual', () => {
    expect(validateCandidateClaimScope(BETA13_CLAIM_SCOPE)).toBe(true)
    expect(() => validateCandidateClaimScope({ ...BETA13_CLAIM_SCOPE, independentPrimaryRequired: false }))
      .toThrow(/scope/iu)
    expect(() => validateCandidateClaimScope({ ...BETA13_CLAIM_SCOPE, notClaimedIssueIds: ['DON-249'] }))
      .toThrow(/scope/iu)
    expect(() => validateCandidateClaimScope({ ...BETA13_CLAIM_SCOPE, allowedData: ['live'] }))
      .toThrow(/scope/iu)
  })

  it('never turns scoped omissions into PASS and preserves any observed failure or missing receipt', () => {
    const capabilities = candidateProductCapabilityResiduals('candidate', BETA13_CLAIM_SCOPE)
    const bindings = [
      { contractId: 'C19', variantId: 'schema', mandatory: true },
      { contractId: 'C24', variantId: 'responsiveness', mandatory: true },
      { contractId: 'C00', variantId: 'public', mandatory: true, phase: 'postpublication' },
    ]
    const passingApplicableRows = bindings.map((binding) => ({ ...binding, status: 'PASS' }))
    const limited = evaluateQualificationPhases(bindings, passingApplicableRows, [], capabilities)
    expect(limited.prepublication.status).toBe('SCOPE_LIMITED')
    expect(limited.prepublication.notClaimedCapabilities.map((entry) => entry.issueId))
      .toEqual(['DON-249', 'DON-250', 'DON-251'])
    expect(limited.postpublication.status).toBe('PASS')
    expect(limited.evidenceComplete).toBe(false)
    expect(limited.releaseComplete).toBe(false)
    expect(limited.teamRolloutEligible).toBe(false)

    const failed = evaluateQualificationPhases(bindings,
      passingApplicableRows.map((row) => row.contractId === 'C24' ? { ...row, status: 'FAIL' } : row), [], capabilities)
    expect(failed.prepublication.status).toBe('FAIL')
    const missing = evaluateQualificationPhases(bindings, passingApplicableRows.slice(1), [], capabilities)
    expect(missing.prepublication.status).toBe('NOT_RUN')
    const invalid = evaluateQualificationPhases(bindings, passingApplicableRows, ['changed evidence'], capabilities)
    expect(invalid.prepublication.status).toBe('INVALID_EVIDENCE')
  })

  it('keeps the complete C00-C29 campaign and absolute hazard inventory required', () => {
    const campaign = JSON.parse(readFileSync('docs/assurance/qualification-campaign-plan.json', 'utf8'))
    const registry = JSON.parse(readFileSync('docs/assurance/qualification-contracts.json', 'utf8'))
    expect(campaign.requiredContracts).toEqual(Array.from({ length: 30 }, (_, index) => `C${String(index).padStart(2, '0')}`))
    expect(campaign.bindings.some((binding) => binding.contractId === 'C19' && binding.mandatory)).toBe(true)
    expect(campaign.bindings.some((binding) => binding.contractId === 'C24' && binding.mandatory)).toBe(true)
    for (const hazardId of ['TRK-001', 'EVD-004', 'MIS-003', 'RPL-001', 'EVD-001', 'EVD-005', 'RPL-003', 'RPL-004', 'IPC-003', 'PST-003', 'PST-004', 'PST-005']) {
      expect(registry.releaseCriticalHazards).toContain(hazardId)
    }
  })
})
