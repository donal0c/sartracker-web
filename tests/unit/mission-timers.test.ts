import { describe, expect, it } from 'vitest'

import type { Mission } from '../../src/infrastructure/mission-store/tauri-mission-store'
import {
  calculateMissionTimerState,
  formatMissionDuration,
} from '../../src/features/mission/mission-timers'

const ACTIVE_MISSION: Mission = {
  id: 'mission-1',
  name: 'Training',
  status: 'active',
  start_time: '2026-04-09T10:00:00.000Z',
  pause_time: null,
  finish_time: null,
  paused_seconds: 300,
  notes: null,
  schema_version: 1,
}

describe('mission timers', () => {
  it('calculates elapsed and active time for an active mission', () => {
    const timers = calculateMissionTimerState(
      ACTIVE_MISSION,
      new Date('2026-04-09T11:00:00.000Z'),
    )

    expect(timers.elapsedSeconds).toBe(3600)
    expect(timers.activeSeconds).toBe(3300)
    expect(timers.isPaused).toBe(false)
  })

  it('includes the current pause duration while paused', () => {
    const timers = calculateMissionTimerState(
      {
        ...ACTIVE_MISSION,
        status: 'paused',
        pause_time: '2026-04-09T10:45:00.000Z',
      },
      new Date('2026-04-09T11:00:00.000Z'),
    )

    expect(timers.elapsedSeconds).toBe(3600)
    expect(timers.activeSeconds).toBe(2400)
    expect(timers.isPaused).toBe(true)
  })

  it('locks timers to finish time after finish', () => {
    const timers = calculateMissionTimerState(
      {
        ...ACTIVE_MISSION,
        status: 'finished',
        finish_time: '2026-04-09T10:50:00.000Z',
      },
      new Date('2026-04-09T11:00:00.000Z'),
    )

    expect(timers.elapsedSeconds).toBe(3000)
    expect(timers.activeSeconds).toBe(2700)
  })

  it('formats durations as hh:mm:ss', () => {
    expect(formatMissionDuration(0)).toBe('00:00:00')
    expect(formatMissionDuration(3661)).toBe('01:01:01')
  })
})
