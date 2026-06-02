import { describe, expect, it } from 'vitest'

import { getMissionReviewSelectionClassName } from '../../src/features/mission-review/mission-review-selection-style'

describe('mission review selection contrast', () => {
  it('uses the shared high-contrast selected row class for selected mission and marker rows', () => {
    expect(getMissionReviewSelectionClassName(true)).toContain('sar-selected-row')
    expect(getMissionReviewSelectionClassName(false)).not.toContain('sar-selected-row')
  })
})
