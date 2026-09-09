import { describe, expect, it } from 'vitest'
import { describeTrackingHealth } from '../../src/features/tracking/persistent-tracking-health'

describe('persistent tracking health', () => {
  const status = { mode: 'online' as const, consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: null }
  it('distinguishes connection from stale positions', () => {
    expect(describeTrackingHealth(status, 'active', 0).label).toBe('Tracking connected')
    expect(describeTrackingHealth(status, 'active', 2).label).toBe('Tracking connected · 2 stale positions')
  })
  it('never implies live tracking while offline or paused', () => {
    expect(describeTrackingHealth({ ...status, mode: 'offline', consecutiveFailures: 2 }, 'active', 0).label).toBe('Disconnected · retrying')
    expect(describeTrackingHealth(status, 'paused', 0).label).toBe('Mission paused · live refresh suspended')
    expect(describeTrackingHealth({ ...status, mode: 'idle' }, 'active', 0).label).toBe('Tracking not connected')
  })
  it('preserves reported degraded state despite online connection', () => {
    expect(describeTrackingHealth({ ...status, warning: 'Roster unavailable' }, 'active', 0).tone).toBe('warning')
  })
})
