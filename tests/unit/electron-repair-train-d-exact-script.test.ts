import { describe, expect, it } from 'vitest'
import { isMissionReadyForRecovery } from '../../build/electron-repair-train-d-smoke-lib.js'

describe('Repair Train D packaged smoke script', () => {
  it('accepts active and paused recoverable missions while rejecting unrelated states', () => {
    expect(isMissionReadyForRecovery({
      active: null,
      recoverable: { id: 'mission-1', status: 'paused' },
    }, 'mission-1')).toBe(true)
    expect(isMissionReadyForRecovery({
      active: null,
      recoverable: { id: 'mission-1', status: 'active' },
    }, 'mission-1')).toBe(true)
    expect(isMissionReadyForRecovery({
      active: null,
      recoverable: { id: 'mission-1', status: 'finished' },
    }, 'mission-1')).toBe(false)
    expect(isMissionReadyForRecovery({
      active: null,
      recoverable: { id: 'other-mission', status: 'paused' },
    }, 'mission-1')).toBe(false)
  })
})
