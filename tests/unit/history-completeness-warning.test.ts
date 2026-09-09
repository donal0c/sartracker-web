import { expect, it } from 'vitest'
import { historyCompletenessWarning } from '../../src/features/tracking/tracking-trust-warning'

it('projects existing history warnings without treating idle configuration as failed retrieval', () => {
  expect(historyCompletenessWarning('Tracking is not configured.')).toBeNull()
  expect(historyCompletenessWarning('CONNECTION RESTORED')).toBeNull()
  for (const warning of ['Breadcrumb history incomplete for Alpha; retrying while current fixes remain live.',
    'BREADCRUMB HISTORY REFRESH FAILED — current fixes remain live; exact history will retry.',
    'Breadcrumb history is reconciling for Alpha; current fixes remain live.']) {
    expect(historyCompletenessWarning(warning)).toBe(warning)
  }
})
