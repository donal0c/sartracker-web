import React, { useEffect } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Mission } from '../../src/infrastructure/mission-store/tauri-mission-store'
import type { MissionTimerState } from '../../src/features/mission/mission-timers'
import { useMissionTimer } from '../../src/features/mission/use-mission-timer'

describe('useMissionTimer', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'))
  })

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount())
    }
    host?.remove()
    root = null
    host = null
    vi.useRealTimers()
  })

  it('returns null when there is no current mission', () => {
    const seen: Array<MissionTimerState | null> = []

    render(React.createElement(TimerProbe, { mission: null, onTimer: (timer) => seen.push(timer) }))

    expect(seen.at(-1)).toBeNull()
  })

  it('ticks active mission elapsed and active-search time from one clock', () => {
    const seen: Array<MissionTimerState | null> = []

    render(
      React.createElement(TimerProbe, {
        mission: createMission({
          start_time: '2026-05-17T09:59:50.000Z',
          paused_seconds: 3,
        }),
        onTimer: (timer) => seen.push(timer),
      }),
    )

    expect(seen.at(-1)).toMatchObject({
      elapsedSeconds: 10,
      activeSeconds: 7,
    })

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(seen.at(-1)).toMatchObject({
      elapsedSeconds: 12,
      activeSeconds: 9,
    })
  })

  function render(element: React.ReactElement): void {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root?.render(element)
    })
  }
})

function TimerProbe(props: {
  readonly mission: Mission | null
  readonly onTimer: (timer: MissionTimerState | null) => void
}) {
  const timer = useMissionTimer(props.mission)

  useEffect(() => {
    props.onTimer(timer)
  }, [props, timer])

  return null
}

function createMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission-1',
    name: 'Timer Mission',
    status: 'active',
    start_time: '2026-05-17T10:00:00.000Z',
    pause_time: null,
    finish_time: null,
    paused_seconds: 0,
    notes: null,
    schema_version: 1,
    ...overrides,
  }
}
