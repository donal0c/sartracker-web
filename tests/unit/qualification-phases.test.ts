import { describe, expect, it } from 'vitest'
import { evaluateQualificationPhases, validateQualificationPhase } from '../../scripts/qualification/campaign-phases.mjs'

const bindings = [
  { contractId: 'C27', variantId: 'draft', mandatory: true, phase: 'prepublication' },
  { contractId: 'C00', variantId: 'public', mandatory: true, phase: 'postpublication' },
]

describe('mandatory release phases', () => {
  it('allows a completed draft gate to be distinguished from unverified public bytes', () => {
    expect(evaluateQualificationPhases(bindings, [{ contractId: 'C27', variantId: 'draft', status: 'PASS' }], [])).toMatchObject({
      prepublication: { status: 'PASS' }, postpublication: { status: 'NOT_RUN' },
      teamRolloutEligible: false, releaseComplete: false,
    })
  })
  it('keeps postpublication mismatch a hard stop even after draft checks passed', () => {
    expect(evaluateQualificationPhases(bindings, [
      { contractId: 'C27', variantId: 'draft', status: 'PASS' },
      { contractId: 'C00', variantId: 'public', status: 'FAIL' },
    ], [])).toMatchObject({ postpublication: { status: 'FAIL' }, teamRolloutEligible: false,
      requiredDisposition: 'block-team-rollout-and-withdraw-or-rollback' })
  })
  it('cannot move the draft gate after publication or turn public evidence into a prepublication gate', () => {
    expect(() => validateQualificationPhase({ contractId: 'C27', phase: 'postpublication' })).toThrow(/C00/)
    expect(() => validateQualificationPhase({ contractId: 'C00', phase: 'postpublication', proofMode: 'browser' })).toThrow(/public-release/)
  })
  it('requires every variant and preserves prior failed attempts', () => {
    const rows = [
      { contractId: 'C27', variantId: 'draft', status: 'FAIL' },
      { contractId: 'C27', variantId: 'draft', status: 'PASS' },
      { contractId: 'C00', variantId: 'public', status: 'PASS' },
    ]
    expect(evaluateQualificationPhases(bindings, rows, []).prepublication.status).toBe('FAIL')
    expect(evaluateQualificationPhases(bindings, rows.slice(1), ['changed receipt']).prepublication.status).toBe('INVALID_EVIDENCE')
  })
})
