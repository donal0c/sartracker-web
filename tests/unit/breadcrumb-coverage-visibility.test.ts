import { describe, expect, it } from 'vitest'
import { resolveBreadcrumbOmissions } from '../../src/features/layers/breadcrumb-coverage-visibility'

describe('breadcrumb coverage visibility [DON-215]', () => {
  it('applies default-off with one explicit selection to all mission history', () => {
    expect(resolveBreadcrumbOmissions(['alpha', 'bravo', 'later'], false, [{ deviceId: 'alpha', visible: true }, { deviceId: 'bravo', visible: false }], []))
      .toEqual(['bravo', 'later'])
  })
  it('retains outing-view device omissions without changing current position choices', () => {
    expect(resolveBreadcrumbOmissions(['alpha', 'bravo'], true, [{ deviceId: 'alpha', visible: false }], ['bravo']))
      .toEqual(['alpha', 'bravo'])
  })
})
