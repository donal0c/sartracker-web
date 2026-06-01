import { describe, expect, it } from 'vitest'

import {
  selectMissionPhasePresentation,
  type MissionPhase,
} from '../../src/features/mission/mission-phase-presentation'

const PHASES: readonly MissionPhase[] = ['idle', 'active', 'paused', 'recovery']

describe('selectMissionPhasePresentation', () => {
  it('maps each phase to a matching status label and tone', () => {
    expect(selectMissionPhasePresentation('idle')).toMatchObject({ statusLabel: 'IDLE', tone: 'idle' })
    expect(selectMissionPhasePresentation('active')).toMatchObject({ statusLabel: 'ACTIVE', tone: 'active' })
    expect(selectMissionPhasePresentation('paused')).toMatchObject({ statusLabel: 'PAUSED', tone: 'paused' })
    expect(selectMissionPhasePresentation('recovery')).toMatchObject({
      statusLabel: 'RECOVERY',
      tone: 'recovery',
    })
  })

  it('flags the paused phase for attention so the UI can flash it, and no other phase', () => {
    for (const phase of PHASES) {
      const presentation = selectMissionPhasePresentation(phase)
      expect(presentation.attention).toBe(phase === 'paused')
      expect(presentation.paused).toBe(phase === 'paused')
    }
  })

  it('only surfaces the paused recovery banner while paused', () => {
    for (const phase of PHASES) {
      const presentation = selectMissionPhasePresentation(phase)
      if (phase === 'paused') {
        expect(presentation.banner).not.toBeNull()
      } else {
        expect(presentation.banner).toBeNull()
      }
    }
  })

  it('does not rely on color alone — the paused banner carries explicit text semantics', () => {
    const banner = selectMissionPhasePresentation('paused').banner
    expect(banner).not.toBeNull()
    // The heading must literally say the mission is paused so operators reading
    // a washed-out or monochrome display still understand the state.
    expect(banner?.heading.toLowerCase()).toContain('paused')
    // The detail must explain the consequence (active-search timer is frozen)
    // and the recovery action (resume) without depending on the flashing colour.
    expect(banner?.detail.toLowerCase()).toContain('frozen')
    expect(banner?.detail.toLowerCase()).toContain('resume')
    expect(banner?.resumeLabel.toLowerCase()).toContain('resume')
  })
})
