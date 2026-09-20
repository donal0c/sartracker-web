import { describe, expect, it } from 'vitest'

import {
  C28_REQUIRED_VARIANTS,
  C28_VARIANT_AXIS_MAP,
  deriveC28FamilyCoverage,
  validateC28VariantCoverage,
} from '../../scripts/qualification/composite-coverage.mjs'

describe('C28 fixed coverage admission', () => {
  it('accepts only the exact reviewed axes for a producer variant', () => {
    const result = validateC28VariantCoverage({
      variantId: 'field-scale-seed',
      coveredAxes: [...C28_VARIANT_AXIS_MAP['field-scale-seed']],
      missingAxes: [],
    }, { contractId: 'C28', variantId: 'field-scale-seed' })

    expect(result).toMatchObject({ valid: true, variantId: 'field-scale-seed', failureReasons: [] })
  })

  it.each([
    ['unknown variant', { variantId: 'field', coveredAxes: [] }],
    ['invented axis', { variantId: 'field-scale-seed', coveredAxes: ['field-scale.invented'] }],
    ['duplicate axis', { variantId: 'field-scale-seed', coveredAxes: [...C28_VARIANT_AXIS_MAP['field-scale-seed'], 'field-scale.100-devices'] }],
    ['producer family flag', { variantId: 'field-scale-seed', coveredAxes: [...C28_VARIANT_AXIS_MAP['field-scale-seed']], familyComplete: true }],
  ])('rejects %s', (_label, receipt) => {
    expect(validateC28VariantCoverage(receipt, { contractId: 'C28', variantId: 'field-scale-seed' }).valid).toBe(false)
  })

  it('derives a complete family only from all validated fixed variants', () => {
    expect(deriveC28FamilyCoverage(C28_REQUIRED_VARIANTS)).toMatchObject({
      status: 'PASS', valid: true, familyComplete: true, missingVariants: [],
    })
  })

  it('blocks admission when a mandatory variant is absent, regardless of producer flags', () => {
    const result = deriveC28FamilyCoverage([
      'routine', 'field-scale-seed', 'failure-injection',
    ])

    expect(result).toMatchObject({
      status: 'ENVIRONMENT_BLOCKED', valid: false, familyComplete: false,
      missingVariants: expect.arrayContaining(['field-scale-960k', 'archive-revision-supplement']),
    })
  })

  it('rejects an admission request that narrows the reviewed mandatory set', () => {
    const result = deriveC28FamilyCoverage(['routine'], { requiredVariants: ['routine'] })
    expect(result).toMatchObject({ status: 'ENVIRONMENT_BLOCKED', valid: false, familyComplete: false })
    expect(result.failureReasons.join('\n')).toMatch(/cannot narrow/iu)
  })
})
