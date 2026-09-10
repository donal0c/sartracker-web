import { describe, expect, it } from 'vitest'
import { resolveMissionHistoryOmissions } from '../../src/features/layers/breadcrumb-coverage-visibility'

describe('breadcrumb coverage visibility [DON-215]', () => {
  it('does not let a live default or live device exception omit saved mission history', () => {
    expect(resolveMissionHistoryOmissions(['alpha', 'bravo', 'later'], []))
      .toEqual([])
  })
  it('retains outing-view device omissions without changing current position choices', () => {
    expect(resolveMissionHistoryOmissions(['alpha', 'bravo'], ['bravo']))
      .toEqual(['bravo'])
  })
})
