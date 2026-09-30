import { describe, expect, it } from 'vitest'

import { selectWorkspaceHideBlockedReason } from '../../src/features/mission/workspace-hide-blocked-reason'

const EARLIER_FINISHED = { id: 'yesterday-training' }

describe('workspace hide blocked reason [DON-307]', () => {
  it('lets the active mission panel minimize while an earlier finished mission awaits Archive & Lock', () => {
    expect(selectWorkspaceHideBlockedReason({
      decisionOpen: false,
      actionError: null,
      phase: 'active',
      governanceMission: EARLIER_FINISHED,
    })).toBeNull()
  })

  it('keeps archive controls visible after Finish, when no mission is active', () => {
    expect(selectWorkspaceHideBlockedReason({
      decisionOpen: false,
      actionError: null,
      phase: 'idle',
      governanceMission: EARLIER_FINISHED,
    })).toBe('Mission pause, recovery or archive controls must remain visible.')
  })

  it.each(['paused', 'recovery'] as const)('keeps %s controls visible', (phase) => {
    expect(selectWorkspaceHideBlockedReason({
      decisionOpen: false,
      actionError: null,
      phase,
      governanceMission: null,
    })).toBe('Mission pause, recovery or archive controls must remain visible.')
  })

  it('names an open decision or an action failure first', () => {
    expect(selectWorkspaceHideBlockedReason({
      decisionOpen: true, actionError: 'x', phase: 'active', governanceMission: null,
    })).toBe('Complete or cancel the open mission decision before hiding this workspace.')
    expect(selectWorkspaceHideBlockedReason({
      decisionOpen: false, actionError: 'x', phase: 'active', governanceMission: null,
    })).toBe('Resolve the mission action failure before hiding this workspace.')
  })
})
